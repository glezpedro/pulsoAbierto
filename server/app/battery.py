"""Strap battery history and estimates (time left, time to full, autonomy per charge).

Readings arrive whenever Bluefy is connected: handshake, battery events (code 3), the 60 s poll while
connected and the «Leer batería» button. Between syncs there are no readings, so estimates use the
discharge rate measured since the last charge, falling back to past cycles and then to the WHOOP 4.0
nominal autonomy (≈ 4.5 days).
"""
import json
import statistics as st

from . import db
from .core import now

NOMINAL_LIFE_H = 4.5 * 24          # WHOOP 4.0: 4–5 days per charge
NOMINAL_DISCHARGE = 100 / NOMINAL_LIFE_H   # %/h
NOMINAL_CHARGE = 60.0              # %/h with the battery pack (≈ 1 h 40 min from empty)
FULL = 99.0

db.ex("""CREATE TABLE IF NOT EXISTS battery (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level REAL NOT NULL, charging INTEGER NOT NULL DEFAULT 0,
  mv INTEGER, source TEXT)""")
db.ex("CREATE INDEX IF NOT EXISTS battery_ts ON battery(ts)")
if "raw" not in [r["name"] for r in db.q("PRAGMA table_info(battery)")]:
    db.ex("ALTER TABLE battery ADD COLUMN raw TEXT")     # hex of the strap event, to decode it better later


def record(level, charging, mv=None, source="bluefy", ts=None, raw=None) -> bool:
    """Stores a reading. Skips exact repeats within 10 minutes. Returns True if stored."""
    if level is None:
        return False
    level = max(0.0, min(100.0, float(level)))
    ts = int(ts or now())
    last = db.one("SELECT ts, level, charging FROM battery ORDER BY ts DESC LIMIT 1")
    if last and abs(last["level"] - level) < 0.05 and bool(last["charging"]) == bool(charging) and ts - last["ts"] < 600:
        return False
    db.ex("INSERT INTO battery(ts, level, charging, mv, source, raw) VALUES(?,?,?,?,?,?)",
          (ts, level, 1 if charging else 0, int(mv) if mv else None, source, raw))
    return True


# Open-circuit voltage → state of charge for a single Li-ion/LiPo cell at rest (mV, %). The strap's own
# percentage is unreliable after a reset (it was seen dropping 90 % → 15 % in minutes and showing 3.83 V
# as ~35 %), so whenever the voltage is known the level is derived from it.
OCV = [(3300, 0), (3600, 3), (3690, 8), (3730, 15), (3760, 22), (3790, 32), (3810, 40), (3830, 48), (3850, 55),
       (3870, 60), (3910, 66), (3950, 72), (3980, 77), (4020, 82), (4060, 87), (4100, 92), (4150, 96), (4190, 100)]
CHARGE_SURFACE_MIN = 30        # minutes after unplugging during which the voltage is still inflated
MAX_JUMP = 4.0                 # % accepted between two close readings regardless of time (sensor noise)
MAX_DISCHARGE_H = 6.0          # %/h faster than this while discharging is not physically plausible


def ocv_level(mv) -> float | None:
    """State of charge (%) from the resting voltage, linear between the points of the OCV curve."""
    if not mv or mv < 2500 or mv > 4500:
        return None
    if mv <= OCV[0][0]:
        return 0.0
    for (v0, p0), (v1, p1) in zip(OCV, OCV[1:]):
        if mv <= v1:
            return round(p0 + (p1 - p0) * (mv - v0) / (v1 - v0), 1)
    return 100.0


PACK_WINDOW = 180              # s: a non-charging reading this close to charging readings comes from the pack
GAUGE_TRUST = 10.0             # % of disagreement with the resting-voltage curve beyond which the strap gauge is ignored


def _pack_flags(rows: list[dict]) -> list[bool]:
    """While the battery pack is charging the strap, the strap sends readings of BOTH batteries,
    interleaved: its own (charging) and the pack's (not charging, falling fast). That mix is what made
    the chart jump 90 % → 15 % in minutes and show 3.83 V as ~35 %. A non-charging reading with charging
    readings on both sides within PACK_WINDOW s (or right after one, with a clearly different voltage)
    is the pack's."""
    ch_ts = [r["ts"] for r in rows if r["charging"]]
    flags = []
    import bisect
    for r in rows:
        if r["charging"] or not ch_ts:
            flags.append(False)
            continue
        i = bisect.bisect_left(ch_ts, r["ts"])
        before = ch_ts[i - 1] if i > 0 else None
        after = ch_ts[i] if i < len(ch_ts) else None
        near_b = before is not None and r["ts"] - before <= PACK_WINDOW
        near_a = after is not None and after - r["ts"] <= PACK_WINDOW
        flags.append(near_b and near_a)
    # trailing pack readings (charging just stopped being reported): same voltage family as the pack run
    for i, r in enumerate(rows):
        if flags[i] or r["charging"] or not r.get("mv"):
            continue
        j = i - 1
        while j >= 0 and rows[j]["ts"] >= r["ts"] - PACK_WINDOW and not flags[j]:
            j -= 1
        if j >= 0 and flags[j] and rows[j]["ts"] >= r["ts"] - PACK_WINDOW and rows[j].get("mv") and abs(rows[j]["mv"] - r["mv"]) <= 40:
            flags[i] = True
    return flags


