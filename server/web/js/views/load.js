import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, n, hm, mean, C, ZONE_COLORS, ZONES, addDays, alpha } from '../core.js';
import { Card, Stat, Ring, ChartBox, ZoneTable, Empty, Seg, Tile } from '../ui.js';
import { Page } from '../layout.js';
import { DayNav } from './today.js';
import { Icon } from '../icons.js';

export function LoadView() {
  const { date, status } = useStore();
  const [range, setRange] = useState(90);
  const day = useApi(`/day/${date}`, [date]);
  const load = useApi(`/load?days=${range}`, [range]);
  const wk = useApi('/workouts?days=60');
  const m = day.data?.metrics || {};
  const st = day.data?.report?.strain;
  const ls = load.data?.series || [];
  const last = ls[ls.length - 1] || {};
  return html`<${Page} title="Esfuerzo y carga" right=${html`<${DayNav} />`}>
    <div class="grid">
      <${Card} span="4"><div style="max-width:200px;margin:0 auto;width:100%"><${Ring} value=${m.strain} max=${21} color=${C.strain} label="ESFUERZO DEL DÍA" text=${n(m.strain, 1)} /></div>
        <${Stat} k="Calorías totales" v=${n(m.kcal, 0, 'kcal')} /><${Stat} k="Calorías activas" v=${n(m.activeKcal, 0, 'kcal')} />
        <${Stat} k="FC media / máx" v=${`${n(m.avgHR)} / ${n(m.maxHR)} lpm`} /><${Stat} k="FC máx teórica" v=${n(status?.hrMax, 0, 'lpm')} /><//>
      <${Card} span="4" title="Zonas de FC del día" icon=${html`<${Icon} n="bolt" />`}>${st ? html`<${ZoneTable} zones=${st.zoneSeconds} />` : html`<div class="small muted">Sin datos.</div>`}
        <div class="tiny faint">Zonas por % de FC máxima (${n(status?.hrMax)} lpm). Cambia la FC máx en Ajustes si la conoces de una prueba.</div><//>
      <${Card} span="4" title="Estado de carga" icon=${html`<${Icon} n="trend" />`}>
        <div class="big-number" style=${{ fontSize: '3.2rem', color: acwrColor(last.acwr) }}>${last.acwr != null ? n(last.acwr, 2) : '–'}</div>
        <div><b>${load.data?.status || ''}</b></div>
        <${Stat} k="Carga aguda (7 d, EWMA)" v=${n(last.acute)} /><${Stat} k="Carga crónica (28 d, EWMA)" v=${n(last.chronic)} />
        <${Stat} k="Monotonía (Foster)" v=${n(last.monotony, 2)} /><${Stat} k="Strain semanal (Foster)" v=${n(last.fosterStrain)} />
        <div class="tiny faint">ACWR = carga aguda ÷ crónica. 0,8–1,3 óptimo; > 1,5 sube el riesgo de lesión (Gabbett). Monotonía > 2 = poca variación entre días.</div><//>
      <${Card} span="12" title="Ratio agudo:crónico" icon=${html`<${Icon} n="trend" />`} right=${html`<${Seg} value=${range} onChange=${setRange} options=${[[42, '6 sem'], [90, '3 m'], [180, '6 m'], [365, '1 año']]} />`}>
        ${ls.length ? html`<${AcwrChart} ls=${ls} />` : html`<${Empty} title="Sin datos de carga" />`}<//>
      <${Card} span="7" title="Esfuerzo diario y recuperación" icon=${html`<${Icon} n="bolt" />`}>${ls.length ? html`<${StrainChart} ls=${ls.slice(-42)} />` : null}<//>
      <${Card} span="5" title="Semanas" icon=${html`<${Icon} n="report" />`}><${Weeks} ls=${ls} /><//>
      <${Card} span="12" title="Entrenos recientes" icon=${html`<${Icon} n="dumbbell" />`} right=${html`<a href="#/entreno" class="small">Todos</a>`}>
        <${WorkoutTable} list=${(wk.data || []).slice(0, 12)} /><//>
    </div>
  <//>`;
}

const acwrColor = (a) => (a == null ? C.muted : a > 1.5 ? C.red : a > 1.3 ? C.yellow : a >= 0.8 ? C.green : C.strain);

