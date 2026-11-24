import Foundation
import Observation
import WhoopKit

struct UserProfile: Codable, Equatable {
    var name: String = ""
    var birthDate: Date = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    var sex: BiologicalSex = .male
    var heightCm: Double = 178
    var weightKg: Double = 75
    var maxHROverride: Int? = nil
    var sleepNeedHours: Double = 7.75
    var wakeMinutes: Int = 7 * 60           // desired wake time (minutes after midnight)
    var goalText: String = ""

    var age: Int { Calendar.current.dateComponents([.year], from: birthDate, to: Date()).year ?? 30 }

    var physio: PhysioProfile {
        PhysioProfile(sex: sex, age: age, weightKg: weightKg, heightCm: heightCm, maxHROverride: maxHROverride,
                      sleepNeedBaseHours: sleepNeedHours)
    }
}

enum ClaudeModel: String, CaseIterable, Identifiable {
    case opus = "claude-opus-5-5"
    case sonnet = "claude-sonnet-5-5"
    case haiku = "claude-haiku-5-5"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .opus: return "Claude Opus 5.5 (máxima calidad)"
        case .sonnet: return "Claude Sonnet 5.5 (equilibrado)"
        case .haiku: return "Claude Haiku 5.5 (rápido y barato)"
        }
    }
}

/// App-wide preferences persisted in UserDefaults (secrets live in the Keychain).
@Observable
final class AppSettings {
    static let shared = AppSettings()
    private let d = UserDefaults.standard

    var profile: UserProfile { didSet { save(profile, "profile") } }
    var onboarded: Bool { didSet { d.set(onboarded, forKey: "onboarded") } }
    var demoMode: Bool { didSet { d.set(demoMode, forKey: "demoMode") } }
    var claudeModel: ClaudeModel { didSet { d.set(claudeModel.rawValue, forKey: "claudeModel") } }
    var autoDailyAnalysis: Bool { didSet { d.set(autoDailyAnalysis, forKey: "autoDailyAnalysis") } }
    var notifyRecovery: Bool { didSet { d.set(notifyRecovery, forKey: "notifyRecovery") } }
    var notifyBedtime: Bool { didSet { d.set(notifyBedtime, forKey: "notifyBedtime") } }
    var smartAlarmEnabled: Bool { didSet { d.set(smartAlarmEnabled, forKey: "smartAlarm") } }
    var smartAlarmWindowMin: Int { didSet { d.set(smartAlarmWindowMin, forKey: "smartAlarmWindow") } }
    var showSpO2: Bool { didSet { d.set(showSpO2, forKey: "showSpO2") } }
    var doubleTapAction: String { didSet { d.set(doubleTapAction, forKey: "doubleTapAction") } }
    var healthKitEnabled: Bool { didSet { d.set(healthKitEnabled, forKey: "healthKit") } }
    var stravaClientId: String { didSet { d.set(stravaClientId, forKey: "stravaClientId") } }
    var stravaAthleteName: String { didSet { d.set(stravaAthleteName, forKey: "stravaAthlete") } }
    var stravaTokenExpiry: Double { didSet { d.set(stravaTokenExpiry, forKey: "stravaExpiry") } }
    var strongWeightUnit: WeightUnit { didSet { d.set(strongWeightUnit.rawValue, forKey: "strongUnit") } }
    var rawCaptureEnabled: Bool { didSet { d.set(rawCaptureEnabled, forKey: "rawCapture") } }

    private init() {
        profile = (d.data(forKey: "profile").flatMap { try? JSONDecoder().decode(UserProfile.self, from: $0) }) ?? UserProfile()
        onboarded = d.bool(forKey: "onboarded")
        demoMode = d.bool(forKey: "demoMode")
        claudeModel = ClaudeModel(rawValue: d.string(forKey: "claudeModel") ?? "") ?? .opus
        autoDailyAnalysis = d.object(forKey: "autoDailyAnalysis") as? Bool ?? true
        notifyRecovery = d.object(forKey: "notifyRecovery") as? Bool ?? true
        notifyBedtime = d.object(forKey: "notifyBedtime") as? Bool ?? true
        smartAlarmEnabled = d.bool(forKey: "smartAlarm")
        smartAlarmWindowMin = d.object(forKey: "smartAlarmWindow") as? Int ?? 30
        showSpO2 = d.bool(forKey: "showSpO2")
        doubleTapAction = d.string(forKey: "doubleTapAction") ?? "workout"
        healthKitEnabled = d.bool(forKey: "healthKit")
        stravaClientId = d.string(forKey: "stravaClientId") ?? ""
        stravaAthleteName = d.string(forKey: "stravaAthlete") ?? ""
        stravaTokenExpiry = d.double(forKey: "stravaExpiry")
        strongWeightUnit = WeightUnit(rawValue: d.string(forKey: "strongUnit") ?? "") ?? .kg
        rawCaptureEnabled = d.bool(forKey: "rawCapture")
    }

    private func save<T: Encodable>(_ v: T, _ key: String) {
        if let data = try? JSONEncoder().encode(v) { d.set(data, forKey: key) }
    }

    var anthropicKey: String? {
        get { Keychain.get(Keychain.Key.anthropic) }
        set { Keychain.set(newValue, for: Keychain.Key.anthropic) }
    }
    var hasAnthropicKey: Bool { !(anthropicKey ?? "").isEmpty }

    /// Desired wake time for a given night (next occurrence after `after`).
    func nextWake(after: Date = Date()) -> Date {
        let cal = Calendar.current
        var c = cal.dateComponents([.year, .month, .day], from: after)
        c.hour = profile.wakeMinutes / 60; c.minute = profile.wakeMinutes % 60
        var d = cal.date(from: c) ?? after
        if d <= after { d = cal.date(byAdding: .day, value: 1, to: d) ?? d }
        return d
    }
}

enum DayKey {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func key(_ d: Date) -> String { formatter.string(from: d) }
    static func date(_ k: String) -> Date? { formatter.date(from: k) }
    static func bounds(_ d: Date) -> (start: Int, end: Int) {
        let cal = Calendar.current
        let s = cal.startOfDay(for: d)
        let e = cal.date(byAdding: .day, value: 1, to: s) ?? s.addingTimeInterval(86400)
        return (Int(s.timeIntervalSince1970), Int(e.timeIntervalSince1970))
    }
}
