import SwiftUI
import Charts
import WhoopKit

struct SleepView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let _ = model.reportVersion
        NavigationStack {
            Group {
                if let r = model.record(for: model.selectedDate)?.report {
                    SleepDetailContent(report: r)
                } else {
                    ScrollView {
                        DayNavigator().padding()
                        Card { EmptyStateView(icon: "moon.zzz", title: "Sin sueño registrado", message: "Duerme con la pulsera puesta y sincroniza por la mañana.") }
                            .padding(.horizontal)
                        TonightCard(report: nil).padding(.horizontal)
                    }
                }
            }
            .screenBackground()
            .navigationTitle("Sueño")
        }
    }
}

struct SleepDetailContainer: View {
    let report: DayReport
    var body: some View { SleepDetailContent(report: report).screenBackground().navigationTitle("Sueño") }
}

struct SleepDetailContent: View {
    @Environment(AppModel.self) private var model
    let report: DayReport

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                DayNavigator()
                if let s = report.sleep, let score = report.sleepScore {
                    SleepScoreCard(session: s, score: score, need: report.sleepNeed)
                    HypnogramCard(session: s)
                    StagesCard(session: s)
                    SleepPhysioCard(session: s, report: report)
                } else {
                    Card { EmptyStateView(icon: "moon.zzz", title: "No se detectó sueño principal", message: "Puede que la pulsera no estuviera puesta o que aún no se haya sincronizado la noche.") }
                }
                if !report.naps.isEmpty {
                    Card(title: "Siestas", icon: "powersleep") {
                        ForEach(report.naps, id: \.start) { n in
                            StatRow(label: "\(Fmt.time(n.start)) – \(Fmt.time(n.end))", value: Fmt.hm(Double(n.minutesAsleep)))
                        }
                    }
                }
                if Calendar.current.isDateInToday(model.selectedDate) { TonightCard(report: report) }
                SleepHistoryCard()
            }
            .padding()
        }
    }
}

