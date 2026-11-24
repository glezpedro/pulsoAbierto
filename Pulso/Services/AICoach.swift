import Foundation
import SwiftData
import WhoopKit

/// Builds the data context for the AI coach and implements the AI features
/// (chat, daily analysis, plan generation).
@MainActor
final class AICoach {
    let context: ModelContext
    init(context: ModelContext) { self.context = context }

    static let persona = """
    Eres "Pulso", el entrenador personal y analista de salud del usuario, dentro de una app de iPhone que lee \
    los datos de su pulsera WHOOP 4.0 sin suscripción. Hablas en español de España, cercano y directo. \
    Basas cada consejo en sus datos reales (que recibes en el contexto) y explicas el porqué en pocas frases. \
    Usa las métricas como lo haría un entrenador experto: recuperación (0–100 %, verde ≥67, amarillo 34–66, rojo <34), \
    esfuerzo/strain (0–21, escala logarítmica de carga cardiovascular), VFC (RMSSD nocturna en ms; compárala con su \
    línea base, no con otras personas), FC en reposo, frecuencia respiratoria, sueño (necesidad vs. dormido, fases, \
    eficiencia, consistencia), estrés (0–3), carga aguda:crónica (ACWR óptimo 0,8–1,3) y sus entrenos de Strong/Strava. \
    Las fases de sueño, la SpO2 y la temperatura son estimaciones de algoritmos propios: menciónalo si el usuario \
    les da demasiado peso. No eres médico: ante síntomas preocupantes recomienda consultar a un profesional. \
    Formato: respuestas breves con viñetas cuando ayuden; usa negritas para los números clave; nada de tablas largas.
    """

    // MARK: Context

