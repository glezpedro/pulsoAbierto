import Foundation

public enum BiologicalSex: String, Codable, CaseIterable {
    case male, female
    public var spanish: String { self == .male ? "Hombre" : "Mujer" }
}

/// Physiological parameters the algorithms need.
public struct PhysioProfile: Codable, Equatable {
    public var sex: BiologicalSex
    public var age: Int
    public var weightKg: Double
    public var heightCm: Double
    public var maxHROverride: Int?
    public var sleepNeedBaseHours: Double

    public init(sex: BiologicalSex = .male, age: Int = 30, weightKg: Double = 75, heightCm: Double = 178,
                maxHROverride: Int? = nil, sleepNeedBaseHours: Double = 7.75) {
        self.sex = sex; self.age = age; self.weightKg = weightKg; self.heightCm = heightCm
        self.maxHROverride = maxHROverride; self.sleepNeedBaseHours = sleepNeedBaseHours
    }

    /// Tanaka et al. (2001): HRmax = 208 − 0.7 × age.
    public var hrMax: Double { Double(maxHROverride ?? Int((208 - 0.7 * Double(age)).rounded())) }

    /// Mifflin–St Jeor basal metabolic rate (kcal/day).
    public var bmr: Double {
        let base = 10 * weightKg + 6.25 * heightCm - 5 * Double(age)
        return sex == .male ? base + 5 : base - 161
    }

    public var bmi: Double { weightKg / pow(heightCm / 100, 2) }
}
