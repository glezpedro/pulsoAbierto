"""Sleep section: compact nights, best bedtime, regularity (SRI), vitals vs typical range."""
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

from app import db, sleepinsights as si  # noqa: E402
from app.core import add_days, day_bounds  # noqa: E402
from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}
END = "2026-03-31"


def put_day(key, bed_h, wake_h, slept, recovery, **extra):
    """bed_h: local hour the evening before (e.g. 23.5); wake_h: local hour of the wake day."""
    s0, _ = day_bounds(key)
    bed = int(s0 + (bed_h - 24) * 3600)
    wake = int(s0 + wake_h * 3600)
    m = {"dayKey": key, "dayStart": s0, "bedtime": bed, "wakeTime": wake, "sleptMin": slept, "inBedMin": slept + 20,
         "recovery": recovery, "sleepScore": 80, "deepMin": 60, "remMin": 100, "lightMin": slept - 160, "awakeMin": 20,
         "sleepNeedMin": 480, "hrv": 60, "rhr": 52, "resp": 14.5, "sleepAvgHR": 56, **extra}
    stages = [1] * 30 + [2] * 60 + [3] * 30 + [0] * 5 + [1] * 40
    rep = {"metrics": m, "sleep": {"start": bed, "end": wake, "stages": stages}, "naps": []}
    db.ex("""INSERT INTO days(day_key, day_start, metrics, report, updated_at, dirty, samples) VALUES(?,?,?,?,0,0,5000)
             ON CONFLICT(day_key) DO UPDATE SET metrics=excluded.metrics, report=excluded.report, samples=5000""",
          (key, s0, json.dumps(m), json.dumps(rep)))


class SleepInsights(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.ex("DELETE FROM days")
        # 28 nights: early bedtimes (22:30) → high recovery, late (00:30) → low recovery
        for i in range(28):
            k = add_days(END, -i)
            if i % 2:
                put_day(k, 22.5, 6.75, 470, 80)
            else:
                put_day(k, 24.5, 7.5, 400, 50)
        # last night: high resting HR and low HRV → two outliers
        put_day(END, 23.0, 7.0, 450, 40, rhr=62, hrv=35)

    def test_runs(self):
        self.assertEqual(si.runs([1, 1, 2, 0, 0, 0]), [[1, 2], [2, 1], [0, 3]])

    def test_clock_axis_across_midnight(self):
        s0, _ = day_bounds(END)
        self.assertAlmostEqual(si.bed_min(s0 - 1800), -30)        # 23:30
        self.assertAlmostEqual(si.bed_min(s0 + 1800), 30)         # 00:30
        self.assertAlmostEqual(si.bed_min(s0 - 7 * 3600), -420)   # 17:00 the evening before
        self.assertEqual(si.fmt_clock(-30), "23:30")

    def test_robust_sd_ignores_one_off(self):
        self.assertLess(si.robust_sd([-30, -20, -40, -25, 600]), 15)

    def test_best_bedtime_found(self):
        r = si.insights(END, 30)
        best = r["bestBedtime"]
        self.assertIsNotNone(best)
        self.assertEqual(best["label"], "22:30–23:00")
        self.assertGreater(best["delta"], 20)
        self.assertTrue(any(h["title"] == "Tu mejor hora para acostarte" for h in r["highlights"]))
        self.assertEqual(r["bestDuration"]["label"], "7:30–8 h")

    def test_regularity_index(self):
        # identical nights → 100; alternating 2 h shift → lower
        ref = "2026-03-20"     # away from the DST change (29 March), where 7 h after midnight is 08:00
        same = {add_days(ref, -i): (day_bounds(add_days(ref, -i))[0] - 3600, day_bounds(add_days(ref, -i))[0] + 7 * 3600) for i in range(5)}
        self.assertAlmostEqual(si.sleep_regularity_index(same), 100)
        r = si.insights(END, 30)
        self.assertIsNotNone(r["sri"])
        self.assertLess(r["sri"], 100)
        self.assertGreater(r["sri"], 40)

    def test_vitals_flag_outliers(self):
        v = si.vitals(END)
        rows = {r["key"]: r for r in v["rows"]}
        self.assertEqual(rows["rhr"]["state"], "alto")
        self.assertFalse(rows["rhr"]["good"])
        self.assertEqual(rows["hrv"]["state"], "bajo")
        self.assertGreaterEqual(v["outliers"], 2)
        self.assertIsNotNone(v["note"])

    def test_endpoints(self):
        c = TestClient(app)
        n = c.get(f"/api/sleep/nights?to={END}&days=7", headers=H).json()
        self.assertEqual(len(n), 7)
        self.assertEqual(sum(x[1] for x in n[-1]["segs"]), 165)
        r = c.get(f"/api/sleep/insights?to={END}&days=7", headers=H).json()
        self.assertEqual(r["current"]["nights"], 7)
        self.assertIn("vitals", r)
        self.assertEqual(c.get(f"/api/sleep/insights?to={END}&days=7").status_code, 403)


if __name__ == "__main__":
    unittest.main()
