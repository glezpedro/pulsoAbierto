"""Sleep section: compact nights for the charts and the insights shown in «Sueño».

Everything here works on the per-day metrics/reports produced by the engine:
- nights(): one compact row per night (stage run-lengths, times, key numbers) for the D/W/M charts.
- insights(): period averages vs the previous period, best bedtime / wake time / duration for how you
  feel the next day (recovery), regularity (Sleep Regularity Index), social jet lag, chronotype,
  sleep debt, overnight vitals vs your typical range, and plain-language highlights.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import statistics as st

from . import db
from .core import add_days, keys_between, local, today_key
from .reports import mean, metrics_list, pearson, sd

STAGE_NAMES = {0: "despierto", 1: "básico", 2: "profundo", 3: "REM"}


# ------------------------------------------------------------------ helpers

def clock_min(ts: int | None, pivot: int = 18 * 60) -> float | None:
    """Local clock time in minutes, continuous across midnight: 23:30 → -30, 00:30 → 30 (pivot 18:00)."""
    if not ts:
        return None
    d = local(ts)
    m = d.hour * 60 + d.minute + d.second / 60
    return m - 1440 if m >= pivot else m


def bed_min(ts: int | None) -> float | None:
    """Bedtime on a continuous axis around midnight: anything after noon is "the evening before"."""
    return clock_min(ts, pivot=12 * 60)


def robust_sd(vals: list[float | None], window: float = 180) -> float | None:
    """SD ignoring values more than `window` minutes away from the median (one-off naps, travel)."""
    v = [x for x in vals if x is not None]
    if len(v) < 2:
        return None
    med = st.median(v)
    return sd([x for x in v if abs(x - med) <= window])


def fmt_clock(m: float | None) -> str | None:
    if m is None:
        return None
    m = round(m) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def fmt_hm(minutes: float | None) -> str:
    if minutes is None:
        return "–"
    x = int(round(minutes))
    return f"{x // 60} h {x % 60:02d} min" if x >= 60 else f"{x} min"


def runs(stages: list[int]) -> list[list[int]]:
    """Run-length encode a per-minute stage list: [[stage, minutes], ...]."""
    out: list[list[int]] = []
    for s in stages:
        if out and out[-1][0] == s:
            out[-1][1] += 1
        else:
            out.append([s, 1])
    return out


def _reports(a: str, b: str) -> dict[str, dict]:
    rows = db.q("SELECT day_key, report FROM days WHERE day_key BETWEEN ? AND ? AND report IS NOT NULL AND samples > 0", (a, b))
    out = {}
    for r in rows:
        try:
            out[r["day_key"]] = json.loads(r["report"])
        except (TypeError, ValueError):
            continue
    return out


# ------------------------------------------------------------------ nights

def nights(frm: str, to: str) -> list[dict]:
    """Compact nights (≤ 62 days). Days without a main sleep are returned with `start: None`."""
    keys = keys_between(frm, to)[-62:]
    reps = _reports(keys[0], keys[-1]) if keys else {}
    out = []
    for k in keys:
        r = reps.get(k) or {}
        s = r.get("sleep")
        m = r.get("metrics") or {}
        if not s:
            out.append({"day": k, "start": None})
            continue
        stages = s.get("stages") or []
        out.append({
            "day": k, "start": s["start"], "end": s["end"], "segs": runs(stages),
            "slept": m.get("sleptMin"), "inBed": m.get("inBedMin"), "need": m.get("sleepNeedMin"),
            "score": m.get("sleepScore"), "deep": m.get("deepMin"), "rem": m.get("remMin"),
            "light": m.get("lightMin"), "awake": m.get("awakeMin"), "recovery": m.get("recovery"),
            "hrv": m.get("hrv"), "rhr": m.get("rhr"), "resp": m.get("resp"),
            "naps": [{"start": n["start"], "end": n["end"], "slept": sum(1 for x in n.get("stages", []) if x)} for n in r.get("naps") or []],
        })
    return out


# ------------------------------------------------------------------ regularity

def sleep_regularity_index(intervals: dict[str, tuple[int, int]]) -> float | None:
    """Sleep Regularity Index (Phillips et al. 2017): probability of being in the same state
    (asleep/awake) at two moments 24 h apart, scaled to −100…100 (here clamped to 0–100).
    Computed on consecutive calendar days, 18:00→18:00 local windows, 5-minute resolution, using the
    main sleep interval of each night (naps ignored)."""
    keys = sorted(intervals)
    same = total = 0
    for a, b in zip(keys, keys[1:]):
        if add_days(a, 1) != b:
            continue
        va = _asleep_vector(intervals[a])
        vb = _asleep_vector(intervals[b])
        for x, y in zip(va, vb):
            total += 1
            same += x == y
    if total < 288 * 2:          # at least two pairs of consecutive nights
        return None
    return max(0.0, min(100.0, -100 + 200 * same / total))


def _asleep_vector(iv: tuple[int, int]) -> list[bool]:
    """288 × 5-minute slots from 18:00 the evening before the wake day."""
    start, end = iv
    s = bed_min(start)
    e = clock_min(end)
    if s is None or e is None:
        return [False] * 288
    s0, e0 = s + 360, e + 360          # shift so 18:00 → 0
    if e0 < s0:
        e0 += 1440
    return [s0 <= i * 5 < e0 for i in range(288)]


# ------------------------------------------------------------------ bins

def _bins(rows: list[dict], key, width: float, outcome: str, fmt) -> list[dict]:
    groups: dict[float, list[float]] = {}
    for r in rows:
        x = key(r)
        y = r.get(outcome)
        if x is None or y is None:
            continue
        b = math.floor(x / width) * width
        groups.setdefault(b, []).append(y)
    out = []
    for b in sorted(groups):
        ys = groups[b]
        out.append({"from": b, "to": b + width, "label": fmt(b, b + width), "n": len(ys), "mean": mean(ys)})
    return out


def _best(bins: list[dict], min_n: int = 2) -> dict | None:
    ok = [b for b in bins if b["n"] >= min_n]
    if len(ok) < 2:
        return None
    best = max(ok, key=lambda b: b["mean"])
    rest = [y for b in ok if b is not best for y in [b["mean"]] * b["n"]]
    worst = min(ok, key=lambda b: b["mean"])
    return {**best, "others": mean(rest), "delta": best["mean"] - (mean(rest) or best["mean"]), "worst": worst}


def _clock_label(a: float, b: float) -> str:
    return f"{fmt_clock(a)}–{fmt_clock(b)}"


def _hours_label(a: float, b: float) -> str:
    def h(x):
        return f"{int(x // 60)}:{int(x % 60):02d}" if x % 60 else f"{int(x // 60)} h"
    return f"{h(a)}–{h(b)}"


# ------------------------------------------------------------------ insights

VITALS = [
    # key, label, unit, decimals, higher-is-better (None = neutral)
    ("rhr", "FC en reposo", "lpm", 0, False),
    ("hrv", "VFC", "ms", 0, True),
    ("resp", "Frecuencia respiratoria", "rpm", 1, None),
    ("sleepAvgHR", "FC media durmiendo", "lpm", 0, False),
    ("skinTemp", "Temperatura de la piel", "", 0, None),
    ("sleptMin", "Tiempo dormido", "min", 0, True),
]


def vitals(day: str) -> dict:
    """Last night's overnight vitals against the typical range of the previous 30 nights
    (mean ± max(1.5 SD, a small floor)), like the Vitals app. ≥ 2 outliers → a note."""
    hist = [m for m in metrics_list(add_days(day, -30), add_days(day, -1)) if m.get("sleptMin")]
    cur = next(iter(metrics_list(day, day)), {}) or {}
    floors = {"rhr": 2, "hrv": 4, "resp": 0.6, "sleepAvgHR": 2, "skinTemp": 8, "sleptMin": 30}
    rows, outliers = [], 0
    for k, label, unit, dec, better in VITALS:
        vals = [m[k] for m in hist if m.get(k) is not None]
        v = cur.get(k)
        row = {"key": k, "label": label, "unit": unit, "decimals": dec, "value": v, "n": len(vals), "state": None}
        if len(vals) >= 5:
            mu, s = mean(vals), sd(vals) or 0
            half = max(1.5 * s, floors[k])
            row.update(lo=mu - half, hi=mu + half, typical=mu, min=min(vals + ([v] if v is not None else [])),
                       max=max(vals + ([v] if v is not None else [])))
            if v is not None:
                row["state"] = "alto" if v > mu + half else "bajo" if v < mu - half else "típico"
                if row["state"] != "típico" and k != "sleptMin":
                    outliers += 1
                    if better is not None:
                        row["good"] = (row["state"] == "alto") == better
        rows.append(row)
    note = None
    if outliers >= 2:
        note = ("Varias constantes nocturnas están fuera de tu rango habitual. Puede deberse al alcohol, una cena "
                "copiosa, entrenar tarde, estrés, la altitud, medicamentos o el inicio de una enfermedad.")
    return {"day": day, "rows": rows, "outliers": outliers, "note": note, "nights": len(hist)}


def _period_stats(ms: list[dict]) -> dict:
    sl = [m for m in ms if m.get("sleptMin")]
    beds = [bed_min(m.get("bedtime")) for m in sl]
    wakes = [clock_min(m.get("wakeTime")) for m in sl]
    out = {"nights": len(sl)}
    for k in ("sleptMin", "inBedMin", "deepMin", "remMin", "lightMin", "awakeMin", "sleepScore", "efficiency",
              "latencyMin", "wakeups", "wasoMin", "recovery", "hrv", "rhr", "resp", "sleepAvgHR", "sleepNeedMin", "napMin"):
        out[k] = mean([m.get(k) for m in sl])
    out["bedtime"] = mean(beds)
    out["wake"] = mean(wakes)
    out["bedtimeSD"] = robust_sd(beds)
    out["wakeSD"] = robust_sd(wakes)
    mids = [(b + w) / 2 if w >= b else (b + w + 1440) / 2 for b, w in zip(beds, wakes) if b is not None and w is not None]
    out["midSleep"] = mean(mids)
    out["debt"] = sum(max(0.0, (m.get("sleepNeedMin") or 0) - m["sleptMin"]) for m in sl if m.get("sleepNeedMin"))
    out["best"] = max(sl, key=lambda m: m.get("sleepScore") or 0)["dayKey"] if sl else None
    out["worst"] = min(sl, key=lambda m: m.get("sleepScore") or 999)["dayKey"] if sl else None
    return out


def insights(to: str | None = None, days: int = 30, history: int = 120) -> dict:
    to = to or today_key()
    frm = add_days(to, -days + 1)
    cur_ms = metrics_list(frm, to)
    prev_ms = metrics_list(add_days(frm, -days), add_days(frm, -1))
    hist_ms = [m for m in metrics_list(add_days(to, -history + 1), to) if m.get("sleptMin")]
    cur, prev = _period_stats(cur_ms), _period_stats(prev_ms)

    # how you feel the next day = recovery (falls back to sleep score when recovery is missing)
    outcome = "recovery" if sum(1 for m in hist_ms if m.get("recovery") is not None) >= 7 else "sleepScore"
    bed_bins = _bins(hist_ms, lambda m: bed_min(m.get("bedtime")), 30, outcome, _clock_label)
    wake_bins = _bins(hist_ms, lambda m: clock_min(m.get("wakeTime")), 30, outcome, _clock_label)
    dur_bins = _bins(hist_ms, lambda m: m.get("sleptMin"), 30, outcome, _hours_label)
    best_bed, best_wake, best_dur = _best(bed_bins), _best(wake_bins), _best(dur_bins)

    # regularity
    iv = {m["dayKey"]: (m["bedtime"], m["wakeTime"]) for m in hist_ms[-28:] if m.get("bedtime") and m.get("wakeTime")}
    sri = sleep_regularity_index(iv)
    # social jet lag: mid-sleep on free days (wake Sat/Sun) − work days
    free, work = [], []
    for m in hist_ms[-42:]:
        b, w = bed_min(m.get("bedtime")), clock_min(m.get("wakeTime"))
        if b is None or w is None:
            continue
        mid = (b + w) / 2 if w >= b else (b + w + 1440) / 2
        (free if dt.date.fromisoformat(m["dayKey"]).weekday() >= 5 else work).append(mid)
    jetlag = (mean(free) - mean(work)) if len(free) >= 2 and len(work) >= 3 else None
    msf = mean(free) if len(free) >= 2 else mean(free + work)
    chrono = None
    if msf is not None:
        chrono = ("madrugador" if msf < 3 * 60 else "intermedio" if msf < 5 * 60 else "noctámbulo")

    # correlations worth telling
    corr = {
        "durationRecovery": pearson([m.get("sleptMin") for m in hist_ms], [m.get("recovery") for m in hist_ms]),
        "bedtimeRecovery": pearson([bed_min(m.get("bedtime")) for m in hist_ms], [m.get("recovery") for m in hist_ms]),
        "deepHRV": pearson([m.get("deepMin") for m in hist_ms], [m.get("hrv") for m in hist_ms]),
    }
    # strain of the previous day vs deep sleep
    by_day = {m["dayKey"]: m for m in metrics_list(add_days(to, -history), to)}
    pairs = [((by_day.get(add_days(m["dayKey"], -1)) or {}).get("strain"), m.get("deepMin")) for m in hist_ms]
    corr["strainDeep"] = pearson([a for a, _ in pairs], [b for _, b in pairs])

    hl = highlights(cur, prev, best_bed, best_wake, best_dur, sri, jetlag, outcome, corr, days)
    return {
        "from": frm, "to": to, "days": days, "current": cur, "previous": prev, "outcome": outcome,
        "bedtimeBins": bed_bins, "wakeBins": wake_bins, "durationBins": dur_bins,
        "bestBedtime": best_bed, "bestWake": best_wake, "bestDuration": best_dur,
        "sri": sri, "socialJetlag": jetlag, "midSleepFree": msf, "chronotype": chrono,
        "correlations": corr, "highlights": hl, "historyNights": len(hist_ms),
        "vitals": vitals(to),
    }


def highlights(cur, prev, best_bed, best_wake, best_dur, sri, jetlag, outcome, corr, days) -> list[dict]:
    out = []
    what = "tu recuperación" if outcome == "recovery" else "tu puntuación de sueño"
    unit = " %" if outcome == "recovery" else ""
    pts = " puntos" if outcome == "recovery" else " puntos"
    per = "esta semana" if days <= 7 else f"en los últimos {days} días"
    if cur.get("sleptMin"):
        txt = f"De media has dormido {fmt_hm(cur['sleptMin'])} {per}"
        if prev.get("sleptMin"):
            d = cur["sleptMin"] - prev["sleptMin"]
            if abs(d) >= 5:
                txt += f", {fmt_hm(abs(d))} {'más' if d > 0 else 'menos'} que en el periodo anterior"
        out.append({"icon": "sleep", "cat": "sleep", "title": "Tiempo dormido", "text": txt + "."})
    if best_bed and best_bed['delta'] >= 3:
        out.append({"icon": "bed", "cat": "sleep", "title": "Tu mejor hora para acostarte",
                    "text": f"Cuando te acuestas entre las {best_bed['label'].replace('–', ' y las ')}, {what} media es de "
                            f"{round(best_bed['mean'])}{unit}, {round(best_bed['delta'])}{pts} más que el resto de noches."})
    if best_wake and best_wake['delta'] >= 3:
        out.append({"icon": "sun", "cat": "activity", "title": "Tu mejor hora para levantarte",
                    "text": f"Levantándote entre las {best_wake['label'].replace('–', ' y las ')} {what} media es de "
                            f"{round(best_wake['mean'])}{unit}."})
    if best_dur and best_dur['delta'] >= 3:
        out.append({"icon": "clock", "cat": "sleep", "title": "Lo que te sienta bien",
                    "text": f"Con {best_dur['label'].replace('–', ' a ')} de sueño amaneces mejor: {what} media de "
                            f"{round(best_dur['mean'])}{unit}."})
    if cur.get("bedtimeSD") is not None and cur["nights"] >= 4:
        v = cur["bedtimeSD"]
        tone = "good" if v <= 30 else "warn" if v <= 60 else "bad"
        out.append({"icon": "calendar", "cat": "mind", "title": "Regularidad", "tone": tone,
                    "text": f"Tu hora de acostarte varía ±{round(v)} min"
                            + (f" y tu índice de regularidad es {round(sri)}/100." if sri is not None else ".")
                            + (" Muy constante: así se duerme mejor." if v <= 30 else " Acostarte cada día a una hora parecida mejora el sueño profundo y la recuperación." if v > 45 else "")})
    if jetlag is not None and abs(jetlag) >= 45:
        out.append({"icon": "plane", "cat": "activity", "title": "Jet lag social", "tone": "warn",
                    "text": f"Los fines de semana tu sueño se desplaza {fmt_hm(abs(jetlag))} {'más tarde' if jetlag > 0 else 'antes'}. "
                            "Es como cambiar de huso horario cada semana; reducirlo ayuda a dormirte el domingo."})
    if cur.get("debt") and cur["debt"] >= 120 and days <= 14:
        out.append({"icon": "battery", "cat": "red", "title": "Deuda de sueño", "tone": "bad",
                    "text": f"Acumulas {fmt_hm(cur['debt'])} menos de lo que necesitabas {per}. Adelanta la hora de acostarte unos días."})
    if (c := corr.get("strainDeep")) is not None and c >= 0.3:
        out.append({"icon": "bolt", "cat": "activity", "title": "El esfuerzo te da sueño profundo",
                    "text": "Los días de más esfuerzo duermes más profundo esa noche (correlación "
                            f"{c:.2f}). Tu cuerpo prioriza la recuperación física."})
    if (c := corr.get("durationRecovery")) is not None and c >= 0.3:
        out.append({"icon": "heart", "cat": "green", "title": "Dormir más te recupera",
                    "text": f"En tus datos, dormir más se asocia claramente con mejor recuperación (correlación {c:.2f})."})
    return out
