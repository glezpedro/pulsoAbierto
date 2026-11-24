import Foundation

/// Respiratory rate from respiratory sinus arrhythmia (RSA): breathing modulates the R-R interval,
/// so the dominant frequency of the R-R tachogram in the 0.1–0.5 Hz band (6–30 breaths/min) is
/// the breathing rate. Works best during quiet sleep.
public enum Respiratory {

    /// Breathing rate (breaths/min) of one window of consecutive R-R intervals, or nil when the
    /// spectrum has no clear peak.
    public static func rate(rr rawRR: [Double], fs: Double = 4) -> Double? {
        let rr = HRV.clean(rawRR).clean
        guard rr.count >= 60 else { return nil }
        // beat times
        var t: [Double] = []
        var acc = 0.0
        for v in rr { acc += v / 1000; t.append(acc) }
        guard let tEnd = t.last, tEnd > 60 else { return nil }
        // resample at fs Hz (linear interpolation)
        var x: [Double] = []
        var j = 0
        var time = t[0]
        while time <= tEnd {
            while j < t.count - 2 && t[j + 1] < time { j += 1 }
            let t0 = t[j], t1 = t[j + 1]
            let f = t1 > t0 ? (time - t0) / (t1 - t0) : 0
            x.append(rr[j] + f * (rr[j + 1] - rr[j]))
            time += 1 / fs
        }
        let n = x.count
        guard n > 64 else { return nil }
        // detrend (linear) + Hann window
        let idx = (0..<n).map(Double.init)
        if let lr = Stats.linearRegression(idx, x) {
            for i in 0..<n { x[i] -= lr.slope * Double(i) + lr.intercept }
        }
        for i in 0..<n { x[i] *= 0.5 - 0.5 * cos(2 * .pi * Double(i) / Double(n - 1)) }
        // direct DFT on the band of interest
        var best = (f: 0.0, p: 0.0)
        var powers: [Double] = []
        var f = 0.1
        while f <= 0.5 {
            var re = 0.0, im = 0.0
            let w = 2 * Double.pi * f / fs
            for i in 0..<n {
                re += x[i] * cos(w * Double(i))
                im -= x[i] * sin(w * Double(i))
            }
            let p = re * re + im * im
            powers.append(p)
            if p > best.p { best = (f, p) }
            f += 0.0025
        }
        guard let med = Stats.median(powers), med > 0, best.p > 2.5 * med else { return nil }
        return best.f * 60
    }

    /// Median breathing rate across 5-minute windows of epochs.
    public static func rate(epochs: [MinuteEpoch], windowMinutes: Int = 5) -> Double? {
        var rates: [Double] = []
        var i = 0
        while i + windowMinutes <= epochs.count {
            let slice = epochs[i..<(i + windowMinutes)]
            // only consecutive minutes
            if let a = slice.first?.ts, let b = slice.last?.ts, b - a == (windowMinutes - 1) * 60 {
                let rr = slice.flatMap(\.rr)
                if let r = rate(rr: rr) { rates.append(r) }
            }
            i += windowMinutes
        }
        guard rates.count >= 2 else { return rates.first }
        return Stats.median(rates)
    }
}
