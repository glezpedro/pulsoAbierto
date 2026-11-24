"""Shared helpers: time/day math, settings & profile, engine calls, sample storage."""
import asyncio
import datetime as dt
import json
import os
import time
from typing import Any

from . import db
from .config import ENGINE, SAMPLES_DIR, TZ, ENV_ANTHROPIC_KEY, ENV_TELEGRAM_CHAT_ID, ENV_TELEGRAM_TOKEN

# ---------------------------------------------------------------- time

def now() -> int:
    return int(time.time())


def local(ts: int | float) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, TZ)


def day_key(ts: int | float) -> str:
    return local(ts).strftime("%Y-%m-%d")


def day_bounds(key: str) -> tuple[int, int]:
    d = dt.date.fromisoformat(key)
    # build both ends from calendar dates so DST days are 23 h / 25 h long
    start = dt.datetime(d.year, d.month, d.day, tzinfo=TZ)
    nd = d + dt.timedelta(days=1)
    end = dt.datetime(nd.year, nd.month, nd.day, tzinfo=TZ)
    return int(start.timestamp()), int(end.timestamp())


def today_key() -> str:
    return day_key(now())


def add_days(key: str, n: int) -> str:
    d = dt.date.fromisoformat(key) + dt.timedelta(days=n)
    return d.isoformat()


def week_key(key: str) -> str:
    d = dt.date.fromisoformat(key)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_days(wkey: str) -> list[str]:
    y, w = wkey.split("-W")
    monday = dt.date.fromisocalendar(int(y), int(w), 1)
    return [(monday + dt.timedelta(days=i)).isoformat() for i in range(7)]


def keys_between(a: str, b: str) -> list[str]:
    out, k = [], a
    while k <= b:
        out.append(k)
        k = add_days(k, 1)
    return out

# ---------------------------------------------------------------- settings

DEFAULT_PROFILE = {
    "name": "", "birthDate": "1995-01-01", "sex": "male", "heightCm": 178.0, "weightKg": 75.0,
    "maxHROverride": None, "sleepNeedHours": 7.75, "wakeTime": "07:00", "goal": "",
}

DEFAULT_SETTINGS = {
    "claudeModel": "claude-opus-5-5",
    "autoDailyAnalysis": True,
    "autoWeeklyAI": True,
    "notifyMorning": True,
    "notifyBedtime": True,
    "notifyWeekly": True,
    "notifyNoSync": True,
    "notifyBattery": True,
    "notifyWorkouts": True,
    "notifyStrava": True,
    "weeklyDay": 0,              # 0 = lunes (informe de la semana anterior)
    "weeklyTime": "08:30",
    "showSpO2": False,
    "strongUnit": "kg",
    "stravaAutoUpload": False,
    "smartAlarm": False,
    "alarmWindow": 30,
    # Second-hand strap: records older than this unix time are downloaded (so the strap frees its
    # memory through the normal acknowledgement) but discarded instead of stored. None = keep all.
    "ignoreBefore": None,
}


def profile() -> dict:
    p = dict(DEFAULT_PROFILE)
    p.update(db.kv_get("profile", {}) or {})
    return p


def settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update(db.kv_get("settings", {}) or {})
    return s


def secret(name: str) -> str:
    v = db.kv_get(f"secret:{name}", "") or ""
    if not v:
        v = {"anthropic": ENV_ANTHROPIC_KEY, "telegram_token": ENV_TELEGRAM_TOKEN,
             "telegram_chat": ENV_TELEGRAM_CHAT_ID}.get(name, "")
    return v


def age(p: dict) -> int:
    try:
        b = dt.date.fromisoformat(p.get("birthDate") or "1995-01-01")
    except ValueError:
        return 30
    t = dt.date.today()
    return t.year - b.year - ((t.month, t.day) < (b.month, b.day))


def physio(p: dict | None = None) -> dict:
    p = p or profile()
    out = {"sex": p.get("sex", "male"), "age": age(p), "weightKg": float(p.get("weightKg") or 75),
           "heightCm": float(p.get("heightCm") or 178), "sleepNeedBaseHours": float(p.get("sleepNeedHours") or 7.75)}
    if p.get("maxHROverride"):
        out["maxHROverride"] = int(p["maxHROverride"])
    return out


def hr_max(p: dict | None = None) -> float:
    p = p or profile()
    return float(p.get("maxHROverride") or round(208 - 0.7 * age(p)))


def bmr(p: dict | None = None) -> float:
    p = p or profile()
    base = 10 * float(p.get("weightKg") or 75) + 6.25 * float(p.get("heightCm") or 178) - 5 * age(p)
    return base + 5 if p.get("sex") == "male" else base - 161


def next_wake(after: int | None = None) -> int:
    s = profile().get("wakeTime") or "07:00"
    h, m = (int(x) for x in s.split(":"))
    a = local(after or now())
    w = a.replace(hour=h, minute=m, second=0, microsecond=0)
    if w <= a:
        w = w + dt.timedelta(days=1)
    return int(w.timestamp())

# ---------------------------------------------------------------- engine

class EngineError(RuntimeError):
    pass


_engine_sem = asyncio.Semaphore(max(1, (os.cpu_count() or 2) - 1))


async def engine(cmd: str, payload: dict, timeout: float = 120) -> Any:
    async with _engine_sem:
        proc = await asyncio.create_subprocess_exec(
            ENGINE, cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise EngineError(f"{cmd}: timeout")
    if proc.returncode != 0:
        raise EngineError(err.decode(errors="replace").strip() or f"{cmd} failed")
    return json.loads(out.decode() or "null")

# ---------------------------------------------------------------- samples

SAMPLE_SIZE = 32


def append_samples(blob: bytes) -> tuple[int, int, int]:
    """Appends raw 32-byte encoded samples. Returns (count, first_ts, last_ts)."""
    if len(blob) % SAMPLE_SIZE:
        raise ValueError("tamaño de bloque inválido")
    n = len(blob) // SAMPLE_SIZE
    if n == 0:
        return 0, 0, 0
    by_day: dict[int, list[bytes]] = {}
    first, last = 1 << 62, 0
    cutoff = int(settings().get("ignoreBefore") or 0)
    for i in range(n):
        rec = blob[i * 32:(i + 1) * 32]
        ts = int.from_bytes(rec[0:4], "little")
        if ts < 1_500_000_000 or ts > now() + 86400 or ts < cutoff:
            continue
        first, last = min(first, ts), max(last, ts)
        by_day.setdefault(ts // 86400, []).append(rec)
    for day, recs in by_day.items():
        with open(SAMPLES_DIR / f"{day}.bin", "ab") as f:
            f.write(b"".join(recs))
            f.flush()
            os.fsync(f.fileno())
    if last == 0:
        return 0, 0, 0
    return sum(len(v) for v in by_day.values()), first, last


def sample_stats() -> dict:
    files = sorted(int(p.stem) for p in SAMPLES_DIR.glob("*.bin") if p.stem.isdigit())
    size = sum((SAMPLES_DIR / f"{d}.bin").stat().st_size for d in files)
    return {"files": len(files), "bytes": size, "firstDay": files[0] if files else None, "lastDay": files[-1] if files else None}


def has_samples_for(key: str) -> bool:
    s, e = day_bounds(key)
    for d in range((s - 8 * 3600) // 86400, (e - 1) // 86400 + 1):
        if (SAMPLES_DIR / f"{d}.bin").exists():
            return True
    return False
