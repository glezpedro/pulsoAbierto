import XCTest
@testable import WhoopKit

final class ProtocolTests: XCTestCase {

    /// Real packets captured from a WHOOP 4.0 (bWanShiTong/reverse-engineering-whoop-post).
    let captured = [
        "aa0800a823080e016c935474",                                   // broadcast HR on
        "aa0800a823070e00c7e40f08",                                   // broadcast HR off
        "aa0800a8230e16001147c585",                                   // send historical data
        "aa10005723704201126d6566000000003d59d8fd",                   // set alarm
        "aa1800ff2802ad896566f0654201670600000000000001013ba00d4d",   // realtime HR
        "aa1c00ab311802f65c7066804043000000" + "2e470100040000000000007f873cf3" // metadata END
    ]

    func testCapturedFramesValidate() {
        for h in captured {
            let b = [UInt8](hex: h)!
            XCTAssertNotNil(WhoopFrame(validating: b), h)
        }
    }

    func testBuildMatchesCapture() {
        XCTAssertEqual(WhoopFrame.command(.toggleGenericHRProfile, sequence: 0x08, payload: [0x01]).hex, "aa0800a823080e016c935474")
        XCTAssertEqual(WhoopFrame.command(.sendHistoricalData, sequence: 0x0e, payload: [0x00]).hex, "aa0800a8230e16001147c585")
        // alarm at 0x66656d12 with the 9-byte payload layout
        let alarm = WhoopFrame.command(.setAlarmTime, sequence: 0x70,
                                       payload: WhoopParser.alarmPayload(Date(timeIntervalSince1970: 0x66656d12)))
        XCTAssertEqual(alarm.hex, "aa10005723704201126d6566000000003d59d8fd")
    }

    func testAssemblerHandlesFragmentsAndGarbage() {
        let a = [UInt8](hex: captured[4])!, b = [UInt8](hex: captured[5])!
        let stream: [UInt8] = [0x00, 0x13] + a + b
        let asm = FrameAssembler()
        var frames: [WhoopFrame] = []
        var i = 0
        while i < stream.count {
            let n = min(7, stream.count - i)
            frames += asm.push(Array(stream[i..<(i + n)]))
            i += n
        }
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(frames[0].type, .realtimeData)
        XCTAssertEqual(frames[1].type, .metadata)
    }

    func testMetadataEndParsing() {
        let f = WhoopFrame(validating: [UInt8](hex: captured[5])!)!
        guard case .metadata(let m) = WhoopParser.parse(f) else { return XCTFail() }
        XCTAssertEqual(m.type, .historyEnd)
        XCTAssertEqual(m.trimCursor, 0x0001472E)
        XCTAssertEqual(m.ackBlock?.hex, "2e47010004000000")
        let ack = WhoopFrame.command(.historicalDataResult, sequence: 1, payload: WhoopParser.historyAckPayload(m.ackBlock!))
        XCTAssertNotNil(WhoopFrame(validating: ack))
        XCTAssertEqual(ack.count, 4 + 3 + 9 + 4)
    }

    func testRealtimeParsing() {
        let f = WhoopFrame(validating: [UInt8](hex: captured[4])!)!
        guard case .realtime(let r) = WhoopParser.parse(f) else { return XCTFail() }
        XCTAssertEqual(r.bpm, 66)
        XCTAssertEqual(r.unix, 0x666589ad)
    }

    func testV24HistoryRecord() {
        // Build a synthetic 96-byte v24 record and check field extraction
        var inner = [UInt8](repeating: 0, count: 88) // type..payload (L = 92)
        inner[0] = 47; inner[1] = 0x0c; inner[2] = 0x07
        func put(_ bytes: [UInt8], at frameOffset: Int) { for (i, b) in bytes.enumerated() { inner[frameOffset - 4 + i] = b } }
        put(UInt32(1_716_000_000).leBytes, at: 11)
        put([88, 2], at: 21)
        put(UInt16(696).leBytes + UInt16(697).leBytes, at: 23)
        put(Float(0.1).bitPattern.leBytes + Float(0.2).bitPattern.leBytes + Float(0.97).bitPattern.leBytes, at: 40)
        put([1], at: 55)
        put(UInt16(3300).leBytes, at: 72)
        let frame = WhoopFrame.build(type: inner[0], sequence: inner[1], subtype: inner[2], payload: Array(inner[3...]))
        XCTAssertEqual(frame.count, 96)
        let f = WhoopFrame(validating: frame)!
        guard case .history(let s?, _) = WhoopParser.parse(f) else { return XCTFail() }
        XCTAssertEqual(s.ts, 1_716_000_000)
        XCTAssertEqual(s.bpm, 88)
        XCTAssertEqual(s.rr, [696, 697])
        XCTAssertEqual(s.skinTempRaw, 3300)
        XCTAssertNotNil(s.gravity)
        XCTAssertTrue(s.skinContact)
    }

    func testLayoutDetectorFindsShiftedHR() {
        // 84-byte frames with HR at offset 30 instead of 21
        var frames: [[UInt8]] = []
        for i in 0..<120 {
            var b = [UInt8](repeating: 0, count: 84)
            for (k, v) in UInt32(1_716_000_000 + i).leBytes.enumerated() { b[11 + k] = v }
            let hr = UInt8(60 + (i % 10))
            b[30] = hr; b[31] = 1
            for (k, v) in UInt16(60000 / Int(hr)).leBytes.enumerated() { b[32 + k] = v }
            b[20] = UInt8.random(in: 0...255)
            frames.append(b)
        }
        let r = HistoryLayoutDetector.detect(frames)
        XCTAssertEqual(r.tsOffset, 11)
        XCTAssertEqual(r.hrOffset, 30)
    }

    func testStandardHeartRate() {
        // flags 0x10 (RR present), 8-bit HR 72, RR 853/1024 s
        let v: [UInt8] = [0x10, 72, 0x55, 0x03]
        let r = StandardHeartRate.parse(v)!
        XCTAssertEqual(r.bpm, 72)
        XCTAssertEqual(r.rr, [833])
    }

    func testSampleEncodingRoundTrip() {
        let s = StrapSample(ts: 1_716_000_123, bpm: 61, rr: [980, 990, 1001], gravity: SIMD3(0.1, -0.2, 0.97),
                            skinContact: true, skinTempRaw: 3312, red: 30000, ir: 31000, ambient: 4, respRaw: 9)
        let d = StrapSample(encoded: s.encoded())!
        XCTAssertEqual(d.ts, s.ts); XCTAssertEqual(d.bpm, 61); XCTAssertEqual(d.rr, [980, 990, 1001])
        XCTAssertEqual(d.skinTempRaw, 3312)
        XCTAssertEqual(Double(d.gravity!.z), 0.97, accuracy: 0.001)
    }
}
