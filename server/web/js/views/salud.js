// Salud: Resumen (cada dato con su tendencia), Explorar (categorías), Tendencias (30 días frente a los
// 30 anteriores) y Constantes (las de la noche frente a tu rango habitual).
import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, n, hm, hhmm, mean, sd, C, addDays } from '../core.js';
import { Spinner, Card } from '../ui.js';
import { Icon } from '../icons.js';
import { SyncProgress } from '../layout.js';
import { BarChart } from '../charts.js';
import { Vitals, Highlights } from './sleep.js';

// key, title, subtitle, unit, decimals, higher is better (null = neutral), icon, colour var, href
const ROWS = [
  ['rhr', 'FC en reposo', 'Durante la noche', 'lpm', 0, false, 'heart', '--heart'],
  ['hrv', 'VFC', 'RMSSD, durmiendo', 'ms', 0, true, 'wave', '--heart'],
  ['sleptMin', 'Sueño', 'Anoche', '', 0, true, 'sleep', '--sleep', '#/sueno'],
  ['recovery', 'Recuperación', 'Al despertar', '%', 0, true, 'heart', '--green'],
  ['strain', 'Esfuerzo', 'Hoy, de 21', '', 1, null, 'bolt', '--strain'],
  ['avgStress', 'Estrés', 'En reposo, de 3', '', 1, false, 'mind', '--mind'],
  ['resp', 'Frecuencia respiratoria', 'Durmiendo', 'rpm', 1, null, 'lungs', '--resp'],
  ['activeKcal', 'Energía activa', 'Hoy', 'kcal', 0, true, 'flame', '--activity'],
  ['skinTemp', 'Temperatura de la piel', 'Respecto a tu media', 'σ', 1, null, 'temp', '--body'],
];

export function SaludView() {
  const [tab, setTab] = useState(() => sessionStorage.getItem('pulso.saludTab') || 'resumen');
  const set = (t) => { setTab(t); try { sessionStorage.setItem('pulso.saludTab', t); } catch { /* ignore */ } };
  return html`<div class="page">
    <div class="topbar"><h1>Salud</h1></div>
    <div class="pills">${[['resumen', 'Resumen'], ['explorar', 'Explorar'], ['tendencias', 'Tendencias'], ['constantes', 'Constantes']].map(([v, l]) => html`
      <button class=${tab === v ? 'on' : ''} onClick=${() => set(v)}>${l}</button>`)}</div>
    <${SyncProgress} />
    ${tab === 'resumen' && html`<${Resumen} />`}
    ${tab === 'explorar' && html`<${ExploreList} />`}
    ${tab === 'tendencias' && html`<${TrendsList} />`}
    ${tab === 'constantes' && html`<${Constantes} />`}
  </div>`;
}

/** '--heart' → the resolved colour (SVG attributes don't take var()). */
const cvar = (v) => C[v.replace(/^--/, '')] || C.accent;
const val = (k, d, rel) => (k === 'skinTemp' ? rel?.(d.skinTemp) : d[k]);
function relTemp(list) {
  const v = list.map((d) => d.skinTemp).filter((x) => x != null);
  const mu = mean(v), s = sd(v) || 1;
  return (x) => (x == null || mu == null ? null : (x - mu) / s);
}

/** Trend arrow of today's value against the mean of the previous 30 days. */
function Trend({ cur, base, better, dec }) {
  if (cur == null || base == null) return null;
  const d = cur - base;
  const small = Math.abs(d) < Math.max(10 ** -dec, Math.abs(base) * 0.03);
  if (small) return html`<span class="trend muted" title="En tu media"><${Icon} n="flat" size=${14} /></span>`;
  const cls = better == null ? 'muted' : (d > 0) === better ? 'good' : 'bad';
  return html`<span class=${`trend ${cls}`} title=${`${d > 0 ? '+' : ''}${n(d, dec)} frente a tu media de 30 días`}><${Icon} n=${d > 0 ? 'arrowUp' : 'arrowDown'} size=${14} /></span>`;
}

