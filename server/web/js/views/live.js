import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useStore, api, toast, store, n, hm, C, ZONE_COLORS, ZONES, useEventTarget, alpha } from '../core.js';
import { Card, Stat, ChartBox, Seg, ZoneBar, ZoneTable, Spinner } from '../ui.js';
import { Page, SyncButton } from '../layout.js';
import { strap } from '../ble/strap.js';
import { rmssd } from '../ble/protocol.js';
import { Icon } from '../icons.js';

export const zoneOf = (bpm, max) => { const p = bpm / max; return p < 0.5 ? 0 : p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5; };

export function LiveView() {
  const [tab, setTab] = useState('hr');
  useEventTarget(strap);
  const connected = strap.connected;
  useEffect(() => { if (connected && !strap.s.liveOn) strap.setLive(true).catch(() => {}); }, [connected]);
  // Al salir de esta pantalla se apaga la emisión de FC estándar para no gastar batería.
  useEffect(() => () => { if (strap.connected && strap.s.liveOn) strap.setLive(false).catch(() => {}); }, []);
  return html`<${Page} title="En directo" right=${html`<${Seg} value=${tab} onChange=${setTab} options=${[['hr', 'Entreno'], ['hrv', 'VFC matinal'], ['breathe', 'Respiración']]} />`}>
    ${!connected && html`<${SyncButton} big />`}
    ${tab === 'hr' && html`<${WorkoutRecorder} />`}
    ${tab === 'hrv' && html`<${HRVCheck} />`}
    ${tab === 'breathe' && html`<${Breathe} />`}
  <//>`;
}

export function useLiveBuffer() {
  const [pts, setPts] = useState([]);
  const rr = useRef([]);
  useEffect(() => strap.onHR((bpm, r) => {
    if (bpm > 25) setPts((p) => [...p.slice(-3600), { t: Date.now(), bpm }]);
    if (r?.length) rr.current = [...rr.current.slice(-1200), ...r];
  }), []);
  return [pts, rr];
}

