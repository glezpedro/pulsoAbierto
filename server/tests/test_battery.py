"""Battery history and estimates (time left, time to full)."""
import os
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

from app import battery, db  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}


class BatteryEstimates(unittest.TestCase):
    def setUp(self):
        db.ex("DELETE FROM battery")
        db.kv_del("device")
        self.now = int(time.time())

    def test_discharge_since_last_charge(self):
        # charged to 100 % 40 h ago, now 60 % → 1 %/h → ~60 h left
        for h in range(0, 41, 4):
            battery.record(100 - h, False, ts=self.now - (40 - h) * 3600)
        e = battery.estimate()
        self.assertFalse(e["charging"])
        self.assertAlmostEqual(e["dischargePerHour"], 1.0, delta=0.05)
        self.assertAlmostEqual(e["remainingHours"], 60, delta=2)
        self.assertAlmostEqual(e["fullLifeDays"], 100 / 24, delta=0.2)
        self.assertEqual(e["dischargeSource"], "desde la última carga")
        self.assertAlmostEqual(e["emptyAt"], self.now + 60 * 3600, delta=2 * 3600)

    def test_charging_time_to_full(self):
        battery.record(50, False, ts=self.now - 20 * 3600)
        battery.record(30, False, ts=self.now - 3600)
        for i, lvl in enumerate([30, 40, 50]):            # 20 % in 20 min → 60 %/h
            battery.record(lvl, True, ts=self.now - 1200 + i * 600)
        e = battery.estimate()
        self.assertTrue(e["charging"])
        self.assertAlmostEqual(e["chargePerHour"], 60, delta=3)
        self.assertAlmostEqual(e["toFullMinutes"], 49, delta=4)
        self.assertGreater(e["fullAt"], self.now)

    def test_single_reading_uses_nominal_and_ages_level(self):
        battery.record(80, False, ts=self.now - 10 * 3600)
        e = battery.estimate()
        self.assertEqual(e["dischargeSource"], "nominal")
        self.assertEqual(e["confidence"], "baja")
        self.assertLess(e["estimated"], 80)              # level is projected to now
        self.assertAlmostEqual(e["fullLifeDays"], 4.5, delta=0.1)

    def test_charge_while_not_connected_starts_a_new_run(self):
        # old run, then a jump up (charged without Pulso watching), then a new run
        for h in range(0, 49, 8):
            battery.record(100 - h * 0.8, False, ts=self.now - (100 - h) * 3600)
        for h in range(0, 9, 4):                          # new run only 8 h long → blended with history
            battery.record(98 - h * 1.25, False, ts=self.now - (8 - h) * 3600)
        e = battery.estimate()
        self.assertAlmostEqual(e["dischargePerHour"], (1.25 + 0.8) / 2, delta=0.05)
        self.assertEqual(e["confidence"], "media")
        self.assertIsNotNone(e["lastChargedAt"])

    def test_long_current_run_is_trusted_on_its_own(self):
        for h in range(0, 49, 8):
            battery.record(100 - h * 0.8, False, ts=self.now - (100 - h) * 3600)
        for h in range(0, 25, 6):                         # 24 h since the last charge
            battery.record(98 - h * 1.25, False, ts=self.now - (24 - h) * 3600)
        e = battery.estimate()
        self.assertAlmostEqual(e["dischargePerHour"], 1.25, delta=0.05)
        self.assertEqual(e["confidence"], "alta")

    def test_dedupe_and_api(self):
        c = TestClient(app)
        for _ in range(3):
            c.post("/api/device", json={"battery": 77.0, "charging": False, "mv": 3990}, headers=H)
        self.assertEqual(db.one("SELECT COUNT(*) n FROM battery")["n"], 1)
        j = c.get("/api/battery", headers=H).json()
        self.assertTrue(j["known"])
        self.assertEqual(j["level"], 77.0)
        self.assertEqual(j["mv"], 3990)
        self.assertEqual(len(j["history"]), 1)
        self.assertIn("battery", c.get("/api/status", headers=H).json())
        self.assertEqual(c.get("/api/battery").status_code, 403)

    def test_fmt(self):
        self.assertEqual(battery.fmt_h(70), "2 d 22 h")
        self.assertEqual(battery.fmt_h(5.5), "5 h 30 min")
        self.assertEqual(battery.fmt_h(0.5), "30 min")


if __name__ == "__main__":
    unittest.main()
