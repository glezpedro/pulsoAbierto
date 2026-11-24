import SwiftUI
import UniformTypeIdentifiers
import WhoopKit

struct IntegrationsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @State private var clientSecret = StravaService.shared.clientSecret ?? ""
    @State private var connecting = false
    @State private var stravaConnected = StravaService.shared.isConnected
    @State private var importing = false
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                if stravaConnected {
                    Label("Conectado\(settings.stravaAthleteName.isEmpty ? "" : " como \(settings.stravaAthleteName)")", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Theme.green)
                    Button("Importar actividades (60 días)") {
                        busy = true
                        Task {
                            do { model.banner = "Strava: \(try await model.integrations.importStrava()) actividades nuevas" }
                            catch { model.banner = error.localizedDescription }
                            busy = false
                        }
                    }
                    .disabled(busy)
                    Button("Desconectar", role: .destructive) { StravaService.shared.disconnect(); stravaConnected = false }
                } else {
                    TextField("Client ID", text: Binding(get: { settings.stravaClientId }, set: { settings.stravaClientId = $0.trimmingCharacters(in: .whitespaces) }))
                        .keyboardType(.numberPad)
                    SecureField("Client Secret", text: $clientSecret)
                        .onChange(of: clientSecret) { _, v in StravaService.shared.clientSecret = v.trimmingCharacters(in: .whitespaces) }
                    Button {
                        connecting = true
                        Task {
                            do { try await StravaService.shared.connect(); stravaConnected = true; model.banner = "Strava conectado ✅" }
                            catch { model.banner = error.localizedDescription }
                            connecting = false
                        }
                    } label: { HStack { Text("Conectar con Strava"); if connecting { Spacer(); ProgressView() } } }
                    .disabled(settings.stravaClientId.isEmpty || clientSecret.isEmpty || connecting)
                }
            } header: { Text("Strava") } footer: {
                Text("Crea tu propia app gratuita en strava.com/settings/api (nombre: Pulso, web: http://localhost, «Authorization Callback Domain»: localhost) y copia aquí el Client ID y el Client Secret. Con ello Pulso importa tus actividades y puede subir entrenos con la FC de la pulsera.")
            }

            Section {
                Picker("Unidades de peso en Strong", selection: Binding(get: { settings.strongWeightUnit }, set: { settings.strongWeightUnit = $0 })) {
                    Text("kg").tag(WeightUnit.kg)
                    Text("lb").tag(WeightUnit.lb)
                }
                Button { importing = true } label: { Label("Importar CSV de Strong", systemImage: "doc.badge.plus") }
            } header: { Text("Strong") } footer: {
                Text("Strong no tiene API pública. En Strong: Perfil › Ajustes › Exportar datos de Strong → elige «Pulso» en el menú compartir (o guarda el archivo y pulsa Importar). Las sesiones se cruzan con tu FC para calcular su esfuerzo. Si activas Apple Salud en Strong, sus entrenos también entran por esa vía.")
            }

            Section {
                Toggle("Usar Apple Salud", isOn: Binding(get: { settings.healthKitEnabled }, set: { on in
                    if on {
                        Task {
                            let ok = await HealthKitService.shared.requestAuthorization()
                            settings.healthKitEnabled = ok
                            if ok { _ = await model.integrations.importHealthWorkouts() }
                        }
                    } else { settings.healthKitEnabled = false }
                }))
                if settings.healthKitEnabled {
                    Button("Importar entrenos de Salud") {
                        Task { model.banner = "Salud: \(await model.integrations.importHealthWorkouts()) entrenos nuevos" }
                    }
                }
            } header: { Text("Apple Salud") } footer: {
                Text("Lee pasos, peso y entrenos (Strong, Apple Watch, etc.). Escribe tu FC, FC en reposo, frecuencia respiratoria y fases de sueño.")
            }
        }
        .screenBackground()
        .navigationTitle("Integraciones")
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText, .data]) { result in
            if case .success(let url) = result {
                do {
                    let r = try model.integrations.importStrong(url: url)
                    model.banner = "Strong: \(r.added) entrenos nuevos de \(r.total)."
                } catch { model.banner = error.localizedDescription }
            }
        }
    }
}

