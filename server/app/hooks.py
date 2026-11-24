"""Side effects after analysis + periodic jobs (notifications, AI, Strava, weekly reports, backups)."""
import asyncio
import datetime as dt
import json
import logging
import time

from . import db, reports, telegram
from .config import BACKUP_DIR
from .core import add_days, local, next_wake, now, settings, secret, today_key, week_key

log = logging.getLogger("pulso.hooks")


def bedtime_for(rep: dict) -> int | None:
    n = rep.get("nextNightNeed")
    if not n:
        return None
    need = max(240, n["baselineMin"] + n["strainMin"] + n["debtMin"] - n["napCreditMin"])
    return int(next_wake() - (need / 0.9 + 15) * 60)


async def after_analysis(reps: list[dict]) -> None:
    s = settings()
    tk = today_key()
    today = next((r for r in reps if r["metrics"]["dayKey"] == tk), None)
    if not today:
        return
    if today.get("sleep") and s["autoDailyAnalysis"] and secret("anthropic"):
        row = db.one("SELECT ai FROM days WHERE day_key=?", (tk,))
        if row and not row["ai"]:
            try:
                from . import coach
                txt = await coach.daily_analysis(tk)
                db.ex("UPDATE days SET ai=?, ai_at=? WHERE day_key=?", (txt, now(), tk))
            except Exception as ex:
                log.warning("daily AI: %s", ex)
    if today.get("sleep") and s["notifyMorning"] and not db.was_notified(f"morning-{tk}"):
        if await telegram.send(telegram.today_text(tk)):
            db.mark_notified(f"morning-{tk}")
    bt = bedtime_for(today)
    if bt:
        db.kv_set("bedtime_plan", {"day": tk, "bedtime": bt})


def workout_detected(a: dict) -> None:
    if not settings()["notifyWorkouts"] or now() - a["end"] > 6 * 3600:
        return
    key = f"workout-{a['start']}"
    if db.was_notified(key):
        return
    db.mark_notified(key)
    st = a["strain"]
    txt = (f"🏃 **Actividad detectada** {local(a['start']).strftime('%H:%M')}–{local(a['end']).strftime('%H:%M')} "
           f"({(a['end'] - a['start']) // 60} min)\nEsfuerzo **{st['strain']:.1f}** · FC media {st.get('avgHR') or 0:.0f} · {st['kcal']:.0f} kcal")
    asyncio.get_event_loop().create_task(telegram.send(txt))


async def weekly_job(force_week: str | None = None) -> dict:
    wkey = force_week or week_key(add_days(today_key(), -7))
    rep = reports.weekly_report(wkey)
    ai = None
    s = settings()
    if s["autoWeeklyAI"] and secret("anthropic") and rep["daysWithData"] >= 3:
        try:
            from . import coach
            ai = await coach.weekly_narrative(rep)
        except Exception as ex:
            log.warning("weekly AI: %s", ex)
    prev = db.one("SELECT ai FROM weekly WHERE week_key=?", (wkey,))
    db.ex("""INSERT INTO weekly(week_key, start, report, ai, created) VALUES(?,?,?,?,?)
             ON CONFLICT(week_key) DO UPDATE SET report=excluded.report, ai=COALESCE(excluded.ai, weekly.ai), created=excluded.created""",
          (wkey, now(), json.dumps(rep), ai or (prev["ai"] if prev else None), now()))
    return rep


async def scheduler() -> None:
    """Minute ticker for time-based jobs."""
    while True:
        try:
            await tick()
        except Exception:
            log.exception("scheduler")
        await asyncio.sleep(60)


async def tick() -> None:
    s = settings()
    n = local(now())
    tk = today_key()
    hhmm = n.strftime("%H:%M")
    # weekly report
    if s["notifyWeekly"] and n.weekday() == int(s["weeklyDay"]) and hhmm >= s["weeklyTime"]:
        wk = week_key(add_days(tk, -7))
        if not db.was_notified(f"weekly-{wk}"):
            db.mark_notified(f"weekly-{wk}")
            await weekly_job(wk)
            await telegram.send(telegram.week_text(wk))
    # bedtime reminder (30 min before)
    bp = db.kv_get("bedtime_plan")
    if s["notifyBedtime"] and bp and bp.get("bedtime"):
        fire = bp["bedtime"] - 1800
        key = f"bed-{bp['bedtime']}"
        if fire <= now() < bp["bedtime"] and not db.was_notified(key):
            db.mark_notified(key)
            await telegram.send(f"🌙 **Hora de ir preparándose.** Para cubrir tu necesidad de sueño acuéstate a las "
                                f"**{local(bp['bedtime']).strftime('%H:%M')}** (despertar {local(next_wake()).strftime('%H:%M')}).")
    # no sync reminder at 10:00 and 20:00
    last = db.kv_get("last_sync_ts")
    if s["notifyNoSync"] and hhmm in ("10:00", "20:00") and last and now() - last > 20 * 3600:
        key = f"nosync-{tk}-{hhmm}"
        if not db.was_notified(key):
            db.mark_notified(key)
            await telegram.send(f"📡 Llevas {int((now() - last) / 3600)} h sin sincronizar la pulsera. Abre Pulso en Bluefy un par de minutos.")
    # battery won't last the night → warn once in the evening (20:00–23:30)
    if s["notifyBattery"] and "20:00" <= hhmm <= "23:30" and not db.was_notified(f"battery-night-{tk}"):
        from . import battery
        e = battery.estimate()
        if e.get("known") and not e["charging"] and e.get("emptyAt") and e["emptyAt"] < next_wake() + 3600:
            db.mark_notified(f"battery-night-{tk}")
            await telegram.send(f"🔋 A la pulsera le quedan **~{battery.fmt_h(e['remainingHours'])}** ({e['estimated']:.0f} %): no llega a mañana. "
                                f"Cárgala antes de dormir para no perder los datos de sueño (unos {battery.fmt_h((99 - e['estimated']) / e['chargePerHour'])} de carga).")
    # Strava import every 60 min
    from . import strava
    if strava.connected() and now() - (strava.cfg().get("last_import") or 0) > 3600:
        try:
            new = await strava.import_recent(14)
            if new and s["notifyStrava"]:
                for a in new:
                    await telegram.send(f"🟠 Strava: **{a['name']}** importada ({(a.get('distance') or 0) / 1000:.1f} km).")
        except Exception as ex:
            log.warning("strava import: %s", ex)
    # nightly backup 04:00, keep 14
    if hhmm == "04:00" and not db.was_notified(f"backup-{tk}"):
        db.mark_notified(f"backup-{tk}")
        await asyncio.to_thread(db.backup, str(BACKUP_DIR / f"pulso-{tk}.db"))
        for old in sorted(BACKUP_DIR.glob("pulso-*.db"))[:-14]:
            old.unlink(missing_ok=True)


def battery_check(level: float | None, charging: bool) -> None:
    if level is None or charging or not settings()["notifyBattery"]:
        return
    for th in (20, 10):
        if level <= th:
            key = f"battery-{th}-{today_key()}"
            if not db.was_notified(key):
                db.mark_notified(key)
                asyncio.get_event_loop().create_task(telegram.send(f"🔋 Batería de la pulsera al **{level:.0f} %**. Ponle el cargador."))
            break
