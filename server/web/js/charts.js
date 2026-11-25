// Gráficas SVG al estilo de la app Salud: barras redondeadas, línea de media discontinua, eje a la
// derecha y «arrastrar para ver» (el dedo o el ratón seleccionan una barra/instante y la cabecera
// muestra su valor). Sin dependencias; se adaptan al ancho del contenedor.
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { C, STAGES, n, hm } from './core.js';

// ------------------------------------------------------------ helpers
export function useWidth(initial = 340) {
  const ref = useRef(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const set = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW(x); };
    set();
    if (typeof ResizeObserver === 'undefined') { addEventListener('resize', set); return () => removeEventListener('resize', set); }
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Nice axis ticks between lo and hi (≈ count ticks). */
export function ticks(lo, hi, count = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Pointer scrubbing over an SVG: returns handlers that call onIndex(i | null). */
function useScrub(count, x2i, onIndex) {
  const touchSel = useRef(null);
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = x2i(e.clientX - r.left, r.width);
    return i == null ? null : Math.max(0, Math.min(count - 1, i));
  };
  return {
    onPointerMove: (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) onIndex(pick(e)); },
    onPointerDown: (e) => { const i = pick(e); touchSel.current = i; onIndex(i); },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') onIndex(null); },
    onPointerCancel: () => onIndex(null),
  };
}

const yLabel = (v, fmt) => (fmt ? fmt(v) : n(v));

// ------------------------------------------------------------ bar chart (Salud)
/**
 * items: [{ key, label, value, lo?, hi?, segs?: [{ v, c }], dim? }]
 *  - value: plain bar from 0 (or from `base`)
 *  - lo/hi: floating range bar (FC mín–máx, horario de sueño)
 *  - segs: stacked bar (fases de sueño)
 */
export function BarChart({ items, color = C.accent, height = 190, yFmt, xEvery, avg, goal, goalLabel, onSelect, selected,
  yMin, yMax, invert = false, base = 0, unitTop, rangeColor, labelEvery }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const sel = selected ?? hover;
  const padR = 40, padB = 20, padT = 10;
  const vals = items.flatMap((d) => [d.value, d.lo, d.hi, d.segs ? d.segs.reduce((a, s) => a + (s.v || 0), 0) : null]).filter((v) => v != null);
  let lo = yMin ?? Math.min(base, ...vals);
  let hi = yMax ?? Math.max(...vals, goal ?? -Infinity, avg ?? -Infinity);
  if (!vals.length) { lo = 0; hi = 1; }
  if (yMax == null) hi += (hi - lo) * 0.08;
  const tk = ticks(lo, hi, 4);
  lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
  const ih = height - padB - padT, iw = Math.max(10, W - padR);
  const y = (v) => (invert ? padT + ((v - lo) / (hi - lo)) * ih : padT + ih - ((v - lo) / (hi - lo)) * ih);
  const bw = iw / Math.max(1, items.length);
  const barW = Math.max(2, Math.min(28, bw * 0.62));
  const x = (i) => i * bw + bw / 2;
  const every = labelEvery || xEvery || Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor(iw / 44))));
  const scrub = useScrub(items.length, (px) => Math.floor(px / bw), (i) => { setHover(i); onSelect?.(i); });
  const ry = Math.min(5, barW / 2);
  return html`<div ref=${ref} class="hkchart">
    <svg width=${W} height=${height} style="display:block;touch-action:pan-y" ...${scrub}>
      ${tk.map((t) => html`<g><line x1="0" x2=${iw} y1=${y(t)} y2=${y(t)} class="grid" />
        <text x=${iw + 6} y=${y(t) + 4} class="axis">${yLabel(t, yFmt)}</text></g>`)}
      ${items.map((d, i) => {
        const dim = sel != null && sel !== i;
        const op = dim ? 0.35 : d.dim ? 0.45 : 1;
        if (d.segs) {
          let acc = base;
          return html`<g opacity=${op}>${d.segs.map((s) => {
            if (!s.v) return null;
            const a = y(acc), b = y(acc + s.v); acc += s.v;
            return html`<rect x=${x(i) - barW / 2} width=${barW} y=${Math.min(a, b)} height=${Math.max(1, Math.abs(a - b))} fill=${s.c} />`;
          })}</g>`;
        }
        if (d.lo != null && d.hi != null) {
          const a = y(d.lo), b = y(d.hi);
          return html`<rect x=${x(i) - barW / 2} width=${barW} y=${Math.min(a, b)} height=${Math.max(barW * 0.9, Math.abs(a - b))} rx=${ry} fill=${d.color || rangeColor || color} opacity=${op} />`;
        }
        if (d.value == null) return null;
        const a = y(base), b = y(d.value);
        return html`<rect x=${x(i) - barW / 2} width=${barW} y=${Math.min(a, b)} height=${Math.max(2, Math.abs(a - b))} rx=${ry} fill=${d.color || color} opacity=${op} />`;
      })}
      ${avg != null && html`<g><line x1="0" x2=${iw} y1=${y(avg)} y2=${y(avg)} class="avg" /></g>`}
      ${goal != null && html`<g><line x1="0" x2=${iw} y1=${y(goal)} y2=${y(goal)} class="goal" />${goalLabel && html`<text x="4" y=${y(goal) - 4} class="axis goal-t">${goalLabel}</text>`}</g>`}
      ${items.map((d, i) => (i % every === 0 ? html`<text x=${x(i)} y=${height - 5} class="axis" text-anchor="middle">${d.label}</text>` : null))}
      ${sel != null && items[sel] && html`<line x1=${x(sel)} x2=${x(sel)} y1=${padT - 6} y2=${height - padB} class="cursor" />`}
    </svg>
    ${unitTop && html`<div class="axis-unit">${unitTop}</div>`}
  </div>`;
}

