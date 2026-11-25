// Sueño — al estilo de la app Salud: D · S · M · 6M · A, cabecera grande que cambia al arrastrar
// por la gráfica, hipnograma por filas, noches como barras flotantes, puntuación, fases, constantes
// vitales nocturnas frente a tu rango habitual, la noche en detalle (FC, VFC, respiración,
// movimiento, temperatura), cuándo duermes mejor, regularidad y destacados.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, hm, hhmm, isToday, mean, C, needOf, STAGES, todayKey, addDays, keyDate, useIsMobile } from '../core.js';
import { Card, Stat, Ring, Empty, Spinner, Seg, Bar } from '../ui.js';
import { Page, SyncButton, SyncProgress } from '../layout.js';
import { Icon } from '../icons.js';
import { SendToHealth } from './health.js';
import { BarChart, Hypnogram, NightsChart, LineChart, RangeDot, StackBar, Gauge, useWidth, ticks } from '../charts.js';
import { PERIODS, rangeOf, rangeTitle, buckets, bucketMean, bucketTitle, RangeNav } from '../period.js';

const ORDER = [0, 3, 1, 2];                      // Despierto, REM, Básico, Profundo (como Salud)
const REF = { 0: [0, 10], 3: [20, 25], 1: [45, 55], 2: [13, 23] };
const KEY = { 0: 'awakeMin', 1: 'lightMin', 2: 'deepMin', 3: 'remMin' };

export function runsOf(stages = []) {
  const out = [];
  for (const s of stages) { if (out.length && out[out.length - 1][0] === s) out[out.length - 1][1]++; else out.push([s, 1]); }
  return out;
}
const hmBig = (min) => {
  if (min == null) return html`–`;
  const x = Math.round(min);
  return x >= 60 ? html`${Math.floor(x / 60)}<small>h</small> ${String(x % 60).padStart(2, '0')}<small>min</small>` : html`${x}<small>min</small>`;
};
const clock = (m) => (m == null ? '–' : `${String(Math.floor((((Math.round(m) % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((Math.round(m) % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`);
export const scoreBand = (v) => (v == null ? null : v >= 96 ? ['Muy alta', C.green] : v >= 81 ? ['Alta', C.green] : v >= 61 ? ['Correcta', C.sleep] : v >= 41 ? ['Baja', C.orange] : ['Muy baja', C.red]);

// =================================================================== page
export function SleepView() {
  const { date, status } = useStore();
  const [period, setPeriodRaw] = useState(() => sessionStorage.getItem('pulso.sleepPeriod') || 'D');
  const [end, setEnd] = useState(date);
  const setPeriod = (p) => { setPeriodRaw(p); try { sessionStorage.setItem('pulso.sleepPeriod', p); } catch { /* ignore */ } if (p !== 'D') setEnd(date); };
  const mobile = useIsMobile();
  const isDay = period === 'D';
  const { frm, to, days } = rangeOf(period, isDay ? date : end);
  const goDay = (k) => { store.set({ date: k }); setPeriod('D'); };
  return html`<div class="page sleep-page">
    <div class="topbar">
      <div><div class="date-sub">${rangeTitle(period, frm, to)}</div><h1>Sueño</h1></div>
      <div class="row" style="gap:6px;margin-top:14px">
        ${isDay ? html`<${DayNavSmall} />` : html`<${RangeNav} period=${period} end=${end} setEnd=${setEnd} />`}
        ${isDay && !mobile && html`<${SendToHealth} date=${date} small />`}
      </div>
    </div>
    <div class="seg seg-full">${PERIODS.map(([v, l]) => html`<button class=${period === v ? 'on' : ''} onClick=${() => setPeriod(v)}>${l}</button>`)}</div>
    <${SyncProgress} />
    ${isDay ? html`<${SleepDay} date=${date} status=${status} mobile=${mobile} />`
      : html`<${SleepRange} period=${period} frm=${frm} to=${to} days=${days} onDay=${goDay} />`}
  </div>`;
}

function DayNavSmall() {
  const { date } = useStore();
  return html`<button class="btn small icon" aria-label="Noche anterior" onClick=${() => store.set({ date: addDays(date, -1) })}><${Icon} n="chevl" /></button>
    <button class="btn small icon" aria-label="Noche siguiente" disabled=${isToday(date)} onClick=${() => store.set({ date: addDays(date, 1) })}><${Icon} n="chev" /></button>`;
}

/** Big Salud-style header: small caps label, huge value, subtitle. */
function BigHeader({ label, value, sub, color = 'var(--sleep)', right }) {
  return html`<div class="bighead">
    <div class="col" style="gap:0">
      <span class="bh-label">${label}</span>
      <span class="bh-value">${value}</span>
      <span class="bh-sub">${sub}</span>
    </div>${right}</div>`;
}

