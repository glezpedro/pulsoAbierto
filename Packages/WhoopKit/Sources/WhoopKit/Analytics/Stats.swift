import Foundation

public enum Stats {
    public static func mean(_ x: [Double]) -> Double? {
        x.isEmpty ? nil : x.reduce(0, +) / Double(x.count)
    }
    public static func sd(_ x: [Double]) -> Double? {
        guard x.count > 1, let m = mean(x) else { return nil }
        let v = x.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(x.count - 1)
        return v.squareRoot()
    }
    public static func median(_ x: [Double]) -> Double? { percentile(x, 50) }
    public static func percentile(_ x: [Double], _ p: Double) -> Double? {
        guard !x.isEmpty else { return nil }
        let s = x.sorted()
        if s.count == 1 { return s[0] }
        let r = (p / 100) * Double(s.count - 1)
        let lo = Int(r.rounded(.down)), hi = Int(r.rounded(.up))
        let f = r - Double(lo)
        return s[lo] * (1 - f) + s[hi] * f
    }
    public static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }
    public static func logistic(_ x: Double) -> Double { 1 / (1 + exp(-x)) }

    /// Pearson correlation coefficient.
    public static func pearson(_ x: [Double], _ y: [Double]) -> Double? {
        let n = min(x.count, y.count)
        guard n >= 3, let mx = mean(Array(x.prefix(n))), let my = mean(Array(y.prefix(n))) else { return nil }
        var sxy = 0.0, sxx = 0.0, syy = 0.0
        for i in 0..<n {
            let dx = x[i] - mx, dy = y[i] - my
            sxy += dx * dy; sxx += dx * dx; syy += dy * dy
        }
        guard sxx > 0, syy > 0 else { return nil }
        return sxy / (sxx * syy).squareRoot()
    }

    /// Ordinary least squares slope/intercept.
    public static func linearRegression(_ x: [Double], _ y: [Double]) -> (slope: Double, intercept: Double)? {
        let n = min(x.count, y.count)
        guard n >= 2, let mx = mean(Array(x.prefix(n))), let my = mean(Array(y.prefix(n))) else { return nil }
        var num = 0.0, den = 0.0
        for i in 0..<n { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) * (x[i] - mx) }
        guard den > 0 else { return nil }
        let slope = num / den
        return (slope, my - slope * mx)
    }

    /// Exponentially weighted moving average with time constant `days`.
    public static func ewma(_ x: [Double], days: Double) -> [Double] {
        guard !x.isEmpty else { return [] }
        let a = 2 / (days + 1)
        var out = [x[0]]
        for i in 1..<x.count { out.append(a * x[i] + (1 - a) * out[i - 1]) }
        return out
    }

    /// Centered moving median for smoothing discrete sequences.
    public static func movingMedian(_ x: [Double], window: Int) -> [Double] {
        guard window > 1, x.count > 2 else { return x }
        let h = window / 2
        return x.indices.map { i in
            let lo = max(0, i - h), hi = min(x.count - 1, i + h)
            return median(Array(x[lo...hi])) ?? x[i]
        }
    }
}
