// Periodos al estilo Salud: D · S · M · 6M · A. Rango de fechas, agregación (6M por semanas,
// A por meses), etiquetas del eje y títulos del rango.
import { html } from '../vendor/preact-htm.js';
import { addDays, keyDate, todayKey, mean } from './core.js';
import { Icon } from './icons.js';

export const PERIODS = [['D', 'D'], ['S', 'S'], ['M', 'M'], ['6M', '6M'], ['A', 'A']];
export const PERIOD_DAYS = { D: 1, S: 7, M: 30, '6M': 182, A: 365 };
const WD = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const MON = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function rangeOf(period, end) {
  const days = PERIOD_DAYS[period] || 7;
  return { frm: addDays(end, -days + 1), to: end, days };
}

export function shiftEnd(period, end, dir) {
  const next = addDays(end, dir * (PERIOD_DAYS[period] || 1));
  return next > todayKey() ? todayKey() : next;
}

const fmtD = (k, o) => keyDate(k).toLocaleDateString('es-ES', o);
export function rangeTitle(period, frm, to) {
  if (period === 'D') {
    const s = fmtD(to, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const a = keyDate(frm), b = keyDate(to);
  const sameY = a.getFullYear() === b.getFullYear(), sameM = sameY && a.getMonth() === b.getMonth();
  if (period === 'S' || period === 'M') {
    return sameM ? `${a.getDate()}–${fmtD(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : `${fmtD(frm, { day: 'numeric', month: 'short', ...(sameY ? {} : { year: 'numeric' }) })} – ${fmtD(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return `${fmtD(frm, { month: 'short', ...(sameY ? {} : { year: 'numeric' }) })} – ${fmtD(to, { month: 'short', year: 'numeric' })}`;
}

/** Bucket daily rows for the chart. Returns [{ key, label, days: [...rows], from, to }]. */
export function buckets(period, rows) {
  if (period === 'S' || period === 'M' || period === 'D') {
    return rows.map((r) => {
      const d = keyDate(r.dayKey);
      return { key: r.dayKey, label: period === 'S' ? WD[d.getDay()] : String(d.getDate()), days: [r], from: r.dayKey, to: r.dayKey };
    });
  }
  const groups = new Map();
  for (const r of rows) {
    const d = keyDate(r.dayKey);
    let k;
    if (period === '6M') { const monday = addDays(r.dayKey, -((d.getDay() + 6) % 7)); k = monday; }
    else k = r.dayKey.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let lastMonth = null;
  return [...groups.entries()].map(([k, ds]) => {
    let label = '';
    if (period === '6M') {
      const m = keyDate(k).getMonth();
      if (m !== lastMonth) { label = MON[m]; lastMonth = m; }
    } else label = MON[Number(k.slice(5, 7)) - 1];
    return { key: k, label, days: ds, from: ds[0].dayKey, to: ds[ds.length - 1].dayKey };
  });
}

/** Mean of a field across a bucket (null if no data). */
export const bucketMean = (b, f) => mean(b.days.map((d) => (typeof f === 'function' ? f(d) : d[f])));

export function bucketTitle(period, b) {
  if (!b) return '';
  if (period === 'S' || period === 'M') {
    const s = fmtD(b.key, { weekday: 'short', day: 'numeric', month: 'short' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (period === '6M') return `Semana del ${fmtD(b.from, { day: 'numeric', month: 'short' })}`;
  return fmtD(b.from, { month: 'long', year: 'numeric' });
}

/** Segmented control + ‹ › navigation used by every detail page. */
export function PeriodBar({ period, setPeriod, end, setEnd, options = PERIODS }) {
  return html`<div class="period-bar">
    <div class="seg seg-full">${options.map(([v, l]) => html`<button class=${period === v ? 'on' : ''} onClick=${() => setPeriod(v)}>${l}</button>`)}</div>
  </div>`;
}

export function RangeNav({ period, end, setEnd }) {
  const atEnd = end >= todayKey();
  return html`<div class="row" style="gap:6px">
    <button class="btn small icon" aria-label="Anterior" onClick=${() => setEnd(shiftEnd(period, end, -1))}><${Icon} n="chevl" /></button>
    <button class="btn small icon" aria-label="Siguiente" disabled=${atEnd} onClick=${() => setEnd(shiftEnd(period, end, 1))}><${Icon} n="chev" /></button>
  </div>`;
}
