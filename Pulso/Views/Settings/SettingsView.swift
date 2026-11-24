import SwiftUI
import SwiftData
import WhoopKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @State private var apiKey = AppSettings.shared.anthropicKey ?? ""
    @State private var reanalyzing = false
    @State private var progress = 0.0
    @State private var demoRunning = false
    @State private var confirmWipe = false
    @State private var profileDirty = false

    var body: some View {
        @Bindable var s = settings
        Form {
            Section("Perfil") {
                TextField("Nombre", text: $s.profile.name)
                DatePicker("Fecha de nacimiento", selection: $s.profile.birthDate, displayedComponents: .date)
                Picker("Sexo biológico", selection: $s.profile.sex) { ForEach(BiologicalSex.allCases, id: \.self) { Text($0.spanish).tag($0) } }
                Stepper("Altura: \(Int(s.profile.heightCm)) cm", value: $s.profile.heightCm, in: 120...230)
                HStack {
                    Text("Peso")
                    Spacer()
                    TextField("kg", value: $s.profile.weightKg, format: .number.precision(.fractionLength(1)))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 80)
                    Text("kg")
                }
                HStack {
                    Text("FC máxima")
                    Spacer()
                    TextField("auto \(Int(208 - 0.7 * Double(s.profile.age)))", text: Binding(
                        get: { settings.profile.maxHROverride.map(String.init) ?? "" },
                        set: { settings.profile.maxHROverride = Int($0) }))
                        .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 90)
                    Text("lpm")
                }
                Stepper(String(format: "Necesidad base de sueño: %.2f h", s.profile.sleepNeedHours), value: $s.profile.sleepNeedHours, in: 6...10, step: 0.25)
                TextField("Objetivo (p. ej. bajar a 75 kg y correr 10 km en 45 min)", text: $s.profile.goalText, axis: .vertical)
            }
            .onChange(of: settings.profile) { _, _ in profileDirty = true }

            if profileDirty {
                Section {
                    Button("Recalcular métricas con el perfil nuevo") { reanalyze() }
                }
            }

            Section {
                SecureField("sk-ant-…", text: $apiKey)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: apiKey) { _, v in settings.anthropicKey = v.trimmingCharacters(in: .whitespacesAndNewlines) }
                Picker("Modelo", selection: $s.claudeModel) { ForEach(ClaudeModel.allCases) { Text($0.label).tag($0) } }
                Toggle("Análisis automático cada mañana", isOn: $s.autoDailyAnalysis)
            } header: { Text("Coach IA (Claude)") } footer: {
                Text("Crea una clave en console.anthropic.com › API Keys. Se guarda en el llavero del iPhone y solo se envía a api.anthropic.com. Cada análisis diario cuesta céntimos (menos con Sonnet/Haiku).")
            }

            Section("Notificaciones") {
                Toggle("Recuperación al despertar", isOn: $s.notifyRecovery)
                Toggle("Recordatorio para acostarse", isOn: $s.notifyBedtime)
                Button("Permitir notificaciones") { Task { await NotificationService.requestPermission() } }
            }

            Section {
                Toggle("Mostrar SpO₂ estimada (experimental)", isOn: $s.showSpO2)
            } header: { Text("Métricas experimentales") } footer: {
                Text("La WHOOP 4.0 no expone la SpO₂ calibrada por Bluetooth; se estima con el cociente rojo/infrarrojo y puede ser imprecisa.")
            }

            Section {
                Button {
                    demoRunning = true
                    settings.demoMode = true
                    Task {
                        await DemoDataService.generate(context: model.context, engine: model.engine) { p in progress = p }
                        demoRunning = false
                        model.reportVersion += 1
                        model.banner = "Datos de demostración generados"
                    }
                } label: {
                    HStack { Text("Generar 3 semanas de datos demo"); if demoRunning { Spacer(); ProgressView(value: progress).frame(width: 80) } }
                }
                .disabled(demoRunning)
                Button("Recalcular todo el historial") { reanalyze() }.disabled(reanalyzing)
                if reanalyzing { ProgressView(value: progress) }
                Button("Borrar todos los datos", role: .destructive) { confirmWipe = true }
            } header: { Text("Datos") } footer: {
                Text("El modo demo crea datos sintéticos realistas para probar la app antes de que llegue la pulsera. Bórralos antes de empezar a usarla de verdad.")
            }

            Section("Acerca de") {
                StatRow(label: "Versión", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                Text("Pulso no está afiliada a WHOOP, Inc. Usa el protocolo Bluetooth documentado por proyectos de código abierto para interoperabilidad con tu propio dispositivo.")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
            }
        }
        .screenBackground()
        .navigationTitle("Ajustes")
        .confirmationDialog("¿Borrar todos los datos?", isPresented: $confirmWipe, titleVisibility: .visible) {
            Button("Borrar todo", role: .destructive) {
                Task {
                    await DemoDataService.wipeAll(context: model.context)
                    settings.demoMode = false
                    model.reportVersion += 1
                    model.banner = "Datos borrados"
                }
            }
        } message: { Text("Se eliminarán muestras, días, entrenos, medidas, planes y chats. No se puede deshacer.") }
    }

    func reanalyze() {
        reanalyzing = true
        profileDirty = false
        Task {
            await model.engine.reanalyzeAll { p in progress = p }
            reanalyzing = false
            model.reportVersion += 1
        }
    }
}

struct ExportView: View {
    @Environment(AppModel.self) private var model
    @State private var share: ShareItem?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        List {
            Section {
                Button { run { try ExportService.dailyCSV(context: model.context) } } label: { Label("Métricas diarias (CSV)", systemImage: "tablecells") }
                Button { run { try ExportService.jsonBackup(context: model.context) } } label: { Label("Copia completa (JSON)", systemImage: "doc.zipper") }
                Button {
                    busy = true
                    Task {
                        let now = Int(Date().timeIntervalSince1970)
                        do { share = ShareItem(url: try await SampleStore.shared.exportCSV(from: now - 7 * 86400, to: now)) }
                        catch { self.error = error.localizedDescription }
                        busy = false
                    }
                } label: { Label("Muestras segundo a segundo (7 días, CSV)", systemImage: "waveform") }
            } footer: {
                Text("Los datos son tuyos: expórtalos para Excel, Python o cualquier otra herramienta.")
            }
            if busy { ProgressView() }
            if let error { Text(error).foregroundStyle(Theme.red) }
        }
        .screenBackground()
        .navigationTitle("Exportar")
        .sheet(item: $share) { ShareSheet(items: [$0.url]) }
    }

    func run(_ f: () throws -> URL) {
        do { share = ShareItem(url: try f()) } catch { self.error = error.localizedDescription }
    }
}
