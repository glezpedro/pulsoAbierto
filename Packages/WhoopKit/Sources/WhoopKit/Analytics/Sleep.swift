import Foundation

public enum SleepStage: Int, Codable, CaseIterable {
    case awake = 0, light = 1, deep = 2, rem = 3
    public var spanish: String {
        switch self {
        case .awake: return "Despierto"
        case .light: return "Ligero"
        case .deep: return "Profundo"
        case .rem: return "REM"
        }
    }
}

public struct SleepSession: Codable, Equatable {
    public var start: Int                   // unix s (in bed / onset window start)
    public var end: Int                     // unix s (final wake)
    public var stages: [SleepStage]         // one per minute from `start`
    public var isNap: Bool

    // derived metrics
    public var minutesInBed: Int { stages.count }
    public var minutesAsleep: Int { stages.filter { $0 != .awake }.count }
    public func minutes(_ s: SleepStage) -> Int { stages.filter { $0 == s }.count }
    public var efficiency: Double { minutesInBed > 0 ? Double(minutesAsleep) / Double(minutesInBed) : 0 }
    public var latencyMinutes: Int {
        // first run of 5 consecutive asleep minutes
        var run = 0
        for (i, s) in stages.enumerated() {
            run = s == .awake ? 0 : run + 1
            if run == 5 { return max(0, i - 4) }
        }
        return stages.count
    }
    public var disturbances: Int {
        var count = 0, run = 0
        let onset = latencyMinutes
        for s in stages.dropFirst(onset) {
            if s == .awake { run += 1 } else { if run >= 2 { count += 1 }; run = 0 }
        }
        return count
    }
    public var wasoMinutes: Int {
        var lastAsleep = stages.count - 1
        while lastAsleep > 0 && stages[lastAsleep] == .awake { lastAsleep -= 1 }
        let onset = latencyMinutes
        guard lastAsleep > onset else { return 0 }
        return stages[onset...lastAsleep].filter { $0 == .awake }.count
    }
    public var remCycles: Int {
        var cycles = 0, prev: SleepStage? = nil, run = 0
        for s in stages {
            if s == .rem { run += 1 } else { if prev == .rem && run >= 5 { cycles += 1 }; run = 0 }
            prev = s
        }
        if prev == .rem && run >= 5 { cycles += 1 }
        return cycles
    }
    public var restorativeFraction: Double {
        minutesAsleep > 0 ? Double(minutes(.deep) + minutes(.rem)) / Double(minutesAsleep) : 0
    }

    // physiology measured during the session (filled by SleepAnalyzer)
    public var avgHR: Double?
    public var minHR: Double?
    public var restingHR: Double?
    public var hrvRMSSD: Double?
    public var respiratoryRate: Double?
    public var skinTempRaw: Double?
    public var spo2Estimate: Double?
    public var hrCurve: [Double?] = []      // per-minute HR
    public var hrvCurve: [Double?] = []     // per-5-minute RMSSD
}

public enum SleepAnalyzer {

    public struct Config {
        public var minMainSleepMinutes = 120
        public var minNapMinutes = 20
        public var mergeGapMinutes = 25
        public init() {}
    }

