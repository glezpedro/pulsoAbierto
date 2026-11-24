import Foundation
import SwiftData
import WhoopKit

/// Generates ~3 weeks of realistic synthetic data so the whole app can be explored before the
/// strap arrives (Ajustes › Modo demo).
@MainActor
enum DemoDataService {
    static func generate(days: Int = 21, context: ModelContext, engine: AnalysisEngine, progress: @escaping (Double) -> Void) async {
        var gen = SyntheticGenerator(seed: UInt64(Date().timeIntervalSince1970))
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let now = Int(Date().timeIntervalSince1970)
        var analyzedDays: [Date] = []
        for i in stride(from: days, through: 0, by: -1) {
            guard let day = cal.date(byAdding: .day, value: -i, to: today) else { continue }
            let ds = Int(day.timeIntervalSince1970)
            let bedJitter = Int(gen.normal() * 1200)
            let wakeJitter = Int(gen.normal() * 900)
            let workout = i % 7 != 3 && i % 7 != 6
            let intensity = 0.55 + gen.unit() * 0.25
            let plan = SyntheticGenerator.DayPlan(
                bedtime: ds - 90 * 60 + bedJitter, wake: ds + 7 * 3600 + 10 * 60 + wakeJitter,
                restingHR: 52 + gen.normal() * 1.5 + (i % 7 == 0 ? 3 : 0),
                rmssd: 62 + gen.normal() * 9 - (i % 7 == 0 ? 12 : 0),
                workout: workout ? (ds + 18 * 3600 + Int(gen.unit() * 3600), 45 + Int(gen.unit() * 35), intensity) : nil)
            let from = ds - 6 * 3600
            let to = min(ds + 18 * 3600, now)
            guard to > from else { continue }
            let samples = await Task.detached { var g = SyntheticGenerator(seed: UInt64(ds)); return g.samples(from: from, to: to, plan: plan) }.value
            try? await SampleStore.shared.append(samples)
            analyzedDays.append(day)
            progress(Double(days - i) / Double(days + 1) * 0.6)
        }
        // Demo Strong workouts
        let names = [("Torso A", ["Bench Press (Barbell)", "Bent Over Row (Barbell)", "Overhead Press (Barbell)", "Lat Pulldown (Cable)"]),
                     ("Pierna A", ["Squat (Barbell)", "Romanian Deadlift (Barbell)", "Leg Press", "Lying Leg Curl (Machine)"])]
        for i in stride(from: days, through: 1, by: -1) where i % 7 != 3 && i % 7 != 6 {
            guard let day = cal.date(byAdding: .day, value: -i, to: today),
                  let start = cal.date(byAdding: .hour, value: 18, to: day) else { continue }
            let tpl = names[i % 2]
            var sets: [StrongSet] = []
            for (k, ex) in tpl.1.enumerated() {
                let base: Double = [80, 70, 50, 60, 110, 90, 160, 45][(i % 2) * 4 + k] + Double(days - i) * 0.5
                for s in 1...3 { sets.append(StrongSet(exercise: ex, setOrder: s, setType: "", weightKg: base, reps: 8 - (s == 3 ? 1 : 0),
                                                       distanceKm: 0, seconds: 0, rpe: nil, notes: "")) }
            }
            let sw = StrongWorkout(date: start, name: tpl.0, durationSeconds: 3600, notes: "", sets: sets)
            let w = WorkoutRecord(uid: "strong-demo-\(i)", source: .strong, start: start, end: start.addingTimeInterval(3600),
                                  sport: "Fuerza", name: tpl.0)
            w.strong = sw
            context.insert(w)
        }
        context.insert(BodyMeasurement(date: cal.date(byAdding: .day, value: -days, to: today) ?? today, weightKg: 78.4, bodyFatPct: 17.5, waistCm: 84, chestCm: 101, armCm: 35))
        context.insert(BodyMeasurement(date: today, weightKg: 77.1, bodyFatPct: 16.6, waistCm: 82, chestCm: 102, armCm: 35.5))
        try? context.save()
        for (k, chunk) in stride(from: 0, to: analyzedDays.count, by: 4).map({ Array(analyzedDays[$0..<min($0 + 4, analyzedDays.count)]) }).enumerated() {
            await engine.analyze(days: chunk)
            progress(0.6 + 0.4 * Double(min(analyzedDays.count, (k + 1) * 4)) / Double(max(1, analyzedDays.count)))
        }
    }

    static func wipeAll(context: ModelContext) async {
        await SampleStore.shared.deleteAll()
        for t in PulsoSchema.models { try? context.delete(model: t) }
        try? context.save()
    }
}
