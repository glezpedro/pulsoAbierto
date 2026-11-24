import SwiftUI
import Charts
import SwiftData
import WhoopKit

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(AppSettings.self) private var settings
    @State private var showLive = false
    @State private var analyzingAI = false

    private var date: Date { model.selectedDate }

    var body: some View {
        let _ = model.reportVersion
        let record = model.record(for: date)
        let report = record?.report
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    DayNavigator()
                    StrapStatusBar()
                    if let report {
                        RingsRow(report: report)
                        if let t = report.strainTarget, Calendar.current.isDateInToday(date) {
                            StrainTargetCard(current: report.metrics.strain ?? 0, target: t)
                        }
                        KeyMetricsGrid(report: report, history: model.recentMetrics(days: 31))
                        DailyAnalysisCard(record: record!, report: report, running: $analyzingAI)
                        if Calendar.current.isDateInToday(date) { TodayPlanCard(recovery: report.recovery?.score) }
                        HRTimelineCard(report: report)
                        if !report.activities.isEmpty { ActivitiesCard(report: report) }
                        StressSummaryCard(report: report)
                    } else {
                        Card {
                            EmptyStateView(icon: "waveform.path.ecg",
                                           title: "Sin datos para \(Fmt.dayTitle(date).lowercased())",
                                           message: ble.hasKnownStrap
                                           ? "Mantén la pulsera cerca: los datos se descargan solos cada 15 min. También puedes forzar una sincronización."
                                           : "Empareja tu WHOOP 4.0 en Más › Dispositivo, o activa el modo demo en Ajustes para explorar la app.")
                        }
                        if Calendar.current.isDateInToday(date) { TodayPlanCard(recovery: nil) }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 30)
            }
            .refreshable {
                ble.syncNow()
                await model.analyze(days: [date])
            }
            .screenBackground()
            .navigationTitle(Fmt.dayTitle(date))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showLive = true } label: { Image(systemName: "heart.fill").foregroundStyle(Theme.hr) }
                }
            }
            .sheet(isPresented: $showLive) { LiveWorkoutView() }
        }
    }
}

struct DayNavigator: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left") }
            Spacer()
            DatePicker("", selection: Binding(get: { model.selectedDate }, set: { model.selectedDate = Calendar.current.startOfDay(for: $0) }),
                       in: ...Date(), displayedComponents: .date)
                .labelsHidden()
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right") }
                .disabled(Calendar.current.isDateInToday(model.selectedDate))
        }
        .font(.headline)
    }
    private func shift(_ d: Int) {
        if let n = Calendar.current.date(byAdding: .day, value: d, to: model.selectedDate), n <= Date() { model.selectedDate = n }
    }
}

struct StrapStatusBar: View {
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(ble.connection.isConnected ? Theme.green : Color.gray).frame(width: 8, height: 8)
            Text(ble.connection.spanish).font(.caption)
            if ble.connection == .syncing { ProgressView().scaleEffect(0.6); Text("\(ble.syncRecordsThisRun) reg").font(.caption2).foregroundStyle(Theme.secondaryText) }
            if model.isAnalyzing { Text("· analizando").font(.caption2).foregroundStyle(Theme.secondaryText) }
            Spacer()
            if let b = ble.battery {
                Image(systemName: ble.charging ? "battery.100.bolt" : (b > 60 ? "battery.75" : (b > 25 ? "battery.50" : "battery.25")))
                Text("\(Int(b)) %").font(.caption.monospacedDigit())
            }
            if let s = ble.lastSync { Text(s, style: .relative).font(.caption2).foregroundStyle(Theme.secondaryText) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Theme.card, in: Capsule())
    }
}

