import XCTest
@testable import WhoopKit

final class AnalyticsTests: XCTestCase {

    let day0 = 1_767_225_600 // 2026-01-01 00:00 UTC

    func makeDay(_ gen: inout SyntheticGenerator, dayStart: Int, rhr: Double = 52, rmssd: Double = 70,
                 workout: Bool = true) -> [StrapSample] {
        let plan = SyntheticGenerator.DayPlan(bedtime: dayStart - 2 * 3600 + 1800, wake: dayStart + 7 * 3600,
                                              restingHR: rhr, rmssd: rmssd,
                                              workout: workout ? (dayStart + 18 * 3600, 60, 0.72) : nil)
        return gen.samples(from: dayStart - 6 * 3600, to: dayStart + 20 * 3600, plan: plan)
    }

    func testHRVOnCleanSeries() {
        let rr = (0..<300).map { i in 1000 + 40 * sin(Double(i) * 0.9) }
        let r = HRV.compute(rr)!
        XCTAssertEqual(r.rmssd, 24.6, accuracy: 0.5)
        XCTAssertLessThan(r.artifactRate, 0.01)
        // ectopic beat removal
        var bad = rr; bad[100] = 400; bad[200] = 1900
        XCTAssertGreaterThan(HRV.compute(bad)!.artifactRate, 0)
    }

    func testRespiratoryRateFromRSA() {
        // 15 breaths/min modulation (0.25 Hz)
        var rr: [Double] = []
        var t = 0.0
        while t < 300 {
            let v = 1000 + 50 * sin(2 * .pi * 0.25 * t)
            rr.append(v); t += v / 1000
        }
        let r = Respiratory.rate(rr: rr)!
        XCTAssertEqual(r, 15, accuracy: 0.8)
    }

    func testSleepDetectionAndStaging() {
        var gen = SyntheticGenerator(seed: 7)
        let samples = makeDay(&gen, dayStart: day0)
        let epochs = Epochs.build(samples)
        let sessions = SleepAnalyzer.detect(epochs)
        let main = sessions.first { !$0.isNap }
        XCTAssertNotNil(main)
        guard let s = main else { return }
        let trueBed = day0 - 2 * 3600 + 1800, trueWake = day0 + 7 * 3600
        XCTAssertLessThan(abs(s.start - trueBed), 45 * 60, "onset error")
        XCTAssertLessThan(abs(s.end - trueWake), 45 * 60, "wake error")
        XCTAssertGreaterThan(s.minutes(.deep), 20)
        XCTAssertGreaterThan(s.minutes(.rem), 20)
        XCTAssertNotNil(s.restingHR)
        XCTAssertNotNil(s.hrvRMSSD)
        if let rr = s.respiratoryRate { XCTAssertEqual(rr, 14.4, accuracy: 2.5) }
        print("sleep", s.minutesAsleep, "deep", s.minutes(.deep), "rem", s.minutes(.rem), "light", s.minutes(.light),
              "awake", s.minutes(.awake), "rhr", s.restingHR ?? -1, "hrv", s.hrvRMSSD ?? -1, "resp", s.respiratoryRate ?? -1,
              "spo2", s.spo2Estimate ?? -1)
    }

    func testStrainScale() {
        let p = PhysioProfile(sex: .male, age: 30, weightKg: 75, heightCm: 178)
        // 60 minutes at 72 % HRR
        let rhr = 52.0
        let hr = rhr + 0.72 * (p.hrMax - rhr)
        let s = (0..<3600).map { StrapSample(ts: $0, bpm: UInt8(hr), rr: []) }
        let r = Strain.compute(s, profile: p, restingHR: rhr)
        XCTAssertGreaterThan(r.strain, 12)
        XCTAssertLessThan(r.strain, 18)
        XCTAssertGreaterThan(r.activeKcal, 400)
        XCTAssertLessThan(r.activeKcal, 1100)
        XCTAssertEqual(Strain.strain(fromLoad: Strain.load(fromStrain: 13.3)), 13.3, accuracy: 1e-6)
    }

