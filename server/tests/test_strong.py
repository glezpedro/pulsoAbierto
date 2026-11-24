"""Strong CSV import from the iOS Shortcut (/api/strong/import-raw) and the web (/api/strong/import).

Needs the compiled engine: Packages/WhoopKit/.build/release/pulso-engine (skipped otherwise).
Run from the repo root:  python3 -m unittest discover -s server/tests -p 'test_*.py'
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "Packages/WhoopKit/.build/release/pulso-engine"
os.environ.setdefault("PULSO_DATA", tempfile.mkdtemp(prefix="pulso-test-"))
os.environ.setdefault("PULSO_ALLOWED_LOGINS", "yo@example.com")
os.environ.setdefault("PULSO_NO_BACKGROUND", "1")
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app import core, db  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}

CSV = (
    "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n"
    "2026-11-20 18:05:12,Torso A,1h 5m,Bench Press (Barbell),W,40,10,0,0,,,\n"
    "2026-11-20 18:05:12,Torso A,1h 5m,Bench Press (Barbell),1,80,8,0,0,,,8\n"
    "2026-11-22 10:00:00,Pierna,50m,Squat (Barbell),1,100,5,0,0,,,\n"
)


@unittest.skipUnless(ENGINE.exists(), "pulso-engine no compilado")
class StrongImport(unittest.TestCase):
    def setUp(self):
        core.ENGINE = str(ENGINE)
        db.ex("DELETE FROM workouts WHERE source='strong'")
        self.c = TestClient(app)

    def test_raw_body_from_shortcut_is_idempotent(self):
        r = self.c.post("/api/strong/import-raw", content=CSV.encode(), headers={**H, "content-type": "text/csv"})
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual((j["added"], j["total"]), (2, 2))
        self.assertIn("2 entrenos nuevos", j["message"])
        r = self.c.post("/api/strong/import-raw", content=CSV.encode(), headers={**H, "content-type": "application/octet-stream"})
        self.assertEqual(r.json()["added"], 0)
        self.assertIn("sin entrenos nuevos", r.json()["message"])
        rows = db.q("SELECT name FROM workouts WHERE source='strong' ORDER BY start")
        self.assertEqual([x["name"] for x in rows], ["Torso A", "Pierna"])

    def test_raw_with_bom_and_no_content_type(self):
        r = self.c.post("/api/strong/import-raw", content=("﻿" + CSV).encode(), headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["added"], 2)

    def test_multipart_with_any_field_name(self):
        r = self.c.post("/api/strong/import-raw", files={"archivo": ("strong.csv", CSV.encode(), "text/csv")}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["added"], 2)

    def test_web_upload_still_works(self):
        r = self.c.post("/api/strong/import", files={"file": ("strong.csv", CSV.encode(), "text/csv")}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["added"], 2)

    def test_rejects_empty_and_non_strong_files(self):
        self.assertEqual(self.c.post("/api/strong/import-raw", content=b"", headers=H).status_code, 400)
        r = self.c.post("/api/strong/import-raw", content=b"hola,mundo\n1,2\n", headers=H)
        self.assertEqual(r.status_code, 400)

    def test_requires_login(self):
        self.assertEqual(self.c.post("/api/strong/import-raw", content=CSV.encode()).status_code, 403)


if __name__ == "__main__":
    unittest.main()
