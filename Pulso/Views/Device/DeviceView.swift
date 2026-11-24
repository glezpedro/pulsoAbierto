import SwiftUI
import SwiftData
import WhoopKit

struct DeviceView: View {
    @Environment(WhoopBLEManager.self) private var ble
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Query(sort: \DeviceEventRecord.date, order: .reverse) private var events: [DeviceEventRecord]
    @State private var share: ShareItem?
    @State private var confirmForget = false
    @State private var storage = ""

    var body: some View {
        List {
            Section {
                HStack {
                    Image(systemName: "applewatch.radiowaves.left.and.right").font(.largeTitle).foregroundStyle(Theme.accent)
                    VStack(alignment: .leading) {
                        Text(ble.advertisingName ?? "WHOOP 4.0").font(.headline)
                        Text(ble.connection.spanish).font(.subheadline).foregroundStyle(ble.connection.isConnected ? Theme.green : Theme.secondaryText)
                    }
                }
                if let b = ble.battery { StatRow(label: "Batería", value: "\(Int(b)) %\(ble.charging ? " ⚡︎" : "")", icon: "battery.75") }
                if let w = ble.worn { StatRow(label: "En la muñeca", value: w ? "Sí" : "No", icon: "hand.raised") }
                if let s = ble.serial { StatRow(label: "Nº de serie", value: s, icon: "number") }
                if let f = ble.firmware { StatRow(label: "Firmware", value: f, icon: "cpu") }
                if let c = ble.strapClock { StatRow(label: "Reloj de la pulsera", value: c.formatted(date: .abbreviated, time: .standard), icon: "clock") }
                if let s = ble.lastSync { StatRow(label: "Última sincronización", value: s.formatted(date: .abbreviated, time: .shortened), icon: "arrow.triangle.2.circlepath") }
                StatRow(label: "Bloques confirmados (sesión)", value: "\(ble.totalChunksAcked)", icon: "checkmark.circle")
                if !ble.layoutNote.isEmpty { StatRow(label: "Formato de registro", value: ble.layoutNote, icon: "doc.text") }
                StatRow(label: "Datos guardados", value: storage, icon: "internaldrive")
            }

            if !ble.hasKnownStrap || ble.connection == .scanning || ble.connection == .idle && !ble.discovered.isEmpty {
                Section("Emparejar") {
                    Text("1. Cierra la app oficial de WHOOP (solo una app puede usar la pulsera).\n2. Pulsa Buscar con la pulsera cerca y cargada.\n3. Acepta la solicitud de emparejamiento Bluetooth de iOS.")
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                    Button(ble.connection == .scanning ? "Buscando…" : "Buscar pulsera") { ble.scan() }
                        .disabled(ble.connection == .scanning)
                    ForEach(ble.discovered) { d in
                        Button {
                            ble.connect(d.id)
                        } label: {
                            HStack {
                                Text(d.name)
                                Spacer()
                                Text("\(d.rssi) dBm").font(.caption).foregroundStyle(Theme.secondaryText)
                            }
                        }
                    }
                }
            }

            if ble.hasKnownStrap {
                Section("Acciones") {
                    Button { ble.syncNow() } label: { Label("Sincronizar ahora", systemImage: "arrow.triangle.2.circlepath") }
                        .disabled(!ble.connection.isConnected || ble.connection == .syncing)
                    Button { ble.setLiveHR(!ble.liveHREnabled) } label: {
                        Label(ble.liveHREnabled ? "Desactivar FC en directo" : "Activar FC en directo (BLE estándar)", systemImage: "heart.circle")
                    }
                    .disabled(!ble.connection.isConnected)
                    if ble.liveHREnabled {
                        Text("Mientras esté activa, cualquier app o equipo con Bluetooth (Strava, Zwift, cintas, bicis) puede leer tu FC como si fuera una banda de pecho.")
                            .font(.caption2).foregroundStyle(Theme.secondaryText)
                    }
                    Button { ble.buzz() } label: { Label("Hacer vibrar", systemImage: "iphone.radiowaves.left.and.right") }
                        .disabled(!ble.connection.isConnected)
                    Button { ble.refreshBattery() } label: { Label("Leer batería", systemImage: "battery.100") }
                        .disabled(!ble.connection.isConnected)
                    Button {
                        Task { await model.analyze(days: [Calendar.current.startOfDay(for: Date().addingTimeInterval(-86400)), Calendar.current.startOfDay(for: Date())]) }
                    } label: { Label("Recalcular hoy y ayer", systemImage: "function") }
                    Button(role: .destructive) { confirmForget = true } label: { Label("Olvidar pulsera", systemImage: "xmark.circle") }
                }
            }

            Section("Doble toque en la pulsera") {
                Picker("Acción", selection: Binding(get: { settings.doubleTapAction }, set: { settings.doubleTapAction = $0 })) {
                    Text("Empezar/terminar entreno (en pantalla En directo)").tag("workout")
                    Text("Nada").tag("none")
                }
            }

            Section("Eventos recientes") {
                if events.isEmpty { Text("Sin eventos").font(.caption).foregroundStyle(Theme.secondaryText) }
                ForEach(events.prefix(30)) { e in
                    HStack {
                        Text(e.label).font(.subheadline)
                        Spacer()
                        Text(e.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            }

            Section("Diagnóstico Bluetooth") {
                Toggle("Capturar tramas crudas (para depurar firmware nuevo)", isOn: Binding(get: { settings.rawCaptureEnabled }, set: { settings.rawCaptureEnabled = $0 }))
                if settings.rawCaptureEnabled { Text("\(BLELog.shared.rawCount) tramas capturadas").font(.caption) }
                Button("Exportar tramas crudas") { if let u = BLELog.shared.exportRaw() { share = ShareItem(url: u) } }
                Button("Exportar registro") { if let u = BLELog.shared.exportLog() { share = ShareItem(url: u) } }
                NavigationLink("Ver registro en vivo") { BLELogView() }
                if let e = ble.lastError { Text(e).font(.caption).foregroundStyle(Theme.red) }
            }
        }
        .screenBackground()
        .navigationTitle("Pulsera")
        .task {
            let bytes = await SampleStore.shared.totalBytes()
            let days = await SampleStore.shared.availableDays().count
            storage = "\(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)) · \(days) días"
        }
        .sheet(item: $share) { ShareSheet(items: [$0.url]) }
        .confirmationDialog("¿Olvidar la pulsera?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Olvidar", role: .destructive) { ble.forget() }
        } message: {
            Text("Tus datos se conservan. Para volver a emparejarla, olvídala también en Ajustes › Bluetooth del iPhone.")
        }
    }
}

struct BLELogView: View {
    @Environment(WhoopBLEManager.self) private var ble
    var log = BLELog.shared
    var body: some View {
        List(log.lines.reversed()) { l in
            VStack(alignment: .leading, spacing: 2) {
                Text(l.text).font(.system(.caption, design: .monospaced))
                    .foregroundStyle(l.level == .error ? Theme.red : (l.level == .warn ? Theme.yellow : (l.level == .tx ? Theme.strain : .white)))
                Text(l.date.formatted(date: .omitted, time: .standard)).font(.caption2).foregroundStyle(Theme.secondaryText)
            }
        }
        .screenBackground()
        .navigationTitle("Registro BLE")
        .toolbar { Button("Limpiar") { log.clear() } }
    }
}