function AcwrChart({ ls }) {
  const band = { id: 'band', beforeDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { y } } = c;
    if (!y) return;
    ctx.save();
    ctx.fillStyle = alpha(C.green, 0.1);
    ctx.fillRect(a.left, y.getPixelForValue(1.3), a.right - a.left, y.getPixelForValue(0.8) - y.getPixelForValue(1.3));
    ctx.fillStyle = alpha(C.red, 0.08);
    ctx.fillRect(a.left, a.top, a.right - a.left, Math.max(0, y.getPixelForValue(1.5) - a.top));
    ctx.restore();
  } };
  const cfg = () => ({
    type: 'line', plugins: [band],
    data: { labels: ls.map((x) => x.day.slice(5)), datasets: [
      { label: 'ACWR', data: ls.map((x) => x.acwr), borderColor: C.fg, borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y', spanGaps: true },
      { label: 'Aguda', data: ls.map((x) => x.acute), borderColor: C.orange, borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y2' },
      { label: 'Crónica', data: ls.map((x) => x.chronic), borderColor: C.accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y2', fill: true, backgroundColor: alpha(C.accent, 0.08) },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { min: 0, suggestedMax: 2, title: { display: true, text: 'ACWR' } }, y2: { position: 'right', grid: { display: false }, title: { display: true, text: 'carga' } } } },
  });
  return html`<${ChartBox} config=${cfg} height=${260} deps=${[ls.length, ls[ls.length - 1]?.day]} />
    <div class="legend"><span><i style=${{ background: alpha(C.green, 0.4) }}></i>Zona óptima 0,8–1,3</span><span><i style=${{ background: alpha(C.red, 0.4) }}></i>Riesgo > 1,5</span></div>`;
}

function StrainChart({ ls }) {
  const cfg = () => ({
    type: 'bar',
    data: { labels: ls.map((x) => x.day.slice(5)), datasets: [
      { label: 'Esfuerzo', data: ls.map((x) => x.strain), backgroundColor: C.strain, borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: 'Recuperación', data: ls.map((x) => x.recovery), borderColor: C.green, pointRadius: 2, borderWidth: 1.5, tension: 0.3, yAxisID: 'y2' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { min: 0, max: 21 }, y2: { position: 'right', min: 0, max: 100, grid: { display: false } } } },
  });
  return html`<${ChartBox} config=${cfg} height=${230} deps=${[ls.length]} />`;
}

function Weeks({ ls }) {
  const weeks = [];
  for (let i = ls.length; i > 0 && weeks.length < 8; i -= 7) {
    const sl = ls.slice(Math.max(0, i - 7), i);
    weeks.push({ from: sl[0]?.day, strain: sl.reduce((a, x) => a + (x.strain || 0), 0), load: sl.reduce((a, x) => a + (x.load || 0), 0), rec: mean(sl.map((x) => x.recovery)), kcal: sl.reduce((a, x) => a + (x.kcal || 0), 0) });
  }
  const max = Math.max(1, ...weeks.map((w) => w.load));
  return html`<div class="col" style="gap:8px">${weeks.map((w) => html`<div class="col" style="gap:3px">
    <div class="row between small"><span class="muted">desde ${w.from?.slice(5)}</span><span class="num">esfuerzo ${n(w.strain)} · rec ${n(w.rec)} % · ${n(w.kcal / 1000, 1)}k kcal</span></div>
    <div class="bar"><i style=${{ width: `${(w.load / max) * 100}%`, background: C.strain }}></i></div></div>`)}</div>`;
}

export function WorkoutTable({ list }) {
  if (!list.length) return html`<div class="small muted">Sin entrenos. Importa Strong, conecta Strava o deja que la pulsera los detecte.</div>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Nombre</th><th>Fuente</th><th>Duración</th><th>Esfuerzo</th><th>FC media</th><th>kcal</th><th class="hide-mobile">Zonas</th></tr></thead>
    <tbody>${list.map((w) => html`<tr style="cursor:pointer" onClick=${() => (location.hash = `#/entreno?w=${encodeURIComponent(w.uid)}`)}>
      <td>${new Date(w.start * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${new Date(w.start * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${w.name}</td><td class="muted">${w.source}</td><td>${hm((w.end - w.start) / 60)}</td>
      <td style=${{ color: C.strain, fontWeight: 700 }}>${n(w.strain, 1)}</td><td>${n(w.avg_hr)}</td><td>${n(w.kcal)}</td>
      <td class="hide-mobile" style="min-width:120px">${w.zones?.length ? html`<div class="zonebar">${w.zones.slice(1).map((z, i) => html`<i style=${{ flex: z, background: ZONE_COLORS[i + 1] }}></i>`)}</div>` : ''}</td></tr>`)}</tbody></table></div>`;
}
