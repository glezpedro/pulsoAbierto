"""Raw history chunks: every chunk the strap sends is stored byte for byte before it is acknowledged, so
it can always be re-parsed (new record format, wrong strap clock…). Also the one-off clean-up of the
previous owner's samples of a second-hand strap."""
import base64
import hashlib
import json
import logging
import os
import time

from . import db
from .config import DISCARDED_DIR, RAW_DIR, SAMPLES_DIR
from .core import append_samples_detail, day_key, local, now, reset_sample_cache, settings

log = logging.getLogger("pulso.raw")

db.ex("""CREATE TABLE IF NOT EXISTS raw_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, received INTEGER NOT NULL, path TEXT NOT NULL,
  size INTEGER NOT NULL, valid INTEGER NOT NULL DEFAULT 0, stored INTEGER NOT NULL DEFAULT 0,
  discarded INTEGER NOT NULL DEFAULT 0, reasons TEXT, first_ts INTEGER, last_ts INTEGER, meta TEXT,
  reprocessed INTEGER)""")
db.ex("CREATE INDEX IF NOT EXISTS raw_chunks_received ON raw_chunks(received)")


def _b64(s) -> bytes:
    try:
        return base64.b64decode(s or "", validate=True)
    except Exception as ex:  # noqa: BLE001
        raise ValueError(f"base64 inválido: {ex}") from ex


