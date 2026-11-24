import Foundation

/// How to read a type-47 historical record.
public enum HistoryLayout: Equatable {
    /// Pick automatically from the frame length (96-byte "v24" frames use the documented layout,
    /// anything else goes through the heuristic offset detector).
    case auto
    /// Documented 96-byte layout (firmware 41.17.x, "v24").
    case v24
    /// Heart rate at `hrOffset`, R-R count at `hrOffset+1`, R-R values right after.
    case custom(tsOffset: Int, hrOffset: Int)
}

public enum HistoryDecoder {

    /// Decodes one record. Returns nil when the record carries no usable timestamp.
    public static func decode(_ b: [UInt8], layout: HistoryLayout = .auto) -> StrapSample? {
        switch layout {
        case .v24: return decodeV24(b)
        case .custom(let ts, let hr): return decodeGeneric(b, tsOffset: ts, hrOffset: hr)
        case .auto:
            if b.count == 96 { return decodeV24(b) }
            return decodeGeneric(b, tsOffset: 11, hrOffset: 21)
        }
    }

    /// Decodes a whole HISTORY_START..END chunk, auto-detecting the heart-rate offset for frame
    /// sizes whose layout is not documented (e.g. the 84-byte "v25" layout on newer firmware).
    public static func decodeChunk(_ frames: [[UInt8]]) -> (samples: [StrapSample], layoutNote: String) {
        var out: [StrapSample] = []
        var notes: [String] = []
        let groups = Dictionary(grouping: frames, by: { $0.count })
        for (size, group) in groups {
            if size == 96 {
                out += group.compactMap(decodeV24)
                notes.append("v24×\(group.count)")
            } else {
                let det = HistoryLayoutDetector.detect(group)
                out += group.compactMap { decodeGeneric($0, tsOffset: det.tsOffset, hrOffset: det.hrOffset) }
                notes.append("len\(size)×\(group.count) hr@\(det.hrOffset.map(String.init) ?? "?") conf \(String(format: "%.2f", det.confidence))")
            }
        }
        out.sort { $0.ts < $1.ts }
        return (out, notes.joined(separator: ", "))
    }

    static func decodeV24(_ b: [UInt8]) -> StrapSample? {
        guard let ts = b.u32(11), ts > 1_000_000_000 else { return nil }
        let hr = b.u8(21) ?? 0
        let n = min(Int(b.u8(22) ?? 0), 4)
        var rr: [UInt16] = []
        for i in 0..<n {
            if let v = b.u16(23 + 2 * i), v >= 250, v <= 2500 { rr.append(v) }
        }
        var grav: SIMD3<Float>? = nil
        if let x = b.f32(40), let y = b.f32(44), let z = b.f32(48), x.isFinite, y.isFinite, z.isFinite {
            let m = (x * x + y * y + z * z).squareRoot()
            if m > 0.3 && m < 3 { grav = SIMD3(x, y, z) }
        }
        let contactByte = b.u8(55) ?? 1
        return StrapSample(ts: Int(ts), bpm: hr, rr: rr, gravity: grav,
                           skinContact: contactByte != 0 && hr > 0,
                           skinTempRaw: b.u16(72) ?? 0, red: b.u16(68) ?? 0, ir: b.u16(70) ?? 0,
                           ambient: b.u16(74) ?? 0, respRaw: b.u16(80) ?? 0, quality: b.u16(82) ?? 0)
    }

    static func decodeGeneric(_ b: [UInt8], tsOffset: Int, hrOffset: Int?) -> StrapSample? {
        guard let ts = b.u32(tsOffset), ts > 1_000_000_000 else { return nil }
        var hr: UInt8 = 0
        var rr: [UInt16] = []
        if let o = hrOffset {
            hr = b.u8(o) ?? 0
            let n = min(Int(b.u8(o + 1) ?? 0), 4)
            for i in 0..<n {
                if let v = b.u16(o + 2 + 2 * i), v >= 250, v <= 2500 { rr.append(v) }
            }
        }
        // v25: signed movement words at 73/75/77 interpreted as gravity / 16384 (unconfirmed)
        var grav: SIMD3<Float>? = nil
        if b.count >= 84, let x = b.i16(73), let y = b.i16(75), let z = b.i16(77) {
            let g = SIMD3<Float>(Float(x) / 16384, Float(y) / 16384, Float(z) / 16384)
            let m = (g.x * g.x + g.y * g.y + g.z * g.z).squareRoot()
            if m > 0.3 && m < 3 { grav = g }
        }
        return StrapSample(ts: Int(ts), bpm: hr, rr: rr, gravity: grav, skinContact: hr > 0)
    }
}

/// Finds which byte offset holds the per-second heart rate in an undocumented record layout.
///
/// For every candidate offset k we score how often the record looks like
/// `[HR in 30...220][count 0...4][count × R-R u16]` with R-R values consistent with HR
/// (60000 / mean(RR) ≈ HR) and with smooth second-to-second HR changes.
public enum HistoryLayoutDetector {
    public struct Result { public let tsOffset: Int; public let hrOffset: Int?; public let confidence: Double }

    public static func detect(_ frames: [[UInt8]]) -> Result {
        guard let minLen = frames.map(\.count).min(), minLen > 20, !frames.isEmpty else {
            return Result(tsOffset: 11, hrOffset: nil, confidence: 0)
        }
        // Timestamp offset: the u32 that is a plausible unix time and increases by ~1 s per record.
        var tsOffset = 11
        var bestTs = -1.0
        for o in 6..<min(20, minLen - 4) {
            let vals = frames.compactMap { $0.u32(o) }.map(Double.init)
            let plausible = vals.filter { $0 > 1_500_000_000 && $0 < 2_500_000_000 }.count
            var mono = 0
            for i in 1..<max(1, vals.count) where vals[i] >= vals[i - 1] && vals[i] - vals[i - 1] < 120 { mono += 1 }
            let s = Double(plausible) + Double(mono)
            if s > bestTs { bestTs = s; tsOffset = o }
        }
        var bestOffset: Int? = nil
        var bestScore = 0.0
        for k in 12..<(minLen - 6) where k < tsOffset || k >= tsOffset + 4 {
            var score = 0.0
            var prevHR: Int? = nil
            for f in frames {
                let hr = Int(f[k]), n = Int(f[k + 1])
                guard hr >= 30, hr <= 220, n <= 4 else { prevHR = nil; continue }
                var s = 0.3
                if n > 0 {
                    let rrs = (0..<n).compactMap { f.u16(k + 2 + 2 * $0) }.map(Double.init)
                    let valid = rrs.filter { $0 >= 250 && $0 <= 2500 }
                    if valid.count == n, !valid.isEmpty {
                        let implied = 60000.0 / (valid.reduce(0, +) / Double(valid.count))
                        if abs(implied - Double(hr)) / Double(hr) < 0.2 { s += 1.0 } else { s -= 0.3 }
                    } else { s -= 0.5 }
                }
                if let p = prevHR, abs(p - hr) <= 8 { s += 0.3 }
                prevHR = hr
                score += s
            }
            if score > bestScore { bestScore = score; bestOffset = k }
        }
        let conf = frames.isEmpty ? 0 : min(1, bestScore / (1.6 * Double(frames.count)))
        return Result(tsOffset: tsOffset, hrOffset: conf > 0.35 ? bestOffset : nil, confidence: conf)
    }
}
