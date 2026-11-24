import Foundation

/// Rule-based periodized plan generator (works offline; the AI coach can generate plans too).
public enum PlanGenerator {

    struct Slot { let patterns: [MovementPattern]; let muscle: MuscleGroup?; let compound: Bool }

    static func slot(_ p: MovementPattern..., muscle: MuscleGroup? = nil, compound: Bool = true) -> Slot {
        Slot(patterns: p, muscle: muscle, compound: compound)
    }

    struct DayTemplate { let title: String; let slots: [Slot] }

    static let fullBodyA = DayTemplate(title: "Cuerpo completo A", slots: [
        slot(.squat), slot(.horizontalPush), slot(.horizontalPull), slot(.hinge, muscle: .hamstrings),
        slot(.isolationUpper, muscle: .shoulders, compound: false), slot(.core, compound: false)])
    static let fullBodyB = DayTemplate(title: "Cuerpo completo B", slots: [
        slot(.hinge), slot(.verticalPush), slot(.verticalPull), slot(.lunge),
        slot(.isolationUpper, muscle: .biceps, compound: false), slot(.isolationUpper, muscle: .triceps, compound: false), slot(.core, compound: false)])
    static let fullBodyC = DayTemplate(title: "Cuerpo completo C", slots: [
        slot(.squat, muscle: .quads), slot(.horizontalPush), slot(.verticalPull), slot(.hinge, muscle: .glutes),
        slot(.isolationLower, muscle: .calves, compound: false), slot(.carry, .core, compound: false)])
    static let upperA = DayTemplate(title: "Tren superior A", slots: [
        slot(.horizontalPush), slot(.verticalPull), slot(.verticalPush), slot(.horizontalPull),
        slot(.isolationUpper, muscle: .biceps, compound: false), slot(.isolationUpper, muscle: .triceps, compound: false)])
    static let lowerA = DayTemplate(title: "Tren inferior A", slots: [
        slot(.squat), slot(.hinge, muscle: .hamstrings), slot(.lunge), slot(.isolationLower, muscle: .hamstrings, compound: false),
        slot(.isolationLower, muscle: .calves, compound: false), slot(.core, compound: false)])
    static let upperB = DayTemplate(title: "Tren superior B", slots: [
        slot(.verticalPush), slot(.horizontalPull), slot(.horizontalPush), slot(.verticalPull),
        slot(.isolationUpper, muscle: .shoulders, compound: false), slot(.isolationUpper, muscle: .biceps, compound: false)])
    static let lowerB = DayTemplate(title: "Tren inferior B", slots: [
        slot(.hinge), slot(.squat, muscle: .quads), slot(.hinge, muscle: .glutes), slot(.isolationLower, muscle: .quads, compound: false),
        slot(.isolationLower, muscle: .calves, compound: false), slot(.core, compound: false)])
    static let push = DayTemplate(title: "Empuje", slots: [
        slot(.horizontalPush), slot(.verticalPush), slot(.horizontalPush, muscle: .chest),
        slot(.isolationUpper, muscle: .shoulders, compound: false), slot(.isolationUpper, muscle: .triceps, compound: false), slot(.isolationUpper, muscle: .chest, compound: false)])
    static let pull = DayTemplate(title: "Tirón", slots: [
        slot(.verticalPull), slot(.horizontalPull), slot(.horizontalPull, muscle: .back),
        slot(.isolationUpper, muscle: .shoulders, compound: false), slot(.isolationUpper, muscle: .biceps, compound: false), slot(.core, compound: false)])
    static let legs = DayTemplate(title: "Pierna", slots: [
        slot(.squat), slot(.hinge), slot(.lunge), slot(.isolationLower, muscle: .hamstrings, compound: false),
        slot(.isolationLower, muscle: .quads, compound: false), slot(.isolationLower, muscle: .calves, compound: false)])

    /// Weekday layout (1 = lunes) for N training days.
    static func weekdays(_ n: Int) -> [Int] {
        switch n {
        case ...2: return [2, 5]
        case 3: return [1, 3, 5]
        case 4: return [1, 2, 4, 5]
        case 5: return [1, 2, 3, 5, 6]
        case 6: return [1, 2, 3, 4, 5, 6]
        default: return [1, 2, 3, 4, 5, 6, 7]
        }
    }

    struct Prescription { let compoundSets: Int; let compoundReps: String; let accSets: Int; let accReps: String; let rir: Int; let restCompound: Int; let restAcc: Int }