struct RingsRow: View {
    let report: DayReport
    var body: some View {
        let rec = report.recovery?.score
        let strain = report.metrics.strain
        let sleepPerf = report.sleepScore?.performance
        HStack(spacing: 14) {
            NavigationLink { RecoveryDetailView(report: report) } label: {
                RingView(progress: (rec ?? 0) / 100, color: Theme.recovery(rec), label: "RECUPERACIÓN",
                         value: rec.map { "\(Int($0))%" } ?? "–", caption: report.recovery?.calibrating == true ? "calibrando" : nil)
            }
            NavigationLink { StrainDetailView(report: report) } label: {
                RingView(progress: (strain ?? 0) / 21, color: Theme.strain, label: "ESFUERZO", value: Fmt.num(strain, 1))
            }
            NavigationLink { SleepDetailContainer(report: report) } label: {
                RingView(progress: (sleepPerf ?? 0) / 100, color: Theme.sleep, label: "SUEÑO",
                         value: sleepPerf.map { "\(Int($0))%" } ?? "–",
                         caption: report.sleep.map { Fmt.hmShort(Double($0.minutesAsleep)) })
            }
        }
        .buttonStyle(.plain)
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct StrainTargetCard: View {
    let current: Double
    let target: ClosedRange<Double>
    var body: some View {
        Card(title: "Esfuerzo objetivo", icon: "target") {
            GeometryReader { g in
                let w = g.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.strain.opacity(0.15)).frame(height: 10)
                    Capsule().fill(Theme.strain.opacity(0.45))
                        .frame(width: w * (target.upperBound - target.lowerBound) / 21, height: 10)
                        .offset(x: w * target.lowerBound / 21)
                    Circle().fill(.white).frame(width: 16, height: 16)
                        .offset(x: max(0, min(w - 16, w * current / 21 - 8)))
                }
            }
            .frame(height: 16)
            HStack {
                Text("Actual \(Fmt.num(current, 1))").font(.caption)
                Spacer()
                Text("Objetivo \(Int(target.lowerBound))–\(Int(target.upperBound))").font(.caption.weight(.semibold)).foregroundStyle(Theme.strain)
            }
            Text(current < target.lowerBound ? "Te quedan \(Fmt.num(target.lowerBound - current, 1)) puntos para el rango óptimo."
                 : (current > target.upperBound ? "Has superado el objetivo: prioriza recuperar." : "Estás en el rango óptimo de hoy."))
                .font(.caption).foregroundStyle(Theme.secondaryText)
        }
    }
}

struct KeyMetricsGrid: View {
    @Environment(AppSettings.self) private var settings
    let report: DayReport
    let history: [DayMetrics]

    func baseline(_ kp: KeyPath<DayMetrics, Double?>) -> Double? {
        Stats.mean(history.filter { $0.dayKey != report.metrics.dayKey }.compactMap { $0[keyPath: kp] })
    }

    func delta(_ v: Double?, _ kp: KeyPath<DayMetrics, Double?>, higherIsBetter: Bool, digits: Int = 0) -> (String?, Bool?) {
        guard let v, let b = baseline(kp) else { return (nil, nil) }
        let d = v - b
        guard abs(d) >= pow(10, -Double(digits)) else { return ("= media 30 d", nil) }
        return ("\(d > 0 ? "+" : "")\(String(format: "%.\(digits)f", d)) vs media", higherIsBetter ? d > 0 : d < 0)
    }

    var body: some View {
        let m = report.metrics
        let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
        LazyVGrid(columns: cols, spacing: 10) {
            let h = delta(m.hrv, \.hrv, higherIsBetter: true)
            MetricTile(title: "VFC", value: Fmt.num(m.hrv), unit: "ms", icon: "waveform.path.ecg", color: Theme.green, delta: h.0, deltaGood: h.1)
            let r = delta(m.rhr, \.rhr, higherIsBetter: false)
            MetricTile(title: "FC reposo", value: Fmt.num(m.rhr), unit: "lpm", icon: "heart.fill", color: Theme.hr, delta: r.0, deltaGood: r.1)
            let rr = delta(m.resp, \.resp, higherIsBetter: false, digits: 1)
            MetricTile(title: "Respiración", value: Fmt.num(m.resp, 1), unit: "rpm", icon: "lungs.fill", color: Theme.accent, delta: rr.0, deltaGood: nil)
            MetricTile(title: "Temp. piel", value: tempDelta(), unit: "", icon: "thermometer.medium", color: Theme.stress)
            MetricTile(title: "Calorías", value: Fmt.num(m.kcal), unit: "kcal", icon: "flame.fill", color: Theme.stress)
            MetricTile(title: "Pasos", value: m.steps.map { $0 >= 1000 ? String(format: "%.1fk", $0 / 1000) : String(Int($0)) } ?? "–",
                       icon: "figure.walk", color: Theme.strain)
            MetricTile(title: "Estrés medio", value: Fmt.num(m.avgStress, 1), unit: "/3", icon: "brain.head.profile", color: Theme.yellow)
            MetricTile(title: "FC media", value: Fmt.num(m.avgHR), unit: "lpm", icon: "heart.text.square", color: Theme.hr)
            if settings.showSpO2 {
                MetricTile(title: "SpO₂ (exp.)", value: Fmt.num(m.spo2), unit: "%", icon: "drop.fill", color: Theme.red)
            } else {
                MetricTile(title: "Uso", value: m.wearMinutes.map { Fmt.hmShort(Double($0)) } ?? "–", unit: "h", icon: "clock", color: Theme.secondaryText)
            }
        }
    }

