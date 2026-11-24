"""Aggregations: training load series, weekly reports, records, insights, habit impact."""
import json
import math
import statistics as st

from . import db
from .core import add_days, day_key, keys_between, local, now, today_key, week_days, week_key

K_STRAIN = 90.0


def mean(x):
    x = [v for v in x if v is not None]
    return sum(x) / len(x) if x else None


def sd(x):
    x = [v for v in x if v is not None]
    return st.stdev(x) if len(x) > 1 else None


def pearson(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    xs, ys = zip(*pairs)
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else None


def slope(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 2:
        return None
    mx, my = mean([p[0] for p in pairs]), mean([p[1] for p in pairs])
    den = sum((x - mx) ** 2 for x, _ in pairs)
    return sum((x - mx) * (y - my) for x, y in pairs) / den if den else None


def load_from_strain(s):
    s = min(max(s or 0, 0), 20.99)
    return -K_STRAIN * math.log(1 - s / 21)


def metrics_map(a: str, b: str) -> dict[str, dict]:
    rows = db.q("SELECT day_key, metrics FROM days WHERE day_key BETWEEN ? AND ? AND samples > 0", (a, b))
    return {r["day_key"]: json.loads(r["metrics"]) for r in rows}


def metrics_list(a: str, b: str) -> list[dict]:
    m = metrics_map(a, b)
    return [m.get(k) or {"dayKey": k} for k in keys_between(a, b)]


def reports_map(a: str, b: str) -> dict[str, dict]:
    rows = db.q("SELECT day_key, report FROM days WHERE day_key BETWEEN ? AND ? AND report IS NOT NULL", (a, b))
    return {r["day_key"]: json.loads(r["report"]) for r in rows}

# ------------------------------------------------------------------ load

def load_series(days: int = 120) -> list[dict]:
    end = today_key()
    start = add_days(end, -(days + 42))
    ms = metrics_list(start, end)
    acute = chronic = None
    a7, a28 = 2 / 8, 2 / 29
    out = []
    loads = []
    with_data = 0
    for m in ms:
        if m.get("strain") is None and not with_data:
            continue                      # skip the empty period before the first synced day
        if m.get("strain") is not None:
            with_data += 1
        l = load_from_strain(m.get("strain"))
        loads.append(l)
        acute = l if acute is None else a7 * l + (1 - a7) * acute
        chronic = l if chronic is None else a28 * l + (1 - a28) * chronic
        last7 = loads[-7:]
        mono = None
        if len(last7) >= 5 and (s := sd(last7)) and s > 0:
            mono = mean(last7) / s
        out.append({"day": m["dayKey"], "strain": m.get("strain"), "load": l, "acute": acute, "chronic": chronic,
                    # ACWR needs a stable chronic base: ≥ 21 days with data
                    "acwr": acute / chronic if chronic and chronic > 5 and with_data >= 21 else None,
                    "monotony": mono, "weekly": sum(last7), "fosterStrain": (sum(last7) * mono) if mono else None,
                    "recovery": m.get("recovery"), "kcal": m.get("kcal")})
    return out[-days:]


def load_status(acwr):
    if acwr is None:
        return "Calibrando (necesita 3 semanas de datos)"
    if acwr > 1.5:
        return "Sobrecarga: riesgo elevado"
    if acwr > 1.3:
        return "Carga alta: vigila la recuperación"
    if acwr >= 0.8:
        return "Zona óptima"
    return "Desentrenamiento: puedes cargar más"

# ------------------------------------------------------------------ weekly

def _bed_minutes(ts):
    if not ts:
        return None
    d = local(ts)
    m = d.hour * 60 + d.minute
    return m - 1440 if m > 18 * 60 else m   # minutes relative to midnight (negative = before)


def weekly_report(wkey: str) -> dict:
    days = week_days(wkey)
    prev = week_days(week_key(add_days(days[0], -1)))
    mm = metrics_map(days[0], days[-1])
    pm = metrics_map(prev[0], prev[-1])
    reps = reports_map(days[0], days[-1])
    cur = [mm.get(k) for k in days]
    pre = [pm.get(k) for k in prev]

    def avg(lst, f):
        return mean([x.get(f) for x in lst if x])

    keys = [("recovery", True), ("strain", None), ("hrv", True), ("rhr", False), ("resp", None), ("sleptMin", True),
            ("sleepScore", True), ("sleepPerformance", True), ("deepMin", True), ("remMin", True), ("avgStress", False),
            ("kcal", None), ("steps", True), ("spo2", True)]
    kpis = {k: {"cur": avg(cur, k), "prev": avg(pre, k), "higherIsBetter": hb} for k, hb in keys}

    valid = [x for x in cur if x]
    recs = [x.get("recovery") for x in valid if x.get("recovery") is not None]
    bands = {"green": sum(1 for r in recs if r >= 67), "yellow": sum(1 for r in recs if 34 <= r < 67),
             "red": sum(1 for r in recs if r < 34)}
    need = sum((x.get("sleepNeedMin") or 0) for x in valid if x.get("sleptMin") is not None)
    slept = sum((x.get("sleptMin") or 0) for x in valid if x.get("sleptMin") is not None)
    beds = [_bed_minutes(x.get("bedtime")) for x in valid]
    wakes = [_bed_minutes(x.get("wakeTime")) for x in valid]
    zones = [0] * 6
    for r in reps.values():
        for i, v in enumerate((r.get("strain") or {}).get("zoneSeconds", [])[:6]):
            zones[i] += v
    from .core import day_bounds
    ws, _ = day_bounds(days[0])
    _, we = day_bounds(days[-1])
    workouts = [dict(r) for r in db.q("SELECT uid, source, start, end, sport, name, strain, avg_hr, kcal, distance_km, strong FROM workouts WHERE start >= ? AND start < ? ORDER BY start", (ws, we))]
    volume = 0.0
    sets = 0
    for w in workouts:
        if w.get("strong"):
            sw = json.loads(w["strong"])
            for s in sw.get("sets", []):
                if (s.get("setType") or "").upper() != "W":
                    volume += (s.get("weightKg") or 0) * (s.get("reps") or 0)
                    sets += 1
        w.pop("strong", None)
    load = {x["day"]: x for x in load_series(60)}
    end_load = load.get(days[-1]) or (list(load.values())[-1] if load else {})
    best = max(valid, key=lambda x: x.get("recovery") or -1, default=None)
    worst = min(valid, key=lambda x: x.get("recovery") if x.get("recovery") is not None else 999, default=None)
    journal = db.q("SELECT day_key, answers FROM journal WHERE day_key BETWEEN ? AND ?", (days[0], days[-1]))
    habits: dict[str, int] = {}
    for j in journal:
        for k, v in json.loads(j["answers"]).items():
            if v:
                habits[k] = habits.get(k, 0) + 1
    return {
        "week": wkey, "days": days, "daily": [x or {"dayKey": k} for x, k in zip(cur, days)],
        "kpis": kpis, "recoveryBands": bands,
        "sleep": {"needMin": need, "sleptMin": slept, "debtMin": max(0, need - slept),
                  "bedtimeSD": sd(beds), "wakeSD": sd(wakes), "avgBed": mean(beds), "avgWake": mean(wakes)},
        "training": {"workouts": workouts, "count": len(workouts), "strongVolumeKg": volume, "strongSets": sets,
                     "totalStrain": sum((x.get("strain") or 0) for x in valid),
                     "totalKcal": sum((x.get("kcal") or 0) for x in valid), "zones": zones,
                     "distanceKm": sum((w.get("distance_km") or 0) for w in workouts)},
        "load": {"acwr": end_load.get("acwr"), "acute": end_load.get("acute"), "chronic": end_load.get("chronic"),
                 "monotony": end_load.get("monotony"), "status": load_status(end_load.get("acwr"))},
        "best": best and {"day": best["dayKey"], "recovery": best.get("recovery")},
        "worst": worst and {"day": worst["dayKey"], "recovery": worst.get("recovery")},
        "habits": habits, "daysWithData": len(valid),
        "hrvSlope": slope(list(range(7)), [x.get("hrv") if x else None for x in cur]),
    }

# ------------------------------------------------------------------ records & insights

RECORD_DEFS = [
    ("hrv", "VFC más alta", max, "ms"), ("rhr", "FC en reposo más baja", min, "lpm"),
    ("recovery", "Mejor recuperación", max, "%"), ("strain", "Mayor esfuerzo", max, ""),
    ("sleepScore", "Mejor puntuación de sueño", max, ""), ("sleptMin", "Noche más larga", max, "min"),
    ("deepMin", "Más sueño profundo", max, "min"), ("kcal", "Más calorías", max, "kcal"),
    ("steps", "Más pasos", max, ""),
]


def records() -> list[dict]:
    rows = db.q("SELECT day_key, metrics FROM days WHERE samples > 0")
    ms = [json.loads(r["metrics"]) for r in rows]
    out = []
    for key, label, fn, unit in RECORD_DEFS:
        vals = [(m.get(key), m["dayKey"]) for m in ms if m.get(key) is not None]
        if vals:
            v, d = fn(vals, key=lambda t: t[0])
            out.append({"key": key, "label": label, "value": v, "day": d, "unit": unit})
    return out


def insights(days: int = 90) -> list[str]:
    ms = [m for m in metrics_list(add_days(today_key(), -days), today_key()) if m.get("recovery") is not None or m.get("strain") is not None]
    out = []
    pairs = [(m["sleptMin"] / 60, m["recovery"]) for m in ms if m.get("sleptMin") and m.get("recovery") is not None]
    if len(pairs) >= 10:
        s = slope([p[0] for p in pairs], [p[1] for p in pairs])
        if s and s > 1:
            out.append(f"Cada hora extra de sueño se asocia con +{s:.0f} puntos de recuperación.")
    late = [m["recovery"] for m in ms if m.get("bedtime") and m.get("recovery") is not None and 0.5 <= (local(m["bedtime"]).hour + local(m["bedtime"]).minute / 60) < 12]
    early = [m["recovery"] for m in ms if m.get("bedtime") and m.get("recovery") is not None and local(m["bedtime"]).hour >= 18]
    if len(late) >= 3 and len(early) >= 3 and mean(early) - mean(late) > 5:
        out.append(f"Acostarte antes de las 00:30 te da de media {mean(early) - mean(late):.0f} puntos más de recuperación.")
    hrvs = [m.get("hrv") for m in ms if m.get("hrv")]
    if len(hrvs) >= 14:
        last7, prevv, s = mean(hrvs[-7:]), mean(hrvs[:-7]), sd(hrvs) or 1
        if last7 - prevv > 0.5 * s:
            out.append("Tu VFC media de la última semana está por encima de tu normal: buena adaptación.")
        if prevv - last7 > 0.5 * s:
            out.append("Tu VFC lleva una semana por debajo de lo normal: revisa carga, sueño y estrés.")
    st_next = [(ms[i].get("strain"), ms[i + 1].get("recovery")) for i in range(len(ms) - 1)]
    r = pearson([a for a, _ in st_next], [b for _, b in st_next])
    if r is not None and len(st_next) >= 14 and r < -0.3:
        out.append(f"Los días de mucho esfuerzo bajan tu recuperación del día siguiente (r = {r:.2f}).")
    ls = load_series(30)
    if ls and ls[-1].get("acwr"):
        out.append(f"Carga: {load_status(ls[-1]['acwr']).lower()} (ACWR {ls[-1]['acwr']:.2f}).")
    stress = [m.get("avgStress") for m in ms[-7:] if m.get("avgStress") is not None]
    if stress and mean(stress) > 1.5:
        out.append("Tu estrés medio de la última semana es alto: prueba la respiración guiada a diario.")
    return out


JOURNAL_QUESTIONS = [
    ("alcohol", "¿Tomaste alcohol?", "alcohol"), ("late_caffeine", "¿Cafeína después de las 14:00?", "cafeína tarde"),
    ("late_meal", "¿Cena copiosa o tarde?", "cena tarde"), ("screens", "¿Pantallas en la cama?", "pantallas en cama"),
    ("work_stress", "¿Día estresante?", "estrés"), ("meditation", "¿Meditaste o hiciste respiración?", "meditación"),
    ("stretching", "¿Estiramientos/movilidad?", "movilidad"), ("sauna", "¿Sauna o baño caliente?", "sauna"),
    ("cold", "¿Ducha fría / baño de hielo?", "frío"), ("hydration", "¿Bebiste ≥2 L de agua?", "hidratación"),
    ("reading", "¿Leíste antes de dormir?", "lectura"), ("magnesium", "¿Suplemento para dormir?", "suplemento sueño"),
    ("sick", "¿Te sentiste enfermo?", "enfermo"), ("travel", "¿Viajaste?", "viaje"),
    ("sunlight", "¿Luz solar por la mañana?", "sol mañana"), ("protein", "¿Objetivo de proteína cumplido?", "proteína"),
    ("late_workout", "¿Entrenaste tarde (después de las 20:00)?", "entreno tarde"), ("nap", "¿Echaste siesta?", "siesta"),
]


def journal_impact() -> list[dict]:
    rec = {r["day_key"]: json.loads(r["metrics"]).get("recovery") for r in db.q("SELECT day_key, metrics FROM days WHERE samples > 0")}
    entries = db.q("SELECT day_key, answers FROM journal")
    out = []
    for key, _, short in JOURNAL_QUESTIONS:
        yes, no = [], []
        for e in entries:
            r = rec.get(add_days(e["day_key"], 1))
            if r is None:
                continue
            (yes if json.loads(e["answers"]).get(key) else no).append(r)
        if len(yes) >= 3 and len(no) >= 3:
            out.append({"key": key, "label": short, "delta": mean(yes) - mean(no), "n": len(yes)})
    return sorted(out, key=lambda x: -abs(x["delta"]))
