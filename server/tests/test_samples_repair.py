"""Repairing samples decoded with a wrong layout: replace those seconds, remove the bogus ones."""
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("PULSO_DATA", tempfile.mkdtemp(prefix="pulso-test-"))
os.environ.setdefault("PULSO_ALLOWED_LOGINS", "yo@example.com")
os.environ.setdefault("PULSO_NO_BACKGROUND", "1")
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app import core  # noqa: E402
from app.config import SAMPLES_DIR  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}
T0 = 1795630000


def rec(ts, hr):
    b = bytearray(32)
    struct.pack_into("<I", b, 0, ts)
    b[4] = hr
    return bytes(b)


def stored():
    out = {}
    for p in SAMPLES_DIR.glob("*.bin"):
        b = p.read_bytes()
        for o in range(0, len(b), 32):
            out[struct.unpack_from("<I", b, o)[0]] = b[o + 4]
    return out


class Repair(unittest.TestCase):
    def setUp(self):
        for p in SAMPLES_DIR.glob("*.bin"):
            p.unlink()
        core.reset_sample_cache() if hasattr(core, "reset_sample_cache") else None
        core.settings()  # ensure defaults
        core.db.kv_set("settings", {**core.settings(), "ignoreBefore": None})

    def test_replace_overwrites_same_seconds(self):
        core.append_samples_detail(b"".join(rec(T0 + i, 90) for i in range(10)))      # wrong HR (~90)
        d = core.append_samples_detail(b"".join(rec(T0 + i, 55) for i in range(10)))  # plain: duplicates
        self.assertEqual(d["stored"], 0)
        self.assertEqual(d["reasons"]["duplicate"], 10)
        d = core.append_samples_detail(b"".join(rec(T0 + i, 55) for i in range(10)), replace=True)
        self.assertEqual(d["stored"], 10)
        s = stored()
        self.assertEqual(len(s), 10)
        self.assertTrue(all(v == 55 for v in s.values()))

    def test_remove_endpoint(self):
        core.append_samples_detail(b"".join(rec(T0 + i, 60) for i in range(20)))
        r = TestClient(app).post("/api/samples/remove", json={"ts": [T0 + 3, T0 + 4, T0 + 999]}, headers=H)
        self.assertEqual(r.json()["removed"], 2)
        s = stored()
        self.assertEqual(len(s), 18)
        self.assertNotIn(T0 + 3, s)
        # the cache must forget the removed seconds: storing them again works
        self.assertEqual(core.append_samples_detail(rec(T0 + 3, 61))["stored"], 1)


if __name__ == "__main__":
    unittest.main()
