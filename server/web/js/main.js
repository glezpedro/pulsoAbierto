// App shell: routing, navigation, status polling, global sync control.
import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import { store, useStore, api, toast, ago, useEventTarget, CAT } from './core.js';
import { Icon } from './icons.js';
import { strap, CONN } from './ble/strap.js';
import { SyncButton, StatusPill } from './layout.js';

import { TodayView } from './views/today.js';
import { SleepView } from './views/sleep.js';
import { RecoveryView } from './views/recovery.js';
import { LoadView } from './views/load.js';
import { TrendsView } from './views/trends.js';
import { WeeklyView } from './views/weekly.js';
import { TrainingView } from './views/training.js';
import { CoachView } from './views/coach.js';
import { LiveView } from './views/live.js';
import { StrapView } from './views/strap.js';
import { BodyView } from './views/body.js';
import { JournalView } from './views/journal.js';
import { SettingsView } from './views/settings.js';
import { MetricView } from './views/metric.js';

export const ROUTES = [
  { id: 'hoy', title: 'Resumen', icon: 'heart', view: TodayView, group: 'Diario' },
  { id: 'sueno', title: 'Sueño', icon: 'sleep', view: SleepView, group: 'Diario' },
  { id: 'recuperacion', title: 'Recuperación', icon: 'heart', view: RecoveryView, group: 'Diario' },
  { id: 'carga', title: 'Esfuerzo y carga', icon: 'bolt', view: LoadView, group: 'Diario' },
  { id: 'tendencias', title: 'Tendencias', icon: 'trend', view: TrendsView, group: 'Análisis' },
  { id: 'semanal', title: 'Informe semanal', icon: 'report', view: WeeklyView, group: 'Análisis' },
  { id: 'diario', title: 'Diario de hábitos', icon: 'book', view: JournalView, group: 'Análisis' },
  { id: 'entreno', title: 'Entreno', icon: 'dumbbell', view: TrainingView, group: 'Entreno' },
  { id: 'directo', title: 'En directo', icon: 'live', view: LiveView, group: 'Entreno' },
  { id: 'cuerpo', title: 'Medidas', icon: 'body', view: BodyView, group: 'Entreno' },
  // Coach IA oculto de la navegación mientras no se use (la API de Anthropic es de pago). Sigue en #/coach.
  { id: 'coach', title: 'Coach IA', icon: 'spark', view: CoachView, group: 'Entreno', hidden: true },
  { id: 'pulsera', title: 'Pulsera', icon: 'watch', view: StrapView, group: 'Sistema' },
  { id: 'ajustes', title: 'Ajustes', icon: 'gear', view: SettingsView, group: 'Sistema' },
];
const TABS = ['hoy', 'sueno', 'carga', 'pulsera', 'mas'];

