"""Pulso server — FastAPI app (API + static web)."""
import asyncio
import csv
import io
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, battery, db, hooks, raw, reports, strava, telegram
from .config import ALLOWED_LOGINS, DB_PATH, DISABLE_BACKGROUND, RAW_DIR, SAMPLES_DIR, WEB_DIR
from .core import (EngineError, add_days, append_samples_detail, day_bounds, day_key, engine, hr_max, local, now, physio,
                   profile, reset_sample_cache, sample_stats, secret, settings, today_key, week_key, bmr, DEFAULT_PROFILE, DEFAULT_SETTINGS)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pulso")


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = []
    if not DISABLE_BACKGROUND:
        tasks = [asyncio.create_task(analysis.worker()), asyncio.create_task(telegram.loop()),
                 asyncio.create_task(hooks.scheduler())]
    # the engine computes more per day than before → re-analyse stored days once (in the background)
    if db.kv_get("analysis_version") != analysis.ANALYSIS_VERSION:
        n = await analysis.reanalyze_all()
        db.kv_set("analysis_version", analysis.ANALYSIS_VERSION)
        if n:
            log.info("análisis v%s: re-analizando %d días", analysis.ANALYSIS_VERSION, n)
    # second-hand strap: move the previous owner's samples (stored before the filter was on) out of the way
    try:
        raw.purge_previous_owner()
    except Exception:  # noqa: BLE001
        log.exception("no se pudo limpiar los datos del dueño anterior")
    # resume interrupted work
    if db.one("SELECT 1 FROM days WHERE dirty=1"):
        analysis._event.set()
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Pulso", lifespan=lifespan)


def _public(request: Request) -> bool:
    """Routes reachable without a Tailscale login: the liveness probe (container HEALTHCHECK and
    Uptime Kuma call it from 127.0.0.1 without headers; it only returns {"ok": true}) and the
    Strava OAuth callback. Exact path + method match, so /api/health/* and /api/status stay protected."""
    path, method = request.url.path, request.method
    return (method == "GET" and path == "/api/health") or path == "/api/strava/callback"


@app.middleware("http")
async def tailnet_guard(request: Request, call_next):
    if ALLOWED_LOGINS and request.url.path.startswith("/api") and not _public(request):
        login = (request.headers.get("Tailscale-User-Login") or "").lower()
        if login not in ALLOWED_LOGINS:
            return JSONResponse({"detail": "No autorizado"}, status_code=403)
    return await call_next(request)


def jload(s, default=None):
    return json.loads(s) if s else default

# ===================================================================== status & settings

@app.get("/api/status")
async def status():
    s = settings()
    return {
        "now": now(), "today": today_key(), "tz": local(now()).tzname(),
        "analysis": analysis.state, "lastSync": db.kv_get("last_sync_ts"), "device": db.kv_get("device", {}),
        "samples": sample_stats(), "telegram": {"configured": bool(telegram.token()), "paired": bool(telegram.chat_id()),
                                                 "running": telegram.state["running"], "username": telegram.state["username"],
                                                 "error": telegram.state["lastError"]},
        "strava": {"connected": strava.connected(), "athlete": strava.cfg().get("athlete"), "clientId": strava.cfg().get("client_id", ""),
                   "hasSecret": bool(strava.cfg().get("client_secret")), "lastImport": strava.cfg().get("last_import"),
                   "redirect": strava.REDIRECT},
        "hasAnthropic": bool(secret("anthropic")), "settings": s, "profile": profile(), "hrMax": hr_max(), "bmr": bmr(),
        "physio": physio(), "dirty": db.one("SELECT COUNT(*) c FROM days WHERE dirty=1")["c"],
        "discardedPrevious": db.kv_get("discarded_previous", 0) or 0,
        "purge": db.kv_get("purge_info"), "raw": raw.stats(),
        "battery": battery.estimate(),
    }


@app.put("/api/profile")
async def put_profile(p: dict = Body(...)):
    cur = profile()
    cur.update({k: v for k, v in p.items() if k in DEFAULT_PROFILE})
    db.kv_set("profile", cur)
    return cur


@app.put("/api/settings")
async def put_settings(p: dict = Body(...)):
    cur = settings()
    cur.update({k: v for k, v in p.items() if k in DEFAULT_SETTINGS})
    db.kv_set("settings", cur)
    return cur


@app.put("/api/secrets")
async def put_secrets(p: dict = Body(...)):
    for k in ("anthropic", "telegram_token"):
        if k in p:
            v = (p[k] or "").strip()
            if v:
                db.kv_set(f"secret:{k}", v)
            else:
                db.kv_del(f"secret:{k}")
            if k == "telegram_token":
                telegram.state.update(username=None, running=False)
    return {"ok": True}

# ===================================================================== sync from Bluefy

def _after_store(d: dict, source: str = "bluefy") -> list[str]:
    """Book-keeping after records were appended: sync log, discard counter and days to re-analyse."""
    discarded = d["received"] - d["stored"]
    if d["reasons"].get("beforeFilter"):
        db.kv_set("discarded_previous", (db.kv_get("discarded_previous", 0) or 0) + d["reasons"]["beforeFilter"])
    if discarded:
        log.info("registros descartados: %s", d["reasons"])
    if not d["stored"]:
        return []
    db.ex("INSERT INTO sync_log(ts, records, first_ts, last_ts, source) VALUES(?,?,?,?,?)", (now(), d["stored"], d["first"], d["last"], source))
    db.kv_set("last_sync_ts", now())
    return analysis.mark_dirty(d["first"], d["last"])


