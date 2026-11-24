import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, n, mean, sd, C, recColor, recBand, addDays } from '../core.js';
import { Card, Stat, Ring, ChartBox, Heatmap, Empty, Seg } from '../ui.js';
import { Page } from '../layout.js';
import { DayNav } from './today.js';
import { Icon } from '../icons.js';

export function RecoveryView() {
  const { date } = useStore();
  const [range, setRange] = useState(30);
  const day = useApi(`/day/${date}`, [date]);
  const hist = useApi(`/days?to=${date}&days=${range}`, [date, range]);
  const spots = useApi('/spot?limit=30');
  const r = day.data?.report?.recovery;
  const m = day.data?.metrics || {};
  const days = hist.data || [];
  return html`<${Page} title="Recuperación" right=${html`<${DayNav} />`}>
    <div class="grid">
      ${!r && day.data && html`<${Card} span="12"><${Empty} icon="♥" title="Sin recuperación este día">Se calcula con el sueño de la noche anterior.<//><//>`}
      ${r && html`<${Card} span="4"><div style="max-width:220px;margin:0 auto;width:100%"><${Ring} value=${r.score} color=${recColor(r.score)} label="RECUPERACIÓN" text=${`${Math.round(r.score)}%`} caption=${r.calibrating ? 'calibrando' : null} /></div>
        <div class="row" style="justify-content:center"><span class=${`pill ${recBand(r.score)}`}>${r.score >= 67 ? 'Verde · listo para rendir' : r.score >= 34 ? 'Amarillo · mantén' : 'Rojo · prioriza recuperar'}</span></div>
        ${r.calibrating && html`<div class="small muted" style="text-align:center">Calibrando tu línea base: se personaliza a partir del 4.º día con datos.</div>`}<//>
      <${Card} span="8" title="Qué la compone" icon=${html`<${Icon} n="report" />`}>
        <${Contrib} label="VFC · 55 %" z=${r.zHRV} v=${`${n(m.hrv)} ms`} />
        <${Contrib} label="FC en reposo · 25 %" z=${r.zRHR} v=${`${n(m.rhr)} lpm`} />
        <${Contrib} label="Sueño · 12 %" z=${r.sleepTerm} v=${`${n(m.sleepPerformance)} % rendimiento`} />
        <${Contrib} label="Respiración · 4 %" z=${r.zResp} v=${`${n(m.resp, 1)} rpm`} />
        <${Contrib} label="Temperatura piel · 4 %" z=${r.zTemp} v="desviación" />
        <div class="tiny faint">Cada barra indica cuánto se aleja hoy la métrica de tu media de 30 días (en desviaciones típicas). Verde a la derecha = mejor de lo habitual. La puntuación pasa la suma ponderada por una curva logística: un día normal ronda el 60 %.</div><//>`}
      <${Card} span="12" title="Evolución" icon=${html`<${Icon} n="trend" />`} right=${html`<${Seg} value=${range} onChange=${setRange} options=${[[30, '30 d'], [60, '60 d'], [90, '90 d'], [180, '6 m']]} />`}>
        ${days.length ? html`<${RecChart} days=${days} />` : null}<//>
      <${Card} span="6" title="VFC frente a tu normalidad" icon=${html`<${Icon} n="heart" />`}><${Baseline} days=${days} k="hrv" color=${C.green} unit="ms" up /><//>
      <${Card} span="6" title="FC en reposo" icon=${html`<${Icon} n="heart" />`}><${Baseline} days=${days} k="rhr" color=${C.hr} unit="lpm" /><//>
      <${Card} span="5" title="Calendario" icon=${html`<${Icon} n="today" />`}><${Heatmap} days=${days.slice(-42).map((d) => ({ dayKey: d.dayKey, value: d.recovery }))} onPick=${(k) => store.set({ date: k })} /><//>
      <${Card} span="7" title="Mediciones de VFC matinales" icon=${html`<${Icon} n="live" />`} right=${html`<a class="small" href="#/directo">Medir ahora</a>`}>
        ${spots.data?.length ? html`<${SpotChart} spots=${spots.data} />` : html`<div class="small muted">Haz una medición de 2 minutos cada mañana, sentado y en calma, desde «En directo». Es la forma más precisa de seguir tu VFC (método de Plews y Buchheit).</div>`}<//>
    </div>
  <//>`;
}

