import Foundation

public enum MuscleGroup: String, Codable, CaseIterable {
    case chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves, core, fullBody, cardio
    public var spanish: String {
        switch self {
        case .chest: return "Pecho"
        case .back: return "Espalda"
        case .shoulders: return "Hombros"
        case .biceps: return "Bíceps"
        case .triceps: return "Tríceps"
        case .quads: return "Cuádriceps"
        case .hamstrings: return "Isquios"
        case .glutes: return "Glúteos"
        case .calves: return "Gemelos"
        case .core: return "Core"
        case .fullBody: return "Cuerpo completo"
        case .cardio: return "Cardio"
        }
    }
}

public enum Equipment: String, Codable, CaseIterable {
    case fullGym, dumbbells, bodyweight
    public var spanish: String {
        switch self {
        case .fullGym: return "Gimnasio completo"
        case .dumbbells: return "Mancuernas en casa"
        case .bodyweight: return "Peso corporal"
        }
    }
}

public enum MovementPattern: String, Codable {
    case squat, hinge, horizontalPush, verticalPush, horizontalPull, verticalPull, lunge, isolationUpper, isolationLower, core, carry, cardio
}

public struct Exercise: Codable, Hashable, Identifiable {
    public var id: String { key }
    public let key: String
    public let spanish: String
    /// Name as it appears in Strong's export (for matching history and suggesting weights).
    public let strongName: String
    public let primary: MuscleGroup
    public let secondary: [MuscleGroup]
    public let pattern: MovementPattern
    public let equipment: Set<Equipment>
    public let compound: Bool
    public let cue: String
}

public enum ExerciseLibrary {
    private static func ex(_ key: String, _ es: String, _ strong: String, _ p: MuscleGroup, _ s: [MuscleGroup],
                           _ pat: MovementPattern, _ eq: Set<Equipment>, _ comp: Bool, _ cue: String) -> Exercise {
        Exercise(key: key, spanish: es, strongName: strong, primary: p, secondary: s, pattern: pat, equipment: eq, compound: comp, cue: cue)
    }