@app.post("/api/samples")
async def post_samples(request: Request):
    blob = await request.body()
    try:
        d = await asyncio.to_thread(append_samples_detail, blob)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    days = _after_store(d)
    return {"stored": d["stored"], "discarded": d["received"] - d["stored"], "reasons": d["reasons"], "first": d["first"], "last": d["last"], "days": days}


@app.post("/api/chunk")
async def post_chunk(p: dict = Body(...)):
    """One history chunk from Bluefy: raw bytes (base64) + decoded samples (base64) + diagnosis. The raw
    chunk is on disk before this returns `rawSaved: true`; only then does the web acknowledge it."""
    try:
        res = await asyncio.to_thread(raw.save_chunk, p.get("raw"), p.get("samples"), p.get("meta") or {})
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if not res.get("duplicate"):
        d = {"received": res["stored"] + res["discarded"], "stored": res["stored"], "first": res["first"], "last": res["last"], "reasons": res["reasons"]}
        res["days"] = _after_store(d)
    return res


@app.get("/api/raw")
async def raw_list(limit: int = 200, unstored: int = 0, days: int | None = None):
    return {"stats": raw.stats(), "items": raw.listing(min(max(limit, 1), 10000), bool(unstored), days)}


@app.get("/api/raw/{chunk_id}")
async def raw_get(chunk_id: int):
    path = raw.chunk_path(chunk_id)
    if not path or not path.exists():
        raise HTTPException(404, "bloque no encontrado")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@app.post("/api/raw/{chunk_id}/samples")
async def raw_samples(chunk_id: int, request: Request):
    blob = await request.body()
    try:
        d = await asyncio.to_thread(raw.add_samples, chunk_id, blob)
    except KeyError:
        raise HTTPException(404, "bloque no encontrado")
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    days = _after_store(d, "reproceso")
    return {"stored": d["stored"], "discarded": d["received"] - d["stored"], "reasons": d["reasons"], "days": days}


@app.post("/api/device")
async def post_device(p: dict = Body(...)):
    d = db.kv_get("device", {}) or {}
    d.update({k: v for k, v in p.items() if v is not None and k not in ("raw", "source")})
    d["seen"] = now()
    db.kv_set("device", d)
    if p.get("battery") is not None:
        battery.record(p["battery"], bool(p.get("charging")), p.get("mv"), p.get("source") or "bluefy", raw=p.get("raw"))
    if p.get("battery") is not None:
        e = battery.estimate()      # the coherent strap level (pack readings and outliers filtered out)
        if e.get("known"):
            hooks.battery_check(e.get("estimated"), bool(e.get("charging")))
    return d


@app.get("/api/battery")
async def get_battery(days: int = 14):
    e = battery.estimate()
    e["history"] = battery.readings(days)
    return e


@app.post("/api/events")
async def post_events(items: list = Body(...)):
    db.many("INSERT INTO events(ts, code, label, detail) VALUES(?,?,?,?)",
            [(int(e.get("ts") or now()), e.get("code"), e.get("label", ""), e.get("detail", "")) for e in items])
    return {"ok": True, "n": len(items)}


@app.get("/api/events")
async def get_events(limit: int = 100):
    return [dict(r) for r in db.q("SELECT * FROM events ORDER BY ts DESC LIMIT ?", (limit,))]


@app.get("/api/sync/log")
async def sync_log(limit: int = 50):
    return [dict(r) for r in db.q("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?", (limit,))]

# ===================================================================== days & analytics

@app.get("/api/days")
async def get_days(frm: str | None = None, to: str | None = None, days: int = 30):
    to = to or today_key()
    frm = frm or add_days(to, -days + 1)
    return reports.metrics_list(frm, to)


@app.get("/api/day/{key}")
async def get_day(key: str):
    r = db.one("SELECT * FROM days WHERE day_key=?", (key,))
    j = db.one("SELECT * FROM journal WHERE day_key=?", (key,))
    s, e = day_bounds(key)
    ws = [dict(w) for w in db.q("SELECT uid, source, start, end, sport, name, strain, avg_hr, kcal FROM workouts WHERE start >= ? AND start < ? ORDER BY start", (s, e))]
    ev = [dict(x) for x in db.q("SELECT ts, code, label FROM events WHERE ts >= ? AND ts < ? ORDER BY ts", (s, e))]
    base = reports.metrics_list(add_days(key, -30), add_days(key, -1))
    return {"key": key, "metrics": jload(r["metrics"], {}) if r else {}, "report": jload(r["report"]) if r else None,
            "ai": r["ai"] if r else None, "aiAt": r["ai_at"] if r else None, "dirty": bool(r["dirty"]) if r else False,
            "samples": r["samples"] if r else 0, "journal": {"answers": jload(j["answers"], {}), "notes": j["notes"]} if j else None,
            "workouts": ws, "events": ev, "baseline": base}


@app.post("/api/day/{key}/ai")
async def day_ai(key: str):
    from . import coach
    try:
        txt = await coach.daily_analysis(key)
    except Exception as ex:
        raise HTTPException(400, str(ex))
    db.ex("UPDATE days SET ai=?, ai_at=? WHERE day_key=?", (txt, now(), key))
    return {"ai": txt, "aiAt": now()}


@app.post("/api/analyze")
async def analyze(p: dict = Body(default={})):
    if p.get("all"):
        return {"queued": await analysis.reanalyze_all()}
    keys = p.get("keys") or [add_days(today_key(), -1), today_key()]
    analysis.mark_keys(keys)
    return {"queued": len(keys)}


