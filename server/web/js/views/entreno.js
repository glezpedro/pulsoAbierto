// Entreno: «Para ti» (empezar una sesión, deportes, esta semana, carga), Historial, Plan y Progreso.
// La sesión en directo usa la FC de la pulsera y, en deportes al aire libre, el GPS del móvil: ruta
// dibujada con sus propios puntos (sin mapas de terceros), distancia, ritmo y exportación GPX.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, hm, hhmm, C, ZONE_COLORS, ZONES, keyDate, todayKey, addDays, useEventTarget } from '../core.js';
import { Card, Spinner, ZoneTable } from '../ui.js';
import { Icon } from '../icons.js';
import { SyncButton, SyncProgress } from '../layout.js';
import { strap } from '../ble/strap.js';
import { PlanTab, HistoryTab, ProgressTab, WorkoutModal } from './training.js';
import { zoneOf } from './live.js';
import { RouteMap, distM, LineChart } from '../charts.js';

export const SPORTS = [
  { id: 'Carrera', icon: 'run', gps: true }, { id: 'Fuerza', icon: 'dumbbell', gps: false }, { id: 'Ciclismo', icon: 'bike', gps: true },
  { id: 'Caminata', icon: 'walk', gps: true }, { id: 'HIIT', icon: 'bolt', gps: false }, { id: 'Otro', icon: 'live', gps: false },
];

export function EntrenoView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [tab, setTab] = useState(q.get('w') ? 'hist' : 'parati');
  const [sel, setSel] = useState(q.get('w'));
  return html`<div class="page">
    <div class="topbar"><h1>Entreno</h1></div>
    <div class="pills">${[['parati', 'Para ti'], ['hist', 'Historial'], ['plan', 'Plan'], ['prog', 'Progreso']].map(([v, l]) => html`
      <button class=${tab === v ? 'on' : ''} onClick=${() => setTab(v)}>${l}</button>`)}</div>
    <${SyncProgress} />
    ${tab === 'parati' && html`<${ParaTi} onOpen=${setSel} />`}
    ${tab === 'hist' && html`<${HistoryTab} onOpen=${setSel} />`}
    ${tab === 'plan' && html`<${PlanTab} />`}
    ${tab === 'prog' && html`<${ProgressTab} />`}
    <${WorkoutModal} uid=${sel} onClose=${() => setSel(null)} />
  </div>`;
}

