"""Workouts recorded with GPS: the route is stored, listed as hasRoute and exported as GPX."""
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

from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}
T = 1795638433


class WorkoutRoute(unittest.TestCase):
    def test_route_and_gpx(self):
        c = TestClient(app)
        route = [[T + i * 2, 40.4168 + i * 1e-4, -3.7038, 650 + i, 140 + i] for i in range(5)]
        w = c.post("/api/workouts", json={"source": "live", "start": T, "end": T + 600, "sport": "Carrera", "name": "Carrera <test> & co",
                                           "strain": 5.2, "avgHR": 150, "distanceKm": 0.05, "route": route}, headers=H).json()
        self.assertTrue(w["hasRoute"])
        self.assertNotIn("route", w)
        lst = c.get("/api/workouts?days=36500&source=live", headers=H).json()
        self.assertTrue(any(x["uid"] == w["uid"] and x["hasRoute"] and "route" not in x for x in lst))
        g = c.get(f"/api/workouts/{w['uid']}/gpx", headers=H)
        self.assertEqual(g.status_code, 200)
        self.assertIn("application/gpx+xml", g.headers["content-type"])
        self.assertEqual(g.text.count("<trkpt"), 5)
        self.assertIn("<gpxtpx:hr>140</gpxtpx:hr>", g.text)
        self.assertIn("Carrera &lt;test&gt; &amp; co", g.text)       # escaped name
        self.assertIn('lat="40.416800" lon="-3.703800"', g.text)

    def test_no_route(self):
        c = TestClient(app)
        w = c.post("/api/workouts", json={"source": "manual", "start": T + 9000, "end": T + 9600, "strain": 3}, headers=H).json()
        self.assertFalse(w["hasRoute"])
        self.assertEqual(c.get(f"/api/workouts/{w['uid']}/gpx", headers=H).status_code, 404)


if __name__ == "__main__":
    unittest.main()
