import SwiftUI
import Charts
import SwiftData
import WhoopKit

enum TrendMetric: String, CaseIterable, Identifiable {
    case recovery, strain, hrv, rhr, resp, sleep, sleepScore, deep, rem, kcal, stress, steps, temp, weight
    var id: String { rawValue }
    var label: String {
        switch self {
        case .recovery: return "Recuperación"
        case .strain: return "Esfuerzo"
        case .hrv: return "VFC"
        case .rhr: return "FC reposo"
        case .resp: return "Respiración"
        case .sleep: return "Horas de sueño"
        case .sleepScore: return "Puntuación sueño"
        case .deep: return "Sueño profundo"
        case .rem: return "Sueño REM"
        case .kcal: return "Calorías"
        case .stress: return "Estrés"
        case .steps: return "Pasos"
        case .temp: return "Temp. piel (raw)"
        case .weight: return "Peso"
        }
    }
    var unit: String {
        switch self {
        case .recovery, .sleepScore: return "%"
        case .hrv: return "ms"
        case .rhr: return "lpm"
        case .resp: return "rpm"
        case .sleep: return "h"
        case .deep, .rem: return "min"
        case .kcal: return "kcal"
        case .stress: return "/3"
        case .weight: return "kg"
        default: return ""
        }
    }
    var color: Color {
        switch self {
        case .recovery: return Theme.green
        case .strain: return Theme.strain
        case .hrv: return Theme.green
        case .rhr: return Theme.hr
        case .sleep, .sleepScore, .deep, .rem: return Theme.sleep
        case .stress: return Theme.yellow
        case .kcal, .temp: return Theme.stress
        default: return Theme.accent
        }
    }
    func value(_ m: DayMetrics) -> Double? {
        switch self {
        case .recovery: return m.recovery
        case .strain: return m.strain
        case .hrv: return m.hrv
        case .rhr: return m.rhr
        case .resp: return m.resp
        case .sleep: return m.sleptMin.map { $0 / 60 }
        case .sleepScore: return m.sleepScore
        case .deep: return m.deepMin
        case .rem: return m.remMin
        case .kcal: return m.kcal
        case .stress: return m.avgStress
        case .steps: return m.steps
        case .temp: return m.skinTemp
        case .weight: return nil
        }
    }
}

struct TrendsView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \BodyMeasurement.date) private var body_: [BodyMeasurement]
    @State private var metric: TrendMetric = .hrv
    @State private var range = 30
    @State private var corrX: TrendMetric = .strain
    @State private var corrY: TrendMetric = .recovery

    var body: some View {
        let ms = model.recentMetrics(days: range)
        let pts: [DayPoint] = metric == .weight
            ? body_.filter { $0.date > Date().addingTimeInterval(-Double(range) * 86400) }.compactMap { b in b.weightKg.map { DayPoint(date: b.date, value: $0) } }
            : ms.compactMap { m in metric.value(m).flatMap { v in DayKey.date(m.dayKey).map { DayPoint(date: $0, value: v) } } }
        ScrollView {
            VStack(spacing: 14) {
                Picker("Rango", selection: $range) {
                    Text("7 d").tag(7); Text("30 d").tag(30); Text("90 d").tag(90); Text("1 año").tag(365)
                }
                .pickerStyle(.segmented)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(TrendMetric.allCases) { m in
                            Button(m.label) { metric = m }
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(metric == m ? m.color.opacity(0.35) : Theme.card, in: Capsule())
                                .buttonStyle(.plain)
                        }
                    }
                }
                Card(title: "\(metric.label) (\(metric.unit))", icon: "chart.xyaxis.line") {
                    if pts.count < 2 {
                        Text("No hay suficientes datos en este rango.").font(.caption).foregroundStyle(Theme.secondaryText)
                    } else {
                        let vals = pts.map(\.value)
                        let mean = Stats.mean(vals) ?? 0
                        let rolling = rollingMean(pts, window: 7)
                        Chart {
                            ForEach(pts) { p in
                                PointMark(x: .value("Día", p.date, unit: .day), y: .value(metric.label, p.value))
                                    .foregroundStyle(metric.color.opacity(0.5)).symbolSize(20)
                            }
                            ForEach(rolling) { p in
                                LineMark(x: .value("Día", p.date, unit: .day), y: .value("Media 7 d", p.value))
                                    .foregroundStyle(metric.color).interpolationMethod(.monotone)
                            }
                            RuleMark(y: .value("Media", mean)).foregroundStyle(.white.opacity(0.3)).lineStyle(StrokeStyle(dash: [4, 4]))
                        }
                        .chartYScale(domain: .automatic(includesZero: false))
                        .frame(height: 220)
                        let x = pts.map { $0.date.timeIntervalSince1970 / 86400 }
                        let slope = Stats.linearRegression(x, vals)?.slope ?? 0
                        StatRow(label: "Media", value: String(format: "%.1f %@", mean, metric.unit))
                        StatRow(label: "Mín / Máx", value: String(format: "%.1f / %.1f", vals.min() ?? 0, vals.max() ?? 0))
                        StatRow(label: "Desviación", value: String(format: "%.1f", Stats.sd(vals) ?? 0))
                        StatRow(label: "Tendencia", value: String(format: "%+.2f %@/semana", slope * 7, metric.unit))
                    }
                }
                CorrelationCard(metrics: ms, x: $corrX, y: $corrY)
                InsightsCard(metrics: model.recentMetrics(days: 90))
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Tendencias")
    }

    func rollingMean(_ p: [DayPoint], window: Int) -> [DayPoint] {
        p.indices.map { i in
            let lo = max(0, i - window + 1)
            let v = p[lo...i].map(\.value)
            return DayPoint(date: p[i].date, value: v.reduce(0, +) / Double(v.count))
        }
    }
}