function ParaTi({ onOpen }) {
  const ws = useApi('/workouts?days=28');
  const load = useApi('/load?days=60');
  const list = (ws.data || []).slice().sort((a, b) => b.start - a.start);
  // this week, Monday → Sunday
  const t = todayKey();
  const monday = addDays(t, -((keyDate(t).getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map();
  for (const w of list) { const k = todayKey(new Date(w.start * 1000)); byDay.set(k, (byDay.get(k) || []).concat(w)); }
  const series = load.data?.series || [];
  const withData = series.filter((x) => x.strain != null).length;
  const last = series[series.length - 1];
  return html`<div class="grid">
    <a class="card span-7 start-banner" href="#/sesion">
      <div class="col" style="gap:4px">
        <span class="bh-label" style="color:rgba(255,255,255,.8)">EMPEZAR UNA SESIÓN</span>
        <b class="sb-title">Entrena con tu pulsera</b>
        <span class="small" style="color:rgba(255,255,255,.85)">FC en directo, zonas, esfuerzo y ruta GPS</span>
      </div>
      <span class="sb-play"><${Icon} n="play" size=${26} /></span>
    </a>
    <div class="span-5 sport-grid">${SPORTS.map((s) => html`<a class="card sport-tile" href=${`#/sesion?sport=${encodeURIComponent(s.id)}`}>
      <span class="st-ic"><${Icon} n=${s.icon} size=${20} /></span><span class="small">${s.id}</span></a>`)}</div>
    <section class="card span-6">
      <div class="card-h"><h2 style="color:var(--fg)">Esta semana</h2><span class="small muted">${week.reduce((a, k) => a + (byDay.get(k)?.length || 0), 0)} entrenos</span></div>
      <div class="week-dots">${week.map((k) => {
        const d = byDay.get(k) || [];
        const strain = d.reduce((a, w) => Math.max(a, w.strain || 0), 0);
        return html`<div class="wd"><span class="tiny muted">${'LMXJVSD'[(keyDate(k).getDay() + 6) % 7]}</span>
          <span class=${`wd-dot ${d.length ? 'on' : ''} ${k === t ? 'today' : ''}`} title=${d.map((w) => w.name).join(', ')}>${d.length ? n(strain, 0) : ''}</span></div>`;
      })}</div>
    </section>
    <section class="card span-6">
      <div class="card-h"><h2 style="color:var(--fg)">Carga de entrenamiento</h2><a class="small" href="#/carga">Detalle</a></div>
      ${!load.data ? html`<${Spinner} />` : last?.acwr != null ? html`<div class="col" style="gap:4px">
          <span class="gt-value">${n(last.acwr, 2)}<small>agudo/crónico</small></span>
          <span class="small">${load.data.status?.label || load.data.status || ''}</span>
          <span class="tiny muted">Lo ideal es estar entre 0,8 y 1,3: por debajo pierdes forma, por encima aumenta el riesgo de lesión.</span></div>`
        : html`<div class="col" style="gap:4px"><b>Aún no hay suficiente historial</b>
          <span class="small muted">La relación entre tu carga reciente y la de las últimas semanas necesita 21 días con datos. Llevas ${withData}${withData < 21 ? `: te faltan ${21 - withData}` : ''}.</span></div>`}
    </section>
    <section class="card span-12">
      <div class="card-h"><h2 style="color:var(--fg)">Últimos entrenos</h2></div>
      ${!list.length ? html`<div class="small muted">Aún no hay entrenos. Graba uno con «Empezar una sesión», impórtalos de Strong o Strava (Historial) o deja que la pulsera los detecte sola.</div>`
        : list.slice(0, 5).map((w) => html`<a class="plan-row" href="#" onClick=${(e) => { e.preventDefault(); onOpen(w.uid); }}>
          <span class="pr-ic" style="background:color-mix(in srgb, var(--strain) 18%, transparent);color:var(--strain)"><${Icon} n=${(SPORTS.find((s) => s.id === w.sport) || {}).icon || 'dumbbell'} size=${17} /></span>
          <span class="col grow" style="gap:0"><b>${w.name}</b><span class="tiny muted">${new Date(w.start * 1000).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm((w.end - w.start) / 60)}${w.distance_km ? ` · ${n(w.distance_km, 2)} km` : ''}${w.hasRoute ? ' · ruta' : ''}</span></span>
          <span class="col" style="gap:0;align-items:flex-end"><b style="color:var(--strain)">${n(w.strain, 1)}</b><span class="tiny muted">esfuerzo</span></span></a>`)}
    </section>
  </div>`;
}

// =================================================================== live session
export function SessionView() {
  useEventTarget(strap);
  const { status } = useStore();
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [sport, setSport] = useState(q.get('sport') || 'Fuerza');
  const [gpsOn, setGpsOn] = useState(() => !!SPORTS.find((s) => s.id === (q.get('sport') || 'Fuerza'))?.gps);
  const [rec, setRec] = useState(null);       // {start, load, kcal, zones, last, hrs, route, dist, paused}
  const [gpsErr, setGpsErr] = useState(null);
  const [fix, setFix] = useState(null);
  const [, tick] = useState(0);
  const watch = useRef(null);
  const wake = useRef(null);
  const hrBuf = useRef([]);
  const max = status?.hrMax || 190;
  const rhr = status?.physio?.restingHR || 60;
  const p = status?.physio || {};
  const bpm = strap.s.liveHR;
  const z = bpm ? zoneOf(bpm, max) : 0;

  // live HR through the standard profile while this screen is open
  useEffect(() => { if (strap.connected && !strap.s.liveOn) strap.setLive(true).catch(() => {}); }, [strap.connected]);
  useEffect(() => () => { if (strap.connected && strap.s.liveOn) strap.setLive(false).catch(() => {}); stopGps(); releaseWake(); }, []);
  useEffect(() => strap.onHR((b) => { if (b > 25) hrBuf.current = [...hrBuf.current.slice(-900), { t: Date.now() / 1000, v: b }]; }), []);

  const releaseWake = () => { try { wake.current?.release(); } catch { /* ignore */ } wake.current = null; };
  const stopGps = () => { if (watch.current != null) { navigator.geolocation?.clearWatch(watch.current); watch.current = null; } };
  const startGps = () => {
    if (!navigator.geolocation) { setGpsErr('Este navegador no da acceso al GPS.'); return; }
    stopGps();
    watch.current = navigator.geolocation.watchPosition((pos) => {
      const { latitude: lat, longitude: lon, altitude: ele, accuracy } = pos.coords;
      setFix({ acc: accuracy });
      setGpsErr(null);
      if (accuracy > 50) return;                 // ignore poor fixes
      setRec((r) => {
        if (!r || r.paused) return r;
        const t = Math.floor(pos.timestamp / 1000);
        const prev = r.route[r.route.length - 1];
        const d = prev ? distM([prev[1], prev[2]], [lat, lon]) : 0;
        if (prev && (d < 3 || t - prev[0] < 2)) return r;   // keep ~1 point every 2 s / 3 m
        if (prev && d / Math.max(1, t - prev[0]) > 25) return r;   // jump > 90 km/h: GPS glitch
        return { ...r, dist: r.dist + d, route: [...r.route, [t, lat, lon, ele ?? null, strap.s.liveHR || null]] };
      });
    }, (e) => setGpsErr(e.code === 1 ? 'Sin permiso para el GPS: permítelo para Bluefy en Ajustes del iPhone › Privacidad › Localización.' : 'Buscando señal GPS…'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  };

  // accumulate strain/kcal/zones every second (same model as the analysis engine, faded TRIMP)
  useEffect(() => {
    const t = setInterval(() => {
      tick((x) => x + 1);
      setRec((r) => {
        if (!r || r.paused) return r;
        // dt clamped to [0, 5] s: robust to the clock jumping (sleep, manual change) or the page lagging
        const now = Date.now(), dt = Math.max(0, Math.min(5, (now - r.last) / 1000)), b = strap.s.liveHR;
        if (!b) return { ...r, last: now };
        const hrr = Math.max(0, Math.min(1.2, (b - rhr) / Math.max(20, max - rhr)));
        let load = r.load;
        if (hrr > 0.1) load += hrr * (p.sex === 'female' ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr)) * Math.min(1, (hrr - 0.1) / 0.2) ** 2 * dt / 60;
        const bmr = status?.bmr || 1700, w = p.weightKg || 75, a = p.age || 30;
        let kpm = bmr / 1440 * 1.15;
        if (hrr >= 0.3) kpm = Math.max(kpm, p.sex === 'female' ? (-20.4022 + 0.4472 * b - 0.1263 * w + 0.074 * a) / 4.184 : (-55.0969 + 0.6309 * b + 0.1988 * w + 0.2017 * a) / 4.184);
        const zones = [...r.zones]; zones[zoneOf(b, max)] += dt;
        return { ...r, load, kcal: r.kcal + kpm * dt / 60, zones, last: now, hrs: [...r.hrs, b], moving: r.moving + dt };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [max, rhr, status]);

  const start = async () => {
    setRec({ start: Date.now(), load: 0, kcal: 0, zones: [0, 0, 0, 0, 0, 0], last: Date.now(), hrs: [], route: [], dist: 0, moving: 0, paused: false });
    if (gpsOn) startGps();
    try { wake.current = await navigator.wakeLock?.request('screen'); } catch { /* not available */ }
    strap.buzz().catch(() => {});
  };
  const pause = () => setRec((r) => r && { ...r, paused: !r.paused, last: Date.now() });
  const stop = async () => {
    const r = rec; if (!r) return;
    setRec(null); stopGps(); releaseWake(); strap.buzz().catch(() => {});
    const hrs = r.hrs.filter(Boolean);
    const strain = 21 * (1 - Math.exp(-r.load / 90));
    if ((Date.now() - r.start) / 1000 < 60) { toast('Sesión de menos de 1 minuto: no se guarda.'); return; }
    try {
      const w = await api('/workouts', { json: { source: 'live', start: Math.floor(r.start / 1000), end: Math.floor(Date.now() / 1000), sport,
        name: `${sport} · ${new Date(r.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
        strain: hrs.length ? strain : null, kcal: r.kcal, avgHR: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
        maxHR: hrs.length ? Math.max(...hrs) : null, zones: r.zones.map(Math.round), distanceKm: r.dist ? r.dist / 1000 : null, route: r.route.length > 1 ? r.route : null } });
      toast(`Entreno guardado${hrs.length ? ` · esfuerzo ${n(strain, 1)}` : ''}${r.dist ? ` · ${n(r.dist / 1000, 2)} km` : ''}`, 5000);
      store.bump();
      location.hash = `#/entreno?w=${encodeURIComponent(w.uid)}`;
    } catch (e) { toast(e.message, 6000); }
  };
  // double tap on the strap starts / stops
  useEffect(() => {
    const f = (e) => { if (e.detail.code === 14) (rec ? stop() : start()); };
    strap.addEventListener('strapevent', f);
    return () => strap.removeEventListener('strapevent', f);
  }, [rec, sport, gpsOn]);

  const el = rec ? Math.max(0, Math.floor((Date.now() - rec.start) / 1000)) : 0;
  const strain = rec ? 21 * (1 - Math.exp(-rec.load / 90)) : 0;
  const km = rec ? rec.dist / 1000 : 0;
  const pace = rec && km > 0.05 ? (el / 60) / km : null;   // min/km
  const speed = rec && el > 0 ? km / (el / 3600) : null;
  const clock = (s) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  const outdoor = SPORTS.find((s) => s.id === sport)?.gps;
  return html`<div class="page">
    <div class="topbar"><div><a class="small" href="#/entreno">‹ Entreno</a><h1 class="h1-detail">Sesión ${rec ? 'en curso' : 'nueva'}</h1></div></div>
    ${!strap.connected && html`<${SyncButton} big />`}
    <div class="grid">
      <section class="card span-5 session-card" style=${{ '--zc': ZONE_COLORS[z] }}>
        <div class="row between"><span class="pill" style=${{ background: 'color-mix(in srgb, var(--zc) 20%, transparent)', color: 'var(--zc)' }}>${bpm ? ZONES[z] : 'Sin FC'}</span>
          ${bpm && html`<span class="pill live-pill"><span class="live-dot"></span>EN DIRECTO</span>`}</div>
        <div class="sess-hr"><span class="sess-big" style=${{ color: bpm ? 'var(--zc)' : 'var(--muted)' }}>${bpm ?? '--'}</span><span class="muted">lpm${bpm ? ` · ${n((bpm / max) * 100)} % máx` : ''}</span></div>
        ${hrBuf.current.length > 1 && html`<${LineChart} points=${hrBuf.current.slice(-300)} color=${C.hr} height=${90} area=${true} gap=${30} yFmt=${(v) => n(v)} />`}
        <div class="sess-stats">
          <div><span class="tiny muted">Tiempo</span><b class="num">${clock(el)}</b></div>
          <div><span class="tiny muted">Esfuerzo</span><b style="color:var(--strain)">${n(strain, 1)}</b></div>
          <div><span class="tiny muted">Calorías</span><b>${n(rec?.kcal || 0)}</b></div>
          ${(gpsOn || km > 0) && html`<div><span class="tiny muted">Distancia</span><b>${n(km, 2)}<small> km</small></b></div>
            <div><span class="tiny muted">${sport === 'Ciclismo' ? 'Velocidad' : 'Ritmo'}</span><b>${sport === 'Ciclismo' ? `${n(speed, 1)}` : pace ? `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')}` : '–'}<small> ${sport === 'Ciclismo' ? 'km/h' : '/km'}</small></b></div>`}
        </div>
        ${!rec && html`<div class="chips">${SPORTS.map((s) => html`<button class=${`chip ${sport === s.id ? 'on' : ''}`} onClick=${() => { setSport(s.id); setGpsOn(s.gps); }}><${Icon} n=${s.icon} size=${14} /> ${s.id}</button>`)}</div>
          <label class="switch"><span>Grabar la ruta con el GPS del móvil${outdoor ? '' : ' (útil al aire libre)'}</span><input type="checkbox" checked=${gpsOn} onChange=${(e) => setGpsOn(e.target.checked)} /></label>`}
        ${gpsErr && html`<div class="small warn">${gpsErr}</div>`}
        ${rec && gpsOn && fix && html`<div class="tiny muted">GPS: precisión ±${n(fix.acc)} m · ${rec.route.length} puntos</div>`}
        ${rec ? html`<div class="row" style="flex-wrap:nowrap"><button class="btn big" onClick=${pause}>${rec.paused ? 'Reanudar' : 'Pausa'}</button><button class="btn big danger" onClick=${stop}>Terminar y guardar</button></div>`
          : html`<button class="btn big primary" onClick=${start}><${Icon} n="play" /> Empezar ${sport.toLowerCase()}</button>`}
        <div class="tiny faint">Doble toque en la pulsera: empezar / terminar. Mantén Bluefy abierto con la pantalla encendida: la web no puede seguir grabando en segundo plano. La curva completa de FC se recupera después con la sincronización.</div>
      </section>
      <div class="span-7 col" style="gap:12px">
        ${rec && rec.route.length > 1 && html`<${Card} title="Ruta" icon=${html`<${Icon} n="route" />`} color="var(--accent)"><${RouteMap} route=${rec.route} height=${260} /><//>`}
        ${rec && html`<${Card} title="Zonas de FC" icon=${html`<${Icon} n="heart" />`} color="var(--heart)"><${ZoneTable} zones=${rec.zones} /><//>`}
        ${!rec && html`<${Card} title="Cómo funciona" icon=${html`<${Icon} n="info" />`} color="var(--accent)">
          <div class="small col" style="gap:8px">
            <p style="margin:0">La pulsera envía tu frecuencia cardiaca en directo por el perfil Bluetooth estándar; con ella Pulso calcula al momento el esfuerzo, las zonas y las calorías.</p>
            <p style="margin:0">Con el GPS activado, la ruta se dibuja con tus propios puntos (sin mapas de terceros) y se puede descargar en GPX para Strava, Garmin Connect o Komoot.</p>
            <p style="margin:0" class="muted">Las zonas usan tu FC máxima (${max} lpm). Puedes cambiarla en Ajustes › Perfil.</p>
          </div><//>`}
      </div>
    </div>
  </div>`;
}