// ------------------------------------------------------------ line chart over time
/** points: [{ t (unix s), v, lo?, hi? }]; gaps (> gap s) break the line. */
export function LineChart({ points, color = C.accent, height = 170, yFmt, area = true, onSelect, band, dots = false, gap = 900,
  bands = [], xTicks, yMin, yMax, smooth = true, markers = [] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const padR = 40, padB = 20, padT = 10;
  const pts = points.filter((p) => p.v != null);
  const gid = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  const t0 = points.length ? points[0].t : 0, t1 = points.length ? points[points.length - 1].t : 1;
  const iw = Math.max(10, W - padR);
  const scrub = useScrub(pts.length, (px) => {
    const t = t0 + (px / iw) * (t1 - t0);
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = i; } });
    return best;
  }, (i) => { setHover(i); onSelect?.(i == null ? null : pts[i]); });
  if (pts.length < 2) return html`<div ref=${ref} class="small muted" style="padding:20px 0;text-align:center">Sin datos suficientes</div>`;
  const vs = pts.flatMap((p) => [p.v, p.lo, p.hi]).filter((v) => v != null);
  let lo = yMin ?? Math.min(...vs, band ? band[0] : Infinity), hi = yMax ?? Math.max(...vs, band ? band[1] : -Infinity);
  const padV = (hi - lo) * 0.1 || 1;
  if (yMin == null) lo -= padV;
  if (yMax == null) hi += padV;
  const tk = ticks(lo, hi, 3);
  const ih = height - padB - padT;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  // path with gaps
  const segs = [];
  let cur = [];
  pts.forEach((p, i) => {
    if (i && p.t - pts[i - 1].t > gap) { if (cur.length) segs.push(cur); cur = []; }
    cur.push(p);
  });
  if (cur.length) segs.push(cur);
  const line = (s) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const areaPath = (s) => `${line(s)}L${x(s[s.length - 1].t).toFixed(1)},${padT + ih}L${x(s[0].t).toFixed(1)},${padT + ih}Z`;
  const rangePath = (s) => {
    const r = s.filter((p) => p.lo != null && p.hi != null);
    if (r.length < 2) return '';
    return `${r.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.hi).toFixed(1)}`).join('')}${r.slice().reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.lo).toFixed(1)}`).join('')}Z`;
  };
  const hp = hover != null ? pts[hover] : null;
  const xt = xTicks || autoTimeTicks(t0, t1, iw);
  return html`<div ref=${ref} class="hkchart">
    <svg width=${W} height=${height} style="display:block;touch-action:pan-y" ...${scrub}>
      <defs><linearGradient id=${gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color=${color} stop-opacity="0.28" /><stop offset="1" stop-color=${color} stop-opacity="0.02" /></linearGradient></defs>
      ${bands.map((b) => html`<rect x=${x(b.from)} width=${Math.max(1, x(b.to) - x(b.from))} y=${padT} height=${ih} fill=${b.c} opacity=${b.o ?? 0.12} />`)}
      ${band && html`<rect x="0" width=${iw} y=${y(band[1])} height=${Math.max(1, y(band[0]) - y(band[1]))} class="band" />`}
      ${tk.map((t) => html`<g><line x1="0" x2=${iw} y1=${y(t)} y2=${y(t)} class="grid" /><text x=${iw + 6} y=${y(t) + 4} class="axis">${yLabel(t, yFmt)}</text></g>`)}
      ${segs.map((s) => html`<path d=${rangePath(s)} fill=${color} opacity="0.18" />`)}
      ${area && segs.map((s) => (s.length > 1 ? html`<path d=${areaPath(s)} fill=${`url(#${gid})`} />` : null))}
      ${segs.map((s) => html`<path d=${line(s)} fill="none" stroke=${color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`)}
      ${dots && pts.map((p) => html`<circle cx=${x(p.t)} cy=${y(p.v)} r="2.6" fill=${color} />`)}
      ${markers.map((m) => html`<g><circle cx=${x(m.t)} cy=${y(m.v)} r="4.5" fill=${m.c || color} stroke="var(--panel)" stroke-width="2" />${m.label && html`<text x=${x(m.t)} y=${y(m.v) - 9} class="axis" text-anchor="middle">${m.label}</text>`}</g>`)}
      ${xt.map((t) => html`<text x=${x(t.t)} y=${height - 5} class="axis" text-anchor="middle">${t.l}</text>`)}
      ${hp && html`<g><line x1=${x(hp.t)} x2=${x(hp.t)} y1=${padT - 6} y2=${padT + ih} class="cursor" /><circle cx=${x(hp.t)} cy=${y(hp.v)} r="5" fill=${color} stroke="var(--panel)" stroke-width="2" /></g>`}
    </svg>
  </div>`;
}