    static func prescription(_ r: PlanRequest) -> Prescription {
        var p: Prescription
        switch r.goal {
        case .strength: p = Prescription(compoundSets: 5, compoundReps: "3-5", accSets: 3, accReps: "6-8", rir: 2, restCompound: 180, restAcc: 120)
        case .hypertrophy: p = Prescription(compoundSets: 4, compoundReps: "6-10", accSets: 3, accReps: "10-15", rir: 2, restCompound: 120, restAcc: 75)
        case .fatLoss: p = Prescription(compoundSets: 3, compoundReps: "8-12", accSets: 3, accReps: "12-15", rir: 2, restCompound: 90, restAcc: 60)
        case .endurance: p = Prescription(compoundSets: 3, compoundReps: "8-10", accSets: 2, accReps: "12-15", rir: 3, restCompound: 90, restAcc: 60)
        case .hybrid: p = Prescription(compoundSets: 4, compoundReps: "5-8", accSets: 3, accReps: "8-12", rir: 2, restCompound: 150, restAcc: 90)
        case .health: p = Prescription(compoundSets: 3, compoundReps: "8-12", accSets: 2, accReps: "10-15", rir: 3, restCompound: 90, restAcc: 60)
        }
        let adj = r.experience == .beginner ? -1 : (r.experience == .advanced ? 1 : 0)
        return Prescription(compoundSets: max(2, p.compoundSets + adj), compoundReps: p.compoundReps,
                            accSets: max(2, p.accSets + (adj > 0 ? 1 : 0)), accReps: p.accReps,
                            rir: p.rir + (r.experience == .beginner ? 1 : 0), restCompound: p.restCompound, restAcc: p.restAcc)
    }

    /// - Parameter oneRepMaxes: e1RM per Strong exercise name, used to suggest loads.
    public static func generate(_ r: PlanRequest, startDate: Date = Date(), oneRepMaxes: [String: Double] = [:]) -> TrainingPlan {
        let days = weekdays(r.daysPerWeek)
        let strengthDays: Int
        let cardioDays: Int
        switch r.goal {
        case .endurance: strengthDays = min(2, days.count); cardioDays = days.count - strengthDays
        case .hybrid: strengthDays = max(2, days.count - 2); cardioDays = days.count - strengthDays
        case .fatLoss: strengthDays = max(2, days.count - 1); cardioDays = days.count - strengthDays
        default: strengthDays = days.count; cardioDays = 0
        }
        let templates: [DayTemplate]
        switch strengthDays {
        case ...1: templates = [fullBodyA]
        case 2: templates = [fullBodyA, fullBodyB]
        case 3: templates = [fullBodyA, fullBodyB, fullBodyC]
        case 4: templates = [upperA, lowerA, upperB, lowerB]
        case 5: templates = [upperA, lowerA, push, pull, legs]
        default: templates = [push, pull, legs, push, pull, legs]
        }
        let presc = prescription(r)
        let effectiveCardio: CardioPreference = r.cardio == .none && cardioDays > 0 ? .running : r.cardio

        var weeks: [PlanWeek] = []
        for w in 0..<max(1, r.weeks) {
            let blockWeek = w % 4
            let isDeload = blockWeek == 3 && r.weeks >= 4
            let phase: String
            let setsDelta: Int
            let rirDelta: Int
            switch blockWeek {
            case 0: phase = "Acumulación"; setsDelta = 0; rirDelta = 1
            case 1: phase = "Acumulación+"; setsDelta = 0; rirDelta = 0
            case 2: phase = "Intensificación"; setsDelta = 1; rirDelta = -1
            default: phase = isDeload ? "Descarga" : "Intensificación+"; setsDelta = isDeload ? -2 : 1; rirDelta = isDeload ? 2 : -1
            }
            var sessions: [PlannedSession] = []
            // interleave: strength days first then cardio days spread
            var dayKinds: [Bool] = Array(repeating: true, count: strengthDays) + Array(repeating: false, count: cardioDays)
            if cardioDays > 0 && strengthDays > 1 {
                // alternate where possible
                dayKinds = []
                var s = strengthDays, c = cardioDays
                while s + c > 0 {
                    if s > 0 { dayKinds.append(true); s -= 1 }
                    if c > 0 && (s == 0 || dayKinds.count % 2 == 1) { dayKinds.append(false); c -= 1 }
                }
            }
            var tIdx = 0, cIdx = 0
            for (i, wd) in days.enumerated() where i < dayKinds.count {
                if dayKinds[i] {
                    let t = templates[tIdx % templates.count]
                    tIdx += 1
                    var exercises = build(t, r: r, presc: presc, setsDelta: setsDelta, rirDelta: rirDelta, variant: tIdx / templates.count + w / 4, oneRepMaxes: oneRepMaxes)
                    let estimate = estimateMinutes(exercises)
                    // fit to session length
                    while estimateMinutes(exercises) > r.sessionMinutes + 5 && exercises.count > 3 { exercises.removeLast() }
                    var cardio: CardioBlock? = nil
                    if r.goal == .fatLoss || r.goal == .health, effectiveCardio != .none, estimate < r.sessionMinutes - 10 {
                        cardio = CardioBlock(minutes: min(20, r.sessionMinutes - estimateMinutes(exercises)), zone: 2,
                                             description: "Final en Z2 (\(effectiveCardio.spanish.lowercased()))")
                    }
                    sessions.append(PlannedSession(weekday: wd, title: t.title, kind: cardio == nil ? .strength : .mixed,
                                                   exercises: exercises, cardio: cardio,
                                                   estimatedMinutes: estimateMinutes(exercises) + (cardio?.minutes ?? 0),
                                                   targetStrain: isDeload ? 8 : (r.goal == .strength ? 11 : 12)))
                } else {
                    let c = cardioSession(index: cIdx, week: w, deload: isDeload, pref: effectiveCardio, minutes: r.sessionMinutes, goal: r.goal)
                    cIdx += 1
                    sessions.append(PlannedSession(weekday: wd, title: c.title, kind: .cardio, cardio: c.block,
                                                   estimatedMinutes: c.block.minutes, targetStrain: c.strain))
                }
            }
            weeks.append(PlanWeek(index: w, phase: phase, focus: focusText(phase: phase, goal: r.goal), sessions: sessions))
        }
        let summary = """
        Plan de \(r.weeks) semanas orientado a \(r.goal.spanish.lowercased()), \(r.daysPerWeek) días/semana \
        (\(strengthDays) de fuerza\(cardioDays > 0 ? ", \(cardioDays) de cardio" : "")). Bloques de 4 semanas con \
        progresión de volumen/intensidad y semana de descarga. Cada día la app ajusta la sesión a tu recuperación: \
        verde = según plan, amarillo = −20 % volumen, rojo = sesión regenerativa.
        """
        return TrainingPlan(name: "\(r.goal.spanish) · \(r.daysPerWeek) días", startDate: startDate, request: r,
                            weeks: weeks, summary: summary, source: "local")
    }

