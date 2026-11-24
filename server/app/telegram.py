"""Telegram bot: notifications + commands (/hoy, /sueno, /semana, /carga, /plan, /coach, …)."""
import asyncio
import html
import json
import logging
import secrets as pysecrets

import httpx

from . import db, reports
from .core import add_days, local, now, secret, settings, today_key, week_key

log = logging.getLogger("pulso.telegram")
state = {"running": False, "username": None, "lastError": None}


def token() -> str:
    return secret("telegram_token")


def chat_id() -> str:
    return str(db.kv_get("secret:telegram_chat", "") or secret("telegram_chat") or "")


def pairing_code() -> str:
    c = db.kv_get("telegram_pair_code")
    if not c:
        c = f"{pysecrets.randbelow(900000) + 100000}"
        db.kv_set("telegram_pair_code", c)
    return c


async def api(method: str, **params):
    t = token()
    if not t:
        raise RuntimeError("Bot de Telegram sin configurar")
    async with httpx.AsyncClient(timeout=70) as c:
        r = await c.post(f"https://api.telegram.org/bot{t}/{method}", json=params)
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("description", "error de Telegram"))
        return d["result"]


def md_to_html(text: str) -> str:
    """Minimal Markdown (**bold**, *italic*, bullets) → Telegram HTML."""
    import re
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", t)
    t = re.sub(r"^#{1,6}\s*(.+)$", r"<b>\1</b>", t, flags=re.M)
    t = re.sub(r"^\s*[-•]\s+", "• ", t, flags=re.M)
    return t


async def send(text: str, *, markdown: bool = True, chat: str | None = None) -> bool:
    cid = chat or chat_id()
    if not token() or not cid:
        return False
    body = md_to_html(text) if markdown else html.escape(text)
    try:
        for i in range(0, len(body), 3800):
            await api("sendMessage", chat_id=cid, text=body[i:i + 3800], parse_mode="HTML", disable_web_page_preview=True)
        return True
    except Exception as ex:
        state["lastError"] = str(ex)
        log.warning("telegram send: %s", ex)
        return False

# ---------------------------------------------------------------- summaries

def _m(key: str) -> tuple[dict, dict | None]:
    r = db.one("SELECT metrics, report, ai FROM days WHERE day_key=?", (key,))
    if not r:
        return {}, None
    return json.loads(r["metrics"]), (json.loads(r["report"]) if r["report"] else None)


def emoji_rec(v):
    return "🟢" if v is not None and v >= 67 else ("🟡" if v is not None and v >= 34 else "🔴")


def hm(minutes):
    if minutes is None:
        return "–"
    m = int(round(minutes))
    return f"{m // 60} h {m % 60:02d} min"


def today_text(key: str | None = None) -> str:
    key = key or today_key()
    m, rep = _m(key)
    if not m.get("recovery") and not m.get("strain"):
        return f"Sin datos analizados para {key}. Abre Pulso en Bluefy para sincronizar la pulsera."
    lines = [f"**{emoji_rec(m.get('recovery'))} Recuperación {m.get('recovery', 0):.0f} %**" if m.get("recovery") is not None else "**Recuperación: –**"]
    if m.get("sleptMin"):
        lines.append(f"😴 Sueño {hm(m['sleptMin'])} de {hm(m.get('sleepNeedMin'))} · puntuación {m.get('sleepScore', 0):.0f}")
        lines.append(f"   Profundo {hm(m.get('deepMin'))} · REM {hm(m.get('remMin'))}")
    vals = []
    if m.get("hrv"): vals.append(f"VFC {m['hrv']:.0f} ms")
    if m.get("rhr"): vals.append(f"FC reposo {m['rhr']:.0f}")
    if m.get("resp"): vals.append(f"resp. {m['resp']:.1f}")
    if vals:
        lines.append("❤️ " + " · ".join(vals))
    if m.get("strain") is not None:
        lines.append(f"🔥 Esfuerzo {m['strain']:.1f} · {m.get('kcal', 0):.0f} kcal")
    if rep and rep.get("targetLo") is not None:
        lines.append(f"🎯 Esfuerzo objetivo {rep['targetLo']:.0f}–{rep['targetHi']:.0f}")
    if rep and rep.get("nextNightNeed"):
        n = rep["nextNightNeed"]
        lines.append(f"🌙 Esta noche necesitas {hm(max(240, n['baselineMin'] + n['strainMin'] + n['debtMin'] - n['napCreditMin']))}")
    r = db.one("SELECT ai FROM days WHERE day_key=?", (key,))
    if r and r["ai"]:
        lines.append("\n" + r["ai"])
    return "\n".join(lines)