    public static let all: [Exercise] = [
        // Squat / knee dominant
        ex("back_squat", "Sentadilla trasera con barra", "Squat (Barbell)", .quads, [.glutes, .core], .squat, [.fullGym], true, "Pecho arriba, rodillas siguiendo la punta de los pies, profundidad bajo paralelo si la movilidad lo permite."),
        ex("front_squat", "Sentadilla frontal", "Front Squat (Barbell)", .quads, [.glutes, .core], .squat, [.fullGym], true, "Codos altos, torso vertical."),
        ex("goblet_squat", "Sentadilla goblet", "Goblet Squat (Kettlebell)", .quads, [.glutes], .squat, [.fullGym, .dumbbells], true, "Mancuerna pegada al pecho, codos entre las rodillas."),
        ex("leg_press", "Prensa de piernas", "Leg Press", .quads, [.glutes], .squat, [.fullGym], true, "No despegues la zona lumbar del respaldo."),
        ex("bw_squat", "Sentadilla con peso corporal", "Squat (Bodyweight)", .quads, [.glutes], .squat, [.bodyweight, .dumbbells, .fullGym], true, "Controla la bajada en 3 segundos."),
        ex("bulgarian_split", "Sentadilla búlgara", "Bulgarian Split Squat", .quads, [.glutes], .lunge, [.fullGym, .dumbbells, .bodyweight], true, "Pie trasero apoyado en banco, torso ligeramente inclinado."),
        ex("walking_lunge", "Zancadas caminando", "Walking Lunge (Dumbbell)", .quads, [.glutes], .lunge, [.fullGym, .dumbbells, .bodyweight], true, "Paso largo, rodilla trasera casi toca el suelo."),
        ex("leg_extension", "Extensión de cuádriceps", "Leg Extension (Machine)", .quads, [], .isolationLower, [.fullGym], false, "Pausa de 1 s arriba."),
        // Hinge
        ex("deadlift", "Peso muerto", "Deadlift (Barbell)", .hamstrings, [.glutes, .back, .core], .hinge, [.fullGym], true, "Barra pegada a las piernas, espalda neutra, empuja el suelo."),
        ex("rdl", "Peso muerto rumano", "Romanian Deadlift (Barbell)", .hamstrings, [.glutes, .back], .hinge, [.fullGym], true, "Cadera atrás, rodillas semiflexionadas, siente el estiramiento."),
        ex("db_rdl", "Peso muerto rumano con mancuernas", "Romanian Deadlift (Dumbbell)", .hamstrings, [.glutes], .hinge, [.fullGym, .dumbbells], true, "Mancuernas rozando los muslos."),
        ex("hip_thrust", "Hip thrust", "Hip Thrust (Barbell)", .glutes, [.hamstrings], .hinge, [.fullGym, .dumbbells], true, "Mentón al pecho, bloquea glúteo arriba."),
        ex("glute_bridge", "Puente de glúteo", "Glute Bridge", .glutes, [.hamstrings], .hinge, [.bodyweight, .dumbbells, .fullGym], false, "Aprieta glúteos 2 s arriba."),
        ex("leg_curl", "Curl femoral", "Lying Leg Curl (Machine)", .hamstrings, [], .isolationLower, [.fullGym], false, "Baja controlado."),
        ex("nordic_curl", "Curl nórdico", "Nordic Hamstring Curl", .hamstrings, [], .isolationLower, [.bodyweight, .dumbbells, .fullGym], false, "Baja lo más lento posible."),
        ex("kb_swing", "Swing con kettlebell", "Kettlebell Swing", .glutes, [.hamstrings, .core], .hinge, [.fullGym, .dumbbells], true, "Explosivo desde la cadera, no desde los brazos."),
        // Horizontal push
        ex("bench_press", "Press de banca", "Bench Press (Barbell)", .chest, [.triceps, .shoulders], .horizontalPush, [.fullGym], true, "Escápulas retraídas, pies firmes, barra al esternón."),
        ex("db_bench", "Press de banca con mancuernas", "Bench Press (Dumbbell)", .chest, [.triceps, .shoulders], .horizontalPush, [.fullGym, .dumbbells], true, "Rango completo, codos a 45°."),
        ex("incline_db_press", "Press inclinado con mancuernas", "Incline Bench Press (Dumbbell)", .chest, [.shoulders, .triceps], .horizontalPush, [.fullGym, .dumbbells], true, "Banco a 30°."),
        ex("incline_bench", "Press inclinado con barra", "Incline Bench Press (Barbell)", .chest, [.shoulders, .triceps], .horizontalPush, [.fullGym], true, "Banco a 30°, barra a la clavícula."),
        ex("push_up", "Flexiones", "Push Up", .chest, [.triceps, .shoulders, .core], .horizontalPush, [.bodyweight, .dumbbells, .fullGym], true, "Cuerpo en bloque, pecho al suelo."),
        ex("dips", "Fondos en paralelas", "Chest Dip", .chest, [.triceps], .horizontalPush, [.fullGym, .bodyweight], true, "Ligera inclinación hacia delante."),
        ex("cable_fly", "Aperturas en polea", "Cable Crossover", .chest, [], .isolationUpper, [.fullGym], false, "Abraza un árbol, codos fijos."),
        // Vertical push
        ex("ohp", "Press militar", "Overhead Press (Barbell)", .shoulders, [.triceps, .core], .verticalPush, [.fullGym], true, "Glúteos apretados, cabeza atraviesa al final."),
        ex("db_shoulder_press", "Press de hombro con mancuernas", "Shoulder Press (Dumbbell)", .shoulders, [.triceps], .verticalPush, [.fullGym, .dumbbells], true, "Sin arquear la espalda."),
        ex("pike_push_up", "Flexiones pike", "Pike Push Up", .shoulders, [.triceps], .verticalPush, [.bodyweight], true, "Cadera alta, cabeza entre las manos."),
        ex("lateral_raise", "Elevaciones laterales", "Lateral Raise (Dumbbell)", .shoulders, [], .isolationUpper, [.fullGym, .dumbbells], false, "Sube hasta la altura del hombro, sin impulso."),
        ex("face_pull", "Face pull", "Face Pull (Cable)", .shoulders, [.back], .isolationUpper, [.fullGym], false, "Tira hacia la frente separando las manos."),
        ex("rear_delt_fly", "Pájaros", "Reverse Fly (Dumbbell)", .shoulders, [.back], .isolationUpper, [.fullGym, .dumbbells], false, "Torso inclinado, codos ligeramente flexionados."),
        // Horizontal pull
        ex("barbell_row", "Remo con barra", "Bent Over Row (Barbell)", .back, [.biceps], .horizontalPull, [.fullGym], true, "Torso a 45°, barra al ombligo."),
        ex("db_row", "Remo con mancuerna", "Bent Over One Arm Row (Dumbbell)", .back, [.biceps], .horizontalPull, [.fullGym, .dumbbells], true, "Codo hacia la cadera."),
        ex("cable_row", "Remo en polea baja", "Seated Row (Cable)", .back, [.biceps], .horizontalPull, [.fullGym], true, "Pecho fuera, junta escápulas."),
        ex("inverted_row", "Remo invertido", "Inverted Row", .back, [.biceps], .horizontalPull, [.bodyweight, .fullGym], true, "Cuerpo recto, pecho a la barra/mesa."),
        // Vertical pull
        ex("pull_up", "Dominadas", "Pull Up", .back, [.biceps], .verticalPull, [.fullGym, .bodyweight], true, "Desde brazos extendidos hasta barbilla sobre la barra."),
        ex("chin_up", "Dominadas supinas", "Chin Up", .back, [.biceps], .verticalPull, [.fullGym, .bodyweight], true, "Palmas hacia ti."),
        ex("lat_pulldown", "Jalón al pecho", "Lat Pulldown (Cable)", .back, [.biceps], .verticalPull, [.fullGym], true, "Lleva la barra a la parte alta del pecho."),
        ex("db_pullover", "Pullover con mancuerna", "Pullover (Dumbbell)", .back, [.chest], .verticalPull, [.dumbbells, .fullGym], false, "Brazos casi extendidos."),
        // Arms
        ex("bb_curl", "Curl con barra", "Bicep Curl (Barbell)", .biceps, [], .isolationUpper, [.fullGym], false, "Codos pegados, sin balanceo."),
        ex("db_curl", "Curl con mancuernas", "Bicep Curl (Dumbbell)", .biceps, [], .isolationUpper, [.fullGym, .dumbbells], false, "Supina al subir."),
        ex("hammer_curl", "Curl martillo", "Hammer Curl (Dumbbell)", .biceps, [], .isolationUpper, [.fullGym, .dumbbells], false, "Agarre neutro."),
        ex("triceps_pushdown", "Extensión de tríceps en polea", "Triceps Pushdown (Cable - Straight Bar)", .triceps, [], .isolationUpper, [.fullGym], false, "Codos fijos al costado."),
        ex("skull_crusher", "Press francés", "Skullcrusher (Barbell)", .triceps, [], .isolationUpper, [.fullGym, .dumbbells], false, "Baja a la frente controlado."),
        ex("overhead_ext", "Extensión de tríceps por encima de la cabeza", "Triceps Extension (Dumbbell)", .triceps, [], .isolationUpper, [.fullGym, .dumbbells], false, "Codos apuntando al techo."),
        ex("diamond_push_up", "Flexiones diamante", "Diamond Push Up", .triceps, [.chest], .horizontalPush, [.bodyweight], true, "Manos juntas bajo el pecho."),
        // Calves
        ex("calf_raise", "Elevación de gemelos", "Standing Calf Raise (Machine)", .calves, [], .isolationLower, [.fullGym, .dumbbells, .bodyweight], false, "Pausa abajo y arriba."),
        // Core
        ex("plank", "Plancha", "Plank", .core, [], .core, [.bodyweight, .dumbbells, .fullGym], false, "Glúteos y abdomen apretados."),
        ex("hanging_leg_raise", "Elevación de piernas colgado", "Hanging Leg Raise", .core, [], .core, [.fullGym, .bodyweight], false, "Sin balanceo, pelvis en retroversión."),
        ex("ab_wheel", "Rueda abdominal", "Ab Wheel", .core, [], .core, [.fullGym, .dumbbells, .bodyweight], false, "No hundas la zona lumbar."),
        ex("pallof", "Press Pallof", "Pallof Press", .core, [], .core, [.fullGym], false, "Antirrotación: resiste el giro."),
        ex("dead_bug", "Dead bug", "Dead Bug", .core, [], .core, [.bodyweight, .dumbbells, .fullGym], false, "Lumbar pegada al suelo."),
        ex("farmer_carry", "Paseo del granjero", "Farmers Walk", .fullBody, [.core, .back], .carry, [.fullGym, .dumbbells], true, "Hombros atrás, pasos cortos."),
        // Cardio
        ex("run_z2", "Carrera suave (Z2)", "Running", .cardio, [], .cardio, [.bodyweight, .dumbbells, .fullGym], false, "Ritmo conversacional, 60–70 % FCmáx."),
        ex("bike_z2", "Bici suave (Z2)", "Cycling", .cardio, [], .cardio, [.fullGym, .bodyweight, .dumbbells], false, "Cadencia 85–95 rpm."),
        ex("intervals", "Intervalos (4×4 min Z4–Z5)", "Running (Intervals)", .cardio, [], .cardio, [.fullGym, .bodyweight, .dumbbells], false, "4 min fuerte / 3 min suave."),
        ex("rower", "Remo ergómetro", "Rowing (Machine)", .cardio, [.back], .cardio, [.fullGym], false, "Piernas → espalda → brazos."),
    ]

