"""Day analysis pipeline: dirty-day queue → pulso-engine → SQLite → hooks (Telegram, IA)."""
import asyncio
import json
import logging

from . import db
from .config import SAMPLES_DIR
from .core import (add_days, day_bounds, day_key, engine, now, physio, today_key, has_samples_for)

log = logging.getLogger("pulso.analysis")

# Bump when the engine adds or changes per-day metrics: stored days are re-analysed once at startup.
ANALYSIS_VERSION = 3

_event = asyncio.Event()
state = {"running": False, "current": None, "done": 0, "queued": 0, "lastRun": None, "lastError": None}


def metrics_of(r) -> dict:
    return json.loads(r["metrics"]) if r and r["metrics"] else {}


def history_before(key: str, limit: int = 45) -> list[dict]:
    rows = db.q("SELECT metrics FROM days WHERE day_key < ? AND samples > 0 ORDER BY day_key DESC LIMIT ?", (key, limit))
    return [json.loads(r["metrics"]) for r in rows]


def mark_dirty(first_ts: int, last_ts: int) -> list[str]:
    a = day_key(first_ts)
    b = min(day_key(last_ts + 8 * 3600), today_key())
    keys = []
    k = a
    while k <= b:
        keys.append(k)
        k = add_days(k, 1)
    mark_keys(keys)
    return keys


def mark_keys(keys: list[str]) -> None:
    t = now()
    for k in keys:
        s, _ = day_bounds(k)
        db.ex("""INSERT INTO days(day_key, day_start, metrics, updated_at, dirty) VALUES(?,?,?,?,1)
                 ON CONFLICT(day_key) DO UPDATE SET dirty=1""",
              (k, s, json.dumps({"dayKey": k, "dayStart": s}), t))
    _event.set()


async def analyze_day(key: str) -> dict | None:
    s, e = day_bounds(key)
    if not has_samples_for(key):
        db.ex("UPDATE days SET dirty=0 WHERE day_key=?", (key,))
        return None
    res = await engine("analyze", {"dataDir": str(SAMPLES_DIR), "dayKey": key, "dayStart": s, "dayEnd": e,
                                   "now": now(), "profile": physio(), "history": history_before(key)})
    n = res.get("samples", 0)
    rep = res["report"]
    if n < 600:
        db.ex("UPDATE days SET dirty=0, samples=? WHERE day_key=?", (n, key))
        return None
    m = rep["metrics"]
    h = db.one("SELECT steps, active_kcal FROM health WHERE day_key=?", (key,))
    if h and h["steps"] is not None:
        m["steps"] = h["steps"]
    rep["metrics"] = m
    db.ex("""INSERT INTO days(day_key, day_start, metrics, report, updated_at, dirty, samples) VALUES(?,?,?,?,?,0,?)
             ON CONFLICT(day_key) DO UPDATE SET metrics=excluded.metrics, report=excluded.report,
             updated_at=excluded.updated_at, dirty=0, samples=excluded.samples""",
          (key, s, json.dumps(m), json.dumps(rep), now(), n))
    upsert_activities(rep)
    return rep


def upsert_activities(rep: dict) -> None:
    """Auto-detected activities → workouts (or enrich an overlapping imported session)."""
    for a in rep.get("activities", []):
        st = a["strain"]
        lo, hi = a["start"] - 20 * 60, a["end"] + 20 * 60
        overlap = db.q("SELECT * FROM workouts WHERE start < ? AND end > ?", (hi, lo))
        others = [o for o in overlap if o["source"] != "strap"]
        if others:
            o = others[0]
            if o["strain"] is None or o["avg_hr"] is None:
                db.ex("""UPDATE workouts SET strain=?, avg_hr=?, max_hr=?, zones=?, kcal=COALESCE(kcal, ?) WHERE uid=?""",
                      (st["strain"], st.get("avgHR"), st.get("maxHR"), json.dumps(st["zoneSeconds"]), st["kcal"], o["uid"]))
            db.ex("DELETE FROM workouts WHERE source='strap' AND start < ? AND end > ?", (hi, lo))
            continue
        existing = [o for o in overlap if o["source"] == "strap"]
        if existing:
            db.ex("""UPDATE workouts SET start=?, end=?, strain=?, avg_hr=?, max_hr=?, kcal=?, zones=? WHERE uid=?""",
                  (a["start"], a["end"], st["strain"], st.get("avgHR"), st.get("maxHR"), st["kcal"],
                   json.dumps(st["zoneSeconds"]), existing[0]["uid"]))
        else:
            db.ex("""INSERT OR IGNORE INTO workouts(uid, source, start, end, sport, name, strain, avg_hr, max_hr, kcal, zones, created_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (f"strap-{a['start']}", "strap", a["start"], a["end"], "Actividad", "Actividad detectada", st["strain"],
                   st.get("avgHR"), st.get("maxHR"), st["kcal"], json.dumps(st["zoneSeconds"]), now()))
            from . import hooks
            hooks.workout_detected(a)


async def worker() -> None:
    while True:
        await _event.wait()
        _event.clear()
        rows = db.q("SELECT day_key FROM days WHERE dirty=1 ORDER BY day_key")
        if not rows:
            continue
        state.update(running=True, queued=len(rows), done=0, lastError=None)
        reports = []
        for r in rows:
            state["current"] = r["day_key"]
            try:
                rep = await analyze_day(r["day_key"])
                if rep:
                    reports.append(rep)
            except Exception as ex:  # keep the queue alive
                log.exception("analysis %s", r["day_key"])
                state["lastError"] = f"{r['day_key']}: {ex}"
                db.ex("UPDATE days SET dirty=0 WHERE day_key=?", (r["day_key"],))
            state["done"] += 1
        state.update(running=False, current=None, lastRun=now())
        if reports:
            from . import hooks
            try:
                await hooks.after_analysis(reports)
            except Exception:
                log.exception("hooks")


async def reanalyze_all() -> int:
    files = sorted(int(p.stem) for p in SAMPLES_DIR.glob("*.bin") if p.stem.isdigit())
    if not files:
        return 0
    keys = mark_dirty(files[0] * 86400, files[-1] * 86400 + 86399)
    return len(keys)
