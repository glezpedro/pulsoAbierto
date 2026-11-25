"""Raw history chunks (/api/chunk, /api/raw), exact saved counts, second-hand clean-up and battery levels."""
import base64
import os
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("PULSO_DATA", tempfile.mkdtemp(prefix="pulso-test-"))
os.environ.setdefault("PULSO_ALLOWED_LOGINS", "yo@example.com")
os.environ.setdefault("PULSO_NO_BACKGROUND", "1")
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app import battery, core, db, raw  # noqa: E402
from app.config import DISCARDED_DIR, RAW_DIR, SAMPLES_DIR  # noqa: E402
from app.main import app  # noqa: E402

LOGIN = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}


def blob(timestamps, bpm=60):
    return b"".join(struct.pack("<IBBBB", ts, bpm, 1, 0, 0) + bytes(24) for ts in timestamps)


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def clean():
    for f in list(SAMPLES_DIR.glob("*.bin")) + list(RAW_DIR.rglob("*.bin")) + list(DISCARDED_DIR.glob("*.bin")):
        f.unlink()
    for t in ("raw_chunks", "sync_log", "days", "battery"):
        db.ex(f"DELETE FROM {t}")
    core.reset_sample_cache()
    db.kv_set("settings", {})
    db.kv_del("purged_before")
    db.kv_set("discarded_previous", 0)


class RawChunks(unittest.TestCase):
    def setUp(self):
        clean()
        self.c = TestClient(app)
        self.now = int(time.time())

    def post(self, raw_bytes, samples, meta=None):
        r = self.c.post("/api/chunk", json={"raw": b64(raw_bytes), "samples": b64(samples), "meta": meta or {"types": {"47": 3}}}, headers=LOGIN)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_chunk_is_stored_raw_and_its_records_saved(self):
        ts = [self.now - 300 + i for i in range(3)]
        j = self.post(b"\xaa\x01\x02raw-frames-1", blob(ts))
        self.assertTrue(j["rawSaved"])
        self.assertEqual((j["stored"], j["discarded"], j["duplicate"]), (3, 0, False))
        files = list(RAW_DIR.rglob("*.bin"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].read_bytes(), b"\xaa\x01\x02raw-frames-1")
        got = self.c.get(f"/api/raw/{j['id']}", headers=LOGIN)
        self.assertEqual(got.content, b"\xaa\x01\x02raw-frames-1")
        self.assertEqual(db.one("SELECT COUNT(*) c FROM sync_log")["c"], 1)

    def test_same_chunk_twice_is_not_stored_twice(self):
        ts = [self.now - 300 + i for i in range(5)]
        a = self.post(b"chunk-A", blob(ts))
        b = self.post(b"chunk-A", blob(ts))
        self.assertTrue(b["duplicate"])
        self.assertEqual(b["id"], a["id"])
        self.assertEqual(db.one("SELECT COUNT(*) c FROM raw_chunks")["c"], 1)
        self.assertEqual(sum(f.stat().st_size for f in SAMPLES_DIR.glob("*.bin")), 5 * 32)

    def test_resent_records_count_as_already_stored(self):
        ts = [self.now - 600 + i for i in range(10)]
        self.post(b"first-send", blob(ts))
        j = self.post(b"resend-with-other-seq", blob(ts[5:] + [self.now - 100]))
        self.assertEqual(j["stored"], 1)
        self.assertEqual(j["reasons"]["duplicate"], 5)
        self.assertEqual(sum(f.stat().st_size for f in SAMPLES_DIR.glob("*.bin")), 11 * 32)

    def test_every_discard_has_a_reason(self):
        self.c.put("/api/settings", json={"ignoreBefore": self.now - 3600}, headers=LOGIN)
        j = self.post(b"mixed", blob([5, 1_000_000_000, self.now + 5 * 86400, self.now - 7200, self.now - 60]))
        self.assertEqual(j["stored"], 1)
        self.assertEqual(j["reasons"], {"invalid": 2, "future": 1, "beforeFilter": 1, "duplicate": 0})
        self.assertEqual(db.kv_get("discarded_previous"), 1)

    def test_chunk_without_records_is_kept_for_reprocessing(self):
        j = self.post(b"unknown-format", b"", {"types": {"51": 2}, "stats": {"valid": 0}})
        self.assertTrue(j["rawSaved"])
        self.assertEqual(j["stored"], 0)
        lst = self.c.get("/api/raw?unstored=1", headers=LOGIN).json()
        self.assertEqual([i["id"] for i in lst["items"]], [j["id"]])
        self.assertEqual(lst["stats"]["unstored"], 1)
        self.assertEqual(lst["items"][0]["meta"]["types"], {"51": 2})
        # re-parsing later recovers the records → stored and no longer pending
        r = self.c.post(f"/api/raw/{j['id']}/samples", content=blob([self.now - 30, self.now - 29]), headers={**LOGIN, "content-type": "application/octet-stream"})
        self.assertEqual(r.json()["stored"], 2)
        self.assertEqual(self.c.get("/api/raw?unstored=1", headers=LOGIN).json()["items"], [])
        # a chunk that only had the previous owner's data is not "pending"
        self.c.put("/api/settings", json={"ignoreBefore": self.now}, headers=LOGIN)
        self.post(b"previous-owner", blob([self.now - 86400]))
        self.assertEqual(self.c.get("/api/raw?unstored=1", headers=LOGIN).json()["items"], [])

    def test_bad_input(self):
        r = self.c.post("/api/chunk", json={"raw": "!!!", "samples": ""}, headers=LOGIN)
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/chunk", json={"raw": b64(b"x"), "samples": b64(b"123")}, headers=LOGIN)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.get("/api/raw/999999", headers=LOGIN).status_code, 404)