@app.get("/api/sleep/nights")
async def sleep_nights(frm: str | None = None, to: str | None = None, days: int = 7):
    from . import sleepinsights
    to = to or today_key()
    frm = frm or add_days(to, -min(max(days, 1), 62) + 1)
    return sleepinsights.nights(frm, to)


@app.get("/api/sleep/insights")
async def sleep_insights(to: str | None = None, days: int = 30):
    from . import sleepinsights
    days = min(max(days, 1), 366)
    return sleepinsights.insights(to, days, history=max(120, days))


@app.get("/api/series")
async def series(frm: int, to: int, step: int = 300):
    if to - frm > 40 * 86400:
        raise HTTPException(400, "rango demasiado grande")
    return await engine("series", {"dataDir": str(SAMPLES_DIR), "from": frm, "to": to, "step": max(60, step)})


@app.get("/api/load")
async def load(days: int = 90):
    ls = reports.load_series(days)
    return {"series": ls, "status": reports.load_status(ls[-1]["acwr"] if ls else None)}


@app.get("/api/records")
async def get_records():
    return reports.records()


@app.get("/api/insights")
async def get_insights():
    return reports.insights()


@app.get("/api/weekly")
async def weekly_list():
    rows = db.q("SELECT week_key, ai IS NOT NULL has_ai, created FROM weekly ORDER BY week_key DESC")
    first = db.one("SELECT MIN(day_key) k FROM days WHERE samples > 0")
    weeks = []
    if first and first["k"]:
        k = week_key(today_key())
        stop = week_key(first["k"])
        while k >= stop and len(weeks) < 104:
            weeks.append(k)
            from .core import week_days
            k = week_key(add_days(week_days(k)[0], -1))
    return {"weeks": weeks, "stored": [dict(r) for r in rows]}


@app.get("/api/weekly/{wkey}")
async def weekly_get(wkey: str):
    rep = reports.weekly_report(wkey)
    w = db.one("SELECT ai, created FROM weekly WHERE week_key=?", (wkey,))
    rep["ai"] = w["ai"] if w else None
    return rep


@app.post("/api/weekly/{wkey}/ai")
async def weekly_ai(wkey: str):
    from . import coach
    rep = reports.weekly_report(wkey)
    try:
        txt = await coach.weekly_narrative(rep)
    except Exception as ex:
        raise HTTPException(400, str(ex))
    db.ex("""INSERT INTO weekly(week_key, start, report, ai, created) VALUES(?,?,?,?,?)
             ON CONFLICT(week_key) DO UPDATE SET ai=excluded.ai, report=excluded.report""", (wkey, now(), json.dumps(rep), txt, now()))
    return {"ai": txt}


@app.post("/api/weekly/{wkey}/send")
async def weekly_send(wkey: str):
    ok = await telegram.send(telegram.week_text(wkey))
    return {"sent": ok}

# ===================================================================== workouts

def workout_dict(r) -> dict:
    d = dict(r)
    d["zones"] = jload(d.get("zones"), [])
    d["strong"] = jload(d.get("strong"))
    return d


@app.get("/api/workouts")
async def workouts(days: int = 120, source: str | None = None):
    sql, args = "SELECT * FROM workouts WHERE start > ?", [now() - days * 86400]
    if source:
        sql += " AND source=?"
        args.append(source)
    return [workout_dict(r) for r in db.q(sql + " ORDER BY start DESC", args)]


@app.get("/api/workouts/{uid}")
async def workout(uid: str):
    r = db.one("SELECT * FROM workouts WHERE uid=?", (uid,))
    if not r:
        raise HTTPException(404)
    w = workout_dict(r)
    try:
        w["series"] = await engine("series", {"dataDir": str(SAMPLES_DIR), "from": w["start"] - 300, "to": w["end"] + 300, "step": 60})
    except EngineError:
        w["series"] = []
    return w