def _incoherent(r: dict, prev: dict | None) -> bool:
    """A voltage that cannot follow the previous strap reading: plugging in the charger always raises the
    voltage, and without a charger it can't rise much or collapse within a couple of minutes."""
    if not prev or not r.get("mv") or not prev.get("mv"):
        return False
    dv, dt = r["mv"] - prev["mv"], r["ts"] - prev["ts"]
    ch, pch = bool(r["charging"]), bool(prev["charging"])
    if ch and not pch and dt < 600 and dv < -50:
        return True                                  # "started charging" but the voltage fell
    if not ch and not pch and dt < 600 and dv > 150:
        return True                                  # big rise without a charger
    if ch == pch and dt < 120 and dv < -250:
        return True                                  # collapse in seconds
    return False


def derive(rows: list[dict]) -> list[dict]:
    """Coherent strap levels for chronological readings. Each row keeps the strap's raw value in
    `reported`, gets `level` (best estimate) and the flags `pack` (reading of the battery pack, not the
    strap) and `outlier` (incoherent voltage). For strap readings:
      · the strap's own gauge is used while it agrees (±GAUGE_TRUST) with the resting-voltage curve;
      · when it does not, or there is no gauge value, the voltage curve wins (not while charging: the
        charger raises the voltage, so there the curve is only an upper bound);
      · a discharge faster than MAX_DISCHARGE_H %/h (beyond sensor noise) is clamped."""
    rows = [dict(r) for r in rows]
    packs = _pack_flags(rows)
    out, last, prev_raw = [], None, None
    for r, is_pack in zip(rows, packs):
        rep = float(r["level"])
        r["reported"] = rep
        r["pack"] = is_pack
        r["outlier"] = False
        if is_pack:
            r["level"] = rep
            out.append(r)
            continue
        if _incoherent(r, prev_raw):
            r["outlier"] = True
            r["level"] = last["level"] if last else rep
            out.append(r)
            continue
        prev_raw = r
        mv, ch = r.get("mv"), bool(r["charging"])
        v = ocv_level(mv) if r.get("source") != "demo" else None
        if v is None:
            lvl = rep
        elif ch:
            lvl = min(rep, v)                         # gauge, never above what the (inflated) voltage allows
        else:
            lvl = rep if abs(rep - v) <= GAUGE_TRUST else v
            if last and not last["charging"]:
                dt_h = max(0.0, (r["ts"] - last["ts"]) / 3600)
                lo = last["level"] - MAX_JUMP - MAX_DISCHARGE_H * dt_h
                hi = last["level"] + MAX_JUMP if dt_h < 1 else 100.0   # a big rise needs a charge (or a gap)
                lvl = min(max(lvl, lo), hi)
        r["level"] = round(max(0.0, min(100.0, lvl)), 1)
        out.append(r)
        last = r
    return out


def pack_level(days: int = 2) -> dict | None:
    """Last reading of the battery pack, if any was seen recently."""
    rows = [dict(r) for r in db.q("SELECT ts, level, charging, mv, source FROM battery WHERE ts > ? ORDER BY ts", (now() - days * 86400,))]
    packs = [r for r, f in zip(derive(rows), _pack_flags(rows)) if f]
    if not packs:
        return None
    p = packs[-1]
    return {"ts": p["ts"], "level": p["reported"], "mv": p.get("mv")}


def readings(days: int = 30) -> list[dict]:
    rows = [dict(r) for r in db.q("SELECT ts, level, charging, mv, source FROM battery WHERE ts > ? ORDER BY ts", (now() - days * 86400,))]
    return [r for r in derive(rows) if not r["outlier"] and not r["pack"]]


def _segments(rs: list[dict], charging: bool) -> list[list[dict]]:
    """Consecutive runs with the same charging state; a discharge run also breaks if the level jumps up
    (charged while Pulso was not looking)."""
    out, cur = [], []
    for r in rs:
        same = bool(r["charging"]) == charging
        jump_up = not charging and cur and r["level"] > cur[-1]["level"] + 2
        if not same or jump_up:
            if len(cur) >= 2:
                out.append(cur)
            cur = [r] if same else []
            continue
        cur.append(r)
    if len(cur) >= 2:
        out.append(cur)
    return out