struct SleepScoreCard: View {
    let session: SleepSession
    let score: SleepScore
    let need: SleepNeed?
    var body: some View {
        Card {
            HStack(spacing: 18) {
                RingView(progress: score.score / 100, color: Theme.sleep, lineWidth: 14, label: "PUNTUACIÓN", value: "\(Int(score.score))")
                    .frame(width: 130)
                VStack(alignment: .leading, spacing: 6) {
                    StatRow(label: "Dormido", value: Fmt.hm(Double(session.minutesAsleep)))
                    StatRow(label: "Necesidad", value: need.map { Fmt.hm($0.totalMin) } ?? "–")
                    StatRow(label: "En cama", value: "\(Fmt.time(session.start))–\(Fmt.time(session.end))")
                    StatRow(label: "Rendimiento", value: "\(Int(score.performance)) %")
                }
            }
            Divider()
            HStack {
                scorePill("Eficiencia", score.efficiency)
                scorePill("Reparador", score.restorative)
                scorePill("Consistencia", score.consistency)
            }
            if let n = need {
                Text("Necesidad = base \(Fmt.hm(n.baselineMin)) + esfuerzo \(Fmt.hm(n.strainMin)) + deuda \(Fmt.hm(n.debtMin)) − siestas \(Fmt.hm(n.napCreditMin))")
                    .font(.caption2).foregroundStyle(Theme.secondaryText)
            }
        }
    }
    func scorePill(_ t: String, _ v: Double) -> some View {
        VStack(spacing: 2) {
            Text("\(Int(v))").font(.headline.monospacedDigit())
            Text(t).font(.caption2).foregroundStyle(Theme.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }
}

struct HypnogramCard: View {
    let session: SleepSession
    struct Seg: Identifiable { let id: Int; let start: Date; let end: Date; let stage: SleepStage }

    var segments: [Seg] {
        var out: [Seg] = []
        var i = 0
        let st = session.stages
        let base = Date(timeIntervalSince1970: TimeInterval(session.start))
        while i < st.count {
            var j = i
            while j + 1 < st.count && st[j + 1] == st[i] { j += 1 }
            out.append(Seg(id: i, start: base.addingTimeInterval(TimeInterval(i * 60)), end: base.addingTimeInterval(TimeInterval((j + 1) * 60)), stage: st[i]))
            i = j + 1
        }
        return out
    }

    func level(_ s: SleepStage) -> Int {
        switch s { case .awake: return 3; case .rem: return 2; case .light: return 1; case .deep: return 0 }
    }

    var body: some View {
        Card(title: "Hipnograma (estimado)", icon: "chart.bar.xaxis") {
            Chart(segments) { s in
                RectangleMark(xStart: .value("ini", s.start), xEnd: .value("fin", s.end),
                              yStart: .value("a", Double(level(s.stage)) - 0.4), yEnd: .value("b", Double(level(s.stage)) + 0.4))
                    .foregroundStyle(Theme.stage(s.stage))
            }
            .chartYAxis {
                AxisMarks(values: [0.0, 1.0, 2.0, 3.0]) { v in
                    AxisValueLabel {
                        if let d = v.as(Double.self), (0...3).contains(Int(d.rounded())) {
                            Text(["Profundo", "Ligero", "REM", "Despierto"][Int(d.rounded())])
                        }
                    }
                }
            }
            .chartYScale(domain: -0.6...3.6)
            .chartXAxis { AxisMarks(values: .stride(by: .hour)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.hour()) } }
            .frame(height: 170)
        }
    }
}

struct StagesCard: View {
    let session: SleepSession
    var body: some View {
        Card(title: "Fases", icon: "square.stack.3d.up") {
            let total = max(1, session.minutesInBed)
            GeometryReader { g in
                HStack(spacing: 2) {
                    ForEach([SleepStage.awake, .light, .rem, .deep], id: \.self) { s in
                        Rectangle().fill(Theme.stage(s))
                            .frame(width: max(0, g.size.width * CGFloat(session.minutes(s)) / CGFloat(total) - 2))
                    }
                }
            }
            .frame(height: 12).clipShape(Capsule())
            ForEach([SleepStage.awake, .light, .deep, .rem], id: \.self) { s in
                HStack {
                    Circle().fill(Theme.stage(s)).frame(width: 10)
                    Text(s.spanish)
                    Spacer()
                    Text(Fmt.hm(Double(session.minutes(s)))).monospacedDigit()
                    Text("\(Int(Double(session.minutes(s)) / Double(total) * 100)) %").foregroundStyle(Theme.secondaryText).frame(width: 46, alignment: .trailing)
                }
                .font(.subheadline)
            }
            Divider()
            StatRow(label: "Latencia", value: Fmt.hm(Double(session.latencyMinutes)), icon: "hourglass")
            StatRow(label: "Despertares (≥2 min)", value: "\(session.disturbances)", icon: "exclamationmark.circle")
            StatRow(label: "Tiempo despierto tras dormirte", value: Fmt.hm(Double(session.wasoMinutes)), icon: "eye")
            StatRow(label: "Ciclos REM", value: "\(session.remCycles)", icon: "arrow.triangle.2.circlepath")
            StatRow(label: "Eficiencia", value: "\(Int(session.efficiency * 100)) %", icon: "gauge.medium")
        }
    }
}

struct SleepPhysioCard: View {
    let session: SleepSession
    let report: DayReport
    struct P: Identifiable { let id: Int; let date: Date; let v: Double }
    var body: some View {
        let base = Date(timeIntervalSince1970: TimeInterval(session.start))
        let hr: [P] = session.hrCurve.enumerated().compactMap { i, v in v.map { P(id: i, date: base.addingTimeInterval(TimeInterval(i * 60)), v: $0) } }
        let hrv: [P] = session.hrvCurve.enumerated().compactMap { i, v in v.map { P(id: i, date: base.addingTimeInterval(TimeInterval(i * 300)), v: $0) } }
        Card(title: "Fisiología nocturna", icon: "heart.text.square") {
            HStack {
                MetricTile(title: "FC reposo", value: Fmt.num(session.restingHR), unit: "lpm", icon: "heart.fill", color: Theme.hr)
                MetricTile(title: "VFC", value: Fmt.num(session.hrvRMSSD), unit: "ms", icon: "waveform.path.ecg", color: Theme.green)
                MetricTile(title: "Resp.", value: Fmt.num(session.respiratoryRate, 1), unit: "rpm", icon: "lungs.fill")
            }
            if !hr.isEmpty {
                Text("FC durante el sueño").font(.caption).foregroundStyle(Theme.secondaryText)
                Chart(hr) { p in LineMark(x: .value("t", p.date), y: .value("FC", p.v)).foregroundStyle(Theme.hr) }
                    .chartYScale(domain: .automatic(includesZero: false)).frame(height: 100)
            }
            if !hrv.isEmpty {
                Text("VFC (RMSSD, ventanas de 5 min)").font(.caption).foregroundStyle(Theme.secondaryText)
                Chart(hrv) { p in BarMark(x: .value("t", p.date), y: .value("ms", p.v)).foregroundStyle(Theme.green.opacity(0.8)) }
                    .frame(height: 90)
            }
            StatRow(label: "FC media / mínima", value: "\(Fmt.num(session.avgHR)) / \(Fmt.num(session.minHR)) lpm")
            if let s = session.spo2Estimate, AppSettings.shared.showSpO2 {
                StatRow(label: "SpO₂ estimada (experimental)", value: "\(Int(s)) %")
            }
        }
    }
}

struct TonightCard: View {
    @Environment(AppSettings.self) private var settings
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(AppModel.self) private var model
    let report: DayReport?

