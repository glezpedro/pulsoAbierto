// Página de detalle de una métrica, como al tocar un dato en la app Salud: D · S · M · 6M · A,
// cabecera grande (media del periodo o el valor que estés tocando), gráfica, resumen, rango
// habitual, «Acerca de» y todos los datos.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, n, hm, hhmm, mean, sd, slope, C, recColor, keyDate, todayKey, addDays, useIsMobile } from '../core.js';
import { Card, Spinner, Empty } from '../ui.js';
import { Icon } from '../icons.js';
import { BarChart, LineChart } from '../charts.js';
import { PERIODS, rangeOf, rangeTitle, buckets, bucketMean, bucketTitle, RangeNav } from '../period.js';

/** Metric catalogue. day(rep, data) → intraday chart description (optional). */
export const METRICS = {
  recovery: {
    title: 'Recuperación', unit: '%', color: () => C.green, icon: 'heart', dec: 0, better: true, yMin: 0, yMax: 100,
    barColor: (v) => recColor(v),
    about: ['Indica lo preparado que está tu cuerpo para el esfuerzo. Se calcula al despertar comparando tu VFC, tu frecuencia cardiaca en reposo, la respiración, la temperatura de la piel y cómo has dormido con tus valores habituales de los últimos 30 días.',
      'Verde (67–100 %): buen día para entrenar fuerte. Amarillo (34–66 %): mantén una carga moderada. Rojo (0–33 %): prioriza descansar, hidratarte y dormir.'],
  },
  strain: {
    title: 'Esfuerzo', unit: 'de 21', color: () => C.strain, icon: 'bolt', dec: 1, better: null, yMin: 0, yMax: 21,
    about: ['Carga cardiovascular del día en una escala de 0 a 21 (logarítmica: pasar de 18 a 19 cuesta mucho más que de 8 a 9). Se calcula con el tiempo que pasas en cada zona de frecuencia cardiaca.',
      'Ajústalo a tu recuperación: con recuperación alta tu cuerpo tolera más; con recuperación baja, un día de esfuerzo bajo ayuda a recuperarte.'],
  },
  hr: {
    title: 'Frecuencia cardiaca', unit: 'lpm', color: () => C.hr, icon: 'heart', dec: 0, better: null, range: true,
    lo: (d) => d.sleepMinHR ?? d.rhr, hi: (d) => d.maxHR, value: (d) => d.avgHR,
    day: (rep) => {
      const by = new Map();
      for (const b of rep?.hrTimeline || []) {
        const h = Math.floor(b.ts / 3600) * 3600;
        const g = by.get(h) || { lo: Infinity, hi: -Infinity, sum: 0, n: 0 };
        g.lo = Math.min(g.lo, b.min); g.hi = Math.max(g.hi, b.max); g.sum += b.avg; g.n++;
        by.set(h, g);
      }
      const items = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, g]) => ({ key: t, t, label: String(new Date(t * 1000).getHours()), lo: g.lo, hi: g.hi, value: g.sum / g.n }));
      return { kind: 'range', items, title: (it) => `${hhmm(it.t)} – ${hhmm(it.t + 3600)}` };
    },
    about: ['Latidos por minuto. Pulso la registra cada segundo. En reposo lo normal en adultos es 50–80 lpm; las personas entrenadas suelen estar por debajo.',
      'Las barras muestran el rango de cada día u hora (de la mínima a la máxima). Un descenso progresivo de la FC en reposo suele indicar mejor forma física; una subida repentina, fatiga, estrés, alcohol o el inicio de una enfermedad.'],
  },
  rhr: {
    title: 'Frecuencia cardiaca en reposo', unit: 'lpm', color: () => C.hr, icon: 'heart', dec: 0, better: false, vital: true,
    about: ['Tu frecuencia cardiaca más baja y estable mientras duermes (media de los 5 minutos más tranquilos, sobre todo en sueño profundo).',
      'Es uno de los mejores indicadores de recuperación: 3–5 lpm por encima de tu media suele significar que tu cuerpo está gestionando algo (entreno duro, poco sueño, alcohol, calor o una infección).'],
  },
  hrv: {
    title: 'Variabilidad de la frecuencia cardiaca', short: 'VFC', unit: 'ms', color: () => C.heart, icon: 'wave', dec: 0, better: true, vital: true,
    day: (rep) => {
      const s = rep?.sleep;
      if (!s?.hrvCurve?.length) return null;
      return { kind: 'line', points: s.hrvCurve.map((v, i) => ({ t: s.start + i * 300, v })), sub: 'VFC cada 5 minutos durante el sueño' };
    },
    about: ['Variación en milisegundos entre un latido y el siguiente (RMSSD), medida durante el sueño. Refleja el equilibrio de tu sistema nervioso autónomo: más alta suele significar más recuperado.',
      'Es muy personal (no la compares con otros) y varía mucho de un día a otro: fíjate en la tendencia de 7 días y en si está dentro de tu rango habitual. La app Salud guarda la VFC como SDNN, por eso Pulso no la envía.'],
  },
  resp: {
    title: 'Frecuencia respiratoria', unit: 'rpm', color: () => C.resp, icon: 'lungs', dec: 1, better: null, vital: true,
    day: (rep, extra) => (extra ? { kind: 'line', points: extra.map((p) => ({ t: p.t, v: p.resp })), sub: 'Respiraciones por minuto durante el sueño (cada 5 min)' } : null),
    needsSeries: true,
    about: ['Respiraciones por minuto mientras duermes. Pulso la deduce de cómo la respiración acelera y frena el corazón (arritmia sinusal respiratoria).',
      'En adultos sanos suele estar entre 12 y 20 rpm y es muy estable de una noche a otra. Una subida de 1–2 rpm sobre tu media es una de las primeras señales de que te estás poniendo enfermo.'],
  },
  skinTemp: {
    title: 'Temperatura de la piel', unit: 'σ', color: () => C.body, icon: 'temp', dec: 1, better: null, vital: true, relative: true,
    about: ['Variación de la temperatura de tu muñeca durante el sueño respecto a tu media (en desviaciones típicas). La pulsera no da grados absolutos fiables, pero sí cambios.',
      'Sube con la fiebre, el alcohol, una cena tardía, el calor de la habitación o, en mujeres, en la segunda mitad del ciclo menstrual.'],
  },
  activeKcal: {
    title: 'Energía activa', unit: 'kcal', color: () => C.activity, icon: 'flame', dec: 0, better: true, sum: true,
    about: ['Calorías que quemas por encima de tu metabolismo basal, calculadas con tu frecuencia cardiaca, tu edad, peso y sexo (ecuación de Keytel). Incluye entrenos y actividad diaria.'],
  },
  kcal: {
    title: 'Energía total', unit: 'kcal', color: () => C.activity, icon: 'flame', dec: 0, better: null, sum: true,
    about: ['Energía activa más tu metabolismo basal (Mifflin-St Jeor). Las horas sin pulsera se cuentan como reposo.'],
  },
  steps: {
    title: 'Pasos', unit: 'pasos', color: () => C.activity, icon: 'walk', dec: 0, better: true, sum: true,
    about: ['La WHOOP no cuenta pasos: este dato llega de la app Salud del iPhone mediante el Atajo de importación (Ajustes).'],
  },
  avgStress: {
    title: 'Estrés', unit: 'de 3', color: () => C.mind, icon: 'mind', dec: 1, better: false, yMin: 0, yMax: 3,
    day: (rep) => (rep?.stress?.length ? { kind: 'bars', items: rep.stress.filter((p) => !p.active).map((p) => ({ key: p.ts, t: p.ts, label: '', value: p.level, color: p.level >= 2 ? C.red : p.level >= 1 ? C.yellow : C.green })), sub: 'Nivel de estrés en reposo (cada 5 min)' } : null),
    about: ['Estimación de la activación de tu sistema nervioso cuando estás quieto: frecuencia cardiaca por encima de tu reposo y VFC baja respecto a tu media. 0 = calma, 3 = estrés alto. Los momentos con movimiento no cuentan (eso es esfuerzo físico, no estrés).'],
  },
  sleepScore: {
    title: 'Puntuación de sueño', unit: '', color: () => C.sleep, icon: 'sleep', dec: 0, better: true, yMin: 0, yMax: 100,
    about: ['Combina cuánto dormiste frente a lo que necesitabas, la eficiencia, el sueño reparador (profundo + REM) y la regularidad de tus horarios. Toca «Sueño» para ver todos los detalles.'],
  },
  spo2: {
    title: 'Oxígeno en sangre (experimental)', unit: '%', color: () => C.red, icon: 'drop', dec: 0, better: true, yMin: 85, yMax: 100,
    about: ['Estimación experimental a partir de los sensores rojo e infrarrojo. Sin calibración clínica: úsala solo para ver tendencias, nunca para diagnosticar.'],
  },
};

