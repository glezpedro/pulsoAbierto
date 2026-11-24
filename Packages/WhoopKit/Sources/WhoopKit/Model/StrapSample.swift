import Foundation

/// One second of data recorded by the strap (decoded from a type-47 historical record or
/// synthesized from the live heart-rate stream).
public struct StrapSample: Codable, Equatable, Hashable {
    public var ts: Int                // unix seconds (UTC)
    public var bpm: UInt8             // 0 = unknown
    public var rr: [UInt16]           // R-R intervals in ms (0..4 per second)
    public var gravity: SIMD3<Float>? // gravity vector in g (≈1 g magnitude), for motion/posture
    public var skinContact: Bool
    public var skinTempRaw: UInt16    // raw ADC, uncalibrated (use as relative deviation)
    public var red: UInt16            // raw red channel (SpO2-adjacent)
    public var ir: UInt16             // raw infrared channel
    public var ambient: UInt16
    public var respRaw: UInt16
    public var quality: UInt16

    public init(ts: Int, bpm: UInt8, rr: [UInt16] = [], gravity: SIMD3<Float>? = nil, skinContact: Bool = true,
                skinTempRaw: UInt16 = 0, red: UInt16 = 0, ir: UInt16 = 0, ambient: UInt16 = 0,
                respRaw: UInt16 = 0, quality: UInt16 = 0) {
        self.ts = ts; self.bpm = bpm; self.rr = rr; self.gravity = gravity; self.skinContact = skinContact
        self.skinTempRaw = skinTempRaw; self.red = red; self.ir = ir; self.ambient = ambient
        self.respRaw = respRaw; self.quality = quality
    }

    public var date: Date { Date(timeIntervalSince1970: TimeInterval(ts)) }
}

// MARK: - Compact binary encoding (32 bytes per second)

public extension StrapSample {
    static let encodedSize = 32

    /// ts u32 | bpm u8 | flags u8 (bit0 contact, bit1 gravity) | rrCount u8 | pad | rr[4] u16 |
    /// gx gy gz i16 (g * 8192) | skinTemp u16 | red u16 | ir u16 | ambient u16 | resp u16
    func encoded() -> [UInt8] {
        var out = [UInt8]()
        out.reserveCapacity(32)
        out += UInt32(truncatingIfNeeded: ts).leBytes
        out.append(bpm)
        var flags: UInt8 = skinContact ? 1 : 0
        if gravity != nil { flags |= 2 }
        out.append(flags)
        let rrs = Array(rr.prefix(4))
        out.append(UInt8(rrs.count))
        out.append(0)
        for i in 0..<4 { out += (i < rrs.count ? rrs[i] : 0).leBytes }
        let g = gravity ?? SIMD3<Float>(0, 0, 0)
        for c in [g.x, g.y, g.z] {
            let v = Int16(clamping: Int((c * 8192).rounded()))
            out += v.leBytes
        }
        out += skinTempRaw.leBytes
        out += red.leBytes
        out += ir.leBytes
        out += ambient.leBytes
        out += respRaw.leBytes
        return out
    }

    init?(encoded b: [UInt8], offset o: Int = 0) {
        guard b.count >= o + 32, let ts = b.u32(o) else { return nil }
        let flags = b[o + 5]
        let n = min(Int(b[o + 6]), 4)
        var rr: [UInt16] = []
        for i in 0..<n { if let v = b.u16(o + 8 + i * 2) { rr.append(v) } }
        var grav: SIMD3<Float>? = nil
        if flags & 2 != 0, let x = b.i16(o + 16), let y = b.i16(o + 18), let z = b.i16(o + 20) {
            grav = SIMD3<Float>(Float(x) / 8192, Float(y) / 8192, Float(z) / 8192)
        }
        self.init(ts: Int(ts), bpm: b[o + 4], rr: rr, gravity: grav, skinContact: flags & 1 != 0,
                  skinTempRaw: b.u16(o + 22) ?? 0, red: b.u16(o + 24) ?? 0, ir: b.u16(o + 26) ?? 0,
                  ambient: b.u16(o + 28) ?? 0, respRaw: b.u16(o + 30) ?? 0, quality: 0)
    }
}
