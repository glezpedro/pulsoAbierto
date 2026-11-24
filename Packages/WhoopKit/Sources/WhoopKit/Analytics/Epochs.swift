import Foundation

/// One-minute aggregate of strap samples. Most analytics run on epochs instead of raw seconds.
public struct MinuteEpoch: Codable, Equatable {
    public var ts: Int                 // start of the minute (unix s)
    public var hr: Double?             // mean of valid seconds
    public var hrMin: Double?
    public var hrMax: Double?
    public var rr: [Double]            // all R-R intervals (ms) in the minute, in order
    public var motion: Double?         // summed gravity-vector angle change (degrees / min)
    public var contact: Double         // fraction of seconds with skin contact
    public var seconds: Int            // samples present
    public var skinTemp: Double?       // mean raw ADC
    public var redMean: Double?, redSD: Double?, irMean: Double?, irSD: Double?

    public var hasData: Bool { contact >= 0.5 && hr != nil }
}

public enum Epochs {
    public static var noiseFloorDegrees = 0.6

    /// Aggregates samples (any order) into minute epochs. Minutes without samples are omitted.
    public static func build(_ samples: [StrapSample]) -> [MinuteEpoch] {
        guard !samples.isEmpty else { return [] }
        let sorted = samples.sorted { $0.ts < $1.ts }
        var out: [MinuteEpoch] = []
        var i = 0
        var prevG: SIMD3<Float>? = nil
        while i < sorted.count {
            let minute = sorted[i].ts - ((sorted[i].ts % 60) + 60) % 60
            var hrs: [Double] = [], rr: [Double] = [], temps: [Double] = []
            var reds: [Double] = [], irs: [Double] = []
            var motion = 0.0, hasMotion = false, contactN = 0, n = 0
            while i < sorted.count && sorted[i].ts < minute + 60 {
                let s = sorted[i]
                n += 1
                if s.skinContact { contactN += 1 }
                if s.bpm >= 30 && s.bpm <= 230 && s.skinContact { hrs.append(Double(s.bpm)) }
                if s.skinContact { rr.append(contentsOf: s.rr.map(Double.init)) }
                if s.skinTempRaw > 0 && s.skinContact { temps.append(Double(s.skinTempRaw)) }
                if s.red > 0 && s.ir > 0 && s.skinContact { reds.append(Double(s.red)); irs.append(Double(s.ir)) }
                if let g = s.gravity {
                    // ignore sub-degree jitter (sensor noise) so a still wrist reads ≈ 0
                    if let p = prevG { motion += max(0, angleDegrees(p, g) - noiseFloorDegrees); hasMotion = true }
                    prevG = g
                }
                i += 1
            }
            out.append(MinuteEpoch(ts: minute, hr: Stats.mean(hrs), hrMin: hrs.min(), hrMax: hrs.max(), rr: rr,
                                   motion: hasMotion ? motion : nil,
                                   contact: n > 0 ? Double(contactN) / Double(n) : 0, seconds: n,
                                   skinTemp: Stats.median(temps),
                                   redMean: Stats.mean(reds), redSD: Stats.sd(reds),
                                   irMean: Stats.mean(irs), irSD: Stats.sd(irs)))
        }
        return out
    }

    static func angleDegrees(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Double {
        let ma = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
        let mb = (b.x * b.x + b.y * b.y + b.z * b.z).squareRoot()
        guard ma > 0, mb > 0 else { return 0 }
        let c = Double((a.x * b.x + a.y * b.y + a.z * b.z) / (ma * mb))
        return acos(Stats.clamp(c, -1, 1)) * 180 / .pi
    }
}