def sleep_text() -> str:
    m, rep = _m(today_key())
    if not rep or not rep.get("sleep"):
        return "No hay sueño analizado para hoy todavía."
    s = rep["sleep"]
    stages = s["stages"]
    cnt = {i: stages.count(i) for i in range(4)}
    return "\n".join([
        f"**😴 Sueño {m.get('sleepScore', 0):.0f}/100**",
        f"En cama {local(s['start']).strftime('%H:%M')} → {local(s['end']).strftime('%H:%M')}",
        f"Dormido {hm(m.get('sleptMin'))} (necesidad {hm(m.get('sleepNeedMin'))})",
        f"Profundo {hm(cnt[2])} · REM {hm(cnt[3])} · Ligero {hm(cnt[1])} · Despierto {hm(cnt[0])}",
        f"FC reposo {m.get('rhr', 0):.0f} · VFC {m.get('hrv', 0):.0f} ms · resp. {m.get('resp') or 0:.1f}",
    ])


def week_text(wkey: str | None = None) -> str:
    wkey = wkey or week_key(add_days(today_key(), -7))
    rep = reports.weekly_report(wkey)
    k = rep["kpis"]

    def line(label, key, d=0, unit=""):
        c, p = k[key]["cur"], k[key]["prev"]
        if c is None:
            return None
        delta = f" ({c - p:+.{d}f})" if p is not None else ""
        return f"• {label}: **{c:.{d}f}{unit}**{delta}"
    out = [f"**📊 Informe semana {wkey}**", f"{rep['daysWithData']} días con datos"]
    for args in [("Recuperación", "recovery", 0, " %"), ("Esfuerzo medio", "strain", 1), ("VFC", "hrv", 0, " ms"),
                 ("FC reposo", "rhr", 0, " lpm"), ("Puntuación sueño", "sleepScore", 0), ("Estrés", "avgStress", 1)]:
        l = line(*args)
        if l:
            out.append(l)
    sl = rep["sleep"]
    out.append(f"• Sueño total {hm(sl['sleptMin'])} · deuda {hm(sl['debtMin'])}")
    b = rep["recoveryBands"]
    out.append(f"• Días 🟢{b['green']} 🟡{b['yellow']} 🔴{b['red']}")
    tr = rep["training"]
    out.append(f"• Entrenos {tr['count']} · esfuerzo total {tr['totalStrain']:.0f} · volumen Strong {tr['strongVolumeKg'] / 1000:.1f} t")
    out.append(f"• Carga: {rep['load']['status']}" + (f" (ACWR {rep['load']['acwr']:.2f})" if rep['load']['acwr'] else ""))
    w = db.one("SELECT ai FROM weekly WHERE week_key=?", (wkey,))
    if w and w["ai"]:
        out.append("\n" + w["ai"])
    return "\n".join(out)


def load_text() -> str:
    ls = reports.load_series(14)
    if not ls:
        return "Sin datos de carga."
    l = ls[-1]
    bars = " ".join(f"{x['strain']:.0f}" if x.get("strain") is not None else "·" for x in ls[-7:])
    return "\n".join([f"**🏋️ Carga de entrenamiento**", f"Últimos 7 días (esfuerzo): {bars}",
                      f"Aguda {l['acute'] or 0:.0f} · crónica {l['chronic'] or 0:.0f} · ACWR {l['acwr'] or 0:.2f}",
                      reports.load_status(l.get("acwr"))])

# ---------------------------------------------------------------- bot loop

