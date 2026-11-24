import SwiftUI
import SwiftData
import WhoopKit

struct JournalView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \JournalEntry.dayKey, order: .reverse) private var entries: [JournalEntry]
    @State private var date = Date()

    var body: some View {
        let key = DayKey.key(date)
        let entry = entries.first { $0.dayKey == key }
        List {
            Section {
                DatePicker("Día", selection: $date, in: ...Date(), displayedComponents: .date)
                Text("Marca lo que hiciste ese día. Pulso lo cruza con tu recuperación de la mañana siguiente.")
                    .font(.caption).foregroundStyle(Theme.secondaryText)
            }
            Section("Hábitos") {
                ForEach(JournalQuestion.all) { q in
                    Toggle(isOn: Binding(get: { (entry?.answers[q.key] ?? 0) > 0 }, set: { on in
                        let e = entry ?? { let n = JournalEntry(dayKey: key); model.context.insert(n); return n }()
                        var a = e.answers
                        a[q.key] = on ? 1 : 0
                        e.answers = a
                        try? model.context.save()
                    })) {
                        Label(q.text, systemImage: q.icon)
                    }
                }
            }
            Section("Notas") {
                TextField("¿Algo más? (cómo te sentiste, comidas, etc.)", text: Binding(get: { entry?.notes ?? "" }, set: { t in
                    let e = entry ?? { let n = JournalEntry(dayKey: key); model.context.insert(n); return n }()
                    e.notes = t
                    try? model.context.save()
                }), axis: .vertical)
            }
            Section("Impacto en tu recuperación") {
                let impacts = computeImpacts()
                if impacts.isEmpty {
                    Text("Con al menos 3 días con y 3 sin cada hábito verás aquí su efecto.").font(.caption).foregroundStyle(Theme.secondaryText)
                }
                ForEach(impacts, id: \.key) { imp in
                    HStack {
                        Text(JournalQuestion.all.first { $0.key == imp.key }?.short.capitalized ?? imp.key)
                        Spacer()
                        Text(String(format: "%+.0f %%", imp.delta)).fontWeight(.bold).foregroundStyle(imp.delta >= 0 ? Theme.green : Theme.red)
                        Text("(\(imp.n) d)").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Diario")
    }

    struct Impact { let key: String; let delta: Double; let n: Int }

    /// Mean next-morning recovery with vs without each habit.
    func computeImpacts() -> [Impact] {
        let metrics = model.recentMetrics(days: 120)
        var recByDay: [String: Double] = [:]
        for m in metrics { if let r = m.recovery { recByDay[m.dayKey] = r } }
        func nextKey(_ k: String) -> String? {
            guard let d = DayKey.date(k), let n = Calendar.current.date(byAdding: .day, value: 1, to: d) else { return nil }
            return DayKey.key(n)
        }
        var out: [Impact] = []
        for q in JournalQuestion.all {
            var yes: [Double] = [], no: [Double] = []
            for e in entries {
                guard let nk = nextKey(e.dayKey), let r = recByDay[nk] else { continue }
                if (e.answers[q.key] ?? 0) > 0 { yes.append(r) } else { no.append(r) }
            }
            if yes.count >= 3, no.count >= 3, let a = Stats.mean(yes), let b = Stats.mean(no) {
                out.append(Impact(key: q.key, delta: a - b, n: yes.count))
            }
        }
        return out.sorted { abs($0.delta) > abs($1.delta) }
    }
}
