import Foundation
import SwiftData
import WhoopKit

// MARK: - Persistent models (SwiftData)

@Model
final class DailyRecord {
    @Attribute(.unique) var dayKey: String
    var dayStart: Date
    var metricsData: Data
    var reportData: Data?
    var aiAnalysis: String?
    var aiAnalysisAt: Date?
    var updatedAt: Date

    init(dayKey: String, dayStart: Date, metrics: DayMetrics, report: DayReport?) {
        self.dayKey = dayKey
        self.dayStart = dayStart
        self.metricsData = (try? JSONEncoder().encode(metrics)) ?? Data()
        self.reportData = report.flatMap { try? JSONEncoder().encode($0) }
        self.updatedAt = Date()
    }

    var metrics: DayMetrics {
        get { (try? JSONDecoder().decode(DayMetrics.self, from: metricsData)) ?? DayMetrics(dayKey: dayKey, dayStart: Int(dayStart.timeIntervalSince1970)) }
        set { metricsData = (try? JSONEncoder().encode(newValue)) ?? metricsData }
    }

    var report: DayReport? {
        guard let reportData else { return nil }
        return try? JSONDecoder().decode(DayReport.self, from: reportData)
    }

    func update(report: DayReport) {
        metricsData = (try? JSONEncoder().encode(report.metrics)) ?? metricsData
        reportData = try? JSONEncoder().encode(report)
        updatedAt = Date()
    }
}

@Model
final class BodyMeasurement {
    var date: Date
    var weightKg: Double?
    var bodyFatPct: Double?
    var waistCm: Double?
    var chestCm: Double?
    var hipsCm: Double?
    var neckCm: Double?
    var armCm: Double?
    var thighCm: Double?
    var calfCm: Double?
    var restingHRManual: Double?
    var notes: String

    init(date: Date = Date(), weightKg: Double? = nil, bodyFatPct: Double? = nil, waistCm: Double? = nil, chestCm: Double? = nil,
         hipsCm: Double? = nil, neckCm: Double? = nil, armCm: Double? = nil, thighCm: Double? = nil, calfCm: Double? = nil,
         notes: String = "") {
        self.date = date; self.weightKg = weightKg; self.bodyFatPct = bodyFatPct; self.waistCm = waistCm
        self.chestCm = chestCm; self.hipsCm = hipsCm; self.neckCm = neckCm; self.armCm = armCm
        self.thighCm = thighCm; self.calfCm = calfCm; self.notes = notes
    }
}

enum WorkoutSource: String, Codable, CaseIterable {
    case strap, live, strong, strava, health, manual
    var spanish: String {
        switch self {
        case .strap: return "Detectado (pulsera)"
        case .live: return "Grabado en directo"
        case .strong: return "Strong"
        case .strava: return "Strava"
        case .health: return "Apple Salud"
        case .manual: return "Manual"
        }
    }
    var icon: String {
        switch self {
        case .strap: return "waveform.path.ecg"
        case .live: return "record.circle"
        case .strong: return "dumbbell.fill"
        case .strava: return "figure.run"
        case .health: return "heart.text.square"
        case .manual: return "square.and.pencil"
        }
    }
}

@Model
final class WorkoutRecord {
    @Attribute(.unique) var uid: String
    var sourceRaw: String
    var externalId: String?
    var start: Date
    var end: Date
    var sport: String
    var name: String
    var strain: Double?
    var avgHR: Double?
    var maxHR: Double?
    var kcal: Double?
    var distanceKm: Double?
    var notes: String
    var zoneSecondsData: Data?
    var strongData: Data?
    var stravaId: Int?
    var stravaUploaded: Bool

    init(uid: String, source: WorkoutSource, start: Date, end: Date, sport: String, name: String, notes: String = "") {
        self.uid = uid; self.sourceRaw = source.rawValue; self.start = start; self.end = end
        self.sport = sport; self.name = name; self.notes = notes; self.stravaUploaded = false
    }

    var source: WorkoutSource { WorkoutSource(rawValue: sourceRaw) ?? .manual }
    var durationMin: Double { end.timeIntervalSince(start) / 60 }
    var zoneSeconds: [Int] {
        get { zoneSecondsData.flatMap { try? JSONDecoder().decode([Int].self, from: $0) } ?? [] }
        set { zoneSecondsData = try? JSONEncoder().encode(newValue) }
    }
    var strong: StrongWorkout? {
        get { strongData.flatMap { try? JSONDecoder().decode(StrongWorkout.self, from: $0) } }
        set { strongData = newValue.flatMap { try? JSONEncoder().encode($0) } }
    }
}

@Model
final class PlanRecord {
    @Attribute(.unique) var uid: UUID
    var createdAt: Date
    var isActive: Bool
    var planData: Data

    init(plan: TrainingPlan, active: Bool = true) {
        uid = plan.id; createdAt = plan.createdAt; isActive = active
        planData = (try? JSONEncoder().encode(plan)) ?? Data()
    }

    var plan: TrainingPlan? { try? JSONDecoder().decode(TrainingPlan.self, from: planData) }
    func update(_ p: TrainingPlan) { planData = (try? JSONEncoder().encode(p)) ?? planData }
}

@Model
final class JournalEntry {
    @Attribute(.unique) var dayKey: String
    var answersData: Data
    var notes: String
    var updatedAt: Date

    init(dayKey: String) {
        self.dayKey = dayKey; self.answersData = Data("{}".utf8); self.notes = ""; self.updatedAt = Date()
    }

    var answers: [String: Double] {
        get { (try? JSONDecoder().decode([String: Double].self, from: answersData)) ?? [:] }
        set { answersData = (try? JSONEncoder().encode(newValue)) ?? answersData; updatedAt = Date() }
    }
}

@Model
final class ChatMessageRecord {
    var date: Date
    var role: String      // "user" | "assistant"
    var text: String
    var conversation: String

    init(role: String, text: String, conversation: String = "main", date: Date = Date()) {
        self.role = role; self.text = text; self.conversation = conversation; self.date = date
    }
}

@Model
final class DeviceEventRecord {
    var date: Date
    var code: Int
    var label: String
    var detail: String

    init(date: Date, code: Int, label: String, detail: String = "") {
        self.date = date; self.code = code; self.label = label; self.detail = detail
    }
}

enum PulsoSchema {
    static let models: [any PersistentModel.Type] = [
        DailyRecord.self, BodyMeasurement.self, WorkoutRecord.self, PlanRecord.self,
        JournalEntry.self, ChatMessageRecord.self, DeviceEventRecord.self
    ]
}
