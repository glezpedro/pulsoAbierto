import Foundation

/// Generates realistic synthetic strap data. Used for tests and for the in-app demo mode, so the
/// whole app can be explored before the strap arrives.
public struct SyntheticGenerator {
    private var rng: SplitMix

    public init(seed: UInt64 = 42) { rng = SplitMix(seed: seed) }

    public struct DayPlan {
        public var bedtime: Int          // unix s
        public var wake: Int
        public var restingHR: Double
        public var rmssd: Double
        public var workout: (start: Int, minutes: Int, intensity: Double)?   // intensity = HRR fraction
        public init(bedtime: Int, wake: Int, restingHR: Double, rmssd: Double, workout: (start: Int, minutes: Int, intensity: Double)?) {
            self.bedtime = bedtime; self.wake = wake; self.restingHR = restingHR; self.rmssd = rmssd; self.workout = workout
        }
    }

    /// Generates per-second samples in [from, to).
    public mutating func samples(from: Int, to: Int, plan: DayPlan, hrMax: Double = 190) -> [StrapSample] {
        var out: [StrapSample] = []
        out.reserveCapacity(max(0, to - from))
        var g = SIMD3<Float>(0, 0, 1)
        var lastRR = 60000 / plan.restingHR
        var phase = 0.0
        let breathHz = 0.24 // 14.4 breaths/min
        for t in from..<to {
            let asleep = t >= plan.bedtime && t < plan.wake
            let sleepProgress = asleep ? Double(t - plan.bedtime) / Double(max(1, plan.wake - plan.bedtime)) : 0
            var targetHR: Double
            var motionAmp: Float
            var variability = plan.rmssd
            if asleep {
                // 90-minute cycles: deeper (lower HR) early in the night, REM bursts later
                let cycle = (Double(t - plan.bedtime).truncatingRemainder(dividingBy: 5400)) / 5400
                let deepness = cos(cycle * 2 * .pi) * (1 - sleepProgress) // >0 deep
                let rem = cycle > 0.75 && sleepProgress > 0.25
                targetHR = plan.restingHR + 4 - 4 * deepness + (rem ? 6 : 0)
                variability = plan.rmssd * (deepness > 0.3 ? 1.25 : (rem ? 0.7 : 1))
                motionAmp = rem ? 0.0005 : (rng.unit() < 0.002 ? 0.3 : 0.0008)
            } else {
                let hour = Double(((t % 86400) + 86400) % 86400) / 3600
                targetHR = plan.restingHR + 18 + 6 * sin(hour / 24 * 2 * .pi)
                motionAmp = 0.05
                variability = plan.rmssd * 0.55
                if let w = plan.workout, t >= w.start, t < w.start + w.minutes * 60 {
                    let warm = min(1, Double(t - w.start) / 300)
                    targetHR = plan.restingHR + warm * w.intensity * (hrMax - plan.restingHR)
                    motionAmp = 0.25
                    variability = 8
                }
            }
            // R-R generation with RSA modulation
            var rrs: [UInt16] = []
            var elapsed = 0.0
            while elapsed < 1000 {
                phase += 2 * .pi * breathHz * lastRR / 1000
                let base = 60000 / targetHR
                let rr = base + variability * 1.1 * sin(phase) + rng.normal() * variability * 0.5
                lastRR = 0.7 * lastRR + 0.3 * rr
                elapsed += lastRR
                if rrs.count < 4 { rrs.append(UInt16(clamping: Int(lastRR.rounded()))) }
            }
            let bpm = UInt8(clamping: Int((60000 / lastRR).rounded()))
            // gravity random walk
            let d = SIMD3<Float>(Float(rng.normal()), Float(rng.normal()), Float(rng.normal())) * motionAmp
            g += d
            let mag = (g.x * g.x + g.y * g.y + g.z * g.z).squareRoot()
            g /= max(mag, 0.001)
            let temp = UInt16(clamping: Int(3300 + (asleep ? 40 : 0) + rng.normal() * 3))
            let red = UInt16(clamping: Int(30000 + 300 * sin(phase * 3) + rng.normal() * 30))
            let ir = UInt16(clamping: Int(32000 + 420 * sin(phase * 3) + rng.normal() * 30))
            out.append(StrapSample(ts: t, bpm: bpm, rr: rrs, gravity: g, skinContact: true,
                                   skinTempRaw: temp, red: red, ir: ir))
        }
        return out
    }

    public mutating func unit() -> Double { rng.unit() }
    public mutating func normal() -> Double { rng.normal() }
}

struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
    mutating func normal() -> Double {
        let u1 = max(unit(), 1e-12), u2 = unit()
        return (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
    }
}
