import Foundation

/// Personal baseline (rolling mean/SD of past days).
public struct Baseline: Codable, Equatable {
    public var lnHRVMean: Double?, lnHRVSD: Double?
    public var rhrMean: Double?, rhrSD: Double?
    public var respMean: Double?, respSD: Double?
    public var tempMean: Double?, tempSD: Double?
    public var days: Int

    public init(days: Int = 0) { self.days = days }

    /// Builds a baseline from previous days (most recent first is fine), typically the last 30.
    public static func from(hrv: [Double], rhr: [Double], resp: [Double], temp: [Double]) -> Baseline {
        var b = Baseline(days: max(hrv.count, rhr.count))
        let ln = hrv.filter { $0 > 0 }.map { log($0) }
        b.lnHRVMean = Stats.mean(ln); b.lnHRVSD = Stats.sd(ln).map { max($0, 0.08) }
        b.rhrMean = Stats.mean(rhr); b.rhrSD = Stats.sd(rhr).map { max($0, 1.5) }
        b.respMean = Stats.mean(resp); b.respSD = Stats.sd(resp).map { max($0, 0.4) }
        b.tempMean = Stats.mean(temp); b.tempSD = Stats.sd(temp).map { max($0, 1) }
        return b
    }
}

public struct RecoveryResult: Codable, Equatable {
    public var score: Double            // 1–99
    public var zHRV: Double?
    public var zRHR: Double?
    public var zResp: Double?
    public var zTemp: Double?
    public var sleepTerm: Double?
    public var calibrating: Bool        // fewer than 4 baseline days
    public var band: RecoveryBand { RecoveryBand(score) }
}

public enum RecoveryBand: String, Codable {
    case green, yellow, red
    public init(_ score: Double) {
        if score >= 67 { self = .green } else if score >= 34 { self = .yellow } else { self = .red }
    }
    public var spanish: String {
        switch self {
        case .green: return "Verde · listo para rendir"
        case .yellow: return "Amarillo · mantén"
        case .red: return "Rojo · prioriza recuperar"
        }
    }
}

public enum Recovery {
    /// Recovery score: HRV-dominant composite of z-scores against the personal baseline, passed
    /// through a logistic curve (average day ≈ 60 %).
    ///
    /// weights: HRV 0.55 · RHR 0.25 · sleep 0.12 · respiratory deviation 0.04 · skin-temp deviation 0.04
    public static func compute(hrv: Double?, rhr: Double?, resp: Double?, skinTemp: Double?,
                               sleepPerformance: Double?, baseline b: Baseline) -> RecoveryResult? {
        guard hrv != nil || rhr != nil else { return nil }
        let calibrating = b.days < 4

        var zH: Double? = nil, zR: Double? = nil, zRe: Double? = nil, zT: Double? = nil
        if let h = hrv, h > 0, let m = b.lnHRVMean, let sd = b.lnHRVSD { zH = (log(h) - m) / sd }
        if let r = rhr, let m = b.rhrMean, let sd = b.rhrSD { zR = -(r - m) / sd }
        if let re = resp, let m = b.respMean, let sd = b.respSD { zRe = -abs(re - m) / sd + 0.8 }
        if let t = skinTemp, let m = b.tempMean, let sd = b.tempSD { zT = -abs(t - m) / sd + 0.8 }
        let sleepT = sleepPerformance.map { ($0 - 85) / 15 }

        var comp = 0.0, wsum = 0.0
        func add(_ v: Double?, _ w: Double) {
            guard let v else { return }
            comp += w * Stats.clamp(v, -3, 3); wsum += w
        }
        add(zH, 0.55); add(zR, 0.25); add(sleepT, 0.12); add(zRe, 0.04); add(zT, 0.04)

        var score: Double
        if wsum > 0 && !calibrating {
            comp /= wsum
            score = 100 * Stats.logistic(1.5 * comp + 0.4)
        } else {
            // calibrating: population-based fallback from HRV and RHR alone
            var s = 55.0
            if let h = hrv { s += Stats.clamp((log(max(h, 1)) - log(45)) * 35, -30, 30) }
            if let r = rhr { s += Stats.clamp((60 - r) * 1.2, -20, 20) }
            if let p = sleepPerformance { s += (p - 85) * 0.2 }
            score = s
        }
        return RecoveryResult(score: Stats.clamp(score, 1, 99), zHRV: zH, zRHR: zR, zResp: zRe, zTemp: zT,
                              sleepTerm: sleepT, calibrating: calibrating)
    }
}

