import Foundation

/// Compact per-day metrics kept forever (baselines, trends, AI context).
public struct DayMetrics: Codable, Equatable, Identifiable {
    public var id: String { dayKey }
    public var dayKey: String               // yyyy-MM-dd (local)
    public var dayStart: Int                // unix s, local midnight
    public var recovery: Double?
    public var strain: Double?
    public var hrv: Double?
    public var rhr: Double?
    public var resp: Double?
    public var skinTemp: Double?            // raw nightly median
    public var spo2: Double?
    public var sleepNeedMin: Double?
    public var sleptMin: Double?
    public var inBedMin: Double?
    public var sleepScore: Double?
    public var sleepPerformance: Double?
    public var deepMin: Double?
    public var remMin: Double?
    public var lightMin: Double?
    public var awakeMin: Double?
    public var bedtime: Int?
    public var wakeTime: Int?
    public var kcal: Double?
    public var activeKcal: Double?
    public var avgStress: Double?
    public var highStressMin: Double?
    public var avgHR: Double?
    public var maxHR: Double?
    public var wearMinutes: Int?
    public var steps: Double?               // from Apple Health
    public var napMin: Double?
    // sleep detail (main sleep)
    public var latencyMin: Double?
    public var wakeups: Int?
    public var wasoMin: Double?
    public var efficiency: Double?          // 0–100
    public var sleepAvgHR: Double?
    public var sleepMinHR: Double?
    public var remCycles: Int?

    public init(dayKey: String, dayStart: Int) { self.dayKey = dayKey; self.dayStart = dayStart }
}

public struct HRBucket: Codable, Equatable {
    public var ts: Int
    public var avg: Double
    public var min: Double
    public var max: Double
}

public struct ActivityReport: Codable, Equatable {
    public var start: Int
    public var end: Int
    public var strain: StrainResult
}

/// Everything computed for one day (stored as JSON; drives the UI).
public struct DayReport: Codable, Equatable {
    public var metrics: DayMetrics
    public var sleep: SleepSession?
    public var naps: [SleepSession]
    public var sleepNeed: SleepNeed?
    public var sleepScore: SleepScore?
    public var recovery: RecoveryResult?
    public var strain: StrainResult?
    public var activities: [ActivityReport]
    public var stress: [StressPoint]        // 5-minute resolution
    public var hrTimeline: [HRBucket]       // 5-minute resolution
    public var strainTarget: ClosedRange<Double>?
    public var nextNightNeed: SleepNeed?
    public var generatedAt: Int

    enum CodingKeys: String, CodingKey {
        case metrics, sleep, naps, sleepNeed, sleepScore, recovery, strain, activities, stress, hrTimeline
        case targetLo, targetHi, nextNightNeed, generatedAt
    }
    public init(metrics: DayMetrics) {
        self.metrics = metrics; self.naps = []; self.activities = []; self.stress = []; self.hrTimeline = []
        self.generatedAt = Int(Date().timeIntervalSince1970)
    }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        metrics = try c.decode(DayMetrics.self, forKey: .metrics)
        sleep = try c.decodeIfPresent(SleepSession.self, forKey: .sleep)
        naps = try c.decodeIfPresent([SleepSession].self, forKey: .naps) ?? []
        sleepNeed = try c.decodeIfPresent(SleepNeed.self, forKey: .sleepNeed)
        sleepScore = try c.decodeIfPresent(SleepScore.self, forKey: .sleepScore)
        recovery = try c.decodeIfPresent(RecoveryResult.self, forKey: .recovery)
        strain = try c.decodeIfPresent(StrainResult.self, forKey: .strain)
        activities = try c.decodeIfPresent([ActivityReport].self, forKey: .activities) ?? []
        stress = try c.decodeIfPresent([StressPoint].self, forKey: .stress) ?? []
        hrTimeline = try c.decodeIfPresent([HRBucket].self, forKey: .hrTimeline) ?? []
        if let lo = try c.decodeIfPresent(Double.self, forKey: .targetLo),
           let hi = try c.decodeIfPresent(Double.self, forKey: .targetHi), lo <= hi { strainTarget = lo...hi }
        nextNightNeed = try c.decodeIfPresent(SleepNeed.self, forKey: .nextNightNeed)
        generatedAt = try c.decodeIfPresent(Int.self, forKey: .generatedAt) ?? 0
    }
    public func encode(to e: Encoder) throws {
        var c = e.container(keyedBy: CodingKeys.self)
        try c.encode(metrics, forKey: .metrics)
        try c.encodeIfPresent(sleep, forKey: .sleep)
        try c.encode(naps, forKey: .naps)
        try c.encodeIfPresent(sleepNeed, forKey: .sleepNeed)
        try c.encodeIfPresent(sleepScore, forKey: .sleepScore)
        try c.encodeIfPresent(recovery, forKey: .recovery)
        try c.encodeIfPresent(strain, forKey: .strain)
        try c.encode(activities, forKey: .activities)
        try c.encode(stress, forKey: .stress)
        try c.encode(hrTimeline, forKey: .hrTimeline)
        try c.encodeIfPresent(strainTarget?.lowerBound, forKey: .targetLo)
        try c.encodeIfPresent(strainTarget?.upperBound, forKey: .targetHi)
        try c.encodeIfPresent(nextNightNeed, forKey: .nextNightNeed)
        try c.encode(generatedAt, forKey: .generatedAt)
    }
}

