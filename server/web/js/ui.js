// Reusable UI components (Preact + htm) and Chart.js wrapper.
import { html, useEffect, useRef } from '../vendor/preact-htm.js';
import { C, ZONE_COLORS, ZONES, STAGES, n, hm, hhmm, mdToHtml, recColor } from './core.js';

const Chart = window.Chart;
if (Chart) {
  Chart.defaults.color = '#8e9aa5';
  Chart.defaults.borderColor = '#232a33';
  Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1f262e';
  Chart.defaults.plugins.tooltip.borderColor = '#33404d';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = { duration: 300 };
}

export function Card({ title, icon, right, children, cls = '', span }) {
  return html`<section class=${`card ${span ? 'span-' + span : ''} ${cls}`}>
    ${(title || right) && html`<div class="card-h"><h2>${icon && html`<span class="ic">${icon}</span>`}${title}</h2>${right}</div>`}
    ${children}
  </section>`;
}

export function Tile({ t, v, unit, icon, color, d, good }) {
  return html`<div class="tile">
    <div class="t">${icon && html`<span style=${{ color: color || C.accent }}>${icon}</span>`}${t}</div>
    <div class="v">${v}${unit && html`<small>${unit}</small>`}</div>
    ${d && html`<div class=${`d ${good === true ? 'good' : good === false ? 'bad' : 'muted'}`}>${d}</div>`}
  </div>`;
}

export const Stat = ({ k, v }) => html`<div class="stat"><span>${k}</span><span>${v}</span></div>`;
export const Spinner = () => html`<div class="spinner"></div>`;
export const Empty = ({ icon = '〰️', title, children }) => html`<div class="empty"><div class="big">${icon}</div><b>${title}</b><div class="small">${children}</div></div>`;
export const Md = ({ text }) => html`<div class="md" dangerouslySetInnerHTML=${{ __html: mdToHtml(text || '') }}></div>`;

export function Seg({ value, options, onChange }) {
  return html`<div class="seg">${options.map(([v, l]) => html`<button class=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}

export function Ring({ value, max = 100, color, label, text, caption, size = 170, onClick }) {
  const r = 70, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, (value || 0) / max));
  return html`<div class="ring" onClick=${onClick}>
    <svg viewBox="0 0 170 170" style=${{ maxWidth: size + 'px' }} role="img" aria-label=${`${label} ${text}`}>
      <circle cx="85" cy="85" r=${r} fill="none" stroke=${color} stroke-opacity="0.15" stroke-width="13" />
      <circle cx="85" cy="85" r=${r} fill="none" stroke=${color} stroke-width="13" stroke-linecap="round"
        stroke-dasharray=${`${c * p} ${c}`} transform="rotate(-90 85 85)" style="transition: stroke-dasharray .8s" />
      <text x="85" y=${caption ? 86 : 94} text-anchor="middle" class="ring-value" fill="#eef2f4" font-size="30">${text}</text>
      ${caption && html`<text x="85" y="110" text-anchor="middle" fill="#8e9aa5" font-size="12">${caption}</text>`}
    </svg>
    <span class="lbl" style=${{ color }}>${label}</span>
  </div>`;
}

export function ZoneBar({ zones = [] }) {
  const tot = zones.slice(1).reduce((a, b) => a + b, 0) || 1;
  return html`<div class="zonebar">${zones.slice(1, 6).map((z, i) => html`<i style=${{ width: `${(z / tot) * 100}%`, background: ZONE_COLORS[i + 1] }} title=${`${ZONES[i + 1]}: ${hm(z / 60)}`}></i>`)}</div>`;
}

export function ZoneTable({ zones = [] }) {
  const tot = zones.reduce((a, b) => a + b, 0) || 1;
  return html`<div class="col" style="gap:6px">${zones.map((z, i) => html`
    <div class="row" style="gap:8px">
      <span style=${{ width: '10px', height: '10px', borderRadius: '3px', background: ZONE_COLORS[i] }}></span>
      <span class="small grow">${ZONES[i]}</span>
      <div class="bar" style="width:90px"><i style=${{ width: `${(z / tot) * 100}%`, background: ZONE_COLORS[i] }}></i></div>
      <span class="small num" style="width:70px;text-align:right">${hm(z / 60)}</span>
    </div>`)}</div>`;
}

export function Bar({ value, max, color }) {
  return html`<div class="bar"><i style=${{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }}></i></div>`;
}

