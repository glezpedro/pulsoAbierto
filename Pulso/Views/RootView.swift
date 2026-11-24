import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @State private var tab = 0

    var body: some View {
        Group {
            if !settings.onboarded {
                OnboardingView()
            } else {
                TabView(selection: $tab) {
                    TodayView().tabItem { Label("Hoy", systemImage: "circle.hexagongrid.circle") }.tag(0)
                    SleepView().tabItem { Label("Sueño", systemImage: "moon.zzz.fill") }.tag(1)
                    TrainingView().tabItem { Label("Entreno", systemImage: "figure.strengthtraining.traditional") }.tag(2)
                    CoachView().tabItem { Label("Coach", systemImage: "sparkles") }.tag(3)
                    MoreView().tabItem { Label("Más", systemImage: "square.grid.2x2") }.tag(4)
                }
            }
        }
        .overlay(alignment: .top) {
            if let b = model.banner {
                Text(b)
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { model.banner = nil }
                    .task(id: b) {
                        try? await Task.sleep(for: .seconds(5))
                        withAnimation { model.banner = nil }
                    }
            }
        }
        .animation(.spring, value: model.banner)
    }
}