def _write(path, data: bytes) -> None:
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save_chunk(raw_b64: str, samples_b64: str, meta: dict) -> dict:
    """Stores the raw chunk on disk (fsync), then its decoded samples. Idempotent: the same chunk sent
    twice is recognised by its hash and its samples are not appended again."""
    raw = _b64(raw_b64)
    samples = _b64(samples_b64)
    if not raw:
        raise ValueError("bloque vacío")
    if len(samples) % 32:
        raise ValueError("tamaño de muestras inválido")
    h = hashlib.sha256(raw).hexdigest()
    prev = db.one("SELECT * FROM raw_chunks WHERE hash=?", (h,))
    if prev:
        return {"rawSaved": True, "duplicate": True, "id": prev["id"], "stored": prev["stored"], "discarded": prev["discarded"],
                "reasons": json.loads(prev["reasons"] or "{}"), "first": prev["first_ts"], "last": prev["last_ts"], "days": []}
    t = now()
    folder = RAW_DIR / local(t).strftime("%Y-%m-%d")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{t}-{h[:16]}.bin"
    _write(path, raw)
    d = append_samples_detail(samples) if samples else {"received": 0, "stored": 0, "first": 0, "last": 0,
                                                        "reasons": {"invalid": 0, "future": 0, "beforeFilter": 0, "duplicate": 0}}
    discarded = d["received"] - d["stored"]
    cur = db.ex("""INSERT INTO raw_chunks(hash, received, path, size, valid, stored, discarded, reasons, first_ts, last_ts, meta)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (h, t, str(path.relative_to(RAW_DIR)), len(raw), d["received"], d["stored"], discarded, json.dumps(d["reasons"]),
                 d["first"] or None, d["last"] or None, json.dumps(meta or {}, ensure_ascii=False)[:20000]))
    if not d["stored"]:
        st = (meta or {}).get("stats") or {}
        log.warning("bloque %s sin registros guardados: %d recibidos, motivos %s, tipos %s, %s", h[:12], d["received"], d["reasons"],
                    (meta or {}).get("types"), (meta or {}).get("head") or st)
    return {"rawSaved": True, "duplicate": False, "id": cur, "stored": d["stored"], "discarded": discarded, "reasons": d["reasons"],
            "first": d["first"], "last": d["last"]}


def add_samples(chunk_id: int, blob: bytes) -> dict:
    """Stores records recovered by re-parsing a raw chunk (duplicates are harmless: readers de-duplicate)."""
    row = db.one("SELECT * FROM raw_chunks WHERE id=?", (chunk_id,))
    if not row:
        raise KeyError(chunk_id)
    d = append_samples_detail(blob)
    db.ex("UPDATE raw_chunks SET stored=stored+?, valid=MAX(valid, ?), reprocessed=?, first_ts=COALESCE(first_ts, ?), last_ts=COALESCE(last_ts, ?) WHERE id=?",
          (d["stored"], d["received"], now(), d["first"] or None, d["last"] or None, chunk_id))
    return d


# chunks whose records are not accounted for: nothing stored, not filtered on purpose, not re-sent
# duplicates, and not re-processed yet → candidates for «Reprocesar»
UNSTORED = ("stored=0 AND reprocessed IS NULL AND COALESCE(json_extract(reasons,'$.beforeFilter'),0)=0 "
            "AND COALESCE(json_extract(reasons,'$.duplicate'),0)=0")


def listing(limit: int = 200, unstored: bool = False, days: int | None = None) -> list[dict]:
    where, args = [], []
    if unstored:
        where.append(UNSTORED)
    if days:
        where.append("received>?")
        args.append(now() - days * 86400)
    sql = "SELECT id, received, size, valid, stored, discarded, reasons, first_ts, last_ts, meta, reprocessed FROM raw_chunks"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    out = []
    for r in db.q(sql, (*args, limit)):
        d = dict(r)
        d["reasons"] = json.loads(d["reasons"] or "{}")
        d["meta"] = json.loads(d["meta"] or "{}")
        out.append(d)
    return out


def stats() -> dict:
    r = db.one(f"SELECT COUNT(*) n, COALESCE(SUM(size),0) b, COALESCE(SUM({UNSTORED}),0) unstored, MAX(received) last FROM raw_chunks")
    return {"chunks": r["n"], "bytes": r["b"], "unstored": r["unstored"], "last": r["last"]}


def chunk_path(chunk_id: int):
    row = db.one("SELECT path FROM raw_chunks WHERE id=?", (chunk_id,))
    return (RAW_DIR / row["path"]) if row else None


# ---------------------------------------------------------------- second-hand strap clean-up

def purge_previous_owner() -> dict:
    """Moves the samples recorded before settings.ignoreBefore (the previous owner's data, stored before
    the filter was switched on) to DISCARDED_DIR and forgets the days built only from them. Runs once
    per cutoff value; nothing is deleted (the files can be moved back by hand)."""
    cutoff = int(settings().get("ignoreBefore") or 0)
    if not cutoff or db.kv_get("purged_before") == cutoff:
        return {"done": False}
    moved = 0
    for p in sorted(SAMPLES_DIR.glob("*.bin")):
        if not p.stem.isdigit():
            continue
        day = int(p.stem)
        if day * 86400 >= cutoff:
            continue
        data = p.read_bytes()
        keep, old = bytearray(), bytearray()
        for o in range(0, len(data) - len(data) % 32, 32):
            rec = data[o:o + 32]
            (keep if int.from_bytes(rec[0:4], "little") >= cutoff else old).extend(rec)
        if old:
            with open(DISCARDED_DIR / p.name, "ab") as f:
                f.write(old)
                f.flush()
                os.fsync(f.fileno())
            moved += len(old) // 32
        if keep:
            _write(p, bytes(keep))
        else:
            p.unlink()
    reset_sample_cache()
    from .core import has_samples_for
    gone = [r["day_key"] for r in db.q("SELECT day_key FROM days WHERE day_key < ?", (day_key(cutoff),)) if not has_samples_for(r["day_key"])]
    for k in gone:
        db.ex("DELETE FROM days WHERE day_key=?", (k,))
    db.kv_set("purged_before", cutoff)
    info = {"done": True, "cutoff": cutoff, "moved": moved, "days": gone, "at": int(time.time())}
    db.kv_set("purge_info", info)
    if moved or gone:
        log.info("pulsera de segunda mano: %d registros anteriores a %s movidos a %s; días eliminados %s", moved, cutoff, DISCARDED_DIR, gone)
    return info
