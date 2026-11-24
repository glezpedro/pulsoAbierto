import Foundation

public struct CommandResponse: Equatable {
    public let command: UInt8
    public let originSequence: UInt8
    public let resultRaw: UInt8
    public let body: [UInt8]
    public var result: CommandResult? { CommandResult(rawValue: resultRaw) }
}

public struct WhoopEvent: Equatable {
    public let codeRaw: UInt8
    public let timestamp: UInt32
    public let frame: [UInt8]
    public var code: WhoopEventCode? { WhoopEventCode(rawValue: codeRaw) }

    /// Battery event (code 3): state of charge %, millivolts, charging flag.
    public var battery: (percent: Double, millivolts: Int, charging: Bool)? {
        guard codeRaw == WhoopEventCode.batteryLevel.rawValue,
              let soc = frame.u16(17) else { return nil }
        let mv = Int(frame.u16(21) ?? 0)
        let charging = (frame.u8(26) ?? 0) & 1 == 1
        return (Double(soc) / 10.0, mv, charging)
    }
}

public struct HistoryMetadata: Equatable {
    public let type: MetadataType?
    public let typeRaw: UInt8
    public let unix: UInt32
    public let trimCursor: UInt32?
    /// The 8 bytes frame[17..<25] that must be echoed verbatim in the HISTORICAL_DATA_RESULT ack.
    public let ackBlock: [UInt8]?
}

public struct RealtimeHR: Equatable {
    public let unix: UInt32
    public let bpm: UInt8
    public let rr: [UInt16]
}

public enum WhoopMessage {
    case response(CommandResponse)
    case event(WhoopEvent)
    case metadata(HistoryMetadata)
    case history(StrapSample?, raw: [UInt8])
    case realtime(RealtimeHR)
    case raw(type: UInt8, length: Int)
    case unknown(WhoopFrame)
}

public enum WhoopParser {

    public static func parse(_ f: WhoopFrame, layout: HistoryLayout = .auto) -> WhoopMessage {
        let b = f.bytes
        switch f.type {
        case .commandResponse?, .puffinCommandResponse?:
            let body = f.length > 9 ? Array(b[9..<f.length]) : []
            return .response(CommandResponse(command: b[6], originSequence: b.u8(7) ?? 0,
                                             resultRaw: b.u8(8) ?? 0, body: body))
        case .event?:
            return .event(WhoopEvent(codeRaw: b[6], timestamp: b.u32(8) ?? 0, frame: b))
        case .metadata?, .puffinMetadata?:
            let unix = b.u32(7) ?? 0
            var trim: UInt32? = nil
            var ack: [UInt8]? = nil
            if b[6] == MetadataType.historyEnd.rawValue, f.length >= 25 {
                trim = b.u32(17)
                ack = Array(b[17..<25])
            } else if b[6] == MetadataType.historyEnd.rawValue, f.length >= 21 {
                trim = b.u32(17)
                ack = Array(b[17..<21]) + [0, 0, 0, 0]
            }
            return .metadata(HistoryMetadata(type: MetadataType(rawValue: b[6]), typeRaw: b[6], unix: unix,
                                             trimCursor: trim, ackBlock: ack))
        case .historicalData?:
            return .history(HistoryDecoder.decode(b, layout: layout), raw: b)
        case .realtimeData?:
            guard let unix = b.u32(6), let bpm = b.u8(12) else { return .unknown(f) }
            let n = Int(b.u8(13) ?? 0)
            var rr: [UInt16] = []
            for i in 0..<min(n, 4) { if let v = b.u16(14 + 2 * i), v > 0 { rr.append(v) } }
            return .realtime(RealtimeHR(unix: unix, bpm: bpm, rr: rr))
        case .realtimeRawData?, .realtimeIMU?, .historicalIMU?, .consoleLogs?:
            return .raw(type: b[4], length: f.length)
        default:
            return .unknown(f)
        }
    }

    // MARK: Response bodies

    public static func batteryPercent(_ r: CommandResponse) -> Double? {
        guard r.command == WhoopCommand.getBatteryLevel.rawValue, let v = r.body.u16(0) else { return nil }
        return Double(v) / 10.0
    }

