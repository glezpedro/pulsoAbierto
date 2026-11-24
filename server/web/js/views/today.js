import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, hm, hmShort, hhmm, dayTitle, addDays, todayKey, isToday, mean, sd, C, recColor, recBand, needOf, ZONE_COLORS } from '../core.js';
import { Card, Tile, Stat, Ring, ChartBox, timeX, ZoneBar, Md, Empty, Spinner } from '../ui.js';
import { Page, SyncButton } from '../layout.js';
import { Icon } from '../icons.js';

export function DayNav() {
  const { date } = useStore();
  const set = (d) => store.set({ date: d });
  return html`<div class="row" style="gap:6px">
    <button class="btn small" aria-label="Día anterior" onClick=${() => set(addDays(date, -1))}><${Icon} n="chevl" /></button>
    <input type="date" value=${date} max=${todayKey()} onChange=${(e) => e.target.value && set(e.target.value)} style="width:auto" />
    <button class="btn small" aria-label="Día siguiente" disabled=${isToday(date)} onClick=${() => set(addDays(date, 1))}><${Icon} n="chev" /></button>
    ${!isToday(date) && html`<button class="btn small" onClick=${() => set(todayKey())}>Hoy</button>`}
  </div>`;
}

export function baselineDelta(base, key, v, higherIsBetter, digits = 0) {
  if (v == null) return [null, null];
  const vals = base.map((m) => m[key]).filter((x) => x != null);
  if (vals.length < 3) return [null, null];
  const b = mean(vals), d = v - b;
  if (Math.abs(d) < 10 ** -digits) return ['= media 30 d', null];
  return [`${d > 0 ? '+' : ''}${n(d, digits)} vs media`, higherIsBetter == null ? null : (d > 0) === higherIsBetter];
}

export function TodayView() {
  const { date, status } = useStore();
  const { data, loading, error } = useApi(`/day/${date}`, [date]);
  const plan = useApi(isToday(date) ? '/plan/today' : null, [date]);
  const m = data?.metrics || {};
  const rep = data?.report;
  const hasData = rep && (m.strain != null || m.recovery != null);
  return html`<${Page} title=${dayTitle(date)} right=${html`<${DayNav} />`}>
    <div class="only-mobile"><${SyncButton} big /></div>
    ${loading && !data && html`<div class="row"><${Spinner} /> Cargando…</div>`}
    ${error && html`<div class="card bad">${error}</div>`}
    ${data && !hasData && html`<div class="grid"><${Card} span="12"><${Empty} icon="⌚" title=${`Sin datos para ${dayTitle(date).toLowerCase()}`}>
      ${status?.samples?.files ? 'Sincroniza la pulsera desde Bluefy para descargar este día.' : 'Conecta tu WHOOP desde Bluefy (botón «Conectar pulsera») o genera datos de demostración en Ajustes.'}
      ${data.dirty && html`<div style="margin-top:8px" class="row"><${Spinner} /> Analizando…</div>`}
    <//></div>`}
    ${hasData && html`<div class="grid">
      <${Card} span="7"><${Rings} m=${m} rep=${rep} /><//>
      <div class="span-5 col" style="gap:16px">
        ${isToday(date) && rep.targetLo != null && html`<${StrainTarget} cur=${m.strain || 0} lo=${rep.targetLo} hi=${rep.targetHi} />`}
        <${PlanCard} plan=${plan.data} />
      </div>
      <${Card} span="12" title="Métricas clave" icon=${html`<${Icon} n="heart" />`}><${KeyTiles} m=${m} base=${data.baseline} showSpO2=${status?.settings?.showSpO2} /><//>
      <${Card} span="6" title="Análisis del día" icon=${html`<${Icon} n="spark" />`}><${Analysis} data=${data} /><//>
      <${Card} span="6" title="Noche" icon=${html`<${Icon} n="sleep" />`} right=${html`<a href="#/sueno" class="small">Ver sueño</a>`}><${SleepMini} m=${m} rep=${rep} /><//>
      <${Card} span="12" title="Frecuencia cardiaca y sensores" icon=${html`<${Icon} n="live" />`}><${DayChart} date=${date} rep=${rep} /><//>
      <${Card} span="6" title="Estrés" icon=${html`<${Icon} n="stress" />`}><${StressChart} rep=${rep} m=${m} /><//>
      <${Card} span="6" title="Actividades y entrenos" icon=${html`<${Icon} n="dumbbell" />`}><${Activities} rep=${rep} workouts=${data.workouts} events=${data.events} /><//>
    </div>`}
  <//>`;
}

