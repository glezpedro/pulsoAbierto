import SwiftUI
import WhoopKit

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Environment(WhoopBLEManager.self) private var ble
    @State private var step = 0
    @State private var demoProgress = 0.0
    @State private var generating = false

    var body: some View {
        @Bindable var s = settings
        VStack {
            TabView(selection: $step) {
                // 0 · Welcome
                VStack(spacing: 20) {
                    Spacer()
                    Image(systemName: "waveform.path.ecg.rectangle").font(.system(size: 80)).foregroundStyle(Theme.accent)
                    Text("Pulso").font(.system(size: 44, weight: .bold, design: .rounded))
                    Text("Tu WHOOP 4.0, sin suscripción.\nRecuperación, sueño, esfuerzo, VFC, estrés, planes de entreno y un coach con IA. Todo calculado en tu iPhone.")
                        .multilineTextAlignment(.center).foregroundStyle(Theme.secondaryText)
                    Spacer()
                    Button("Empezar") { withAnimation { step = 1 } }.buttonStyle(.borderedProminent).controlSize(.large)
                }
                .padding().tag(0)

                // 1 · Profile
                Form {
                    Section {
                        Text("Tu perfil").font(.title.bold())
                        Text("Se usa para la FC máxima, las zonas, las calorías y la necesidad de sueño.").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                    Section {
                        TextField("Nombre", text: $s.profile.name)
                        DatePicker("Nacimiento", selection: $s.profile.birthDate, displayedComponents: .date)
                        Picker("Sexo biológico", selection: $s.profile.sex) { ForEach(BiologicalSex.allCases, id: \.self) { Text($0.spanish).tag($0) } }
                        Stepper("Altura: \(Int(s.profile.heightCm)) cm", value: $s.profile.heightCm, in: 120...230)
                        Stepper(String(format: "Peso: %.1f kg", s.profile.weightKg), value: $s.profile.weightKg, in: 35...200, step: 0.5)
                        DatePicker("Hora de despertar", selection: Binding(get: { settings.nextWake() }, set: { d in
                            let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                            settings.profile.wakeMinutes = (c.hour ?? 7) * 60 + (c.minute ?? 0)
                        }), displayedComponents: .hourAndMinute)
                        TextField("Tu objetivo", text: $s.profile.goalText)
                    }
                    Section { Button("Continuar") { withAnimation { step = 2 } }.frame(maxWidth: .infinity) }
                }
                .scrollContentBackground(.hidden)
                .tag(1)

                // 2 · Connect
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Conecta tu pulsera").font(.title.bold())
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("Cierra o desinstala la app oficial de WHOOP: el Bluetooth solo permite una app a la vez.", systemImage: "1.circle")
                                Label("Carga la pulsera y tenla cerca.", systemImage: "2.circle")
                                Label("Pulsa Buscar y elige tu WHOOP. iOS te pedirá emparejar: acepta.", systemImage: "3.circle")
                                Label("Desde entonces se sincroniza sola en segundo plano.", systemImage: "4.circle")
                            }
                            .font(.subheadline)
                        }
                        Button(ble.connection == .scanning ? "Buscando…" : "Buscar pulsera") { ble.scan() }
                            .buttonStyle(.borderedProminent)
                        ForEach(ble.discovered) { d in
                            Button { ble.connect(d.id) } label: {
                                HStack { Image(systemName: "applewatch"); Text(d.name); Spacer(); Text("\(d.rssi) dBm").font(.caption) }
                                    .padding().background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                        }
                        Text("Estado: \(ble.connection.spanish)").font(.caption).foregroundStyle(Theme.secondaryText)
                        Divider()
                        Text("¿Aún no tienes la pulsera?").font(.headline)
                        Button {
                            generating = true
                            settings.demoMode = true
                            Task {
                                await DemoDataService.generate(context: model.context, engine: model.engine) { demoProgress = $0 }
                                generating = false
                                finish()
                            }
                        } label: { Label("Explorar con datos de demostración", systemImage: "wand.and.stars") }
                        .disabled(generating)
                        if generating { ProgressView(value: demoProgress) }
                        Button(ble.connection.isConnected ? "¡Listo! Entrar" : "Saltar por ahora") { finish() }
                            .buttonStyle(.bordered).frame(maxWidth: .infinity).padding(.top)
                    }
                    .padding()
                }
                .tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    func finish() {
        settings.onboarded = true
        Task { await NotificationService.requestPermission() }
    }
}
