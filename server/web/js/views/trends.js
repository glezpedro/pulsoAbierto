import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, n, hm, mean, sd, slope, pearson, C, recColor } from '../core.js';
import { Card, Stat, ChartBox, Seg, Empty } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';

export const METRICS = [
  { k: 'recovery', l: 'Recuperación', u: '%', c: C.green, hb: true },
  { k: 'strain', l: 'Esfuerzo', u: '', c: C.strain, d: 1 },
  { k: 'hrv', l: 'VFC', u: 'ms', c: C.green, hb: true },
  { k: 'rhr', l: 'FC reposo', u: 'lpm', c: C.hr, hb: false },
  { k: 'resp', l: 'Respiración', u: 'rpm', c: C.accent, d: 1 },
  { k: 'sleptH', l: 'Horas de sueño', u: 'h', c: C.sleep, d: 1, hb: true, f: (m) => (m.sleptMin != null ? m.sleptMin / 60 : null) },
  { k: 'sleepScore', l: 'Puntuación sueño', u: '', c: C.sleep, hb: true },
  { k: 'deepMin', l: 'Sueño profundo', u: 'min', c: C.deep, hb: true },
  { k: 'remMin', l: 'Sueño REM', u: 'min', c: C.rem, hb: true },
  { k: 'kcal', l: 'Calorías', u: 'kcal', c: C.orange },
  { k: 'activeKcal', l: 'Calorías activas', u: 'kcal', c: C.orange },
  { k: 'avgStress', l: 'Estrés', u: '/3', c: C.yellow, d: 1, hb: false },
  { k: 'steps', l: 'Pasos', u: '', c: C.strain },
  { k: 'skinTemp', l: 'Temp. piel (raw)', u: '', c: C.orange, d: 1 },
  { k: 'spo2', l: 'SpO₂ (exp.)', u: '%', c: C.red, d: 1 },
  { k: 'wearH', l: 'Horas con pulsera', u: 'h', c: C.muted, d: 1, f: (m) => (m.wearMinutes != null ? m.wearMinutes / 60 : null) },
];
export const val = (M, m) => (M.f ? M.f(m) : m[M.k] ?? null);

export function TrendsView() {
  const [range, setRange] = useState(60);
  const [mk, setMk] = useState('hrv');
  const [cx, setCx] = useState('strain');
  const [cy, setCy] = useState('recovery');
  const [lag, setLag] = useState(1);
  const days = useApi(`/days?days=${range}`, [range]);
  const recs = useApi('/records');
  const ins = useApi('/insights');
  const M = METRICS.find((x) => x.k === mk);
  const list = days.data || [];
  return html`<${Page} title="Tendencias" right=${html`<${Seg} value=${range} onChange=${setRange} options=${[[14, '14 d'], [30, '30 d'], [60, '60 d'], [90, '90 d'], [365, '1 año']]} />`}>
    <div class="grid">
      <${Card} span="12">
        <div class="chips">${METRICS.map((x) => html`<button class=${`chip ${x.k === mk ? 'on' : ''}`} onClick=${() => setMk(x.k)}>${x.l}</button>`)}</div>
        ${list.length ? html`<${MetricChart} M=${M} list=${list} />` : html`<${Empty} title="Sin datos" />`}<//>
      <${Card} span="12" title="Panel de métricas" icon=${html`<${Icon} n="grid" />`}><${Overview} list=${list} onPick=${setMk} /><//>
      <${Card} span="7" title="Correlaciones" icon=${html`<${Icon} n="trend" />`}>
        <div class="row">
          <select value=${cx} onChange=${(e) => setCx(e.target.value)} style="width:auto">${METRICS.map((x) => html`<option value=${x.k}>${x.l}</option>`)}</select>
          <span class="muted">→</span>
          <select value=${cy} onChange=${(e) => setCy(e.target.value)} style="width:auto">${METRICS.map((x) => html`<option value=${x.k}>${x.l}</option>`)}</select>
          <${Seg} value=${lag} onChange=${setLag} options=${[[0, 'mismo día'], [1, 'día siguiente']]} />
        </div>
        <${Corr} list=${list} X=${METRICS.find((x) => x.k === cx)} Y=${METRICS.find((x) => x.k === cy)} lag=${lag} /><//>
      <div class="span-5 col" style="gap:16px">
        <${Card} title="Hallazgos automáticos" icon=${html`<${Icon} n="spark" />`}>
          ${ins.data?.length ? ins.data.map((t) => html`<div class="small">• ${t}</div>`) : html`<div class="small muted">Con 2–3 semanas de datos aparecerán patrones aquí.</div>`}<//>
        <${Card} title="Récords personales" icon=${html`<${Icon} n="trophy" />`}>
          ${(recs.data || []).map((r) => html`<${Stat} k=${r.label} v=${html`<span>${n(r.value, r.key === 'strain' ? 1 : 0)} ${r.unit} <span class="tiny faint">${r.day.slice(5)}</span></span>`} />`)}<//>
      </div>
    </div>
  <//>`;
}

