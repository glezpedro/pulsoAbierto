import SwiftUI
import SwiftData
import Charts

struct BodyView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Query(sort: \BodyMeasurement.date, order: .reverse) private var items: [BodyMeasurement]
    @State private var showAdd = false
    @State private var chartField: Field = .weight

    enum Field: String, CaseIterable, Identifiable {
        case weight, bodyFat, waist, chest, hips, neck, arm, thigh, calf
        var id: String { rawValue }
        var label: String {
            switch self {
            case .weight: return "Peso"
            case .bodyFat: return "% Grasa"
            case .waist: return "Cintura"
            case .chest: return "Pecho"
            case .hips: return "Cadera"
            case .neck: return "Cuello"
            case .arm: return "Brazo"
            case .thigh: return "Muslo"
            case .calf: return "Gemelo"
            }
        }
        var unit: String { self == .weight ? "kg" : (self == .bodyFat ? "%" : "cm") }
        func get(_ m: BodyMeasurement) -> Double? {
            switch self {
            case .weight: return m.weightKg
            case .bodyFat: return m.bodyFatPct
            case .waist: return m.waistCm
            case .chest: return m.chestCm
            case .hips: return m.hipsCm
            case .neck: return m.neckCm
            case .arm: return m.armCm
            case .thigh: return m.thighCm
            case .calf: return m.calfCm
            }
        }
    }

    var body: some View {
        let p = settings.profile
        let latestW = items.compactMap(\.weightKg).first ?? p.weightKg
        let latestBF = items.compactMap(\.bodyFatPct).first ?? navyBodyFat()
        ScrollView {
            VStack(spacing: 14) {
                Card(title: "Composición", icon: "figure.arms.open") {
                    let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
                    LazyVGrid(columns: cols, spacing: 10) {
                        MetricTile(title: "Peso", value: String(format: "%.1f", latestW), unit: "kg", icon: "scalemass")
                        MetricTile(title: "IMC", value: String(format: "%.1f", latestW / pow(p.heightCm / 100, 2)), icon: "person")
                        MetricTile(title: "% Grasa", value: latestBF.map { String(format: "%.1f", $0) } ?? "–", unit: "%", icon: "drop.halffull", color: Theme.yellow)
                        if let bf = latestBF {
                            let lean = latestW * (1 - bf / 100)
                            MetricTile(title: "Masa magra", value: String(format: "%.1f", lean), unit: "kg", icon: "bolt.fill", color: Theme.green)
                            MetricTile(title: "FFMI", value: String(format: "%.1f", lean / pow(p.heightCm / 100, 2) + 6.1 * (1.8 - p.heightCm / 100)), icon: "figure.strengthtraining.traditional", color: Theme.strain)
                        }
                        MetricTile(title: "Metab. basal", value: "\(Int(p.physio.bmr))", unit: "kcal", icon: "flame", color: Theme.stress)
                    }
                    if items.compactMap(\.bodyFatPct).first == nil, navyBodyFat() != nil {
                        Text("% grasa estimado con la fórmula de la Marina de EE. UU. (cuello, cintura\(p.sex == .female ? ", cadera" : "") y altura).")
                            .font(.caption2).foregroundStyle(Theme.secondaryText)
                    }
                }
                Card(title: "Evolución", icon: "chart.line.uptrend.xyaxis") {
                    Picker("Medida", selection: $chartField) { ForEach(Field.allCases) { Text($0.label).tag($0) } }
                    let pts = items.compactMap { m in chartField.get(m).map { DayPoint(date: m.date, value: $0) } }.sorted { $0.date < $1.date }
                    if pts.count >= 2 {
                        Chart(pts) { pt in
                            LineMark(x: .value("Fecha", pt.date), y: .value(chartField.label, pt.value)).foregroundStyle(Theme.accent)
                            PointMark(x: .value("Fecha", pt.date), y: .value(chartField.label, pt.value)).foregroundStyle(Theme.accent)
                        }
                        .chartYScale(domain: .automatic(includesZero: false))
                        .frame(height: 180)
                        if let f = pts.first?.value, let l = pts.last?.value {
                            Text(String(format: "%+.1f %@ desde %@", l - f, chartField.unit, pts.first!.date.formatted(date: .abbreviated, time: .omitted)))
                                .font(.caption)
                        }
                    } else {
                        Text("Añade al menos dos registros para ver la evolución.").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
                Card(title: "Registros", icon: "list.bullet") {
                    if items.isEmpty { Text("Sin registros").font(.caption).foregroundStyle(Theme.secondaryText) }
                    ForEach(items) { m in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.date.formatted(date: .abbreviated, time: .omitted)).font(.subheadline.weight(.semibold))
                            Text(Field.allCases.compactMap { f in f.get(m).map { "\(f.label) \(String(format: "%.1f", $0))\(f.unit)" } }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                        .contextMenu {
                            Button(role: .destructive) { model.context.delete(m); try? model.context.save() } label: { Label("Eliminar", systemImage: "trash") }
                        }
                        Divider()
                    }
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Medidas")
        .toolbar { Button { showAdd = true } label: { Image(systemName: "plus") } }
        .sheet(isPresented: $showAdd) { AddMeasurementView() }
    }

    /// U.S. Navy circumference method.
    func navyBodyFat() -> Double? {
        let h = settings.profile.heightCm
        guard let waist = items.compactMap(\.waistCm).first, let neck = items.compactMap(\.neckCm).first, waist > neck else { return nil }
        if settings.profile.sex == .male {
            return 495 / (1.0324 - 0.19077 * log10(waist - neck) + 0.15456 * log10(h)) - 450
        }
        guard let hips = items.compactMap(\.hipsCm).first else { return nil }
        return 495 / (1.29579 - 0.35004 * log10(waist + hips - neck) + 0.22100 * log10(h)) - 450
    }
}

struct AddMeasurementView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var values: [String: String] = [:]
    @State private var notes = ""

    let fields: [(String, String)] = [("weight", "Peso (kg)"), ("bodyFat", "% Grasa"), ("waist", "Cintura (cm)"), ("chest", "Pecho (cm)"),
                                      ("hips", "Cadera (cm)"), ("neck", "Cuello (cm)"), ("arm", "Brazo (cm)"), ("thigh", "Muslo (cm)"), ("calf", "Gemelo (cm)")]

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Fecha", selection: $date, displayedComponents: .date)
                Section("Medidas (deja en blanco lo que no midas)") {
                    ForEach(fields, id: \.0) { key, label in
                        HStack {
                            Text(label)
                            Spacer()
                            TextField("–", text: Binding(get: { values[key] ?? "" }, set: { values[key] = $0 }))
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90)
                        }
                    }
                }
                Section { TextField("Notas", text: $notes) }
            }
            .navigationTitle("Nueva medición")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Guardar") { save() } }
            }
        }
    }

    func v(_ k: String) -> Double? { values[k].flatMap { Double($0.replacingOccurrences(of: ",", with: ".")) } }

    func save() {
        let m = BodyMeasurement(date: date, weightKg: v("weight"), bodyFatPct: v("bodyFat"), waistCm: v("waist"), chestCm: v("chest"),
                                hipsCm: v("hips"), neckCm: v("neck"), armCm: v("arm"), thighCm: v("thigh"), calfCm: v("calf"), notes: notes)
        model.context.insert(m)
        try? model.context.save()
        if let w = m.weightKg {
            settings.profile.weightKg = w
            if settings.healthKitEnabled { Task { await HealthKitService.shared.writeWeight(w, date: date) } }
        }
        dismiss()
    }
}
