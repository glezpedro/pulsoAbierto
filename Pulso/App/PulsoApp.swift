import SwiftUI
import SwiftData

@main
struct PulsoApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    @MainActor static weak var sharedModel: AppModel?

    init() {
        let m = AppModel()
        _model = State(initialValue: m)
        PulsoApp.sharedModel = m
        AppModel.registerBackgroundTasks()
        m.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.settings)
                .environment(model.ble)
                .modelContainer(model.container)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .onOpenURL { url in
                    // pulso://localhost/strava is handled by ASWebAuthenticationSession; CSV files via "Abrir con"
                    if url.isFileURL, url.pathExtension.lowercased() == "csv" {
                        do {
                            let r = try model.integrations.importStrong(url: url)
                            model.banner = "Strong: \(r.added) entrenos nuevos de \(r.total)."
                        } catch {
                            model.banner = error.localizedDescription
                        }
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                model.ble.syncNow()
                Task { await model.processPending() }
            case .background:
                AppModel.scheduleBackgroundRefresh()
                AppModel.scheduleProcessing()
            default: break
            }
        }
    }
}