const valueOf = (cfg, d) => (cfg.value ? cfg.value(d) : d[cfg.key]);

export function MetricView({ mkey }) {
  const cfg0 = METRICS[mkey];
  const { date } = useStore();
  const mobile = useIsMobile();
  const [period, setPeriod] = useState(cfg0?.day ? 'D' : 'S');
  const [end, setEnd] = useState(date);
  if (!cfg0) return html`<div class="page"><${Card}><${Empty} title="Métrica desconocida"><a href="#/hoy">Volver al resumen</a><//><//></div>`;
  const cfg = { ...cfg0, key: mkey };
  const isDay = period === 'D';
  const { frm, to, days } = rangeOf(period, isDay ? date : end);
  const options = PERIODS.filter(([v]) => v !== 'D' || cfg.day);
  return html`<div class="page">
    <div class="topbar">
      <div><a class="small" href="#/hoy" onClick=${(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>‹ Volver</a>
        <h1 class="h1-detail">${cfg.short && mobile ? cfg.short : cfg.title}</h1></div>
      <div class="row" style="gap:6px;margin-top:14px">${isDay
        ? html`<button class="btn small icon" aria-label="Día anterior" onClick=${() => store.set({ date: addDays(date, -1) })}><${Icon} n="chevl" /></button>
          <button class="btn small icon" aria-label="Día siguiente" disabled=${date >= todayKey()} onClick=${() => store.set({ date: addDays(date, 1) })}><${Icon} n="chev" /></button>`
        : html`<${RangeNav} period=${period} end=${end} setEnd=${setEnd} />`}</div>
    </div>
    <div class="seg seg-full">${options.map(([v, l]) => html`<button class=${period === v ? 'on' : ''} onClick=${() => { setPeriod(v); if (v !== 'D') setEnd(date); }}>${l}</button>`)}</div>
    ${isDay ? html`<${MetricDay} cfg=${cfg} date=${date} />` : html`<${MetricRange} cfg=${cfg} period=${period} frm=${frm} to=${to} days=${days} />`}
  </div>`;
}