struct CorrelationCard: View {
    let metrics: [DayMetrics]
    @Binding var x: TrendMetric
    @Binding var y: TrendMetric
    struct XY: Identifiable { let id: Int; let x: Double; let y: Double }

    var body: some View {
        // y is evaluated the NEXT day (e.g. today's strain vs tomorrow's recovery)
        let pairs: [XY] = metrics.indices.dropLast().compactMap { i in
            guard let a = x.value(metrics[i]), let b = y.value(metrics[i + 1]) else { return nil }
            return XY(id: i, x: a, y: b)
        }
        let r = Stats.pearson(pairs.map(\.x), pairs.map(\.y))
        Card(title: "Correlación (X hoy → Y mañana)", icon: "point.3.connected.trianglepath.dotted") {
            HStack {
                Picker("X", selection: $x) { ForEach(TrendMetric.allCases.filter { $0 != .weight }) { Text($0.label).tag($0) } }
                Image(systemName: "arrow.right")
                Picker("Y", selection: $y) { ForEach(TrendMetric.allCases.filter { $0 != .weight }) { Text($0.label).tag($0) } }
            }
            .font(.caption)
            if pairs.count >= 5 {
                Chart(pairs) { p in PointMark(x: .value(x.label, p.x), y: .value(y.label, p.y)).foregroundStyle(Theme.accent) }
                    .chartXScale(domain: .automatic(includesZero: false))
                    .chartYScale(domain: .automatic(includesZero: false))
                    .frame(height: 180)
                if let r {
                    Text("r = \(String(format: "%.2f", r)) · \(strength(r)) (\(pairs.count) días)").font(.subheadline.weight(.semibold))
                }
            } else {
                Text("Se necesitan al menos 5 pares de días.").font(.caption).foregroundStyle(Theme.secondaryText)
            }
        }
    }

    func strength(_ r: Double) -> String {
        let a = abs(r)
        let dir = r > 0 ? "positiva" : "negativa"
        if a < 0.1 { return "sin relación" }
        if a < 0.3 { return "relación \(dir) débil" }
        if a < 0.5 { return "relación \(dir) moderada" }
        return "relación \(dir) fuerte"
    }
}

struct InsightsCard: View {
    let metrics: [DayMetrics]
    var body: some View {
        let ins = insights()
        Card(title: "Hallazgos automáticos", icon: "lightbulb") {
            if ins.isEmpty {
                Text("Con 2–3 semanas de datos aparecerán patrones aquí.").font(.caption).foregroundStyle(Theme.secondaryText)
            }
            ForEach(ins, id: \.self) { Text("• " + $0).font(.subheadline) }
        }
    }

