"""Apple Health export for the «Pulso a Salud» Shortcut."""
import json
import os
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

from app import db  # noqa: E402
from app.core import day_bounds  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}
DAY = "2026-11-20"


class HealthExport(unittest.TestCase):
    def setUp(self):
        s, _ = day_bounds(DAY)
        bed = s - 3600
        stages = [1] * 30 + [2] * 40 + [1] * 20 + [3] * 25 + [0] * 5 + [1] * 30
        rep = {"metrics": {"dayKey": DAY, "rhr": 51.4, "resp": 14.42, "activeKcal": 612.7, "spo2": 96.0},
               "sleep": {"start": bed, "end": bed + len(stages) * 60, "stages": stages},
               "hrTimeline": [{"ts": s + i * 300, "avg": 60 + i % 5, "min": 55, "max": 70} for i in range(12)]}
        db.ex("INSERT OR REPLACE INTO days(day_key, day_start, metrics, report, updated_at, dirty, samples) VALUES(?,?,?,?,?,0,1000)",
              (DAY, s, json.dumps(rep["metrics"]), json.dumps(rep), 0))
        db.kv_set("health_exported", {})
        self.c = TestClient(app)

    def test_export_shape(self):
        j = self.c.get(f"/api/health/export?day={DAY}", headers=H).json()
        self.assertTrue(j["hasData"])
        self.assertEqual(j["restingHR"], 51.4)
        self.assertEqual(j["respiratoryRate"], 14.4)
        self.assertEqual(j["activeKcal"], 613)
        self.assertIsNone(j["spo2"])                       # SpO2 only when enabled in settings
        self.assertEqual(j["counts"], {"sleepDeep": 1, "sleepCore": 3, "sleepREM": 1, "sleepAwake": 1, "heartRate": 6})
        self.assertRegex(j["sleepDeep"][0]["start"], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")
        self.assertEqual(j["inBed"][0]["start"], j["bedtime"])
        self.assertEqual(j["heartRate"][0]["value"], 60)    # avg of 60 and 61 rounded

    def test_empty_day_and_default_today(self):
        j = self.c.get("/api/health/export?day=2020-01-01", headers=H).json()
        self.assertFalse(j["hasData"])
        self.assertEqual(j["sleepDeep"], [])
        self.assertEqual(self.c.get("/api/health/export", headers=H).status_code, 200)

    def test_mark_exported(self):
        r = self.c.post("/api/health/exported", json={"day": DAY}, headers=H).json()
        self.assertIn("enviados a Salud", r["message"])
        self.assertTrue(self.c.get(f"/api/health/export?day={DAY}", headers=H).json()["alreadyExported"])
        self.assertIsNotNone(self.c.get(f"/api/health/exported?day={DAY}", headers=H).json()["exportedAt"])

    def test_protected(self):
        self.assertEqual(self.c.get(f"/api/health/export?day={DAY}").status_code, 403)


if __name__ == "__main__":
    unittest.main()
