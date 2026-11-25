// Shared state, API client, formatting and hooks.
import { html, useState, useEffect, useRef, useCallback } from '../vendor/preact-htm.js';

export { html };

// ------------------------------------------------------------ API
export async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers['content-type'] = 'application/json'; init.method = init.method || 'POST'; }
  const r = await fetch('/api' + path, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

// ------------------------------------------------------------ store
const listeners = new Set();
export const store = {
  s: { status: null, date: todayKey(), version: 0, toast: null },
  set(p) { Object.assign(this.s, p); listeners.forEach((f) => f()); },
  bump() { this.set({ version: this.s.version + 1 }); },
};
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return store.s;
}
export function toast(msg, ms = 3500) {
  store.set({ toast: msg });
  clearTimeout(toast.t);
  toast.t = setTimeout(() => store.set({ toast: null }), ms);
}

/** Fetch JSON and refetch when deps or the global data version change. */
export function useApi(path, deps = []) {
  const { version } = useStore();
  const [st, setSt] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const load = useCallback(() => {
    if (!path) { setSt({ data: null, loading: false, error: null }); return; }
    setSt((s) => ({ ...s, loading: true }));
    api(path).then((data) => alive.current && setSt({ data, loading: false, error: null }))
      .catch((error) => alive.current && setSt({ data: null, loading: false, error: error.message }));
  }, [path]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [path, version, ...deps]);
  return { ...st, reload: load };
}

export function useIsMobile() {
  const q = '(max-width: 860px)';
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return m;
}

export function useEventTarget(target, ev = 'change') {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); target.addEventListener(ev, f); return () => target.removeEventListener(ev, f); }, [target]);
}

// ------------------------------------------------------------ dates (Europe/Madrid via browser)
export function todayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function addDays(key, n) { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return todayKey(d); }
export function keyDate(key) { return new Date(key + 'T12:00:00'); }
export const isToday = (key) => key === todayKey();
export function dayTitle(key) {
  if (key === todayKey()) return 'Hoy';
  if (key === addDays(todayKey(), -1)) return 'Ayer';
  const s = keyDate(key).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const hhmm = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '–');
export const dateShort = (ts) => new Date(ts * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
export const dateTime = (ts) => new Date(ts * 1000).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function ago(ms) {
  if (!ms) return 'nunca';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

// ------------------------------------------------------------ numbers
export function n(v, d = 0, unit = '') {
  if (v === null || v === undefined || Number.isNaN(v) || v === '') return '–';
  const s = Number(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  return unit ? `${s} ${unit}` : s;
}
export function hm(min) {
  if (min === null || min === undefined) return '–';
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}
export function hmShort(min) {
  if (min === null || min === undefined) return '–';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
export const mean = (a) => { const x = a.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
export const sd = (a) => { const x = a.filter((v) => v !== null && v !== undefined); if (x.length < 2) return null; const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };
export function pearson(a, b) {
  const p = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  if (p.length < 3) return null;
  const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
export function slope(xs, ys) {
  const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null);
  if (p.length < 2) return null;
  const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
  let num = 0, den = 0;
  for (const [x, y] of p) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}
export const needOf = (n) => (n ? Math.max(240, n.baselineMin + n.strainMin + n.debtMin - n.napCreditMin) : null);

// ------------------------------------------------------------ colors (read from CSS, follow light/dark)
const COLOR_VARS = {
  accent: '--accent', strain: '--strain', sleep: '--sleep', green: '--green', yellow: '--yellow', red: '--red', orange: '--orange',
  hr: '--hr', heart: '--heart', deep: '--deep', light: '--light', rem: '--rem', awake: '--awake', muted: '--muted', line: '--line',
  body: '--body', mind: '--mind', resp: '--resp', fg: '--fg', panel: '--panel', fill: '--fill', activity: '--activity',
};
export const C = {
  accent: '#007aff', strain: '#ff9500', sleep: '#30b0c7', green: '#34c759', yellow: '#ffcc00', red: '#ff3b30', orange: '#ff9500',
  hr: '#ff2d55', heart: '#ff2d55', deep: '#5856d6', light: '#0a84ff', rem: '#5ac8fa', awake: '#ff8a65', muted: '#8e8e93', line: 'rgba(60,60,67,.16)',
  body: '#af52de', mind: '#00c7be', resp: '#32ade6', fg: '#000', panel: '#fff', fill: 'rgba(118,118,128,.12)', activity: '#ff9500',
};
export function readColors() {
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const [k, v] of Object.entries(COLOR_VARS)) { const x = cs.getPropertyValue(v).trim(); if (x) C[k] = x; }
  } catch { /* SSR / tests */ }
}
readColors();
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); window.dispatchEvent(new Event('themechange')); store.bump(); });
} catch { /* ignore */ }
/** Apariencia: 'dark' (por defecto), 'light' o 'auto' (sigue al sistema). */
export const getTheme = () => { try { return localStorage.getItem('pulso.theme') || 'dark'; } catch { return 'dark'; } };
export function setTheme(t) {
  try { localStorage.setItem('pulso.theme', t); } catch { /* ignore */ }
  document.documentElement.dataset.theme = t;
  readColors(); window.dispatchEvent(new Event('themechange')); store.bump();
}
/** '#rrggbb' + alpha → rgba() (falls back to the colour itself). */
export function alpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export const recColor = (v) => (v == null ? C.muted : v >= 67 ? C.green : v >= 34 ? C.yellow : C.red);
export const recBand = (v) => (v == null ? '' : v >= 67 ? 'green' : v >= 34 ? 'yellow' : 'red');
export const ZONE_COLORS = ['#8e8e93', '#5ac8fa', '#34c759', '#ffcc00', '#ff9500', '#ff3b30'];
export const ZONES = ['Reposo', 'Z1 50–60 %', 'Z2 60–70 %', 'Z3 70–80 %', 'Z4 80–90 %', 'Z5 90–100 %'];
export const STAGES = [
  { k: 0, n: 'Despierto', get c() { return C.awake; } }, { k: 1, n: 'Básico', get c() { return C.light; } },
  { k: 2, n: 'Profundo', get c() { return C.deep; } }, { k: 3, n: 'REM', get c() { return C.rem; } },
];
/** Category colour per icon name (Salud-style headers). */
export const CAT = {
  heart: 'var(--heart)', live: 'var(--heart)', sleep: 'var(--sleep)', bolt: 'var(--activity)', dumbbell: 'var(--activity)',
  trend: 'var(--accent)', report: 'var(--accent)', today: 'var(--accent)', grid: 'var(--accent)', body: 'var(--body)',
  book: 'var(--mind)', stress: 'var(--mind)', wind: 'var(--mind)', spark: 'var(--deep)', battery: 'var(--green)',
  watch: 'var(--muted)', bt: 'var(--accent)', sync: 'var(--accent)', send: 'var(--accent)', trophy: 'var(--orange)', plus: 'var(--accent)',
};

// ------------------------------------------------------------ markdown (tiny, safe)
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function mdToHtml(src = '') {
  const lines = esc(src).split('\n');
  let out = '', list = null;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = l.match(/^\s*[-•*]\s+(.*)/), ol = l.match(/^\s*\d+[.)]\s+(.*)/), h = l.match(/^#{1,4}\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; }
      out += `<li>${inline((ul || ol)[1])}</li>`;
      continue;
    }
    if (list) { out += `</${list}>`; list = null; }
    if (h) out += `<h3>${inline(h[1])}</h3>`;
    else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  if (list) out += `</${list}>`;
  return out;
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
