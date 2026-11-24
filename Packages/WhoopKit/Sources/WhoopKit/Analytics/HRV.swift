import Foundation

/// Heart-rate variability (time domain), following the Task Force (1996) definitions.
public struct HRVResult: Codable, Equatable {
    public var rmssd: Double      // ms
    public var sdnn: Double       // ms
    public var pnn50: Double      // %
    public var meanRR: Double     // ms
    public var lnRMSSD: Double
    public var beats: Int
    public var artifactRate: Double
}

public enum HRV {

    /// Removes physiologically impossible intervals (outside 300–2000 ms) and ectopic beats using
    /// Malik's rule (|RRn − RRn−1| > 20 % of RRn−1).
    public static func clean(_ rr: [Double]) -> (clean: [Double], artifactRate: Double) {
        guard !rr.isEmpty else { return ([], 0) }
        var out: [Double] = []
        out.reserveCapacity(rr.count)
        var last: Double? = nil
        var rejected = 0
        for v in rr {
            guard v >= 300, v <= 2000 else { rejected += 1; continue }
            if let l = last, abs(v - l) > 0.2 * l {
                rejected += 1
                last = v // re-anchor so a genuine HR change is accepted on the next beat
                continue
            }
            out.append(v)
            last = v
        }
        return (out, Double(rejected) / Double(rr.count))
    }

    public static func compute(_ rawRR: [Double]) -> HRVResult? {
        let (rr, art) = clean(rawRR)
        guard rr.count >= 20 else { return nil }
        var sumSq = 0.0, nn50 = 0
        for i in 1..<rr.count {
            let d = rr[i] - rr[i - 1]
            sumSq += d * d
            if abs(d) > 50 { nn50 += 1 }
        }
        let rmssd = (sumSq / Double(rr.count - 1)).squareRoot()
        let sdnn = Stats.sd(rr) ?? 0
        let mean = Stats.mean(rr) ?? 0
        return HRVResult(rmssd: rmssd, sdnn: sdnn, pnn50: 100 * Double(nn50) / Double(rr.count - 1),
                         meanRR: mean, lnRMSSD: log(max(rmssd, 1)), beats: rr.count, artifactRate: art)
    }

    /// RMSSD computed over consecutive windows (default 5 minutes) of samples.
    public static func windowed(_ samples: [StrapSample], windowSeconds: Int = 300) -> [(ts: Int, rmssd: Double)] {
        guard let first = samples.first?.ts else { return [] }
        var out: [(Int, Double)] = []
        var bucket: [Double] = []
        var bucketStart = first
        for s in samples {
            if s.ts - bucketStart >= windowSeconds {
                if let r = compute(bucket) { out.append((bucketStart + windowSeconds / 2, r.rmssd)) }
                bucket.removeAll(keepingCapacity: true)
                bucketStart = s.ts
            }
            bucket.append(contentsOf: s.rr.map(Double.init))
        }
        if let r = compute(bucket) { out.append((bucketStart + windowSeconds / 2, r.rmssd)) }
        return out
    }
}