// MARK: - Stress monitor (0–3)

public struct StressPoint: Codable, Equatable {
    public var ts: Int
    public var level: Double        // 0–3
    public var active: Bool         // motion too high: physical, not psychological load
}

public enum StressMonitor {
    /// Per-minute stress from HR elevation over resting (with low motion) and suppressed HRV.
    public static func compute(_ epochs: [MinuteEpoch], restingHR: Double, hrMax: Double,
                               baselineLnRMSSD: Double?) -> [StressPoint] {
        let reserve = max(20, hrMax - restingHR)
        let motions = epochs.compactMap(\.motion)
        let activeMotion = max(25, (Stats.percentile(motions, 85) ?? 25))
        var out: [StressPoint] = []
        for (i, e) in epochs.enumerated() where e.hasData {
            guard let hr = e.hr else { continue }
            let m = e.motion ?? 0
            if m > activeMotion || (hr - restingHR) / reserve > 0.45 {
                out.append(StressPoint(ts: e.ts, level: 3, active: true)); continue
            }
            let hrComp = Stats.clamp((hr - restingHR) / (0.35 * reserve), 0, 1)
            var hrvComp = 0.0
            if let base = baselineLnRMSSD {
                let lo = max(0, i - 2), hi = min(epochs.count - 1, i + 2)
                let rr = epochs[lo...hi].flatMap(\.rr)
                if let r = HRV.compute(rr) { hrvComp = Stats.clamp((base - r.lnRMSSD) / 0.8, 0, 1) }
            }
            let level = 3 * (0.6 * hrComp + 0.4 * hrvComp)
            out.append(StressPoint(ts: e.ts, level: level, active: false))
        }
        return out
    }
}

// MARK: - Training load

public struct TrainingLoadSummary: Codable, Equatable {
    public var acute: Double         // 7-day EWMA of daily strain-load
    public var chronic: Double       // 28-day EWMA
    public var acwr: Double?         // acute : chronic
    public var monotony: Double?     // Foster: mean / SD of last 7 days
    public var weeklyLoad: Double
    public var status: String
}

public enum TrainingLoad {
    /// - dailyStrain: chronological daily strain values (oldest first, include zeros for rest days).
    public static func summarize(dailyStrain: [Double]) -> TrainingLoadSummary {
        let loads = dailyStrain.map { Strain.load(fromStrain: $0) }
        let acute = Stats.ewma(loads, days: 7).last ?? 0
        let chronic = Stats.ewma(loads, days: 28).last ?? 0
        let last7 = Array(loads.suffix(7))
        let weekly = last7.reduce(0, +)
        var monotony: Double? = nil
        if last7.count >= 5, let m = Stats.mean(last7), let sd = Stats.sd(last7), sd > 0 { monotony = m / sd }
        let acwr = chronic > 5 && loads.count >= 14 ? acute / chronic : nil
        let status: String
        switch acwr {
        case nil: status = "Calibrando (necesita 2 semanas)"
        case let a? where a > 1.5: status = "Sobrecarga: riesgo elevado"
        case let a? where a > 1.3: status = "Carga alta: vigila la recuperación"
        case let a? where a >= 0.8: status = "Zona óptima"
        default: status = "Desentrenamiento: puedes cargar más"
        }
        return TrainingLoadSummary(acute: acute, chronic: chronic, acwr: acwr, monotony: monotony,
                                   weeklyLoad: weekly, status: status)
    }
}