public enum DayAnalyzer {

    /// - Parameters:
    ///   - samples: strap samples covering at least [dayStart − 8 h, dayEnd].
    ///   - dayStart/dayEnd: local-midnight boundaries of the day (unix s).
    ///   - history: metrics of previous days, most recent first (≥ 30 recommended).
    ///   - now: clamp for "today" (strain so far).
    public static func analyze(samples: [StrapSample], dayKey: String, dayStart: Int, dayEnd: Int,
                               profile: PhysioProfile, history: [DayMetrics], now: Int = Int(Date().timeIntervalSince1970)) -> DayReport {
        var m = DayMetrics(dayKey: dayKey, dayStart: dayStart)
        var report = DayReport(metrics: m)
        let windowStart = dayStart - 8 * 3600
        let windowEnd = min(dayEnd, now)
        let windowSamples = samples.filter { $0.ts >= windowStart && $0.ts < max(windowEnd, dayStart + 18 * 3600) }
        let epochs = Epochs.build(windowSamples)

        // Baseline from the previous 30 days
        let past = Array(history.prefix(30))
        let baseline = Baseline.from(hrv: past.compactMap(\.hrv), rhr: past.compactMap(\.rhr),
                                     resp: past.compactMap(\.resp), temp: past.compactMap(\.skinTemp))

        // ---- Sleep (attributed to the day you wake up)
        let sessions = SleepAnalyzer.detect(epochs)
        let main = sessions.filter { !$0.isNap && $0.end >= dayStart && $0.end <= dayStart + 16 * 3600 }
            .max { $0.minutesAsleep < $1.minutesAsleep }
        // Naps: short sleeps that start after the main sleep and end the same day. A night that begins
        // before midnight ends tomorrow, so it is not a nap of today.
        // The analysis window stops at midnight, so tonight's sleep shows up truncated: a nap must start
        // before 20:00 and finish clear of the window edge.
        let naps = sessions.filter { s in
            s.start >= (main?.end ?? dayStart) && s.end <= dayEnd - 300 && s.start - dayStart < 20 * 3600
                && s != main && s.minutesAsleep >= 15 && (s.isNap || s.minutesAsleep < 150)
        }
        report.sleep = main
        report.naps = naps

        let yesterday = history.first
        let prevNights = history.prefix(3).compactMap { d -> (need: Double, slept: Double)? in
            guard let n = d.sleepNeedMin, let s = d.sleptMin else { return nil }
            return (n, s)
        }
        let need = SleepCoach.need(profile: profile, yesterdayStrain: yesterday?.strain,
                                   previousNights: prevNights, napsMinutes: yesterday?.napMin ?? 0)
        report.sleepNeed = need

        if let s = main {
            let beds = history.prefix(4).compactMap(\.bedtime) + [s.start]
            let wakes = history.prefix(4).compactMap(\.wakeTime) + [s.end]
            let cons = SleepCoach.consistency(bedtimes: beds, wakeTimes: wakes)
            let score = SleepCoach.score(session: s, need: need, consistency: cons)
            report.sleepScore = score
            m.sleepNeedMin = need.totalMin
            m.sleptMin = Double(s.minutesAsleep)
            m.inBedMin = Double(s.minutesInBed)
            m.sleepScore = score.score
            m.sleepPerformance = score.performance
            m.deepMin = Double(s.minutes(.deep)); m.remMin = Double(s.minutes(.rem))
            m.lightMin = Double(s.minutes(.light)); m.awakeMin = Double(s.minutes(.awake))
            m.bedtime = s.start; m.wakeTime = s.end
            m.latencyMin = Double(s.latencyMinutes); m.wakeups = s.disturbances; m.wasoMin = Double(s.wasoMinutes)
            m.efficiency = s.efficiency * 100; m.sleepAvgHR = s.avgHR; m.sleepMinHR = s.minHR; m.remCycles = s.remCycles
            m.hrv = s.hrvRMSSD; m.rhr = s.restingHR; m.resp = s.respiratoryRate
            m.skinTemp = s.skinTempRaw; m.spo2 = s.spo2Estimate

            report.recovery = Recovery.compute(hrv: s.hrvRMSSD, rhr: s.restingHR, resp: s.respiratoryRate,
                                               skinTemp: s.skinTempRaw, sleepPerformance: score.performance,
                                               baseline: baseline)
            m.recovery = report.recovery?.score
        }
        m.napMin = Double(naps.map(\.minutesAsleep).reduce(0, +))

        // ---- Strain & calories for the calendar day
        let rhr = m.rhr ?? baseline.rhrMean ?? 60
        let daySamples = samples.filter { $0.ts >= dayStart && $0.ts < windowEnd }
        if !daySamples.isEmpty {
            let st = Strain.compute(daySamples, profile: profile, restingHR: rhr)
            report.strain = st
            m.strain = st.strain
            // uncovered time counted at resting metabolism
            let elapsed = max(0, windowEnd - dayStart)
            let uncovered = max(0, elapsed - st.coveredSeconds)
            m.kcal = st.kcal + Double(uncovered) * profile.bmr / 86400 * 1.1
            m.activeKcal = st.activeKcal
            m.avgHR = st.avgHR; m.maxHR = st.maxHR
            m.wearMinutes = st.coveredSeconds / 60
        }

        // ---- Activities (exclude sleep)
        let dayEpochs = epochs.filter { $0.ts >= dayStart && $0.ts < windowEnd }
        let sleepRanges = sessions.map { ($0.start, $0.end) }
        let awakeEpochs = dayEpochs.filter { e in !sleepRanges.contains { e.ts >= $0.0 && e.ts < $0.1 } }
        let acts = ActivityDetector.detect(awakeEpochs, restingHR: rhr, hrMax: profile.hrMax)
        report.activities = acts.map { a in
            let s = daySamples.filter { $0.ts >= a.start && $0.ts < a.end }
            return ActivityReport(start: a.start, end: a.end, strain: Strain.compute(s, profile: profile, restingHR: rhr))
        }

        // ---- Stress
        let stress = StressMonitor.compute(awakeEpochs, restingHR: rhr, hrMax: profile.hrMax,
                                           baselineLnRMSSD: baseline.lnHRVMean)
        let calm = stress.filter { !$0.active }
        m.avgStress = Stats.mean(calm.map(\.level))
        m.highStressMin = Double(calm.filter { $0.level >= 2 }.count)
        report.stress = downsample(stress)

        // ---- HR timeline (5 min)
        report.hrTimeline = buckets(dayEpochs)

        // ---- Targets
        let strainSeries = (history.prefix(41).reversed().map { $0.strain ?? 0 }) + [m.strain ?? 0]
        let load = TrainingLoad.summarize(dailyStrain: strainSeries)
        report.strainTarget = Strain.target(recovery: m.recovery, acwr: load.acwr)
        let tonightPrev = [(need.totalMin, m.sleptMin ?? need.totalMin)] + prevNights
        report.nextNightNeed = SleepCoach.need(profile: profile, yesterdayStrain: m.strain,
                                               previousNights: Array(tonightPrev.prefix(3)), napsMinutes: m.napMin ?? 0)
        report.metrics = m
        report.generatedAt = now
        return report
    }

    static func downsample(_ pts: [StressPoint]) -> [StressPoint] {
        let groups = Dictionary(grouping: pts) { $0.ts / 300 }
        return groups.keys.sorted().compactMap { k in
            guard let g = groups[k] else { return nil }
            let active = g.filter(\.active).count > g.count / 2
            return StressPoint(ts: k * 300, level: Stats.mean(g.map(\.level)) ?? 0, active: active)
        }
    }

    static func buckets(_ epochs: [MinuteEpoch]) -> [HRBucket] {
        let groups = Dictionary(grouping: epochs.filter(\.hasData)) { $0.ts / 300 }
        return groups.keys.sorted().compactMap { k in
            guard let g = groups[k] else { return nil }
            let hrs = g.compactMap(\.hr)
            guard let avg = Stats.mean(hrs) else { return nil }
            return HRBucket(ts: k * 300, avg: avg, min: g.compactMap(\.hrMin).min() ?? avg,
                            max: g.compactMap(\.hrMax).max() ?? avg)
        }
    }
}