    func tempDelta() -> String {
        guard let t = report.metrics.skinTemp else { return "–" }
        let vals = history.compactMap(\.skinTemp)
        guard let b = Stats.mean(vals), let sd = Stats.sd(vals), sd > 0 else { return "base" }
        let z = (t - b) / sd
        return String(format: "%+.1fσ", z)
    }
}

struct DailyAnalysisCard: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    let record: DailyRecord
    let report: DayReport
    @Binding var running: Bool

    var body: some View {
        Card(title: "Análisis del día", icon: "sparkles") {
            if let text = record.aiAnalysis {
                Text(LocalizedStringKey(text)).font(.subheadline)
                if let at = record.aiAnalysisAt {
                    Text("Generado \(at.formatted(date: .omitted, time: .shortened)) · \(settings.claudeModel.label)").font(.caption2).foregroundStyle(Theme.secondaryText)
                }
            } else {
                Text(LocalInsights.summary(report)).font(.subheadline)
            }
            HStack {
                if settings.hasAnthropicKey {
                    Button {
                        running = true
                        Task { await model.runDailyAnalysis(record); running = false }
                    } label: {
                        Label(record.aiAnalysis == nil ? "Analizar con IA" : "Regenerar", systemImage: "sparkles")
                    }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(running)
                    if running { ProgressView().padding(.leading, 6) }
                } else {
                    Text("Añade tu clave de Anthropic en Ajustes para análisis con IA.").font(.caption).foregroundStyle(Theme.secondaryText)
                }
            }
        }
    }
}

/// Rule-based daily summary used when no AI key is configured.
enum LocalInsights {
    static func summary(_ r: DayReport) -> String {
        var parts: [String] = []
        if let rec = r.recovery {
            switch rec.band {
            case .green: parts.append("Recuperación alta (\(Int(rec.score)) %): buen día para entrenar fuerte.")
            case .yellow: parts.append("Recuperación media (\(Int(rec.score)) %): entrena con moderación.")
            case .red: parts.append("Recuperación baja (\(Int(rec.score)) %): prioriza descanso, movilidad y sueño.")
            }
            if let z = rec.zHRV {
                if z > 0.7 { parts.append("Tu VFC está claramente por encima de tu media: sistema nervioso descansado.") }
                else if z < -0.7 { parts.append("Tu VFC está por debajo de lo habitual (estrés, alcohol, carga o enfermedad incipiente).") }
            }
            if let z = rec.zRHR, z < -1 { parts.append("La FC en reposo está elevada respecto a tu base.") }
        }
        if let s = r.sleep, let need = r.sleepNeed {
            let deficit = need.totalMin - Double(s.minutesAsleep)
            if deficit > 45 { parts.append("Dormiste \(Fmt.hm(deficit)) menos de lo que necesitabas.") }
            else if deficit < -20 { parts.append("Cubriste de sobra tu necesidad de sueño.") }
            if s.efficiency < 0.85 { parts.append("Eficiencia de sueño baja (\(Int(s.efficiency * 100)) %): revisa cafeína, temperatura y pantallas.") }
        }
        if let t = r.strainTarget { parts.append("Esfuerzo recomendado: \(Int(t.lowerBound))–\(Int(t.upperBound)).") }
        if let n = r.nextNightNeed { parts.append("Esta noche necesitarás \(Fmt.hm(n.totalMin)) de sueño.") }
        return parts.isEmpty ? "Aún no hay suficientes datos para un resumen." : parts.joined(separator: " ")
    }
}

struct TodayPlanCard: View {
    @Environment(AppModel.self) private var model
    let recovery: Double?
    var body: some View {
        if let rec = model.activePlan, let plan = rec.plan, let today = plan.session(on: Date()) {
            let adapted = PlanGenerator.adapt(today.session, recovery: recovery)
            Card(title: "Entreno de hoy", icon: "figure.strengthtraining.traditional") {
                NavigationLink { SessionDetailView(session: adapted.session, note: adapted.note, weekPhase: today.week.phase) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(adapted.session.title).font(.title3.bold())
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Theme.secondaryText)
                        }
                        Text("Semana \(today.week.index + 1) · \(today.week.phase) · ~\(adapted.session.estimatedMinutes) min").font(.caption).foregroundStyle(Theme.secondaryText)
                        Text(adapted.note).font(.subheadline).foregroundStyle(adapted.band.map { $0 == .green ? Theme.green : ($0 == .yellow ? Theme.yellow : Theme.red) } ?? .white)
                        ForEach(adapted.session.exercises.prefix(4)) { e in
                            Text("• \(e.name) \(e.sets)×\(e.reps)").font(.caption)
                        }
                        if let c = adapted.session.cardio { Text("• \(c.description)").font(.caption) }
                    }
                }
                .buttonStyle(.plain)
            }
        } else if model.activePlan == nil {
            Card(title: "Entreno de hoy", icon: "figure.strengthtraining.traditional") {
                Text("Crea un plan en la pestaña Entreno y aquí verás la sesión del día ajustada a tu recuperación.")
                    .font(.subheadline).foregroundStyle(Theme.secondaryText)
            }
        } else {
            Card(title: "Hoy toca descanso", icon: "bed.double") {
                Text("Día sin sesión en tu plan. Paseo, movilidad y buen sueño.").font(.subheadline).foregroundStyle(Theme.secondaryText)
            }
        }
    }
}

