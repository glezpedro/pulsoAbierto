"""Sample upload and the second-hand strap filter (settings.ignoreBefore)."""
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

from app import db  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip(), "content-type": "application/octet-stream"}


def blob(timestamps):
    """32-byte records: ts u32 | bpm | flags | rr count | pad | … zeros."""
    return b"".join(struct.pack("<IBBBB", ts, 60, 1, 0, 0) + bytes(24) for ts in timestamps)


class SecondHandFilter(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)
        self.now = int(time.time())
        db.kv_set("settings", {})
        db.kv_set("discarded_previous", 0)

    def tearDown(self):
        db.kv_set("settings", {})

    def test_without_filter_everything_valid_is_stored(self):
        r = self.c.post("/api/samples", content=blob([self.now - 7200, self.now - 3600, 5]), headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["stored"], 2)        # ts=5 (clock never set) is always rejected
        self.assertEqual(r.json()["discarded"], 1)

    def test_records_before_cutoff_are_discarded_and_counted(self):
        cutoff = self.now - 3600
        self.assertEqual(self.c.put("/api/settings", json={"ignoreBefore": cutoff}, headers={"Tailscale-User-Login": H["Tailscale-User-Login"]}).status_code, 200)
        old = [cutoff - 86400 * 3 + i for i in range(100)]           # previous owner's data
        mine = [cutoff + 60 + i for i in range(10)]
        r = self.c.post("/api/samples", content=blob(old + mine), headers=H)
        j = r.json()
        self.assertEqual((j["stored"], j["discarded"]), (10, 100))
        self.assertEqual(j["first"], mine[0])
        self.assertEqual(db.kv_get("discarded_previous"), 100)
        st = self.c.get("/api/status", headers={"Tailscale-User-Login": H["Tailscale-User-Login"]}).json()
        self.assertEqual(st["settings"]["ignoreBefore"], cutoff)
        self.assertEqual(st["discardedPrevious"], 100)

    def test_all_old_chunk_is_accepted_but_stores_nothing(self):
        self.c.put("/api/settings", json={"ignoreBefore": self.now}, headers={"Tailscale-User-Login": H["Tailscale-User-Login"]})
        r = self.c.post("/api/samples", content=blob([self.now - 5000, self.now - 4000]), headers=H)
        self.assertEqual(r.status_code, 200)          # 200 so the web removes the chunk from its queue
        self.assertEqual((r.json()["stored"], r.json()["days"]), (0, []))

    def test_clearing_the_filter(self):
        h = {"Tailscale-User-Login": H["Tailscale-User-Login"]}
        self.c.put("/api/settings", json={"ignoreBefore": self.now}, headers=h)
        self.c.put("/api/settings", json={"ignoreBefore": None}, headers=h)
        r = self.c.post("/api/samples", content=blob([self.now - 5000]), headers=H)
        self.assertEqual(r.json()["stored"], 1)


if __name__ == "__main__":
    unittest.main()
