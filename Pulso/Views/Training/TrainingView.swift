import SwiftUI
import SwiftData
import Charts
import UniformTypeIdentifiers
import WhoopKit

struct TrainingView: View {
    @State private var section = 0
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $section) {
                    Text("Plan").tag(0)
                    Text("Historial").tag(1)
                    Text("Progreso").tag(2)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal).padding(.vertical, 8)
                switch section {
                case 0: PlanTab()
                case 1: HistoryTab()
                default: ProgressTab()
                }
            }
            .screenBackground()
            .navigationTitle("Entreno")
        }
    }
}

// MARK: - Plan

struct PlanTab: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \PlanRecord.createdAt, order: .reverse) private var plans: [PlanRecord]
    @State private var showBuilder = false
    @State private var weekIndex = 0
    @State private var showLive = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let active = plans.first(where: \.isActive), let plan = active.plan {
                    Card(title: plan.name, icon: plan.source == "ia" ? "sparkles" : "list.bullet.clipboard") {
                        Text(plan.summary).font(.subheadline).foregroundStyle(Theme.secondaryText)
                        Text("Inicio: \(plan.startDate.formatted(date: .abbreviated, time: .omitted)) · \(plan.weeks.count) semanas").font(.caption)
                    }
                    let todayRec = model.record(for: Date())?.metrics.recovery
                    if let today = plan.session(on: Date()) {
                        let a = PlanGenerator.adapt(today.session, recovery: todayRec)
                        NavigationLink { SessionDetailView(session: a.session, note: a.note, weekPhase: today.week.phase) } label: {
                            Card(title: "Hoy: \(a.session.title)", icon: "calendar.badge.clock") {
                                Text(a.note).font(.subheadline)
                                HStack {
                                    Text("~\(a.session.estimatedMinutes) min · strain objetivo \(Int(a.session.targetStrain))").font(.caption).foregroundStyle(Theme.secondaryText)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        Button { showLive = true } label: { Label("Empezar entreno con FC en directo", systemImage: "record.circle").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent)
                    }
                    Picker("Semana", selection: $weekIndex) {
                        ForEach(plan.weeks) { w in Text("S\(w.index + 1)").tag(w.index) }
                    }
                    .pickerStyle(.segmented)
                    if weekIndex < plan.weeks.count {
                        let w = plan.weeks[weekIndex]
                        Card(title: "Semana \(w.index + 1) · \(w.phase)", icon: "calendar") {
                            Text(w.focus).font(.caption).foregroundStyle(Theme.secondaryText)
                            ForEach(w.sessions) { s in
                                NavigationLink { SessionDetailView(session: s, note: nil, weekPhase: w.phase) } label: {
                                    HStack {
                                        Text(Self.weekdayName(s.weekday)).font(.caption.bold()).frame(width: 34, alignment: .leading).foregroundStyle(Theme.accent)
                                        VStack(alignment: .leading) {
                                            Text(s.title).font(.subheadline.weight(.semibold))
                                            Text(s.kind == .cardio ? (s.cardio?.description ?? "") : "\(s.exercises.count) ejercicios · ~\(s.estimatedMinutes) min")
                                                .font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.secondaryText)
                                    }
                                }
                                .buttonStyle(.plain)
                                Divider()
                            }
                        }
                    }
                } else {
                    Card {
                        EmptyStateView(icon: "list.bullet.clipboard", title: "Sin plan activo",
                                       message: "Genera un plan periodizado según tu objetivo. Cada día se adaptará a tu recuperación.")
                    }
                }
                Button { showBuilder = true } label: { Label("Crear nuevo plan", systemImage: "plus.circle.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                if plans.count > 1 {
                    Card(title: "Planes anteriores", icon: "clock.arrow.circlepath") {
                        ForEach(plans.filter { !$0.isActive }) { p in
                            HStack {
                                Text(p.plan?.name ?? "Plan").font(.subheadline)
                                Spacer()
                                Button("Activar") {
                                    for x in plans { x.isActive = (x.uid == p.uid) }
                                    try? model.context.save()
                                }
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .onAppear {
            if let plan = plans.first(where: \.isActive)?.plan,
               let d = Calendar.current.dateComponents([.day], from: plan.startDate, to: Date()).day, d >= 0 {
                weekIndex = min(plan.weeks.count - 1, d / 7)
            }
        }
        .sheet(isPresented: $showBuilder) { PlanBuilderView() }
        .sheet(isPresented: $showLive) { LiveWorkoutView() }
    }

    static func weekdayName(_ d: Int) -> String { ["", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"][max(0, min(7, d))] }
}

struct SessionDetailView: View {
    @Environment(AppModel.self) private var model
    let session: PlannedSession
    let note: String?
    let weekPhase: String
    @State private var showLive = false

    var body: some View {
        let orms = StrongImporter.oneRepMaxes(model.strongWorkouts())
        List {
            if let note { Section { Text(note) } }
            Section("Ejercicios") {
                ForEach(session.exercises) { e in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(e.name).font(.headline)
                            Spacer()
                            Text("\(e.sets) × \(e.reps)").font(.headline.monospacedDigit()).foregroundStyle(Theme.accent)
                        }
                        HStack(spacing: 12) {
                            Label("RIR \(e.rir)", systemImage: "gauge.with.dots.needle.33percent")
                            Label("\(e.restSeconds / 60):\(String(format: "%02d", e.restSeconds % 60))", systemImage: "timer")
                            if let kg = e.suggestedKg ?? suggested(e, orms) { Label("~\(AICoach.fmt(kg)) kg", systemImage: "scalemass") }
                        }
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                        if !e.notes.isEmpty { Text(e.notes).font(.caption2).foregroundStyle(Theme.secondaryText) }
                    }
                    .padding(.vertical, 2)
                }
            }
            if let c = session.cardio {
                Section("Cardio") {
                    Text(c.description)
                    StatRow(label: "Duración", value: "\(c.minutes) min")
                    StatRow(label: "Zona", value: "Z\(c.zone)")
                }
            }
            Section {
                StatRow(label: "Fase", value: weekPhase)
                StatRow(label: "Duración estimada", value: "\(session.estimatedMinutes) min")
                StatRow(label: "Strain objetivo", value: "\(Int(session.targetStrain))")
                Text("Registra las series en Strong como siempre: al importar el CSV, Pulso cruzará la sesión con tu FC y calculará su esfuerzo.")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
            }
            Section {
                Button { showLive = true } label: { Label("Empezar con FC en directo", systemImage: "record.circle") }
            }
        }
        .screenBackground()
        .navigationTitle(session.title)
        .sheet(isPresented: $showLive) { LiveWorkoutView(sessionTitle: session.title) }
    }

    func suggested(_ e: PlannedExercise, _ orms: [String: Double]) -> Double? {
        guard let ex = ExerciseLibrary.byKey(e.exerciseKey), let orm = orms[ex.strongName],
              let reps = Int(e.reps.split(separator: "-").last ?? "") else { return nil }
        return PlanGenerator.suggestedLoad(oneRM: orm, reps: reps, rir: e.rir)
    }
}

struct PlanBuilderView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var req = PlanRequest()
    @State private var extra = ""
    @State private var useAI = false
    @State private var generating = false
    @State private var error: String?
    @State private var preview: TrainingPlan?

    var body: some View {
        NavigationStack {
            Form {
                Section("Objetivo") {
                    Picker("Objetivo", selection: $req.goal) { ForEach(TrainingGoal.allCases) { Text($0.spanish).tag($0) } }
                    Picker("Nivel", selection: $req.experience) { ForEach(ExperienceLevel.allCases) { Text($0.spanish).tag($0) } }
                }
                Section("Estructura") {
                    Stepper("Días por semana: \(req.daysPerWeek)", value: $req.daysPerWeek, in: 2...6)
                    Stepper("Duración: \(req.sessionMinutes) min", value: $req.sessionMinutes, in: 30...120, step: 5)
                    Stepper("Semanas: \(req.weeks)", value: $req.weeks, in: 4...16, step: 1)
                    Picker("Material", selection: $req.equipment) { ForEach(Equipment.allCases, id: \.self) { Text($0.spanish).tag($0) } }
                    Picker("Cardio", selection: $req.cardio) { ForEach(CardioPreference.allCases) { Text($0.spanish).tag($0) } }
                }
                Section("Músculos prioritarios") {
                    ForEach([MuscleGroup.chest, .back, .shoulders, .biceps, .triceps, .quads, .hamstrings, .glutes, .calves, .core], id: \.self) { m in
                        Toggle(m.spanish, isOn: Binding(get: { req.priorityMuscles.contains(m) }, set: { on in
                            if on { req.priorityMuscles.append(m) } else { req.priorityMuscles.removeAll { $0 == m } }
                        }))
                    }
                }
                Section {
                    Toggle(isOn: $useAI) {
                        VStack(alignment: .leading) {
                            Text("Generar con IA (Claude)")
                            Text(settings.hasAnthropicKey ? "Usa tus datos, 1RM de Strong y recuperación para personalizarlo." : "Necesita tu clave de Anthropic (Ajustes).")
                                .font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    .disabled(!settings.hasAnthropicKey)
                    if useAI {
                        TextField("Indicaciones extra (lesiones, horarios, deportes…)", text: $extra, axis: .vertical).lineLimit(2...5)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.red) } }
                if let p = preview {
                    Section("Vista previa") {
                        Text(p.name).font(.headline)
                        Text(p.summary).font(.caption)
                        ForEach(p.weeks.first?.sessions ?? []) { s in
                            Text("\(PlanTab.weekdayName(s.weekday)) · \(s.title) (\(s.exercises.count) ej.)").font(.caption)
                        }
                        Button("Activar este plan") {
                            model.activate(plan: p)
                            dismiss()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Nuevo plan")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if generating { ProgressView() } else { Button("Generar") { generate() } }
                }
            }
        }
    }

    func generate() {
        error = nil
        let start = Calendar.current.nextDate(after: Calendar.current.date(byAdding: .day, value: -1, to: Date())!,
                                              matching: DateComponents(weekday: 2), matchingPolicy: .nextTime) ?? Date()
        if useAI {
            generating = true
            Task {
                do {
                    var p = try await model.coach.generatePlan(request: req, extra: extra)
                    p.startDate = start
                    preview = p
                } catch {
                    self.error = error.localizedDescription
                }
                generating = false
            }
        } else {
            let orms = StrongImporter.oneRepMaxes(model.strongWorkouts())
            preview = PlanGenerator.generate(req, startDate: start, oneRepMaxes: orms)
        }
    }
}

// MARK: - History

struct HistoryTab: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Query(sort: \WorkoutRecord.start, order: .reverse) private var workouts: [WorkoutRecord]
    @State private var importing = false
    @State private var syncing = false
    @State private var filter: WorkoutSource? = nil

    var body: some View {
        List {
            Section {
                HStack {
                    Button { importing = true } label: { Label("Importar CSV de Strong", systemImage: "square.and.arrow.down") }
                    Spacer()
                    if syncing { ProgressView() } else {
                        Button { Task { await syncAll() } } label: { Image(systemName: "arrow.triangle.2.circlepath") }
                    }
                }
                Picker("Fuente", selection: $filter) {
                    Text("Todas").tag(WorkoutSource?.none)
                    ForEach(WorkoutSource.allCases, id: \.self) { Text($0.spanish).tag(Optional($0)) }
                }
            }
            ForEach(filtered) { w in
                NavigationLink { WorkoutDetailView(workout: w) } label: { WorkoutRow(workout: w) }
            }
            .onDelete { idx in
                for i in idx { model.context.delete(filtered[i]) }
                try? model.context.save()
            }
            if workouts.isEmpty {
                Text("Sin entrenamientos. Importa tu CSV de Strong (Strong › Ajustes › Exportar datos), conecta Strava o activa Apple Salud.")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText, .data]) { result in
            if case .success(let url) = result {
                do {
                    let r = try model.integrations.importStrong(url: url)
                    model.banner = "Strong: \(r.added) entrenos nuevos (\(r.total) en el archivo)."
                } catch { model.banner = error.localizedDescription }
            }
        }
        .refreshable { await syncAll() }
    }

    var filtered: [WorkoutRecord] { filter.map { f in workouts.filter { $0.source == f } } ?? workouts }

    func syncAll() async {
        syncing = true
        var msg: [String] = []
        if StravaService.shared.isConnected {
            do { msg.append("Strava +\(try await model.integrations.importStrava())") } catch { msg.append(error.localizedDescription) }
        }
        if settings.healthKitEnabled { msg.append("Salud +\(await model.integrations.importHealthWorkouts())") }
        syncing = false
        if !msg.isEmpty { model.banner = msg.joined(separator: " · ") }
    }
}

struct WorkoutRow: View {
    let workout: WorkoutRecord
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: workout.source.icon).foregroundStyle(Theme.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(workout.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text("\(workout.start.formatted(date: .abbreviated, time: .shortened)) · \(Int(workout.durationMin)) min")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
                if let st = workout.strong {
                    Text("\(st.workingSets) series · \(Int(st.totalVolumeKg)) kg volumen").font(.caption2).foregroundStyle(Theme.secondaryText)
                } else if let d = workout.distanceKm, d > 0 {
                    Text(String(format: "%.2f km", d)).font(.caption2).foregroundStyle(Theme.secondaryText)
                }
            }
            Spacer()
            if let s = workout.strain {
                Text(String(format: "%.1f", s)).font(.headline).foregroundStyle(Theme.strain)
            }
            if workout.stravaUploaded { Image(systemName: "checkmark.seal.fill").foregroundStyle(.orange).font(.caption) }
        }
    }
}

struct WorkoutDetailView: View {
    @Environment(AppModel.self) private var model
    @Bindable var workout: WorkoutRecord
    @State private var samples: [StrapSample] = []
    @State private var uploading = false

    struct P: Identifiable { let id: Int; let date: Date; let bpm: Double }

    var body: some View {
        let hrMax = AppSettings.shared.profile.physio.hrMax
        List {
            Section {
                TextField("Nombre", text: $workout.name)
                StatRow(label: "Fuente", value: workout.source.spanish)
                StatRow(label: "Inicio", value: workout.start.formatted(date: .abbreviated, time: .shortened))
                StatRow(label: "Duración", value: Fmt.hm(workout.durationMin))
                if let s = workout.strain { StatRow(label: "Esfuerzo", value: String(format: "%.1f", s)) }
                if let hr = workout.avgHR { StatRow(label: "FC media / máx", value: "\(Int(hr)) / \(Fmt.num(workout.maxHR)) lpm") }
                if let k = workout.kcal { StatRow(label: "Calorías", value: "\(Int(k)) kcal") }
                if let d = workout.distanceKm, d > 0 { StatRow(label: "Distancia", value: String(format: "%.2f km", d)) }
            }
            if !samples.isEmpty {
                Section("Frecuencia cardiaca (pulsera)") {
                    let pts = stride(from: 0, to: samples.count, by: 5).map { i in
                        P(id: i, date: samples[i].date, bpm: Double(samples[i].bpm))
                    }.filter { $0.bpm > 0 }
                    Chart(pts) { p in
                        LineMark(x: .value("t", p.date), y: .value("FC", p.bpm))
                            .foregroundStyle(Theme.zone(HRZone.of(bpm: p.bpm, hrMax: hrMax).rawValue))
                    }
                    .chartYScale(domain: .automatic(includesZero: false))
                    .frame(height: 160)
                }
            }
            if !workout.zoneSeconds.isEmpty {
                Section("Zonas") {
                    ZoneBar(zoneSeconds: workout.zoneSeconds)
                    ForEach(1..<min(6, workout.zoneSeconds.count), id: \.self) { z in
                        StatRow(label: HRZone(rawValue: z)?.spanish ?? "Z\(z)", value: Fmt.hm(Double(workout.zoneSeconds[z]) / 60))
                    }
                }
            }
            if let st = workout.strong {
                Section("Series (Strong)") {
                    ForEach(st.exercises, id: \.self) { ex in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ex).font(.subheadline.weight(.semibold))
                            let sets = st.sets.filter { $0.exercise == ex }
                            Text(sets.map { s in "\(s.isWarmup ? "W " : "")\(AICoach.fmt(s.weightKg))×\(s.reps)\(s.rpe.map { " @\(AICoach.fmt($0))" } ?? "")" }.joined(separator: "  ·  "))
                                .font(.caption.monospacedDigit()).foregroundStyle(Theme.secondaryText)
                            if let best = sets.compactMap(\.e1RM).max() {
                                Text("1RM est. \(Int(best)) kg").font(.caption2).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                    StatRow(label: "Volumen total", value: "\(Int(st.totalVolumeKg)) kg")
                }
            }
            Section {
                if workout.source != .strava {
                    Button {
                        uploading = true
                        Task {
                            do { try await model.integrations.uploadToStrava(workout); model.banner = "Subido a Strava ✅" }
                            catch { model.banner = error.localizedDescription }
                            uploading = false
                        }
                    } label: {
                        HStack {
                            Label(workout.stravaUploaded ? "Volver a subir a Strava" : "Subir a Strava (con FC de la pulsera)", systemImage: "arrow.up.circle")
                            if uploading { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(!StravaService.shared.isConnected || uploading)
                }
                if let id = workout.stravaId, let url = URL(string: "https://www.strava.com/activities/\(id)") {
                    Link("Ver en Strava", destination: url)
                }
            }
            Section("Notas") {
                TextField("Notas", text: $workout.notes, axis: .vertical)
            }
        }
        .screenBackground()
        .navigationTitle(workout.sport)
        .task {
            samples = await SampleStore.shared.samples(from: Int(workout.start.timeIntervalSince1970), to: Int(workout.end.timeIntervalSince1970))
            if workout.strain == nil, samples.count > 120 {
                let rhr = model.record(for: workout.start)?.metrics.rhr ?? 60
                let st = Strain.compute(samples, profile: AppSettings.shared.profile.physio, restingHR: rhr)
                workout.strain = st.strain; workout.avgHR = st.avgHR; workout.maxHR = st.maxHR
                workout.zoneSeconds = st.zoneSeconds
                if workout.kcal == nil { workout.kcal = st.kcal }
            }
        }
        .onDisappear { try? model.context.save() }
    }
}

// MARK: - Progress

struct ProgressTab: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \WorkoutRecord.start) private var workouts: [WorkoutRecord]
    @State private var selectedExercise: String?

    var body: some View {
        let strong = workouts.compactMap(\.strong)
        let progress = StrongImporter.progress(strong)
        let prs = StrongImporter.personalRecords(strong)
        let weekly = StrongImporter.weeklySetsPerMuscle(strong)
        ScrollView {
            VStack(spacing: 14) {
                if strong.isEmpty {
                    Card { EmptyStateView(icon: "dumbbell", title: "Sin datos de fuerza", message: "Importa tu historial de Strong para ver progresión, 1RM estimados y volumen por músculo.") }
                } else {
                    Card(title: "Progresión (1RM estimado)", icon: "chart.line.uptrend.xyaxis") {
                        Picker("Ejercicio", selection: Binding(get: { selectedExercise ?? progress.first?.exercise ?? "" }, set: { selectedExercise = $0 })) {
                            ForEach(progress.prefix(30)) { p in Text(p.exercise).tag(p.exercise) }
                        }
                        if let p = progress.first(where: { $0.exercise == (selectedExercise ?? progress.first?.exercise) }) {
                            let pts = p.points.filter { $0.e1RM > 0 }.map { DayPoint(date: $0.date, value: $0.e1RM) }
                            Chart(pts) { pt in
                                LineMark(x: .value("Fecha", pt.date), y: .value("1RM", pt.value)).foregroundStyle(Theme.accent)
                                PointMark(x: .value("Fecha", pt.date), y: .value("1RM", pt.value)).foregroundStyle(Theme.accent)
                            }
                            .chartYScale(domain: .automatic(includesZero: false))
                            .frame(height: 180)
                            HStack {
                                Text("Mejor: \(Int(p.bestE1RM)) kg").font(.caption.bold())
                                Spacer()
                                if let first = pts.first?.value, let last = pts.last?.value, first > 0 {
                                    Text(String(format: "%+.1f %% desde el inicio", (last - first) / first * 100)).font(.caption)
                                        .foregroundStyle(last >= first ? Theme.green : Theme.red)
                                }
                            }
                        }
                    }
                    Card(title: "Series por músculo (7 días)", icon: "figure.arms.open") {
                        let rows = weekly.sorted { $0.value > $1.value }
                        if rows.isEmpty { Text("Sin entrenos esta semana").font(.caption).foregroundStyle(Theme.secondaryText) }
                        ForEach(rows, id: \.key) { row in
                            let m = row.key, n = row.value
                            HStack {
                                Text(m.spanish).font(.subheadline).frame(width: 110, alignment: .leading)
                                GeometryReader { g in
                                    Capsule().fill(n >= 10 && n <= 20 ? Theme.green : (n > 20 ? Theme.yellow : Theme.strain))
                                        .frame(width: min(g.size.width, g.size.width * CGFloat(n) / 22))
                                }
                                .frame(height: 8)
                                Text("\(n)").font(.caption.monospacedDigit()).frame(width: 28)
                            }
                        }
                        Text("Referencia hipertrofia: 10–20 series semanales por grupo muscular.").font(.caption2).foregroundStyle(Theme.secondaryText)
                    }
                    Card(title: "Récords personales", icon: "trophy.fill") {
                        ForEach(prs.prefix(12), id: \.exercise) { pr in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(pr.exercise).font(.subheadline).lineLimit(1)
                                    Text("\(AICoach.fmt(pr.weight)) kg × \(pr.reps) · \(pr.date.formatted(date: .abbreviated, time: .omitted))").font(.caption2).foregroundStyle(Theme.secondaryText)
                                }
                                Spacer()
                                Text("\(Int(pr.e1RM)) kg").font(.headline.monospacedDigit()).foregroundStyle(Theme.yellow)
                            }
                        }
                    }
                    let weeklyVolume = Dictionary(grouping: strong) { Calendar.current.dateInterval(of: .weekOfYear, for: $0.date)?.start ?? $0.date }
                        .map { DayPoint(date: $0.key, value: $0.value.reduce(0) { $0 + $1.totalVolumeKg } / 1000) }
                        .sorted { $0.date < $1.date }
                    Card(title: "Volumen semanal (toneladas)", icon: "scalemass") {
                        Chart(weeklyVolume.suffix(16)) { p in BarMark(x: .value("Semana", p.date, unit: .weekOfYear), y: .value("t", p.value)).foregroundStyle(Theme.strain) }
                            .frame(height: 150)
                    }
                }
            }
            .padding()
        }
    }
}
