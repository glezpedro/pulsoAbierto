import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, hm, hmShort, hhmm, dayTitle, addDays, todayKey, isToday, mean, sd, C, needOf, STAGES } from '../core.js';
import { Card, Stat, Ring, ChartBox, timeX, Hypnogram, Empty, Spinner, Bar } from '../ui.js';
import { Page } from '../layout.js';
import { DayNav } from './today.js';
import { Icon } from '../icons.js';

export function SleepView() {
  const { date, status } = useStore();
  const day = useApi(`/day/${date}`, [date]);
  const hist = useApi(`/days?to=${date}&days=30`, [date]);
  const rep = day.data?.report;
  const s = rep?.sleep;
  const m = day.data?.metrics || {};
  return html`<${Page} title="Sueño" right=${html`<${DayNav} />`}>
    ${day.loading && !day.data && html`<div class="row"><${Spinner} /> Cargando…</div>`}
    <div class="grid">
      ${day.data && !s && html`<${Card} span="12"><${Empty} icon="☾" title="No hay sueño principal para este día">Duerme con la pulsera puesta y sincroniza por la mañana desde Bluefy.<//><//>`}
      ${s && html`
        <${Card} span="5"><${ScoreCard} s=${s} m=${m} rep=${rep} /><//>
        <${Card} span="7" title="Hipnograma (estimado)" icon=${html`<${Icon} n="sleep" />`}><${Hypnogram} session=${s} height=${170} /><${Stages} s=${s} /><//>
        <${Card} span="6" title="Fisiología nocturna" icon=${html`<${Icon} n="heart" />`}><${Physio} s=${s} showSpO2=${status?.settings?.showSpO2} /><//>
        <${Card} span="6" title="Calidad" icon=${html`<${Icon} n="report" />`}><${Quality} s=${s} rep=${rep} /><//>
        ${rep.naps?.length > 0 && html`<${Card} span="12" title="Siestas">${rep.naps.map((x) => html`<${Stat} k=${`${hhmm(x.start)} – ${hhmm(x.end)}`} v=${hm(x.stages.filter((v) => v).length)} />`)}<//>`}
      `}
      ${isToday(date) && html`<${Card} span="12" title="Esta noche" icon=${html`<${Icon} n="sleep" />`}><${Tonight} rep=${rep} status=${status} /><//>`}
      ${hist.data && html`<${Card} span="8" title="Últimos 30 días" icon=${html`<${Icon} n="trend" />`}><${History} days=${hist.data} /><//>
      <${Card} span="4" title="Horarios" icon=${html`<${Icon} n="today" />`}><${Schedule} days=${hist.data} /><//>`}
    </div>
  <//>`;
}

function ScoreCard({ s, m, rep }) {
  const sc = rep.sleepScore || {};
  const need = rep.sleepNeed;
  return html`<div class="row" style="gap:18px;align-items:center">
      <div style="width:150px"><${Ring} value=${sc.score} color=${C.sleep} label="PUNTUACIÓN" text=${n(sc.score)} /></div>
      <div class="col grow" style="gap:0">
        <${Stat} k="Dormido" v=${hm(m.sleptMin)} />
        <${Stat} k="Necesidad" v=${hm(m.sleepNeedMin)} />
        <${Stat} k="En cama" v=${`${hhmm(s.start)} – ${hhmm(s.end)}`} />
        <${Stat} k="Rendimiento" v=${`${n(sc.performance)} %`} />
      </div></div>
    <div class="row" style="gap:10px">${[['Eficiencia', sc.efficiency], ['Reparador', sc.restorative], ['Consistencia', sc.consistency]].map(([k, v]) => html`
      <div class="col grow" style="gap:4px"><span class="tiny muted">${k}</span><b class="num">${n(v)}</b><${Bar} value=${v || 0} max=${100} color=${C.sleep} /></div>`)}</div>
    ${need && html`<div class="tiny muted">Necesidad = base ${hm(need.baselineMin)} + esfuerzo ${hm(need.strainMin)} + deuda ${hm(need.debtMin)} − siestas ${hm(need.napCreditMin)}</div>`}`;
}

function Stages({ s }) {
  const tot = s.stages.length || 1;
  const cnt = [0, 1, 2, 3].map((k) => s.stages.filter((x) => x === k).length);
  const ref = { 2: [13, 23], 3: [20, 25], 1: [45, 55], 0: [0, 10] };
  return html`<div class="col" style="gap:6px">${[2, 3, 1, 0].map((k) => html`
    <div class="row" style="gap:8px"><span style=${{ width: '10px', height: '10px', borderRadius: '3px', background: STAGES[k].c }}></span>
      <span class="small grow">${STAGES[k].n}</span><span class="small num">${hm(cnt[k])}</span>
      <span class="small num muted" style="width:44px;text-align:right">${n((cnt[k] / tot) * 100)}%</span>
      <span class="tiny faint hide-mobile" style="width:80px;text-align:right">ref ${ref[k][0]}–${ref[k][1]} %</span></div>`)}</div>`;
}

function Physio({ s, showSpO2 }) {
  const base = s.start * 1000;
  const hr = (s.hrCurve || []).map((v, i) => ({ x: base + i * 60000, y: v }));
  const hrv = (s.hrvCurve || []).map((v, i) => ({ x: base + i * 300000, y: v }));
  const cfg = () => ({
    type: 'line',
    data: { datasets: [
      { label: 'FC', data: hr, borderColor: C.hr, borderWidth: 1.4, pointRadius: 0, tension: 0.3, yAxisID: 'y', spanGaps: true },
      { type: 'bar', label: 'VFC (5 min)', data: hrv, backgroundColor: 'rgba(23,217,102,.45)', yAxisID: 'y2', barPercentage: 1, categoryPercentage: 1 },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { x: timeX(), y: { grace: '8%', title: { display: true, text: 'lpm' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'ms' } } } },
  });
  return html`<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
      <div class="tile"><div class="t">FC reposo</div><div class="v">${n(s.restingHR)}<small>lpm</small></div></div>
      <div class="tile"><div class="t">VFC</div><div class="v">${n(s.hrvRMSSD)}<small>ms</small></div></div>
      <div class="tile"><div class="t">Respiración</div><div class="v">${n(s.respiratoryRate, 1)}<small>rpm</small></div></div>
      <div class="tile"><div class="t">FC media / mín</div><div class="v">${n(s.avgHR)}/${n(s.minHR)}</div></div>
      ${showSpO2 && html`<div class="tile"><div class="t">SpO₂ (exp.)</div><div class="v">${n(s.spo2Estimate)}<small>%</small></div></div>`}
    </div>
    <${ChartBox} config=${cfg} height=${200} deps=${[s.start, s.end]} />`;
}

function Quality({ s, rep }) {
  const stages = s.stages;
  let latency = stages.length, run = 0;
  for (let i = 0; i < stages.length; i++) { run = stages[i] ? run + 1 : 0; if (run === 5) { latency = i - 4; break; } }
  let dist = 0; run = 0;
  for (const x of stages.slice(latency)) { if (!x) run++; else { if (run >= 2) dist++; run = 0; } }
  let remCycles = 0; run = 0; let prev = null;
  for (const x of stages) { if (x === 3) run++; else { if (prev === 3 && run >= 5) remCycles++; run = 0; } prev = x; }
  const asleep = stages.filter((x) => x).length;
  return html`<${Stat} k="Latencia (tiempo en dormirte)" v=${hm(latency)} />
    <${Stat} k="Despertares (≥ 2 min)" v=${dist} />
    <${Stat} k="Tiempo despierto tras dormirte" v=${hm(stages.slice(latency).filter((x) => !x).length)} />
    <${Stat} k="Ciclos REM" v=${remCycles} />
    <${Stat} k="Eficiencia" v=${`${n((asleep / (stages.length || 1)) * 100)} %`} />
    <${Stat} k="Sueño reparador (profundo + REM)" v=${`${hm(stages.filter((x) => x >= 2).length)} · ${n(rep.sleepScore?.restorative)}/100`} />
    <div class="tiny faint">Las fases se estiman con FC, VFC, variabilidad y movimiento; no son una polisomnografía.</div>`;
}

function Tonight({ rep, status }) {
  const need = needOf(rep?.nextNightNeed);
  const wake = status?.profile?.wakeTime || '07:00';
  const [h, mm] = wake.split(':').map(Number);
  const w = new Date(); w.setHours(h, mm, 0, 0); if (w < new Date()) w.setDate(w.getDate() + 1);
  const bed = need ? new Date(w.getTime() - (need / 0.9 + 15) * 60000) : null;
  const save = async (v) => { try { await api('/profile', { method: 'PUT', json: { wakeTime: v } }); store.bump(); toast('Hora de despertar guardada'); } catch (e) { toast(e.message); } };
  return html`<div class="row" style="gap:26px;align-items:flex-end">
    <div><div class="tiny muted">ACUÉSTATE A LAS</div><div class="big-number" style=${{ fontSize: '3rem', color: C.sleep }}>${bed ? bed.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '–'}</div></div>
    <div><div class="tiny muted">PARA DESPERTAR A LAS</div><input type="time" value=${wake} onChange=${(e) => save(e.target.value)} style="width:auto;font-size:1.3rem" /></div>
    <div class="grow small muted" style="min-width:200px">${need ? `Necesitarás ${hm(need)} de sueño: base + esfuerzo de hoy + deuda acumulada. Se calcula con un 90 % de eficiencia y 15 min para dormirte. Recibirás el aviso por Telegram 30 min antes.` : 'Sin datos suficientes para calcular la necesidad de esta noche.'}</div>
  </div>`;
}

function History({ days }) {
  const d = days.filter((x) => x.sleptMin != null);
  const cfg = () => ({
    type: 'bar',
    data: { labels: days.map((x) => x.dayKey.slice(5)), datasets: [
      { label: 'Profundo', data: days.map((x) => (x.deepMin ?? null) && x.deepMin / 60), backgroundColor: C.deep, stack: 's' },
      { label: 'REM', data: days.map((x) => (x.remMin ?? null) && x.remMin / 60), backgroundColor: C.rem, stack: 's' },
      { label: 'Ligero', data: days.map((x) => (x.lightMin ?? null) && x.lightMin / 60), backgroundColor: C.light, stack: 's' },
      { label: 'Despierto', data: days.map((x) => (x.awakeMin ?? null) && x.awakeMin / 60), backgroundColor: C.awake, stack: 's' },
      { type: 'line', label: 'Necesidad', data: days.map((x) => (x.sleepNeedMin ? x.sleepNeedMin / 60 : null)), borderColor: '#fff', borderDash: [4, 4], pointRadius: 2, borderWidth: 1.2 },
    ] },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${hm((c.raw || 0) * 60)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, title: { display: true, text: 'horas' } } } },
  });
  const debt = d.slice(-7).reduce((a, x) => a + Math.max(0, (x.sleepNeedMin || 0) - x.sleptMin), 0);
  return html`<${ChartBox} config=${cfg} height=${240} deps=${[days.length, days[days.length - 1]?.dayKey]} />
    <div class="row" style="gap:18px"><span class="small">Media ${hm(mean(d.map((x) => x.sleptMin)))}</span><span class="small">Puntuación media ${n(mean(d.map((x) => x.sleepScore)))}</span>
    <span class="small">Deuda 7 días <b class=${debt > 120 ? 'bad' : ''}>${hm(debt)}</b></span></div>`;
}

