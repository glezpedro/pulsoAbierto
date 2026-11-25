"""Runtime configuration (environment variables)."""
import os
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_DIR = Path(os.environ.get("PULSO_DATA", "/data"))
SAMPLES_DIR = DATA_DIR / "samples"
RAW_DIR = DATA_DIR / "raw"              # history chunks exactly as the strap sent them (source for re-parsing)
DISCARDED_DIR = DATA_DIR / "discarded"  # samples moved out of the way (previous owner of a second-hand strap)
DB_PATH = DATA_DIR / "pulso.db"
BACKUP_DIR = DATA_DIR / "backups"
ENGINE = os.environ.get("PULSO_ENGINE", "/usr/local/bin/pulso-engine")
WEB_DIR = Path(os.environ.get("PULSO_WEB", str(Path(__file__).resolve().parent.parent / "web")))
TZ_NAME = os.environ.get("TZ", "Europe/Madrid")
TZ = ZoneInfo(TZ_NAME)
# Public HTTPS address of the web (e.g. https://mi-servidor.mi-tailnet.ts.net): base of the Strava OAuth callback
PUBLIC_URL = os.environ.get("PULSO_PUBLIC_URL", "http://localhost:8090").rstrip("/")
# Optional: comma-separated Tailscale logins allowed (uses the Tailscale-User-Login header added by `tailscale serve`)
ALLOWED_LOGINS = [x.strip().lower() for x in os.environ.get("PULSO_ALLOWED_LOGINS", "").split(",") if x.strip()]
# Optional secrets via env (can also be set from the web UI)
ENV_TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
ENV_TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
ENV_ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DISABLE_BACKGROUND = os.environ.get("PULSO_NO_BACKGROUND", "") == "1"

for d in (DATA_DIR, SAMPLES_DIR, RAW_DIR, DISCARDED_DIR, BACKUP_DIR):
    d.mkdir(parents=True, exist_ok=True)
