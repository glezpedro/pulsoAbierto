import Foundation
import CoreBluetooth
import Observation
import WhoopKit

struct DiscoveredStrap: Identifiable, Equatable {
    let id: UUID
    let name: String
    var rssi: Int
}

enum StrapConnection: Equatable {
    case bluetoothOff, unauthorized, idle, scanning, connecting, pairing, handshaking, ready, syncing, disconnected

    var spanish: String {
        switch self {
        case .bluetoothOff: return "Bluetooth apagado"
        case .unauthorized: return "Sin permiso de Bluetooth"
        case .idle: return "Sin conectar"
        case .scanning: return "Buscando pulsera…"
        case .connecting: return "Conectando…"
        case .pairing: return "Emparejando…"
        case .handshaking: return "Preparando…"
        case .ready: return "Conectada"
        case .syncing: return "Sincronizando…"
        case .disconnected: return "Desconectada (reconectará sola)"
        }
    }
    var isConnected: Bool { [.handshaking, .ready, .syncing].contains(self) }
}

/// CoreBluetooth driver for the WHOOP 4.0.
///
/// Connect flow (one handshake per connection, per community docs):
///  1. scan for service 61080001 / connect / discover
///  2. confirmed write of GET_BATTERY_LEVEL → triggers iOS pairing; command traffic usable after ack
///  3. subscribe to 0003 (responses), 0004 (events), 0005 (data), 2A37 (standard HR), 2A19
///  4. HELLO, adv name, versions, SET_CLOCK, GET_CLOCK, raw stream off, GET_DATA_RANGE
///  5. history offload: SEND_HISTORICAL_DATA → START / records / END → persist → ack(END block) … COMPLETE
@MainActor
@Observable
final class WhoopBLEManager: NSObject {
    static let shared = WhoopBLEManager()

    // Public state
    private(set) var connection: StrapConnection = .idle
    private(set) var discovered: [DiscoveredStrap] = []
    private(set) var battery: Double?
    private(set) var charging = false
    private(set) var worn: Bool?
    private(set) var serial: String?
    private(set) var advertisingName: String?
    private(set) var firmware: String?
    private(set) var strapClock: Date?
    private(set) var lastSync: Date?
    private(set) var syncRecordsThisRun = 0
    private(set) var totalChunksAcked = 0
    private(set) var liveHR: Int?
    private(set) var liveRR: [UInt16] = []
    private(set) var liveHREnabled = false
    private(set) var layoutNote: String = ""
    private(set) var lastError: String?
    var hasKnownStrap: Bool { knownIdentifier != nil }

    /// Persist decoded history samples; return true only when durably saved (the ack depends on it).
    var onHistorySamples: (([StrapSample]) async -> Bool)?
    /// Live heart-rate tick (bpm, rr ms).
    var onLiveHR: ((Int, [UInt16]) -> Void)?
    var onEvent: ((WhoopEvent) -> Void)?
    var onSyncFinished: (() -> Void)?

    // CoreBluetooth
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var chars: [CBUUID: CBCharacteristic] = [:]
    private var assemblers: [CBUUID: FrameAssembler] = [:]
    private var seq: UInt8 = 0
    private var pending: [UInt8: CheckedContinuation<CommandResponse?, Never>] = [:]
    private var pairingWriteDone = false
    private var handshakeDone = false
    private var historyFrames: [[UInt8]] = []
    private var historyActive = false
    private var lastHistoryTraffic = Date.distantPast
    private var watchdog: Task<Void, Never>?
    private var periodicSync: Task<Void, Never>?
    private var lastSyncStart = Date.distantPast
    private var scanTimeout: Task<Void, Never>?
    private var unfilteredScan = false

    static let restoreID = "com.pulso.ble.central"
    private let serviceUUID = CBUUID(string: WhoopUUID.service)
    private let cmdTo = CBUUID(string: WhoopUUID.cmdToStrap)
    private let cmdFrom = CBUUID(string: WhoopUUID.cmdFromStrap)
    private let events = CBUUID(string: WhoopUUID.eventsFromStrap)
    private let data = CBUUID(string: WhoopUUID.dataFromStrap)
    private let memfault = CBUUID(string: WhoopUUID.memfault)
    private let hrService = CBUUID(string: WhoopUUID.heartRateService)
    private let hrMeasurement = CBUUID(string: WhoopUUID.heartRateMeasurement)
    private let batteryService = CBUUID(string: WhoopUUID.batteryService)
    private let batteryLevel = CBUUID(string: WhoopUUID.batteryLevel)

