import Foundation
import HealthKit
import WhoopKit

/// Apple Health bridge: reads steps, weight and workouts (Strong writes its sessions to Health),
/// writes heart rate, resting HR, respiratory rate and sleep stages.
@MainActor
final class HealthKitService {
    static let shared = HealthKitService()
    private let store = HKHealthStore()

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [HKObjectType.workoutType()]
        for id in [HKQuantityTypeIdentifier.stepCount, .bodyMass, .height, .bodyFatPercentage, .activeEnergyBurned,
                   .vo2Max, .heartRate, .restingHeartRate, .heartRateVariabilitySDNN] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { s.insert(t) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { s.insert(sleep) }
        return s
    }

    private var writeTypes: Set<HKSampleType> {
        var s: Set<HKSampleType> = []
        for id in [HKQuantityTypeIdentifier.heartRate, .restingHeartRate, .respiratoryRate, .bodyMass, .bodyFatPercentage] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { s.insert(t) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { s.insert(sleep) }
        return s
    }

    func requestAuthorization() async -> Bool {
        guard isAvailable else { return false }
        do {
            try await store.requestAuthorization(toShare: writeTypes, read: readTypes)
            return true
        } catch {
            return false
        }
    }

    // MARK: Read

    /// Step totals per local day (yyyy-MM-dd) over the last `days`.
    func dailySteps(days: Int = 60) async -> [String: Double] {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return [:] }
        let cal = Calendar.current
        let end = Date()
        let start = cal.startOfDay(for: cal.date(byAdding: .day, value: -days, to: end) ?? end)
        let pred = HKQuery.predicateForSamples(withStart: start, end: end)
        return await withCheckedContinuation { cont in
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: pred, options: .cumulativeSum,
                                                anchorDate: start, intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, results, _ in
                var out: [String: Double] = [:]
                results?.enumerateStatistics(from: start, to: end) { st, _ in
                    if let v = st.sumQuantity()?.doubleValue(for: .count()) { out[DayKey.key(st.startDate)] = v }
                }
                cont.resume(returning: out)
            }
            store.execute(q)
        }
    }

    func latestQuantity(_ id: HKQuantityTypeIdentifier, unit: HKUnit) async -> (Double, Date)? {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return nil }
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: nil, limit: 1,
                                  sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]) { _, s, _ in
                if let q = s?.first as? HKQuantitySample { cont.resume(returning: (q.quantity.doubleValue(for: unit), q.endDate)) }
                else { cont.resume(returning: nil) }
            }
            store.execute(q)
        }
    }

    struct HealthWorkout {
        let uuid: UUID
        let start: Date
        let end: Date
        let activity: String
        let sourceName: String
        let kcal: Double?
        let distanceKm: Double?
    }

    func workouts(days: Int = 60) async -> [HealthWorkout] {
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let pred = HKQuery.predicateForSamples(withStart: start, end: Date())
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: .workoutType(), predicate: pred, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, s, _ in
                let list = (s as? [HKWorkout] ?? []).map { w -> HealthWorkout in
                    let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
                    let dist = w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo))
                    return HealthWorkout(uuid: w.uuid, start: w.startDate, end: w.endDate,
                                         activity: Self.spanishName(w.workoutActivityType),
                                         sourceName: w.sourceRevision.source.name, kcal: kcal, distanceKm: dist)
                }
                cont.resume(returning: list)
            }
            store.execute(q)
        }
    }

    nonisolated static func spanishName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .traditionalStrengthTraining: return "Fuerza"
        case .functionalStrengthTraining: return "Fuerza funcional"
        case .running: return "Carrera"
        case .cycling: return "Ciclismo"
        case .walking: return "Caminata"
        case .hiking: return "Senderismo"
        case .swimming: return "Natación"
        case .rowing: return "Remo"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .soccer: return "Fútbol"
        case .basketball: return "Baloncesto"
        case .tennis: return "Tenis"
        case .paddleSports: return "Pádel/remo"
        case .crossTraining: return "Cross training"
        case .elliptical: return "Elíptica"
        case .stairClimbing: return "Escaleras"
        case .mixedCardio: return "Cardio mixto"
        case .coreTraining: return "Core"
        case .flexibility: return "Flexibilidad"
        default: return "Entrenamiento"
        }
    }

    // MARK: Write

    func write(report: DayReport) async {
        var objects: [HKObject] = []
        let bpm = HKUnit.count().unitDivided(by: .minute())
        if let s = report.sleep {
            let start = Date(timeIntervalSince1970: TimeInterval(s.start))
            // merge consecutive identical stages into category samples
            var i = 0
            while i < s.stages.count {
                var j = i
                while j + 1 < s.stages.count && s.stages[j + 1] == s.stages[i] { j += 1 }
                let value: HKCategoryValueSleepAnalysis
                switch s.stages[i] {
                case .awake: value = .awake
                case .light: value = .asleepCore
                case .deep: value = .asleepDeep
                case .rem: value = .asleepREM
                }
                if let t = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
                    objects.append(HKCategorySample(type: t, value: value.rawValue,
                                                    start: start.addingTimeInterval(TimeInterval(i * 60)),
                                                    end: start.addingTimeInterval(TimeInterval((j + 1) * 60)),
                                                    metadata: [HKMetadataKeyExternalUUID: "pulso-sleep-\(s.start)-\(i)"]))
                }
                i = j + 1
            }
            let wake = Date(timeIntervalSince1970: TimeInterval(s.end))
            if let r = s.restingHR, let t = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
                objects.append(HKQuantitySample(type: t, quantity: HKQuantity(unit: bpm, doubleValue: r), start: wake, end: wake))
            }
            if let rr = s.respiratoryRate, let t = HKQuantityType.quantityType(forIdentifier: .respiratoryRate) {
                objects.append(HKQuantitySample(type: t, quantity: HKQuantity(unit: bpm, doubleValue: rr), start: wake, end: wake))
            }
        }
        if let t = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            for b in report.hrTimeline {
                let d = Date(timeIntervalSince1970: TimeInterval(b.ts))
                objects.append(HKQuantitySample(type: t, quantity: HKQuantity(unit: bpm, doubleValue: b.avg), start: d, end: d.addingTimeInterval(300)))
            }
        }
        guard !objects.isEmpty else { return }
        try? await store.save(objects)
    }

    func writeWeight(_ kg: Double, date: Date) async {
        guard let t = HKQuantityType.quantityType(forIdentifier: .bodyMass) else { return }
        try? await store.save(HKQuantitySample(type: t, quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg), start: date, end: date))
    }
}