    static func focusText(phase: String, goal: TrainingGoal) -> String {
        switch phase {
        case "Descarga": return "Reduce volumen y carga: deja que el cuerpo asimile."
        case "Intensificación", "Intensificación+": return "Sube cargas manteniendo técnica; RIR bajo."
        default: return goal == .strength ? "Técnica y volumen en básicos." : "Volumen de calidad cerca del fallo."
        }
    }

    static func build(_ t: DayTemplate, r: PlanRequest, presc: Prescription, setsDelta: Int, rirDelta: Int,
                      variant: Int, oneRepMaxes: [String: Double]) -> [PlannedExercise] {
        var used = Set<String>()
        var out: [PlannedExercise] = []
        for slot in t.slots {
            let candidates = ExerciseLibrary.all.filter { e in
                slot.patterns.contains(e.pattern) && e.equipment.contains(r.equipment) && !used.contains(e.key) &&
                (slot.muscle == nil || e.primary == slot.muscle) && e.primary != .cardio
            }
            let pool = candidates.filter { $0.compound == slot.compound }.isEmpty ? candidates : candidates.filter { $0.compound == slot.compound }
            guard !pool.isEmpty else { continue }
            let e = pool[variant % pool.count]
            used.insert(e.key)
            let priority = r.priorityMuscles.contains(e.primary) ? 1 : 0
            let sets = max(1, (e.compound ? presc.compoundSets : presc.accSets) + setsDelta + priority)
            let reps = e.pattern == .core || e.pattern == .carry ? (e.key == "plank" ? "30-60 s" : "10-15") : (e.compound ? presc.compoundReps : presc.accReps)
            let rir = max(0, presc.rir + rirDelta)
            var kg: Double? = nil
            if let orm = oneRepMaxes[e.strongName] ?? oneRepMaxes.first(where: { ExerciseLibrary.match(strongName: $0.key)?.key == e.key })?.value,
               let topReps = Int(reps.split(separator: "-").last ?? "") {
                kg = suggestedLoad(oneRM: orm, reps: topReps, rir: rir)
            }
            out.append(PlannedExercise(exerciseKey: e.key, name: e.spanish, sets: sets, reps: reps, rir: rir,
                                       restSeconds: e.compound ? presc.restCompound : presc.restAcc, notes: e.cue, suggestedKg: kg))
        }
        return out
    }

