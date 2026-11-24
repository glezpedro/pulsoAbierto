import Foundation

public enum TrainingGoal: String, Codable, CaseIterable, Identifiable {
    case strength, hypertrophy, fatLoss, endurance, hybrid, health
    public var id: String { rawValue }
    public var spanish: String {
        switch self {
        case .strength: return "Fuerza"
        case .hypertrophy: return "Hipertrofia"
        case .fatLoss: return "Pérdida de grasa"
        case .endurance: return "Resistencia"
        case .hybrid: return "Híbrido (fuerza + resistencia)"
        case .health: return "Salud general"
        }
    }
}

public enum ExperienceLevel: String, Codable, CaseIterable, Identifiable {
    case beginner, intermediate, advanced
    public var id: String { rawValue }
    public var spanish: String {
        switch self {
        case .beginner: return "Principiante"
        case .intermediate: return "Intermedio"
        case .advanced: return "Avanzado"
        }
    }
}

public enum CardioPreference: String, Codable, CaseIterable, Identifiable {
    case running, cycling, rowing, none
    public var id: String { rawValue }
    public var spanish: String {
        switch self {
        case .running: return "Correr"
        case .cycling: return "Bici"
        case .rowing: return "Remo"
        case .none: return "Sin cardio"
        }
    }
}

public struct PlanRequest: Codable, Equatable {
    public var goal: TrainingGoal
    public var daysPerWeek: Int
    public var sessionMinutes: Int
    public var experience: ExperienceLevel
    public var equipment: Equipment
    public var weeks: Int
    public var cardio: CardioPreference
    public var priorityMuscles: [MuscleGroup]
    public var notes: String

    public init(goal: TrainingGoal = .hypertrophy, daysPerWeek: Int = 4, sessionMinutes: Int = 60,
                experience: ExperienceLevel = .intermediate, equipment: Equipment = .fullGym, weeks: Int = 8,
                cardio: CardioPreference = .running, priorityMuscles: [MuscleGroup] = [], notes: String = "") {
        self.goal = goal; self.daysPerWeek = daysPerWeek; self.sessionMinutes = sessionMinutes
        self.experience = experience; self.equipment = equipment; self.weeks = weeks; self.cardio = cardio
        self.priorityMuscles = priorityMuscles; self.notes = notes
    }
}

public struct PlannedExercise: Codable, Equatable, Identifiable {
    public var id = UUID()
    public var exerciseKey: String
    public var name: String
    public var sets: Int
    public var reps: String          // "6-8"
    public var rir: Int              // reps in reserve
    public var restSeconds: Int
    public var notes: String
    public var suggestedKg: Double?

    public init(exerciseKey: String, name: String, sets: Int, reps: String, rir: Int, restSeconds: Int, notes: String = "", suggestedKg: Double? = nil) {
        self.exerciseKey = exerciseKey; self.name = name; self.sets = sets; self.reps = reps; self.rir = rir
        self.restSeconds = restSeconds; self.notes = notes; self.suggestedKg = suggestedKg
    }
}

public enum SessionKind: String, Codable { case strength, cardio, mixed, mobility, rest }

public struct CardioBlock: Codable, Equatable {
    public var minutes: Int
    public var zone: Int             // 1–5
    public var description: String
    public init(minutes: Int, zone: Int, description: String) { self.minutes = minutes; self.zone = zone; self.description = description }
}

public struct PlannedSession: Codable, Equatable, Identifiable {
    public var id = UUID()
    public var weekday: Int          // 1 = lunes … 7 = domingo
    public var title: String
    public var kind: SessionKind
    public var exercises: [PlannedExercise]
    public var cardio: CardioBlock?
    public var estimatedMinutes: Int
    public var targetStrain: Double

    public init(weekday: Int, title: String, kind: SessionKind, exercises: [PlannedExercise] = [], cardio: CardioBlock? = nil, estimatedMinutes: Int, targetStrain: Double) {
        self.weekday = weekday; self.title = title; self.kind = kind; self.exercises = exercises; self.cardio = cardio
        self.estimatedMinutes = estimatedMinutes; self.targetStrain = targetStrain
    }
}

public struct PlanWeek: Codable, Equatable, Identifiable {
    public var id: Int { index }
    public var index: Int            // 0-based
    public var phase: String
    public var focus: String
    public var sessions: [PlannedSession]

    public init(index: Int, phase: String, focus: String, sessions: [PlannedSession]) {
        self.index = index; self.phase = phase; self.focus = focus; self.sessions = sessions
    }
}

public struct TrainingPlan: Codable, Equatable, Identifiable {
    public var id = UUID()
    public var name: String
    public var createdAt: Date
    public var startDate: Date
    public var request: PlanRequest
    public var weeks: [PlanWeek]
    public var summary: String
    public var source: String        // "local" | "ia"

    public init(name: String, createdAt: Date = Date(), startDate: Date, request: PlanRequest, weeks: [PlanWeek], summary: String, source: String) {
        self.name = name; self.createdAt = createdAt; self.startDate = startDate; self.request = request
        self.weeks = weeks; self.summary = summary; self.source = source
    }

    /// Session scheduled for a given date (nil = rest day or plan finished).
    public func session(on date: Date, calendar: Calendar = .current) -> (week: PlanWeek, session: PlannedSession)? {
        let start = calendar.startOfDay(for: startDate)
        let day = calendar.startOfDay(for: date)
        guard let diff = calendar.dateComponents([.day], from: start, to: day).day, diff >= 0 else { return nil }
        let w = diff / 7
        guard w < weeks.count else { return nil }
        let weekday = (calendar.component(.weekday, from: date) + 5) % 7 + 1 // 1 = lunes
        guard let s = weeks[w].sessions.first(where: { $0.weekday == weekday }) else { return nil }
        return (weeks[w], s)
    }
}