    private var knownIdentifier: UUID? {
        get { UserDefaults.standard.string(forKey: "strapUUID").flatMap(UUID.init) }
        set { UserDefaults.standard.set(newValue?.uuidString, forKey: "strapUUID") }
    }

    private let log = BLELog.shared

    override init() {
        super.init()
        lastSync = UserDefaults.standard.object(forKey: "lastStrapSync") as? Date
        battery = UserDefaults.standard.object(forKey: "lastBattery") as? Double
        serial = UserDefaults.standard.string(forKey: "strapSerial")
        firmware = UserDefaults.standard.string(forKey: "strapFirmware")
    }

    /// Creates the central (call at launch so iOS can restore background state).
    func start() {
        guard central == nil else { return }
        central = CBCentralManager(delegate: self, queue: .main, options: [
            CBCentralManagerOptionRestoreIdentifierKey: Self.restoreID,
            CBCentralManagerOptionShowPowerAlertKey: true
        ])
    }

    // MARK: - Public API

    func scan() {
        guard central?.state == .poweredOn else { return }
        discovered.removeAll()
        connection = .scanning
        log.log("Escaneando servicio WHOOP…")
        central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        // Also list straps already connected to iOS (e.g. still bonded) which do not advertise.
        for p in central.retrieveConnectedPeripherals(withServices: [serviceUUID]) {
            addDiscovered(p, rssi: -50)
        }
        scanTimeout?.cancel()
        scanTimeout = Task { [weak self] in
            // Fallback: some straps do not include the service UUID in the advertisement → scan
            // everything and filter by name.
            try? await Task.sleep(for: .seconds(8))
            guard let self, self.connection == .scanning else { return }
            if self.discovered.isEmpty {
                self.unfilteredScan = true
                self.central.stopScan()
                self.central.scanForPeripherals(withServices: nil, options: nil)
                self.log.log("Sin resultados filtrando por servicio: buscando por nombre «WHOOP»…")
            }
            try? await Task.sleep(for: .seconds(22))
            guard self.connection == .scanning else { return }
            self.central.stopScan()
            self.unfilteredScan = false
            self.connection = .idle
        }
    }

    func stopScan() {
        central?.stopScan()
        unfilteredScan = false
        if connection == .scanning { connection = .idle }
    }

    func connect(_ id: UUID) {
        guard let p = central.retrievePeripherals(withIdentifiers: [id]).first else { return }
        central.stopScan()
        knownIdentifier = id
        connect(peripheral: p)
    }

    func forget() {
        if let p = peripheral { central.cancelPeripheralConnection(p) }
        peripheral = nil
        knownIdentifier = nil
        serial = nil; firmware = nil; battery = nil
        connection = .idle
        log.log("Pulsera olvidada. Para volver a emparejar, olvídala también en Ajustes › Bluetooth.", .warn)
    }

    func disconnect() {
        if let p = peripheral { central.cancelPeripheralConnection(p) }
    }

    /// Starts a history offload if connected and not already syncing.
    func syncNow() {
        guard connection == .ready, handshakeDone, !historyActive else {
            if connection == .disconnected || connection == .idle { reconnectKnown() }
            return
        }
        Task { await startHistory() }
    }

    func setLiveHR(_ on: Bool) {
        Task {
            _ = await send(.toggleGenericHRProfile, payload: [on ? 1 : 0])
            liveHREnabled = on
            if !on { liveHR = nil; liveRR = [] }
            log.log("FC en directo \(on ? "activada" : "desactivada")")
        }
    }

    func buzz() {
        Task {
            _ = await send(.runHapticsPattern, payload: WhoopParser.hapticsPayload())
            _ = await send(.runAlarm, payload: [0x01])
        }
    }

    func setAlarm(_ date: Date) async -> Bool {
        let r = await send(.setAlarmTime, payload: WhoopParser.alarmPayload(date))
        log.log("Alarma en pulsera → \(date.formatted(date: .omitted, time: .shortened)) result=\(r?.resultRaw ?? 255)")
        return r?.result == .success
    }

    func disableAlarm() async {
        _ = await send(.disableAlarm, payload: [0x01])
    }

    func refreshBattery() {
        Task {
            if let r = await send(.getBatteryLevel), let b = WhoopParser.batteryPercent(r) { setBattery(b) }
        }
    }

    func reboot() {
        Task { _ = await send(.rebootStrap, payload: [0x00]) }
    }

    // MARK: - Internals

