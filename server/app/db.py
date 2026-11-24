"""SQLite persistence (single file in the data volume)."""
import json
import sqlite3
import threading
import time
from typing import Any

from .config import DB_PATH

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.execute("PRAGMA synchronous=NORMAL")
_conn.execute("PRAGMA foreign_keys=ON")

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS days (
  day_key TEXT PRIMARY KEY, day_start INTEGER NOT NULL, metrics TEXT NOT NULL, report TEXT,
  ai TEXT, ai_at INTEGER, updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0, samples INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS days_start ON days(day_start);
CREATE TABLE IF NOT EXISTS workouts (
  uid TEXT PRIMARY KEY, source TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, sport TEXT, name TEXT,
  strain REAL, avg_hr REAL, max_hr REAL, kcal REAL, distance_km REAL, notes TEXT DEFAULT '', zones TEXT,
  strong TEXT, strava_id INTEGER, strava_uploaded INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS workouts_start ON workouts(start);
CREATE TABLE IF NOT EXISTS body (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, weight_kg REAL, body_fat REAL, waist REAL, chest REAL,
  hips REAL, neck REAL, arm REAL, thigh REAL, calf REAL, notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS journal (day_key TEXT PRIMARY KEY, answers TEXT NOT NULL DEFAULT '{}', notes TEXT DEFAULT '', updated_at INTEGER);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, created INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0, plan TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, channel TEXT DEFAULT 'web');
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, code INTEGER, label TEXT, detail TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS weekly (week_key TEXT PRIMARY KEY, start INTEGER NOT NULL, report TEXT NOT NULL, ai TEXT, created INTEGER NOT NULL, sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, records INTEGER, first_ts INTEGER, last_ts INTEGER, source TEXT);
CREATE TABLE IF NOT EXISTS spot (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS health (day_key TEXT PRIMARY KEY, steps REAL, active_kcal REAL, weight_kg REAL, data TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS notified (key TEXT PRIMARY KEY, ts INTEGER NOT NULL);
"""

with _lock:
    _conn.executescript(SCHEMA)


def q(sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
    with _lock:
        return _conn.execute(sql, args).fetchall()


def one(sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
    with _lock:
        return _conn.execute(sql, args).fetchone()


def ex(sql: str, args: tuple | list = ()) -> int:
    with _lock:
        cur = _conn.execute(sql, args)
        return cur.lastrowid or cur.rowcount


def many(sql: str, rows: list) -> None:
    with _lock:
        _conn.execute("BEGIN")
        try:
            _conn.executemany(sql, rows)
            _conn.execute("COMMIT")
        except Exception:
            _conn.execute("ROLLBACK")
            raise


# ---------- key/value settings ----------

def kv_get(key: str, default: Any = None) -> Any:
    r = one("SELECT value FROM kv WHERE key=?", (key,))
    return json.loads(r["value"]) if r else default


def kv_set(key: str, value: Any) -> None:
    ex("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


def kv_del(key: str) -> None:
    ex("DELETE FROM kv WHERE key=?", (key,))


def was_notified(key: str) -> bool:
    return one("SELECT 1 FROM notified WHERE key=?", (key,)) is not None


def mark_notified(key: str) -> None:
    ex("INSERT OR REPLACE INTO notified(key,ts) VALUES(?,?)", (key, int(time.time())))


def row(r: sqlite3.Row | None) -> dict | None:
    return dict(r) if r else None


def backup(path: str) -> None:
    with _lock:
        dst = sqlite3.connect(path)
        _conn.backup(dst)
        dst.close()
