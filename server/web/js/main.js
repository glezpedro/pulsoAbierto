// App shell: routing, navigation, status polling, global sync control.
import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import { store, useStore, api, toast, ago, useEventTarget, CAT } from './core.js';
import { Icon } from './icons.js';
import { strap, CONN } from './ble/strap.js';
import { SyncButton, StatusPill } from './layout.js';

import { TodayDetail } from './views/today.js';
import { HomeView } from './views/home.js';
import { SaludView, ExploreList } from './views/salud.js';
import { EntrenoView, SessionView } from './views/entreno.js';
import { BienestarView } from './views/bienestar.js';
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

const DayView = () => html`<${TodayDetail} onBack=${() => { location.hash = '#/hoy'; }} />`;
const ExploreView = () => html`<div class="page"><div class="topbar"><h1>Explorar</h1><${StatusPill} /></div><${ExploreList} /></div>`;

export const ROUTES = [
  { id: 'hoy', title: 'Inicio', icon: 'home', view: HomeView, group: 'Pulso' },
  { id: 'salud', title: 'Salud', icon: 'heart', view: SaludView, group: 'Pulso' },
  { id: 'sueno', title: 'Sueño', icon: 'sleep', view: SleepView, group: 'Pulso' },
  { id: 'entreno', title: 'Entreno', icon: 'dumbbell', view: EntrenoView, group: 'Pulso' },
  { id: 'bienestar', title: 'Bienestar', icon: 'leaf', view: BienestarView, group: 'Pulso' },
  { id: 'dia', title: 'El día en detalle', icon: 'today', view: DayView, group: 'Análisis' },
  { id: 'recuperacion', title: 'Recuperación', icon: 'heart', view: RecoveryView, group: 'Análisis' },
  { id: 'carga', title: 'Esfuerzo y carga', icon: 'bolt', view: LoadView, group: 'Análisis' },
  { id: 'tendencias', title: 'Tendencias', icon: 'trend', view: TrendsView, group: 'Análisis' },
  { id: 'semanal', title: 'Informe semanal', icon: 'report', view: WeeklyView, group: 'Análisis' },
  { id: 'diario', title: 'Diario de hábitos', icon: 'book', view: JournalView, group: 'Análisis' },
  { id: 'plan', title: 'Plan y progreso', icon: 'dumbbell', view: TrainingView, group: 'Más' },
  { id: 'directo', title: 'En directo', icon: 'live', view: LiveView, group: 'Más' },
  { id: 'cuerpo', title: 'Medidas', icon: 'body', view: BodyView, group: 'Más' },
  { id: 'sesion', title: 'Sesión', icon: 'play', view: SessionView, group: 'Más', hidden: true },
  { id: 'mas', title: 'Explorar', icon: 'grid', view: ExploreView, group: 'Más', hidden: true },
  // Coach IA oculto de la navegación mientras no se use (la API de Anthropic es de pago). Sigue en #/coach.
  { id: 'coach', title: 'Coach IA', icon: 'spark', view: CoachView, group: 'Más', hidden: true },
  { id: 'pulsera', title: 'Pulsera', icon: 'watch', view: StrapView, group: 'Sistema' },
  { id: 'ajustes', title: 'Ajustes', icon: 'gear', view: SettingsView, group: 'Sistema' },
];
const TABS = ['hoy', 'salud', 'sueno', 'entreno', 'bienestar'];
// pantallas que, en el móvil, se consideran dentro de cada pestaña
const TAB_OF = { dia: 'hoy', pulsera: 'hoy', ajustes: 'hoy', recuperacion: 'salud', carga: 'salud', tendencias: 'salud', semanal: 'salud', mas: 'salud',
  plan: 'entreno', directo: 'entreno', sesion: 'entreno', diario: 'bienestar', cuerpo: 'bienestar' };

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
  const active = (id) => route === id || (route.startsWith('m/') && id === 'salud');
  return html`<aside class="sidebar">
    <div class="brand"><img class="brand-logo" src="/icon.svg" alt="" /><b>Pulso</b></div>
    <div class="hide-mobile"><${SyncButton} /></div>
    ${groups.map((g) => html`<nav class="nav nav-group"><span class="label">${g}</span>
      ${visible.filter((r) => r.group === g).map((r) => html`<a href=${`#/${r.id}`} class=${active(r.id) ? 'active' : ''}><span class="ic" style=${{ background: CAT[r.icon] || 'var(--accent)' }}><${Icon} n=${r.icon} size=${16} /></span>${r.title}</a>`)}
    </nav>`)}
  </aside>`;
}

function TabBar({ route }) {
  const items = { hoy: ['Inicio', 'home'], salud: ['Salud', 'heart'], sueno: ['Sueño', 'sleep'], entreno: ['Entreno', 'dumbbell'], bienestar: ['Bienestar', 'leaf'] };
  const cur = TABS.includes(route) ? route : route.startsWith('m/') ? 'salud' : TAB_OF[route] || 'hoy';
  return html`<nav class="tabbar">${TABS.map((t) => html`<a href=${`#/${t}`} class=${cur === t ? 'active' : ''}>
    <span class="ic"><${Icon} n=${items[t][1]} size=${22} /></span>${items[t][0]}</a>`)}</nav>`;
}

function App() {
  const route = useRoute();
  const st = useStore();
  const r = ROUTES.find((x) => x.id === route);
  const mkey = route.startsWith('m/') ? route.slice(2) : null;
  const View = r ? r.view : HomeView;
  return html`<div class="shell">
    <${Sidebar} route=${route} />
    <main class="main">${mkey ? html`<${MetricView} mkey=${mkey} key=${mkey} />` : html`<${View} />`}</main>
    <${TabBar} route=${route} />
    ${st.toast && html`<div class="toast" role="status">${st.toast}</div>`}
  </div>`;
}

window.pulso = { strap, store };   // acceso para depuración desde la consola
render(html`<${App} />`, document.getElementById('app'));
