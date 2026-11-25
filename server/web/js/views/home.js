// Inicio: saludo, los tres anillos (recuperación, esfuerzo, sueño), «De un vistazo», «Plan de hoy»
// y observaciones. Pensado primero para el móvil; en el escritorio se reparte en una rejilla.
import { html } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, n, hm, hhmm, isToday, keyDate, addDays, todayKey, recColor, needOf, C, useEventTarget } from '../core.js';
import { Spinner } from '../ui.js';
import { Icon } from '../icons.js';
import { SyncButton, SyncProgress } from '../layout.js';
import { strap } from '../ble/strap.js';
import { useAlarm } from './alarm.js';

const greeting = () => { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; };
const greetIcon = () => { const h = new Date().getHours(); return h >= 7 && h < 20 ? 'sun' : 'sleep'; };

/** Ring with an icon in the middle (Inicio). value 0..1, null = dashed «sin datos». */
export function IconRing({ value, color, icon, size = 92, calibrating }) {
  const r = 38, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, value ?? 0));
  return html`<svg viewBox="0 0 92 92" width=${size} height=${size} aria-hidden="true">
    <circle cx="46" cy="46" r=${r} fill="none" stroke=${color} stroke-opacity="0.16" stroke-width="7" stroke-dasharray=${value == null || calibrating ? '4 6' : null} />
    ${value != null && !calibrating && html`<circle cx="46" cy="46" r=${r} fill="none" stroke=${color} stroke-width="7" stroke-linecap="round" stroke-dasharray=${`${c * p} ${c}`} transform="rotate(-90 46 46)" style="transition:stroke-dasharray .8s" />`}
    <g transform="translate(34 34)" style=${{ color }}><${Icon} n=${icon} size=${24} /></g>
  </svg>`;
}