function Rings({ m, rep }) {
  const sp = rep.sleepScore?.performance;
  return html`<div class="rings">
    <${Ring} value=${m.recovery} color=${recColor(m.recovery)} label="RECUPERACIÓN" text=${m.recovery != null ? `${Math.round(m.recovery)}%` : '–'}
      caption=${rep.recovery?.calibrating ? 'calibrando' : null} onClick=${() => (location.hash = '#/recuperacion')} />
    <${Ring} value=${m.strain} max=${21} color=${C.strain} label="ESFUERZO" text=${n(m.strain, 1)} caption=${m.kcal ? `${n(m.kcal)} kcal` : null} onClick=${() => (location.hash = '#/carga')} />
    <${Ring} value=${sp} color=${C.sleep} label="SUEÑO" text=${sp != null ? `${Math.round(sp)}%` : '–'} caption=${m.sleptMin ? hmShort(m.sleptMin) : null} onClick=${() => (location.hash = '#/sueno')} />
  </div>
  ${rep.recovery && html`<div class="row between" style="margin-top:6px">
    <span class=${`pill ${recBand(m.recovery)}`}>${m.recovery >= 67 ? 'Listo para rendir' : m.recovery >= 34 ? 'Mantén la carga' : 'Prioriza recuperar'}</span>
    <span class="small muted">VFC ${n(m.hrv)} ms · FC reposo ${n(m.rhr)} lpm</span>
  </div>`}`;
}

function StrainTarget({ cur, lo, hi }) {
  const pct = (v) => `${(v / 21) * 100}%`;
  return html`<${Card} title="Esfuerzo objetivo" icon=${html`<${Icon} n="bolt" />`} right=${html`<span class="pill blue">${n(lo)}–${n(hi)}</span>`}>
    <div style="position:relative;height:16px">
      <div class="bar" style="position:absolute;inset:4px 0"></div>
      <div style=${{ position: 'absolute', top: '4px', height: '8px', left: pct(lo), width: pct(hi - lo), background: 'rgba(61,139,255,.5)', borderRadius: '99px' }}></div>
      <div style=${{ position: 'absolute', top: 0, left: `calc(${pct(Math.min(21, cur))} - 8px)`, width: '16px', height: '16px', borderRadius: '50%', background: '#fff' }}></div>
    </div>
    <div class="small muted">${cur < lo ? `Te quedan ${n(lo - cur, 1)} puntos para entrar en tu rango óptimo de hoy.` : cur > hi ? 'Has superado el objetivo: a partir de aquí, recuperar.' : 'Estás en tu rango óptimo de hoy.'}</div>
  <//>`;
}