function Contrib({ label, z, v }) {
  const x = Math.max(-3, Math.min(3, z ?? 0)) / 3;
  return html`<div class="col" style="gap:4px">
    <div class="row between small"><span>${label}</span><span class="muted num">${v} · ${z == null ? '–' : `${z > 0 ? '+' : ''}${n(z, 1)} σ`}</span></div>
    <div style="position:relative;height:8px;background:var(--panel-2);border-radius:99px">
      <div style=${{ position: 'absolute', top: 0, bottom: 0, left: x >= 0 ? '50%' : `${50 + x * 50}%`, width: `${Math.abs(x) * 50}%`, background: x >= 0 ? C.green : C.red, borderRadius: '99px' }}></div>
      <div style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#5b6670"></div>
    </div></div>`;
}

function RecChart({ days }) {
  const cfg = () => ({
    type: 'bar',
    data: { labels: days.map((d) => d.dayKey.slice(5)), datasets: [
      { label: 'Recuperación', data: days.map((d) => d.recovery), backgroundColor: days.map((d) => recColor(d.recovery)), borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: 'VFC', data: days.map((d) => d.hrv), borderColor: '#fff', borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y2' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { min: 0, max: 100 }, y2: { position: 'right', grid: { display: false } } } },
  });
  const rec = days.map((d) => d.recovery).filter((x) => x != null);
  return html`<${ChartBox} config=${cfg} height=${240} deps=${[days.length, days[days.length - 1]?.dayKey]} />
    <div class="row" style="gap:18px"><span class="small">Media <b>${n(mean(rec))} %</b></span>
    <span class="small good">🟢 ${rec.filter((x) => x >= 67).length}</span><span class="small warn">🟡 ${rec.filter((x) => x >= 34 && x < 67).length}</span><span class="small bad">🔴 ${rec.filter((x) => x < 34).length}</span></div>`;
}

/** Plews-style chart: daily values, 7-day rolling mean and the normal range (mean ± 0.5 SD of 60 days). */
function Baseline({ days, k, color, unit, up }) {
  const vals = days.map((d) => d[k]);
  const roll = vals.map((_, i) => mean(vals.slice(Math.max(0, i - 6), i + 1)));
  const valid = vals.filter((x) => x != null);
  if (valid.length < 3) return html`<div class="small muted">Necesita más días.</div>`;
  const m = mean(valid), s = sd(valid) || 0;
  const cfg = () => ({
    type: 'line',
    data: { labels: days.map((d) => d.dayKey.slice(5)), datasets: [
      { label: 'Normal +', data: days.map(() => m + 0.5 * s), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: color + '22' },
      { label: 'Normal −', data: days.map(() => m - 0.5 * s), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'Diario', data: vals, borderColor: color + '88', pointRadius: 2, showLine: false },
      { label: 'Media 7 d', data: roll, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.35 },
    ] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grace: '10%' } } },
  });
  const last = roll[roll.length - 1];
  const state = last == null ? '' : last > m + 0.5 * s ? (up ? 'por encima de lo normal (bien)' : 'por encima de lo normal (vigila)') : last < m - 0.5 * s ? (up ? 'por debajo de lo normal (vigila)' : 'por debajo de lo normal (bien)') : 'dentro de tu normalidad';
  return html`<${ChartBox} config=${cfg} height=${180} deps=${[days.length]} />
    <div class="small">Media 7 días <b>${n(last)} ${unit}</b> · normal ${n(m - 0.5 * s)}–${n(m + 0.5 * s)} ${unit} → <span class="muted">${state}</span></div>`;
}

function SpotChart({ spots }) {
  const pts = [...spots].reverse();
  const cfg = () => ({
    type: 'line',
    data: { labels: pts.map((p) => new Date(p.ts * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })), datasets: [
      { label: 'RMSSD (ms)', data: pts.map((p) => p.rmssd), borderColor: C.green, pointRadius: 3, tension: 0.3, yAxisID: 'y' },
      { label: 'FC (lpm)', data: pts.map((p) => p.hr), borderColor: C.hr, pointRadius: 2, tension: 0.3, yAxisID: 'y2' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { grace: '10%' }, y2: { position: 'right', grid: { display: false } } } },
  });
  const l = spots[0];
  return html`<${ChartBox} config=${cfg} height=${180} deps=${[spots.length]} />
    <div class="small">Última: <b>${n(l.rmssd)} ms</b> RMSSD · ln ${n(l.lnRMSSD, 2)} · FC ${n(l.hr)} · ${new Date(l.ts * 1000).toLocaleString('es-ES')}</div>`;
}