    private func reconnectKnown() {
        guard let central, central.state == .poweredOn, let id = knownIdentifier else { return }
        if let p = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(peripheral: p)
        }
    }

    private func connect(peripheral p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        if p.state == .connected {
            // Already linked (e.g. restored by iOS in the background): just (re)discover.
            guard !handshakeDone && !pairingWriteDone else { return }
            connection = .handshaking
            p.discoverServices([serviceUUID, hrService, batteryService])
            return
        }
        connection = .connecting
        log.log("Conectando a \(p.name ?? p.identifier.uuidString)…")
        // A pending connect never times out: iOS completes it whenever the strap is in range,
        // even with the app in the background (relaunching it through state restoration).
        central.connect(p, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: false])
    }

    private func addDiscovered(_ p: CBPeripheral, rssi: Int) {
        let name = p.name ?? "WHOOP"
        if let i = discovered.firstIndex(where: { $0.id == p.identifier }) {
            discovered[i].rssi = rssi
        } else {
            discovered.append(DiscoveredStrap(id: p.identifier, name: name, rssi: rssi))
        }
    }

    private func setBattery(_ v: Double) {
        battery = v
        UserDefaults.standard.set(v, forKey: "lastBattery")
    }

    private func resetLinkState() {
        chars.removeAll()
        assemblers.removeAll()
        pairingWriteDone = false
        handshakeDone = false
        historyActive = false
        historyFrames.removeAll()
        watchdog?.cancel(); periodicSync?.cancel()
        liveHR = nil; liveHREnabled = false
        for (_, c) in pending { c.resume(returning: nil) }
        pending.removeAll()
    }

    private func nextSeq() -> UInt8 {
        seq = seq &+ 1
        if seq == 0 { seq = 1 }
        return seq
    }

    /// Sends a command and waits (≤ timeout) for its type-36 response.
    @discardableResult
    func send(_ cmd: WhoopCommand, payload: [UInt8] = [0x00], timeout: Double = 4) async -> CommandResponse? {
        guard let p = peripheral, let c = chars[cmdTo] else { return nil }
        let s = nextSeq()
        let frame = WhoopFrame.command(cmd, sequence: s, payload: payload)
        let type: CBCharacteristicWriteType = c.properties.contains(.write) ? .withResponse : .withoutResponse
        log.log("→ \(cmd) \(payload.hex)", .tx)
        p.writeValue(Data(frame), for: c, type: type)
        return await withCheckedContinuation { (cont: CheckedContinuation<CommandResponse?, Never>) in
            MainActor.assumeIsolated { self.pending[s] = cont }
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(timeout))
                guard let self, let c = self.pending.removeValue(forKey: s) else { return }
                c.resume(returning: nil)
            }
        }
    }

    private func beginPairingWrite() {
        guard let p = peripheral, let c = chars[cmdTo] else { return }
        connection = .pairing
        let frame = WhoopFrame.command(.getBatteryLevel, sequence: nextSeq(), payload: [0x00])
        log.log("Escritura confirmada GET_BATTERY_LEVEL (activa el emparejamiento de iOS)…")
        p.writeValue(Data(frame), for: c, type: .withResponse)
    }

    private func subscribeAll() {
        guard let p = peripheral else { return }
        for u in [cmdFrom, events, data, memfault, hrMeasurement, batteryLevel] {
            if let c = chars[u], c.properties.contains(.notify) || c.properties.contains(.indicate) {
                p.setNotifyValue(true, for: c)
            }
        }
    }

    private func handshake() async {
        guard !handshakeDone else { return }
        connection = .handshaking
        subscribeAll()
        try? await Task.sleep(for: .milliseconds(600))
        if let r = await send(.getHelloHarvard), let s = WhoopParser.serial(fromHello: r) {
            serial = s; UserDefaults.standard.set(s, forKey: "strapSerial")
        }
        if let r = await send(.getAdvertisingName) { advertisingName = WhoopParser.advertisingName(r) }
        if let r = await send(.reportVersionInfo), let v = WhoopParser.versions(r) {
            firmware = "MAXIM \(v.harvard) · NORDIC \(v.boylston)"
            UserDefaults.standard.set(firmware, forKey: "strapFirmware")
        }
        // The strap clock ships unset (epoch 0): always set it before reading history.
        let setR = await send(.setClock, payload: WhoopParser.setClockPayload())
        if let r = await send(.getClock) { strapClock = WhoopParser.clock(r) }
        log.log("Reloj: set=\(setR?.resultRaw ?? 255) leído=\(strapClock?.formatted() ?? "?")")
        _ = await send(.sendR10R11Realtime, payload: [0x00])   // stop the raw type-43 flood
        _ = await send(.getDataRange)
        if let r = await send(.getBatteryLevel), let b = WhoopParser.batteryPercent(r) { setBattery(b) }
        handshakeDone = true
        connection = .ready
        try? await Task.sleep(for: .milliseconds(1500))
        await startHistory()
        schedulePeriodicSync()
    }

    private func schedulePeriodicSync() {
        periodicSync?.cancel()
        periodicSync = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                guard let self else { return }
                if self.connection == .ready && !self.historyActive { await self.startHistory() }
            }
        }
    }

    private func startHistory() async {
        guard !historyActive else { return }
        historyActive = true
        connection = .syncing
        syncRecordsThisRun = 0
        historyFrames.removeAll()
        lastSyncStart = Date()
        lastHistoryTraffic = Date()
        log.log("Iniciando descarga de historial…")
        _ = await send(.sendHistoricalData, payload: [0x00])
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard let self else { return }
                if self.historyActive && Date().timeIntervalSince(self.lastHistoryTraffic) > 60 {
                    self.log.log("Historial inactivo 60 s: se da por terminado.", .warn)
                    _ = await self.send(.abortHistoricalTransmits, payload: [0x00])
                    self.finishHistory()
                    return
                }
            }
        }
    }

    private func finishHistory() {
        historyActive = false
        watchdog?.cancel()
        if connection == .syncing { connection = .ready }
        lastSync = Date()
        UserDefaults.standard.set(lastSync, forKey: "lastStrapSync")
        log.log("Sincronización completa: \(syncRecordsThisRun) registros.")
        onSyncFinished?()
    }

    // MARK: Frame handling

    private func handle(frame f: WhoopFrame, from uuid: CBUUID) {
        switch WhoopParser.parse(f) {
        case .response(let r):
            log.log("← resp cmd=\(r.command) res=\(r.resultRaw) \(r.body.prefix(24).map { String(format: "%02x", $0) }.joined())", .rx)
            if let c = pending.removeValue(forKey: r.originSequence) {
                c.resume(returning: r)
            } else if let key = pending.first(where: { _ in true })?.key, pending.count == 1 {
                // some firmware echoes a different sequence: resolve the only waiter
                pending.removeValue(forKey: key)?.resume(returning: r)
            }
        case .event(let e):
            handle(event: e)
        case .metadata(let m):
            lastHistoryTraffic = Date()
            switch m.type {
            case .historyStart?:
                historyFrames.removeAll()
            case .historyEnd?:
                let frames = historyFrames
                historyFrames.removeAll()
                Task { await self.commitChunk(frames, ack: m.ackBlock) }
            case .historyComplete?:
                finishHistory()
            case nil:
                log.log("Metadata desconocida \(m.typeRaw)", .warn)
            }
        case .history(_, let raw):
            lastHistoryTraffic = Date()
            if !historyActive { historyActive = true; connection = .syncing }
            historyFrames.append(raw)
        case .realtime(let r):
            liveHR = Int(r.bpm)
            if !r.rr.isEmpty { liveRR = r.rr }
            onLiveHR?(Int(r.bpm), r.rr)
        case .raw:
            break
        case .unknown(let f):
            log.log("Trama tipo \(f.typeRaw) (\(f.bytes.count) B) sin decodificar", .warn)
        }
    }

    private func commitChunk(_ frames: [[UInt8]], ack: [UInt8]?) async {
        let decoded = HistoryDecoder.decodeChunk(frames)
        if !decoded.layoutNote.isEmpty { layoutNote = decoded.layoutNote }
        var ok = true
        if !decoded.samples.isEmpty, let save = onHistorySamples {
            ok = await save(decoded.samples)
        }
        guard ok else {
            log.log("Error guardando \(decoded.samples.count) registros: NO se confirma el bloque (se reenviará).", .error)
            return
        }
        syncRecordsThisRun += decoded.samples.count
        if let block = ack {
            let r = await send(.historicalDataResult, payload: WhoopParser.historyAckPayload(block))
            totalChunksAcked += 1
            log.log("Bloque confirmado (\(decoded.samples.count) reg, \(decoded.layoutNote)) res=\(r?.resultRaw ?? 255)")
        }
    }

    private func handle(event e: WhoopEvent) {
        let name = e.code?.spanishName ?? "Evento \(e.codeRaw)"
        log.log("Evento: \(name)", .rx)
        switch e.code {
        case .batteryLevel?:
            if let b = e.battery { setBattery(b.percent); charging = b.charging }
        case .chargingOn?: charging = true
        case .chargingOff?: charging = false
        case .wristOn?: worn = true
        case .wristOff?: worn = false
        case .bleRealtimeHROn?: liveHREnabled = true
        case .bleRealtimeHROff?: liveHREnabled = false
        default: break
        }
        onEvent?(e)
        // Opportunistic background sync: events wake the app; pull history at most every 15 min.
        if connection == .ready && !historyActive && Date().timeIntervalSince(lastSyncStart) > 15 * 60 {
            Task { await startHistory() }
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension WhoopBLEManager: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        MainActor.assumeIsolated {
            switch central.state {
            case .poweredOn:
                if connection == .bluetoothOff || connection == .unauthorized || connection == .idle { connection = .idle }
                reconnectKnown()
            case .poweredOff: connection = .bluetoothOff; resetLinkState()
            case .unauthorized: connection = .unauthorized
            default: break
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        MainActor.assumeIsolated {
            if let ps = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral], let p = ps.first {
                log.log("Restaurado desde segundo plano: \(p.name ?? "WHOOP")")
                peripheral = p
                p.delegate = self
                if knownIdentifier == nil { knownIdentifier = p.identifier }
                // discovery / reconnection continues in centralManagerDidUpdateState → reconnectKnown()
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                                    advertisementData: [String: Any], rssi RSSI: NSNumber) {
        MainActor.assumeIsolated {
            if unfilteredScan {
                let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
                guard name.uppercased().contains("WHOOP") else { return }
            }
            addDiscovered(peripheral, rssi: RSSI.intValue)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        MainActor.assumeIsolated {
            log.log("Conectada. Descubriendo servicios…")
            resetLinkState()
            knownIdentifier = peripheral.identifier
            connection = .handshaking
            peripheral.discoverServices([serviceUUID, hrService, batteryService])
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated {
            lastError = error?.localizedDescription
            log.log("Fallo de conexión: \(error?.localizedDescription ?? "?")", .error)
            connection = .disconnected
            connect(peripheral: peripheral)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated {
            log.log("Desconectada \(error.map { "(\($0.localizedDescription))" } ?? "")", .warn)
            let wasSyncing = historyActive
            resetLinkState()
            connection = .disconnected
            if wasSyncing { onSyncFinished?() }
            if knownIdentifier != nil { connect(peripheral: peripheral) } // auto-reconnect when back in range
        }
    }
}

// MARK: - CBPeripheralDelegate

extension WhoopBLEManager: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        MainActor.assumeIsolated {
            for s in peripheral.services ?? [] { peripheral.discoverCharacteristics(nil, for: s) }
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        MainActor.assumeIsolated {
            for c in service.characteristics ?? [] {
                chars[c.uuid] = c
                assemblers[c.uuid] = FrameAssembler()
            }
            if service.uuid == serviceUUID, chars[cmdTo] != nil, !pairingWriteDone {
                beginPairingWrite()
            }
            if service.uuid == hrService, let c = chars[hrMeasurement] { peripheral.setNotifyValue(true, for: c) }
            if service.uuid == batteryService, let c = chars[batteryLevel] { peripheral.readValue(for: c) }
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated {
            guard characteristic.uuid == cmdTo, !pairingWriteDone else { return }
            if let error {
                log.log("Escritura rechazada (\(error.localizedDescription)). Acepta la solicitud de emparejamiento; reintento…", .warn)
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    if !self.pairingWriteDone { self.beginPairingWrite() }
                }
                return
            }
            pairingWriteDone = true
            log.log("Enlace listo (escritura confirmada).")
            Task { await handshake() }
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated {
            guard let value = characteristic.value else { return }
            let bytes = [UInt8](value)
            let uuid = characteristic.uuid
            if uuid == hrMeasurement {
                if let hr = StandardHeartRate.parse(bytes) {
                    liveHR = hr.bpm
                    if !hr.rr.isEmpty { liveRR = hr.rr }
                    onLiveHR?(hr.bpm, hr.rr)
                }
                return
            }
            if uuid == batteryLevel {
                // Some WHOOP 4 report a constant 100 here; only use it when nothing better exists.
                if battery == nil, let b = bytes.first { setBattery(Double(b)) }
                return
            }
            BLELog.shared.captureRaw(bytes.hex, characteristic: String(uuid.uuidString.prefix(8)))
            let asm = assemblers[uuid] ?? FrameAssembler()
            assemblers[uuid] = asm
            for f in asm.push(bytes) { handle(frame: f, from: uuid) }
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated {
            if let error { log.log("Notify \(characteristic.uuid): \(error.localizedDescription)", .warn) }
        }
    }
}