    /// Detects sleep sessions in a window of epochs (typically 18:00 previous day → 18:00).
    public static func detect(_ epochsIn: [MinuteEpoch], config: Config = Config()) -> [SleepSession] {
        let epochs = epochsIn.filter { $0.seconds > 0 }.sorted { $0.ts < $1.ts }
        guard epochs.count >= config.minNapMinutes else { return [] }

        // Fill a dense per-minute grid so gaps (strap off / not synced) are explicit.
        guard let t0 = epochs.first?.ts, let t1 = epochs.last?.ts else { return [] }
        let n = (t1 - t0) / 60 + 1
        var grid = [MinuteEpoch?](repeating: nil, count: n)
        for e in epochs { grid[(e.ts - t0) / 60] = e }

        let hrs = epochs.compactMap { $0.hasData ? $0.hr : nil }
        guard let hrP50 = Stats.percentile(hrs, 50) else { return [] }
        let motions = epochs.compactMap { $0.hasData ? $0.motion : nil }
        let hasMotion = motions.count > epochs.count / 2
        let stillThreshold = max(2.0, (Stats.percentile(motions, 25) ?? 0) * 3 + 1.5)

        // 1) candidate minutes: still + HR in the lower half of the window
        var cand = [Bool](repeating: false, count: n)
        for i in 0..<n {
            guard let e = grid[i], e.hasData, let hr = e.hr else { continue }
            var still = true
            if hasMotion {
                // weighted motion over ±3 minutes (Cole–Kripke style window)
                let weights: [Double] = [1, 2, 3, 4, 3, 2, 1]
                var acc = 0.0, wsum = 0.0
                for (k, w) in weights.enumerated() {
                    let j = i + k - 3
                    if j >= 0, j < n, let m = grid[j]?.motion { acc += w * min(m, 60); wsum += w }
                }
                still = wsum > 0 ? acc / wsum < stillThreshold : true
            }
            cand[i] = still && hr <= hrP50 + 2
        }
        // 2) majority smoothing over 11 minutes
        var smooth = cand
        for i in 0..<n {
            let lo = max(0, i - 5), hi = min(n - 1, i + 5)
            let c = cand[lo...hi].filter { $0 }.count
            smooth[i] = Double(c) / Double(hi - lo + 1) >= 0.5
        }
        // 3) segments with gap merging
        var segs: [(Int, Int)] = []
        var i = 0
        while i < n {
            if smooth[i] {
                var j = i
                while j + 1 < n && smooth[j + 1] { j += 1 }
                if let last = segs.last, i - last.1 <= config.mergeGapMinutes {
                    segs[segs.count - 1].1 = j
                } else { segs.append((i, j)) }
                i = j + 1
            } else { i += 1 }
        }
        let lengths = segs.map { $0.1 - $0.0 + 1 }
        guard let mainIdx = lengths.indices.max(by: { lengths[$0] < lengths[$1] }),
              lengths[mainIdx] >= config.minNapMinutes else { return [] }

        var sessions: [SleepSession] = []
        for (k, seg) in segs.enumerated() {
            let len = seg.1 - seg.0 + 1
            let isMain = k == mainIdx && len >= config.minMainSleepMinutes
            guard isMain || len >= config.minNapMinutes else { continue }
            if !isMain && len < config.minNapMinutes { continue }
            let slice = Array(grid[seg.0...seg.1])
            var s = stage(slice, startTs: t0 + seg.0 * 60, isNap: !isMain)
            fillPhysiology(&s, slice: slice, sliceStart: t0 + seg.0 * 60)
            sessions.append(s)
        }
        return sessions
    }

