"""Strava API v3 (your own API application; OAuth callback served by this server)."""
import datetime as dt
import json
import time
import urllib.parse

import httpx

from . import db
from .config import PUBLIC_URL, SAMPLES_DIR
from .core import engine, now

REDIRECT = f"{PUBLIC_URL}/api/strava/callback"

SPORTS = {"Run": "Carrera", "TrailRun": "Carrera", "VirtualRun": "Carrera", "Ride": "Ciclismo", "VirtualRide": "Ciclismo",
          "MountainBikeRide": "Ciclismo", "GravelRide": "Ciclismo", "EBikeRide": "Ciclismo", "Swim": "Natación",
          "Walk": "Caminata", "Hike": "Senderismo", "WeightTraining": "Fuerza", "Workout": "Entrenamiento",
          "Crossfit": "Entrenamiento", "HighIntensityIntervalTraining": "HIIT", "Yoga": "Yoga", "Rowing": "Remo",
          "Soccer": "Fútbol", "Padel": "Pádel", "Tennis": "Tenis"}


def cfg() -> dict:
    return db.kv_get("strava", {}) or {}


def save(c: dict) -> None:
    db.kv_set("strava", c)


def connected() -> bool:
    return bool(cfg().get("refresh_token"))


def authorize_url() -> str:
    c = cfg()
    if not c.get("client_id") or not c.get("client_secret"):
        raise RuntimeError("Configura el Client ID y el Client Secret de tu app de Strava.")
    q = urllib.parse.urlencode({"client_id": c["client_id"], "redirect_uri": REDIRECT, "response_type": "code",
                                "approval_prompt": "auto", "scope": "read,activity:read_all,activity:write"})
    return f"https://www.strava.com/oauth/authorize?{q}"


async def _token(params: dict) -> None:
    c = cfg()
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.post("https://www.strava.com/oauth/token", data={**params, "client_id": c["client_id"], "client_secret": c["client_secret"]})
    if r.status_code != 200:
        raise RuntimeError(f"Strava {r.status_code}: {r.text[:200]}")
    d = r.json()
    c.update(access_token=d["access_token"], refresh_token=d["refresh_token"], expires_at=d["expires_at"])
    if d.get("athlete"):
        c["athlete"] = " ".join(x for x in [d["athlete"].get("firstname"), d["athlete"].get("lastname")] if x)
    save(c)


async def exchange(code: str) -> None:
    await _token({"code": code, "grant_type": "authorization_code"})


async def access() -> str:
    c = cfg()
    if not c.get("refresh_token"):
        raise RuntimeError("Strava no está conectado.")
    if time.time() > (c.get("expires_at") or 0) - 300:
        await _token({"refresh_token": c["refresh_token"], "grant_type": "refresh_token"})
    return cfg()["access_token"]


async def call(method: str, path: str, **kw):
    async with httpx.AsyncClient(timeout=60) as h:
        r = await h.request(method, "https://www.strava.com/api/v3" + path, headers={"Authorization": f"Bearer {await access()}"}, **kw)
    if r.status_code >= 300:
        raise RuntimeError(f"Strava {r.status_code}: {r.text[:300]}")
    return r.json()


def _ts(iso: str) -> int:
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


async def import_recent(days: int = 60) -> list[dict]:
    acts = await call("GET", "/athlete/activities", params={"after": now() - days * 86400, "per_page": 100})
    new = []
    for a in acts:
        uid = f"strava-{a['id']}"
        start = _ts(a["start_date"])
        end = start + int(a.get("elapsed_time") or 0)
        if db.one("SELECT 1 FROM workouts WHERE uid=? OR strava_id=?", (uid, a["id"])):
            db.ex("UPDATE workouts SET name=? WHERE uid=? OR strava_id=?", (a["name"], uid, a["id"]))
            continue
        lo, hi = start - 600, end + 600
        overlap = db.q("SELECT * FROM workouts WHERE start < ? AND end > ? AND source IN ('strap','health','live')", (hi, lo))
        strain = avg = mx = zones = None
        for o in overlap:
            strain = strain or o["strain"]; avg = avg or o["avg_hr"]; mx = mx or o["max_hr"]; zones = zones or o["zones"]
            db.ex("DELETE FROM workouts WHERE uid=?", (o["uid"],))
        sport = a.get("sport_type") or a.get("type") or "Workout"
        kcal = a.get("calories") or ((a.get("kilojoules") or 0) / 4.184 / 0.24 if a.get("kilojoules") else None)
        db.ex("""INSERT INTO workouts(uid, source, start, end, sport, name, strain, avg_hr, max_hr, kcal, distance_km, zones, strava_id, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (uid, "strava", start, end, SPORTS.get(sport, sport), a["name"], strain, a.get("average_heartrate") or avg,
               a.get("max_heartrate") or mx, kcal, (a.get("distance") or 0) / 1000, zones, a["id"], now()))
        new.append(a)
    c = cfg()
    c["last_import"] = now()
    save(c)
    return new


async def upload_workout(w: dict, description: str) -> int | None:
    sport = "Running" if w["sport"] == "Carrera" else ("Biking" if w["sport"] == "Ciclismo" else "Other")
    t = await engine("tcx", {"dataDir": str(SAMPLES_DIR), "from": w["start"], "to": w["end"], "sport": sport,
                             "calories": w.get("kcal") or 0, "notes": description})
    if int(t.get("hrSamples", "0")) > 60:
        files = {"file": (f"pulso-{w['uid']}.tcx", t["tcx"].encode(), "application/xml")}
        data = {"data_type": "tcx", "name": w["name"], "description": description, "external_id": f"pulso-{w['uid']}-{now()}"}
        async with httpx.AsyncClient(timeout=60) as h:
            r = await h.post("https://www.strava.com/api/v3/uploads", headers={"Authorization": f"Bearer {await access()}"}, data=data, files=files)
        if r.status_code >= 300:
            raise RuntimeError(f"Strava {r.status_code}: {r.text[:300]}")
        u = r.json()
        import asyncio
        for _ in range(10):
            if u.get("activity_id") or u.get("error"):
                break
            await asyncio.sleep(2)
            u = await call("GET", f"/uploads/{u['id']}")
        if u.get("error"):
            raise RuntimeError(u["error"])
        return u.get("activity_id")
    sport_type = "WeightTraining" if w.get("strong") else "Workout"
    start_local = dt.datetime.fromtimestamp(w["start"]).strftime("%Y-%m-%dT%H:%M:%S")
    a = await call("POST", "/activities", data={"name": w["name"], "sport_type": sport_type, "start_date_local": start_local,
                                                 "elapsed_time": w["end"] - w["start"], "description": description})
    return a.get("id")


def describe(w: dict) -> str:
    d = "Registrado con Pulso"
    if w.get("strain") is not None:
        d += f" · Esfuerzo {w['strain']:.1f}"
    if w.get("strong"):
        sw = json.loads(w["strong"]) if isinstance(w["strong"], str) else w["strong"]
        ex: dict[str, list[str]] = {}
        vol = 0.0
        for s in sw.get("sets", []):
            if (s.get("setType") or "").upper() == "W":
                continue
            ex.setdefault(s["exercise"], []).append(f"{s['weightKg']:g}kg×{s['reps']}")
            vol += s["weightKg"] * s["reps"]
        d += "\n\n" + "\n".join(f"• {k}: {', '.join(v)}" for k, v in ex.items()) + f"\n\nVolumen total: {vol:.0f} kg"
    return d
