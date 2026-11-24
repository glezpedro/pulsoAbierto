import XCTest
@testable import WhoopKit

final class TrainingTests: XCTestCase {

    let strongCSV = """
    Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
    2026-11-20 18:05:12,"Torso A",1h 5m,Bench Press (Barbell),W,40,10,0,0,,,
    2026-11-20 18:05:12,"Torso A",1h 5m,Bench Press (Barbell),1,80,8,0,0,,"Buen día",8
    2026-11-20 18:05:12,"Torso A",1h 5m,Bench Press (Barbell),2,80,7,0,0,"última dura",,9
    2026-11-20 18:05:12,"Torso A",1h 5m,Pull Up,1,0,10,0,0,,,
    2026-11-22 10:00:00,Pierna,50m,Squat (Barbell),1,100,5,0,0,,,
    2026-11-22 10:00:00,Pierna,50m,Squat (Barbell),2,105,5,0,0,,,
    """

    func testStrongParse() throws {
        let w = try StrongImporter.parse(strongCSV)
        XCTAssertEqual(w.count, 2)
        XCTAssertEqual(w[0].name, "Torso A")
        XCTAssertEqual(w[0].durationSeconds, 3900)
        XCTAssertEqual(w[0].sets.count, 4)
        XCTAssertTrue(w[0].sets[0].isWarmup)
        XCTAssertEqual(w[0].sets[1].rpe, 8)
        XCTAssertEqual(w[0].workingSets, 3)
        XCTAssertEqual(w[0].totalVolumeKg, 80 * 8 + 80 * 7)
        let orm = StrongImporter.oneRepMaxes(w, now: StrongImporter.parseDate("2026-11-24 10:00:00")!)
        XCTAssertEqual(orm["Squat (Barbell)"]!, 105 * (1 + 5.0 / 30), accuracy: 0.01)
        XCTAssertEqual(ExerciseLibrary.muscle(forStrongName: "Lateral Raise (Cable)"), .shoulders)
        XCTAssertEqual(ExerciseLibrary.muscle(forStrongName: "Lat Pulldown (Machine)"), .back)
    }

    func testStrongSemicolonAndPounds() throws {
        let csv = "Workout #;Date;Workout Name;Duration (sec);Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes\n" +
                  "1;2026-11-20 18:05:12;Push;3600;Bench Press (Barbell);1;185;lbs;5;;;;;;\n"
        let w = try StrongImporter.parse(csv)
        XCTAssertEqual(w.count, 1)
        XCTAssertEqual(w[0].sets[0].weightKg, 185 * 0.45359237, accuracy: 0.01)
    }

    func testPlanGeneratorAllGoals() {
        for goal in TrainingGoal.allCases {
            for days in 2...6 {
                for eq in Equipment.allCases {
                    let r = PlanRequest(goal: goal, daysPerWeek: days, sessionMinutes: 60, experience: .intermediate,
                                        equipment: eq, weeks: 8, cardio: .running)
                    let p = PlanGenerator.generate(r, oneRepMaxes: ["Bench Press (Barbell)": 100])
                    XCTAssertEqual(p.weeks.count, 8)
                    for w in p.weeks {
                        XCTAssertEqual(w.sessions.count, days, "\(goal) \(days) \(eq)")
                        for s in w.sessions where s.kind == .strength || s.kind == .mixed {
                            XCTAssertGreaterThanOrEqual(s.exercises.count, 3, "\(goal) \(days) \(eq) \(s.title)")
                        }
                    }
                    XCTAssertEqual(p.weeks[3].phase, "Descarga")
                }
            }
        }
        let p = PlanGenerator.generate(PlanRequest(goal: .strength, daysPerWeek: 4), oneRepMaxes: ["Bench Press (Barbell)": 100])
        let bench = p.weeks[0].sessions.flatMap(\.exercises).first { $0.exerciseKey == "bench_press" }
        XCTAssertNotNil(bench?.suggestedKg)
    }

    func testAdaptation() {
        let p = PlanGenerator.generate(PlanRequest(goal: .hypertrophy, daysPerWeek: 4))
        let s = p.weeks[0].sessions[0]
        let red = PlanGenerator.adapt(s, recovery: 20)
        XCTAssertEqual(red.band, .red)
        XCTAssertLessThan(red.session.exercises.map(\.sets).reduce(0, +), s.exercises.map(\.sets).reduce(0, +))
        let green = PlanGenerator.adapt(s, recovery: 90)
        XCTAssertEqual(green.session, s)
    }

    func testTCX() {
        let s = (0..<600).map { StrapSample(ts: 1_767_225_600 + $0, bpm: 120, rr: []) }
        let x = TCXExporter.make(start: s[0].date, end: s.last!.date, samples: s, calories: 300, notes: "Torso & brazos")
        XCTAssertTrue(x.contains("<Value>120</Value>"))
        XCTAssertTrue(x.contains("&amp;"))
    }
}