function Head({ label, value, unit, sub, color }) {
  return html`<div class="bighead"><div class="col" style="gap:0">
    <span class="bh-label">${label}</span>
    <span class="bh-value" style=${{ color }}>${value}${unit && html`<small>${unit}</small>`}</span>
    <span class="bh-sub">${sub}</span></div></div>`;
}

function MetricDay({ cfg, date }) {
  const day = useApi(`/day/${date}`, [date]);
  const rep = day.data?.report;
  const s = rep?.sleep;
  const ser = useApi(cfg.needsSeries && s ? `/series?frm=${s.start}&to=${s.end}&step=300` : null, [s?.start, s?.end]);
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [date]);
  if (day.loading && !day.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  const view = rep ? cfg.day(rep, ser.data) : null;
  const m = day.data?.metrics || {};
  const color = cfg.color();
  if (!view || (view.items && !view.items.length) || (view.points && view.points.filter((p) => p.v != null).length < 2)) {
    return html`<div class="grid"><${Card} span="12"><${Empty} icon="〰️" title="Sin datos este día">${cfg.needsSeries && ser.loading ? 'Cargando…' : 'Sincroniza la pulsera desde Bluefy.'}<//><//><${About} cfg=${cfg} /></div>`;
  }
  let head;
  if (view.kind === 'range') {
    const it = sel != null ? view.items[sel] : null;
    const lo = it ? it.lo : Math.min(...view.items.map((x) => x.lo)), hi = it ? it.hi : Math.max(...view.items.map((x) => x.hi));
    head = { label: 'RANGO', value: `${n(lo)}–${n(hi)}`, unit: cfg.unit, sub: it ? view.title(it) : `Media ${n(m.avgHR)} lpm · ${keyDate(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}` };
  } else if (view.kind === 'line') {
    const vals = view.points.map((p) => p.v).filter((v) => v != null);
    head = sel ? { label: hhmm(sel.t), value: n(sel.v, cfg.dec), unit: cfg.unit, sub: view.sub }
      : { label: 'MEDIA', value: n(mean(vals), cfg.dec), unit: cfg.unit, sub: `${view.sub} · mín ${n(Math.min(...vals), cfg.dec)} · máx ${n(Math.max(...vals), cfg.dec)}` };
  } else {
    const it = sel != null ? view.items[sel] : null;
    head = it ? { label: hhmm(it.t), value: n(it.value, cfg.dec), unit: cfg.unit, sub: view.sub }
      : { label: 'MEDIA', value: n(mean(view.items.map((x) => x.value)), cfg.dec), unit: cfg.unit, sub: view.sub };
  }
  return html`<div class="grid">
    <section class="card span-12 hero-card" style=${{ '--cat': color }}>
      <${Head} ...${head} />
      ${view.kind === 'line' ? html`<${LineChart} points=${view.points} color=${color} height=${220} onSelect=${setSel} gap=${1800} />`
        : view.kind === 'range' ? html`<${BarChart} items=${view.items} color=${color} height=${220} onSelect=${setSel} base=${Math.max(0, Math.floor(Math.min(...view.items.map((x) => x.lo)) - 10))} />`
          : html`<${BarChart} items=${view.items} color=${color} height=${200} yMin=${0} yMax=${3} onSelect=${setSel} labelEvery=${1e9} />`}
    </section>
    <${About} cfg=${cfg} />
  </div>`;
}