@app.post("/api/workouts")
async def add_workout(p: dict = Body(...)):
    uid = p.get("uid") or f"{p.get('source', 'manual')}-{p['start']}"
    db.ex("""INSERT OR REPLACE INTO workouts(uid, source, start, end, sport, name, strain, avg_hr, max_hr, kcal, distance_km, notes, zones, created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (uid, p.get("source", "manual"), int(p["start"]), int(p["end"]), p.get("sport", "Entrenamiento"), p.get("name", "Entrenamiento"),
           p.get("strain"), p.get("avgHR"), p.get("maxHR"), p.get("kcal"), p.get("distanceKm"), p.get("notes", ""),
           json.dumps(p.get("zones") or []), now()))
    if p.get("strain") is None:
        await recompute(uid)
    return workout_dict(db.one("SELECT * FROM workouts WHERE uid=?", (uid,)))


@app.put("/api/workouts/{uid}")
async def edit_workout(uid: str, p: dict = Body(...)):
    for k in ("name", "notes", "sport"):
        if k in p:
            db.ex(f"UPDATE workouts SET {k}=? WHERE uid=?", (p[k], uid))
    return workout_dict(db.one("SELECT * FROM workouts WHERE uid=?", (uid,)))


@app.delete("/api/workouts/{uid}")
async def del_workout(uid: str):
    db.ex("DELETE FROM workouts WHERE uid=?", (uid,))
    return {"ok": True}


@app.post("/api/workouts/{uid}/recompute")
async def recompute(uid: str):
    w = db.one("SELECT * FROM workouts WHERE uid=?", (uid,))
    if not w:
        raise HTTPException(404)
    m = jload((db.one("SELECT metrics FROM days WHERE day_key=?", (day_key(w["start"]),)) or {"metrics": "{}"})["metrics"], {})
    st = await engine("strain", {"dataDir": str(SAMPLES_DIR), "from": w["start"], "to": w["end"], "profile": physio(),
                                 "restingHR": m.get("rhr") or 60})
    if st.get("coveredSeconds", 0) > 120:
        db.ex("UPDATE workouts SET strain=?, avg_hr=?, max_hr=?, zones=?, kcal=COALESCE(kcal, ?) WHERE uid=?",
              (st["strain"], st.get("avgHR"), st.get("maxHR"), json.dumps(st["zoneSeconds"]), st["kcal"], uid))
    return workout_dict(db.one("SELECT * FROM workouts WHERE uid=?", (uid,)))


@app.post("/api/workouts/{uid}/strava")
async def workout_to_strava(uid: str):
    r = db.one("SELECT * FROM workouts WHERE uid=?", (uid,))
    if not r:
        raise HTTPException(404)
    w = dict(r)
    try:
        aid = await strava.upload_workout(w, strava.describe(w))
    except Exception as ex:
        raise HTTPException(400, str(ex))
    db.ex("UPDATE workouts SET strava_id=?, strava_uploaded=1 WHERE uid=?", (aid, uid))
    return {"stravaId": aid}


async def import_strong_text(text: str) -> dict:
    """Parses a Strong CSV export and merges it into workouts (idempotent: re-importing the full
    export only adds new sessions). Overlapping strap/live/health records donate their HR data."""
    text = text.lstrip("\ufeff")
    if not text.strip():
        raise HTTPException(400, "El archivo está vacío.")
    try:
        ws = await engine("strong", {"csv": text, "unit": settings()["strongUnit"]})
    except EngineError as ex:
        raise HTTPException(400, f"No parece un CSV de Strong: {ex}")
    added = 0
    new_names = []
    for sw in ws:
        start = int(sw["date"])
        end = start + max(int(sw.get("durationSeconds") or 0), 1800)
        uid = f"strong-{start}-{sw['name']}"
        if db.one("SELECT 1 FROM workouts WHERE uid=?", (uid,)):
            db.ex("UPDATE workouts SET strong=?, end=? WHERE uid=?", (json.dumps(sw), end, uid))
            continue
        lo, hi = start - 900, end + 900
        strain = avg = mx = zones = kcal = None
        for o in db.q("SELECT * FROM workouts WHERE start < ? AND end > ? AND source IN ('strap','health','live')", (hi, lo)):
            strain = strain or o["strain"]; avg = avg or o["avg_hr"]; mx = mx or o["max_hr"]; zones = zones or o["zones"]; kcal = kcal or o["kcal"]
            db.ex("DELETE FROM workouts WHERE uid=?", (o["uid"],))
        db.ex("""INSERT INTO workouts(uid, source, start, end, sport, name, strain, avg_hr, max_hr, kcal, notes, zones, strong, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (uid, "strong", start, end, "Fuerza", sw["name"], strain, avg, mx, kcal, sw.get("notes", ""), zones, json.dumps(sw), now()))
        added += 1
        new_names.append(f"{sw['name']} ({local(start).strftime('%d/%m')})")
        if strain is None:
            try:
                await recompute(uid)
            except Exception:
                pass
    if added == 0:
        msg = f"Strong: sin entrenos nuevos ({len(ws)} en el archivo)."
    else:
        shown = ", ".join(new_names[-3:]) + ("…" if added > 3 else "")
        msg = f"Strong: {added} entreno{'s' if added != 1 else ''} nuevo{'s' if added != 1 else ''} de {len(ws)} · {shown}"
    return {"added": added, "total": len(ws), "message": msg}


@app.post("/api/strong/import")
async def strong_import(file: UploadFile = File(...)):
    """Upload from the web (multipart form, field «file»)."""
    return await import_strong_text((await file.read()).decode("utf-8", errors="replace"))


@app.post("/api/strong/import-raw")
async def strong_import_raw(request: Request):
    """Upload from the iOS Shortcut «Enviar a Pulso»: the CSV file as the raw request body
    (any content type). Also accepts multipart with any file field, in case the Shortcut uses «Formulario»."""
    ct = request.headers.get("content-type", "")
    if ct.startswith("multipart/form-data"):
        form = await request.form()
        up = next((v for v in form.values() if hasattr(v, "read")), None)
        if up is None:
            raise HTTPException(400, "No llegó ningún archivo.")
        raw = await up.read()
    else:
        raw = await request.body()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(413, "Archivo demasiado grande.")
    return await import_strong_text(raw.decode("utf-8", errors="replace"))


@app.get("/api/strong/stats")
async def strong_stats():
    ws = [json.loads(r["strong"]) for r in db.q("SELECT strong FROM workouts WHERE strong IS NOT NULL ORDER BY start")]
    if not ws:
        return {"progress": [], "records": [], "weeklySets": {}, "oneRepMaxes": {}, "weeklyVolume": []}
    st = await engine("strong-stats", {"workouts": ws, "now": now()})
    vol: dict[str, float] = {}
    for w in ws:
        wk = week_key(day_key(w["date"]))
        vol[wk] = vol.get(wk, 0) + sum(s["weightKg"] * s["reps"] for s in w["sets"] if (s.get("setType") or "").upper() != "W")
    st["weeklyVolume"] = [{"week": k, "kg": v} for k, v in sorted(vol.items())]
    return st

# ===================================================================== plans

@app.get("/api/plans")
async def plans():
    return [{"id": r["id"], "created": r["created"], "active": bool(r["active"]), "plan": json.loads(r["plan"])}
            for r in db.q("SELECT * FROM plans ORDER BY created DESC")]


@app.post("/api/plans/generate")
async def plan_generate(p: dict = Body(...)):
    req = p["request"]
    req.setdefault("notes", "")
    req.setdefault("priorityMuscles", [])
    start = p.get("startDate") or next_monday()
    if p.get("ai"):
        from . import coach
        try:
            plan = await coach.ai_plan(req, p.get("extra", ""), start)
        except Exception as ex:
            raise HTTPException(400, str(ex))
    else:
        st = await strong_stats()
        plan = await engine("plan", {"request": req, "startDate": start, "oneRepMaxes": st.get("oneRepMaxes", {})})
    return plan


def next_monday() -> int:
    import datetime as dt
    d = local(now()).date()
    d = d + dt.timedelta(days=(7 - d.weekday()) % 7)
    return day_bounds(d.isoformat())[0]


@app.post("/api/plans")
async def plan_save(plan: dict = Body(...)):
    pid = plan.get("id") or str(uuid.uuid4()).upper()
    plan["id"] = pid
    db.ex("UPDATE plans SET active=0")
    db.ex("INSERT OR REPLACE INTO plans(id, created, active, plan) VALUES(?,?,1,?)", (pid, now(), json.dumps(plan)))
    return {"id": pid}


@app.post("/api/plans/{pid}/activate")
async def plan_activate(pid: str):
    db.ex("UPDATE plans SET active=0")
    db.ex("UPDATE plans SET active=1 WHERE id=?", (pid,))
    return {"ok": True}


@app.delete("/api/plans/{pid}")
async def plan_delete(pid: str):
    db.ex("DELETE FROM plans WHERE id=?", (pid,))
    return {"ok": True}


def session_for(plan: dict, key: str) -> tuple[dict, dict] | None:
    s0 = int(plan["startDate"])
    ds, _ = day_bounds(key)
    diff = (local(ds).date() - local(s0).date()).days
    if diff < 0 or diff // 7 >= len(plan["weeks"]):
        return None
    wk = plan["weeks"][diff // 7]
    wd = local(ds).isoweekday()
    for s in wk["sessions"]:
        if s["weekday"] == wd:
            return wk, s
    return None


@app.get("/api/plan/today")
async def plan_today(key: str | None = None):
    key = key or today_key()
    r = db.one("SELECT plan FROM plans WHERE active=1")
    if not r:
        return {"plan": None}
    plan = json.loads(r["plan"])
    found = session_for(plan, key)
    if not found:
        return {"plan": plan["name"], "rest": True}
    wk, s = found
    m = jload((db.one("SELECT metrics FROM days WHERE day_key=?", (key,)) or {"metrics": "{}"})["metrics"], {})
    a = await engine("adapt", {"session": s, "recovery": m.get("recovery")})
    return {"plan": plan["name"], "week": wk["index"] + 1, "phase": wk["phase"], "original": s, "adapted": a["session"],
            "note": a["note"], "band": a["band"], "recovery": m.get("recovery")}


async def today_session_text() -> str:
    t = await plan_today()
    if not t.get("plan"):
        return "No tienes plan activo. Créalo en Pulso › Entreno."
    if t.get("rest"):
        return f"Hoy toca descanso en «{t['plan']}». Paseo, movilidad y buen sueño."
    s = t["adapted"]
    lines = [f"**🏋️ {s['title']}** (semana {t['week']}, {t['phase']})", t["note"]]
    for e in s.get("exercises", []):
        lines.append(f"• {e['name']} {e['sets']}×{e['reps']} RIR {e['rir']}" + (f" · ~{e['suggestedKg']:g} kg" if e.get("suggestedKg") else ""))
    if s.get("cardio"):
        lines.append(f"• {s['cardio']['description']}")
    return "\n".join(lines)

# ===================================================================== body, journal, spot checks

BODY_FIELDS = ["weight_kg", "body_fat", "waist", "chest", "hips", "neck", "arm", "thigh", "calf"]


@app.get("/api/body")
async def body():
    return [dict(r) for r in db.q("SELECT * FROM body ORDER BY date DESC")]


@app.post("/api/body")
async def body_add(p: dict = Body(...)):
    vals = [p.get(f) for f in BODY_FIELDS]
    bid = db.ex(f"INSERT INTO body(date, {', '.join(BODY_FIELDS)}, notes) VALUES(?{', ?' * len(BODY_FIELDS)}, ?)",
                [int(p.get("date") or now()), *vals, p.get("notes", "")])
    if p.get("weight_kg"):
        pr = profile()
        pr["weightKg"] = float(p["weight_kg"])
        db.kv_set("profile", pr)
    return {"id": bid}


@app.delete("/api/body/{bid}")
async def body_del(bid: int):
    db.ex("DELETE FROM body WHERE id=?", (bid,))
    return {"ok": True}


@app.get("/api/journal/questions")
async def journal_questions():
    return [{"key": k, "text": t, "short": s} for k, t, s in reports.JOURNAL_QUESTIONS]


@app.get("/api/journal")
async def journal(days: int = 30):
    return [{"day": r["day_key"], "answers": json.loads(r["answers"]), "notes": r["notes"]}
            for r in db.q("SELECT * FROM journal WHERE day_key >= ? ORDER BY day_key DESC", (add_days(today_key(), -days),))]


@app.put("/api/journal/{key}")
async def journal_put(key: str, p: dict = Body(...)):
    db.ex("""INSERT INTO journal(day_key, answers, notes, updated_at) VALUES(?,?,?,?)
             ON CONFLICT(day_key) DO UPDATE SET answers=excluded.answers, notes=excluded.notes, updated_at=excluded.updated_at""",
          (key, json.dumps(p.get("answers", {})), p.get("notes", ""), now()))
    return {"ok": True}


@app.get("/api/journal/impact")
async def journal_impact():
    return reports.journal_impact()


@app.post("/api/spot")
async def spot(p: dict = Body(...)):
    kind = p.get("kind", "hrv")
    res = await engine("hrv", {"rr": [float(x) for x in p.get("rr", [])]})
    if "error" in res:
        raise HTTPException(400, res["error"])
    res.update({k: p[k] for k in ("position", "notes", "durationSec") if k in p})
    sid = db.ex("INSERT INTO spot(ts, kind, data) VALUES(?,?,?)", (now(), kind, json.dumps(res)))
    return {"id": sid, **res}


@app.get("/api/spot")
async def spot_list(limit: int = 60):
    return [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], **json.loads(r["data"])} for r in db.q("SELECT * FROM spot ORDER BY ts DESC LIMIT ?", (limit,))]