// =================================================================== D (one night)
function SleepDay({ date, status, mobile }) {
  const day = useApi(`/day/${date}`, [date]);
  const ins = useApi(`/sleep/insights?to=${date}&days=30`, [date]);
  const [sel, setSel] = useState(null);
  const rep = day.data?.report;
  const s = rep?.sleep;
  const m = day.data?.metrics || {};
  useEffect(() => setSel(null), [date]);
  if (day.loading && !day.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  if (!s) {
    return html`<div class="grid">
      <div class="span-12"><${SyncButton} big /></div>
      <${Card} span="12"><${Empty} icon="☾" title="No hay sueño registrado esta noche">Duerme con la pulsera puesta y sincroniza por la mañana desde Bluefy. ${isToday(date) ? 'Si ya te has levantado, pulsa «Sincronizar».' : ''}<//><//>
      ${isToday(date) && html`<${Card} span="12" title="Esta noche" icon=${html`<${Icon} n="sleep" />`}><${Tonight} rep=${rep} status=${status} /><//>`}
      ${ins.data && html`<${Highlights} items=${ins.data.highlights} />`}
    </div>`;
  }
  const segs = runsOf(s.stages);
  const facts = nightFacts(s);
  const head = sel
    ? { label: STAGES[sel.stage].n.toUpperCase(), value: hmBig((sel.runEnd - sel.runStart) / 60), sub: `${hhmm(sel.runStart)} – ${hhmm(sel.runEnd)}` }
    : { label: 'TIEMPO DORMIDO', value: hmBig(m.sleptMin), sub: `En cama ${hm(m.inBedMin)} · ${hhmm(s.start)} – ${hhmm(s.end)}` };
  const band = scoreBand(m.sleepScore);
  return html`<div class="grid">
    <section class="card span-8 hero-card" style="--cat:var(--sleep)">
      <${BigHeader} ...${head} right=${band && html`<div class="score-chip" style=${{ '--c': band[1] }}><b>${n(m.sleepScore)}</b><span>${band[0]}</span></div>`} />
      <${Hypnogram} start=${s.start} segs=${segs} height=${mobile ? 170 : 210} onSelect=${setSel} />
      <${StageRows} s=${s} m=${m} avg=${ins.data?.current} />
    </section>
    <${Card} span="4" title="Puntuación de sueño" icon=${html`<${Icon} n="star" />`} color="var(--sleep)"><${ScoreCard} rep=${rep} m=${m} /><//>
    <${Card} span="12" title="La noche en detalle" icon=${html`<${Icon} n="wave" />`} color="var(--heart)"><${NightLanes} s=${s} mobile=${mobile} /><//>
    <${Card} span="6" title="Constantes vitales nocturnas" icon=${html`<${Icon} n="heart" />`} color="var(--heart)">${ins.data ? html`<${Vitals} v=${ins.data.vitals} />` : html`<${Spinner} />`}<//>
    <${Card} span="6" title="Datos de la noche" icon=${html`<${Icon} n="clock" />`} color="var(--sleep)"><${NightFactsCard} f=${facts} m=${m} rep=${rep} /><//>
    ${ins.data && html`<${Highlights} items=${ins.data.highlights} />`}
    ${ins.data && html`<${Card} span="7" title="Cuándo duermes mejor" icon=${html`<${Icon} n="bed" />`} color="var(--sleep)"><${BestTimes} ins=${ins.data} /><//>`}
    ${ins.data && html`<${Card} span="5" title="Horario y regularidad" icon=${html`<${Icon} n="calendar" />`} color="var(--mind)"><${Schedule} ins=${ins.data} /><//>`}
    ${isToday(date) && html`<${Card} span="12" title="Esta noche" icon=${html`<${Icon} n="sleep" />`}><${Tonight} rep=${rep} status=${status} /><//>`}
    ${rep.naps?.length > 0 && html`<${Card} span="12" title="Siestas" icon=${html`<${Icon} n="sun" />`} color="var(--activity)">${rep.naps.map((x) => html`<${Stat} k=${`${hhmm(x.start)} – ${hhmm(x.end)}`} v=${hm(x.stages.filter((v) => v).length)} />`)}<//>`}
    ${mobile && html`<div class="span-12"><${SendToHealth} date=${date} /></div>`}
    <${About} />
  </div>`;
}

function StageRows({ s, m, avg }) {
  const tot = s.stages.length || 1;
  const cnt = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const x of s.stages) cnt[x]++;
  return html`<div class="col" style="gap:8px">
    <${StackBar} parts=${ORDER.map((k) => ({ v: cnt[k], c: STAGES[k].c, n: STAGES[k].n }))} />
    <div class="stage-grid">${ORDER.map((k) => {
      const pct = (cnt[k] / tot) * 100;
      const a = avg?.[KEY[k]];
      return html`<div class="stage-cell">
        <div class="row" style="gap:6px"><i class="sw" style=${{ background: STAGES[k].c }}></i><span class="small">${STAGES[k].n}</span></div>
        <div class="stage-v">${hmBig(cnt[k])}</div>
        <div class="tiny muted">${n(pct)} % · ref. ${REF[k][0]}–${REF[k][1]} %${a != null ? ` · media ${hm(a)}` : ''}</div>
      </div>`;
    })}</div></div>`;
}

function ScoreCard({ rep, m }) {
  const sc = rep.sleepScore || {};
  const need = rep.sleepNeed;
  const band = scoreBand(sc.score);
  const rows = [
    ['Duración', sc.performance, `${hm(m.sleptMin)} de ${hm(m.sleepNeedMin)} que necesitabas`],
    ['Eficiencia', sc.efficiency, 'Tiempo dormido respecto al tiempo en la cama'],
    ['Sueño reparador', sc.restorative, 'Profundo + REM (objetivo ≈ 40 %)'],
    ['Regularidad', sc.consistency, 'Parecido de tus horarios con los días anteriores'],
  ];
  return html`<div class="col" style="gap:10px">
    <div class="row" style="gap:14px;align-items:center;flex-wrap:nowrap">
      <div style="width:118px;flex:none"><${Ring} value=${sc.score} color=${band?.[1] || C.sleep} label="" text=${n(sc.score)} size=${118} /></div>
      <div class="col" style="gap:2px"><b style=${{ color: band?.[1], fontSize: '1.15rem' }}>${band?.[0] || '–'}</b>
        <span class="small muted">${sc.score >= 81 ? 'Has dormido bien: buen punto de partida para hoy.' : sc.score >= 61 ? 'Noche correcta. Hay margen en duración o regularidad.' : 'Noche floja: prioriza descansar y acuéstate antes hoy.'}</span></div>
    </div>
    ${rows.map(([k, v, d]) => html`<div class="col" style="gap:4px">
      <div class="row between small"><span>${k}</span><b class="num">${n(v)}</b></div>
      <${Bar} value=${v || 0} max=${100} color=${C.sleep} />
      <span class="tiny muted">${d}</span></div>`)}
    ${need && html`<div class="tiny faint">Necesidad ${hm(m.sleepNeedMin)} = base ${hm(need.baselineMin)} + esfuerzo ${hm(need.strainMin)} + deuda ${hm(need.debtMin)} − siestas ${hm(need.napCreditMin)}</div>`}
  </div>`;
}

// ------------------------------------------------------------ night lanes (synchronised scrub)
function NightLanes({ s, mobile }) {
  const ser = useApi(`/series?frm=${s.start}&to=${s.end}&step=300`, [s.start, s.end]);
  const [cursor, setCursor] = useState(null);
  const hr = (s.hrCurve || []).map((v, i) => ({ t: s.start + i * 60, v }));
  const pts = ser.data || [];
  const lanes = [
    { k: 'hr', label: 'Frecuencia cardiaca', unit: 'lpm', color: C.hr, data: hr, dec: 0, gap: 600 },
    { k: 'hrv', label: 'VFC (RMSSD)', unit: 'ms', color: C.green, data: (s.hrvCurve || []).map((v, i) => ({ t: s.start + i * 300, v })), dec: 0, bars: true },
    { k: 'resp', label: 'Respiración', unit: 'rpm', color: C.resp, data: pts.map((p) => ({ t: p.t, v: p.resp })), dec: 1, gap: 1800 },
    { k: 'motion', label: 'Movimiento', unit: '', color: C.orange, data: pts.map((p) => ({ t: p.t, v: p.motion })), dec: 0, bars: true },
    { k: 'temp', label: 'Temperatura de la piel', unit: '', color: C.body, data: pts.map((p) => ({ t: p.t, v: p.temp })), dec: 0, gap: 1800, rel: true },
  ].filter((l) => l.data.some((p) => p.v != null));
  const valueAt = (l, t) => {
    let best = null, bd = Infinity;
    for (const p of l.data) { if (p.v == null) continue; const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
    return best && bd <= (l.bars ? 300 : 900) ? best.v : null;
  };
  const stageAt = (t) => s.stages[Math.floor((t - s.start) / 60)];
  const minHR = hr.reduce((a, p) => (p.v != null && (!a || p.v < a.v) ? p : a), null);
  return html`<div class="col" style="gap:10px">
    <div class="lane-readout">
      ${cursor ? html`<b>${hhmm(cursor)}</b><span class="pill" style=${{ background: STAGES[stageAt(cursor)]?.c, color: '#fff' }}>${STAGES[stageAt(cursor)]?.n || '–'}</span>`
        : html`<span class="small muted">Arrastra por las gráficas para ver cada momento de la noche${minHR ? ` · FC mínima ${n(minHR.v)} lpm a las ${hhmm(minHR.t)}` : ''}</span>`}
    </div>
    <${Lanes} s=${s} lanes=${lanes} cursor=${cursor} setCursor=${setCursor} valueAt=${valueAt} mobile=${mobile} loading=${ser.loading} />
  </div>`;
}

function Lanes({ s, lanes, cursor, setCursor, valueAt, mobile, loading }) {
  const [ref, W] = useWidth();
  const padL = 0, padR = 46, laneH = mobile ? 64 : 76, gapH = 30, stripH = 14;
  const iw = Math.max(10, W - padR - padL);
  const t0 = s.start, t1 = s.end;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const H = stripH + 8 + lanes.length * (laneH + gapH) + 18;
  const runs = runsOf(s.stages);
  const onMove = (e) => {
    if (e.pointerType !== 'mouse' && !e.buttons && e.type === 'pointermove') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const t = t0 + Math.max(0, Math.min(1, (px - padL) / iw)) * (t1 - t0);
    setCursor(Math.round(t));
  };
  const hours = [];
  for (let t = Math.ceil(t0 / 3600) * 3600; t < t1; t += 3600) hours.push(t);
  const every = Math.max(1, Math.ceil(hours.length / Math.max(2, Math.floor(iw / 44))));
  let acc = 0;
  return html`<div ref=${ref} class="hkchart">
    <svg width=${W} height=${H} style="display:block;touch-action:pan-y" onPointerMove=${onMove} onPointerDown=${onMove}
      onPointerLeave=${(e) => e.pointerType === 'mouse' && setCursor(null)} onPointerCancel=${() => setCursor(null)}>
      ${runs.map(([st, len]) => { const a = acc; acc += len; return html`<rect x=${x(t0 + a * 60)} width=${Math.max(0.8, x(t0 + acc * 60) - x(t0 + a * 60) + 0.3)} y="0" height=${stripH} fill=${STAGES[st].c} />`; })}
      ${lanes.map((l, i) => {
        const top = stripH + 8 + i * (laneH + gapH) + gapH - 8;
        const vals = l.data.map((p) => p.v).filter((v) => v != null);
        if (!vals.length) return null;
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (l.bars) lo = 0;
        const pad = (hi - lo) * 0.12 || 1;
        if (!l.bars) lo -= pad;
        hi += pad;
        const y = (v) => top + laneH - ((v - lo) / (hi - lo)) * laneH;
        const tk = ticks(lo, hi, 2).filter((v) => v >= lo && v <= hi);
        const cur = cursor != null ? valueAt(l, cursor) : null;
        const avgV = mean(vals);
        const lbl = cur != null ? `${n(cur, l.dec)} ${l.unit}` : l.rel ? 'relativa' : `media ${n(avgV, l.dec)} ${l.unit}`;
        let path = '';
        if (!l.bars) {
          let prev = null;
          for (const p of l.data) {
            if (p.v == null) { prev = null; continue; }
            path += `${prev && p.t - prev.t <= (l.gap || 900) ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
            prev = p;
          }
        }
        const bw = l.bars && l.data.length > 1 ? Math.max(1, (x(l.data[1].t) - x(l.data[0].t)) * 0.7) : 2;
        return html`<g>
          <text x="0" y=${top - 8} class="lane-t" style=${{ fill: l.color }}>${l.label}</text>
          <text x=${iw} y=${top - 8} class="lane-v" text-anchor="end">${lbl}</text>
          ${tk.map((v) => html`<g><line x1=${padL} x2=${padL + iw} y1=${y(v)} y2=${y(v)} class="grid" />${!l.rel && html`<text x=${padL + iw + 6} y=${y(v) + 4} class="axis">${n(v)}</text>`}</g>`)}
          ${l.bars ? l.data.map((p) => (p.v == null ? null : html`<rect x=${x(p.t) - bw / 2} width=${bw} y=${y(p.v)} height=${Math.max(1, top + laneH - y(p.v))} rx="1.5" fill=${l.color} opacity="0.85" />`))
            : html`<path d=${path} fill="none" stroke=${l.color} stroke-width="1.8" stroke-linejoin="round" />`}
          ${cur != null && html`<circle cx=${x(cursor)} cy=${y(cur)} r="4.5" fill=${l.color} stroke="var(--panel)" stroke-width="2" />`}
        </g>`;
      })}
      ${hours.map((t, i) => (i % every === 0 ? html`<text x=${x(t)} y=${H - 4} class="axis" text-anchor="middle">${new Date(t * 1000).getHours()}:00</text>` : null))}
      ${cursor != null && html`<line x1=${x(cursor)} x2=${x(cursor)} y1="0" y2=${H - 16} class="cursor" />`}
    </svg>
    ${loading && html`<div class="row small muted"><${Spinner} /> Cargando respiración, movimiento y temperatura…</div>`}
  </div>`;
}

// ------------------------------------------------------------ vitals
export function Vitals({ v }) {
  if (!v || v.nights < 5) return html`<div class="small muted">Con 5 noches registradas Pulso calcula tu rango habitual de cada constante (como la app Constantes del Apple Watch). Llevas ${v?.nights ?? 0}.</div>`;
  const colors = { rhr: C.hr, hrv: C.green, resp: C.resp, sleepAvgHR: C.hr, skinTemp: C.body, sleptMin: C.sleep };
  const fmt = (r, x) => (x == null ? '–' : r.key === 'sleptMin' ? hm(x) : r.key === 'skinTemp' ? '' : `${n(x, r.decimals)} ${r.unit}`);
  return html`<div class="col" style="gap:2px">
    <div class="row between small"><span class="muted">Comparado con tus últimas ${v.nights} noches</span>
      <span class=${`pill ${v.outliers >= 2 ? 'yellow' : v.outliers ? 'yellow' : 'green'}`}>${v.outliers ? `${v.outliers} fuera de rango` : 'Todo en tu rango'}</span></div>
    ${v.rows.filter((r) => r.lo != null).map((r) => html`<div class="vital-row">
      <div class="col" style="gap:0;min-width:0"><span class="small">${r.label}</span>
        <span class="tiny muted">${r.key === 'skinTemp' ? 'Relativa a tu media' : `Habitual ${fmt(r, r.lo)} – ${fmt(r, r.hi)}`}</span></div>
      <div class="col" style="gap:4px;align-items:flex-end">
        <span class="num"><b>${r.key === 'skinTemp' ? (r.state ? r.state.charAt(0).toUpperCase() + r.state.slice(1) : '–') : fmt(r, r.value)}</b>
          ${r.state && r.key !== 'skinTemp' && html` <span class=${`tiny ${r.state === 'típico' ? 'muted' : 'warn'}`}>${r.state}</span>`}</span>
        <div style="width:120px"><${RangeDot} lo=${r.lo} hi=${r.hi} min=${r.min} max=${r.max} value=${r.value} color=${colors[r.key]} state=${r.state} /></div>
      </div></div>`)}
    ${v.note && html`<div class="note warn-note small">${v.note}</div>`}
  </div>`;
}

// ------------------------------------------------------------ facts
function nightFacts(s) {
  const st = s.stages;
  let lat = st.length, run = 0;
  for (let i = 0; i < st.length; i++) { run = st[i] ? run + 1 : 0; if (run === 5) { lat = i - 4; break; } }
  let lastSleep = st.length - 1;
  while (lastSleep > 0 && !st[lastSleep]) lastSleep--;
  let wakes = 0; run = 0;
  for (const x of st.slice(lat)) { if (!x) run++; else { if (run >= 2) wakes++; run = 0; } }
  let cycles = 0; run = 0; let prev = null;
  for (const x of st) { if (x === 3) run++; else { if (prev === 3 && run >= 5) cycles++; run = 0; } prev = x; }
  const minHR = (s.hrCurve || []).reduce((a, v, i) => (v != null && (a == null || v < a.v) ? { v, i } : a), null);
  return {
    bed: s.start, onset: s.start + lat * 60, finalWake: s.start + (lastSleep + 1) * 60, up: s.end, latency: lat, wakes,
    waso: st.slice(lat, lastSleep + 1).filter((x) => !x).length, cycles, asleep: st.filter((x) => x).length,
    eff: (st.filter((x) => x).length / (st.length || 1)) * 100, minHR, deepFirstHalf: st.slice(0, st.length / 2).filter((x) => x === 2).length,
    deep: st.filter((x) => x === 2).length,
  };
}

function NightFactsCard({ f, m, rep }) {
  return html`<div class="timeline">
      ${[['bed', 'En la cama', f.bed], ['sleep', 'Te dormiste', f.onset], ['sun', 'Te despertaste', f.finalWake], ['today', 'Fin del registro', f.up]].map(([ic, k, t]) => html`
        <div class="tl-item"><span class="tl-ic"><${Icon} n=${ic} size=${15} /></span><span class="grow small">${k}</span><b class="num">${hhmm(t)}</b></div>`)}
    </div>
    <${Stat} k="Tiempo en dormirte" v=${hm(f.latency)} />
    <${Stat} k="Despertares (≥ 2 min)" v=${f.wakes} />
    <${Stat} k="Despierto tras dormirte" v=${hm(f.waso)} />
    <${Stat} k="Eficiencia" v=${`${n(f.eff)} %`} />
    <${Stat} k="Ciclos de REM" v=${f.cycles} />
    <${Stat} k="Sueño profundo en la 1.ª mitad" v=${f.deep ? `${n((f.deepFirstHalf / f.deep) * 100)} %` : '–'} />
    ${f.minHR && html`<${Stat} k="FC mínima" v=${`${n(f.minHR.v)} lpm · ${hhmm(rep.sleep.start + f.minHR.i * 60)}`} />`}
    <div class="tiny faint">Las fases se estiman con la frecuencia cardiaca, la VFC y el movimiento; no son una polisomnografía. Lo normal es que el sueño profundo se concentre en la primera mitad de la noche y el REM en la segunda.</div>`;
}

// ------------------------------------------------------------ highlights & best times
const HL_COLOR = { sleep: 'var(--sleep)', activity: 'var(--activity)', mind: 'var(--mind)', red: 'var(--red)', green: 'var(--green)' };
export function Highlights({ items = [], span = 12 }) {
  if (!items.length) return null;
  return html`<div class=${`span-${span} col`} style="gap:10px">
    <div class="section-title">Destacados</div>
    <div class="hl-grid">${items.map((h) => html`<div class="hk-card hl" style=${{ '--cat': HL_COLOR[h.cat] || 'var(--sleep)' }}>
      <div class="hk-head"><span class="hk-cat"><${Icon} n=${h.icon} size=${16} /> ${h.title}</span></div>
      <div class="hl-text">${h.text}</div></div>`)}</div>
  </div>`;
}

function BestTimes({ ins }) {
  const [mode, setMode] = useState('bed');
  const [sel, setSel] = useState(null);
  const bins = { bed: ins.bedtimeBins, wake: ins.wakeBins, dur: ins.durationBins }[mode] || [];
  const best = { bed: ins.bestBedtime, wake: ins.bestWake, dur: ins.bestDuration }[mode];
  const unit = ins.outcome === 'recovery' ? '%' : '';
  const what = ins.outcome === 'recovery' ? 'recuperación' : 'puntuación de sueño';
  const shown = bins.filter((b) => b.n >= 1);
  const items = shown.map((b) => ({ key: b.label, label: mode === 'dur' ? b.label.split('–')[0] : b.label.split('–')[0], value: b.mean,
    color: best && b.from === best.from ? C.green : C.sleep, dim: b.n < 2 }));
  const cur = sel != null ? shown[sel] : best;
  if (ins.historyNights < 7) return html`<div class="small muted">Con al menos una semana de noches, Pulso te dirá a qué hora te acuestas y te levantas cuando mejor te recuperas al día siguiente. Llevas ${ins.historyNights}.</div>`;
  return html`<div class="col" style="gap:10px">
    <${Seg} value=${mode} onChange=${(v) => { setMode(v); setSel(null); }} options=${[['bed', 'Acostarte'], ['wake', 'Levantarte'], ['dur', 'Horas']]} />
    <div class="row between" style="align-items:flex-end">
      <div class="col" style="gap:0"><span class="bh-label">${sel != null ? (mode === 'dur' ? 'DURMIENDO' : mode === 'bed' ? 'ACOSTÁNDOTE' : 'LEVANTÁNDOTE') : 'TU MEJOR FRANJA'}</span>
        <span class="bh-value" style="font-size:1.7rem">${cur ? cur.label : '–'}</span></div>
      <div class="col" style="gap:0;align-items:flex-end"><span class="bh-label">${what.toUpperCase()}</span>
        <span class="bh-value" style="font-size:1.7rem;color:var(--green)">${cur ? `${n(cur.mean)}${unit}` : '–'}</span>
        <span class="tiny muted">${cur ? `${cur.n} noches` : ''}</span></div>
    </div>
    <${BarChart} items=${items} height=${170} yMin=${0} yMax=${ins.outcome === 'recovery' ? 100 : 100} onSelect=${setSel} />
    <div class="tiny faint">Media de tu ${what} del día siguiente según ${mode === 'bed' ? 'la hora a la que te acostaste' : mode === 'wake' ? 'la hora a la que te levantaste' : 'las horas que dormiste'} (últimas ${ins.historyNights} noches). Las barras claras tienen una sola noche: tómalas con cautela.</div>
  </div>`;
}

function Schedule({ ins }) {
  const c = ins.current || {};
  const sri = ins.sri;
  const sriTxt = sri == null ? null : sri >= 85 ? ['Muy regular', C.green] : sri >= 70 ? ['Regular', C.sleep] : sri >= 55 ? ['Algo irregular', C.orange] : ['Irregular', C.red];
  const chrono = { madrugador: 'Madrugador: tu cuerpo prefiere acostarse y levantarse pronto.', intermedio: 'Intermedio: ni alondra ni búho.', 'noctámbulo': 'Noctámbulo: tu reloj interno va retrasado; la luz de la mañana te ayuda a adelantarlo.' };
  return html`<div class="col" style="gap:8px">
    <div class="row" style="gap:16px;flex-wrap:nowrap">
      <div class="col" style="gap:0;align-items:center;flex:none">
        <${Gauge} value=${sri} color=${sriTxt?.[1] || C.mind} size=${120} text=${sri == null ? '–' : n(sri)} />
        <span class="tiny" style=${{ color: sriTxt?.[1] }}>${sriTxt ? sriTxt[0] : 'Faltan noches seguidas'}</span>
      </div>
      <div class="col grow" style="gap:0">
        <${Stat} k="Te acuestas" v=${html`<b>${clock(c.bedtime)}</b> ±${n(c.bedtimeSD)} min`} />
        <${Stat} k="Te levantas" v=${html`<b>${clock(c.wake)}</b> ±${n(c.wakeSD)} min`} />
      </div>
    </div>
    <${Stat} k="Punto medio del sueño" v=${clock(c.midSleep)} />
    ${ins.socialJetlag != null && html`<${Stat} k="Jet lag social (fin de semana)" v=${`${ins.socialJetlag > 0 ? '+' : ''}${n(ins.socialJetlag)} min`} />`}
    ${ins.chronotype && html`<${Stat} k="Cronotipo" v=${ins.chronotype.charAt(0).toUpperCase() + ins.chronotype.slice(1)} />`}
    <div class="tiny faint">El índice de regularidad (SRI) es la probabilidad de estar en el mismo estado —dormido o despierto— a la misma hora en días seguidos. Dormir con horarios regulares se asocia a mejor salud, incluso más que dormir más horas. ${ins.chronotype ? chrono[ins.chronotype] : ''}</div>
  </div>`;
}

// ------------------------------------------------------------ tonight & about
export function Tonight({ rep, status }) {
  const need = needOf(rep?.nextNightNeed);
  const wake = status?.profile?.wakeTime || '07:00';
  const [h, mm] = wake.split(':').map(Number);
  const w = new Date(); w.setHours(h, mm, 0, 0); if (w < new Date()) w.setDate(w.getDate() + 1);
  const bed = need ? new Date(w.getTime() - (need / 0.9 + 15) * 60000) : null;
  const save = async (v) => { try { await api('/profile', { method: 'PUT', json: { wakeTime: v } }); store.bump(); toast('Hora de despertar guardada'); } catch (e) { toast(e.message); } };
  return html`<div class="tonight">
    <div class="tn-box"><span class="bh-label">ACUÉSTATE A LAS</span><span class="tn-big" style=${{ color: C.sleep }}>${bed ? bed.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '–'}</span></div>
    <div class="tn-box"><span class="bh-label">PARA DESPERTAR A LAS</span><input type="time" value=${wake} onChange=${(e) => save(e.target.value)} class="tn-input" /></div>
    <div class="grow small muted" style="min-width:200px">${need ? `Necesitarás ${hm(need)} de sueño: tu base, más el esfuerzo de hoy y la deuda acumulada. Contamos un 90 % de eficiencia y 15 min para dormirte. Por Telegram te avisamos 30 min antes.` : 'Sin datos suficientes para calcular la necesidad de esta noche.'}</div>
  </div>`;
}

function About() {
  return html`<details class="card span-12 about">
    <summary><${Icon} n="info" size=${16} /> Acerca de las fases del sueño</summary>
    <div class="small col" style="gap:8px">
      <p><b style=${{ color: STAGES[0].c }}>Despierto</b>: breves despertares, normales varias veces por noche; casi nunca los recuerdas.</p>
      <p><b style=${{ color: STAGES[3].c }}>REM</b>: el cerebro está muy activo y sueñas. Consolida la memoria y regula las emociones. Domina la segunda mitad de la noche (20–25 %).</p>
      <p><b style=${{ color: STAGES[1].c }}>Básico</b> (ligero, N1–N2): la mayor parte de la noche (45–55 %). Baja la temperatura y la frecuencia cardiaca.</p>
      <p><b style=${{ color: STAGES[2].c }}>Profundo</b> (N3): el más reparador para el cuerpo; se libera hormona del crecimiento. Se concentra al principio de la noche (13–23 %) y disminuye con la edad.</p>
      <p class="muted">Pulso estima las fases con la frecuencia cardiaca, la VFC y el movimiento de la pulsera; es una aproximación, como la de cualquier reloj o pulsera, no un estudio del sueño en laboratorio.</p>
    </div>
  </details>`;
}

// =================================================================== S · M · 6M · A
function SleepRange({ period, frm, to, days, onDay }) {
  const daily = period === 'S' || period === 'M';
  const nights = useApi(daily ? `/sleep/nights?frm=${frm}&to=${to}` : null, [frm, to]);
  const rows = useApi(`/days?frm=${frm}&to=${to}`, [frm, to]);
  const ins = useApi(`/sleep/insights?to=${to}&days=${days}`, [to, days]);
  const [mode, setMode] = useState('fases');
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [frm, to, period]);
  const list = rows.data || [];
  const bks = buckets(period, list);
  const c = ins.data?.current;
  if (rows.loading && !rows.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  if (!list.some((d) => d.sleptMin)) return html`<${Card}><${Empty} icon="☾" title="Sin noches en este periodo">Duerme con la pulsera y sincroniza desde Bluefy.<//><//>`;
  const sb = sel != null ? bks[sel] : null;
  const label = sb ? (daily ? 'TIEMPO DORMIDO' : 'MEDIA DORMIDO') : 'MEDIA DE TIEMPO DORMIDO';
  const value = hmBig(sb ? bucketMean(sb, 'sleptMin') : c?.sleptMin ?? mean(list.map((d) => d.sleptMin)));
  const sub = sb ? bucketTitle(period, sb) : `En cama ${hm(c?.inBedMin)} de media · ${c?.nights ?? '–'} noches`;
  const ns = (nights.data || []).map((x) => ({ ...x, label: daily ? (period === 'S' ? 'DLMXJVS'[keyDate(x.day).getDay()] : String(keyDate(x.day).getDate())) : '' }));
  const amountItems = bks.map((b) => ({ key: b.key, label: b.label, segs: [2, 1, 3, 0].map((k) => ({ v: (bucketMean(b, KEY[k]) || 0) / 60, c: STAGES[k].c })) }));
  const needAvg = mean(list.map((d) => d.sleepNeedMin));
  const scoreItems = bks.map((b) => ({ key: b.key, label: b.label, value: bucketMean(b, 'sleepScore'), color: (scoreBand(bucketMean(b, 'sleepScore')) || [])[1] }));
  return html`<div class="grid">
    <section class="card span-8 hero-card" style="--cat:var(--sleep)">
      <${BigHeader} label=${label} value=${value} sub=${sub} right=${daily && html`<${Seg} value=${mode} onChange=${setMode} options=${[['fases', 'Fases'], ['horas', 'Horas']]} />`} />
      ${daily && mode === 'fases' ? (nights.data ? html`<${NightsChart} nights=${ns} height=${250} onSelect=${setSel} />` : html`<${Spinner} />`)
        : html`<${BarChart} items=${amountItems} height=${230} yFmt=${(v) => `${v}h`} goal=${needAvg ? needAvg / 60 : null} goalLabel="Necesidad" onSelect=${setSel} />`}
      <div class="legend">${ORDER.map((s) => html`<span><i style=${{ background: STAGES[s].c }}></i>${STAGES[s].n}</span>`)}</div>
      ${daily && html`<div class="tiny muted">Toca una noche para seleccionarla · <a href="#" onClick=${(e) => { e.preventDefault(); if (sb) onDay(sb.key); }} class=${sb ? '' : 'muted'}>${sb ? `Ver la noche del ${bucketTitle(period, sb).toLowerCase()} ›` : 'luego «Ver la noche»'}</a></div>`}
    </section>
    <${Card} span="4" title="Promedios" icon=${html`<${Icon} n="sleep" />`} color="var(--sleep)">${c ? html`<${RangeAverages} c=${c} p=${ins.data.previous} />` : html`<${Spinner} />`}<//>
    <${Card} span="6" title="Puntuación de sueño" icon=${html`<${Icon} n="star" />`} color="var(--sleep)">
      <div class="row between"><span class="bh-value" style="font-size:1.8rem">${n(c?.sleepScore)}</span><span class="small muted">media del periodo</span></div>
      <${BarChart} items=${scoreItems} height=${150} yMin=${0} yMax=${100} /><//>
    <${Card} span="6" title="Constantes nocturnas" icon=${html`<${Icon} n="heart" />`} color="var(--heart)"><${VitalsTrend} bks=${bks} /><//>
    ${ins.data && html`<${Highlights} items=${ins.data.highlights} />`}
    ${ins.data && html`<${Card} span="7" title="Cuándo duermes mejor" icon=${html`<${Icon} n="bed" />`} color="var(--sleep)"><${BestTimes} ins=${ins.data} /><//>`}
    ${ins.data && html`<${Card} span="5" title="Horario y regularidad" icon=${html`<${Icon} n="calendar" />`} color="var(--mind)"><${Schedule} ins=${ins.data} /><//>`}
    ${daily && html`<${Card} span="12" title="Todas las noches" icon=${html`<${Icon} n="report" />`} color="var(--sleep)"><${NightsTable} rows=${list} onDay=${onDay} /><//>`}
  </div>`;
}

function RangeAverages({ c, p }) {
  const d = (k, unit = 'min', better = true) => {
    if (c[k] == null || p?.[k] == null) return '';
    const x = c[k] - p[k];
    if (Math.abs(x) < 1) return '';
    const good = (x > 0) === better;
    return html` <span class=${`tiny ${good ? 'good' : 'bad'}`}>${x > 0 ? '▲' : '▼'} ${unit === 'min' ? hm(Math.abs(x)) : n(Math.abs(x))}</span>`;
  };
  const tot = (c.deepMin || 0) + (c.remMin || 0) + (c.lightMin || 0) + (c.awakeMin || 0);
  return html`<div class="col" style="gap:6px">
    <${StackBar} parts=${ORDER.map((k) => ({ v: c[KEY[k]], c: STAGES[k].c, n: STAGES[k].n }))} />
    ${ORDER.map((k) => html`<div class="row" style="gap:8px"><i class="sw" style=${{ background: STAGES[k].c }}></i><span class="small grow">${STAGES[k].n}</span>
      <b class="small num">${hm(c[KEY[k]])}</b><span class="tiny muted num" style="width:38px;text-align:right">${tot ? n((c[KEY[k]] / tot) * 100) : '–'} %</span></div>`)}
    <${Stat} k="Dormido" v=${html`<b>${hm(c.sleptMin)}</b>${d('sleptMin')}`} />
    <${Stat} k="Necesidad" v=${hm(c.sleepNeedMin)} />
    <${Stat} k="Deuda acumulada" v=${html`<b class=${c.debt > 120 ? 'bad' : ''}>${hm(c.debt)}</b>`} />
    <${Stat} k="Eficiencia" v=${`${n(c.efficiency)} %`} />
    <${Stat} k="Despertares por noche" v=${n(c.wakeups, 1)} />
    <${Stat} k="Tiempo en dormirte" v=${hm(c.latencyMin)} />
    ${c.napMin > 0 && html`<${Stat} k="Siestas (media)" v=${hm(c.napMin)} />`}
    <div class="tiny faint">Flechas: diferencia con el periodo anterior.</div>
  </div>`;
}

function VitalsTrend({ bks }) {
  const [k, setK] = useState('rhr');
  const cfg = { rhr: ['FC en reposo', 'lpm', C.hr, 0], hrv: ['VFC', 'ms', C.green, 0], resp: ['Respiración', 'rpm', C.resp, 1], sleepAvgHR: ['FC durmiendo', 'lpm', C.hr, 0] }[k];
  const items = bks.map((b) => ({ key: b.key, label: b.label, value: bucketMean(b, k) }));
  const vals = items.map((x) => x.value).filter((v) => v != null);
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const pad = (hi - lo) * 0.3 || 1;
  return html`<div class="col" style="gap:8px">
    <${Seg} value=${k} onChange=${setK} options=${[['rhr', 'FC reposo'], ['hrv', 'VFC'], ['resp', 'Resp.'], ['sleepAvgHR', 'FC noche']]} />
    <div class="row between"><span class="bh-value" style=${{ fontSize: '1.8rem', color: cfg[2] }}>${n(mean(vals), cfg[3])}<small> ${cfg[1]}</small></span><span class="small muted">${cfg[0]} · media</span></div>
    <${BarChart} items=${items} color=${cfg[2]} height=${150} yMin=${Math.max(0, Math.floor(lo - pad))} yMax=${Math.ceil(hi + pad)} base=${Math.max(0, Math.floor(lo - pad))} />
  </div>`;
}

function NightsTable({ rows, onDay }) {
  const list = rows.filter((d) => d.sleptMin).slice().reverse();
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Noche</th><th>Acostarte</th><th>Levantarte</th><th>Dormido</th><th class="hide-mobile">Profundo</th><th class="hide-mobile">REM</th><th>Punt.</th><th class="hide-mobile">Recup.</th></tr></thead>
    <tbody>${list.map((d) => html`<tr onClick=${() => onDay(d.dayKey)} style="cursor:pointer">
      <td>${keyDate(d.dayKey).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
      <td>${hhmm(d.bedtime)}</td><td>${hhmm(d.wakeTime)}</td><td><b>${hm(d.sleptMin)}</b></td>
      <td class="hide-mobile">${hm(d.deepMin)}</td><td class="hide-mobile">${hm(d.remMin)}</td>
      <td><span style=${{ color: (scoreBand(d.sleepScore) || [])[1] }}>${n(d.sleepScore)}</span></td><td class="hide-mobile">${n(d.recovery)} %</td></tr>`)}</tbody>
  </table></div>`;
}
