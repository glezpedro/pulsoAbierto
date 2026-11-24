import Foundation

/// GATT identifiers and protocol enumerations for the WHOOP 4.0 strap ("Harvard" generation).
///
/// Sources: community reverse engineering (bWanShiTong/reverse-engineering-whoop-post,
/// ujix/noop docs/PROTOCOL_*.md, OpenStrap/edge). Values marked "observed" were seen working on
/// firmware MAXIM 41.17.6.0 / NORDIC 17.2.2.0 but are outside the officially enumerated set.
public enum WhoopUUID {
    public static let service          = "61080001-8D6D-82B8-614A-1C8CB0F8DCC6"
    public static let cmdToStrap       = "61080002-8D6D-82B8-614A-1C8CB0F8DCC6" // write
    public static let cmdFromStrap     = "61080003-8D6D-82B8-614A-1C8CB0F8DCC6" // notify (responses)
    public static let eventsFromStrap  = "61080004-8D6D-82B8-614A-1C8CB0F8DCC6" // notify (events)
    public static let dataFromStrap    = "61080005-8D6D-82B8-614A-1C8CB0F8DCC6" // notify (history / realtime, fragmented)
    public static let memfault         = "61080007-8D6D-82B8-614A-1C8CB0F8DCC6" // notify (crash logs)

    public static let heartRateService = "180D"
    public static let heartRateMeasurement = "2A37"
    public static let batteryService   = "180F"
    public static let batteryLevel     = "2A19"
    public static let deviceInfoService = "180A"
}

/// Byte [4] of every frame.
public enum PacketType: UInt8, CustomStringConvertible {
    case command = 35                 // 0x23 app -> strap
    case commandResponse = 36         // 0x24
    case puffinCommand = 37
    case puffinCommandResponse = 38
    case realtimeData = 40            // 0x28 live HR + R-R
    case realtimeRawData = 43         // 0x2B raw IMU / optical (high rate)
    case historicalData = 47          // 0x2F one record per second
    case event = 48                   // 0x30
    case metadata = 49                // 0x31 history START / END / COMPLETE
    case consoleLogs = 50
    case realtimeIMU = 51
    case historicalIMU = 52
    case relativePuffinEvents = 53
    case puffinEvents = 54
    case batteryPackLogs = 55
    case puffinMetadata = 56

    public var description: String { "\(self)".uppercased() }
}

/// Byte [6] of a type-35 command frame.
public enum WhoopCommand: UInt8, CaseIterable {
    case toggleRealtimeHR = 3
    case getHardwareInfo = 6
    case reportVersionInfo = 7
    case setClock = 10                 // observed
    case getClock = 11                 // observed
    case toggleGenericHRProfile = 14   // standard BLE heart-rate broadcast on/off
    case forgetBonds = 15
    case abortHistoricalTransmits = 20 // observed
    case sendHistoricalData = 22       // observed: start history offload
    case historicalDataResult = 23     // observed: ack a HISTORY_END block
    case getBatteryLevel = 26
    case rebootStrap = 29
    case getDataRange = 34
    case getHelloHarvard = 35
    case sendR10R11Realtime = 63       // raw stream (type 43) on/off
    case setAlarmTime = 66
    case getAlarmTime = 67
    case runAlarm = 68
    case disableAlarm = 69
    case getAdvertisingName = 76
    case setAdvertisingName = 77
    case runHapticsPattern = 79
    case startRawData = 81
    case stopRawData = 82
    case getBodyLocationAndStatus = 84
    case enterHighFreqSync = 96
    case exitHighFreqSync = 97
    case getExtendedBatteryInfo = 98
    case setIMUDataStream = 106
    case getIMUDataStream = 107
    case stopHaptics = 122

    /// Commands that can destroy data or brick the strap. Never sent by Pulso.
    public static let forbidden: Set<UInt8> = [25, 32, 36, 37, 38, 45, 99]
}

public enum MetadataType: UInt8 {
    case historyStart = 1
    case historyEnd = 2
    case historyComplete = 3
}

public enum CommandResult: UInt8 {
    case failure = 0, success = 1, pending = 2, unsupported = 3
}

public enum WhoopEventCode: UInt8, CaseIterable {
    case batteryLevel = 3
    case chargingOn = 7
    case chargingOff = 8
    case wristOn = 9
    case wristOff = 10
    case rtcLost = 13
    case doubleTap = 14
    case temperatureLevel = 17
    case bleBonded = 23
    case captouchAutothreshold = 32
    case bleRealtimeHROn = 33
    case bleRealtimeHROff = 34
    case ch1Saturation = 40
    case ch2Saturation = 41
    case accelSaturation = 42
    case rawDataOn = 46
    case rawDataOff = 47
    case strapAlarmSet = 56
    case strapAlarmExecuted = 57
    case appAlarmExecuted = 58
    case strapAlarmDisabled = 59
    case hapticsFired = 60
    case extendedBatteryInfo = 63
    case highFreqSyncPrompt = 96
    case highFreqSyncEnabled = 97
    case highFreqSyncDisabled = 98
    case hapticsTerminated = 100

    public var spanishName: String {
        switch self {
        case .batteryLevel: return "Nivel de batería"
        case .chargingOn: return "Cargando"
        case .chargingOff: return "Carga finalizada"
        case .wristOn: return "Pulsera puesta"
        case .wristOff: return "Pulsera quitada"
        case .rtcLost: return "Reloj interno perdido"
        case .doubleTap: return "Doble toque"
        case .temperatureLevel: return "Temperatura"
        case .bleBonded: return "Emparejada"
        case .captouchAutothreshold: return "Calibración táctil"
        case .bleRealtimeHROn: return "FC en directo activada"
        case .bleRealtimeHROff: return "FC en directo desactivada"
        case .ch1Saturation, .ch2Saturation: return "Saturación óptica"
        case .accelSaturation: return "Saturación acelerómetro"
        case .rawDataOn: return "Datos crudos ON"
        case .rawDataOff: return "Datos crudos OFF"
        case .strapAlarmSet: return "Alarma programada"
        case .strapAlarmExecuted: return "Alarma ejecutada"
        case .appAlarmExecuted: return "Alarma (app) ejecutada"
        case .strapAlarmDisabled: return "Alarma desactivada"
        case .hapticsFired: return "Vibración"
        case .extendedBatteryInfo: return "Info batería extendida"
        case .highFreqSyncPrompt: return "Sincronización rápida"
        case .highFreqSyncEnabled: return "Sinc. rápida ON"
        case .highFreqSyncDisabled: return "Sinc. rápida OFF"
        case .hapticsTerminated: return "Vibración terminada"
        }
    }
}
