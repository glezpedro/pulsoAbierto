"""Claude (Anthropic Messages API) — coach chat, daily analysis, weekly narrative, AI plans."""
import json
from typing import AsyncIterator

import httpx

from . import db, reports
from .core import add_days, local, now, profile, settings, secret, today_key, hr_max, age, day_bounds

API = "https://api.anthropic.com/v1/messages"

PERSONA = """Eres "Pulso", el entrenador personal y analista de salud del usuario, dentro de su propia plataforma \
autoalojada que lee los datos crudos de su pulsera WHOOP 4.0 sin suscripción. Hablas en español de España, cercano y \
directo. Basas cada consejo en sus datos reales (que recibes en el contexto) y explicas el porqué en pocas frases. \
Usa las métricas como un entrenador experto: recuperación (0–100 %, verde ≥67, amarillo 34–66, rojo <34), \
esfuerzo/strain (0–21, escala logarítmica de carga cardiovascular), VFC (RMSSD nocturna en ms; compárala con su \
línea base, no con otras personas), FC en reposo, frecuencia respiratoria, sueño (necesidad vs. dormido, fases, \
eficiencia, consistencia), estrés (0–3), carga aguda:crónica (ACWR óptimo 0,8–1,3, >1,5 riesgo) y sus entrenos de \
Strong/Strava. Las fases de sueño, la SpO2 y la temperatura son estimaciones de algoritmos propios: dilo si el \
usuario les da demasiado peso. No eres médico: ante síntomas preocupantes recomienda consultar a un profesional. \
Formato: respuestas breves, viñetas cuando ayuden, negritas para los números clave, sin tablas largas."""


def _fmt(v, d=0):
    return "–" if v is None else (f"{v:.{d}f}")


def data_context(days: int = 30) -> str:
    p = profile()
    out = ["## Perfil",
           f"- {p.get('name') or 'Usuario'}, {age(p)} años, {'hombre' if p.get('sex') == 'male' else 'mujer'}, "
           f"{p.get('heightCm')} cm, {p.get('weightKg')} kg, FC máx {hr_max(p):.0f}, necesidad base de sueño "
           f"{p.get('sleepNeedHours')} h, despertar {p.get('wakeTime')}."]
    if p.get("goal"):
        out.append(f"- Objetivo: {p['goal']}")
    body = db.q("SELECT * FROM body ORDER BY date DESC LIMIT 5")
    if body:
        out.append("\n## Medidas corporales recientes")
        for b in body:
            parts = [f"{lbl} {b[k]:g}{u}" for k, lbl, u in [("weight_kg", "peso", " kg"), ("body_fat", "grasa", " %"),
                     ("waist", "cintura", " cm"), ("chest", "pecho", " cm"), ("arm", "brazo", " cm"), ("thigh", "muslo", " cm")] if b[k] is not None]
            out.append(f"- {local(b['date']).strftime('%d/%m/%Y')}: {', '.join(parts)}")
    ms = [m for m in reports.metrics_list(add_days(today_key(), -days + 1), today_key()) if m.get("strain") is not None or m.get("recovery") is not None]
    if ms:
        out.append(f"\n## Últimos {len(ms)} días (más reciente al final)")
        out.append("fecha | recup % | strain | VFC | FCrep | resp | sueño h (necesidad) | score | prof/REM min | estrés | kcal | pasos")
        for m in ms:
            out.append(" | ".join([m["dayKey"], _fmt(m.get("recovery")), _fmt(m.get("strain"), 1), _fmt(m.get("hrv")), _fmt(m.get("rhr")),
                                   _fmt(m.get("resp"), 1), f"{_fmt((m.get('sleptMin') or 0) / 60 if m.get('sleptMin') else None, 1)} ({_fmt((m.get('sleepNeedMin') or 0) / 60 if m.get('sleepNeedMin') else None, 1)})",
                                   _fmt(m.get("sleepScore")), f"{_fmt(m.get('deepMin'))}/{_fmt(m.get('remMin'))}", _fmt(m.get("avgStress"), 1),
                                   _fmt(m.get("kcal")), _fmt(m.get("steps"))]))
    ls = reports.load_series(30)
    if ls:
        l = ls[-1]
        out.append(f"\nCarga: aguda {_fmt(l.get('acute'))}, crónica {_fmt(l.get('chronic'))}, ACWR {_fmt(l.get('acwr'), 2)}, "
                   f"monotonía {_fmt(l.get('monotony'), 2)} → {reports.load_status(l.get('acwr'))}")
    t = db.one("SELECT report FROM days WHERE day_key=?", (today_key(),))
    if t and t["report"]:
        r = json.loads(t["report"])
        if r.get("targetLo") is not None:
            out.append(f"Strain objetivo hoy: {r['targetLo']:.0f}–{r['targetHi']:.0f}")
        if r.get("nextNightNeed"):
            n = r["nextNightNeed"]
            tot = max(240, n["baselineMin"] + n["strainMin"] + n["debtMin"] - n["napCreditMin"])
            out.append(f"Necesidad de sueño para esta noche: {tot / 60:.1f} h")
    ws = db.q("SELECT * FROM workouts WHERE start > ? ORDER BY start DESC LIMIT 25", (now() - days * 86400,))
    if ws:
        out.append("\n## Entrenamientos recientes")
        for w in ws:
            line = f"- {local(w['start']).strftime('%d/%m %H:%M')} · {w['name']} ({w['source']}), {(w['end'] - w['start']) // 60} min"
            if w["strain"] is not None:
                line += f", strain {w['strain']:.1f}"
            if w["avg_hr"]:
                line += f", FC media {w['avg_hr']:.0f}"
            if w["distance_km"]:
                line += f", {w['distance_km']:.1f} km"
            if w["strong"]:
                sw = json.loads(w["strong"])
                ex: dict[str, list[str]] = {}
                for s in sw.get("sets", []):
                    if (s.get("setType") or "").upper() == "W":
                        continue
                    ex.setdefault(s["exercise"], []).append(f"{s['weightKg']:g}×{s['reps']}")
                line += "\n  " + "\n  ".join(f"{k}: {', '.join(v)}" for k, v in ex.items())
            out.append(line)
    plan = db.one("SELECT plan FROM plans WHERE active=1")
    if plan:
        pl = json.loads(plan["plan"])
        out.append(f"\n## Plan activo: {pl.get('name')}\n{pl.get('summary', '')}")
    spots = db.q("SELECT ts, data FROM spot WHERE kind='hrv' ORDER BY ts DESC LIMIT 7")
    if spots:
        out.append("\n## Mediciones de VFC matinales")
        for s in spots:
            d = json.loads(s["data"])
            out.append(f"- {local(s['ts']).strftime('%d/%m %H:%M')}: RMSSD {d.get('rmssd', 0):.0f} ms, FC {d.get('hr', 0):.0f}")
    jr = db.q("SELECT day_key, answers, notes FROM journal ORDER BY day_key DESC LIMIT 7")
    if jr:
        names = {k: s for k, _, s in reports.JOURNAL_QUESTIONS}
        out.append("\n## Diario de hábitos")
        for j in jr:
            yes = [names.get(k, k) for k, v in json.loads(j["answers"]).items() if v]
            out.append(f"- {j['day_key']}: {', '.join(yes) or 'nada marcado'}{(' · ' + j['notes']) if j['notes'] else ''}")
    out.append(f"\nAhora: {local(now()).strftime('%A %d/%m/%Y %H:%M')}")
    return "\n".join(out)