    func dataContext(days: Int = 21) -> String {
        let s = AppSettings.shared
        let p = s.profile
        var out = "## Perfil\n"
        out += "- \(p.name.isEmpty ? "Usuario" : p.name), \(p.age) años, \(p.sex.spanish), \(Int(p.heightCm)) cm, \(String(format: "%.1f", p.weightKg)) kg, "
        out += "FC máx \(Int(p.physio.hrMax)) lpm, necesidad base de sueño \(String(format: "%.1f", p.sleepNeedHours)) h, "
        out += "despertar deseado \(String(format: "%02d:%02d", p.wakeMinutes / 60, p.wakeMinutes % 60)).\n"
        if !p.goalText.isEmpty { out += "- Objetivo declarado: \(p.goalText)\n" }

        // Body measurements
        var bfd = FetchDescriptor<BodyMeasurement>(sortBy: [SortDescriptor(\.date, order: .reverse)])
        bfd.fetchLimit = 5
        let body = (try? context.fetch(bfd)) ?? []
        if !body.isEmpty {
            out += "\n## Medidas corporales (recientes)\n"
            for m in body {
                var parts: [String] = []
                if let w = m.weightKg { parts.append("peso \(String(format: "%.1f", w)) kg") }
                if let bf = m.bodyFatPct { parts.append("grasa \(String(format: "%.1f", bf)) %") }
                if let v = m.waistCm { parts.append("cintura \(Int(v)) cm") }
                if let v = m.chestCm { parts.append("pecho \(Int(v)) cm") }
                if let v = m.armCm { parts.append("brazo \(Int(v)) cm") }
                if let v = m.thighCm { parts.append("muslo \(Int(v)) cm") }
                out += "- \(m.date.formatted(date: .abbreviated, time: .omitted)): \(parts.joined(separator: ", "))\n"
            }
        }

        // Daily metrics
        var dfd = FetchDescriptor<DailyRecord>(sortBy: [SortDescriptor(\.dayStart, order: .reverse)])
        dfd.fetchLimit = days
        let recs = (try? context.fetch(dfd)) ?? []
        if !recs.isEmpty {
            out += "\n## Últimos \(recs.count) días (más reciente primero)\n"
            out += "fecha | recup % | strain | VFC ms | FCrep | resp | sueño h (necesidad) | score sueño | profundo/REM min | estrés | kcal | pasos\n"
            for r in recs {
                let m = r.metrics
                func f(_ v: Double?, _ d: Int = 0) -> String { v.map { String(format: "%.\(d)f", $0) } ?? "–" }
                out += "\(m.dayKey) | \(f(m.recovery)) | \(f(m.strain, 1)) | \(f(m.hrv)) | \(f(m.rhr)) | \(f(m.resp, 1)) | "
                out += "\(f(m.sleptMin.map { $0 / 60 }, 1)) (\(f(m.sleepNeedMin.map { $0 / 60 }, 1))) | \(f(m.sleepScore)) | "
                out += "\(f(m.deepMin))/\(f(m.remMin)) | \(f(m.avgStress, 1)) | \(f(m.kcal)) | \(f(m.steps))\n"
            }
            let strains = recs.reversed().map { $0.metrics.strain ?? 0 }
            let load = TrainingLoad.summarize(dailyStrain: strains)
            out += "\nCarga: aguda \(String(format: "%.0f", load.acute)), crónica \(String(format: "%.0f", load.chronic)), "
            out += "ACWR \(load.acwr.map { String(format: "%.2f", $0) } ?? "–"), monotonía \(load.monotony.map { String(format: "%.2f", $0) } ?? "–") → \(load.status)\n"
            if let today = recs.first?.report {
                if let t = today.strainTarget { out += "Strain objetivo hoy: \(String(format: "%.0f–%.0f", t.lowerBound, t.upperBound))\n" }
                if let n = today.nextNightNeed { out += "Necesidad de sueño para esta noche: \(String(format: "%.1f", n.totalMin / 60)) h\n" }
            }
        }

        // Workouts
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let wfd = FetchDescriptor<WorkoutRecord>(predicate: #Predicate { $0.start > since }, sortBy: [SortDescriptor(\.start, order: .reverse)])
        let workouts = (try? context.fetch(wfd)) ?? []
        if !workouts.isEmpty {
            out += "\n## Entrenamientos recientes\n"
            for w in workouts.prefix(25) {
                out += "- \(w.start.formatted(date: .abbreviated, time: .shortened)) · \(w.name) (\(w.source.spanish)), \(Int(w.durationMin)) min"
                if let s = w.strain { out += ", strain \(String(format: "%.1f", s))" }
                if let hr = w.avgHR { out += ", FC media \(Int(hr))" }
                if let d = w.distanceKm, d > 0 { out += ", \(String(format: "%.1f", d)) km" }
                if let st = w.strong {
                    let ex = Dictionary(grouping: st.sets.filter { !$0.isWarmup }, by: \.exercise)
                        .map { k, v in "\(k): " + v.map { "\(Self.fmt($0.weightKg))×\($0.reps)" }.joined(separator: ", ") }
                    out += "\n  " + ex.joined(separator: "\n  ")
                }
                out += "\n"
            }
        }

        // Strength records
        let strong = workouts.compactMap(\.strong)
        if !strong.isEmpty {
            let prs = StrongImporter.personalRecords(strong).prefix(10)
            out += "\n## 1RM estimados (Epley)\n" + prs.map { "- \($0.exercise): \(Int($0.e1RM)) kg" }.joined(separator: "\n") + "\n"
        }

        // Active plan
        var pfd = FetchDescriptor<PlanRecord>(predicate: #Predicate { $0.isActive })
        pfd.fetchLimit = 1
        if let plan = (try? context.fetch(pfd))?.first?.plan {
            out += "\n## Plan activo: \(plan.name)\n\(plan.summary)\n"
            if let today = plan.session(on: Date()) {
                out += "Sesión de hoy (semana \(today.week.index + 1), \(today.week.phase)): \(today.session.title) – "
                out += today.session.exercises.map { "\($0.name) \($0.sets)×\($0.reps) RIR\($0.rir)" }.joined(separator: "; ")
                if let c = today.session.cardio { out += " + \(c.description)" }
                out += "\n"
            }
        }

        // Journal
        var jfd = FetchDescriptor<JournalEntry>(sortBy: [SortDescriptor(\.dayKey, order: .reverse)])
        jfd.fetchLimit = 7
        let journal = (try? context.fetch(jfd)) ?? []
        if !journal.isEmpty {
            out += "\n## Diario (hábitos)\n"
            for j in journal {
                let yes = j.answers.filter { $0.value > 0 }.compactMap { k, _ in JournalQuestion.all.first { $0.key == k }?.short }
                out += "- \(j.dayKey): \(yes.isEmpty ? "nada marcado" : yes.joined(separator: ", "))\(j.notes.isEmpty ? "" : " · \(j.notes)")\n"
            }
        }
        out += "\nFecha y hora actual: \(Date().formatted(date: .complete, time: .shortened))\n"
        return out
    }

    static func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }

    // MARK: Features

    func dailyAnalysis(for record: DailyRecord) async throws -> String {
        let prompt = """
        Analiza mi día \(record.dayKey) con mis datos. Estructura:
        1. **Resumen** en 2 frases (recuperación, sueño y qué significa para hoy).
        2. **Qué ha influido** (VFC/FC reposo vs. mi línea base, sueño, carga, hábitos del diario).
        3. **Recomendación de hoy**: strain objetivo, tipo de entreno (ajusta la sesión del plan si la hay) y hora de acostarme.
        4. Un **micro-hábito** concreto para mejorar mañana.
        Máximo 180 palabras.
        """
        let sys = Self.persona + "\n\n# Datos del usuario\n" + dataContext(days: 21)
        return try await ClaudeService.shared.complete(system: sys, prompt: prompt, maxTokens: 4000, effort: "low")
    }

    func chatSystemPrompt() -> String {
        Self.persona + "\n\n# Datos del usuario\n" + dataContext(days: 30)
    }

    func generatePlan(request r: PlanRequest, extra: String) async throws -> TrainingPlan {
        let sys = Self.persona + "\n\n# Datos del usuario\n" + dataContext(days: 30)
        let keys = ExerciseLibrary.all.map { "\($0.key)=\($0.spanish)" }.joined(separator: ", ")
        let prompt = """
        Diseña un plan de entrenamiento periodizado personalizado con estos parámetros:
        - Objetivo: \(r.goal.spanish); días/semana: \(r.daysPerWeek); duración por sesión: \(r.sessionMinutes) min
        - Nivel: \(r.experience.spanish); material: \(r.equipment.spanish); semanas: \(r.weeks); cardio preferido: \(r.cardio.spanish)
        - Músculos prioritarios: \(r.priorityMuscles.map(\.spanish).joined(separator: ", ").ifEmpty("ninguno"))
        - Indicaciones extra: \(extra.ifEmpty("ninguna"))
        Usa mis 1RM y entrenos de Strong para elegir cargas (indícalas en notes como "~X kg"), respeta mi recuperación \
        media y carga reciente, incluye semanas de descarga y progresión clara. weekday: 1=lunes…7=domingo, exactamente \
        \(r.daysPerWeek) sesiones por semana y \(r.weeks) semanas. kind ∈ strength|cardio|mixed|mobility. \
        Para cardio.minutes usa 0 si la sesión no lleva cardio. exerciseKey: usa una de estas claves si encaja, si no "": \(keys)
        """
        let data = try await ClaudeService.shared.json(system: sys, prompt: prompt, schema: Self.planSchema, maxTokens: 64000, effort: "medium")
        let dto = try JSONDecoder().decode(PlanDTO.self, from: data)
        let weeks = dto.weeks.enumerated().map { i, w in
            PlanWeek(index: i, phase: w.phase, focus: w.focus, sessions: w.sessions.map { s in
                PlannedSession(weekday: min(7, max(1, s.weekday)), title: s.title,
                               kind: SessionKind(rawValue: s.kind) ?? .strength,
                               exercises: s.exercises.map {
                                   PlannedExercise(exerciseKey: $0.exerciseKey, name: $0.name, sets: $0.sets, reps: $0.reps,
                                                   rir: $0.rir, restSeconds: $0.restSeconds, notes: $0.notes)
                               },
                               cardio: s.cardio.minutes > 0 ? CardioBlock(minutes: s.cardio.minutes, zone: s.cardio.zone, description: s.cardio.description) : nil,
                               estimatedMinutes: r.sessionMinutes, targetStrain: s.targetStrain)
            })
        }
        let start = Calendar.current.nextDate(after: Date(), matching: DateComponents(weekday: 2), matchingPolicy: .nextTime) ?? Date()
        return TrainingPlan(name: dto.name, startDate: start, request: r, weeks: weeks, summary: dto.summary, source: "ia")
    }

    struct PlanDTO: Decodable {
        let name: String
        let summary: String
        let weeks: [WeekDTO]
        struct WeekDTO: Decodable { let phase: String; let focus: String; let sessions: [SessionDTO] }
        struct SessionDTO: Decodable {
            let weekday: Int; let title: String; let kind: String; let targetStrain: Double
            let exercises: [ExDTO]; let cardio: CardioDTO
        }
        struct ExDTO: Decodable { let name: String; let exerciseKey: String; let sets: Int; let reps: String; let rir: Int; let restSeconds: Int; let notes: String }
        struct CardioDTO: Decodable { let minutes: Int; let zone: Int; let description: String }
    }

    static let planSchema: [String: Any] = {
        func obj(_ props: [String: Any]) -> [String: Any] {
            ["type": "object", "additionalProperties": false, "required": Array(props.keys).sorted(), "properties": props]
        }
        let str: [String: Any] = ["type": "string"]
        let int: [String: Any] = ["type": "integer"]
        let num: [String: Any] = ["type": "number"]
        let ex = obj(["name": str, "exerciseKey": str, "sets": int, "reps": str, "rir": int, "restSeconds": int, "notes": str])
        let cardio = obj(["minutes": int, "zone": int, "description": str])
        let session = obj(["weekday": int, "title": str, "kind": ["type": "string", "enum": ["strength", "cardio", "mixed", "mobility"]],
                           "targetStrain": num, "exercises": ["type": "array", "items": ex], "cardio": cardio])
        let week = obj(["phase": str, "focus": str, "sessions": ["type": "array", "items": session]])
        return obj(["name": str, "summary": str, "weeks": ["type": "array", "items": week]])
    }()
}

extension String {
    func ifEmpty(_ s: String) -> String { isEmpty ? s : self }
}

// MARK: - Journal questions

struct JournalQuestion: Identifiable {
    let key: String
    let text: String
    let short: String
    let icon: String
    var id: String { key }

