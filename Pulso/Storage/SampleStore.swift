import Foundation
import WhoopKit

/// Stores per-second strap samples in compact binary day files (32 bytes / sample, ≈2.7 MB / day)
/// under Application Support/samples/<utc-day>.bin. Much faster and smaller than a database for
/// ~86 400 rows per day.
actor SampleStore {
    static let shared = SampleStore()

    private let dir: URL
    private var cache: [Int: [StrapSample]] = [:]
    private var cacheOrder: [Int] = []

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("samples", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir
        var values = URLResourceValues()
        values.isExcludedFromBackup = false
        try? url.setResourceValues(values)
    }

    private func file(_ day: Int) -> URL { dir.appendingPathComponent("\(day).bin") }

    /// Appends samples; returns the affected time range.
    @discardableResult
    func append(_ samples: [StrapSample]) throws -> ClosedRange<Int>? {
        guard let minTs = samples.map(\.ts).min(), let maxTs = samples.map(\.ts).max() else { return nil }
        let byDay = Dictionary(grouping: samples) { $0.ts / 86400 }
        for (day, list) in byDay {
            var bytes = [UInt8]()
            bytes.reserveCapacity(list.count * StrapSample.encodedSize)
            for s in list.sorted(by: { $0.ts < $1.ts }) { bytes += s.encoded() }
            let url = file(day)
            if FileManager.default.fileExists(atPath: url.path) {
                let h = try FileHandle(forWritingTo: url)
                try h.seekToEnd()
                try h.write(contentsOf: Data(bytes))
                try h.close()
            } else {
                try Data(bytes).write(to: url, options: .atomic)
            }
            cache[day] = nil
        }
        return minTs...maxTs
    }

    /// Samples in [from, to), sorted and de-duplicated (last write wins).
    func samples(from: Int, to: Int) -> [StrapSample] {
        guard to > from else { return [] }
        var out: [StrapSample] = []
        for day in (from / 86400)...((to - 1) / 86400) {
            out += load(day).filter { $0.ts >= from && $0.ts < to }
        }
        return out
    }

    private func load(_ day: Int) -> [StrapSample] {
        if let c = cache[day] { return c }
        guard let data = try? Data(contentsOf: file(day)) else { return [] }
        let b = [UInt8](data)
        var dict: [Int: StrapSample] = [:]
        dict.reserveCapacity(b.count / 32)
        var o = 0
        while o + 32 <= b.count {
            if let s = StrapSample(encoded: b, offset: o) {
                // prefer records that carry heart rate
                if let existing = dict[s.ts], existing.bpm > 0, s.bpm == 0 { } else { dict[s.ts] = s }
            }
            o += 32
        }
        let sorted = dict.values.sorted { $0.ts < $1.ts }
        cache[day] = sorted
        cacheOrder.append(day)
        if cacheOrder.count > 4 { let old = cacheOrder.removeFirst(); if old != day { cache[old] = nil } }
        return sorted
    }

    /// Rewrites a day file without duplicates (run occasionally).
    func compact(day: Int) throws {
        let s = load(day)
        var bytes = [UInt8]()
        for x in s { bytes += x.encoded() }
        try Data(bytes).write(to: file(day), options: .atomic)
    }

    func availableDays() -> [Int] {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return files.compactMap { Int($0.replacingOccurrences(of: ".bin", with: "")) }.sorted()
    }

    func latestTimestamp() -> Int? {
        guard let last = availableDays().last else { return nil }
        return load(last).last?.ts
    }

    func earliestTimestamp() -> Int? {
        guard let first = availableDays().first else { return nil }
        return load(first).first?.ts
    }

    func totalBytes() -> Int {
        availableDays().reduce(0) { acc, d in
            acc + ((try? FileManager.default.attributesOfItem(atPath: file(d).path)[.size] as? Int) ?? 0)
        }
    }

    func deleteAll() {
        for d in availableDays() { try? FileManager.default.removeItem(at: file(d)) }
        cache.removeAll(); cacheOrder.removeAll()
    }

    /// Writes samples in a range to a CSV file for export.
    func exportCSV(from: Int, to: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pulso-muestras-\(from)-\(to).csv")
        var text = "timestamp,iso,bpm,rr_ms,contact,gx,gy,gz,skin_temp_raw,red,ir\n"
        let iso = ISO8601DateFormatter()
        for s in samples(from: from, to: to) {
            let g = s.gravity
            text += "\(s.ts),\(iso.string(from: s.date)),\(s.bpm),\(s.rr.map(String.init).joined(separator: "|")),\(s.skinContact ? 1 : 0),"
            text += "\(g.map { String(format: "%.3f", $0.x) } ?? ""),\(g.map { String(format: "%.3f", $0.y) } ?? ""),\(g.map { String(format: "%.3f", $0.z) } ?? ""),"
            text += "\(s.skinTempRaw),\(s.red),\(s.ir)\n"
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
