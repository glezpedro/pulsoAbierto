import SwiftUI
import Charts
import WhoopKit

struct RecoveryDetailView: View {
    @Environment(AppModel.self) private var model
    let report: DayReport

    var body: some View {
        let history = model.recentMetrics(days: 30)
        ScrollView {
            VStack(spacing: 14) {
                if let r = report.recovery {
                    Card {
                        HStack(spacing: 20) {
                            RingView(progress: r.score / 100, color: Theme.recovery(r.score), lineWidth: 14, label: "RECUPERACIÓN", value: "\(Int(r.score))%")
                                .frame(width: 140)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(r.band.spanish).font(.headline).foregroundStyle(Theme.recovery(r.score))
                                if r.calibrating {
                                    Text("Calibrando tu línea base: la puntuación será personal a partir del 4.º día.").font(.caption).foregroundStyle(Theme.secondaryText)
                                }
                            }
                        }
                    }
                    Card(title: "Qué la compone", icon: "slider.horizontal.3") {
                        ContributionRow(label: "VFC (55 %)", z: r.zHRV, value: Fmt.num(report.metrics.hrv, unit: "ms"))
                        ContributionRow(label: "FC en reposo (25 %)", z: r.zRHR, value: Fmt.num(report.metrics.rhr, unit: "lpm"))
                        ContributionRow(label: "Sueño (12 %)", z: r.sleepTerm, value: report.sleepScore.map { "\(Int($0.performance)) %" } ?? "–")
                        ContributionRow(label: "Respiración (4 %)", z: r.zResp, value: Fmt.num(report.metrics.resp, 1, unit: "rpm"))
                        ContributionRow(label: "Temperatura (4 %)", z: r.zTemp, value: "")
                        Text("Cada barra muestra cuánto se aleja hoy cada métrica de tu media de 30 días (desviaciones estándar). La VFC es la que más pesa.")
                            .font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
                TrendChartCard(title: "Recuperación 30 días", values: history.map { ($0.dayKey, $0.recovery) }, color: Theme.green, domain: 0...100, colorByRecovery: true)
                TrendChartCard(title: "VFC (ms)", values: history.map { ($0.dayKey, $0.hrv) }, color: Theme.green, showBaseline: true)
                TrendChartCard(title: "FC en reposo (lpm)", values: history.map { ($0.dayKey, $0.rhr) }, color: Theme.hr, showBaseline: true)
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Recuperación")
    }
}

struct ContributionRow: View {
    let label: String
    let z: Double?
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.subheadline)
                Spacer()
                Text(value).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.secondaryText)
            }
            GeometryReader { g in
                let w = g.size.width / 2
                let v = max(-3, min(3, z ?? 0)) / 3
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    Rectangle().fill(v >= 0 ? Theme.green : Theme.red)
                        .frame(width: abs(v) * w)
                        .offset(x: v >= 0 ? w : w + v * w)
                    Rectangle().fill(Color.white.opacity(0.4)).frame(width: 1).offset(x: w)
                }
            }
            .frame(height: 6)
        }
    }
}

struct TrendChartCard: View {
    let title: String
    let values: [(String, Double?)]
    let color: Color
    var domain: ClosedRange<Double>? = nil
    var showBaseline = false
    var colorByRecovery = false

    var body: some View {
        let pts: [DayPoint] = values.compactMap { item in
            guard let v = item.1, let d = DayKey.date(item.0) else { return nil }
            return DayPoint(date: d, value: v)
        }
        Card(title: title) {
            if pts.count < 2 {
                Text("Necesita más días de datos").font(.caption).foregroundStyle(Theme.secondaryText)
            } else {
                let mean = Stats.mean(pts.map(\.value)) ?? 0
                let sd = Stats.sd(pts.map(\.value)) ?? 0
                Chart {
                    if showBaseline {
                        RectangleMark(xStart: .value("a", pts.first!.date), xEnd: .value("b", pts.last!.date),
                                      yStart: .value("lo", mean - sd), yEnd: .value("hi", mean + sd))
                            .foregroundStyle(color.opacity(0.08))
                        RuleMark(y: .value("Media", mean)).foregroundStyle(color.opacity(0.4)).lineStyle(StrokeStyle(dash: [4, 4]))
                    }
                    ForEach(pts) { p in
                        if colorByRecovery {
                            BarMark(x: .value("Día", p.date, unit: .day), y: .value("v", p.value)).foregroundStyle(Theme.recovery(p.value))
                        } else {
                            LineMark(x: .value("Día", p.date, unit: .day), y: .value("v", p.value)).foregroundStyle(color).interpolationMethod(.monotone)
                            PointMark(x: .value("Día", p.date, unit: .day), y: .value("v", p.value)).foregroundStyle(color).symbolSize(18)
                        }
                    }
                }
                .yDomain(domain.map { ScaleDomainWrapper.closed($0) } ?? .auto)
                .frame(height: 160)
                HStack {
                    Text("Media \(String(format: "%.1f", mean))").font(.caption)
                    Spacer()
                    Text("Últ. \(String(format: "%.1f", pts.last!.value))").font(.caption.weight(.semibold)).foregroundStyle(color)
                }
            }
        }
    }
}

struct DayPoint: Identifiable {
    let date: Date
    let value: Double
    var id: Date { date }
}

/// Helper so the chart can switch between a fixed and an automatic Y domain.
enum ScaleDomainWrapper {
    case closed(ClosedRange<Double>)
    case auto
}