# ===================================================================== coach chat

@app.get("/api/chat")
async def chat_history(limit: int = 100):
    return [dict(r) for r in reversed(db.q("SELECT * FROM chat ORDER BY id DESC LIMIT ?", (limit,)))]


@app.delete("/api/chat")
async def chat_clear():
    db.ex("DELETE FROM chat")
    return {"ok": True}


@app.post("/api/chat")
async def chat(p: dict = Body(...)):
    from . import coach
    text = (p.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "vacío")
    hist = [{"role": r["role"], "content": r["text"]} for r in reversed(db.q("SELECT role, text FROM chat ORDER BY id DESC LIMIT 20"))]
    while hist and hist[0]["role"] != "user":
        hist.pop(0)
    hist.append({"role": "user", "content": text})
    db.ex("INSERT INTO chat(ts, role, text) VALUES(?,?,?)", (now(), "user", text))
    system = coach.chat_system()

    async def gen():
        full = []
        try:
            async for t in coach.stream(system, hist, 16000, "medium"):
                full.append(t)
                yield f"data: {json.dumps({'t': t})}\n\n"
            db.ex("INSERT INTO chat(ts, role, text) VALUES(?,?,?)", (now(), "assistant", "".join(full)))
            yield "data: {\"done\": true}\n\n"
        except Exception as ex:
            yield f"data: {json.dumps({'error': str(ex)})}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ===================================================================== telegram