HELP = ("Comandos:\n/hoy – resumen del día\n/sueno – última noche\n/semana – informe semanal\n/carga – carga de entrenamiento\n"
        "/plan – entreno de hoy\n/bateria – estado de la pulsera\n/coach <pregunta> – pregunta al coach IA\n"
        "También puedes escribirme cualquier pregunta directamente.")


async def handle(msg: dict) -> None:
    cid = str(msg["chat"]["id"])
    text = (msg.get("text") or "").strip()
    if not text:
        return
    paired = chat_id()
    if not paired or cid != paired:
        if text.startswith("/start") and text.split()[-1] == pairing_code():
            db.kv_set("secret:telegram_chat", cid)
            db.kv_del("telegram_pair_code")
            await send("✅ Pulso vinculado. Te avisaré cada mañana con tu recuperación.\n\n" + HELP, chat=cid)
        else:
            await send("Este bot es privado. Vincúlalo desde Pulso › Ajustes › Telegram con /start CÓDIGO.", chat=cid, markdown=False)
        return
    cmd = text.split()[0].split("@")[0].lower()
    if cmd in ("/start", "/ayuda", "/help"):
        await send(HELP)
    elif cmd == "/hoy":
        await send(today_text())
    elif cmd in ("/sueno", "/sueño"):
        await send(sleep_text())
    elif cmd == "/semana":
        await send(week_text())
    elif cmd == "/carga":
        await send(load_text())
    elif cmd == "/plan":
        from .main import today_session_text
        await send(await today_session_text())
    elif cmd in ("/bateria", "/batería"):
        d = db.kv_get("device", {}) or {}
        last = db.kv_get("last_sync_ts")
        await send(f"🔋 Batería {d.get('battery', '–')} %{' (cargando)' if d.get('charging') else ''}\n"
                   f"Última sincronización: {local(last).strftime('%d/%m %H:%M') if last else 'nunca'}")
    else:
        q = text[len("/coach"):].strip() if cmd == "/coach" else text
        if not q:
            await send("Escribe tu pregunta: /coach ¿qué entreno hoy?")
            return
        try:
            await api("sendChatAction", chat_id=cid, action="typing")
        except Exception:
            pass
        from . import coach
        try:
            hist = [dict(role=r["role"], content=r["text"]) for r in reversed(db.q("SELECT role, text FROM chat ORDER BY id DESC LIMIT 12"))]
            while hist and hist[0]["role"] != "user":
                hist.pop(0)
            hist.append({"role": "user", "content": q})
            db.ex("INSERT INTO chat(ts, role, text, channel) VALUES(?,?,?,?)", (now(), "user", q, "telegram"))
            ans = "".join([t async for t in coach.stream(coach.chat_system(), hist, 6000, "low")])
            db.ex("INSERT INTO chat(ts, role, text, channel) VALUES(?,?,?,?)", (now(), "assistant", ans, "telegram"))
            await send(ans)
        except Exception as ex:
            await send(f"⚠️ {ex}", markdown=False)


async def loop() -> None:
    offset = None
    while True:
        if not token():
            state["running"] = False
            await asyncio.sleep(15)
            continue
        try:
            if not state["username"]:
                me = await api("getMe")
                state["username"] = me.get("username")
                await api("setMyCommands", commands=[
                    {"command": "hoy", "description": "Resumen del día"}, {"command": "sueno", "description": "Última noche"},
                    {"command": "semana", "description": "Informe semanal"}, {"command": "carga", "description": "Carga de entrenamiento"},
                    {"command": "plan", "description": "Entreno de hoy"}, {"command": "bateria", "description": "Estado de la pulsera"},
                    {"command": "coach", "description": "Pregunta al coach IA"}])
            state["running"] = True
            params = {"timeout": 50, "allowed_updates": ["message"]}
            if offset:
                params["offset"] = offset
            ups = await api("getUpdates", **params)
            for u in ups:
                offset = u["update_id"] + 1
                if "message" in u:
                    asyncio.create_task(handle(u["message"]))
        except Exception as ex:
            state["lastError"] = str(ex)
            state["running"] = False
            state["username"] = None
            await asyncio.sleep(20)