    static let all: [JournalQuestion] = [
        .init(key: "alcohol", text: "¿Tomaste alcohol?", short: "alcohol", icon: "wineglass"),
        .init(key: "late_caffeine", text: "¿Cafeína después de las 14:00?", short: "cafeína tarde", icon: "cup.and.saucer"),
        .init(key: "late_meal", text: "¿Cena copiosa o tarde (<2 h antes de dormir)?", short: "cena tarde", icon: "fork.knife"),
        .init(key: "screens", text: "¿Pantallas en la cama?", short: "pantallas en cama", icon: "iphone"),
        .init(key: "work_stress", text: "¿Día estresante?", short: "estrés", icon: "brain.head.profile"),
        .init(key: "meditation", text: "¿Meditaste o hiciste respiración?", short: "meditación", icon: "leaf"),
        .init(key: "stretching", text: "¿Estiramientos/movilidad?", short: "movilidad", icon: "figure.cooldown"),
        .init(key: "sauna", text: "¿Sauna o baño caliente?", short: "sauna", icon: "flame"),
        .init(key: "cold", text: "¿Ducha fría / baño de hielo?", short: "frío", icon: "snowflake"),
        .init(key: "hydration", text: "¿Bebiste ≥2 L de agua?", short: "hidratación", icon: "drop"),
        .init(key: "reading", text: "¿Leíste antes de dormir?", short: "lectura", icon: "book"),
        .init(key: "magnesium", text: "¿Magnesio u otro suplemento para dormir?", short: "suplemento sueño", icon: "pills"),
        .init(key: "sick", text: "¿Te sentiste enfermo?", short: "enfermo", icon: "facemask"),
        .init(key: "travel", text: "¿Viajaste?", short: "viaje", icon: "airplane"),
        .init(key: "sunlight", text: "¿Luz solar por la mañana?", short: "sol mañana", icon: "sun.max"),
        .init(key: "protein", text: "¿Objetivo de proteína cumplido?", short: "proteína", icon: "takeoutbag.and.cup.and.straw"),
    ]
}