function useRoute() {
  const parse = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'hoy');
  const [r, setR] = useState(parse());
  useEffect(() => { const f = () => { setR(parse()); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (id) => { location.hash = `#/${id}`; };

// ------------------------------------------------------------ status polling
let lastRun = null;
let wasRunning = false;
async function poll() {
  try {
    const s = await api('/status');
    const running = s.analysis.running || s.dirty > 0;
    const changed = (s.analysis.lastRun && s.analysis.lastRun !== lastRun) || (wasRunning && !running);
    lastRun = s.analysis.lastRun; wasRunning = running;
    strap.serverSettings = s.settings;
    store.set({ status: s, offline: false });
    if (changed) store.bump();
    setTimeout(poll, running ? 2500 : 15000);
  } catch {
    store.set({ offline: true });
    setTimeout(poll, 8000);
  }
}
strap.addEventListener('alarm', () => api('/status').then((s) => store.set({ status: s })).catch(() => {}));
strap.addEventListener('uploaded', () => setTimeout(() => api('/status').then((s) => store.set({ status: s })).catch(() => {}), 1500));
poll();
// Intento de reconexión silenciosa al abrir (si el navegador lo permite).
setTimeout(() => strap.autoConnect().catch(() => {}), 800);
// Sube lo que quedara pendiente de una sesión anterior.
setTimeout(() => strap.upload().catch(() => {}), 1500);
// Corrección única de datos ya descargados con el formato mal detectado (no necesita la pulsera).
setTimeout(() => strap.repairDecoding().then((r) => { if (r?.stored || r?.removed) toast('Frecuencia cardiaca corregida en los datos ya descargados. Se está recalculando el análisis.', 6000); })
  .catch((e) => strap.log(`Corrección de datos pendiente: ${e.message}`, 'warn')), 4000);

function Sidebar({ route }) {
  const visible = ROUTES.filter((r) => !r.hidden);
  const groups = [...new Set(visible.map((r) => r.group))];
  return html`<aside class="sidebar">
    <div class="brand"><img class="brand-logo" src="/icon.svg" alt="" /><b>Pulso</b></div>
    <div class="hide-mobile"><${SyncButton} /></div>
    <nav class="nav nav-group"><a href="#/mas" class=${route === 'mas' ? 'active' : ''}><span class="ic" style="background:var(--accent)"><${Icon} n="grid" size=${16} /></span>Explorar</a></nav>
    ${groups.map((g) => html`<nav class="nav nav-group"><span class="label">${g}</span>
      ${visible.filter((r) => r.group === g).map((r) => html`<a href=${`#/${r.id}`} class=${route === r.id ? 'active' : ''}><span class="ic" style=${{ background: CAT[r.icon] || 'var(--accent)' }}><${Icon} n=${r.icon} size=${16} /></span>${r.title}</a>`)}
    </nav>`)}
  </aside>`;
}

function TabBar({ route }) {
  const items = { hoy: ['Resumen', 'heart'], sueno: ['Sueño', 'sleep'], carga: ['Carga', 'bolt'], pulsera: ['Pulsera', 'watch'], mas: ['Explorar', 'grid'] };
  const inMore = !TABS.includes(route) && !route.startsWith('m/');
  return html`<nav class="tabbar">${TABS.map((t) => html`<a href=${`#/${t}`} class=${route === t || (t === 'mas' && inMore) || (t === 'hoy' && route.startsWith('m/')) ? 'active' : ''}>
    <span class="ic"><${Icon} n=${items[t][1]} size=${24} /></span>${items[t][0]}</a>`)}</nav>`;
}

// Explorar (como «Explorar» de Salud): categorías con sus datos y el resto de secciones.
const CATEGORIES = [
  { t: 'Actividad', icon: 'flame', c: 'var(--activity)', items: [['Esfuerzo', '#/m/strain'], ['Energía activa', '#/m/activeKcal'], ['Energía total', '#/m/kcal'], ['Pasos', '#/m/steps'], ['Esfuerzo y carga', '#/carga'], ['Entreno', '#/entreno']] },
  { t: 'Corazón', icon: 'heart', c: 'var(--heart)', items: [['Frecuencia cardiaca', '#/m/hr'], ['Frecuencia cardiaca en reposo', '#/m/rhr'], ['Variabilidad de la frecuencia cardiaca', '#/m/hrv'], ['Recuperación', '#/m/recovery'], ['Medición en directo', '#/directo']] },
  { t: 'Respiración', icon: 'lungs', c: 'var(--resp)', items: [['Frecuencia respiratoria', '#/m/resp'], ['Oxígeno en sangre (exp.)', '#/m/spo2']] },
  { t: 'Sueño', icon: 'sleep', c: 'var(--sleep)', items: [['Sueño', '#/sueno'], ['Puntuación de sueño', '#/m/sleepScore']] },
  { t: 'Constantes', icon: 'temp', c: 'var(--body)', items: [['Temperatura de la piel', '#/m/skinTemp'], ['Recuperación y constantes', '#/recuperacion']] },
  { t: 'Salud mental', icon: 'mind', c: 'var(--mind)', items: [['Estrés', '#/m/avgStress'], ['Diario de hábitos', '#/diario']] },
  { t: 'Medidas corporales', icon: 'body', c: 'var(--body)', items: [['Peso y medidas', '#/cuerpo']] },
];

function MoreView() {
  const [q, setQ] = useState('');
  const match = (x) => !q || x.toLowerCase().includes(q.toLowerCase());
  const others = ROUTES.filter((r) => !TABS.includes(r.id) && !r.hidden && ['tendencias', 'semanal', 'pulsera', 'ajustes'].includes(r.id));
  return html`<div class="page">
    <div class="topbar"><h1>Explorar</h1><${StatusPill} /></div>
    <input type="search" class="search" placeholder="Buscar" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="section-title">Categorías de salud</div>
    <div class="cat-grid">${CATEGORIES.filter((c) => match(c.t) || c.items.some(([t]) => match(t))).map((c) => html`
      <details class="card cat-card" open=${!!q} style=${{ '--cat': c.c }}>
        <summary><span class="ic" style=${{ background: c.c }}><${Icon} n=${c.icon} size=${17} /></span><span class="grow">${c.t}</span><span class="muted chev"><${Icon} n="chev" /></span></summary>
        <div class="col" style="gap:0">${c.items.filter(([t]) => !q || match(t) || match(c.t)).map(([t, h]) => html`
          <a class="list-item" href=${h} style="color:inherit;padding-left:42px"><span class="grow">${t}</span><span class="muted"><${Icon} n="chev" /></span></a>`)}</div>
      </details>`)}</div>
    <div class="section-title">Más</div>
    <div class="card">${others.map((r) => html`
      <a class="list-item" href=${`#/${r.id}`} style="color:inherit"><span class="ic" style=${{ background: CAT[r.icon] || 'var(--accent)' }}><${Icon} n=${r.icon} size=${17} /></span><span class="grow">${r.title}</span><span class="muted"><${Icon} n="chev" /></span></a>`)}
    </div></div>`;
}

function App() {
  const route = useRoute();
  const st = useStore();
  const r = ROUTES.find((x) => x.id === route);
  const mkey = route.startsWith('m/') ? route.slice(2) : null;
  const View = route === 'mas' ? MoreView : (r ? r.view : TodayView);
  return html`<div class="shell">
    <${Sidebar} route=${route} />
    <main class="main">${mkey ? html`<${MetricView} mkey=${mkey} key=${mkey} />` : html`<${View} />`}</main>
    <${TabBar} route=${route} />
    ${st.toast && html`<div class="toast" role="status">${st.toast}</div>`}
  </div>`;
}

window.pulso = { strap, store };   // acceso para depuración desde la consola
render(html`<${App} />`, document.getElementById('app'));