    public static func byKey(_ k: String) -> Exercise? { all.first { $0.key == k } }

    /// Matches a Strong exercise name ("Bench Press (Barbell)") to a library exercise.
    public static func match(strongName: String) -> Exercise? {
        let n = strongName.lowercased()
        if let exact = all.first(where: { $0.strongName.lowercased() == n }) { return exact }
        let base = n.components(separatedBy: " (").first ?? n
        return all.first { $0.strongName.lowercased().hasPrefix(base) }
    }

    /// Best-guess muscle group for any Strong exercise name (for volume-per-muscle analytics).
    public static func muscle(forStrongName name: String) -> MuscleGroup {
        if let e = match(strongName: name) { return e.primary }
        let n = name.lowercased()
        let rules: [(String, MuscleGroup)] = [
            ("face pull", .shoulders), ("lateral", .shoulders), ("rear delt", .shoulders), ("reverse fly", .shoulders),
            ("rowing", .cardio), ("running", .cardio), ("cycling", .cardio), ("bike", .cardio), ("elliptical", .cardio),
            ("walk", .cardio), ("stair", .cardio), ("swim", .cardio),
            ("leg curl", .hamstrings), ("hamstring", .hamstrings), ("deadlift", .hamstrings),
            ("hip thrust", .glutes), ("glute", .glutes), ("calf", .calves),
            ("leg raise", .core), ("crunch", .core), ("plank", .core), ("sit up", .core), ("ab ", .core),
            ("bench", .chest), ("chest", .chest), ("fly", .chest), ("push up", .chest), ("dip", .triceps),
            ("squat", .quads), ("leg press", .quads), ("lunge", .quads), ("leg extension", .quads),
            ("row", .back), ("pull", .back), ("lat ", .back), ("chin", .back),
            ("shoulder", .shoulders), ("overhead", .shoulders), ("delt", .shoulders), ("shrug", .back),
            ("tricep", .triceps), ("skull", .triceps), ("curl", .biceps)
        ]
        for (k, m) in rules where n.contains(k) { return m }
        return .fullBody
    }
}