    /// Assigns a stage to every minute of a sleep segment.
    static func stage(_ slice: [MinuteEpoch?], startTs: Int, isNap: Bool) -> SleepSession {
        let n = slice.count
        let hrRaw: [Double?] = slice.map { $0?.hasData == true ? $0?.hr : nil }
        // 3-minute smoothed HR
        var hr = [Double?](repeating: nil, count: n)
        for i in 0..<n {
            let vals = (max(0, i - 1)...min(n - 1, i + 1)).compactMap { hrRaw[$0] }
            hr[i] = Stats.mean(vals)
        }
        // rolling 5-min HR variability and RMSSD
        var hrStd = [Double?](repeating: nil, count: n)
        var rmssd = [Double?](repeating: nil, count: n)
        for i in 0..<n {
            let r = max(0, i - 2)...min(n - 1, i + 2)
            hrStd[i] = Stats.sd(r.compactMap { hrRaw[$0] })
            let rr = r.flatMap { slice[$0]?.rr ?? [] }
            rmssd[i] = HRV.compute(rr)?.rmssd
        }
        let validHR = hr.compactMap { $0 }
        let p15 = Stats.percentile(validHR, 15) ?? 0, p30 = Stats.percentile(validHR, 30) ?? 0
        let p50 = Stats.percentile(validHR, 50) ?? 0, p80 = Stats.percentile(validHR, 80) ?? 0
        let stdP50 = Stats.percentile(hrStd.compactMap { $0 }, 50) ?? 0
        let stdP70 = Stats.percentile(hrStd.compactMap { $0 }, 70) ?? 0
        let rmP40 = Stats.percentile(rmssd.compactMap { $0 }, 40) ?? 0
        let motionVals = slice.compactMap { $0?.motion }
        let mP90 = Stats.percentile(motionVals, 90) ?? 10
        let wakeMotion = max(6, mP90)

        var st = [SleepStage](repeating: .light, count: n)
        for i in 0..<n {
            guard let e = slice[i], e.hasData, let h = hr[i] else { st[i] = .awake; continue }
            let m = e.motion ?? 0
            let progress = Double(i) / Double(max(1, n - 1))
            if m >= wakeMotion || h > p80 + max(5, (p80 - p50)) {
                st[i] = .awake
            } else if h <= (progress > 0.7 ? p15 : p30) && m < 1.5 &&
                        (hrStd[i] ?? 99) <= stdP50 && (rmssd[i] ?? 0) >= rmP40 {
                st[i] = .deep
            } else if i >= (isNap ? 30 : 45), m < 2, h >= p50 || (hrStd[i] ?? 0) >= stdP70 {
                st[i] = .rem
            } else {
                st[i] = .light
            }
        }
        // mode filter (5 min) then merge bouts shorter than 3 minutes into neighbours
        st = modeFilter(st, window: 5)
        st = mergeShortBouts(st, minLen: 3)

        // plausibility normalisation (estimates, labelled as such in the UI)
        let asleepIdx = st.indices.filter { st[$0] != .awake }
        let asleepCount = max(1, asleepIdx.count)
        func cap(_ stage: SleepStage, maxFrac: Double, scoreHigherIsWorse: (Int) -> Double) {
            var idx = st.indices.filter { st[$0] == stage }
            let limit = Int(maxFrac * Double(asleepCount))
            guard idx.count > limit else { return }
            idx.sort { scoreHigherIsWorse($0) > scoreHigherIsWorse($1) }
            for j in idx.prefix(idx.count - limit) { st[j] = .light }
        }
        cap(.deep, maxFrac: 0.28) { hr[$0] ?? 0 }
        cap(.rem, maxFrac: 0.30) { -(hr[$0] ?? 0) }
        if !isNap {
            let deepNow = st.filter { $0 == .deep }.count
            let target = Int(0.10 * Double(asleepCount))
            if deepNow < target {
                let firstPart = st.indices.filter { st[$0] == .light && Double($0) < 0.6 * Double(n) }
                    .sorted { (hr[$0] ?? 999) < (hr[$1] ?? 999) }
                for j in firstPart.prefix(target - deepNow) { st[j] = .deep }
                st = mergeShortBouts(st, minLen: 2)
            }
        }
        // trim leading/trailing wake so the session starts at onset and ends at final wake
        var a = 0, b = st.count - 1
        while a < b && st[a] == .awake { a += 1 }
        while b > a && st[b] == .awake { b -= 1 }
        let trimmed = Array(st[a...b])
        var s = SleepSession(start: startTs + a * 60, end: startTs + (b + 1) * 60, stages: trimmed, isNap: isNap)
        s.hrCurve = Array(hrRaw[a...b])
        return s
    }

