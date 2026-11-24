import Foundation
import Observation

/// In-memory diagnostics log + optional raw frame capture (exportable) to help decode new firmware.
@Observable
final class BLELog {
    static let shared = BLELog()

    struct Line: Identifiable {
        let id = UUID()
        let date: Date
        let text: String
        let level: Level
    }
    enum Level { case info, tx, rx, warn, error }

    private(set) var lines: [Line] = []
    private var rawFrames: [String] = []
    private let maxLines = 600

    func log(_ text: String, _ level: Level = .info) {
        let l = Line(date: Date(), text: text, level: level)
        if Thread.isMainThread { append(l) } else { DispatchQueue.main.async { self.append(l) } }
    }

    private func append(_ l: Line) {
        lines.append(l)
        if lines.count > maxLines { lines.removeFirst(lines.count - maxLines) }
    }

    func captureRaw(_ hex: String, characteristic: String) {
        guard AppSettings.shared.rawCaptureEnabled else { return }
        rawFrames.append("\(Int(Date().timeIntervalSince1970)),\(characteristic),\(hex)")
        if rawFrames.count > 200_000 { rawFrames.removeFirst(50_000) }
    }

    var rawCount: Int { rawFrames.count }

    func exportRaw() -> URL? {
        guard !rawFrames.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pulso-raw-\(Int(Date().timeIntervalSince1970)).csv")
        let text = "unix,characteristic,hex\n" + rawFrames.joined(separator: "\n")
        try? text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func exportLog() -> URL? {
        let f = ISO8601DateFormatter()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pulso-ble-log.txt")
        let text = lines.map { "\(f.string(from: $0.date)) [\($0.level)] \($0.text)" }.joined(separator: "\n")
        try? text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func clear() { lines.removeAll(); rawFrames.removeAll() }
}