    func insights() -> [String] {
        var out: [String] = []
        let pairsSleep = metrics.indices.compactMap { i -> (Double, Double)? in
            guard let s = metrics[i].sleptMin, let r = metrics[i].recovery else { return nil }
            return (s / 60, r)
        }
        if pairsSleep.count >= 10, let lr = Stats.linearRegression(pairsSleep.map(\.0), pairsSleep.map(\.1)), lr.slope > 1 {
            out.append("Cada hora extra de sueño se asocia con +\(Int(lr.slope)) puntos de recuperación.")
        }
        let beds = metrics.compactMap(\.bedtime)
        if beds.count >= 10 {
            let late = metrics.filter { m in m.bedtime.map { hourOfDay($0) >= 0.5 && hourOfDay($0) < 12 } ?? false }.compactMap(\.recovery)
            let early = metrics.filter { m in m.bedtime.map { hourOfDay($0) >= 18 } ?? false }.compactMap(\.recovery)
            if late.count >= 3, early.count >= 3, let a = Stats.mean(early), let b = Stats.mean(late), a - b > 5 {
                out.append("Acostarte antes de las 00:30 te da de media \(Int(a - b)) puntos más de recuperación.")
            }
        }
        let hrvs = metrics.compactMap(\.hrv)
        if hrvs.count >= 14 {
            let last7 = Stats.mean(Array(hrvs.suffix(7))) ?? 0
            let prev = Stats.mean(Array(hrvs.dropLast(7))) ?? 0
            let sd = Stats.sd(hrvs) ?? 1
            if last7 - prev > 0.5 * sd { out.append("Tu VFC media de la última semana está por encima de tu normal: buena adaptación.") }
            if prev - last7 > 0.5 * sd { out.append("Tu VFC lleva una semana por debajo de lo normal: revisa carga, sueño y estrés.") }
        }
        let strains = metrics.compactMap(\.strain)
        if strains.count >= 21 {
            let load = TrainingLoad.summarize(dailyStrain: metrics.map { $0.strain ?? 0 })
            out.append("Carga: \(load.status.lowercased()) (ACWR \(load.acwr.map { String(format: "%.2f", $0) } ?? "–")).")
        }
        return out
    }

    func hourOfDay(_ ts: Int) -> Double {
        let d = Date(timeIntervalSince1970: TimeInterval(ts))
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return Double(c.hour ?? 0) + Double(c.minute ?? 0) / 60
    }
}

struct WeeklyReportView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @State private var aiText: String?
    @State private var loading = false

    var body: some View {
        let ms = model.recentMetrics(days: 7)
        let prev = model.recentMetrics(days: 14).filter { m in !ms.contains { $0.dayKey == m.dayKey } }
        ScrollView {
            VStack(spacing: 14) {
                Card(title: "Últimos 7 días vs. 7 anteriores", icon: "calendar") {
                    row("Recuperación media", ms.compactMap(\.recovery), prev.compactMap(\.recovery), "%", true)
                    row("Esfuerzo medio", ms.compactMap(\.strain), prev.compactMap(\.strain), "", nil)
                    row("VFC media", ms.compactMap(\.hrv), prev.compactMap(\.hrv), "ms", true)
                    row("FC reposo", ms.compactMap(\.rhr), prev.compactMap(\.rhr), "lpm", false)
                    row("Sueño medio", ms.compactMap { $0.sleptMin.map { $0 / 60 } }, prev.compactMap { $0.sleptMin.map { $0 / 60 } }, "h", true)
                    row("Puntuación sueño", ms.compactMap(\.sleepScore), prev.compactMap(\.sleepScore), "", true)
                    row("Estrés", ms.compactMap(\.avgStress), prev.compactMap(\.avgStress), "", false)
                    row("Calorías/día", ms.compactMap(\.kcal), prev.compactMap(\.kcal), "", nil)
                }
                Card(title: "Resumen del coach", icon: "sparkles") {
                    if let aiText { Text(LocalizedStringKey(aiText)).font(.subheadline) }
                    if settings.hasAnthropicKey {
                        Button(aiText == nil ? "Generar informe semanal con IA" : "Regenerar") { generate() }
                            .buttonStyle(.borderedProminent).disabled(loading)
                        if loading { ProgressView() }
                    } else {
                        Text("Añade tu clave de Anthropic para un informe redactado.").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Informe semanal")
    }

    func row(_ label: String, _ a: [Double], _ b: [Double], _ unit: String, _ higherBetter: Bool?) -> some View {
        let ma = Stats.mean(a), mb = Stats.mean(b)
        let d = (ma != nil && mb != nil) ? ma! - mb! : nil
        return HStack {
            Text(label).font(.subheadline).foregroundStyle(Theme.secondaryText)
            Spacer()
            Text(Fmt.num(ma, 1, unit: unit)).font(.subheadline.weight(.semibold))
            if let d {
                Text(String(format: "%+.1f", d)).font(.caption.monospacedDigit())
                    .foregroundStyle(higherBetter == nil ? Theme.secondaryText : ((d >= 0) == higherBetter! ? Theme.green : Theme.red))
                    .frame(width: 54, alignment: .trailing)
            }
        }
    }

    func generate() {
        loading = true
        Task {
            do {
                aiText = try await ClaudeService.shared.complete(
                    system: AICoach.persona + "\n\n# Datos del usuario\n" + model.coach.dataContext(days: 21),
                    prompt: "Hazme un informe de mi última semana comparado con la anterior: tendencias de recuperación, VFC, sueño, carga y entrenos (Strong/Strava), qué ha ido bien, qué mejorar y 3 objetivos concretos para la próxima semana. Máximo 250 palabras.",
                    maxTokens: 6000, effort: "medium")
            } catch { aiText = error.localizedDescription }
            loading = false
        }
    }
}