def _rate(seg: list[dict], charging: bool):
    """%/h over a segment (least squares), or None if it is too short to trust."""
    span_h = (seg[-1]["ts"] - seg[0]["ts"]) / 3600
    delta = abs(seg[-1]["level"] - seg[0]["level"])
    if charging:
        if span_h < 5 / 60 or delta < 2:
            return None
    elif span_h < 2 or delta < 2:
        return None
    xs = [(r["ts"] - seg[0]["ts"]) / 3600 for r in seg]
    ys = [r["level"] for r in seg]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den <= 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    rate = slope if charging else -slope
    if charging:
        return rate if 5 <= rate <= 300 else None
    return rate if 0.2 <= rate <= 10 else None      # 10 h … 20 days per charge


def estimate() -> dict:
    rs = readings(60)
    t = now()
    if not rs:
        dev = db.kv_get("device", {}) or {}
        if dev.get("battery") is None:
            return {"known": False}
        rs = [{"ts": dev.get("seen") or t, "level": float(dev["battery"]), "charging": 1 if dev.get("charging") else 0, "mv": None}]
    last = rs[-1]
    charging = bool(last["charging"])
    age_h = max(0.0, (t - last["ts"]) / 3600)

    dis_segs = _segments(rs, False)
    chg_segs = _segments(rs, True)
    # discharge rate: current run (since last charge) → median of past runs → nominal
    cur_run = dis_segs[-1] if dis_segs and dis_segs[-1][-1]["ts"] == last["ts"] and not charging else None
    past = [r for s in dis_segs if s is not cur_run for r in [_rate(s, False)] if r]
    rate_src = "nominal"
    rate = None
    if cur_run:
        rate = _rate(cur_run, False)
        if rate:
            rate_src = "desde la última carga"
    if not rate and past:
        rate, rate_src = st.median(past), "tus ciclos anteriores"
    if not rate:
        rate = NOMINAL_DISCHARGE
    # blend a short current-run estimate with history for stability
    if rate_src == "desde la última carga" and past and (cur_run[-1]["ts"] - cur_run[0]["ts"]) < 12 * 3600:
        rate = 0.5 * rate + 0.5 * st.median(past)

    crates = [r for s in chg_segs for r in [_rate(s, True)] if r]
    c_rate = crates[-1] if crates else NOMINAL_CHARGE

    if charging:
        est = min(100.0, last["level"] + c_rate * age_h)
    else:
        est = max(0.0, last["level"] - rate * age_h)

    out = {
        "known": True, "level": last["level"], "pack": pack_level(), "estimated": round(est, 1), "charging": charging, "mv": last.get("mv"),
        "lastReading": last["ts"], "readingAgeH": round(age_h, 2),
        "dischargePerHour": round(rate, 3), "dischargePerDay": round(rate * 24, 1), "dischargeSource": rate_src,
        "chargePerHour": round(c_rate, 1), "chargeSource": "medida" if crates else "nominal",
        "fullLifeDays": round(100 / rate / 24, 1),
    }
    if charging:
        mins = max(0.0, (FULL - est) / c_rate * 60)
        out.update(toFullMinutes=round(mins), fullAt=int(t + mins * 60), afterChargeDays=out["fullLifeDays"])
    else:
        hours = est / rate
        out.update(remainingHours=round(hours, 1), emptyAt=int(t + hours * 3600))
    # last charge and real autonomy per cycle (from a ≥ 90 % charge down to the next charge)
    charges = [s[-1] for s in chg_segs]
    jumps = [rs[i] for i in range(1, len(rs)) if not rs[i]["charging"] and rs[i]["level"] > rs[i - 1]["level"] + 15]
    ends = sorted([c["ts"] for c in charges] + [j["ts"] for j in jumps])
    out["lastChargedAt"] = ends[-1] if ends else None
    lives = []
    for s in dis_segs:
        if s[0]["level"] >= 90 and s[-1]["level"] <= 30:
            r = _rate(s, False)
            if r:
                lives.append(100 / r / 24)
    out["avgLifeDays"] = round(st.mean(lives), 1) if lives else None
    out["cycles"] = len(lives)
    conf = "alta" if rate_src == "desde la última carga" and cur_run and (cur_run[-1]["ts"] - cur_run[0]["ts"]) > 12 * 3600 else ("media" if rate_src != "nominal" else "baja")
    out["confidence"] = conf
    return out


def summary_text(e: dict) -> str:
    if not e.get("known"):
        return "Batería desconocida (sincroniza la pulsera)."
    if e["charging"]:
        return f"🔌 Cargando · {e['estimated']:.0f} % · llena en {fmt_h(e['toFullMinutes'] / 60)}"
    return f"🔋 {e['estimated']:.0f} % · quedan ~{fmt_h(e['remainingHours'])}"


def fmt_h(h: float) -> str:
    if h is None:
        return "–"
    if h >= 48:
        d = int(h // 24)
        return f"{d} d {int(round(h - d * 24))} h"
    if h >= 1:
        return f"{int(h)} h {int(round((h % 1) * 60)):02d} min"
    return f"{int(round(h * 60))} min"
