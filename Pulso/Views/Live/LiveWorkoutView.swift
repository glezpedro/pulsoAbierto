import SwiftUI
import Charts
import WhoopKit

/// Real-time heart rate with zones, live strain and calories. Can record a workout and save it
/// (and later upload it to Strava with the full HR curve from the strap history).
struct LiveWorkoutView: View {
    @Environment(AppModel.self) private var model
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    var sessionTitle: String? = nil

    @State private var recording = false
    @State private var startDate: Date?
    @State private var points: [LivePoint] = []
    @State private var load = 0.0
    @State private var kcal = 0.0
    @State private var zoneSecs = [Int](repeating: 0, count: 6)
    @State private var lastTick: Date?
    @State private var sport = "Fuerza"
    @State private var now = Date()

    struct LivePoint: Identifiable { let id = UUID(); let date: Date; let bpm: Int }

    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        let profile = settings.profile.physio
        let rhr = model.recentMetrics(days: 7).compactMap(\.rhr).last ?? 60
        let hr = ble.liveHR
        let zone = hr.map { HRZone.of(bpm: Double($0), hrMax: profile.hrMax) } ?? .z0
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if !ble.connection.isConnected {
                        Card { Label("Conecta la pulsera para ver tu FC en directo.", systemImage: "antenna.radiowaves.left.and.right.slash") }
                    }
                    VStack(spacing: 4) {
                        Text(hr.map(String.init) ?? "--")
                            .font(.system(size: 96, weight: .bold, design: .rounded))
                            .foregroundStyle(Theme.zone(zone.rawValue))
                            .contentTransition(.numericText())
                            .animation(.default, value: hr)
                        Text("lpm · \(zone.spanish)").font(.headline).foregroundStyle(Theme.secondaryText)
                        if let hr { Text("\(Int(Double(hr) / profile.hrMax * 100)) % FC máx").font(.caption).foregroundStyle(Theme.secondaryText) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)

                    HStack(spacing: 10) {
                        MetricTile(title: "Esfuerzo", value: String(format: "%.1f", Strain.strain(fromLoad: load)), icon: "flame", color: Theme.strain)
                        MetricTile(title: "Calorías", value: "\(Int(kcal))", unit: "kcal", icon: "bolt.heart", color: Theme.stress)
                        MetricTile(title: "Tiempo", value: elapsed, icon: "timer", color: Theme.accent)
                    }

                    Card(title: "Últimos minutos", icon: "waveform.path.ecg") {
                        Chart(points.suffix(600)) { p in
                            LineMark(x: .value("t", p.date), y: .value("FC", p.bpm))
                                .foregroundStyle(Theme.zone(HRZone.of(bpm: Double(p.bpm), hrMax: profile.hrMax).rawValue))
                        }
                        .chartYScale(domain: .automatic(includesZero: false))
                        .frame(height: 160)
                        ZoneBar(zoneSeconds: zoneSecs)
                    }

                    if let rr = ble.liveRR.last, rr > 0 {
                        Text("Último intervalo R-R: \(rr) ms").font(.caption).foregroundStyle(Theme.secondaryText)
                    }

                    Picker("Deporte", selection: $sport) {
                        ForEach(["Fuerza", "Carrera", "Ciclismo", "HIIT", "Deporte", "Otro"], id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)

                    if recording {
                        Button(role: .destructive) { stopAndSave(profile: profile, rhr: rhr) } label: {
                            Label("Terminar y guardar", systemImage: "stop.circle.fill").frame(maxWidth: .infinity).padding(8)
                        }
                        .buttonStyle(.borderedProminent).tint(Theme.red)
                    } else {
                        Button { startRecording() } label: {
                            Label("Empezar entreno", systemImage: "record.circle").frame(maxWidth: .infinity).padding(8)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!ble.connection.isConnected)
                    }
                    Text("Consejo: con «doble toque» en la pulsera también puedes empezar/terminar (Ajustes).")
                        .font(.caption2).foregroundStyle(Theme.secondaryText)
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle(sessionTitle ?? "En directo")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } } }
            .onAppear {
                if !ble.liveHREnabled { ble.setLiveHR(true) }
                model.doubleTapHandler = { if recording { stopAndSave(profile: profile, rhr: rhr) } else { startRecording() } }
            }
            .onDisappear {
                if !recording { ble.setLiveHR(false) }
                model.doubleTapHandler = nil
            }
            .onReceive(timer) { t in
                now = t
                guard let bpm = ble.liveHR, bpm > 30 else { return }
                points.append(LivePoint(date: t, bpm: bpm))
                if points.count > 4000 { points.removeFirst(1000) }
                guard recording else { return }
                let dt = min(5, t.timeIntervalSince(lastTick ?? t.addingTimeInterval(-1)))
                lastTick = t
                let hrr = max(0, min(1.2, (Double(bpm) - rhr) / max(20, profile.hrMax - rhr)))
                if hrr > 0.1 {
                    let b = profile.sex == .male ? 0.64 * exp(1.92 * hrr) : 0.86 * exp(1.67 * hrr)
                    load += hrr * b * pow(min(1, max(0, (hrr - 0.1) / 0.2)), 2) * dt / 60
                }
                kcal += Calories.perSecond(hr: Double(bpm), hrr: hrr, profile: profile) * dt
                zoneSecs[HRZone.of(bpm: Double(bpm), hrMax: profile.hrMax).rawValue] += Int(dt.rounded())
            }
        }
    }

    var elapsed: String {
        guard let s = startDate else { return "0:00" }
        let e = Int(now.timeIntervalSince(s))
        return e >= 3600 ? String(format: "%d:%02d:%02d", e / 3600, (e / 60) % 60, e % 60) : String(format: "%d:%02d", e / 60, e % 60)
    }

    func startRecording() {
        recording = true
        startDate = Date()
        lastTick = Date()
        load = 0; kcal = 0; zoneSecs = [Int](repeating: 0, count: 6)
        ble.buzz()
    }

    func stopAndSave(profile: PhysioProfile, rhr: Double) {
        guard let s = startDate else { return }
        recording = false
        let end = Date()
        let session = points.filter { $0.date >= s }
        let w = WorkoutRecord(uid: "live-\(Int(s.timeIntervalSince1970))", source: .live, start: s, end: end, sport: sport,
                              name: sessionTitle ?? "\(sport) · \(s.formatted(date: .omitted, time: .shortened))")
        w.strain = Strain.strain(fromLoad: load)
        w.kcal = kcal
        w.avgHR = session.isEmpty ? nil : Double(session.map(\.bpm).reduce(0, +)) / Double(session.count)
        w.maxHR = session.map(\.bpm).max().map(Double.init)
        w.zoneSeconds = zoneSecs
        model.context.insert(w)
        try? model.context.save()
        model.banner = "Entreno guardado: esfuerzo \(String(format: "%.1f", w.strain ?? 0))"
        ble.buzz()
        startDate = nil
    }
}