    /// Serial number from GET_HELLO_HARVARD (10-byte NUL-terminated field at body offset 14).
    public static func serial(fromHello r: CommandResponse) -> String? {
        guard r.command == WhoopCommand.getHelloHarvard.rawValue, r.body.count >= 24 else { return nil }
        let field = r.body[14..<24].prefix { $0 != 0 }
        let s = String(decoding: field, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : s
    }

    public static func advertisingName(_ r: CommandResponse) -> String? {
        guard r.command == WhoopCommand.getAdvertisingName.rawValue else { return nil }
        let printable = r.body.filter { $0 >= 0x20 && $0 < 0x7F }
        let s = String(decoding: printable, as: UTF8.self)
        return s.isEmpty ? nil : s
    }

    /// Firmware versions from REPORT_VERSION_INFO: four "Harvard" (Maxim) and four "Boylston"
    /// (Nordic) u32 words → "a.b.c.d".
    public static func versions(_ r: CommandResponse) -> (harvard: String, boylston: String)? {
        guard r.command == WhoopCommand.reportVersionInfo.rawValue, r.body.count >= 33 else { return nil }
        let h = (0..<4).compactMap { r.body.u32(1 + $0 * 4) }.map(String.init).joined(separator: ".")
        let bo = (0..<4).compactMap { r.body.u32(17 + $0 * 4) }.map(String.init).joined(separator: ".")
        return (h, bo)
    }

    /// GET_CLOCK response layout is not documented for WHOOP 4; search for a plausible unix time.
    public static func clock(_ r: CommandResponse, near now: Date = Date()) -> Date? {
        guard r.command == WhoopCommand.getClock.rawValue else { return nil }
        let nowS = now.timeIntervalSince1970
        for o in 0..<min(6, max(0, r.body.count - 3)) {
            if let v = r.body.u32(o) {
                let d = Double(v)
                if d > 1_500_000_000 && abs(d - nowS) < 5 * 365 * 86400 { return Date(timeIntervalSince1970: d) }
            }
        }
        return nil
    }

    // MARK: Command payloads

    public static func setClockPayload(_ date: Date = Date()) -> [UInt8] {
        UInt32(date.timeIntervalSince1970).leBytes + [0, 0, 0, 0]
    }

    /// SET_ALARM_TIME: [01] + epoch u32 + subseconds u16 + 2 padding bytes (9 bytes).
    public static func alarmPayload(_ date: Date) -> [UInt8] {
        [0x01] + UInt32(date.timeIntervalSince1970).leBytes + [0, 0, 0, 0]
    }

    /// RUN_HAPTICS_PATTERN: [patternId, loops, 0, 0, 0]. 02 03 is a known-good preset.
    public static func hapticsPayload(pattern: UInt8 = 2, loops: UInt8 = 3) -> [UInt8] {
        [pattern, loops, 0, 0, 0]
    }

    /// HISTORICAL_DATA_RESULT ack: [01] + the 8-byte block from HISTORY_END, verbatim.
    public static func historyAckPayload(_ block: [UInt8]) -> [UInt8] {
        [0x01] + Array(block.prefix(8)) + Array(repeating: 0, count: max(0, 8 - block.count))
    }
}

// MARK: - Standard Bluetooth Heart Rate Measurement (0x2A37)

public enum StandardHeartRate {
    /// Parses a Heart Rate Measurement characteristic value. R-R values are returned in ms.
    public static func parse(_ data: [UInt8]) -> (bpm: Int, rr: [UInt16], contact: Bool?)? {
        guard let flags = data.first else { return nil }
        var i = 1
        let bpm: Int
        if flags & 0x01 != 0 {
            guard let v = data.u16(i) else { return nil }
            bpm = Int(v); i += 2
        } else {
            guard let v = data.u8(i) else { return nil }
            bpm = Int(v); i += 1
        }
        var contact: Bool? = nil
        if flags & 0x04 != 0 { contact = flags & 0x02 != 0 }
        if flags & 0x08 != 0 { i += 2 } // energy expended
        var rr: [UInt16] = []
        if flags & 0x10 != 0 {
            while let v = data.u16(i) {
                let ms = (Double(v) * 1000.0 / 1024.0).rounded()
                rr.append(UInt16(clamping: Int(ms)))
                i += 2
            }
        }
        return (bpm, rr, contact)
    }
}