function WorkoutRecorder() {
  const { status } = useStore();
  const [pts] = useLiveBuffer();
  const [rec, setRec] = useState(null);       // {start, load, kcal, zones, last}
  const [sport, setSport] = useState('Fuerza');
  const [, tick] = useState(0);
  const max = status?.hrMax || 190;
  const rhr = 60;
  const p = status?.physio || {};
  const bpm = strap.s.liveHR;
  const z = bpm ? zoneOf(bpm, max) : 0;

  useEffect(() => {
    const t = setInterval(() => {
      tick((x) => x + 1);
      setRec((r) => {
        if (!r || !strap.s.liveHR) return r;
        const now = Date.now(), dt = Math.min(5, (now - r.last) / 1000), b = strap.s.liveHR;
        const hrr = Math.max(0, Math.min(1.2, (b - rhr) / Math.max(20, max - rhr)));
        let load = r.load;
        if (hrr > 0.1) load += hrr * (p.sex === 'female' ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr)) * Math.min(1, (hrr - 0.1) / 0.2) ** 2 * dt / 60;
        const bmr = status?.bmr || 1700, w = p.weightKg || 75, a = p.age || 30;
        let kpm = bmr / 1440 * 1.15;
        if (hrr >= 0.3) kpm = Math.max(kpm, p.sex === 'female' ? (-20.4022 + 0.4472 * b - 0.1263 * w + 0.074 * a) / 4.184 : (-55.0969 + 0.6309 * b + 0.1988 * w + 0.2017 * a) / 4.184);
        const zones = [...r.zones]; zones[zoneOf(b, max)] += dt;
        return { ...r, load, kcal: r.kcal + kpm * dt / 60, zones, last: now, hrs: [...r.hrs, b] };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [max, status]);

  const strain = rec ? 21 * (1 - Math.exp(-rec.load / 90)) : 0;
  const start = () => { setRec({ start: Date.now(), load: 0, kcal: 0, zones: [0, 0, 0, 0, 0, 0], last: Date.now(), hrs: [] }); strap.buzz().catch(() => {}); };
  const stop = async () => {
    const r = rec; setRec(null); strap.buzz().catch(() => {});
    const hrs = r.hrs.filter(Boolean);
    try {
      await api('/workouts', { json: { source: 'live', start: Math.floor(r.start / 1000), end: Math.floor(Date.now() / 1000), sport, name: `${sport} · ${new Date(r.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
        strain, kcal: r.kcal, avgHR: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null, maxHR: hrs.length ? Math.max(...hrs) : null, zones: r.zones.map(Math.round) } });
      toast(`Entreno guardado · esfuerzo ${n(strain, 1)}`); store.bump();
    } catch (e) { toast(e.message); }
  };
  useEffect(() => {
    const f = (e) => { if (e.detail.code === 14) (rec ? stop() : start()); };
    strap.addEventListener('strapevent', f);
    return () => strap.removeEventListener('strapevent', f);
  }, [rec]);
  const el = rec ? Math.floor((Date.now() - rec.start) / 1000) : 0;
  const cfg = () => ({ type: 'line', data: { datasets: [{ data: pts.slice(-600).map((x) => ({ x: x.t, y: x.bpm })), borderColor: C.hr, pointRadius: 0, borderWidth: 2, tension: 0.3, fill: true, backgroundColor: alpha(C.hr, 0.12) }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } }, grid: { display: false } }, y: { grace: '10%' } } } });
  return html`<div class="grid">
    <${Card} span="5">
      <div style="text-align:center">
        <div class="big-number" style=${{ color: ZONE_COLORS[z] }}>${bpm ?? '--'}</div>
        <div class="muted">lpm · ${ZONES[z]}${bpm ? ` · ${n((bpm / max) * 100)} % FC máx` : ''}</div>
      </div>
      <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
        <div class="tile"><div class="t">Esfuerzo</div><div class="v" style=${{ color: C.strain }}>${n(strain, 1)}</div></div>
        <div class="tile"><div class="t">Calorías</div><div class="v">${n(rec?.kcal || 0)}</div></div>
        <div class="tile"><div class="t">Tiempo</div><div class="v num">${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}</div></div>
      </div>
      <select value=${sport} onChange=${(e) => setSport(e.target.value)}>${['Fuerza', 'Carrera', 'Ciclismo', 'HIIT', 'Deporte', 'Caminata', 'Otro'].map((s) => html`<option>${s}</option>`)}</select>
      ${rec ? html`<button class="btn big danger" onClick=${stop}>Terminar y guardar</button>` : html`<button class="btn big primary" onClick=${start} disabled=${!strap.connected}>Empezar entreno</button>`}
      <div class="tiny faint">También puedes empezar/terminar con doble toque en la pulsera. La curva completa de FC se recupera después del historial, y puedes subirla a Strava desde Entreno.</div><//>
    <${Card} span="7" title="FC en directo" icon=${html`<${Icon} n="live" />`}>
      <${ChartBox} config=${cfg} height=${240} deps=${[pts.length]} />
      ${rec && html`<${ZoneTable} zones=${rec.zones} />`}
      <div class="tiny faint">FC emitida por el perfil Bluetooth estándar de la pulsera. Mientras esté activo, cualquier app o máquina compatible (Zwift, cintas, bicis) puede leerla como una banda de pecho.</div><//>
  </div>`;
}

export function HRVCheck() {
  const [state, setState] = useState('idle');
  const [left, setLeft] = useState(0);
  const [res, setRes] = useState(null);
  const [pos, setPos] = useState('sentado');
  const rr = useRef([]);
  const [live, setLive] = useState(null);
  const DURATION = 120;
  useEffect(() => strap.onHR((_, r) => { if (state === 'run' && r?.length) { rr.current.push(...r); setLive(rmssd(rr.current)); } }), [state]);
  useEffect(() => {
    if (state !== 'run') return undefined;
    const t = setInterval(() => setLeft((l) => {
      if (l <= 1) { clearInterval(t); finish(); return 0; }
      return l - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [state]);
  const start = () => { rr.current = []; setRes(null); setLive(null); setLeft(DURATION); setState('run'); };
  const finish = async () => {
    setState('saving');
    try { const r = await api('/spot', { json: { kind: 'hrv', rr: rr.current, position: pos, durationSec: DURATION } }); setRes(r); store.bump(); }
    catch (e) { toast(`No se pudo calcular: ${e.message}`); }
    setState('idle');
  };
  return html`<div class="grid">
    <${Card} span="6" title="Medición de VFC de 2 minutos" icon=${html`<${Icon} n="heart" />`}>
      <div class="small muted">Hazla cada mañana al despertar, siempre en la misma postura, respirando con normalidad. Es la referencia más fiable para ver tu adaptación (ln RMSSD, método Plews/Buchheit).</div>
      <${Seg} value=${pos} onChange=${setPos} options=${[['tumbado', 'Tumbado'], ['sentado', 'Sentado'], ['de pie', 'De pie']]} />
      <div style="text-align:center" class="col">
        <div class="big-number">${state === 'run' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : res ? n(res.rmssd) : '--'}</div>
        <div class="muted">${state === 'run' ? `RMSSD provisional ${n(live)} ms · ${rr.current.length} latidos` : res ? 'ms RMSSD' : 'listo'}</div>
      </div>
      ${state === 'run' ? html`<button class="btn big" onClick=${finish}>Terminar ya</button>` : html`<button class="btn big primary" onClick=${start} disabled=${!strap.connected || state === 'saving'}>${state === 'saving' ? 'Calculando…' : 'Empezar medición'}</button>`}<//>
    ${res && html`<${Card} span="6" title="Resultado" icon=${html`<${Icon} n="report" />`}>
      <${Stat} k="RMSSD" v=${`${n(res.rmssd, 1)} ms`} /><${Stat} k="ln RMSSD" v=${n(res.lnRMSSD, 2)} /><${Stat} k="SDNN" v=${`${n(res.sdnn, 1)} ms`} />
      <${Stat} k="pNN50" v=${`${n(res.pnn50, 1)} %`} /><${Stat} k="FC media" v=${`${n(res.hr)} lpm`} />
      <${Stat} k="Respiración (RSA)" v=${res.resp > 0 ? `${n(res.resp, 1)} rpm` : '–'} /><${Stat} k="Latidos válidos" v=${`${res.beats} (${n(res.artifactRate * 100, 1)} % artefactos)`} />
      <a href="#/recuperacion" class="small">Ver evolución en Recuperación</a><//>`}
  </div>`;
}

export function Breathe() {
  const [on, setOn] = useState(false);
  const [rate, setRate] = useState(6);
  const [phase, setPhase] = useState('Listo');
  const [scale, setScale] = useState(0.55);
  const [secs, setSecs] = useState(0);
  const rr = useRef([]);
  const [hrv, setHrv] = useState({ start: null, now: null });
  useEffect(() => strap.onHR((_, r) => { if (on && r?.length) rr.current = [...rr.current.slice(-180), ...r]; }), [on]);
  useEffect(() => {
    if (!on) { setScale(0.55); setPhase('Listo'); return undefined; }
    let alive = true;
    const cyc = 60000 / rate;
    const loop = () => {
      if (!alive) return;
      setPhase('Inspira'); setScale(1);
      setTimeout(() => { if (!alive) return; setPhase('Espira'); setScale(0.55); setTimeout(loop, cyc * 0.55); }, cyc * 0.45);
    };
    loop();
    const t = setInterval(() => {
      setSecs((s) => s + 1);
      const v = rmssd(rr.current.slice(-90));
      setHrv((h) => ({ start: h.start ?? (v && rr.current.length > 60 ? v : null), now: v }));
    }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [on, rate]);
  const cyc = 60 / rate;
  return html`<div class="grid">
    <${Card} span="7">
      <div class="breathe" style=${{ transform: `scale(${scale})`, transitionDuration: `${phase === 'Inspira' ? cyc * 0.45 : cyc * 0.55}s` }}><span style=${{ transform: `scale(${1 / scale})` }}>${phase}</span></div>
      <div class="row" style="justify-content:center">
        <button class="btn" onClick=${() => setRate(Math.max(4, rate - 0.5))} disabled=${on}>−</button>
        <b>${n(rate, 1)} resp/min</b>
        <button class="btn" onClick=${() => setRate(Math.min(8, rate + 0.5))} disabled=${on}>+</button>
      </div>
      <button class=${`btn big ${on ? '' : 'primary'}`} onClick=${() => { setOn(!on); setSecs(0); rr.current = []; setHrv({ start: null, now: null }); }}>${on ? 'Terminar' : 'Empezar'}</button><//>
    <${Card} span="5" title="Biofeedback" icon=${html`<${Icon} n="wind" />`}>
      <${Stat} k="FC" v=${`${strap.s.liveHR ?? '--'} lpm`} /><${Stat} k="VFC (RMSSD, 90 latidos)" v=${`${n(hrv.now)} ms`} />
      <${Stat} k="Cambio desde el inicio" v=${hrv.start && hrv.now ? `${hrv.now - hrv.start > 0 ? '+' : ''}${n(hrv.now - hrv.start)} ms` : '–'} />
      <${Stat} k="Tiempo" v=${`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`} />
      <div class="small muted">Respirar a unas 6 veces por minuto (frecuencia de resonancia) maximiza la arritmia sinusal respiratoria: la VFC sube y la activación simpática baja. 5–10 minutos bastan.</div><//>
  </div>`;
}
