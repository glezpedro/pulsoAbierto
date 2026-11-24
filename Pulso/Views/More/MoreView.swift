import SwiftUI

struct MoreView: View {
    @Environment(WhoopBLEManager.self) private var ble
    var body: some View {
        NavigationStack {
            List {
                Section("Análisis") {
                    NavigationLink { TrendsView() } label: { Label("Tendencias y correlaciones", systemImage: "chart.xyaxis.line") }
                    NavigationLink { JournalView() } label: { Label("Diario de hábitos", systemImage: "book.closed") }
                    NavigationLink { WeeklyReportView() } label: { Label("Informe semanal", systemImage: "doc.text.magnifyingglass") }
                }
                Section("Tú") {
                    NavigationLink { BodyView() } label: { Label("Medidas corporales", systemImage: "figure.arms.open") }
                    NavigationLink { BreatheView() } label: { Label("Respiración guiada", systemImage: "wind") }
                }
                Section("Conexiones") {
                    NavigationLink { DeviceView() } label: {
                        HStack {
                            Label("Pulsera WHOOP", systemImage: "applewatch.radiowaves.left.and.right")
                            Spacer()
                            Text(ble.connection.spanish).font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    NavigationLink { IntegrationsView() } label: { Label("Strava, Strong y Apple Salud", systemImage: "link") }
                }
                Section("App") {
                    NavigationLink { SettingsView() } label: { Label("Ajustes", systemImage: "gearshape") }
                    NavigationLink { ExportView() } label: { Label("Exportar datos", systemImage: "square.and.arrow.up") }
                    NavigationLink { AboutView() } label: { Label("Cómo funciona", systemImage: "info.circle") }
                }
            }
            .screenBackground()
            .navigationTitle("Más")
        }
    }
}

struct AboutView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Card(title: "Tus datos, en tu iPhone", icon: "lock.shield") {
                    Text("Pulso habla directamente con la WHOOP 4.0 por Bluetooth usando el protocolo documentado por la comunidad (OpenWhoop, NOOP, OpenStrap). Descarga el historial segundo a segundo (FC, intervalos R-R, gravedad/movimiento, temperatura de piel y canales ópticos), lo guarda en el teléfono y calcula todas las métricas en local. Nada sale del dispositivo salvo lo que envíes al coach IA o a Strava.")
                        .font(.subheadline)
                }
                Card(title: "Métricas", icon: "function") {
                    Group {
                        Text("**VFC**: RMSSD de los intervalos R-R durante el sueño profundo final (Task Force 1996, filtro de latidos ectópicos de Malik).")
                        Text("**FC en reposo**: media durante sueño profundo.")
                        Text("**Respiración**: pico espectral 0,1–0,5 Hz de la arritmia sinusal respiratoria.")
                        Text("**Sueño**: detección por inmovilidad + FC baja; fases estimadas con FC, VFC, variabilidad y movimiento; necesidad = base + esfuerzo + deuda − siestas.")
                        Text("**Recuperación**: z-scores frente a tu línea base de 30 días (VFC 55 %, FC reposo 25 %, sueño 12 %, respiración y temperatura 4 % c/u) con curva logística.")
                        Text("**Esfuerzo**: carga cardiovascular TRIMP de Banister sobre la reserva de FC (Karvonen), escala 0–21 logarítmica.")
                        Text("**Calorías**: ecuaciones de Keytel (2005) en ejercicio + metabolismo basal Mifflin-St Jeor.")
                        Text("**Estrés**: FC elevada sin movimiento + caída de VFC (0–3).")
                        Text("**Carga**: ratio agudo:crónico (Gabbett) y monotonía (Foster).")
                    }
                    .font(.caption)
                }
                Card(title: "Limitaciones honestas", icon: "exclamationmark.triangle") {
                    Text("Los algoritmos de WHOOP son privados: aquí se usan métodos científicos publicados, así que los números no coincidirán exactamente con la app oficial. Las fases de sueño, la SpO₂ y la temperatura son estimaciones. No es un dispositivo médico.")
                        .font(.caption)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Cómo funciona")
    }
}