@app.get("/api/telegram")
async def tg_status():
    return {"configured": bool(telegram.token()), "paired": bool(telegram.chat_id()), "username": telegram.state["username"],
            "running": telegram.state["running"], "error": telegram.state["lastError"],
            "code": None if telegram.chat_id() else telegram.pairing_code()}


@app.post("/api/telegram/test")
async def tg_test():
    ok = await telegram.send(telegram.today_text())
    if not ok:
        raise HTTPException(400, telegram.state["lastError"] or "No vinculado")
    return {"ok": True}


@app.post("/api/telegram/unlink")
async def tg_unlink():
    db.kv_del("secret:telegram_chat")
    return {"ok": True}

# ===================================================================== strava

@app.put("/api/strava/config")
async def strava_config(p: dict = Body(...)):
    c = strava.cfg()
    if p.get("client_id") is not None:
        c["client_id"] = str(p["client_id"]).strip()
    if p.get("client_secret"):
        c["client_secret"] = p["client_secret"].strip()
    strava.save(c)
    return {"ok": True}


@app.get("/api/strava/authorize")
async def strava_authorize():
    try:
        return {"url": strava.authorize_url()}
    except Exception as ex:
        raise HTTPException(400, str(ex))


@app.get("/api/strava/callback")
async def strava_callback(code: str | None = None, error: str | None = None):
    if error or not code:
        return RedirectResponse("/#/ajustes?strava=error")
    try:
        await strava.exchange(code)
        await strava.import_recent(60)
    except Exception as ex:
        log.warning("strava callback: %s", ex)
        return RedirectResponse("/#/ajustes?strava=error")
    return RedirectResponse("/#/ajustes?strava=ok")


@app.post("/api/strava/import")
async def strava_import():
    try:
        new = await strava.import_recent(60)
    except Exception as ex:
        raise HTTPException(400, str(ex))
    return {"added": len(new)}


@app.post("/api/strava/disconnect")
async def strava_disconnect():
    c = strava.cfg()
    for k in ("access_token", "refresh_token", "expires_at", "athlete"):
        c.pop(k, None)
    strava.save(c)
    return {"ok": True}

# ===================================================================== Apple Health via Shortcuts

