import Foundation
import SwiftData
import Observation
import BackgroundTasks
import WhoopKit

/// Central coordinator: wires BLE → storage → analysis → notifications / Health / UI.
@MainActor
@Observable
final class AppModel {
    let container: ModelContainer
    let context: ModelContext
    let settings = AppSettings.shared
    let ble = WhoopBLEManager.shared
    let engine: AnalysisEngine
    let coach: AICoach
    let integrations: IntegrationService

    var selectedDate = Calendar.current.startOfDay(for: Date())
    var isAnalyzing = false
    var analysisProgress: Double = 0
    var banner: String?
    var reportVersion = 0          // bump to refresh views after analysis
    var liveBuffer: [(Date, Int)] = []

    static let refreshTaskID = "com.pulso.app.refresh"
    static let processingTaskID = "com.pulso.app.processing"

    init() {
        do {
            container = try ModelContainer(for: DailyRecord.self, BodyMeasurement.self, WorkoutRecord.self, PlanRecord.self,
                                           JournalEntry.self, ChatMessageRecord.self, DeviceEventRecord.self)
        } catch {
            fatalError("No se pudo abrir la base de datos: \(error)")
        }
        context = container.mainContext
        engine = AnalysisEngine(context: context)
        coach = AICoach(context: context)
        integrations = IntegrationService(context: context)
        wireBLE()
    }

    // MARK: BLE wiring

    private func wireBLE() {
        ble.onHistorySamples = { [weak self] samples in
            guard let self else { return false }
            do {
                if let range = try await SampleStore.shared.append(samples) {
                    self.pendingRange = self.pendingRange.map { min($0.lowerBound, range.lowerBound)...max($0.upperBound, range.upperBound) } ?? range
                }
                return true
            } catch {
                return false
            }
        }
        ble.onSyncFinished = { [weak self] in
            Task { await self?.processPending() }
        }
        ble.onLiveHR = { [weak self] bpm, _ in
            guard let self else { return }
            self.liveBuffer.append((Date(), bpm))
            if self.liveBuffer.count > 7200 { self.liveBuffer.removeFirst(1200) }
        }
        ble.onEvent = { [weak self] e in
            guard let self, let code = e.code else { return }
            let important: Set<WhoopEventCode> = [.wristOn, .wristOff, .chargingOn, .chargingOff, .doubleTap, .strapAlarmExecuted, .rtcLost]
            if important.contains(code) {
                self.context.insert(DeviceEventRecord(date: Date(), code: Int(code.rawValue), label: code.spanishName))
                try? self.context.save()
            }
            if code == .doubleTap, self.settings.doubleTapAction == "workout" { self.doubleTapHandler?() }
            if code == .rtcLost { self.banner = "La pulsera perdió la hora: se ha vuelto a sincronizar el reloj." }
        }
    }

    var doubleTapHandler: (() -> Void)?
    private var pendingRange: ClosedRange<Int>?

    func start() {
        ble.start()
        Task { await maintenance() }
    }

    /// Runs analysis for days touched by newly synced data.
    func processPending() async {
        guard let range = pendingRange else { return }
        pendingRange = nil
        let days = engine.affectedDays(for: range)
        await analyze(days: days)
    }

    func analyze(days: [Date]) async {
        guard !days.isEmpty else { return }
        isAnalyzing = true
        let steps = settings.healthKitEnabled ? await HealthKitService.shared.dailySteps(days: 14) : [:]
        let reports = await engine.analyze(days: days, steps: steps)
        isAnalyzing = false
        reportVersion += 1
        await afterAnalysis(reports)
    }

    private func afterAnalysis(_ reports: [DayReport]) async {
        let todayKey = DayKey.key(Date())
        guard let today = reports.first(where: { $0.metrics.dayKey == todayKey }) else { return }
        if today.sleep != nil { NotificationService.notifyRecovery(today) }
        if let need = today.nextNightNeed {
            let wake = settings.nextWake()
            let bed = SleepCoach.recommendedBedtime(wake: wake, need: need)
            NotificationService.scheduleBedtime(bed, needMin: need.totalMin)
        }
        if settings.healthKitEnabled { await HealthKitService.shared.write(report: today) }
        if settings.autoDailyAnalysis, settings.hasAnthropicKey, today.sleep != nil,
           let rec = engine.record(for: todayKey), rec.aiAnalysis == nil {
            await runDailyAnalysis(rec)
        }
        await scheduleSmartAlarmIfNeeded()
    }

    func runDailyAnalysis(_ rec: DailyRecord) async {
        do {
            let text = try await coach.dailyAnalysis(for: rec)
            rec.aiAnalysis = text
            rec.aiAnalysisAt = Date()
            try? context.save()
            reportVersion += 1
        } catch {
            banner = error.localizedDescription
        }
    }

    // MARK: Smart alarm