export function autoTimeTicks(t0, t1, iw) {
  const span = t1 - t0;
  const want = Math.max(2, Math.floor(iw / 60));
  const steps = [3600, 7200, 10800, 14400, 21600, 43200, 86400];
  const step = steps.find((s) => span / s <= want) || 86400;
  const out = [];
  const d0 = new Date(t0 * 1000); d0.setMinutes(0, 0, 0);
  let t = d0.getTime() / 1000;
  while (t < t0) t += 3600;
  for (; t <= t1; t += 3600) {
    const h = new Date(t * 1000).getHours();
    if ((h * 3600) % step === 0 || step === 86400 && h === 0) out.push({ t, l: step >= 86400 ? new Date(t * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : `${h}` });
  }
  return out;
}

// ------------------------------------------------------------ hypnogram (Salud)
const LEVEL = { 0: 0, 3: 1, 1: 2, 2: 3 };           // filas: Despierto, REM, Básico, Profundo
const ROWS = [0, 3, 1, 2];

/** Apple-style hypnogram: one row per stage, rounded blocks joined by thin connectors, scrubbable. */
export function Hypnogram({ start, segs, height = 180, onSelect }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const total = segs.reduce((a, s) => a + s[1], 0) || 1;
  const padL = 64, padB = 20, padT = 4;
  const iw = Math.max(10, W - padL - 4), ih = height - padB - padT, rowH = ih / 4;
  const x = (m) => padL + (m / total) * iw;
  const runs = [];
  let m = 0;
  for (const [s, len] of segs) { runs.push({ s, a: m, b: m + len }); m += len; }
  const yMid = (s) => padT + LEVEL[s] * rowH + rowH / 2;
  const blockH = Math.min(22, rowH * 0.62);
  const scrub = useScrub(total, (px) => (px < padL ? null : Math.floor(((px - padL) / iw) * total)), (i) => {
    setHover(i);
    if (i == null) { onSelect?.(null); return; }
    const r = runs.find((q) => i >= q.a && i < q.b);
    onSelect?.(r ? { stage: r.s, t: start + i * 60, run: r, runStart: start + r.a * 60, runEnd: start + r.b * 60 } : null);
  });
  const hours = [];
  for (let t = Math.ceil(start / 3600) * 3600; t < start + total * 60; t += 3600) hours.push(t);
  const every = Math.max(1, Math.ceil(hours.length / Math.max(2, Math.floor(iw / 42))));
  const hr = hover != null ? runs.find((q) => hover >= q.a && hover < q.b) : null;
  return html`<div ref=${ref} class="hkchart">
    <svg width=${W} height=${height} style="display:block;touch-action:pan-y" ...${scrub}>
      ${ROWS.map((s, r) => html`<g>
        <line x1=${padL} x2=${padL + iw} y1=${padT + r * rowH + rowH / 2} y2=${padT + r * rowH + rowH / 2} class="grid" stroke-dasharray="2 4" />
        <text x="0" y=${padT + r * rowH + rowH / 2 + 4} class="axis" style=${{ fill: STAGES[s].c, fontWeight: 600 }}>${STAGES[s].n}</text></g>`)}
      ${runs.map((q, i) => (i ? html`<line x1=${x(q.a)} x2=${x(q.a)} y1=${yMid(runs[i - 1].s)} y2=${yMid(q.s)} stroke=${STAGES[q.s].c} stroke-width="1.2" opacity="0.6" />` : null))}
      ${runs.map((q) => html`<rect x=${x(q.a)} width=${Math.max(1.5, x(q.b) - x(q.a))} y=${yMid(q.s) - blockH / 2} height=${blockH} rx=${Math.min(4, (x(q.b) - x(q.a)) / 2)}
        fill=${STAGES[q.s].c} opacity=${hr && hr !== q ? 0.45 : 1} />`)}
      ${hours.map((t, i) => (i % every === 0 ? html`<text x=${x((t - start) / 60)} y=${height - 5} class="axis" text-anchor="middle">${new Date(t * 1000).getHours()}</text>` : null))}
      ${hover != null && html`<line x1=${x(hover)} x2=${x(hover)} y1=${padT} y2=${padT + ih} class="cursor" />`}
    </svg>
  </div>`;
}

// ------------------------------------------------------------ nights as floating bars (W / M)
/**
 * nights: [{ day, label, start, end, segs }] — each night drawn at its clock position (y = time of
 * night, 18:00 → 14:00), coloured by stage in order, like Salud › Sueño › Fases (semana / mes).
 */
export function NightsChart({ nights, height = 230, onSelect, selected }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const sel = selected ?? hover;
  const padR = 44, padB = 20, padT = 8;
  const iw = Math.max(10, W - padR), ih = height - padB - padT;
  // clock minutes relative to 18:00
  // minutes from 18:00; 12:00–18:00 count as «before» (negative) so an early bedtime still fits
  const rel = (ts) => { const d = new Date(ts * 1000); let m = d.getHours() * 60 + d.getMinutes() - 18 * 60; if (m < -360) m += 1440; return m; };
  const has = nights.filter((d) => d.start);
  let lo = has.length ? Math.min(...has.map((d) => rel(d.start))) : 240;
  let hi = has.length ? Math.max(...has.map((d) => rel(d.end))) : 900;
  lo = Math.floor((lo - 30) / 60) * 60; hi = Math.ceil((hi + 30) / 60) * 60;
  if (hi - lo < 360) hi = lo + 360;
  const y = (m) => padT + ((m - lo) / (hi - lo)) * ih;
  const bw = iw / Math.max(1, nights.length);
  const barW = Math.max(3, Math.min(26, bw * 0.6));
  const x = (i) => i * bw + bw / 2;
  const tk = [];
  const stepH = (hi - lo) / 60 > 10 ? 3 : 2;
  for (let m = Math.ceil(lo / (60 * stepH)) * 60 * stepH; m <= hi; m += 60 * stepH) tk.push(m);
  const every = Math.max(1, Math.ceil(nights.length / Math.max(2, Math.floor(iw / 40))));
  const scrub = useScrub(nights.length, (px) => Math.floor(px / bw), (i) => { setHover(i); onSelect?.(i); });
  return html`<div ref=${ref} class="hkchart">
    <svg width=${W} height=${height} style="display:block;touch-action:pan-y" ...${scrub}>
      ${tk.map((m) => html`<g><line x1="0" x2=${iw} y1=${y(m)} y2=${y(m)} class="grid" /><text x=${iw + 6} y=${y(m) + 4} class="axis">${String(((Math.floor(m / 60) + 18) % 24 + 24) % 24).padStart(2, '0')}:00</text></g>`)}
      ${nights.map((d, i) => {
        if (!d.start) return null;
        const op = sel != null && sel !== i ? 0.35 : 1;
        const base = rel(d.start);
        let acc = 0;
        const clip = `c${d.day}`;
        return html`<g opacity=${op}>
          <clipPath id=${clip}><rect x=${x(i) - barW / 2} width=${barW} y=${y(base)} height=${Math.max(2, y(base + (d.end - d.start) / 60) - y(base))} rx=${Math.min(5, barW / 2)} /></clipPath>
          <g clip-path=${`url(#${clip})`}>${d.segs.map(([s, len]) => { const a = y(base + acc); acc += len; return html`<rect x=${x(i) - barW / 2} width=${barW} y=${a} height=${Math.max(0.6, y(base + acc) - a + 0.3)} fill=${STAGES[s].c} />`; })}</g>
        </g>`;
      })}
      ${nights.map((d, i) => (i % every === 0 ? html`<text x=${x(i)} y=${height - 5} class="axis" text-anchor="middle">${d.label}</text>` : null))}
      ${sel != null && nights[sel] && html`<line x1=${x(sel)} x2=${x(sel)} y1=${padT - 6} y2=${padT + ih} class="cursor" />`}
    </svg>
  </div>`;
}

// ------------------------------------------------------------ range dot (Vitales)
/** Horizontal track: typical range shaded, dot at the value (coloured by state). */
export function RangeDot({ lo, hi, min, max, value, color = C.accent, state }) {
  if (lo == null || hi == null) return null;
  const a = Math.min(min ?? lo, lo, value ?? lo), b = Math.max(max ?? hi, hi, value ?? hi);
  const pad = (b - a) * 0.15 || 1;
  const L = a - pad, R = b + pad;
  const p = (v) => `${((v - L) / (R - L)) * 100}%`;
  const c = state && state !== 'típico' ? 'var(--orange)' : color;
  return html`<div class="rangedot">
    <div class="track"></div>
    <div class="typ" style=${{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})`, background: color }}></div>
    ${value != null && html`<div class="dot" style=${{ left: p(value), background: c }}></div>`}
  </div>`;
}

// ------------------------------------------------------------ stacked 100 % bar
export function StackBar({ parts, height = 12 }) {
  const tot = parts.reduce((a, p) => a + (p.v || 0), 0) || 1;
  return html`<div class="stackbar" style=${{ height: `${height}px` }}>${parts.map((p) => (p.v ? html`<i style=${{ width: `${(p.v / tot) * 100}%`, background: p.c }} title=${`${p.n}: ${hm(p.v)}`}></i>` : null))}</div>`;
}

/** Half-ring gauge 0–100 (regularidad, puntuación). */
export function Gauge({ value, color = C.accent, size = 120, label, text }) {
  const r = 46, c = Math.PI * r, p = Math.max(0, Math.min(1, (value || 0) / 100));
  return html`<svg viewBox="0 0 120 70" width=${size} height=${size * 0.58} role="img" aria-label=${`${label || ''} ${text ?? n(value)}`}>
    <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke=${color} stroke-opacity="0.15" stroke-width="10" stroke-linecap="round" />
    <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke=${color} stroke-width="10" stroke-linecap="round" stroke-dasharray=${`${c * p} ${c}`} />
    <text x="60" y="58" text-anchor="middle" class="ring-value" font-size="24">${text ?? n(value)}</text>
  </svg>`;
}
