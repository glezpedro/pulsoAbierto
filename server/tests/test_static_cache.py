"""Static files must be revalidated so an update never mixes old and new JS modules."""
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


class StaticCache(unittest.TestCase):
    def test_static_revalidates(self):
        c = TestClient(app)
        for path in ("/", "/js/main.js", "/js/views/sleep.js", "/css/app.css"):
            r = c.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertEqual(r.headers.get("cache-control"), "no-cache", path)
        etag = c.get("/js/main.js").headers["etag"]
        self.assertEqual(c.get("/js/main.js", headers={"If-None-Match": etag}).status_code, 304)

    def test_build_manifest(self):
        c = TestClient(app)
        r = c.get("/build.json")
        self.assertEqual(r.status_code, 200)
        b = r.json()
        self.assertEqual(len(b["build"]), 16)
        self.assertIn("/js/main.js", b["files"])
        self.assertIn("/css/app.css", b["files"])
        self.assertIn("/js/views/sleep.js", b["files"])
        for f in b["files"]:
            self.assertEqual(c.get(f).status_code, 200, f)
        self.assertIn("/build.json", c.get("/").text)

    def test_health_untouched(self):
        r = TestClient(app).get("/api/health")
        self.assertEqual(r.json(), {"ok": True})
        self.assertNotEqual(r.headers.get("cache-control"), "no-cache")


if __name__ == "__main__":
    unittest.main()
