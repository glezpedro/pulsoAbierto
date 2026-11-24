import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast, store, n, hm, C, recColor, ZONE_COLORS } from '../core.js';
import { Card, Stat, ChartBox, Md, Empty, Spinner, ZoneTable, Delta } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';

const KPI = [
  ['recovery', 'Recuperación', '%', 0], ['strain', 'Esfuerzo medio', '', 1], ['hrv', 'VFC', 'ms', 0], ['rhr', 'FC reposo', 'lpm', 0],
  ['sleptMin', 'Sueño medio', 'min', 0], ['sleepScore', 'Puntuación sueño', '', 0], ['deepMin', 'Profundo', 'min', 0], ['remMin', 'REM', 'min', 0],
  ['resp', 'Respiración', 'rpm', 1], ['avgStress', 'Estrés', '/3', 1], ['kcal', 'Calorías/día', 'kcal', 0], ['steps', 'Pasos/día', '', 0],
];

function weekLabel(days) {
  const f = (k) => new Date(k + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `${f(days[0])} – ${f(days[6])}`;
}

export function WeeklyView() {
  const list = useApi('/weekly');
  const { status } = useStore();
  const [wk, setWk] = useState(null);
  useEffect(() => { if (!wk && list.data?.weeks?.length) setWk(list.data.weeks[Math.min(1, list.data.weeks.length - 1)]); }, [list.data]);
  const rep = useApi(wk ? `/weekly/${wk}` : null, [wk]);
  const [busy, setBusy] = useState('');
  const r = rep.data;
  const genAI = async () => { setBusy('ai'); try { await api(`/weekly/${wk}/ai`, { method: 'POST' }); rep.reload(); } catch (e) { toast(e.message); } setBusy(''); };
  const send = async () => { setBusy('tg'); try { const x = await api(`/weekly/${wk}/send`, { method: 'POST' }); toast(x.sent ? 'Enviado a Telegram' : 'Telegram no está vinculado'); } catch (e) { toast(e.message); } setBusy(''); };
  return html`<${Page} title="Informe semanal" right=${list.data?.weeks?.length ? html`<select value=${wk || ''} onChange=${(e) => setWk(e.target.value)} style="width:auto">${list.data.weeks.map((w) => html`<option value=${w}>${w}</option>`)}</select>` : null}>
    ${!list.data?.weeks?.length && !list.loading && html`<div class="card"><${Empty} icon="📊" title="Aún no hay semanas con datos" /></div>`}
    ${rep.loading && html`<div class="row"><${Spinner} /> Calculando…</div>`}
    ${r && html`<div class="grid">
      <${Card} span="12">
        <div class="row between"><div><h2>Semana ${r.week}</h2><div class="small muted">${weekLabel(r.days)} · ${r.daysWithData} días con datos</div></div>
          <div class="row"><span class="pill green">🟢 ${r.recoveryBands.green}</span><span class="pill yellow">🟡 ${r.recoveryBands.yellow}</span><span class="pill red">🔴 ${r.recoveryBands.red}</span></div></div>
        <div class="tiles">${KPI.map(([k, l, u, d]) => {
          const x = r.kpis[k]; if (!x || x.cur == null) return null;
          const cur = u === 'min' ? hm(x.cur) : n(x.cur, d);
          return html`<div class="tile"><div class="t">${l}</div><div class="v">${cur}${u && u !== 'min' && html`<small>${u}</small>`}</div>
            <div class="d">${x.prev != null ? html`<${Delta} cur=${x.cur} prev=${x.prev} digits=${d} higherIsBetter=${x.higherIsBetter} /> <span class="muted">vs semana anterior</span>` : html`<span class="muted">sin semana previa</span>`}</div></div>`;
        })}</div><//>
      <${Card} span="7" title="Día a día" icon=${html`<${Icon} n="today" />`}><${Daily} r=${r} /><//>
      <${Card} span="5" title="Resumen del coach" icon=${html`<${Icon} n="spark" />`}>
        ${r.ai ? html`<${Md} text=${r.ai} />` : html`<div class="small muted">${status?.hasAnthropic ? 'Genera un informe redactado con tendencias, qué ha ido bien y objetivos para la próxima semana.' : 'Añade tu clave de Anthropic en Ajustes para el informe redactado.'}</div>`}
        <div class="row">
          ${status?.hasAnthropic && html`<button class="btn small" disabled=${!!busy} onClick=${genAI}>${busy === 'ai' ? html`<span class="spinner"></span>` : html`<${Icon} n="spark" />`}${r.ai ? 'Regenerar' : 'Generar informe IA'}</button>`}
          <button class="btn small" disabled=${!!busy} onClick=${send}><${Icon} n="send" />Enviar a Telegram</button>
        </div><//>
      <${Card} span="4" title="Sueño" icon=${html`<${Icon} n="sleep" />`}>
        <${Stat} k="Dormido en total" v=${hm(r.sleep.sleptMin)} /><${Stat} k="Necesidad total" v=${hm(r.sleep.needMin)} />
        <${Stat} k="Deuda de sueño" v=${html`<span class=${r.sleep.debtMin > 180 ? 'bad' : ''}>${hm(r.sleep.debtMin)}</span>`} />
        <${Stat} k="Hora media de acostarse" v=${clock(r.sleep.avgBed)} /><${Stat} k="Variación al acostarse" v=${`± ${n(r.sleep.bedtimeSD)} min`} />
        <${Stat} k="Hora media de levantarse" v=${clock(r.sleep.avgWake)} /><${Stat} k="Variación al levantarse" v=${`± ${n(r.sleep.wakeSD)} min`} /><//>
      <${Card} span="4" title="Entreno y carga" icon=${html`<${Icon} n="bolt" />`}>
        <${Stat} k="Entrenos" v=${r.training.count} /><${Stat} k="Esfuerzo total" v=${n(r.training.totalStrain)} />
        <${Stat} k="Calorías totales" v=${n(r.training.totalKcal, 0, 'kcal')} /><${Stat} k="Volumen Strong" v=${`${n(r.training.strongVolumeKg / 1000, 1)} t · ${r.training.strongSets} series`} />
        <${Stat} k="Distancia" v=${n(r.training.distanceKm, 1, 'km')} /><${Stat} k="ACWR fin de semana" v=${n(r.load.acwr, 2)} />
        <div class="small"><b>${r.load.status}</b></div><//>
      <${Card} span="4" title="Zonas de FC (semana)" icon=${html`<${Icon} n="heart" />`}><${ZoneTable} zones=${r.training.zones} /><//>
      <${Card} span="6" title="Entrenos de la semana" icon=${html`<${Icon} n="dumbbell" />`}>
        ${r.training.workouts.length ? r.training.workouts.map((w) => html`<a class="list-item" style="color:inherit" href=${`#/entreno?w=${encodeURIComponent(w.uid)}`}>
          <span class="ic"><${Icon} n="dumbbell" /></span><span class="grow"><b>${w.name}</b><div class="small muted">${new Date(w.start * 1000).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${w.source} · ${hm((w.end - w.start) / 60)}</div></span>
          <b style=${{ color: C.strain }}>${n(w.strain, 1)}</b></a>`) : html`<div class="small muted">Sin entrenos registrados.</div>`}<//>
      <${Card} span="6" title="Hábitos y extremos" icon=${html`<${Icon} n="book" />`}>
        ${r.best && html`<${Stat} k="Mejor día" v=${`${r.best.day} · ${n(r.best.recovery)} %`} />`}
        ${r.worst && html`<${Stat} k="Peor día" v=${`${r.worst.day} · ${n(r.worst.recovery)} %`} />`}
        <${Stat} k="Tendencia de VFC" v=${r.hrvSlope == null ? '–' : `${r.hrvSlope > 0 ? '+' : ''}${n(r.hrvSlope, 1)} ms/día`} />
        ${Object.keys(r.habits).length ? html`<div class="chips">${Object.entries(r.habits).map(([k, v]) => html`<span class="chip">${k.replace('_', ' ')} × ${v}</span>`)}</div>` : html`<div class="small muted">Sin hábitos marcados en el diario.</div>`}<//>
    </div>`}
  <//>`;
}

const clock = (m) => (m == null ? '–' : `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, '0')}:${String(Math.round((m + 1440) % 60)).padStart(2, '0')}`);

function Daily({ r }) {
  const d = r.daily;
  const labels = r.days.map((k) => new Date(k + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short' }));
  const cfg = () => ({
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Recuperación', data: d.map((x) => x.recovery ?? null), backgroundColor: d.map((x) => recColor(x.recovery)), borderRadius: 5, yAxisID: 'y' },
      { type: 'line', label: 'Esfuerzo', data: d.map((x) => x.strain ?? null), borderColor: C.strain, pointRadius: 3, yAxisID: 'y2', tension: 0.3 },
      { type: 'line', label: 'Sueño (h)', data: d.map((x) => (x.sleptMin != null ? x.sleptMin / 60 : null)), borderColor: C.sleep, pointRadius: 3, yAxisID: 'y2', tension: 0.3 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 100 }, y2: { position: 'right', min: 0, max: 21, grid: { display: false } } } },
  });
  return html`<${ChartBox} config=${cfg} height=${230} deps=${[r.week]} />
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Día</th><th>Rec.</th><th>Esfuerzo</th><th>VFC</th><th>FC rep.</th><th>Sueño</th><th>Estrés</th><th>kcal</th></tr></thead><tbody>
      ${d.map((x, i) => html`<tr><td>${labels[i]}</td><td style=${{ color: recColor(x.recovery), fontWeight: 700 }}>${n(x.recovery)}</td><td>${n(x.strain, 1)}</td><td>${n(x.hrv)}</td><td>${n(x.rhr)}</td><td>${x.sleptMin != null ? hm(x.sleptMin) : '–'}</td><td>${n(x.avgStress, 1)}</td><td>${n(x.kcal)}</td></tr>`)}
    </tbody></table></div>`;
}
