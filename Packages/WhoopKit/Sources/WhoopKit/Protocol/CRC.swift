import Foundation

/// Checksums used by the WHOOP 4.0 frame format.
///
/// Verified against real captured packets (see Tests/WhoopKitTests/ProtocolTests.swift):
/// - Header byte [3] = CRC-8 (poly 0x07, init 0x00, no reflection) over the two length bytes.
/// - Trailer = standard zlib CRC-32 (reflected poly 0xEDB88320, init/xorout 0xFFFFFFFF)
///   over frame[4 ..< length], written little-endian.
public enum WhoopCRC {

    public static func crc8(_ bytes: [UInt8]) -> UInt8 {
        var crc: UInt8 = 0
        for b in bytes {
            crc ^= b
            for _ in 0..<8 {
                if crc & 0x80 != 0 {
                    crc = (crc << 1) ^ 0x07
                } else {
                    crc <<= 1
                }
            }
        }
        return crc
    }

    private static let table: [UInt32] = {
        (0..<256).map { i -> UInt32 in
            var c = UInt32(i)
            for _ in 0..<8 {
                c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1)
            }
            return c
        }
    }()

    public static func crc32<C: Collection>(_ bytes: C) -> UInt32 where C.Element == UInt8 {
        var crc: UInt32 = 0xFFFF_FFFF
        for b in bytes {
            crc = table[Int((crc ^ UInt32(b)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFF_FFFF
    }
}

// MARK: - Little-endian helpers

public extension Array where Element == UInt8 {
    func u16(_ o: Int) -> UInt16? {
        guard o >= 0, o + 2 <= count else { return nil }
        return UInt16(self[o]) | (UInt16(self[o + 1]) << 8)
    }
    func i16(_ o: Int) -> Int16? {
        guard let v = u16(o) else { return nil }
        return Int16(bitPattern: v)
    }
    func u32(_ o: Int) -> UInt32? {
        guard o >= 0, o + 4 <= count else { return nil }
        return UInt32(self[o]) | (UInt32(self[o + 1]) << 8) | (UInt32(self[o + 2]) << 16) | (UInt32(self[o + 3]) << 24)
    }
    func f32(_ o: Int) -> Float? {
        guard let v = u32(o) else { return nil }
        return Float(bitPattern: v)
    }
    func u8(_ o: Int) -> UInt8? {
        guard o >= 0, o < count else { return nil }
        return self[o]
    }
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

public extension FixedWidthInteger {
    var leBytes: [UInt8] {
        withUnsafeBytes(of: self.littleEndian) { Array($0) }
    }
}

public extension Array where Element == UInt8 {
    init?(hex: String) {
        let clean = hex.replacingOccurrences(of: " ", with: "")
        guard clean.count % 2 == 0 else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(clean.count / 2)
        var idx = clean.startIndex
        while idx < clean.endIndex {
            let next = clean.index(idx, offsetBy: 2)
            guard let b = UInt8(clean[idx..<next], radix: 16) else { return nil }
            out.append(b)
            idx = next
        }
        self = out
    }
}