function Resumen() {
  const { date, status } = useStore();
  const hist = useApi(`/days?to=${date}&days=31`, [date]);
  const day = useApi(`/day/${date}`, [date]);
  const ins = useApi(`/sleep/insights?to=${date}&days=7`, [date]);
  const tips = useApi('/insights');
  const list = hist.data || [];
  if (hist.loading && !hist.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  const today = list[list.length - 1] || {};
  const prev = list.slice(0, -1);
  const rel = relTemp(list);
  const rhrs = list.map((d) => d.rhr).filter((x) => x != null);
  const vo2 = status?.hrMax && rhrs.length ? 15.3 * (status.hrMax / mean(rhrs.slice(-7))) : null;
  const naps = day.data?.report?.naps || [];
  return html`<div class="grid">
    <section class="card span-7 rows-card">
      ${ROWS.filter(([k]) => k !== 'skinTemp' || today.skinTemp != null).map(([k, t, s, u, dec, better, icon, color, href]) => {
        const cur = val(k, today, rel), base = mean(prev.map((d) => val(k, d, rel)));
        return html`<a class="mrow" href=${href || `#/m/${k}`} style=${{ '--cat': `var(${color})` }}>
          <span class="mr-ic"><${Icon} n=${icon} size=${18} /></span>
          <span class="col grow" style="gap:0"><span>${t}</span><span class="tiny muted">${s}</span></span>
          <span class="mr-v num">${k === 'sleptMin' ? (cur != null ? hm(cur) : '–') : html`${n(cur, dec)}${u && cur != null && html`<small> ${u}</small>`}`}</span>
          <${Trend} cur=${cur} base=${base} better=${better} dec=${dec} />
        </a>`;
      })}
      ${vo2 && html`<div class="mrow" style="--cat:var(--green)">
        <span class="mr-ic"><${Icon} n="run" size=${18} /></span>
        <span class="col grow" style="gap:0"><span>VO₂máx estimado</span><span class="tiny muted">Con tu FC máxima y en reposo (Uth et al., 2004)</span></span>
        <span class="mr-v num">${n(vo2)}<small> ml/kg/min</small></span><span class="trend"></span></div>`}
    </section>
    <div class="span-5 col" style="gap:10px">
      <div class="section-title">Observaciones</div>
      ${ins.data?.vitals?.note && html`<div class="card obs" style="--cat:var(--orange)"><span class="obs-t"><${Icon} n="heart" size=${16} /> Constantes fuera de tu rango</span><span class="small">${ins.data.vitals.note}</span></div>`}
      ${(tips.data || []).map((t) => html`<div class="card obs" style="--cat:var(--accent)"><span class="obs-t"><${Icon} n="spark" size=${16} /> Observación</span><span class="small">${t}</span></div>`)}
      ${!ins.data?.vitals?.note && !(tips.data || []).length && html`<div class="card small muted">Con unos días de datos aparecerán aquí tendencias y avisos sobre tus constantes.</div>`}
      ${naps.length > 0 && html`<div class="section-title">Siestas</div>
        <div class="card">${naps.map((x) => html`<div class="row between small" style="padding:6px 0"><span><${Icon} n="sun" size=${15} /> ${hhmm(x.start)} – ${hhmm(x.end)}</span><b>${hm(x.stages.filter((v) => v).length)}</b></div>`)}</div>`}
    </div>
    ${ins.data && html`<${Highlights} items=${ins.data.highlights} />`}
  </div>`;
}

// ------------------------------------------------------------ explorar
export const CATEGORIES = [
  { t: 'Actividad', icon: 'flame', c: 'var(--activity)', items: [['Esfuerzo', '#/m/strain'], ['Energía activa', '#/m/activeKcal'], ['Energía total', '#/m/kcal'], ['Pasos', '#/m/steps'], ['Esfuerzo y carga', '#/carga'], ['Entrenos', '#/entreno']] },
  { t: 'Corazón', icon: 'heart', c: 'var(--heart)', items: [['Frecuencia cardiaca', '#/m/hr'], ['Frecuencia cardiaca en reposo', '#/m/rhr'], ['Variabilidad de la frecuencia cardiaca', '#/m/hrv'], ['Recuperación', '#/m/recovery'], ['Recuperación en detalle', '#/recuperacion']] },
  { t: 'Respiración', icon: 'lungs', c: 'var(--resp)', items: [['Frecuencia respiratoria', '#/m/resp'], ['Oxígeno en sangre (exp.)', '#/m/spo2'], ['Respiración guiada', '#/bienestar']] },
  { t: 'Sueño', icon: 'sleep', c: 'var(--sleep)', items: [['Sueño', '#/sueno'], ['Puntuación de sueño', '#/m/sleepScore']] },
  { t: 'Constantes', icon: 'temp', c: 'var(--body)', items: [['Temperatura de la piel', '#/m/skinTemp'], ['Constantes nocturnas', '#/salud']] },
  { t: 'Bienestar', icon: 'leaf', c: 'var(--mind)', items: [['Estrés', '#/m/avgStress'], ['Diario de hábitos', '#/diario'], ['Medición de VFC', '#/bienestar']] },
  { t: 'Medidas corporales', icon: 'body', c: 'var(--body)', items: [['Peso y medidas', '#/cuerpo']] },
  { t: 'Informes', icon: 'report', c: 'var(--accent)', items: [['Informe semanal', '#/semanal'], ['Tendencias y correlaciones', '#/tendencias']] },
];

export function ExploreList() {
  const [q, setQ] = useState('');
  const match = (x) => !q || x.toLowerCase().includes(q.toLowerCase());
  return html`<div class="col" style="gap:12px">
    <input type="search" class="search" placeholder="Buscar un dato" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="cat-grid">${CATEGORIES.filter((c) => match(c.t) || c.items.some(([t]) => match(t))).map((c) => html`
      <details class="card cat-card" open=${!!q} style=${{ '--cat': c.c }}>
        <summary><span class="ic" style=${{ background: c.c }}><${Icon} n=${c.icon} size=${17} /></span><span class="grow">${c.t}</span><span class="muted chev"><${Icon} n="chev" /></span></summary>
        <div class="col" style="gap:0">${c.items.filter(([t]) => !q || match(t) || match(c.t)).map(([t, h]) => html`
          <a class="list-item" href=${h} style="color:inherit;padding-left:42px"><span class="grow">${t}</span><span class="muted"><${Icon} n="chev" /></span></a>`)}</div>
      </details>`)}</div>
  </div>`;
}

// ------------------------------------------------------------ tendencias
function TrendsList() {
  const { date } = useStore();
  const cur = useApi(`/days?to=${date}&days=30`, [date]);
  const prev = useApi(`/days?to=${addDays(date, -30)}&days=30`, [date]);
  if (cur.loading && !cur.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  const list = cur.data || [], pl = prev.data || [];
  const rel = relTemp([...pl, ...list]);
  return html`<div class="col" style="gap:10px">
    <div class="small muted">Últimos 30 días frente a los 30 anteriores. Toca uno para verlo en detalle.</div>
    <div class="trend-grid">${ROWS.map(([k, t, , u, dec, better, icon, color, href]) => {
      const vals = list.map((d) => val(k, d, rel));
      const a = mean(vals), b = mean(pl.map((d) => val(k, d, rel)));
      if (a == null) return null;
      const d = b == null ? null : a - b;
      const cls = d == null || better == null || Math.abs(d) < 10 ** -dec ? 'muted' : (d > 0) === better ? 'good' : 'bad';
      const items = list.map((x) => ({ key: x.dayKey, label: '', value: val(k, x, rel) }));
      const vs = vals.filter((v) => v != null);
      const lo = Math.min(...vs), hi = Math.max(...vs);
      return html`<a class="card trend-card" href=${href || `#/m/${k}`} style=${{ '--cat': `var(${color})` }}>
        <div class="row between"><span class="obs-t"><${Icon} n=${icon} size=${15} /> ${t}</span>
          <span class=${`small num ${cls}`}>${d == null ? '' : k === 'sleptMin' ? `${d > 0 ? '+' : '−'}${hm(Math.abs(d))}` : `${d > 0 ? '+' : ''}${n(d, dec)}`}</span></div>
        <div class="gt-value">${k === 'sleptMin' ? hm(a) : n(a, dec)}${u && k !== 'sleptMin' && html`<small>${u}</small>`}</div>
        <${BarChart} items=${items} color=${cvar(color)} height=${64} yMin=${k === 'skinTemp' ? Math.floor(lo) : Math.max(0, lo - (hi - lo) * 0.6)} yMax=${hi + (hi - lo) * 0.1 || hi + 1}
          base=${k === 'skinTemp' ? 0 : Math.max(0, lo - (hi - lo) * 0.6)} yFmt=${() => ''} labelEvery=${1e9} />
      </a>`;
    })}</div>
  </div>`;
}

// ------------------------------------------------------------ constantes
function Constantes() {
  const { date } = useStore();
  const ins = useApi(`/sleep/insights?to=${date}&days=7`, [date]);
  if (ins.loading && !ins.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  return html`<div class="grid">
    <${Card} span="7" title="Constantes de la última noche" icon=${html`<${Icon} n="heart" />`} color="var(--heart)"><${Vitals} v=${ins.data?.vitals} /><//>
    <${Card} span="5" title="Cómo leerlas" icon=${html`<${Icon} n="info" />`} color="var(--accent)">
      <div class="small col" style="gap:8px">
        <p style="margin:0">Cada constante se compara con <b>tu</b> rango habitual de las últimas 30 noches, no con valores de población.</p>
        <p style="margin:0">Una sola fuera de rango no suele significar nada. Si <b>dos o más</b> se salen a la vez (por ejemplo FC en reposo alta y VFC baja), tu cuerpo está gestionando algo: alcohol, una cena tardía, estrés, calor o el inicio de un resfriado.</p>
        <p style="margin:0" class="muted">Pulso no es un dispositivo médico: úsalo para conocer tus tendencias, no para diagnosticar.</p>
      </div><//>
  </div>`;
}