function PlanCard({ plan }) {
  if (!plan) return html`<${Card} title="Entreno de hoy" icon=${html`<${Icon} n="dumbbell" />`}><div class="small muted">Cargando…</div><//>`;
  if (!plan.plan) return html`<${Card} title="Entreno de hoy" icon=${html`<${Icon} n="dumbbell" />`}><div class="small muted">Crea un plan en <a href="#/entreno">Entreno</a> y aquí verás la sesión de hoy ajustada a tu recuperación.</div><//>`;
  if (plan.rest) return html`<${Card} title="Hoy toca descanso" icon=${html`<${Icon} n="sleep" />`}><div class="small muted">Día sin sesión en «${plan.plan}». Paseo, movilidad y buen sueño.</div><//>`;
  const s = plan.adapted;
  return html`<${Card} title=${s.title} icon=${html`<${Icon} n="dumbbell" />`} right=${html`<span class="small muted">S${plan.week} · ${plan.phase}</span>`}>
    <div class=${`small ${plan.band === 'green' ? 'good' : plan.band === 'yellow' ? 'warn' : plan.band === 'red' ? 'bad' : 'muted'}`}>${plan.note}</div>
    <div class="col" style="gap:4px">${(s.exercises || []).slice(0, 6).map((e) => html`<div class="row between small"><span>${e.name}</span><span class="num muted">${e.sets}×${e.reps}${e.suggestedKg ? ` · ${n(e.suggestedKg, 1)} kg` : ''}</span></div>`)}
    ${s.cardio && html`<div class="small muted">+ ${s.cardio.description}</div>`}</div>
    <a href="#/entreno" class="small">Ver plan completo</a>
  <//>`;
}

export function KeyTiles({ m, base, showSpO2 }) {
  const t = (key, hb, d = 0) => baselineDelta(base || [], key, m[key], hb, d);
  const temp = (() => {
    const vals = (base || []).map((x) => x.skinTemp).filter((x) => x != null);
    if (m.skinTemp == null || vals.length < 3) return '–';
    const s = sd(vals); return s ? `${((m.skinTemp - mean(vals)) / s) > 0 ? '+' : ''}${n((m.skinTemp - mean(vals)) / s, 1)}σ` : '–';
  })();
  const [h, hg] = t('hrv', true), [r, rg] = t('rhr', false), [re] = t('resp', null, 1), [k] = t('kcal', null);
  return html`<div class="tiles">
    <${Tile} t="VFC (RMSSD)" v=${n(m.hrv)} unit="ms" color=${C.green} icon="◆" d=${h} good=${hg} />
    <${Tile} t="FC en reposo" v=${n(m.rhr)} unit="lpm" color=${C.hr} icon="♥" d=${r} good=${rg} />
    <${Tile} t="Respiración" v=${n(m.resp, 1)} unit="rpm" icon="≈" d=${re} />
    <${Tile} t="Temp. piel" v=${temp} color=${C.orange} icon="°" d="vs tu base" />
    <${Tile} t="Calorías" v=${n(m.kcal)} unit="kcal" color=${C.orange} icon="▲" d=${k} />
    <${Tile} t="Activas" v=${n(m.activeKcal)} unit="kcal" color=${C.orange} icon="▲" />
    <${Tile} t="FC media / máx" v=${`${n(m.avgHR)} / ${n(m.maxHR)}`} unit="lpm" color=${C.hr} icon="♥" />
    <${Tile} t="Estrés medio" v=${n(m.avgStress, 1)} unit="/3" color=${C.yellow} icon="◎" d=${m.highStressMin ? `${hm(m.highStressMin)} alto` : null} />
    <${Tile} t="Pasos" v=${m.steps != null ? n(m.steps) : '–'} color=${C.strain} icon="↗" d=${m.steps == null ? 'vía Atajo de Salud' : null} />
    <${Tile} t="Tiempo con pulsera" v=${m.wearMinutes != null ? hmShort(m.wearMinutes) : '–'} unit="h" icon="⌚" />
    ${showSpO2 && html`<${Tile} t="SpO₂ (experimental)" v=${n(m.spo2)} unit="%" color=${C.red} icon="●" />`}
    <${Tile} t="Siesta" v=${m.napMin ? hm(m.napMin) : '–'} color=${C.sleep} icon="☾" />
  </div>`;
}