class PreviousOwnerCleanup(unittest.TestCase):
    def setUp(self):
        clean()
        self.now = int(time.time())

    def test_old_samples_are_moved_not_deleted_and_days_forgotten(self):
        old = 1771374800                         # Feb 2026, previous owner
        cutoff = self.now - 3600
        core.append_samples(blob([old + i for i in range(20)]))
        core.append_samples(blob([cutoff - 10, cutoff + 10, cutoff + 11]))
        db.ex("INSERT INTO days(day_key, day_start, metrics, updated_at) VALUES('2026-02-18', ?, '{}', ?)", (old, self.now))
        db.kv_set("settings", {"ignoreBefore": cutoff})
        info = raw.purge_previous_owner()
        self.assertTrue(info["done"])
        self.assertEqual(info["moved"], 21)
        self.assertEqual(info["days"], ["2026-02-18"])
        kept = b"".join(f.read_bytes() for f in SAMPLES_DIR.glob("*.bin"))
        self.assertEqual(sorted(struct.unpack_from("<I", kept, o)[0] for o in range(0, len(kept), 32)), [cutoff + 10, cutoff + 11])
        self.assertEqual(sum(f.stat().st_size for f in DISCARDED_DIR.glob("*.bin")), 21 * 32)
        self.assertIsNone(db.one("SELECT 1 FROM days WHERE day_key='2026-02-18'"))
        self.assertFalse(raw.purge_previous_owner()["done"])          # only once per cutoff
        # the duplicate cache was refreshed: the moved seconds can be stored again if they reappear
        self.assertEqual(core.append_samples(blob([cutoff + 10, cutoff + 12]))[0], 1)


class BatteryLevels(unittest.TestCase):
    def setUp(self):
        db.ex("DELETE FROM battery")
        self.now = int(time.time())

    def test_voltage_curve(self):
        self.assertAlmostEqual(battery.ocv_level(3830), 48, delta=1)    # 3.83 V at rest ≈ half, not ~35 %
        self.assertEqual(battery.ocv_level(4250), 100.0)
        self.assertLess(battery.ocv_level(3650), 8)
        self.assertIsNone(battery.ocv_level(None))

    def test_pack_readings_do_not_mix_with_the_strap(self):
        # real pattern of 25/11: the pack charges the strap and both batteries report, interleaved
        t = self.now - 1200
        for i in range(30):
            battery.record(66 + i * 0.3, True, 4100 + i, "evento", ts=t + i * 30)        # strap, charging
            battery.record(79 - i * 1.6, False, 4180 - i * 12, "evento", ts=t + i * 30 + 10)  # pack, draining
        rs = battery.readings(1)
        self.assertTrue(all(r["charging"] for r in rs))
        levels = [r["level"] for r in rs]
        self.assertTrue(all(b >= a - 0.01 for a, b in zip(levels, levels[1:])), levels)   # no 90 → 15 % jumps
        e = battery.estimate()
        self.assertTrue(e["charging"])
        self.assertGreater(e["estimated"], 70)
        self.assertIsNotNone(e["pack"])
        self.assertLess(e["pack"]["level"], 40)

    def test_gauge_that_disagrees_with_the_voltage_is_ignored(self):
        battery.record(35, False, 3830, "evento", ts=self.now - 600)
        rs = battery.readings(1)
        self.assertAlmostEqual(rs[-1]["level"], 48, delta=1.5)
        self.assertEqual(rs[-1]["reported"], 35)

    def test_incoherent_voltage_is_dropped(self):
        battery.record(80, False, 4050, "evento", ts=self.now - 900)
        battery.record(13, True, 3700, "evento", ts=self.now - 800)   # "plugged in" but the voltage fell 350 mV
        battery.record(80, True, 4120, "evento", ts=self.now - 700)
        rs = battery.readings(1)
        self.assertNotIn(13, [r["reported"] for r in rs])

    def test_no_voltage_keeps_the_strap_value(self):
        battery.record(64, False, None, "lectura", ts=self.now - 60)
        self.assertEqual(battery.readings(1)[-1]["level"], 64)


if __name__ == "__main__":
    unittest.main()