function MetricRange({ cfg, period, frm, to, days }) {
  const rows = useApi(`/days?frm=${frm}&to=${to}`, [frm, to]);
  const prev = useApi(`/days?frm=${addDays(frm, -days)}&to=${addDays(frm, -1)}`, [frm, days]);
  const base = useApi(cfg.vital ? `/days?to=${to}&days=60` : null, [to]);
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [frm, to, period]);
  const color = cfg.color();
  if (rows.loading && !rows.data) return html`<div class="row"><${Spinner} /> Cargando…</div>`;
  let list = rows.data || [];
  // relative skin temperature: z-score against the whole visible + baseline window
  let rel = null;
  if (cfg.relative) {
    const pool = [...(base.data || []), ...list].map((d) => d.skinTemp).filter((v) => v != null);
    const mu = mean(pool), s = sd(pool) || 1;
    rel = (v) => (v == null ? null : (v - mu) / s);
  }
  const val = (d) => (rel ? rel(d.skinTemp) : valueOf(cfg, d));
  const bks = buckets(period, list);
  const items = bks.map((b) => {
    const v = bucketMean(b, val);
    if (cfg.range) return { key: b.key, label: b.label, lo: bucketMean(b, cfg.lo), hi: bucketMean(b, cfg.hi), value: v };
    return { key: b.key, label: b.label, value: v, color: cfg.barColor ? cfg.barColor(v) : null };
  });
  const vals = list.map(val).filter((v) => v != null);
  if (!vals.length) return html`<div class="grid"><${Card} span="12"><${Empty} icon="〰️" title="Sin datos en este periodo">Sincroniza la pulsera desde Bluefy.<//><//><${About} cfg=${cfg} /></div>`;
  const avg = mean(vals);
  const pAvg = mean((prev.data || []).map(val).filter((v) => v != null));
  const it = sel != null ? items[sel] : null;
  const ranged = cfg.range && items.some((x) => x.lo != null);
  const head = it
    ? { label: period === '6M' || period === 'A' ? 'MEDIA' : (cfg.sum ? 'TOTAL' : ranged ? 'RANGO' : 'VALOR'),
      value: ranged && it.lo != null ? `${n(it.lo)}–${n(it.hi)}` : n(it.value, cfg.dec), unit: cfg.unit, sub: bucketTitle(period, bks[sel]) }
    : { label: cfg.sum ? 'MEDIA DIARIA' : ranged ? 'RANGO' : 'MEDIA', value: ranged ? `${n(Math.min(...items.map((x) => x.lo).filter((v) => v != null)))}–${n(Math.max(...items.map((x) => x.hi).filter((v) => v != null)))}` : n(avg, cfg.dec),
      unit: cfg.unit, sub: rangeTitle(period, frm, to) };
  const vs = items.flatMap((x) => [x.value, x.lo, x.hi]).filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const yMin = cfg.yMin ?? (cfg.relative ? Math.floor(lo - 0.5) : cfg.sum ? 0 : Math.max(0, Math.floor(lo - Math.max((hi - lo) * (ranged ? 0.12 : 0.4), 1))));
  const yMax = cfg.yMax ?? (cfg.relative ? Math.ceil(hi + 0.5) : undefined);
  // stats
  const tr = slope(list.map((_, i) => i), list.map(val));
  const typical = cfg.vital && base.data ? (() => {
    const b = base.data.map(val).filter((v) => v != null);
    if (b.length < 7) return null;
    const mu = mean(b), s = sd(b) || 0;
    return [mu - 1.5 * s, mu + 1.5 * s];
  })() : null;
  const delta = avg != null && pAvg != null ? avg - pAvg : null;
  const dCls = delta == null || cfg.better == null || Math.abs(delta) < 10 ** -cfg.dec ? '' : (delta > 0) === cfg.better ? 'good' : 'bad';
  return html`<div class="grid">
    <section class="card span-12 hero-card" style=${{ '--cat': color }}>
      <${Head} ...${head} color=${it ? null : null} />
      <${BarChart} items=${items} color=${color} height=${230} onSelect=${setSel} avg=${ranged ? null : avg} yMin=${yMin} yMax=${yMax} base=${cfg.relative ? 0 : (yMin ?? 0)} yFmt=${(v) => n(v, Number.isInteger(v) ? 0 : 1)} />
      <div class="legend"><span><i style=${{ background: 'transparent', borderTop: '2px dashed var(--fg)', borderRadius: 0, height: 0, opacity: 0.55 }}></i>${ranged ? 'Rango de cada día (mín–máx)' : 'Media del periodo'}</span></div>
    </section>
    <${Card} span="7" title="Resumen" icon=${html`<${Icon} n="report" />`} color=${color}>
      <div class="kv-grid">
        <div class="kv"><span>Media</span><b>${n(avg, cfg.dec)}<small>${cfg.unit}</small></b></div>
        <div class="kv"><span>Mínimo</span><b>${n(Math.min(...vals), cfg.dec)}<small>${cfg.unit}</small></b></div>
        <div class="kv"><span>Máximo</span><b>${n(Math.max(...vals), cfg.dec)}<small>${cfg.unit}</small></b></div>
        <div class="kv"><span>Periodo anterior</span><b class=${dCls}>${delta == null ? '–' : `${delta > 0 ? '+' : ''}${n(delta, cfg.dec)}`}<small>${delta == null ? '' : cfg.unit}</small></b></div>
        <div class="kv"><span>Tendencia</span><b>${tr == null ? '–' : `${tr * 7 > 0 ? '+' : ''}${n(tr * 7, cfg.dec || 1)}`}<small>${tr == null ? '' : '/sem'}</small></b></div>
        <div class="kv"><span>Días con datos</span><b>${vals.length}<small>de ${list.length}</small></b></div>
        ${typical && html`<div class="kv" style="grid-column:span 2"><span>Tu rango habitual (60 días)</span><b>${n(typical[0], cfg.dec)}–${n(typical[1], cfg.dec)}<small>${cfg.unit}</small></b></div>`}
      </div><//>
    <${About} cfg=${cfg} span="5" />
    <${Card} span="12" title="Todos los datos" icon=${html`<${Icon} n="calendar" />`} color=${color}>
      <details><summary class="small" style="cursor:pointer;color:var(--accent)">Mostrar los ${vals.length} días</summary>
        <div class="col" style="gap:0;margin-top:6px">${list.slice().reverse().filter((d) => val(d) != null).map((d) => html`<a class="stat" href="#/hoy" onClick=${() => store.set({ date: d.dayKey })} style="color:inherit">
          <span>${keyDate(d.dayKey).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <span><b>${cfg.range && cfg.lo(d) != null ? `${n(cfg.lo(d))}–${n(cfg.hi(d))} · ` : ''}${n(val(d), cfg.dec)}</b> ${cfg.unit}</span></a>`)}</div>
      </details><//>
  </div>`;
}

function About({ cfg, span = 12 }) {
  return html`<${Card} span=${span} title=${`Acerca de: ${cfg.short || cfg.title}`} icon=${html`<${Icon} n="info" />`} color=${cfg.color()}>
    <div class="metric-about">${cfg.about.map((p) => html`<p>${p}</p>`)}</div><//>`;
}