function Analysis({ data }) {
  const [busy, setBusy] = useState(false);
  const { status } = useStore();
  const run = async () => {
    setBusy(true);
    try { await api(`/day/${data.key}/ai`, { method: 'POST' }); store.bump(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return html`
    ${data.ai ? html`<${Md} text=${data.ai} />` : html`<div class="md">${localSummary(data)}</div>`}
    <div class="row">
      ${status?.hasAnthropic
        ? html`<button class="btn small" onClick=${run} disabled=${busy}>${busy ? html`<span class="spinner"></span>` : html`<${Icon} n="spark" />`}${data.ai ? 'Regenerar' : 'Analizar con IA'}</button>`
        : html`<span class="small muted">Añade tu clave de Anthropic en <a href="#/ajustes">Ajustes</a> para el análisis con IA.</span>`}
      ${data.aiAt && html`<span class="tiny faint">${new Date(data.aiAt * 1000).toLocaleString('es-ES')}</span>`}
    </div>`;
}

function localSummary({ metrics: m, report: r }) {
  const out = [];
  if (r?.recovery) {
    const s = r.recovery.score;
    out.push(s >= 67 ? `Recuperación alta (${n(s)} %): buen día para apretar.` : s >= 34 ? `Recuperación media (${n(s)} %): entrena con moderación.` : `Recuperación baja (${n(s)} %): prioriza descanso, movilidad y sueño.`);
    if (r.recovery.zHRV > 0.7) out.push('Tu VFC está claramente por encima de tu media.');
    if (r.recovery.zHRV < -0.7) out.push('Tu VFC está por debajo de lo habitual (estrés, alcohol, carga o enfermedad incipiente).');
    if (r.recovery.zRHR < -1) out.push('La FC en reposo está elevada respecto a tu base.');
  }
  const need = needOf(r?.sleepNeed);
  if (r?.sleep && need) {
    const def = need - m.sleptMin;
    if (def > 45) out.push(`Dormiste ${hm(def)} menos de lo que necesitabas.`);
    else if (def < -20) out.push('Cubriste de sobra tu necesidad de sueño.');
  }
  if (r?.targetLo != null) out.push(`Esfuerzo recomendado: ${n(r.targetLo)}–${n(r.targetHi)}.`);
  if (r?.nextNightNeed) out.push(`Esta noche necesitarás ${hm(needOf(r.nextNightNeed))}.`);
  return out.join(' ') || 'Aún no hay datos suficientes para un resumen.';
}

function SleepMini({ m, rep }) {
  const s = rep.sleep;
  if (!s) return html`<div class="small muted">No se detectó sueño principal que termine este día.</div>`;
  const tot = s.stages.length || 1;
  const cnt = [0, 1, 2, 3].map((k) => s.stages.filter((x) => x === k).length);
  return html`
    <div class="row between"><div><div class="tiny muted">EN CAMA</div><b class="num">${hhmm(s.start)} → ${hhmm(s.end)}</b></div>
      <div style="text-align:right"><div class="tiny muted">DORMIDO / NECESIDAD</div><b class="num">${hm(m.sleptMin)} / ${hm(m.sleepNeedMin)}</b></div></div>
    <div class="zonebar" style="height:12px">${[0, 1, 3, 2].map((k) => html`<i style=${{ width: `${(cnt[k] / tot) * 100}%`, background: [C.awake, C.light, C.deep, C.rem][k] }}></i>`)}</div>
    <div class="legend"><span><i style="background:${C.deep}"></i>Profundo ${hm(cnt[2])}</span><span><i style="background:${C.rem}"></i>REM ${hm(cnt[3])}</span><span><i style="background:${C.light}"></i>Ligero ${hm(cnt[1])}</span><span><i style="background:${C.awake}"></i>Despierto ${hm(cnt[0])}</span></div>
    <div class="row" style="gap:16px"><span class="small">Puntuación <b>${n(m.sleepScore)}</b></span><span class="small">Eficiencia <b>${n(rep.sleepScore?.efficiency)}%</b></span><span class="small">Consistencia <b>${n(rep.sleepScore?.consistency)}</b></span></div>`;
}

function DayChart({ date, rep }) {
  const [mode, setMode] = useState('hr');
  const s = rep.metrics.dayStart || 0;
  const series = useApi(mode === 'hr' ? null : `/series?frm=${s - 6 * 3600}&to=${s + 86400}&step=180`, [date, mode]);
  const acts = rep.activities || [];
  const sleep = [rep.sleep, ...(rep.naps || [])].filter(Boolean);
  const bands = { id: 'bands', beforeDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { x } } = c;
    ctx.save();
    for (const sl of sleep) { ctx.fillStyle = 'rgba(140,123,255,.10)'; ctx.fillRect(x.getPixelForValue(sl.start * 1000), a.top, x.getPixelForValue(sl.end * 1000) - x.getPixelForValue(sl.start * 1000), a.bottom - a.top); }
    for (const ac of acts) { ctx.fillStyle = 'rgba(61,139,255,.16)'; ctx.fillRect(x.getPixelForValue(ac.start * 1000), a.top, x.getPixelForValue(ac.end * 1000) - x.getPixelForValue(ac.start * 1000), a.bottom - a.top); }
    ctx.restore();
  } };
  const hrCfg = () => ({
    type: 'line', plugins: [bands],
    data: { datasets: [
      { label: 'Máx', data: rep.hrTimeline.map((b) => ({ x: b.ts * 1000, y: b.max })), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(255,84,104,.15)' },
      { label: 'Mín', data: rep.hrTimeline.map((b) => ({ x: b.ts * 1000, y: b.min })), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'FC media', data: rep.hrTimeline.map((b) => ({ x: b.ts * 1000, y: b.avg })), borderColor: C.hr, borderWidth: 1.6, pointRadius: 0, tension: 0.3 },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { ...timeX(), min: s * 1000, max: (s + 86400) * 1000 }, y: { grace: '5%' } } },
  });
  const sensCfg = () => {
    const pts = series.data || [];
    return {
      type: 'line', plugins: [bands],
      data: { datasets: [
        { label: 'FC (lpm)', data: pts.map((p) => ({ x: p.t * 1000, y: p.hr })), borderColor: C.hr, borderWidth: 1.4, pointRadius: 0, yAxisID: 'y', tension: 0.25 },
        { label: 'Movimiento (°/min)', data: pts.map((p) => ({ x: p.t * 1000, y: p.motion })), borderColor: C.strain, backgroundColor: 'rgba(61,139,255,.25)', fill: true, borderWidth: 1, pointRadius: 0, yAxisID: 'y2' },
        { label: 'Temp. piel (raw)', data: pts.map((p) => ({ x: p.t * 1000, y: p.temp })), borderColor: C.orange, borderWidth: 1.2, pointRadius: 0, yAxisID: 'y3', hidden: false },
        { label: 'VFC (ms)', data: pts.map((p) => ({ x: p.t * 1000, y: p.rmssd })), borderColor: C.green, borderWidth: 1.2, pointRadius: 0, yAxisID: 'y4', spanGaps: false },
      ] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
        scales: { x: { ...timeX(), min: (s - 6 * 3600) * 1000, max: (s + 86400) * 1000 }, y: { position: 'left', grace: '5%' },
          y2: { display: false, beginAtZero: true }, y3: { display: false, grace: '20%' }, y4: { display: false, beginAtZero: true } } },
    };
  };
  return html`<div class="row between"><${Seg2} value=${mode} onChange=${setMode} />
    <div class="legend"><span><i style="background:rgba(140,123,255,.4)"></i>Sueño</span><span><i style="background:rgba(61,139,255,.45)"></i>Actividad</span></div></div>
    ${mode === 'hr'
      ? html`<${ChartBox} config=${hrCfg} height=${240} deps=${[rep.generatedAt, mode]} />
        <div class="row" style="gap:18px"><span class="small muted">Media <b class="num">${n(rep.metrics.avgHR)}</b> lpm</span><span class="small muted">Máx <b class="num">${n(rep.metrics.maxHR)}</b> lpm</span><span class="small muted">Mín sueño <b class="num">${n(rep.sleep?.minHR)}</b> lpm</span></div>`
      : series.loading ? html`<div class="row"><${Spinner} /> Leyendo sensores…</div>` : html`<${ChartBox} config=${sensCfg} height=${280} deps=${[series.data, mode]} />
        <div class="tiny faint">Resolución 3 min desde las 18:00 del día anterior. Movimiento = cambio de orientación del vector de gravedad; temperatura en unidades crudas del sensor.</div>`}`;
}

function Seg2({ value, onChange }) {
  return html`<div class="seg"><button class=${value === 'hr' ? 'on' : ''} onClick=${() => onChange('hr')}>FC (5 min)</button><button class=${value === 'sens' ? 'on' : ''} onClick=${() => onChange('sens')}>Todos los sensores</button></div>`;
}

function StressChart({ rep, m }) {
  if (!rep.stress?.length) return html`<div class="small muted">Sin datos de estrés.</div>`;
  const cfg = () => ({
    type: 'bar',
    data: { datasets: [{ data: rep.stress.map((p) => ({ x: p.ts * 1000, y: p.level })), backgroundColor: rep.stress.map((p) => (p.active ? 'rgba(61,139,255,.55)' : p.level >= 2 ? C.red : p.level >= 1 ? C.yellow : C.green)), barPercentage: 1, categoryPercentage: 1 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: timeX(), y: { min: 0, max: 3, ticks: { stepSize: 1 } } } },
  });
  return html`<${ChartBox} config=${cfg} height=${150} deps=${[rep.generatedAt]} />
    <div class="row between"><span class="small">Media <b>${n(m.avgStress, 1)}</b>/3 · alto ${hm(m.highStressMin || 0)}</span>
    <div class="legend"><span><i style="background:${C.green}"></i>Bajo</span><span><i style="background:${C.yellow}"></i>Medio</span><span><i style="background:${C.red}"></i>Alto</span><span><i style="background:rgba(61,139,255,.6)"></i>Actividad</span></div></div>`;
}

function Activities({ rep, workouts, events }) {
  const acts = rep.activities || [];
  return html`
    ${!acts.length && !workouts?.length && html`<div class="small muted">Sin actividades detectadas ni entrenos este día.</div>`}
    ${acts.map((a) => html`<div class="col" style="gap:6px">
      <div class="row between"><div><b class="num">${hhmm(a.start)}–${hhmm(a.end)}</b> <span class="small muted">${Math.round((a.end - a.start) / 60)} min · FC ${n(a.strain.avgHR)} · ${n(a.strain.kcal)} kcal</span></div>
      <b class="num" style=${{ color: C.strain }}>${n(a.strain.strain, 1)}</b></div>
      <${ZoneBar} zones=${a.strain.zoneSeconds} /></div>`)}
    ${workouts?.filter((w) => w.source !== 'strap').map((w) => html`<a class="list-item" href=${`#/entreno?w=${encodeURIComponent(w.uid)}`} style="color:inherit">
      <span class="ic"><${Icon} n="dumbbell" /></span><span class="grow"><b>${w.name}</b><div class="small muted">${hhmm(w.start)} · ${w.source}</div></span>
      ${w.strain != null && html`<b style=${{ color: C.strain }}>${n(w.strain, 1)}</b>`}</a>`)}
    ${events?.length > 0 && html`<div class="col" style="gap:2px"><div class="tiny muted">EVENTOS DE LA PULSERA</div>
      ${events.slice(-8).map((e) => html`<div class="row between small"><span>${e.label}</span><span class="muted num">${hhmm(e.ts)}</span></div>`)}</div>`}`;
}