    var body: some View {
        let need = report?.nextNightNeed
        let wake = settings.nextWake()
        Card(title: "Esta noche", icon: "bed.double.fill") {
            if let need {
                let bed = SleepCoach.recommendedBedtime(wake: wake, need: need)
                HStack {
                    VStack(alignment: .leading) {
                        Text("Acuéstate a las").font(.caption).foregroundStyle(Theme.secondaryText)
                        Text(bed.formatted(date: .omitted, time: .shortened)).font(.title.bold()).foregroundStyle(Theme.sleep)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("para despertar a las").font(.caption).foregroundStyle(Theme.secondaryText)
                        Text(wake.formatted(date: .omitted, time: .shortened)).font(.title3.bold())
                    }
                }
                Text("Necesitarás \(Fmt.hm(need.totalMin)) de sueño (incluye tu esfuerzo de hoy y la deuda acumulada).")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
            } else {
                Text("Despertar previsto: \(wake.formatted(date: .omitted, time: .shortened))").font(.subheadline)
            }
            Toggle(isOn: Binding(get: { settings.smartAlarmEnabled }, set: { settings.smartAlarmEnabled = $0 })) {
                VStack(alignment: .leading) {
                    Text("Despertador en la pulsera")
                    Text("Vibra a tu hora; si la app está conectada puede despertarte antes, en sueño ligero (ventana \(settings.smartAlarmWindowMin) min).")
                        .font(.caption2).foregroundStyle(Theme.secondaryText)
                }
            }
            if settings.smartAlarmEnabled {
                Stepper("Ventana inteligente: \(settings.smartAlarmWindowMin) min", value: Binding(get: { settings.smartAlarmWindowMin }, set: { settings.smartAlarmWindowMin = $0 }), in: 0...45, step: 5)
                    .font(.subheadline)
                Button("Programar ahora en la pulsera") { Task { await model.scheduleSmartAlarmIfNeeded() } }
                    .disabled(!ble.connection.isConnected)
            }
            DatePicker("Hora de despertar", selection: Binding(get: { wake }, set: { d in
                let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                settings.profile.wakeMinutes = (c.hour ?? 7) * 60 + (c.minute ?? 0)
            }), displayedComponents: .hourAndMinute)
        }
    }
}

struct SleepHistoryCard: View {
    @Environment(AppModel.self) private var model
    struct Row: Identifiable { let id: String; let date: Date; let stage: String; let minutes: Double }
    var body: some View {
        let ms = model.recentMetrics(days: 14)
        let rows: [Row] = ms.flatMap { m -> [Row] in
            guard let d = DayKey.date(m.dayKey) else { return [] }
            return [("Profundo", m.deepMin), ("REM", m.remMin), ("Ligero", m.lightMin), ("Despierto", m.awakeMin)].compactMap { name, v in
                v.map { Row(id: m.dayKey + name, date: d, stage: name, minutes: $0 / 60) }
            }
        }
        let needs: [DayPoint] = ms.compactMap { m in
            guard let d = DayKey.date(m.dayKey), let n = m.sleepNeedMin else { return nil }
            return DayPoint(date: d, value: n / 60)
        }
        Card(title: "Últimas 2 semanas", icon: "calendar") {
            if rows.isEmpty {
                Text("Sin historial aún").font(.caption).foregroundStyle(Theme.secondaryText)
            } else {
                Chart {
                    ForEach(rows) { r in
                        BarMark(x: .value("Día", r.date, unit: .day), y: .value("h", r.minutes))
                            .foregroundStyle(by: .value("Fase", r.stage))
                    }
                    ForEach(needs) { n in
                        PointMark(x: .value("Día", n.date, unit: .day), y: .value("Necesidad", n.value))
                            .symbol(.diamond).foregroundStyle(.white)
                    }
                }
                .chartForegroundStyleScale(["Profundo": Theme.stage(.deep), "REM": Theme.stage(.rem), "Ligero": Theme.stage(.light), "Despierto": Theme.stage(.awake)])
                .frame(height: 180)
                Text("◆ = necesidad de sueño").font(.caption2).foregroundStyle(Theme.secondaryText)
            }
        }
    }
}
