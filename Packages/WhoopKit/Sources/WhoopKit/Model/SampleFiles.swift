import Foundation

/// Reads/writes the compact per-day sample files (`<dir>/<utc-day>.bin`, 32 bytes per second) used by
/// both the iOS app and the self-hosted server.
public enum SampleFiles {

    public static func url(_ dir: URL, day: Int) -> URL { dir.appendingPathComponent("\(day).bin") }

    /// Samples in [from, to), sorted and de-duplicated (records with heart rate win).
    public static func read(dir: URL, from: Int, to: Int) -> [StrapSample] {
        guard to > from else { return [] }
        var out: [StrapSample] = []
        for day in (from / 86400)...((to - 1) / 86400) {
            guard let data = try? Data(contentsOf: url(dir, day: day)) else { continue }
            let b = [UInt8](data)
            var dict: [Int: StrapSample] = [:]
            dict.reserveCapacity(b.count / 32)
            var o = 0
            while o + 32 <= b.count {
                if let s = StrapSample(encoded: b, offset: o), s.ts >= from, s.ts < to {
                    if let e = dict[s.ts], e.bpm > 0, s.bpm == 0 {} else { dict[s.ts] = s }
                }
                o += 32
            }
            out += dict.values.sorted { $0.ts < $1.ts }
        }
        return out
    }

    public static func append(dir: URL, samples: [StrapSample]) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (day, list) in Dictionary(grouping: samples, by: { $0.ts / 86400 }) {
            var bytes = [UInt8]()
            bytes.reserveCapacity(list.count * 32)
            for s in list.sorted(by: { $0.ts < $1.ts }) { bytes += s.encoded() }
            let u = url(dir, day: day)
            if FileManager.default.fileExists(atPath: u.path) {
                let h = try FileHandle(forWritingTo: u)
                defer { try? h.close() }
                h.seekToEndOfFile()
                h.write(Data(bytes))
            } else {
                try Data(bytes).write(to: u)
            }
        }
    }
}
