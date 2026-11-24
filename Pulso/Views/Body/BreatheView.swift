import SwiftUI
import WhoopKit

/// Resonance-frequency breathing (≈6 breaths/min) with live heart rate and RMSSD biofeedback.
struct BreatheView: View {
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(\.dismiss) private var dismiss
    @State private var running = false
    @State private var phaseIn = true
    @State private var scale: CGFloat = 0.5
    @State private var bpm: Double = 6
    @State private var rrBuffer: [Double] = []
    @State private var startHRV: Double?
    @State private var seconds = 0
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var cycle: Double { 60 / bpm }
    var currentHRV: Double? { HRV.compute(Array(rrBuffer.suffix(90)))?.rmssd }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            ZStack {
                Circle().fill(Theme.accent.opacity(0.12)).frame(width: 280, height: 280)
                Circle().fill(Theme.accent.opacity(0.45))
                    .frame(width: 280, height: 280)
                    .scaleEffect(scale)
                Text(running ? (phaseIn ? "Inspira" : "Espira") : "Listo").font(.title.bold())
            }
            HStack(spacing: 12) {
                MetricTile(title: "FC", value: ble.liveHR.map(String.init) ?? "--", unit: "lpm", icon: "heart.fill", color: Theme.hr)
                MetricTile(title: "VFC (RMSSD)", value: currentHRV.map { String(format: "%.0f", $0) } ?? "--", unit: "ms", icon: "waveform.path.ecg", color: Theme.green)
                MetricTile(title: "Tiempo", value: String(format: "%d:%02d", seconds / 60, seconds % 60), icon: "timer")
            }
            if let s = startHRV, let c = currentHRV {
                Text(String(format: "VFC %+.0f ms desde el inicio", c - s)).font(.subheadline).foregroundStyle(c >= s ? Theme.green : Theme.secondaryText)
            }
            Stepper(String(format: "Ritmo: %.1f respiraciones/min", bpm), value: $bpm, in: 4...8, step: 0.5).disabled(running)
            Button(running ? "Terminar" : "Empezar") {
                running.toggle()
                if running {
                    seconds = 0; rrBuffer = []; startHRV = nil
                    if !ble.liveHREnabled { ble.setLiveHR(true) }
                    animate()
                } else {
                    withAnimation(.easeInOut(duration: 1)) { scale = 0.5 }
                }
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            Text("Respirar a ~6/min maximiza la arritmia sinusal respiratoria: la VFC sube y baja la activación simpática. 5–10 minutos bastan.")
                .font(.caption).foregroundStyle(Theme.secondaryText).multilineTextAlignment(.center)
            Spacer()
        }
        .padding()
        .screenBackground()
        .navigationTitle("Respiración")
        .onReceive(timer) { _ in
            guard running else { return }
            seconds += 1
            rrBuffer.append(contentsOf: ble.liveRR.map(Double.init))
            if rrBuffer.count > 600 { rrBuffer.removeFirst(200) }
            if seconds == 60 { startHRV = currentHRV }
        }
        .onDisappear { running = false }
    }

    func animate() {
        guard running else { return }
        phaseIn = true
        withAnimation(.easeInOut(duration: cycle * 0.45)) { scale = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + cycle * 0.45) {
            guard running else { return }
            phaseIn = false
            withAnimation(.easeInOut(duration: cycle * 0.55)) { scale = 0.5 }
            DispatchQueue.main.asyncAfter(deadline: .now() + cycle * 0.55) { animate() }
        }
    }
}