def _headers(model: str) -> dict:
    key = secret("anthropic")
    if not key:
        raise RuntimeError("Falta la clave de API de Anthropic (Ajustes › Coach IA).")
    h = {"x-api-key": key, "anthropic-version": "2026-10-21", "content-type": "application/json"}
    if "haiku" not in model:
        h["anthropic-beta"] = "server-side-fallback-2026-07-01"
    return h


def _body(model: str, system: str, messages: list[dict], max_tokens: int, effort: str, schema: dict | None = None) -> dict:
    oc: dict = {"effort": effort}
    if schema:
        oc["format"] = {"type": "json_schema", "schema": schema}
    b = {"model": model, "max_tokens": max_tokens, "stream": True,
         "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
         "messages": messages, "output_config": oc}
    if "haiku" not in model:
        b["fallbacks"] = "default"
    return b


async def stream(system: str, messages: list[dict], max_tokens: int = 16000, effort: str = "medium",
                 schema: dict | None = None) -> AsyncIterator[str]:
    model = settings().get("claudeModel") or "claude-opus-5-5"
    stop = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(900, connect=20)) as c:
        async with c.stream("POST", API, headers=_headers(model), json=_body(model, system, messages, max_tokens, effort, schema)) as r:
            if r.status_code != 200:
                txt = (await r.aread()).decode(errors="replace")
                try:
                    msg = json.loads(txt)["error"]["message"]
                except Exception:
                    msg = txt[:300]
                raise RuntimeError(f"API {r.status_code}: {msg}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                t = ev.get("type")
                if t == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                    yield ev["delta"]["text"]
                elif t == "message_delta":
                    stop = ev.get("delta", {}).get("stop_reason") or stop
                elif t == "error":
                    raise RuntimeError(ev.get("error", {}).get("message", "error"))
    if stop == "refusal":
        raise RuntimeError("El modelo ha declinado responder.")
    if stop == "max_tokens" and schema:
        raise RuntimeError("La respuesta se cortó por longitud.")


async def complete(prompt: str, max_tokens: int = 6000, effort: str = "low", context_days: int = 21) -> str:
    sys = PERSONA + "\n\n# Datos del usuario\n" + data_context(context_days)
    out = []
    async for t in stream(sys, [{"role": "user", "content": prompt}], max_tokens, effort):
        out.append(t)
    return "".join(out)


async def daily_analysis(key: str) -> str:
    return await complete(
        f"Analiza mi día {key}. Estructura:\n1. **Resumen** en 2 frases (recuperación, sueño y qué significa hoy).\n"
        "2. **Qué ha influido** (VFC/FC reposo vs. mi línea base, sueño, carga, hábitos).\n"
        "3. **Recomendación de hoy**: strain objetivo, tipo de entreno (ajusta la sesión del plan si la hay) y hora de acostarme.\n"
        "4. Un **micro-hábito** concreto para mañana.\nMáximo 180 palabras.", 4000, "low")


async def weekly_narrative(rep: dict) -> str:
    return await complete(
        "Este es el informe de mi semana " + rep["week"] + " (JSON):\n" + json.dumps(rep, ensure_ascii=False)[:20000] +
        "\n\nRedáctame el informe semanal: tendencias de recuperación, VFC, sueño (deuda y consistencia), carga (ACWR) y "
        "entrenos comparado con la semana anterior; qué ha ido bien, qué mejorar y 3 objetivos concretos para la próxima "
        "semana. Máximo 280 palabras.", 6000, "medium", 35)


def chat_system() -> str:
    return PERSONA + "\n\n# Datos del usuario\n" + data_context(30)


PLAN_SCHEMA = None


def plan_schema() -> dict:
    def obj(props):
        return {"type": "object", "additionalProperties": False, "required": sorted(props), "properties": props}
    s, i, n = {"type": "string"}, {"type": "integer"}, {"type": "number"}
    ex = obj({"name": s, "exerciseKey": s, "sets": i, "reps": s, "rir": i, "restSeconds": i, "notes": s})
    cardio = obj({"minutes": i, "zone": i, "description": s})
    session = obj({"weekday": i, "title": s, "kind": {"type": "string", "enum": ["strength", "cardio", "mixed", "mobility"]},
                   "targetStrain": n, "exercises": {"type": "array", "items": ex}, "cardio": cardio})
    week = obj({"phase": s, "focus": s, "sessions": {"type": "array", "items": session}})
    return obj({"name": s, "summary": s, "weeks": {"type": "array", "items": week}})


async def ai_plan(req: dict, extra: str, start_ts: int) -> dict:
    import uuid
    sys = PERSONA + "\n\n# Datos del usuario\n" + data_context(30)
    prompt = (f"Diseña un plan de entrenamiento periodizado personalizado: objetivo {req['goal']}, {req['daysPerWeek']} días/semana, "
              f"{req['sessionMinutes']} min por sesión, nivel {req['experience']}, material {req['equipment']}, {req['weeks']} semanas, "
              f"cardio {req['cardio']}, músculos prioritarios {', '.join(req.get('priorityMuscles') or []) or 'ninguno'}. "
              f"Indicaciones extra: {extra or 'ninguna'}. Usa mis 1RM y entrenos para elegir cargas (indícalas en notes como '~X kg'), "
              f"respeta mi recuperación y carga recientes, incluye descargas y progresión clara. weekday 1=lunes…7=domingo, exactamente "
              f"{req['daysPerWeek']} sesiones por semana y {req['weeks']} semanas. cardio.minutes=0 si no hay cardio. exerciseKey puede ser \"\".")
    txt = []
    async for t in stream(sys, [{"role": "user", "content": prompt}], 64000, "medium", plan_schema()):
        txt.append(t)
    dto = json.loads("".join(txt))
    weeks = []
    for wi, w in enumerate(dto["weeks"]):
        sessions = []
        for s in w["sessions"]:
            sessions.append({"id": str(uuid.uuid4()).upper(), "weekday": min(7, max(1, s["weekday"])), "title": s["title"],
                             "kind": s["kind"], "targetStrain": s["targetStrain"], "estimatedMinutes": req["sessionMinutes"],
                             "exercises": [{"id": str(uuid.uuid4()).upper(), **e} for e in s["exercises"]],
                             **({"cardio": s["cardio"]} if s["cardio"]["minutes"] > 0 else {})})
        weeks.append({"index": wi, "phase": w["phase"], "focus": w["focus"], "sessions": sessions})
    return {"id": str(uuid.uuid4()).upper(), "name": dto["name"], "summary": dto["summary"], "createdAt": now(),
            "startDate": start_ts, "request": req, "weeks": weeks, "source": "ia"}