@app.post("/api/health/ingest")
async def health_ingest(p: dict = Body(...)):
    key = p.get("date") or today_key()
    key = str(key)[:10]
    def num(v):
        try:
            return float(str(v).replace(",", ".")) if v not in (None, "") else None
        except ValueError:
            return None
    steps, kcal, w = num(p.get("steps")), num(p.get("activeKcal")), num(p.get("weightKg"))
    db.ex("""INSERT INTO health(day_key, steps, active_kcal, weight_kg, data, updated_at) VALUES(?,?,?,?,?,?)
             ON CONFLICT(day_key) DO UPDATE SET steps=COALESCE(excluded.steps, health.steps),
             active_kcal=COALESCE(excluded.active_kcal, health.active_kcal), weight_kg=COALESCE(excluded.weight_kg, health.weight_kg),
             data=excluded.data, updated_at=excluded.updated_at""", (key, steps, kcal, w, json.dumps(p), now()))
    if steps is not None:
        r = db.one("SELECT metrics, report FROM days WHERE day_key=?", (key,))
        if r:
            m = json.loads(r["metrics"]); m["steps"] = steps
            rep = jload(r["report"])
            if rep:
                rep["metrics"]["steps"] = steps
            db.ex("UPDATE days SET metrics=?, report=? WHERE day_key=?", (json.dumps(m), json.dumps(rep) if rep else None, key))
    if w:
        last = db.one("SELECT date, weight_kg FROM body ORDER BY date DESC LIMIT 1")
        if not last or abs((last["weight_kg"] or 0) - w) > 0.05 or now() - last["date"] > 86400:
            db.ex("INSERT INTO body(date, weight_kg, notes) VALUES(?,?,?)", (now(), w, "Apple Salud"))
            pr = profile(); pr["weightKg"] = w; db.kv_set("profile", pr)
    return {"ok": True, "day": key}


def _hk_date(ts: int) -> str:
    """Local time as text that Shortcuts converts to a date reliably."""
    return local(ts).strftime("%Y-%m-%d %H:%M:%S")


@app.get("/api/health/export")
async def health_export(day: str | None = None):
    """Data for the iOS Shortcut «Pulso a Salud», which writes it into Apple Health.

    Sleep stages come as four separate lists so each Shortcut loop can use a fixed stage value."""
    key = (day or "").strip()[:10] or today_key()
    r = db.one("SELECT metrics, report FROM days WHERE day_key=?", (key,))
    m = jload(r["metrics"], {}) if r else {}
    rep = jload(r["report"]) if r and r["report"] else None
    out = {"day": key, "hasData": bool(rep), "alreadyExported": key in (db.kv_get("health_exported", {}) or {}),
           "restingHR": m.get("rhr"), "respiratoryRate": round(m["resp"], 1) if m.get("resp") else None,
           "activeKcal": round(m["activeKcal"]) if m.get("activeKcal") else None,
           "spo2": round(m["spo2"], 1) if m.get("spo2") and settings().get("showSpO2") else None,
           "sleepDeep": [], "sleepCore": [], "sleepREM": [], "sleepAwake": [], "inBed": [], "heartRate": []}
    if not rep:
        return out
    s0, _ = day_bounds(key)
    out["date"] = _hk_date(min(now(), s0 + 12 * 3600))
    sl = rep.get("sleep")
    if sl:
        out["wake"] = _hk_date(sl["end"])
        out["bedtime"] = _hk_date(sl["start"])
        out["inBed"] = [{"start": _hk_date(sl["start"]), "end": _hk_date(sl["end"])}]
        names = {0: "sleepAwake", 1: "sleepCore", 2: "sleepDeep", 3: "sleepREM"}
        st, i = sl["stages"], 0
        while i < len(st):
            j = i
            while j + 1 < len(st) and st[j + 1] == st[i]:
                j += 1
            out[names[st[i]]].append({"start": _hk_date(sl["start"] + i * 60), "end": _hk_date(sl["start"] + (j + 1) * 60)})
            i = j + 1
    else:
        out["wake"] = out["date"]
    # heart rate every 10 minutes (Shortcuts writes one sample per loop; 10 min keeps it fast)
    buckets = rep.get("hrTimeline") or []
    for k in range(0, len(buckets), 2):
        grp = buckets[k:k + 2]
        out["heartRate"].append({"value": round(sum(b["avg"] for b in grp) / len(grp)), "date": _hk_date(grp[0]["ts"])})
    out["counts"] = {k: len(out[k]) for k in ("sleepDeep", "sleepCore", "sleepREM", "sleepAwake", "heartRate")}
    return out


@app.post("/api/health/exported")
async def health_exported(p: dict = Body(default={})):
    key = (str(p.get("day") or "").strip()[:10]) or today_key()
    d = db.kv_get("health_exported", {}) or {}
    d[key] = now()
    db.kv_set("health_exported", d)
    return {"ok": True, "day": key, "message": f"Datos de {key} enviados a Salud ✅"}


@app.get("/api/health/exported")
async def health_exported_status(day: str | None = None):
    d = db.kv_get("health_exported", {}) or {}
    key = (day or "")[:10] or today_key()
    return {"day": key, "exportedAt": d.get(key)}


# ===================================================================== export / demo / wipe

@app.get("/api/export/daily.csv")
async def export_daily():
    rows = db.q("SELECT metrics FROM days WHERE samples > 0 ORDER BY day_key")
    cols = ["dayKey", "recovery", "strain", "hrv", "rhr", "resp", "skinTemp", "spo2", "sleptMin", "sleepNeedMin", "inBedMin",
            "sleepScore", "sleepPerformance", "deepMin", "remMin", "lightMin", "awakeMin", "bedtime", "wakeTime", "kcal",
            "activeKcal", "avgStress", "highStressMin", "avgHR", "maxHR", "wearMinutes", "steps", "napMin"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        m = json.loads(r["metrics"])
        w.writerow([m.get(c, "") if m.get(c) is not None else "" for c in cols])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=pulso-dias.csv"})


@app.get("/api/export/db")
async def export_db():
    path = str(DB_PATH) + ".export"
    await asyncio.to_thread(db.backup, path)
    return FileResponse(path, filename=f"pulso-{today_key()}.db")


@app.get("/api/export/samples.csv")
async def export_samples(days: int = 7):
    pts = await engine("series", {"dataDir": str(SAMPLES_DIR), "from": now() - days * 86400, "to": now(), "step": 60})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["unix", "local", "hr", "hr_min", "hr_max", "motion", "skin_temp_raw", "contact", "rmssd"])
    for p in pts:
        w.writerow([p["t"], local(p["t"]).strftime("%Y-%m-%d %H:%M"), p.get("hr"), p.get("lo"), p.get("hi"), p.get("motion"), p.get("temp"), p.get("contact"), p.get("rmssd")])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=pulso-minutos.csv"})