    /// Load for a set of `reps` leaving `rir` in reserve: inverse Epley on (reps + rir).
    public static func suggestedLoad(oneRM: Double, reps: Int, rir: Int) -> Double {
        let pct = 1 / (1 + Double(reps + rir) / 30)
        return (oneRM * pct / 2.5).rounded() * 2.5
    }

    static func estimateMinutes(_ ex: [PlannedExercise]) -> Int {
        let work = ex.reduce(0.0) { $0 + Double($1.sets) * (45 + Double($1.restSeconds)) / 60 }
        return Int(work.rounded()) + 8 // warm-up
    }

    static func cardioSession(index: Int, week: Int, deload: Bool, pref: CardioPreference, minutes: Int, goal: TrainingGoal) -> (title: String, block: CardioBlock, strain: Double) {
        let mode = pref.spanish.lowercased()
        if deload { return ("Cardio suave", CardioBlock(minutes: min(40, minutes), zone: 2, description: "Z2 relajado (\(mode))."), 7) }
        switch index % 3 {
        case 0:
            let m = min(90, minutes + week * 5)
            return ("Fondo aeróbico Z2", CardioBlock(minutes: m, zone: 2, description: "\(m) min de \(mode) a ritmo conversacional (60–70 % FCmáx)."), 10)
        case 1:
            return ("Intervalos 4×4", CardioBlock(minutes: 40, zone: 4, description: "Calienta 10 min, 4×4 min en Z4–Z5 con 3 min suaves, enfría 5 min (\(mode))."), 13)
        default:
            return ("Tempo", CardioBlock(minutes: 45, zone: 3, description: "15 min Z2 + 20 min Z3 sostenido + 10 min suave (\(mode))."), 11.5)
        }
    }

    // MARK: Daily adaptation

    public struct Adapted { public let session: PlannedSession; public let note: String; public let band: RecoveryBand? }

    /// Adjusts today's session to recovery (green: as planned · yellow: −20 % volume · red: regenerative).
    public static func adapt(_ s: PlannedSession, recovery: Double?) -> Adapted {
        guard let rec = recovery else { return Adapted(session: s, note: "Sin dato de recuperación: entrena según sensaciones.", band: nil) }
        var out = s
        let band = RecoveryBand(rec)
        switch band {
        case .green:
            let note = rec >= 85 ? "Recuperación excelente (\(Int(rec)) %): puedes buscar una serie top o un PR." :
                "Recuperación verde (\(Int(rec)) %): entrena según el plan."
            return Adapted(session: s, note: note, band: band)
        case .yellow:
            out.exercises = s.exercises.map { e in
                var e = e
                if e.sets > 2 { e.sets = max(2, Int((Double(e.sets) * 0.8).rounded())) }
                e.rir += 1
                return e
            }
            if var c = out.cardio, c.zone >= 4 { c.zone = 3; c.description = "Ajustado por recuperación amarilla: tempo en vez de intervalos. " + c.description; out.cardio = c }
            out.targetStrain = max(6, s.targetStrain - 2)
            return Adapted(session: out, note: "Recuperación amarilla (\(Int(rec)) %): −20 % volumen y +1 RIR.", band: band)
        case .red:
            out.exercises = s.exercises.prefix(4).map { e in
                var e = e
                e.sets = max(1, Int((Double(e.sets) * 0.5).rounded()))
                e.rir += 3
                return e
            }
            out.cardio = CardioBlock(minutes: 30, zone: 1, description: "Paseo o bici muy suave + 10 min de movilidad.")
            if s.kind == .cardio { out.exercises = [] }
            out.title = s.title + " (regenerativa)"
            out.targetStrain = 5
            return Adapted(session: out, note: "Recuperación roja (\(Int(rec)) %): sesión regenerativa. Prioriza dormir y comer bien.", band: band)
        }
    }
}
