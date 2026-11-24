import SwiftUI
import WhoopKit

enum Theme {
    static let bg = Color(red: 0.035, green: 0.043, blue: 0.055)
    static let card = Color(red: 0.086, green: 0.098, blue: 0.118)
    static let cardHi = Color(red: 0.125, green: 0.137, blue: 0.161)
    static let accent = Color(red: 0.0, green: 0.86, blue: 0.72)
    static let strain = Color(red: 0.20, green: 0.55, blue: 1.0)
    static let sleep = Color(red: 0.55, green: 0.48, blue: 1.0)
    static let green = Color(red: 0.09, green: 0.85, blue: 0.40)
    static let yellow = Color(red: 1.0, green: 0.80, blue: 0.10)
    static let red = Color(red: 1.0, green: 0.27, blue: 0.27)
    static let stress = Color(red: 1.0, green: 0.55, blue: 0.2)
    static let hr = Color(red: 1.0, green: 0.33, blue: 0.42)
    static let secondaryText = Color.white.opacity(0.6)

    static func recovery(_ score: Double?) -> Color {
        guard let s = score else { return .gray }
        switch RecoveryBand(s) {
        case .green: return green
        case .yellow: return yellow
        case .red: return red
        }
    }

    static func stage(_ s: SleepStage) -> Color {
        switch s {
        case .awake: return Color(red: 0.95, green: 0.6, blue: 0.55)
        case .light: return Color(red: 0.55, green: 0.65, blue: 1.0)
        case .deep: return Color(red: 0.35, green: 0.25, blue: 0.95)
        case .rem: return Color(red: 0.65, green: 0.85, blue: 1.0)
        }
    }

    static func zone(_ z: Int) -> Color {
        [Color.gray, Color(red: 0.55, green: 0.75, blue: 1.0), Color(red: 0.2, green: 0.8, blue: 0.5),
         Color(red: 1.0, green: 0.8, blue: 0.2), Color(red: 1.0, green: 0.5, blue: 0.2), Color(red: 1.0, green: 0.25, blue: 0.3)][max(0, min(5, z))]
    }
}

enum Fmt {
    static func hm(_ minutes: Double) -> String {
        let m = Int(minutes.rounded())
        return m >= 60 ? "\(m / 60) h \(String(format: "%02d", m % 60)) min" : "\(m) min"
    }
    static func hmShort(_ minutes: Double) -> String {
        let m = Int(minutes.rounded())
        return "\(m / 60):\(String(format: "%02d", m % 60))"
    }
    static func time(_ ts: Int?) -> String {
        guard let ts else { return "–" }
        return Date(timeIntervalSince1970: TimeInterval(ts)).formatted(date: .omitted, time: .shortened)
    }
    static func num(_ v: Double?, _ digits: Int = 0, unit: String = "") -> String {
        guard let v, v.isFinite else { return "–" }
        return String(format: "%.\(digits)f", v) + (unit.isEmpty ? "" : " \(unit)")
    }
    static func dayTitle(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Hoy" }
        if cal.isDateInYesterday(d) { return "Ayer" }
        return d.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)).capitalized
    }
}

struct Card<Content: View>: View {
    var title: String? = nil
    var icon: String? = nil
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack {
                    if let icon { Image(systemName: icon).foregroundStyle(Theme.accent) }
                    Text(title).font(.headline)
                    Spacer()
                    trailing
                }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct RingView: View {
    var progress: Double          // 0…1
    var color: Color
    var lineWidth: CGFloat = 12
    var label: String
    var value: String
    var caption: String? = nil

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().stroke(color.opacity(0.15), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: max(0.001, min(1, progress)))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.8), value: progress)
                VStack(spacing: 0) {
                    Text(value).font(.system(size: 22, weight: .bold, design: .rounded)).minimumScaleFactor(0.6)
                    if let caption { Text(caption).font(.caption2).foregroundStyle(Theme.secondaryText) }
                }
                .padding(lineWidth)
            }
            .aspectRatio(1, contentMode: .fit)
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(color)
        }
    }
}

struct MetricTile: View {
    var title: String
    var value: String
    var unit: String = ""
    var icon: String
    var color: Color = Theme.accent
    var delta: String? = nil
    var deltaGood: Bool? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.caption).foregroundStyle(color)
                Text(title).font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(.title2, design: .rounded).weight(.bold)).minimumScaleFactor(0.6).lineLimit(1)
                if !unit.isEmpty { Text(unit).font(.caption).foregroundStyle(Theme.secondaryText) }
            }
            if let delta {
                Text(delta).font(.caption2.weight(.medium))
                    .foregroundStyle(deltaGood == nil ? Theme.secondaryText : (deltaGood! ? Theme.green : Theme.red))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardHi, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct StatRow: View {
    var label: String
    var value: String
    var icon: String? = nil
    var body: some View {
        HStack {
            if let icon { Image(systemName: icon).foregroundStyle(Theme.secondaryText).frame(width: 22) }
            Text(label).foregroundStyle(Theme.secondaryText)
            Spacer()
            Text(value).fontWeight(.semibold).monospacedDigit()
        }
        .font(.subheadline)
    }
}

struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(Theme.accent)
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(Theme.secondaryText).multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity)
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

extension View {
    func screenBackground() -> some View {
        self.scrollContentBackground(.hidden).background(Theme.bg.ignoresSafeArea())
    }
}