struct HRTimelineCard: View {
    let report: DayReport
    var body: some View {
        Card(title: "Frecuencia cardiaca", icon: "heart.fill") {
            if report.hrTimeline.isEmpty {
                Text("Sin datos").foregroundStyle(Theme.secondaryText)
            } else {
                Chart {
                    ForEach(report.activities, id: \.start) { a in
                        RectangleMark(xStart: .value("ini", Date(timeIntervalSince1970: TimeInterval(a.start))),
                                      xEnd: .value("fin", Date(timeIntervalSince1970: TimeInterval(a.end))))
                            .foregroundStyle(Theme.strain.opacity(0.18))
                    }
                    ForEach(report.hrTimeline, id: \.ts) { b in
                        AreaMark(x: .value("Hora", Date(timeIntervalSince1970: TimeInterval(b.ts))),
                                 yStart: .value("Mín", b.min), yEnd: .value("Máx", b.max))
                            .foregroundStyle(Theme.hr.opacity(0.18))
                        LineMark(x: .value("Hora", Date(timeIntervalSince1970: TimeInterval(b.ts))), y: .value("FC", b.avg))
                            .foregroundStyle(Theme.hr)
                            .interpolationMethod(.monotone)
                    }
                }
                .chartYScale(domain: .automatic(includesZero: false))
                .chartXAxis { AxisMarks(values: .stride(by: .hour, count: 4)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.hour()) } }
                .frame(height: 180)
                HStack {
                    StatRow(label: "Media", value: Fmt.num(report.metrics.avgHR, unit: "lpm"))
                    Divider().frame(height: 16)
                    StatRow(label: "Máx", value: Fmt.num(report.metrics.maxHR, unit: "lpm"))
                }
            }
        }
    }
}

struct ActivitiesCard: View {
    let report: DayReport
    var body: some View {
        Card(title: "Actividades detectadas", icon: "figure.run") {
            ForEach(report.activities, id: \.start) { a in
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(Fmt.time(a.start)) – \(Fmt.time(a.end))").font(.subheadline.weight(.semibold))
                        Text("\((a.end - a.start) / 60) min · FC media \(Fmt.num(a.strain.avgHR)) · \(Fmt.num(a.strain.kcal)) kcal")
                            .font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                    Spacer()
                    Text(Fmt.num(a.strain.strain, 1)).font(.title3.bold()).foregroundStyle(Theme.strain)
                }
                ZoneBar(zoneSeconds: a.strain.zoneSeconds)
            }
        }
    }
}

struct ZoneBar: View {
    let zoneSeconds: [Int]
    var body: some View {
        let total = max(1, zoneSeconds.dropFirst().reduce(0, +))
        GeometryReader { g in
            HStack(spacing: 1) {
                ForEach(Array(1..<max(1, min(6, zoneSeconds.count))), id: \.self) { z in
                    Rectangle().fill(Theme.zone(z))
                        .frame(width: g.size.width * CGFloat(zoneSeconds[z]) / CGFloat(total))
                }
            }
        }
        .frame(height: 6)
        .clipShape(Capsule())
    }
}

struct StressSummaryCard: View {
    let report: DayReport
    var body: some View {
        NavigationLink { StressView(report: report) } label: {
            Card(title: "Estrés", icon: "brain.head.profile") {
                if report.stress.isEmpty {
                    Text("Sin datos de estrés").foregroundStyle(Theme.secondaryText)
                } else {
                    Chart(report.stress, id: \.ts) { p in
                        BarMark(x: .value("Hora", Date(timeIntervalSince1970: TimeInterval(p.ts))), y: .value("Estrés", p.level), width: 2)
                            .foregroundStyle(p.active ? Theme.strain.opacity(0.6) : (p.level >= 2 ? Theme.red : (p.level >= 1 ? Theme.yellow : Theme.green)))
                    }
                    .chartYScale(domain: 0...3)
                    .chartXAxis(.hidden)
                    .frame(height: 70)
                    HStack {
                        Text("Media \(Fmt.num(report.metrics.avgStress, 1))/3").font(.caption)
                        Spacer()
                        Text("Alto: \(Fmt.hm(report.metrics.highStressMin ?? 0))").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }
}
