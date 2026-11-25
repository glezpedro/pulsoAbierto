import Foundation
import WhoopKit

// pulso-engine: JSON-in / JSON-out CLI used by the self-hosted Pulso server.
// Usage: pulso-engine <command>   (request JSON on stdin, response JSON on stdout)

let enc: JSONEncoder = {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .secondsSince1970
    e.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
    return e
}()
let dec: JSONDecoder = {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .secondsSince1970
    return d
}()

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data(("error: " + msg + "\n").utf8))
    exit(1)
}

func out<T: Encodable>(_ v: T) {
    do { FileHandle.standardOutput.write(try enc.encode(v)) } catch { fail("encode: \(error)") }
}

func input<T: Decodable>(_ t: T.Type) -> T {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    do { return try dec.decode(t, from: data) } catch { fail("decode \(T.self): \(error)") }
}

// MARK: - Requests

struct AnalyzeReq: Decodable {
    let dataDir: String
    let dayKey: String
    let dayStart: Int
    let dayEnd: Int
    let now: Int
    let profile: PhysioProfile
    let history: [DayMetrics]
}

struct PlanReq: Decodable {
    let request: PlanRequest
    let startDate: Date
    let oneRepMaxes: [String: Double]
}

struct AdaptReq: Decodable {
    let session: PlannedSession
    let recovery: Double?
}

struct AdaptRes: Encodable {
    let session: PlannedSession
    let note: String
    let band: String?
}

struct StrongReq: Decodable {
    let csv: String
    let unit: WeightUnit
}

struct StrongStatsReq: Decodable {
    let workouts: [StrongWorkout]
    let now: Date
}

struct ProgressPoint: Encodable { let date: Date; let e1RM: Double; let topWeight: Double; let volume: Double }
struct ProgressOut: Encodable { let exercise: String; let points: [ProgressPoint]; let best: Double; let muscle: String }
struct PROut: Encodable { let exercise: String; let e1RM: Double; let weight: Double; let reps: Int; let date: Date }
struct StrongStatsRes: Encodable {
    let progress: [ProgressOut]
    let records: [PROut]
    let weeklySets: [String: Int]
    let oneRepMaxes: [String: Double]
}

struct DemoReq: Decodable {
    let dataDir: String
    let days: Int
    let todayStart: Int
    let now: Int
}

struct RangeReq: Decodable {
    let dataDir: String
    let from: Int
    let to: Int
}

struct StrainReq: Decodable {
    let dataDir: String
    let from: Int
    let to: Int
    let profile: PhysioProfile
    let restingHR: Double
}

struct TCXReq: Decodable {
    let dataDir: String
    let from: Int
    let to: Int
    let sport: String
    let calories: Double
    let notes: String
}

struct SeriesReq: Decodable {
    let dataDir: String
    let from: Int
    let to: Int
    let step: Int            // seconds per bucket (≥ 60)
}

struct SeriesPoint: Encodable {
    let t: Int
    let hr: Double?
    let lo: Double?
    let hi: Double?
    let motion: Double?
    let temp: Double?
    let contact: Double
    let rmssd: Double?
    let resp: Double?
}

struct HRVReq: Decodable { let rr: [Double] }

struct SessionsReq: Decodable {
    let dataDir: String
    let from: Int
    let to: Int
}

// MARK: - Commands

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: pulso-engine analyze|plan|adapt|strong|strong-stats|demo|strain|tcx|series|hrv|stats|version") }