/** SVG hypnogram: one rect per stage run. */
export function Hypnogram({ session, height = 150 }) {
  if (!session?.stages?.length) return null;
  const st = session.stages, W = 1000, rowH = height / 4, lvl = { 0: 0, 3: 1, 1: 2, 2: 3 };
  const runs = [];
  for (let i = 0; i < st.length;) { let j = i; while (j + 1 < st.length && st[j + 1] === st[i]) j++; runs.push([i, j + 1, st[i]]); i = j + 1; }
  const x = (m) => (m / st.length) * W;
  const hours = [];
  const start = session.start;
  for (let t = Math.ceil(start / 3600) * 3600; t < session.end; t += 3600) hours.push(t);
  return html`<div class="col" style="gap:4px">
    <svg viewBox=${`0 0 ${W} ${height + 18}`} preserveAspectRatio="none" style="width:100%;height:${height + 18}px">
      ${[0, 1, 2, 3].map((r) => html`<line x1="0" x2=${W} y1=${r * rowH + rowH / 2} y2=${r * rowH + rowH / 2} stroke="#232a33" stroke-dasharray="4 6" />`)}
      ${runs.map(([a, b, s]) => html`<rect x=${x(a)} width=${Math.max(1, x(b) - x(a))} y=${lvl[s] * rowH + 4} height=${rowH - 8} rx="3" fill=${STAGES[s].c} />`)}
      ${hours.map((t) => html`<text x=${x((t - start) / 60)} y=${height + 14} fill="#5b6670" font-size="12" text-anchor="middle">${new Date(t * 1000).getHours()}h</text>`)}
    </svg>
    <div class="legend">${[0, 3, 1, 2].map((s) => html`<span><i style=${{ background: STAGES[s].c }}></i>${STAGES[s].n}</span>`)}</div>
  </div>`;
}

/** Calendar heatmap of a metric (default recovery). days = [{dayKey, value}] oldest→newest */
export function Heatmap({ days, color = recColor, fmt = (v) => n(v), onPick }) {
  if (!days.length) return null;
  const first = new Date(days[0].dayKey + 'T12:00:00');
  const pad = (first.getDay() + 6) % 7;
  return html`<div class="col" style="gap:6px">
    <div class="heat tiny muted">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => html`<span style="text-align:center">${d}</span>`)}</div>
    <div class="heat">
      ${Array.from({ length: pad }, () => html`<div></div>`)}
      ${days.map((d) => html`<div title=${`${d.dayKey}: ${fmt(d.value)}`} onClick=${() => onPick?.(d.dayKey)}
        style=${{ background: d.value == null ? '#151a20' : color(d.value), cursor: onPick ? 'pointer' : 'default', opacity: d.value == null ? 1 : 0.85 }}>
        ${Number(d.dayKey.slice(8))}</div>`)}
    </div>
  </div>`;
}

export function Sparkline({ values, color = C.accent, height = 34 }) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), W = 120;
  const pts = values.map((x, i) => (x == null ? null : [(i / (values.length - 1)) * W, height - 3 - ((x - min) / (max - min || 1)) * (height - 6)])).filter(Boolean);
  return html`<svg viewBox=${`0 0 ${W} ${height}`} style="width:100%;height:${height}px" preserveAspectRatio="none">
    <polyline fill="none" stroke=${color} stroke-width="2" points=${pts.map((p) => p.join(',')).join(' ')} />
    <circle cx=${pts[pts.length - 1][0]} cy=${pts[pts.length - 1][1]} r="3" fill=${color} /></svg>`;
}

/** Chart.js wrapper. `config` is rebuilt when `deps` change. */
export function ChartBox({ config, height = 220, deps = [] }) {
  const ref = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    if (!Chart || !ref.current) return undefined;
    chart.current?.destroy();
    chart.current = new Chart(ref.current.getContext('2d'), typeof config === 'function' ? config() : config);
    return () => { chart.current?.destroy(); chart.current = null; };
  }, deps);
  if (!Chart) return html`<div class="muted small">Gráficas no disponibles</div>`;
  return html`<div class="chart" style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}

export const timeX = (unit = 'hour', fmt = 'HH:mm') => ({
  type: 'time', time: { unit, displayFormats: { hour: 'HH:mm', day: 'd MMM', week: 'd MMM', month: 'MMM yy', minute: 'HH:mm' }, tooltipFormat: fmt === 'HH:mm' ? 'd MMM HH:mm' : 'd MMM yyyy' },
  grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
});

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-label=${title}>
      <div class="row between"><h2>${title}</h2><button class="btn small" onClick=${onClose}>Cerrar</button></div>
      ${children}
    </div></div>`;
}

export function Delta({ cur, prev, digits = 0, higherIsBetter }) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  const cls = higherIsBetter == null || Math.abs(d) < 10 ** -digits ? 'muted' : (d > 0) === higherIsBetter ? 'good' : 'bad';
  return html`<span class=${`small num ${cls}`}>${d > 0 ? '+' : ''}${n(d, digits)}</span>`;
}

export { hhmm };
