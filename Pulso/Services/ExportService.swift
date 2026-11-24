import Foundation
import SwiftData
import WhoopKit

/// Exports everything (daily metrics CSV, full JSON backup, raw samples) for the share sheet.
@MainActor
enum ExportService {
    static func dailyCSV(context: ModelContext) throws -> URL {
        let recs = try context.fetch(FetchDescriptor<DailyRecord>(sortBy: [SortDescriptor(\.dayStart)]))
        var t = "fecha,recuperacion,strain,vfc_ms,fc_reposo,resp_rpm,temp_raw,spo2_est,sueno_min,necesidad_min,en_cama_min,score_sueno,"
        t += "profundo_min,rem_min,ligero_min,despierto_min,acostarse,levantarse,kcal,kcal_activas,estres_medio,fc_media,fc_max,pasos\n"
        let iso = ISO8601DateFormatter()
        for r in recs {
            let m = r.metrics
            func f(_ v: Double?) -> String { v.map { String(format: "%.2f", $0) } ?? "" }
            func d(_ v: Int?) -> String { v.map { iso.string(from: Date(timeIntervalSince1970: TimeInterval($0))) } ?? "" }
            t += [m.dayKey, f(m.recovery), f(m.strain), f(m.hrv), f(m.rhr), f(m.resp), f(m.skinTemp), f(m.spo2), f(m.sleptMin),
                  f(m.sleepNeedMin), f(m.inBedMin), f(m.sleepScore), f(m.deepMin), f(m.remMin), f(m.lightMin), f(m.awakeMin),
                  d(m.bedtime), d(m.wakeTime), f(m.kcal), f(m.activeKcal), f(m.avgStress), f(m.avgHR), f(m.maxHR), f(m.steps)]
                .joined(separator: ",") + "\n"
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pulso-dias.csv")
        try t.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    struct Backup: Codable {
        var exportedAt: Date
        var days: [DayReport]
        var workouts: [W]
        var body: [B]
        var plans: [TrainingPlan]
        struct W: Codable { var uid, source, sport, name: String; var start, end: Date; var strain, avgHR, maxHR, kcal, distanceKm: Double?; var strong: StrongWorkout? }
        struct B: Codable { var date: Date; var weightKg, bodyFatPct, waistCm, chestCm, hipsCm, neckCm, armCm, thighCm, calfCm: Double? }
    }

    static func jsonBackup(context: ModelContext) throws -> URL {
        let days = try context.fetch(FetchDescriptor<DailyRecord>(sortBy: [SortDescriptor(\.dayStart)])).compactMap(\.report)
        let ws = try context.fetch(FetchDescriptor<WorkoutRecord>(sortBy: [SortDescriptor(\.start)])).map {
            Backup.W(uid: $0.uid, source: $0.sourceRaw, sport: $0.sport, name: $0.name, start: $0.start, end: $0.end,
                     strain: $0.strain, avgHR: $0.avgHR, maxHR: $0.maxHR, kcal: $0.kcal, distanceKm: $0.distanceKm, strong: $0.strong)
        }
        let bs = try context.fetch(FetchDescriptor<BodyMeasurement>(sortBy: [SortDescriptor(\.date)])).map {
            Backup.B(date: $0.date, weightKg: $0.weightKg, bodyFatPct: $0.bodyFatPct, waistCm: $0.waistCm, chestCm: $0.chestCm,
                     hipsCm: $0.hipsCm, neckCm: $0.neckCm, armCm: $0.armCm, thighCm: $0.thighCm, calfCm: $0.calfCm)
        }
        let plans = try context.fetch(FetchDescriptor<PlanRecord>()).compactMap(\.plan)
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try enc.encode(Backup(exportedAt: Date(), days: days, workouts: ws, body: bs, plans: plans))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pulso-copia.json")
        try data.write(to: url)
        return url
    }
}