switch args[1] {
case "version":
    out(["engine": "pulso-engine", "version": "1.0.0"])

case "analyze":
    let r = input(AnalyzeReq.self)
    let dir = URL(fileURLWithPath: r.dataDir)
    let samples = SampleFiles.read(dir: dir, from: r.dayStart - 8 * 3600, to: r.dayEnd)
    let report = DayAnalyzer.analyze(samples: samples, dayKey: r.dayKey, dayStart: r.dayStart, dayEnd: r.dayEnd,
                                     profile: r.profile, history: r.history, now: r.now)
    out(["samples": AnyEncodable(samples.count), "report": AnyEncodable(report)])

case "plan":
    let r = input(PlanReq.self)
    out(PlanGenerator.generate(r.request, startDate: r.startDate, oneRepMaxes: r.oneRepMaxes))

case "adapt":
    let r = input(AdaptReq.self)
    let a = PlanGenerator.adapt(r.session, recovery: r.recovery)
    out(AdaptRes(session: a.session, note: a.note, band: a.band?.rawValue))

case "strong":
    let r = input(StrongReq.self)
    do { out(try StrongImporter.parse(r.csv, unit: r.unit)) } catch { fail(error.localizedDescription) }

case "strong-stats":
    let r = input(StrongStatsReq.self)
    let prog = StrongImporter.progress(r.workouts).map { p in
        ProgressOut(exercise: p.exercise,
                    points: p.points.map { ProgressPoint(date: $0.date, e1RM: $0.e1RM, topWeight: $0.topWeight, volume: $0.volume) },
                    best: p.bestE1RM, muscle: ExerciseLibrary.muscle(forStrongName: p.exercise).rawValue)
    }
    let prs = StrongImporter.personalRecords(r.workouts).map { PROut(exercise: $0.exercise, e1RM: $0.e1RM, weight: $0.weight, reps: $0.reps, date: $0.date) }
    var weekly: [String: Int] = [:]
    for (k, v) in StrongImporter.weeklySetsPerMuscle(r.workouts, now: r.now) { weekly[k.rawValue] = v }
    out(StrongStatsRes(progress: prog, records: prs, weeklySets: weekly, oneRepMaxes: StrongImporter.oneRepMaxes(r.workouts, now: r.now)))

case "demo":
    let r = input(DemoReq.self)
    let dir = URL(fileURLWithPath: r.dataDir)
    var gen = SyntheticGenerator(seed: UInt64(r.todayStart))
    var written = 0
    for i in stride(from: r.days, through: 0, by: -1) {
        let ds = r.todayStart - i * 86400
        var g = SyntheticGenerator(seed: UInt64(ds))
        let workout = i % 7 != 3 && i % 7 != 6
        let plan = SyntheticGenerator.DayPlan(
            bedtime: ds - 90 * 60 + Int(gen.normal() * 1200), wake: ds + 7 * 3600 + 600 + Int(gen.normal() * 900),
            restingHR: 52 + gen.normal() * 1.5 + (i % 7 == 0 ? 3 : 0),
            rmssd: 62 + gen.normal() * 9 - (i % 7 == 0 ? 12 : 0),
            workout: workout ? (ds + 16 * 3600 + Int(gen.unit() * 1800), 45 + Int(gen.unit() * 35), 0.55 + gen.unit() * 0.25) : nil)
        let from = ds - 6 * 3600, to = min(ds + 18 * 3600, r.now)
        guard to > from else { continue }
        let s = g.samples(from: from, to: to, plan: plan)
        do { try SampleFiles.append(dir: dir, samples: s) } catch { fail("write: \(error)") }
        written += s.count
    }
    out(["written": written])

case "strain":
    let r = input(StrainReq.self)
    let s = SampleFiles.read(dir: URL(fileURLWithPath: r.dataDir), from: r.from, to: r.to)
    out(Strain.compute(s, profile: r.profile, restingHR: r.restingHR))

case "tcx":
    let r = input(TCXReq.self)
    let s = SampleFiles.read(dir: URL(fileURLWithPath: r.dataDir), from: r.from, to: r.to)
    let x = TCXExporter.make(start: Date(timeIntervalSince1970: TimeInterval(r.from)), end: Date(timeIntervalSince1970: TimeInterval(r.to)),
                             sport: r.sport, samples: s, calories: r.calories, notes: r.notes)
    out(["tcx": x, "hrSamples": String(s.filter { $0.bpm > 0 }.count)])

case "series":
    let r = input(SeriesReq.self)
    let s = SampleFiles.read(dir: URL(fileURLWithPath: r.dataDir), from: r.from, to: r.to)
    let epochs = Epochs.build(s)
    let step = max(60, r.step)
    let groups = Dictionary(grouping: epochs) { $0.ts / step }
    let pts: [SeriesPoint] = groups.keys.sorted().compactMap { k in
        guard let g = groups[k] else { return nil }
        let hrs = g.compactMap { $0.hasData ? $0.hr : nil }
        let rr = g.flatMap(\.rr)
        // breathing rate needs ≥ 5 consecutive minutes of R-R: only for coarse steps
        let resp = step >= 300 ? Respiratory.rate(epochs: g.sorted { $0.ts < $1.ts }) : nil
        return SeriesPoint(t: k * step, hr: Stats.mean(hrs), lo: g.compactMap(\.hrMin).min(), hi: g.compactMap(\.hrMax).max(),
                           motion: Stats.mean(g.compactMap(\.motion)), temp: Stats.mean(g.compactMap(\.skinTemp)),
                           contact: Stats.mean(g.map(\.contact)) ?? 0, rmssd: HRV.compute(rr)?.rmssd, resp: resp)
    }
    out(pts)

case "hrv":
    let r = input(HRVReq.self)
    if let h = HRV.compute(r.rr) {
        out(["rmssd": h.rmssd, "sdnn": h.sdnn, "pnn50": h.pnn50, "meanRR": h.meanRR, "lnRMSSD": h.lnRMSSD,
             "hr": 60000 / max(h.meanRR, 1), "beats": Double(h.beats), "artifactRate": h.artifactRate,
             "resp": Respiratory.rate(rr: r.rr) ?? -1])
    } else { out(["error": "pocos latidos válidos"]) }

case "stats":
    let r = input(RangeReq.self)
    let dir = URL(fileURLWithPath: r.dataDir)
    let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).compactMap { Int($0.replacingOccurrences(of: ".bin", with: "")) }.sorted()
    var bytes = 0
    for d in files { bytes += (try? FileManager.default.attributesOfItem(atPath: SampleFiles.url(dir, day: d).path)[.size] as? Int) ?? 0 }
    let first = files.first.map { SampleFiles.read(dir: dir, from: $0 * 86400, to: ($0 + 1) * 86400).first?.ts ?? 0 } ?? 0
    let last = files.last.map { SampleFiles.read(dir: dir, from: $0 * 86400, to: ($0 + 1) * 86400).last?.ts ?? 0 } ?? 0
    out(["days": files.count, "bytes": bytes, "first": first, "last": last])

default:
    fail("comando desconocido \(args[1])")
}

struct AnyEncodable: Encodable {
    let f: (Encoder) throws -> Void
    init<T: Encodable>(_ v: T) { f = v.encode }
    func encode(to e: Encoder) throws { try f(e) }
}