function MetricChart({ M, list }) {
  const vals = list.map((m) => val(M, m));
  const roll = vals.map((_, i) => mean(vals.slice(Math.max(0, i - 6), i + 1)));
  const valid = vals.filter((x) => x != null);
  const m = mean(valid), s = sd(valid);
  const sl = slope(list.map((_, i) => i), vals);
  const cfg = () => ({
    type: 'line',
    data: { labels: list.map((x) => x.dayKey.slice(5)), datasets: [
      { label: M.l, data: vals, borderColor: M.c + '99', backgroundColor: M.k === 'recovery' ? vals.map((v) => recColor(v)) : M.c, pointRadius: 3, showLine: false },
      { label: 'Media 7 d', data: roll, borderColor: M.c, borderWidth: 2.2, pointRadius: 0, tension: 0.35 },
      { label: 'Media periodo', data: list.map(() => m), borderColor: '#ffffff44', borderDash: [5, 5], pointRadius: 0, borderWidth: 1 },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { grace: '10%' } } },
  });
  return html`<${ChartBox} config=${cfg} height=${290} deps=${[M.k, list.length]} />
    <div class="row" style="gap:20px">
      <span class="small">Media <b>${n(m, M.d || 0)} ${M.u}</b></span><span class="small">Mín <b>${n(Math.min(...valid), M.d || 0)}</b> · Máx <b>${n(Math.max(...valid), M.d || 0)}</b></span>
      <span class="small">Desviación <b>${n(s, 1)}</b></span>
      <span class="small">Tendencia <b class=${sl == null || M.hb == null ? '' : (sl > 0) === M.hb ? 'good' : 'bad'}>${sl == null ? '–' : `${sl > 0 ? '+' : ''}${n(sl * 7, (M.d || 0) + 1)} ${M.u}/semana`}</b></span>
    </div>`;
}

function Overview({ list, onPick }) {
  const last7 = list.slice(-7), prev = list.slice(-14, -7);
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Métrica</th><th>Últimos 7 d</th><th>7 d anteriores</th><th>Cambio</th><th>Periodo</th><th class="hide-mobile">Evolución</th></tr></thead><tbody>
    ${METRICS.map((M) => {
      const a = mean(last7.map((m) => val(M, m))), b = mean(prev.map((m) => val(M, m))), all = list.map((m) => val(M, m));
      if (a == null && b == null) return null;
      const d = a != null && b != null ? a - b : null;
      return html`<tr style="cursor:pointer" onClick=${() => { onPick(M.k); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
        <td><span style=${{ color: M.c }}>●</span> ${M.l}</td><td><b>${n(a, M.d || 0)}</b> ${M.u}</td><td>${n(b, M.d || 0)}</td>
        <td class=${d == null || M.hb == null || Math.abs(d) < 1e-9 ? 'muted' : (d > 0) === M.hb ? 'good' : 'bad'}>${d == null ? '–' : `${d > 0 ? '+' : ''}${n(d, M.d || 0)}`}</td>
        <td class="muted">${n(mean(all), M.d || 0)}</td><td class="hide-mobile" style="width:140px">${spark(all, M.c)}</td></tr>`;
    })}</tbody></table></div>`;
}

function spark(values, color) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const pts = values.map((x, i) => (x == null ? null : `${(i / (values.length - 1)) * 120},${26 - ((x - min) / (max - min || 1)) * 22}`)).filter(Boolean).join(' ');
  return html`<svg viewBox="0 0 120 28" style="width:120px;height:28px"><polyline fill="none" stroke=${color} stroke-width="1.6" points=${pts} /></svg>`;
}

function Corr({ list, X, Y, lag }) {
  const pts = [];
  for (let i = 0; i + lag < list.length; i++) {
    const a = val(X, list[i]), b = val(Y, list[i + lag]);
    if (a != null && b != null) pts.push({ x: a, y: b });
  }
  const r = pearson(pts.map((p) => p.x), pts.map((p) => p.y));
  const sl = slope(pts.map((p) => p.x), pts.map((p) => p.y));
  const cfg = () => ({
    type: 'scatter',
    data: { datasets: [{ data: pts, backgroundColor: C.accent + 'cc', pointRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: `${X.l}${lag ? ' (hoy)' : ''}` } }, y: { title: { display: true, text: `${Y.l}${lag ? ' (mañana)' : ''}` } } } },
  });
  const strength = (r) => { const a = Math.abs(r), d = r > 0 ? 'positiva' : 'negativa'; return a < 0.1 ? 'sin relación' : a < 0.3 ? `relación ${d} débil` : a < 0.5 ? `relación ${d} moderada` : `relación ${d} fuerte`; };
  if (pts.length < 5) return html`<div class="small muted">Se necesitan al menos 5 días con ambos valores.</div>`;
  return html`<${ChartBox} config=${cfg} height=${240} deps=${[X.k, Y.k, lag, pts.length]} />
    <div class="small"><b>r = ${n(r, 2)}</b> · ${strength(r)} · ${pts.length} días${sl != null ? ` · cada +1 ${X.u || 'pto'} de ${X.l.toLowerCase()} ≈ ${sl > 0 ? '+' : ''}${n(sl, 2)} ${Y.u} de ${Y.l.toLowerCase()}` : ''}</div>`;
}