function Schedule({ days }) {
  const toMin = (ts) => { if (!ts) return null; const d = new Date(ts * 1000); let m = d.getHours() * 60 + d.getMinutes(); if (m > 18 * 60) m -= 1440; return m; };
  const beds = days.map((x) => toMin(x.bedtime)), wakes = days.map((x) => toMin(x.wakeTime));
  const fmt = (m) => (m == null ? '–' : `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, '0')}:${String(Math.round((m + 1440) % 60)).padStart(2, '0')}`);
  const cfg = () => ({
    type: 'line',
    data: { labels: days.map((x) => x.dayKey.slice(5)), datasets: [
      { label: 'Acostarse', data: beds, borderColor: C.sleep, pointRadius: 3, showLine: false },
      { label: 'Levantarse', data: wakes, borderColor: C.yellow, pointRadius: 3, showLine: false },
    ] },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { reverse: true, ticks: { callback: (v) => fmt(v) } } } },
  });
  return html`<${ChartBox} config=${cfg} height=${200} deps=${[days.length]} />
    <${Stat} k="Hora media de acostarse" v=${fmt(mean(beds))} /><${Stat} k="Variación" v=${`± ${n(sd(beds))} min`} />
    <${Stat} k="Hora media de levantarse" v=${fmt(mean(wakes))} /><${Stat} k="Variación" v=${`± ${n(sd(wakes))} min`} />`;
}