extension View {
    @ViewBuilder
    func yDomain(_ d: ScaleDomainWrapper) -> some View {
        switch d {
        case .closed(let r): self.chartYScale(domain: r)
        case .auto: self.chartYScale(domain: .automatic(includesZero: false))
        }
    }
}

struct StrainDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    let report: DayReport

    var body: some View {
        let history = model.recentMetrics(days: 42)
        let load = TrainingLoad.summarize(dailyStrain: history.map { $0.strain ?? 0 })
        ScrollView {
            VStack(spacing: 14) {
                Card {
                    HStack(spacing: 20) {
                        RingView(progress: (report.metrics.strain ?? 0) / 21, color: Theme.strain, lineWidth: 14, label: "ESFUERZO",
                                 value: Fmt.num(report.metrics.strain, 1)).frame(width: 140)
                        VStack(alignment: .leading, spacing: 6) {
                            StatRow(label: "Calorías", value: Fmt.num(report.metrics.kcal, unit: "kcal"))
                            StatRow(label: "Activas", value: Fmt.num(report.metrics.activeKcal, unit: "kcal"))
                            StatRow(label: "FC media", value: Fmt.num(report.metrics.avgHR, unit: "lpm"))
                            StatRow(label: "FC máx", value: Fmt.num(report.metrics.maxHR, unit: "lpm"))
                        }
                    }
                }
                if let st = report.strain {
                    Card(title: "Tiempo en zonas (% FC máx \(Int(settings.profile.physio.hrMax)))", icon: "chart.bar.fill") {
                        ForEach(HRZone.allCases, id: \.rawValue) { z in
                            let secs = z.rawValue < st.zoneSeconds.count ? st.zoneSeconds[z.rawValue] : 0
                            HStack {
                                Circle().fill(Theme.zone(z.rawValue)).frame(width: 10)
                                Text(z.spanish).font(.caption)
                                Spacer()
                                Text(Fmt.hm(Double(secs) / 60)).font(.caption.monospacedDigit())
                            }
                        }
                    }
                }
                Card(title: "Carga de entrenamiento", icon: "chart.line.uptrend.xyaxis") {
                    StatRow(label: "Carga aguda (7 d)", value: Fmt.num(load.acute))
                    StatRow(label: "Carga crónica (28 d)", value: Fmt.num(load.chronic))
                    StatRow(label: "Ratio agudo:crónico", value: Fmt.num(load.acwr, 2))
                    StatRow(label: "Monotonía", value: Fmt.num(load.monotony, 2))
                    Text(load.status).font(.subheadline.weight(.semibold))
                        .foregroundStyle(load.acwr.map { $0 > 1.5 ? Theme.red : ($0 > 1.3 ? Theme.yellow : Theme.green) } ?? Theme.secondaryText)
                    Text("Zona óptima 0,8–1,3 (Gabbett). Por encima de 1,5 sube el riesgo de lesión; una monotonía > 2 indica poca variación entre días.")
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                }
                TrendChartCard(title: "Esfuerzo diario", values: history.map { ($0.dayKey, $0.strain) }, color: Theme.strain, domain: 0...21)
                Card(title: "Cómo se calcula", icon: "info.circle") {
                    Text("El esfuerzo (0–21) mide la carga cardiovascular del día: cada segundo suma según tu % de reserva de FC (Karvonen) con la ponderación exponencial de Banister (TRIMP). La escala es logarítmica: subir de 18 a 19 cuesta mucho más que de 8 a 9.")
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Esfuerzo")
    }
}

struct StressView: View {
    let report: DayReport
    @State private var showBreathe = false
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Card(title: "Estrés durante el día", icon: "brain.head.profile") {
                    Chart(report.stress, id: \.ts) { p in
                        BarMark(x: .value("Hora", Date(timeIntervalSince1970: TimeInterval(p.ts))), y: .value("Estrés", p.level))
                            .foregroundStyle(p.active ? Theme.strain.opacity(0.6) : (p.level >= 2 ? Theme.red : (p.level >= 1 ? Theme.yellow : Theme.green)))
                    }
                    .chartYScale(domain: 0...3)
                    .frame(height: 200)
                    HStack(spacing: 14) {
                        Label("Bajo", systemImage: "circle.fill").foregroundStyle(Theme.green)
                        Label("Medio", systemImage: "circle.fill").foregroundStyle(Theme.yellow)
                        Label("Alto", systemImage: "circle.fill").foregroundStyle(Theme.red)
                        Label("Actividad", systemImage: "circle.fill").foregroundStyle(Theme.strain)
                    }
                    .font(.caption2)
                }
                Card(title: "Resumen", icon: "list.bullet") {
                    StatRow(label: "Estrés medio (reposo)", value: Fmt.num(report.metrics.avgStress, 1, unit: "/3"))
                    StatRow(label: "Tiempo en estrés alto", value: Fmt.hm(report.metrics.highStressMin ?? 0))
                    Text("Se estima a partir de la FC elevada sobre tu reposo sin movimiento y de la caída de la VFC frente a tu línea base. Los periodos con movimiento se marcan como actividad, no como estrés.")
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                }
                Button { showBreathe = true } label: {
                    Label("Respiración guiada (bajar estrés)", systemImage: "wind").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Estrés")
        .sheet(isPresented: $showBreathe) { BreatheView() }
    }
}
