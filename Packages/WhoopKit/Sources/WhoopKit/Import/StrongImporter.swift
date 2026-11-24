import Foundation

/// A set exported by the Strong app.
public struct StrongSet: Codable, Equatable, Hashable {
    public var exercise: String
    public var setOrder: Int
    public var setType: String       // "", "W" warm-up, "D" drop, "F" failure
    public var weightKg: Double
    public var reps: Int
    public var distanceKm: Double
    public var seconds: Double
    public var rpe: Double?
    public var notes: String

    public init(exercise: String, setOrder: Int, setType: String, weightKg: Double, reps: Int, distanceKm: Double,
                seconds: Double, rpe: Double?, notes: String) {
        self.exercise = exercise; self.setOrder = setOrder; self.setType = setType; self.weightKg = weightKg
        self.reps = reps; self.distanceKm = distanceKm; self.seconds = seconds; self.rpe = rpe; self.notes = notes
    }

    public var isWarmup: Bool { setType.uppercased() == "W" }
    /// Epley estimated 1RM (only meaningful for 1–12 reps).
    public var e1RM: Double? {
        guard weightKg > 0, reps > 0, reps <= 12, !isWarmup else { return nil }
        return reps == 1 ? weightKg : weightKg * (1 + Double(reps) / 30)
    }
    public var volumeKg: Double { isWarmup ? 0 : weightKg * Double(reps) }
}

public struct StrongWorkout: Codable, Equatable, Identifiable {
    public var id: String { "\(Int(date.timeIntervalSince1970))-\(name)" }
    public var date: Date
    public var name: String
    public var durationSeconds: Double
    public var notes: String
    public var sets: [StrongSet]

    public init(date: Date, name: String, durationSeconds: Double, notes: String, sets: [StrongSet]) {
        self.date = date; self.name = name; self.durationSeconds = durationSeconds; self.notes = notes; self.sets = sets
    }

    public var totalVolumeKg: Double { sets.reduce(0) { $0 + $1.volumeKg } }
    public var workingSets: Int { sets.filter { !$0.isWarmup }.count }
    public var exercises: [String] {
        var seen = Set<String>(); var out: [String] = []
        for s in sets where !seen.contains(s.exercise) { seen.insert(s.exercise); out.append(s.exercise) }
        return out
    }
}

public enum WeightUnit: String, Codable, CaseIterable { case kg, lb }

public enum StrongImporter {

    public enum ImportError: Error, LocalizedError {
        case empty, missingColumns([String])
        public var errorDescription: String? {
            switch self {
            case .empty: return "El archivo está vacío."
            case .missingColumns(let c): return "Faltan columnas en el CSV de Strong: \(c.joined(separator: ", "))"
            }
        }
    }

    /// Parses a Strong CSV export (Ajustes → Exportar datos). Header-driven, so it tolerates column
    /// order changes, comma or semicolon delimiters, and extra columns.
    public static func parse(_ text: String, unit: WeightUnit = .kg) throws -> [StrongWorkout] {
        let clean = text.replacingOccurrences(of: "\u{FEFF}", with: "")
        guard let firstLine = clean.split(whereSeparator: \.isNewline).first else { throw ImportError.empty }
        let delim: Character = firstLine.filter { $0 == ";" }.count > firstLine.filter { $0 == "," }.count ? ";" : ","
        let rows = CSV.parse(clean, delimiter: delim)
        guard let header = rows.first else { throw ImportError.empty }
        let h = header.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        func col(_ names: String...) -> Int? { names.lazy.compactMap { n in h.firstIndex(of: n) }.first }
        guard let cDate = col("date", "fecha"), let cEx = col("exercise name", "exercise", "ejercicio") else {
            throw ImportError.missingColumns(["Date", "Exercise Name"])
        }
        let cName = col("workout name", "nombre del entrenamiento")
        let cDur = col("duration", "workout duration", "duración")
        let cOrder = col("set order", "set", "serie")
        let cW = col("weight", "weight (kg)", "weight (lbs)", "peso")
        let cReps = col("reps", "repeticiones")
        let cDist = col("distance", "distance (km)", "distancia")
        let cSec = col("seconds", "segundos")
        let cNotes = col("notes", "notas")
        let cWNotes = col("workout notes")
        let cRPE = col("rpe")
        let cWUnit = col("weight unit")
        let cDUnit = col("distance unit")
        let headerUnitLb = header.contains { $0.lowercased().contains("lbs") }

        var grouped: [String: StrongWorkout] = [:]
        var order: [String] = []
        for r in rows.dropFirst() where r.count > max(cDate, cEx) {
            func v(_ c: Int?) -> String { guard let c, c < r.count else { return "" }; return r[c].trimmingCharacters(in: .whitespaces) }
            guard let date = parseDate(v(cDate)) else { continue }
            let exName = v(cEx)
            guard !exName.isEmpty else { continue }
            let wName = v(cName).isEmpty ? "Entrenamiento" : v(cName)
            let key = "\(Int(date.timeIntervalSince1970))|\(wName)"
            if grouped[key] == nil {
                grouped[key] = StrongWorkout(date: date, name: wName, durationSeconds: parseDuration(v(cDur)),
                                             notes: v(cWNotes), sets: [])
                order.append(key)
            }
            let orderRaw = v(cOrder)
            let setOrder = Int(orderRaw) ?? 0
            let setType = Int(orderRaw) == nil ? orderRaw : ""
            var weight = number(v(cW))
            let rowUnitLb = v(cWUnit).lowercased().hasPrefix("lb")
            if unit == .lb || rowUnitLb || (cWUnit == nil && headerUnitLb) { weight *= 0.45359237 }
            var dist = number(v(cDist))
            if v(cDUnit).lowercased().hasPrefix("mi") { dist *= 1.609344 }
            let rpeV = number(v(cRPE))
            grouped[key]!.sets.append(StrongSet(exercise: exName, setOrder: setOrder, setType: setType,
                                                weightKg: weight, reps: Int(number(v(cReps))), distanceKm: dist,
                                                seconds: number(v(cSec)), rpe: rpeV > 0 ? rpeV : nil, notes: v(cNotes)))
        }
        return order.compactMap { grouped[$0] }.sorted { $0.date < $1.date }
    }