    func testDayAnalyzerEndToEnd() {
        var gen = SyntheticGenerator(seed: 3)
        let p = PhysioProfile()
        var history: [DayMetrics] = []
        var last: DayReport?
        var totalActs = 0
        for d in 0..<8 {
            let ds = day0 + d * 86400
            let samples = makeDay(&gen, dayStart: ds, rhr: 52 + gen.normal(), rmssd: 70 + 6 * gen.normal(), workout: d % 2 == 0)
            let rep = DayAnalyzer.analyze(samples: samples, dayKey: "d\(d)", dayStart: ds, dayEnd: ds + 86400,
                                          profile: p, history: history, now: ds + 86400)
            history.insert(rep.metrics, at: 0)
            totalActs += rep.activities.count
            if d % 2 == 0 { XCTAssertGreaterThan(rep.metrics.strain ?? 0, 10, "workout day strain") }
            else { XCTAssertLessThan(rep.metrics.strain ?? 99, 8, "rest day strain") }
            last = rep
        }
        let r = last!
        XCTAssertNotNil(r.recovery)
        XCTAssertFalse(r.recovery!.calibrating)
        XCTAssertNotNil(r.metrics.strain)
        XCTAssertNotNil(r.sleepScore)
        XCTAssertGreaterThanOrEqual(totalActs, 4)
        XCTAssertFalse(r.hrTimeline.isEmpty)
        // JSON round trip
        let data = try! JSONEncoder().encode(r)
        let back = try! JSONDecoder().decode(DayReport.self, from: data)
        XCTAssertEqual(back.metrics, r.metrics)
        print("recovery", r.recovery!.score, "strain", r.metrics.strain!, "sleepScore", r.sleepScore!.score,
              "kcal", r.metrics.kcal ?? 0, "acts", r.activities.count, "stress", r.metrics.avgStress ?? -1,
              "target", r.strainTarget!)
    }

    /// Going to bed before midnight: the window ends at midnight, so tonight's sleep appears truncated.
    /// It must not be counted as a nap of today (it used to inflate naps and lower the sleep need).
    func testEveningSleepIsNotANap() {
        var gen = SyntheticGenerator(seed: 11)
        let ds = day0
        let last = SyntheticGenerator.DayPlan(bedtime: ds - 2 * 3600, wake: ds + 7 * 3600, restingHR: 52, rmssd: 70, workout: nil)
        let tonight = SyntheticGenerator.DayPlan(bedtime: ds + 22 * 3600 + 1800, wake: ds + 31 * 3600, restingHR: 52, rmssd: 70, workout: nil)
        let samples = gen.samples(from: ds - 6 * 3600, to: ds + 15 * 3600, plan: last)
            + gen.samples(from: ds + 15 * 3600, to: ds + 86400, plan: tonight)
        let rep = DayAnalyzer.analyze(samples: samples, dayKey: "d", dayStart: ds, dayEnd: ds + 86400,
                                      profile: PhysioProfile(), history: [], now: ds + 86400)
        XCTAssertNotNil(rep.sleep)
        XCTAssertTrue(rep.naps.isEmpty, "naps: \(rep.naps.map { ($0.start - ds) / 60 })")
        XCTAssertEqual(rep.metrics.napMin ?? 0, 0)
        XCTAssertNotNil(rep.metrics.efficiency)
        XCTAssertNotNil(rep.metrics.wakeups)
    }

    /// An evening nap (20:00–21:00) counts, as long as it finished before the window edge.
    func testEveningNapCounts() {
        var gen = SyntheticGenerator(seed: 12)
        let ds = day0
        let night = SyntheticGenerator.DayPlan(bedtime: ds - 2 * 3600, wake: ds + 7 * 3600, restingHR: 52, rmssd: 70, workout: nil)
        let nap = SyntheticGenerator.DayPlan(bedtime: ds + 20 * 3600, wake: ds + 21 * 3600, restingHR: 52, rmssd: 70, workout: nil)
        let samples = gen.samples(from: ds - 6 * 3600, to: ds + 15 * 3600, plan: night)
            + gen.samples(from: ds + 15 * 3600, to: ds + 23 * 3600, plan: nap)
        let rep = DayAnalyzer.analyze(samples: samples, dayKey: "d", dayStart: ds, dayEnd: ds + 86400,
                                      profile: PhysioProfile(), history: [], now: ds + 23 * 3600)
        XCTAssertEqual(rep.naps.count, 1, "naps: \(rep.naps.map { ($0.start - ds) / 60 })")
        XCTAssertGreaterThan(rep.metrics.napMin ?? 0, 30)
    }

    func testTrainingLoad() {
        let s = TrainingLoad.summarize(dailyStrain: Array(repeating: 10, count: 21) + Array(repeating: 17, count: 7))
        XCTAssertNotNil(s.acwr)
        XCTAssertGreaterThan(s.acwr!, 1.2)
    }

    func testConsistency() {
        let beds = [0, 86400 + 600, 2 * 86400 - 600, 3 * 86400].map { $0 + 23 * 3600 }
        let c = SleepCoach.consistency(bedtimes: beds, wakeTimes: beds.map { $0 + 8 * 3600 })
        XCTAssertGreaterThan(c, 85)
    }
}
