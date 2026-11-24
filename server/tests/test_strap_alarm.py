"""The alarm programmed on the strap is remembered so every screen can show it."""
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

from app.main import app  # noqa: E402

H = {"Tailscale-User-Login": os.environ["PULSO_ALLOWED_LOGINS"].split(",")[0].strip()}


class AlarmSetting(unittest.TestCase):
    def test_set_show_and_clear(self):
        c = TestClient(app)
        at = int(time.time()) + 8 * 3600
        self.assertEqual(c.put("/api/settings", json={"alarmAt": at}, headers=H).status_code, 200)
        self.assertEqual(c.get("/api/status", headers=H).json()["settings"]["alarmAt"], at)
        c.put("/api/settings", json={"alarmAt": None, "alarmCleared": at, "alarmRangAt": at}, headers=H)
        s = c.get("/api/status", headers=H).json()["settings"]
        self.assertIsNone(s["alarmAt"])
        self.assertEqual(s["alarmCleared"], at)
        self.assertEqual(s["alarmRangAt"], at)


if __name__ == "__main__":
    unittest.main()
