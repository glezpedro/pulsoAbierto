import Foundation
import UserNotifications
import WhoopKit

enum NotificationService {
    static func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Morning recovery notification (once per day).
    static func notifyRecovery(_ report: DayReport) {
        guard AppSettings.shared.notifyRecovery, let rec = report.recovery else { return }
        let key = "notifiedRecovery-\(report.metrics.dayKey)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        let c = UNMutableNotificationContent()
        let emoji = rec.band == .green ? "🟢" : (rec.band == .yellow ? "🟡" : "🔴")
        c.title = "\(emoji) Recuperación \(Int(rec.score)) %"
        var body = ""
        if let s = report.sleepScore, let sl = report.sleep {
            body += "Sueño \(Int(s.score)) · \(Fmt.hm(Double(sl.minutesAsleep))) dormido. "
        }
        if let h = report.metrics.hrv { body += "VFC \(Int(h)) ms. " }
        if let t = report.strainTarget { body += "Strain objetivo \(Int(t.lowerBound))–\(Int(t.upperBound))." }
        c.body = body
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: key, content: c, trigger: nil))
    }

    /// Bedtime reminder 30 min before the recommended bedtime.
    static func scheduleBedtime(_ bedtime: Date, needMin: Double) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["bedtime"])
        guard AppSettings.shared.notifyBedtime else { return }
        let fire = bedtime.addingTimeInterval(-30 * 60)
        guard fire > Date() else { return }
        let c = UNMutableNotificationContent()
        c.title = "🌙 Hora de ir preparándose"
        c.body = "Para cubrir tu necesidad de \(Fmt.hm(needMin)) acuéstate a las \(bedtime.formatted(date: .omitted, time: .shortened))."
        c.sound = .default
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        center.add(UNNotificationRequest(identifier: "bedtime", content: c,
                                         trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
    }

    static func notify(_ title: String, _ body: String, id: String = UUID().uuidString) {
        let c = UNMutableNotificationContent()
        c.title = title; c.body = body; c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }
}
