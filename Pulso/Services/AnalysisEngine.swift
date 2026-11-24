import Foundation
import SwiftData
import WhoopKit

/// Turns stored samples into DayReports (off the main thread) and persists them.
@MainActor
final class AnalysisEngine {
    let context: ModelContext
    let settings = AppSettings.shared
    private(set) var isRunning = false
    private var queued: Set<String> = []

    init(context: ModelContext) { self.context = context }

    /// Days whose report can change when samples in `range` arrive (late-evening data affects the
    /// next day's sleep).
    func affectedDays(for range: ClosedRange<Int>) -> [Date] {
        let cal = Calendar.current
        var out: [Date] = []
        var d = cal.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(range.lowerBound)))
        let last = cal.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(range.upperBound + 8 * 3600)))
        let today = cal.startOfDay(for: Date())
        while d <= min(last, today) {
            out.append(d)
            d = cal.date(byAdding: .day, value: 1, to: d) ?? d.addingTimeInterval(86400)
        }
        return out
    }

    func history(before dayStart: Date, limit: Int = 45) -> [DayMetrics] {
        var fd = FetchDescriptor<DailyRecord>(predicate: #Predicate { $0.dayStart < dayStart },
                                              sortBy: [SortDescriptor(\.dayStart, order: .reverse)])
        fd.fetchLimit = limit
        return ((try? context.fetch(fd)) ?? []).map(\.metrics)
    }

    func record(for key: String) -> DailyRecord? {
        var fd = FetchDescriptor<DailyRecord>(predicate: #Predicate { $0.dayKey == key })
        fd.fetchLimit = 1
        return try? context.fetch(fd).first
    }

    /// Analyzes the given days in chronological order (baselines depend on earlier days).
    @discardableResult
    func analyze(days: [Date], steps: [String: Double] = [:]) async -> [DayReport] {
        let profile = settings.profile.physio
        var reports: [DayReport] = []
        isRunning = true
        defer { isRunning = false }
        for day in days.sorted() {
            let key = DayKey.key(day)
            let b = DayKey.bounds(day)
            let samples = await SampleStore.shared.samples(from: b.start - 8 * 3600, to: b.end)
            guard samples.count > 600 else { continue }
            let hist = history(before: day)
            let now = Int(Date().timeIntervalSince1970)
            var report = await Task.detached(priority: .userInitiated) {
                DayAnalyzer.analyze(samples: samples, dayKey: key, dayStart: b.start, dayEnd: b.end,
                                    profile: profile, history: hist, now: now)
            }.value
            if let st = steps[key] { report.metrics.steps = st }
            else if let existing = record(for: key)?.metrics.steps { report.metrics.steps = existing }
            if let rec = record(for: key) {
                rec.update(report: report)
            } else {
                context.insert(DailyRecord(dayKey: key, dayStart: day, metrics: report.metrics, report: report))
            }
            upsertDetectedActivities(report)
            reports.append(report)
        }
        try? context.save()
        return reports
    }

    /// Stores auto-detected activities as workouts, or enriches overlapping imported workouts
    /// (Strong / Strava / Health) with strap HR data.
    private func upsertDetectedActivities(_ r: DayReport) {
        for a in r.activities {
            let start = Date(timeIntervalSince1970: TimeInterval(a.start))
            let end = Date(timeIntervalSince1970: TimeInterval(a.end))
            let lo = start.addingTimeInterval(-20 * 60), hi = end.addingTimeInterval(20 * 60)
            let fd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.start < hi && $0.end > lo })
            let overlapping = (try? context.fetch(fd)) ?? []
            if let other = overlapping.first(where: { $0.sourceRaw != WorkoutSource.strap.rawValue }) {
                if other.avgHR == nil || other.strain == nil {
                    other.avgHR = a.strain.avgHR; other.maxHR = a.strain.maxHR
                    other.strain = a.strain.strain; other.zoneSeconds = a.strain.zoneSeconds
                    if other.kcal == nil { other.kcal = a.strain.kcal }
                }
                // remove a duplicate strap-detected record for the same session
                for dup in overlapping where dup.sourceRaw == WorkoutSource.strap.rawValue { context.delete(dup) }
                continue
            }
            let uid = "strap-\(a.start)"
            let existing = overlapping.first { $0.sourceRaw == WorkoutSource.strap.rawValue }
            let w = existing ?? WorkoutRecord(uid: uid, source: .strap, start: start, end: end, sport: "Actividad",
                                               name: "Actividad detectada")
            w.start = start; w.end = end
            w.avgHR = a.strain.avgHR; w.maxHR = a.strain.maxHR; w.strain = a.strain.strain
            w.kcal = a.strain.kcal; w.zoneSeconds = a.strain.zoneSeconds
            if existing == nil { context.insert(w) }
        }
    }

    /// Recomputes every day with data (e.g. after profile changes).
    func reanalyzeAll(progress: ((Double) -> Void)? = nil) async {
        let days = await SampleStore.shared.availableDays()
        guard let first = days.first, let last = days.last else { return }
        let range = (first * 86400)...(last * 86400 + 86399)
        let all = affectedDays(for: range)
        for (i, chunk) in stride(from: 0, to: all.count, by: 7).map({ Array(all[$0..<min($0 + 7, all.count)]) }).enumerated() {
            await analyze(days: chunk)
            progress?(Double(min(all.count, (i + 1) * 7)) / Double(max(1, all.count)))
        }
    }
}
