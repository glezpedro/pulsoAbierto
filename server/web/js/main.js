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

function Sidebar({ route }) {
  const visible = ROUTES.filter((r) => !r.hidden);
  const groups = [...new Set(visible.map((r) => r.group))];
  return html`<aside class="sidebar">
    <div class="brand"><img class="brand-logo" src="/icon.svg" alt="" /><b>Pulso</b></div>
    <div class="hide-mobile"><${SyncButton} /></div>
    ${groups.map((g) => html`<nav class="nav nav-group"><span class="label">${g}</span>
      ${visible.filter((r) => r.group === g).map((r) => html`<a href=${`#/${r.id}`} class=${route === r.id ? 'active' : ''}><span class="ic" style=${{ background: CAT[r.icon] || 'var(--accent)' }}><${Icon} n=${r.icon} size=${16} /></span>${r.title}</a>`)}
    </nav>`)}
  </aside>`;
}

function TabBar({ route }) {
  const items = { hoy: ['Resumen', 'heart'], sueno: ['Sueño', 'sleep'], carga: ['Carga', 'bolt'], pulsera: ['Pulsera', 'watch'], mas: ['Explorar', 'grid'] };
  const inMore = !TABS.includes(route);
  return html`<nav class="tabbar">${TABS.map((t) => html`<a href=${`#/${t}`} class=${route === t || (t === 'mas' && inMore) ? 'active' : ''}>
    <span class="ic"><${Icon} n=${items[t][1]} size=${24} /></span>${items[t][0]}</a>`)}</nav>`;
}

function MoreView() {
  return html`<div class="page">
    <div class="topbar"><h1>Explorar</h1><${StatusPill} /></div>
    <${SyncButton} big />
    <div class="card">${ROUTES.filter((r) => !TABS.includes(r.id) && !r.hidden).map((r) => html`
      <a class="list-item" href=${`#/${r.id}`} style="color:inherit"><span class="ic" style=${{ background: CAT[r.icon] || 'var(--accent)' }}><${Icon} n=${r.icon} size=${17} /></span><span class="grow">${r.title}</span><span class="muted"><${Icon} n="chev" /></span></a>`)}
    </div></div>`;
}

function App() {
  const route = useRoute();
  const st = useStore();
  const r = ROUTES.find((x) => x.id === route);
  const View = route === 'mas' ? MoreView : (r ? r.view : TodayView);
  return html`<div class="shell">
    <${Sidebar} route=${route} />
    <main class="main"><${View} /></main>
    <${TabBar} route=${route} />
    ${st.toast && html`<div class="toast" role="status">${st.toast}</div>`}
  </div>`;
}

window.pulso = { strap, store };   // acceso para depuración desde la consola
render(html`<${App} />`, document.getElementById('app'));
