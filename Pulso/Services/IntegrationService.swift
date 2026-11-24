import Foundation
import SwiftData
import WhoopKit

/// Imports workouts from Strong (CSV), Apple Health and Strava into WorkoutRecords, and exports
/// sessions to Strava with the strap heart rate.
@MainActor
final class IntegrationService {
    let context: ModelContext
    init(context: ModelContext) { self.context = context }

    private func existing(uid: String) -> WorkoutRecord? {
        var fd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.uid == uid })
        fd.fetchLimit = 1
        return try? context.fetch(fd).first
    }

    // MARK: Strong

    /// Imports a Strong CSV export. Returns (new workouts, total parsed).
    func importStrong(url: URL) throws -> (added: Int, total: Int) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        let workouts = try StrongImporter.parse(text, unit: AppSettings.shared.strongWeightUnit)
        var added = 0
        for sw in workouts {
            let uid = "strong-\(Int(sw.date.timeIntervalSince1970))-\(sw.name)"
            let end = sw.date.addingTimeInterval(max(sw.durationSeconds, 1800))
            if let w = existing(uid: uid) {
                w.strong = sw
                w.end = end
            } else {
                // A Health/strap record for the same session gets merged into the Strong one
                let lo = sw.date.addingTimeInterval(-15 * 60), hi = end.addingTimeInterval(15 * 60)
                let fd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.start < hi && $0.end > lo })
                let overlap = (try? context.fetch(fd)) ?? []
                let w = WorkoutRecord(uid: uid, source: .strong, start: sw.date, end: end, sport: "Fuerza", name: sw.name, notes: sw.notes)
                w.strong = sw
                for o in overlap where o.sourceRaw == WorkoutSource.strap.rawValue || o.sourceRaw == WorkoutSource.health.rawValue {
                    w.avgHR = w.avgHR ?? o.avgHR; w.maxHR = w.maxHR ?? o.maxHR; w.strain = w.strain ?? o.strain
                    w.kcal = w.kcal ?? o.kcal
                    if w.zoneSeconds.isEmpty { w.zoneSeconds = o.zoneSeconds }
                    context.delete(o)
                }
                context.insert(w)
                added += 1
            }
        }
        try context.save()
        return (added, workouts.count)
    }

    // MARK: Apple Health

    func importHealthWorkouts() async -> Int {
        let list = await HealthKitService.shared.workouts(days: 90)
        var added = 0
        for hw in list {
            let uid = "health-\(hw.uuid.uuidString)"
            if existing(uid: uid) != nil { continue }
            // skip if the same session already exists from Strong/Strava
            let lo = hw.start.addingTimeInterval(-10 * 60), hi = hw.end.addingTimeInterval(10 * 60)
            let fd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.start < hi && $0.end > lo })
            let overlap = (try? context.fetch(fd)) ?? []
            if let o = overlap.first(where: { $0.sourceRaw == WorkoutSource.strong.rawValue || $0.sourceRaw == WorkoutSource.strava.rawValue }) {
                if o.kcal == nil { o.kcal = hw.kcal }
                continue
            }
            let w = WorkoutRecord(uid: uid, source: .health, start: hw.start, end: hw.end, sport: hw.activity,
                                  name: "\(hw.activity) · \(hw.sourceName)")
            w.kcal = hw.kcal; w.distanceKm = hw.distanceKm
            for o in overlap where o.sourceRaw == WorkoutSource.strap.rawValue {
                w.avgHR = o.avgHR; w.maxHR = o.maxHR; w.strain = o.strain; w.zoneSeconds = o.zoneSeconds
                context.delete(o)
            }
            context.insert(w)
            added += 1
        }
        try? context.save()
        return added
    }

    // MARK: Strava

    func importStrava() async throws -> Int {
        let since = Calendar.current.date(byAdding: .day, value: -60, to: Date())
        let acts = try await StravaService.shared.activities(after: since, perPage: 100)
        var added = 0
        for a in acts {
            let uid = "strava-\(a.id)"
            let end = a.start_date.addingTimeInterval(TimeInterval(a.elapsed_time))
            // skip activities that were uploaded from Pulso
            if let w = existing(uid: uid) { w.name = a.name; continue }
            let lo = a.start_date.addingTimeInterval(-10 * 60), hi = end.addingTimeInterval(10 * 60)
            let fd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.start < hi && $0.end > lo })
            let overlap = (try? context.fetch(fd)) ?? []
            if let mine = overlap.first(where: { $0.stravaId == a.id }) { mine.name = a.name; continue }
            let w = WorkoutRecord(uid: uid, source: .strava, start: a.start_date, end: end,
                                  sport: StravaService.spanishSport(a.sport), name: a.name)
            w.distanceKm = (a.distance ?? 0) / 1000
            w.avgHR = a.average_heartrate; w.maxHR = a.max_heartrate
            w.kcal = a.calories ?? a.kilojoules.map { $0 / 4.184 / 0.24 }
            w.stravaId = a.id
            for o in overlap where o.sourceRaw == WorkoutSource.strap.rawValue || o.sourceRaw == WorkoutSource.health.rawValue {
                w.avgHR = w.avgHR ?? o.avgHR; w.maxHR = w.maxHR ?? o.maxHR; w.strain = o.strain
                w.zoneSeconds = o.zoneSeconds
                context.delete(o)
            }
            context.insert(w)
            added += 1
        }
        try? context.save()
        return added
    }

    /// Uploads a workout to Strava as a TCX with the strap HR (or as a manual activity if there is no HR).
    func uploadToStrava(_ w: WorkoutRecord) async throws {
        let samples = await SampleStore.shared.samples(from: Int(w.start.timeIntervalSince1970), to: Int(w.end.timeIntervalSince1970))
        var desc = "Registrado con Pulso"
        if let s = w.strain { desc += " · Strain \(String(format: "%.1f", s))" }
        if let st = w.strong {
            let lines = Dictionary(grouping: st.sets.filter { !$0.isWarmup }, by: \.exercise)
                .sorted { $0.key < $1.key }
                .map { k, v in "• \(k): " + v.map { "\(AICoach.fmt($0.weightKg))kg×\($0.reps)" }.joined(separator: ", ") }
            desc += "\n\n" + lines.joined(separator: "\n")
            desc += "\n\nVolumen total: \(Int(st.totalVolumeKg)) kg"
        }
        let sportTCX = w.sport == "Carrera" ? "Running" : (w.sport == "Ciclismo" ? "Biking" : "Other")
        if samples.filter({ $0.bpm > 0 }).count > 60 {
            let tcx = TCXExporter.make(start: w.start, end: w.end, sport: sportTCX, samples: samples, calories: w.kcal ?? 0, notes: desc)
            let id = try await StravaService.shared.uploadTCX(tcx, name: w.name, description: desc, externalId: "pulso-\(w.uid)")
            w.stravaId = id
        } else {
            let sport = w.strong != nil ? "WeightTraining" : "Workout"
            w.stravaId = try await StravaService.shared.createActivity(name: w.name, sportType: sport, start: w.start,
                                                                      elapsedSeconds: Int(w.end.timeIntervalSince(w.start)), description: desc)
        }
        w.stravaUploaded = true
        try? context.save()
    }
}
