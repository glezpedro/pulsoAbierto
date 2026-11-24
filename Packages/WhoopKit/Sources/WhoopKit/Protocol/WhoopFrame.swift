import Foundation

/// A validated WHOOP 4.0 frame.
///
/// Layout (all little-endian):
/// ```
/// [0]        0xAA start of frame
/// [1..2]     length L (u16) = number of bytes after the 4-byte header, CRC32 included
/// [3]        CRC-8 of bytes [1..2]
/// [4]        packet type
/// [5]        sequence number
/// [6]        command (type 35/36) or subtype (event code, metadata type...)
/// [7..<L]    payload
/// [L..<L+4]  CRC-32 (zlib) of bytes [4..<L]
/// ```
/// Total frame size = L + 4.
public struct WhoopFrame: Equatable {
    public let bytes: [UInt8]

    public var length: Int { Int(bytes[1]) | (Int(bytes[2]) << 8) }
    public var typeRaw: UInt8 { bytes[4] }
    public var type: PacketType? { PacketType(rawValue: typeRaw) }
    public var sequence: UInt8 { bytes[5] }
    public var subtype: UInt8 { bytes[6] }
    /// Bytes [7..<L] (between the command/subtype byte and the CRC trailer).
    public var payload: [UInt8] { length > 7 ? Array(bytes[7..<length]) : [] }

    public init?(validating raw: [UInt8]) {
        guard raw.count >= 11, raw[0] == 0xAA else { return nil }
        let len = Int(raw[1]) | (Int(raw[2]) << 8)
        guard len >= 7, len + 4 == raw.count else { return nil }
        guard WhoopCRC.crc8([raw[1], raw[2]]) == raw[3] else { return nil }
        let crc = WhoopCRC.crc32(raw[4..<len])
        guard raw.u32(len) == crc else { return nil }
        self.bytes = raw
    }

    /// Builds a frame. `inner` = [type, seq, cmd/subtype] + payload.
    public static func build(type: UInt8, sequence: UInt8, subtype: UInt8, payload: [UInt8]) -> [UInt8] {
        let inner = [type, sequence, subtype] + payload
        let len = inner.count + 4
        let l0 = UInt8(len & 0xFF), l1 = UInt8((len >> 8) & 0xFF)
        var out: [UInt8] = [0xAA, l0, l1, WhoopCRC.crc8([l0, l1])]
        out += inner
        out += WhoopCRC.crc32(inner).leBytes
        return out
    }

    public static func command(_ cmd: WhoopCommand, sequence: UInt8, payload: [UInt8] = [0x00]) -> [UInt8] {
        precondition(!WhoopCommand.forbidden.contains(cmd.rawValue))
        return build(type: PacketType.command.rawValue, sequence: sequence, subtype: cmd.rawValue, payload: payload)
    }
}

/// Re-assembles frames from BLE notifications. Notifications on the data characteristic are
/// fragmented (a 96-byte history record may arrive split across MTU-sized chunks) and several
/// frames can share a notification. Garbage bytes are skipped until the next valid 0xAA header.
public final class FrameAssembler {
    private var buffer: [UInt8] = []
    public private(set) var droppedBytes = 0
    public private(set) var crcFailures = 0
    public let maxFrame = 8192

    public init() {}

    public func reset() { buffer.removeAll(keepingCapacity: true) }

    public func push(_ chunk: [UInt8]) -> [WhoopFrame] {
        buffer.append(contentsOf: chunk)
        var frames: [WhoopFrame] = []
        while true {
            // Resync to SOF
            if let idx = buffer.firstIndex(of: 0xAA) {
                if idx > 0 { droppedBytes += idx; buffer.removeFirst(idx) }
            } else {
                droppedBytes += buffer.count
                buffer.removeAll(keepingCapacity: true)
                break
            }
            guard buffer.count >= 4 else { break }
            let len = Int(buffer[1]) | (Int(buffer[2]) << 8)
            if WhoopCRC.crc8([buffer[1], buffer[2]]) != buffer[3] || len < 7 || len + 4 > maxFrame {
                // false SOF: skip one byte and retry
                buffer.removeFirst(1); droppedBytes += 1
                continue
            }
            let total = len + 4
            guard buffer.count >= total else { break } // wait for more data
            let candidate = Array(buffer[0..<total])
            if let f = WhoopFrame(validating: candidate) {
                frames.append(f)
                buffer.removeFirst(total)
            } else {
                crcFailures += 1
                buffer.removeFirst(1); droppedBytes += 1
            }
        }
        return frames
    }
}
