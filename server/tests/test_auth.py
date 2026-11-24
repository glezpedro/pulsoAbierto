"""Tailnet login guard (PULSO_ALLOWED_LOGINS).

Run from the repo root:  python3 -m unittest discover -s server/tests -p 'test_*.py'
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Configure before importing the app (config is read at import time).
os.environ["PULSO_DATA"] = tempfile.mkdtemp(prefix="pulso-test-")
os.environ["PULSO_ALLOWED_LOGINS"] = "yo@example.com, Otro@Example.com"
os.environ["PULSO_NO_BACKGROUND"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

OK = {"Tailscale-User-Login": "yo@example.com"}


class HealthIsPublic(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_get_health_without_login_returns_only_ok(self):
        r = self.c.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"ok": True})

    def test_get_health_with_unknown_login_is_still_public(self):
        r = self.c.get("/api/health", headers={"Tailscale-User-Login": "intruso@example.com"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"ok": True})

    def test_other_methods_on_health_are_protected(self):
        for method in ("post", "put", "delete"):
            self.assertEqual(getattr(self.c, method)("/api/health").status_code, 403, method)


class EverythingElseIsProtected(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_status_requires_login(self):
        r = self.c.get("/api/status")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("ok", r.json())

    def test_health_subpaths_require_login(self):
        self.assertEqual(self.c.get("/api/health/export").status_code, 403)
        self.assertEqual(self.c.post("/api/health/ingest", json={"steps": 1}).status_code, 403)
        self.assertEqual(self.c.get("/api/health/").status_code, 403)
        self.assertEqual(self.c.get("/api/healthz").status_code, 403)

    def test_data_routes_require_login(self):
        for path in ("/api/days", "/api/workouts", "/api/body", "/api/chat", "/api/telegram", "/api/export/daily.csv"):
            self.assertEqual(self.c.get(path).status_code, 403, path)

    def test_unknown_login_rejected(self):
        self.assertEqual(self.c.get("/api/status", headers={"Tailscale-User-Login": "intruso@example.com"}).status_code, 403)

    def test_allowed_logins_pass_case_insensitive(self):
        self.assertEqual(self.c.get("/api/status", headers=OK).status_code, 200)
        self.assertEqual(self.c.get("/api/status", headers={"Tailscale-User-Login": "otro@example.com"}).status_code, 200)
        self.assertEqual(self.c.get("/api/health/export", headers=OK).status_code, 200)


if __name__ == "__main__":
    unittest.main()