    static func number(_ s: String) -> Double {
        Double(s.replacingOccurrences(of: ",", with: ".")) ?? 0
    }

    static let dateFormats = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "dd/MM/yyyy HH:mm:ss",
                              "dd/MM/yyyy HH:mm", "MM/dd/yyyy HH:mm:ss", "yyyy-MM-dd"]

    public static func parseDate(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        for fmt in dateFormats {
            f.dateFormat = fmt
            if let d = f.date(from: s) { return d }
        }
        return ISO8601DateFormatter().date(from: s)
    }

    /// "1h 5m", "45m", "1h", "50s", "3600" → seconds.
    public static func parseDuration(_ s: String) -> Double {
        if let n = Double(s) { return n }
        var total = 0.0
        var num = ""
        for ch in s.lowercased() {
            if ch.isNumber || ch == "." { num.append(ch); continue }
            let v = Double(num) ?? 0
            switch ch {
            case "h": total += v * 3600; num = ""
            case "m": total += v * 60; num = ""
            case "s": total += v; num = ""
            default: break
            }
        }
        return total
    }

    // MARK: Analytics

    public struct ExerciseProgress: Identifiable {
        public var id: String { exercise }
        public let exercise: String
        public let points: [(date: Date, e1RM: Double, topWeight: Double, volume: Double)]
        public var bestE1RM: Double { points.map(\.e1RM).max() ?? 0 }
        public var last: Double { points.last?.e1RM ?? 0 }
    }

    public static func progress(_ workouts: [StrongWorkout]) -> [ExerciseProgress] {
        var map: [String: [(Date, Double, Double, Double)]] = [:]
        for w in workouts {
            let byEx = Dictionary(grouping: w.sets, by: \.exercise)
            for (ex, sets) in byEx {
                let e = sets.compactMap(\.e1RM).max() ?? 0
                let top = sets.filter { !$0.isWarmup }.map(\.weightKg).max() ?? 0
                let vol = sets.reduce(0) { $0 + $1.volumeKg }
                if e > 0 || vol > 0 { map[ex, default: []].append((w.date, e, top, vol)) }
            }
        }
        return map.map { ExerciseProgress(exercise: $0.key, points: $0.value.sorted { $0.0 < $1.0 }.map { (date: $0.0, e1RM: $0.1, topWeight: $0.2, volume: $0.3) }) }
            .sorted { $0.points.count > $1.points.count }
    }

    /// Latest e1RM per exercise (max of the last 60 days, falling back to all-time).
    public static func oneRepMaxes(_ workouts: [StrongWorkout], now: Date = Date()) -> [String: Double] {
        var out: [String: Double] = [:]
        let recent = workouts.filter { now.timeIntervalSince($0.date) < 60 * 86400 }
        for w in (recent.isEmpty ? workouts : recent) {
            for s in w.sets { if let e = s.e1RM { out[s.exercise] = max(out[s.exercise] ?? 0, e) } }
        }
        return out
    }

    /// Working sets per muscle group over the last 7 days.
    public static func weeklySetsPerMuscle(_ workouts: [StrongWorkout], now: Date = Date()) -> [MuscleGroup: Int] {
        var out: [MuscleGroup: Int] = [:]
        for w in workouts where now.timeIntervalSince(w.date) < 7 * 86400 && w.date <= now {
            for s in w.sets where !s.isWarmup { out[ExerciseLibrary.muscle(forStrongName: s.exercise), default: 0] += 1 }
        }
        return out
    }

    public struct PersonalRecord: Identifiable, Equatable {
        public var id: String { exercise }
        public let exercise: String
        public let e1RM: Double
        public let weight: Double
        public let reps: Int
        public let date: Date
    }

    /// Personal records (best e1RM per exercise and when).
    public static func personalRecords(_ workouts: [StrongWorkout]) -> [PersonalRecord] {
        var best: [String: PersonalRecord] = [:]
        for w in workouts {
            for s in w.sets {
                guard let e = s.e1RM else { continue }
                if e > (best[s.exercise]?.e1RM ?? 0) {
                    best[s.exercise] = PersonalRecord(exercise: s.exercise, e1RM: e, weight: s.weightKg, reps: s.reps, date: w.date)
                }
            }
        }
        return best.values.sorted { $0.e1RM > $1.e1RM }
    }
}

/// Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF).
public enum CSV {
    public static func parse(_ text: String, delimiter: Character = ",") -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var it = Array(text).makeIterator()
        var pending: Character? = nil
        while let c = pending ?? it.next() {
            pending = nil
            if inQuotes {
                if c == "\"" {
                    if let n = it.next() {
                        if n == "\"" { field.append("\"") } else { inQuotes = false; pending = n }
                    } else { inQuotes = false }
                } else { field.append(c) }
            } else {
                switch c {
                case "\"": inQuotes = true
                case delimiter: row.append(field); field = ""
                case "\n", "\r\n":
                    row.append(field); field = ""
                    if !(row.count == 1 && row[0].isEmpty) { rows.append(row) }
                    row = []
                case "\r": break
                default: field.append(c)
                }
            }
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }
}