    static func fillPhysiology(_ s: inout SleepSession, slice fullSlice: [MinuteEpoch?], sliceStart firstTs: Int) {
        // align the segment grid with the trimmed session
        let slice: [MinuteEpoch?] = (0..<s.stages.count).map { i in
            let target = s.start + i * 60
            let idx = (target - firstTs) / 60
            return idx >= 0 && idx < fullSlice.count ? fullSlice[idx] : nil
        }
        let asleep = slice.indices.filter { s.stages[$0] != .awake }
        let hrs = asleep.compactMap { slice[$0]?.hasData == true ? slice[$0]?.hr : nil }
        s.avgHR = Stats.mean(hrs)
        s.minHR = hrs.min()
        let deepHRs = slice.indices.filter { s.stages[$0] == .deep }.compactMap { slice[$0]?.hr }
        s.restingHR = deepHRs.count >= 15 ? Stats.mean(deepHRs) : Stats.percentile(hrs, 10)

        // HRV: RMSSD over deep sleep in the last third of the night (WHOOP-like), else median of
        // 5-minute windows across the night.
        let lastThird = slice.indices.filter { $0 >= 2 * slice.count / 3 && s.stages[$0] == .deep }
        let lateRR = lastThird.flatMap { slice[$0]?.rr ?? [] }
        if let r = HRV.compute(lateRR), r.beats >= 200 {
            s.hrvRMSSD = r.rmssd
        }
        var windows: [Double?] = []
        var k = 0
        while k < slice.count {
            let r = k..<min(slice.count, k + 5)
            let rr = r.filter { s.stages[$0] != .awake }.flatMap { slice[$0]?.rr ?? [] }
            windows.append(HRV.compute(rr)?.rmssd)
            k += 5
        }
        s.hrvCurve = windows
        if s.hrvRMSSD == nil { s.hrvRMSSD = Stats.median(windows.compactMap { $0 }) }

        let quiet = asleep.filter { s.stages[$0] == .deep || s.stages[$0] == .light }.compactMap { slice[$0] }
        s.respiratoryRate = Respiratory.rate(epochs: quiet)
        s.skinTempRaw = Stats.median(asleep.compactMap { slice[$0]?.skinTemp })
        s.spo2Estimate = SpO2.estimate(asleep.compactMap { slice[$0] })
    }

    static func modeFilter(_ x: [SleepStage], window: Int) -> [SleepStage] {
        guard x.count > window else { return x }
        let h = window / 2
        return x.indices.map { i in
            let lo = max(0, i - h), hi = min(x.count - 1, i + h)
            var counts = [Int](repeating: 0, count: 4)
            for j in lo...hi { counts[x[j].rawValue] += 1 }
            let best = counts.indices.max { counts[$0] < counts[$1] }!
            return counts[best] > counts[x[i].rawValue] ? SleepStage(rawValue: best)! : x[i]
        }
    }

    static func mergeShortBouts(_ x: [SleepStage], minLen: Int) -> [SleepStage] {
        var st = x
        var changed = true
        var guardIter = 0
        while changed && guardIter < 10 {
            changed = false; guardIter += 1
            var i = 0
            while i < st.count {
                var j = i
                while j + 1 < st.count && st[j + 1] == st[i] { j += 1 }
                let len = j - i + 1
                if len < minLen {
                    let left = i > 0 ? st[i - 1] : nil
                    let right = j + 1 < st.count ? st[j + 1] : nil
                    if let repl = left ?? right {
                        for k in i...j { st[k] = repl }
                        changed = true
                    }
                }
                i = j + 1
            }
        }
        return st
    }
}

// MARK: - Sleep need & score

public struct SleepNeed: Codable, Equatable {
    public var baselineMin: Double
    public var strainMin: Double
    public var debtMin: Double
    public var napCreditMin: Double
    public var totalMin: Double { max(240, baselineMin + strainMin + debtMin - napCreditMin) }
}

public struct SleepScore: Codable, Equatable {
    public var score: Double          // 0–100 composite
    public var performance: Double    // asleep / need (0–100)
    public var efficiency: Double     // 0–100
    public var restorative: Double    // 0–100 (deep+REM share vs 40 % target)
    public var consistency: Double    // 0–100
}