    /// Programs the strap's own alarm at the desired wake time (it vibrates even if the phone is
    /// away). If the app is connected during the wake window, `checkSmartWake` can fire earlier in
    /// light sleep.
    func scheduleSmartAlarmIfNeeded() async {
        guard settings.smartAlarmEnabled, ble.connection.isConnected else { return }
        let wake = settings.nextWake()
        guard wake.timeIntervalSinceNow < 20 * 3600 else { return }
        let key = "alarmSet-\(Int(wake.timeIntervalSince1970))"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        if await ble.setAlarm(wake) { UserDefaults.standard.set(true, forKey: key) }
    }

    func checkSmartWake() async {
        guard settings.smartAlarmEnabled, ble.connection.isConnected else { return }
        let wake = settings.nextWake(after: Date().addingTimeInterval(-3600))
        let windowStart = wake.addingTimeInterval(-Double(settings.smartAlarmWindowMin) * 60)
        let now = Date()
        guard now >= windowStart, now < wake else { return }
        let firedKey = "smartFired-\(DayKey.key(now))"
        guard !UserDefaults.standard.bool(forKey: firedKey) else { return }
        let samples = await SampleStore.shared.samples(from: Int(now.timeIntervalSince1970) - 900, to: Int(now.timeIntervalSince1970))
        let epochs = Epochs.build(samples)
        guard epochs.count >= 8 else { return }
        let motion = epochs.suffix(5).compactMap(\.motion).reduce(0, +)
        let hrs = epochs.compactMap(\.hr)
        let rising = (hrs.suffix(3).reduce(0, +) / 3) > (hrs.prefix(5).reduce(0, +) / 5) + 3
        if motion > 8 || rising {
            UserDefaults.standard.set(true, forKey: firedKey)
            ble.buzz()
            await ble.disableAlarm()
            NotificationService.notify("⏰ Despertador inteligente", "Te despierto en sueño ligero, \(Int(wake.timeIntervalSince(now) / 60)) min antes de tu hora.")
        }
    }

    // MARK: Background

    static func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskID, using: nil) { task in
            Task { @MainActor in
                AppModel.scheduleBackgroundRefresh()
                let model = PulsoApp.sharedModel
                model?.ble.syncNow()
                try? await Task.sleep(for: .seconds(25))
                await model?.processPending()
                await model?.checkSmartWake()
                task.setTaskCompleted(success: true)
            }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingTaskID, using: nil) { task in
            Task { @MainActor in
                await PulsoApp.sharedModel?.processPending()
                AppModel.scheduleProcessing()
                task.setTaskCompleted(success: true)
            }
        }
    }

    static func scheduleBackgroundRefresh() {
        let r = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        r.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        try? BGTaskScheduler.shared.submit(r)
    }

    static func scheduleProcessing() {
        let r = BGProcessingTaskRequest(identifier: processingTaskID)
        r.requiresExternalPower = false
        r.requiresNetworkConnectivity = false
        r.earliestBeginDate = Date().addingTimeInterval(60 * 60)
        try? BGTaskScheduler.shared.submit(r)
    }

    /// Housekeeping on launch: analyze today if stale, import integrations.
    func maintenance() async {
        let todayKey = DayKey.key(Date())
        let stale = engine.record(for: todayKey).map { Date().timeIntervalSince($0.updatedAt) > 30 * 60 } ?? true
        if stale {
            let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()
            await analyze(days: [Calendar.current.startOfDay(for: yesterday), Calendar.current.startOfDay(for: Date())])
        }
        if settings.healthKitEnabled { _ = await integrations.importHealthWorkouts() }
        if StravaService.shared.isConnected { _ = try? await integrations.importStrava() }
    }

    // MARK: Queries for views

    func record(for date: Date) -> DailyRecord? { engine.record(for: DayKey.key(date)) }

    func recentMetrics(days: Int) -> [DayMetrics] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let fd = FetchDescriptor<DailyRecord>(predicate: #Predicate { $0.dayStart >= since }, sortBy: [SortDescriptor(\.dayStart)])
        return ((try? context.fetch(fd)) ?? []).map(\.metrics)
    }

    var activePlan: PlanRecord? {
        var fd = FetchDescriptor<PlanRecord>(predicate: #Predicate { $0.isActive })
        fd.fetchLimit = 1
        return try? context.fetch(fd).first
    }

    func activate(plan: TrainingPlan) {
        for p in (try? context.fetch(FetchDescriptor<PlanRecord>())) ?? [] { p.isActive = false }
        context.insert(PlanRecord(plan: plan, active: true))
        try? context.save()
    }

    func strongWorkouts() -> [StrongWorkout] {
        let fd = FetchDescriptor<WorkoutRecord>(sortBy: [SortDescriptor(\.start)])
        return ((try? context.fetch(fd)) ?? []).compactMap(\.strong)
    }
}