@app.post("/api/demo")
async def demo(p: dict = Body(default={})):
    days = int(p.get("days", 21))
    ts, _ = day_bounds(today_key())
    res = await engine("demo", {"dataDir": str(SAMPLES_DIR), "days": days, "todayStart": ts, "now": now()}, timeout=600)
    import random
    for i in range(days, 0, -1):
        if i % 7 in (3, 6):
            continue
        k = add_days(today_key(), -i)
        s0, _ = day_bounds(k)
        start = s0 + 16 * 3600
        name, exs = (("Torso A", ["Bench Press (Barbell)", "Bent Over Row (Barbell)", "Overhead Press (Barbell)", "Lat Pulldown (Cable)"])
                     if i % 2 else ("Pierna A", ["Squat (Barbell)", "Romanian Deadlift (Barbell)", "Leg Press", "Lying Leg Curl (Machine)"]))
        base = [80, 70, 50, 60] if i % 2 else [110, 90, 160, 45]
        sets = [{"exercise": e, "setOrder": n, "setType": "", "weightKg": b + (days - i) * 0.5, "reps": 8 - (n == 3), "distanceKm": 0,
                 "seconds": 0, "rpe": None, "notes": ""} for e, b in zip(exs, base) for n in (1, 2, 3)]
        sw = {"date": start, "name": name, "durationSeconds": 3600, "notes": "", "sets": sets}
        db.ex("INSERT OR IGNORE INTO workouts(uid, source, start, end, sport, name, strong, created_at) VALUES(?,?,?,?,?,?,?,?)",
              (f"strong-demo-{start}", "strong", start, start + 3600, "Fuerza", name, json.dumps(sw), now()))
    if not db.one("SELECT 1 FROM body"):
        db.ex("INSERT INTO body(date, weight_kg, body_fat, waist, chest, arm, notes) VALUES(?,?,?,?,?,?,?)", (now() - days * 86400, 78.4, 17.5, 84, 101, 35, "demo"))
        db.ex("INSERT INTO body(date, weight_kg, body_fat, waist, chest, arm, neck, notes) VALUES(?,?,?,?,?,?,?,?)", (now(), 77.1, 16.6, 82, 102, 35.5, 38, "demo"))
    for i in range(days, 0, -1):
        k = add_days(today_key(), -i)
        ans = {q[0]: (1 if random.random() < 0.3 else 0) for q in reports.JOURNAL_QUESTIONS[:10]}
        db.ex("INSERT OR IGNORE INTO journal(day_key, answers, notes, updated_at) VALUES(?,?,?,?)", (k, json.dumps(ans), "", now()))
    db.kv_set("last_sync_ts", now())
    db.kv_set("device", {"battery": 76, "charging": False, "name": "WHOOP 4C0000000 (demo)", "firmware": "MAXIM 41.17.6.0 · NORDIC 17.2.2.0", "seen": now()})
    if not db.one("SELECT 1 FROM battery"):
        t0 = now() - 9 * 86400
        lvl, ts = 100.0, t0
        while ts < now():                       # demo: ≈ 4.6 days per charge, ~2 readings a day, charge 1 h 40 min
            if lvl <= 12:
                for k in range(6):
                    battery.record(min(100, lvl + k * 18), True, None, "demo", ts + k * 1000)
                ts += 6000; lvl = 100.0
                continue
            battery.record(lvl, False, 3700 + int(lvl * 4), "demo", ts)
            step = 6 * 3600 + random.randint(0, 6 * 3600)
            ts += step; lvl -= step / 3600 * (100 / 110)
        lvl = max(15.0, lvl)
        battery.record(round(lvl, 1), False, 3700 + int(lvl * 4), "demo", now() - 600)
        d = db.kv_get("device", {}) or {}
        d["battery"] = round(lvl)
        db.kv_set("device", d)
    keys = await analysis.reanalyze_all()
    return {"written": res.get("written"), "queued": keys}


@app.post("/api/wipe")
async def wipe(p: dict = Body(...)):
    if p.get("confirm") != "BORRAR":
        raise HTTPException(400, "Escribe BORRAR para confirmar")
    for f in SAMPLES_DIR.glob("*.bin"):
        f.unlink()
    for f in RAW_DIR.rglob("*.bin"):
        f.unlink()
    db.ex("DELETE FROM raw_chunks")
    reset_sample_cache()
    for t in ("days", "workouts", "body", "journal", "plans", "chat", "events", "weekly", "sync_log", "spot", "health", "notified", "battery"):
        db.ex(f"DELETE FROM {t}")
    db.kv_del("last_sync_ts")
    db.kv_del("device")
    return {"ok": True}


@app.get("/api/health")
async def healthcheck():
    return {"ok": True}

# ===================================================================== static web (SPA)

app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
