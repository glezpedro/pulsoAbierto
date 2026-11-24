import Foundation

/// Heart-rate zones as % of HRmax (zone 0 = below 50 %).
public enum HRZone: Int, Codable, CaseIterable {
    case z0 = 0, z1, z2, z3, z4, z5
    public static func of(bpm: Double, hrMax: Double) -> HRZone {
        let p = bpm / hrMax
        switch p {
        case ..<0.5: return .z0
        case ..<0.6: return .z1
        case ..<0.7: return .z2
        case ..<0.8: return .z3
        case ..<0.9: return .z4
        default: return .z5
        }
    }
    public var label: String { self == .z0 ? "Reposo" : "Z\(rawValue)" }
    public var spanish: String {
        switch self {
        case .z0: return "Reposo (<50 %)"
        case .z1: return "Z1 Muy suave (50–60 %)"
        case .z2: return "Z2 Aeróbica base (60–70 %)"
        case .z3: return "Z3 Tempo (70–80 %)"
        case .z4: return "Z4 Umbral (80–90 %)"
        case .z5: return "Z5 Máximo (90–100 %)"
        }
    }
}

public struct StrainResult: Codable, Equatable {
    public var strain: Double              // 0–21
    public var load: Double                // cardiovascular load (faded Banister TRIMP)
    public var zoneSeconds: [Int]          // index = HRZone.rawValue
    public var kcal: Double                // active + resting energy for covered seconds
    public var activeKcal: Double
    public var avgHR: Double?
    public var maxHR: Double?
    public var coveredSeconds: Int
}

public enum Strain {
    /// Load → strain mapping constant. 21·(1−e^(−load/k)); k=90 puts a 1 h session at ~70 % HRR
    /// around 14–15 and makes 21 asymptotically unreachable, like WHOOP's scale.
    public static var k = 90.0

    public static func strain(fromLoad load: Double) -> Double {
        21 * (1 - exp(-max(0, load) / k))
    }

    public static func load(fromStrain strain: Double) -> Double {
        let s = Stats.clamp(strain, 0, 20.99)
        return -k * log(1 - s / 21)
    }

    /// Computes strain, zones and calories over a set of per-second samples.
    public static func compute(_ samples: [StrapSample], profile: PhysioProfile, restingHR: Double) -> StrainResult {
        let hrMax = profile.hrMax
        let reserve = max(20, hrMax - restingHR)
        var load = 0.0
        var zones = [Int](repeating: 0, count: 6)
        var kcal = 0.0, active = 0.0
        var sum = 0.0, n = 0
        var mx = 0.0
        let bmrPerSec = profile.bmr / 86400
        let sorted = samples.sorted { $0.ts < $1.ts }
        var prevTs: Int? = nil
        for s in sorted where s.skinContact && s.bpm >= 30 {
            // each sample represents the time since the previous one (max 5 s to bridge drops)
            let dt = Double(min(5, max(1, s.ts - (prevTs ?? (s.ts - 1)))))
            prevTs = s.ts
            let hr = Double(s.bpm)
            sum += hr * dt; n += Int(dt)
            mx = max(mx, hr)
            zones[HRZone.of(bpm: hr, hrMax: hrMax).rawValue] += Int(dt)
            let hrr = Stats.clamp((hr - restingHR) / reserve, 0, 1.2)
            if hrr > 0.1 {
                // Banister TRIMP weighting, faded in between 10 % and 30 % HRR so that daily
                // life contributes a little (sedentary day ≈ 3–5) without dominating the scale.
                let b = profile.sex == .male ? 0.64 * exp(1.92 * hrr) : 0.86 * exp(1.67 * hrr)
                let fade = pow(Stats.clamp((hrr - 0.1) / 0.2, 0, 1), 2)
                load += hrr * b * fade * dt / 60
            }
            let kc = Calories.perSecond(hr: hr, hrr: hrr, profile: profile)
            kcal += kc * dt
            active += max(0, kc - bmrPerSec * 1.1) * dt
        }
        return StrainResult(strain: strain(fromLoad: load), load: load, zoneSeconds: zones, kcal: kcal,
                            activeKcal: active, avgHR: n > 0 ? sum / Double(n) : nil, maxHR: mx > 0 ? mx : nil,
                            coveredSeconds: n)
    }

    /// Recommended strain range for today from recovery and training load (acute:chronic ratio).
    public static func target(recovery: Double?, acwr: Double?) -> ClosedRange<Double> {
        var range: ClosedRange<Double>
        switch recovery ?? 50 {
        case 67...: range = 14...18
        case 34..<67: range = 10...14
        default: range = 4...10
        }
        if let a = acwr {
            if a > 1.5 { range = max(2, range.lowerBound - 3)...max(6, range.upperBound - 3) }
            else if a > 1.3 { range = max(2, range.lowerBound - 1.5)...max(6, range.upperBound - 1.5) }
            else if a < 0.8, (recovery ?? 50) >= 50 { range = range.lowerBound + 1...min(20, range.upperBound + 1) }
        }
        return range
    }
}

public enum Calories {
    /// Energy expenditure (kcal/s). Above ~30 % HRR uses Keytel et al. (2005) HR equations;
    /// below, resting metabolism with a light NEAT factor.
    public static func perSecond(hr: Double, hrr: Double, profile: PhysioProfile) -> Double {
        let rest = profile.bmr / 86400 * 1.15
        guard hrr >= 0.3 else { return rest }
        let w = profile.weightKg, a = Double(profile.age)
        let kcalMin: Double
        if profile.sex == .male {
            kcalMin = (-55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * a) / 4.184
        } else {
            kcalMin = (-20.4022 + 0.4472 * hr - 0.1263 * w + 0.074 * a) / 4.184
        }
        return max(rest, kcalMin / 60)
    }
}

// MARK: - Workout auto-detection

public struct DetectedActivity: Codable, Equatable {
    public var start: Int
    public var end: Int
    public var avgHR: Double
    public var maxHR: Double
    public var durationMin: Int { (end - start) / 60 }
}

public enum ActivityDetector {
    /// Finds sustained elevated-HR periods (≥ `minHRR` heart-rate reserve for ≥ `minMinutes`),
    /// bridging gaps of up to 3 minutes. Sleep periods are excluded by the caller.
    public static func detect(_ epochs: [MinuteEpoch], restingHR: Double, hrMax: Double,
                              minHRR: Double = 0.40, minMinutes: Int = 10) -> [DetectedActivity] {
        let threshold = restingHR + minHRR * (hrMax - restingHR)
        let active = epochs.filter { ($0.hr ?? 0) >= threshold && $0.hasData }.sorted { $0.ts < $1.ts }
        var out: [DetectedActivity] = []
        var cur: [MinuteEpoch] = []
        func flush() {
            guard let f = cur.first, let l = cur.last else { return }
            let dur = (l.ts - f.ts) / 60 + 1
            if dur >= minMinutes {
                let hrs = cur.compactMap(\.hr)
                out.append(DetectedActivity(start: f.ts, end: l.ts + 60, avgHR: Stats.mean(hrs) ?? 0,
                                            maxHR: cur.compactMap(\.hrMax).max() ?? (hrs.max() ?? 0)))
            }
            cur.removeAll()
        }
        for e in active {
            if let l = cur.last, e.ts - l.ts > 4 * 60 { flush() }
            cur.append(e)
        }
        flush()
        return out
    }
}