export function HomeView() {
  useEventTarget(strap);
  const { date, status } = useStore();
  const day = useApi(`/day/${date}`, [date]);
  const ins = useApi(`/sleep/insights?to=${date}&days=7`, [date]);
  const plan = useApi(isToday(date) ? '/plan/today' : null, [date]);
  const tips = useApi('/insights');
  const m = day.data?.metrics || {};
  const rep = day.data?.report;
  const base = day.data?.baseline || [];
  const nights = base.filter((d) => d.sleptMin).length + (m.sleptMin ? 1 : 0);
  const rec = rep?.recovery;
  const calibrating = rec?.calibrating || (!rec && nights < 4);
  const bat = status?.battery;
  const sub = keyDate(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const loading = day.loading && !day.data;
  return html`<div class="page home">
    <div class="home-head">
      <div class="col" style="gap:2px">
        <h1 class="greet">${isToday(date) ? greeting() : keyDate(date).toLocaleDateString('es-ES', { weekday: 'long' })} <span class="greet-ic"><${Icon} n=${greetIcon()} size=${20} /></span></h1>
        <span class="muted">${sub.charAt(0).toUpperCase() + sub.slice(1)}</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:nowrap">
        <button class="icon-btn" aria-label="Día anterior" onClick=${() => store.set({ date: addDays(date, -1) })}><${Icon} n="chevl" /></button>
        ${!isToday(date) && html`<button class="icon-btn" aria-label="Volver a hoy" onClick=${() => store.set({ date: todayKey() })}><${Icon} n="chev" /></button>`}
        <a class="icon-btn" href="#/pulsera" aria-label="Pulsera" style=${{ color: strap.connected ? 'var(--green)' : 'var(--muted)' }}><${Icon} n="watch" />${bat?.known && html`<span class="tiny num">${n(bat.estimated)}%</span>`}</a>
        <a class="icon-btn accent" href="#/ajustes" aria-label="Ajustes"><${Icon} n="gear" /></a>
      </div>
    </div>
    <${SyncProgress} />
    ${(!strap.connected || strap.s.error) && html`<${SyncButton} big />`}
    ${loading ? html`<div class="row"><${Spinner} /> Cargando…</div>` : html`
    <div class="grid">
      <section class="card span-6 rings-card">
        <a class="ring-col" href="#/m/recovery">
          <${IconRing} value=${rec ? rec.score / 100 : null} color=${rec && !calibrating ? recColor(rec.score) : C.green} icon="heart" calibrating=${calibrating} />
          <span class="rc-label">RECUPERACIÓN</span>
          ${calibrating ? html`<b class="rc-value small">Calibrando</b><span class="rc-sub">${Math.min(nights, 4)} de 4 noches</span>`
            : html`<b class="rc-value" style=${{ color: recColor(rec?.score) }}>${rec ? `${n(rec.score)}%` : '–'}</b><span class="rc-sub">${rec ? (rec.score >= 67 ? 'Lista para rendir' : rec.score >= 34 ? 'Mantén la carga' : 'Prioriza descansar') : 'sin noche'}</span>`}
        </a>
        <a class="ring-col" href="#/m/strain">
          <${IconRing} value=${m.strain != null ? m.strain / 21 : null} color=${C.strain} icon="bolt" />
          <span class="rc-label">ESFUERZO</span>
          <b class="rc-value">${n(m.strain, 1)}</b><span class="rc-sub">de 21</span>
        </a>
        <a class="ring-col" href="#/sueno">
          <${IconRing} value=${m.sleptMin && m.sleepNeedMin ? m.sleptMin / m.sleepNeedMin : null} color=${C.sleep} icon="sleep" />
          <span class="rc-label">SUEÑO</span>
          <b class="rc-value">${m.sleptMin != null ? hmCompact(m.sleptMin) : '–'}</b><span class="rc-sub">${m.sleepNeedMin ? `de ${hmCompact(m.sleepNeedMin)}` : 'sin noche'}</span>
        </a>
      </section>
      <div class="span-6 col" style="gap:10px">
        <div class="section-title">De un vistazo</div>
        <div class="glance">
          <${Glance} href="#/m/rhr" icon="heart" color="var(--heart)" title="FC en reposo" value=${n(m.rhr)} unit="lpm" sub=${m.rhr != null ? 'Esta noche' : 'Se mide durmiendo'} />
          <${Glance} href="#/m/hrv" icon="wave" color="var(--heart)" title="VFC" value=${n(m.hrv)} unit="ms" sub="RMSSD durmiendo" />
          <${Glance} href="#/m/activeKcal" icon="flame" color="var(--activity)" title="Energía activa" value=${n(m.activeKcal)} unit="kcal" sub=${m.kcal ? `${n(m.kcal)} en total` : 'Hoy'} />
          ${m.steps != null ? html`<${Glance} href="#/m/steps" icon="walk" color="var(--activity)" title="Pasos" value=${n(m.steps)} unit="" sub="Desde Salud" />`
            : html`<${Glance} href="#/m/resp" icon="lungs" color="var(--resp)" title="Respiración" value=${n(m.resp, 1)} unit="rpm" sub="Durmiendo" />`}
          <${Glance} href="#/m/hr" icon="live" color="var(--heart)" title="Pulsaciones" value=${strap.s.liveHR ?? n(m.avgHR)} unit="lpm" sub=${strap.s.liveHR ? 'En directo' : `Media de hoy · máx ${n(m.maxHR)}`} live=${!!strap.s.liveHR} />
          <${Glance} href="#/m/avgStress" icon="mind" color="var(--mind)" title="Estrés" value=${n(m.avgStress, 1)} unit="de 3" sub=${m.highStressMin ? `${hm(m.highStressMin)} alto` : 'En reposo'} />
        </div>
      </div>
      <section class="card span-6">
        <div class="card-h"><h2 style="color:var(--fg)">Plan de hoy</h2></div>
        <${PlanRows} rep=${rep} m=${m} plan=${plan.data} status=${status} date=${date} />
      </section>
      <div class="span-6 col" style="gap:10px">
        <div class="row between"><div class="section-title">Observaciones</div><a class="small" href="#/salud">Ver todo</a></div>
        <${Observations} ins=${ins.data} tips=${tips.data} day=${day.data} />
      </div>
    </div>
    <a class="btn big" href="#/dia">Ver todos los datos del día</a>`}
  </div>`;
}

export const hmCompact = (min) => { const x = Math.round(min); return x >= 60 ? `${Math.floor(x / 60)}h ${String(x % 60).padStart(2, '0')}m` : `${x}m`; };

function Glance({ href, icon, color, title, value, unit, sub, live }) {
  return html`<a class="glance-tile" href=${href} style=${{ '--cat': color }}>
    <span class="gt-title"><${Icon} n=${icon} size=${15} /> ${title}${live && html` <span class="live-dot"></span>`}</span>
    <span class="gt-value">${value ?? '–'}${unit && value !== '–' && html`<small>${unit}</small>`}</span>
    <span class="gt-sub">${sub}</span>
  </a>`;
}

function PlanRows({ rep, m, plan, status, date }) {
  const { at } = useAlarm();
  const rows = [];
  if (rep?.targetLo != null && isToday(date)) {
    const left = Math.max(0, rep.targetLo - (m.strain || 0));
    rows.push({ icon: 'bolt', c: 'var(--strain)', t: 'Esfuerzo objetivo', v: `${n(rep.targetLo)}–${n(rep.targetHi)}`, s: left > 0.2 ? `Te faltan ${n(left, 1)} para el mínimo` : 'Objetivo cumplido', href: '#/m/strain' });
  }
  if (plan?.adapted) rows.push({ icon: 'dumbbell', c: 'var(--activity)', t: 'Entreno del plan', v: plan.adapted.title, s: plan.note, href: '#/plan' });
  const need = needOf(rep?.nextNightNeed);
  if (need && isToday(date)) {
    const [h, mm] = (status?.profile?.wakeTime || '07:00').split(':').map(Number);
    const w = new Date(); w.setHours(h, mm, 0, 0); if (w < new Date()) w.setDate(w.getDate() + 1);
    const bed = new Date(w.getTime() - (need / 0.9 + 15) * 60000);
    rows.push({ icon: 'bed', c: 'var(--sleep)', t: 'Esta noche', v: `Acuéstate a las ${bed.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, s: `Necesitarás ${hm(need)} de sueño`, href: '#/sueno' });
  }
  if (at) rows.push({ icon: 'alarm', c: 'var(--orange)', t: 'Despertador', v: new Date(at * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), s: 'Doble toque en la pulsera para pararlo', href: '#/bienestar' });
  if (!rows.length) return html`<div class="small muted">${isToday(date) ? 'Cuando tengas una noche registrada, aquí verás tu esfuerzo objetivo, la hora a la que acostarte y tu entreno del día.' : 'El plan se muestra para el día de hoy.'}${!isToday(date) ? html` <a href="#" onClick=${(e) => { e.preventDefault(); store.set({ date: todayKey() }); }}>Ir a hoy</a>` : ''}</div>`;
  return html`<div class="col" style="gap:0">${rows.map((r) => html`<a class="plan-row" href=${r.href}>
    <span class="pr-ic" style=${{ background: `color-mix(in srgb, ${r.c} 18%, transparent)`, color: r.c }}><${Icon} n=${r.icon} size=${17} /></span>
    <span class="col grow" style="gap:0"><span class="tiny muted">${r.t}</span><b>${r.v}</b>${r.s && html`<span class="tiny muted">${r.s}</span>`}</span>
    <span class="muted"><${Icon} n="chev" /></span></a>`)}</div>`;
}

function Observations({ ins, tips, day }) {
  const items = [];
  if (ins?.vitals?.note) items.push({ icon: 'heart', c: 'var(--orange)', t: 'Constantes fuera de tu rango', x: ins.vitals.note });
  for (const h of (ins?.highlights || []).slice(0, 3)) items.push({ icon: h.icon, c: 'var(--sleep)', t: h.title, x: h.text });
  for (const t of (tips || []).slice(0, Math.max(0, 3 - items.length))) items.push({ icon: 'spark', c: 'var(--accent)', t: 'Observación', x: t });
  if (!items.length) return html`<div class="card small muted">Con unos días de datos Pulso te contará lo que va viendo: tu mejor hora para dormir, constantes fuera de lo normal, tendencias…</div>`;
  return html`<div class="col" style="gap:10px">${items.map((o) => html`<div class="card obs" style=${{ '--cat': o.c }}>
    <span class="obs-t"><${Icon} n=${o.icon} size=${16} /> ${o.t}</span><span class="small">${o.x}</span></div>`)}</div>`;
}