public enum SleepCoach {

    /// Sleep need (WHOOP-like): baseline + strain adjustment + recent sleep debt − naps.
    /// - previousNights: (need, slept) minutes for the last nights, most recent first.
    public static func need(profile: PhysioProfile, yesterdayStrain: Double?, previousNights: [(need: Double, slept: Double)],
                            napsMinutes: Double) -> SleepNeed {
        let base = profile.sleepNeedBaseHours * 60
        let strainAdj = max(0, (yesterdayStrain ?? 0) - 8) * 3.5
        let weights = [0.5, 0.3, 0.2]
        var debt = 0.0
        for (i, n) in previousNights.prefix(3).enumerated() { debt += weights[i] * max(0, n.need - n.slept) }
        return SleepNeed(baselineMin: base, strainMin: strainAdj, debtMin: min(debt, 120) * 0.6,
                         napCreditMin: min(napsMinutes, 90))
    }

    /// Consistency 0–100 from the circular spread of bed/wake times over the last nights.
    public static func consistency(bedtimes: [Int], wakeTimes: [Int]) -> Double {
        func spreadMinutes(_ ts: [Int]) -> Double {
            guard ts.count >= 2 else { return 0 }
            let angles = ts.map { Double(($0 % 86400 + 86400) % 86400) / 86400 * 2 * .pi }
            let c = angles.map(cos).reduce(0, +) / Double(angles.count)
            let s = angles.map(sin).reduce(0, +) / Double(angles.count)
            let r = min(1, (c * c + s * s).squareRoot())
            let circSD = (-2 * log(max(r, 1e-6))).squareRoot()      // radians
            return circSD / (2 * .pi) * 1440                        // minutes
        }
        guard bedtimes.count >= 2 else { return 100 }
        let sd = (spreadMinutes(bedtimes) + spreadMinutes(wakeTimes)) / 2
        return Stats.clamp(100 - (sd - 15) * 1.1, 0, 100)
    }

    public static func score(session: SleepSession, need: SleepNeed, consistency: Double) -> SleepScore {
        let perf = Stats.clamp(Double(session.minutesAsleep) / need.totalMin * 100, 0, 100)
        let eff = Stats.clamp(session.efficiency * 100, 0, 100)
        let rest = Stats.clamp(session.restorativeFraction / 0.40 * 100, 0, 100)
        let score = 0.50 * perf + 0.20 * eff + 0.15 * rest + 0.15 * consistency
        return SleepScore(score: score, performance: perf, efficiency: eff, restorative: rest, consistency: consistency)
    }

    /// Recommended bedtime to reach the sleep need given the desired wake time and typical latency.
    public static func recommendedBedtime(wake: Date, need: SleepNeed, typicalEfficiency: Double = 0.9,
                                          latencyMin: Double = 15) -> Date {
        let inBed = need.totalMin / max(0.75, min(0.98, typicalEfficiency)) + latencyMin
        return wake.addingTimeInterval(-inBed * 60)
    }
}

// MARK: - SpO2 (experimental)

public enum SpO2 {
    /// Ratio-of-ratios estimate from the raw red / IR channels. The WHOOP 4 raw fields are not
    /// documented as calibrated SpO2 inputs, so this is an *experimental relative* estimate.
    public static func estimate(_ epochs: [MinuteEpoch]) -> Double? {
        var vals: [Double] = []
        for e in epochs {
            guard let rm = e.redMean, let rs = e.redSD, let im = e.irMean, let isd = e.irSD,
                  rm > 0, im > 0, isd > 0 else { continue }
            let r = (rs / rm) / (isd / im)
            guard r.isFinite, r > 0.2, r < 2 else { continue }
            vals.append(Stats.clamp(110 - 25 * r, 80, 100))
        }
        guard vals.count >= 30 else { return nil }
        return Stats.median(vals)
    }
}
