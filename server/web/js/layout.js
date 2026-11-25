// Layout pieces shared by all views (kept separate from main.js to avoid import cycles).
import { html } from '../vendor/preact-htm.js';
import { useStore, ago, useEventTarget, toast } from './core.js';
import { Icon } from './icons.js';
import { strap, CONN, REPAIR_HELP } from './ble/strap.js';

// ------------------------------------------------------------ sync button
export function SyncButton({ big }) {
  useEventTarget(strap);
  const s = strap.s;
  if (big && s.conn === 'syncing') return null;   // the progress card takes its place
  const busy = ['choosing', 'connecting', 'pairing', 'handshaking', 'syncing', 'uploading'].includes(s.conn);
  const onClick = async () => {
    try {
      if (strap.connected) await strap.syncHistory();
      else await strap.connect();
    } catch (e) { toast(e.message); }
  };
  if (!strap.supported) {
    return big ? html`<div class="card"><b>Este navegador no puede usar Bluetooth.</b><span class="small muted">Abre esta web en <b>Bluefy</b> en el iPhone (o Chrome en el ordenador) para sincronizar la pulsera. Los datos ya sincronizados se ven desde cualquier navegador.</span></div>` : null;
  }
  const btn = html`<button class=${`btn ${big ? 'big primary' : 'small'}`} onClick=${onClick} disabled=${busy}>
    ${busy ? html`<span class="spinner"></span>` : html`<${Icon} n="sync" />`}
    ${busy ? (s.conn === 'syncing' ? `${s.records.toLocaleString('es-ES')} guardados…` : CONN[s.conn]) : strap.connected ? 'Sincronizar' : 'Conectar pulsera'}
  </button>`;
  if (!big) return btn;
  const connecting = ['choosing', 'connecting', 'pairing', 'handshaking'].includes(s.conn);
  return html`<div class="col" style="gap:6px">
    ${btn}
    ${connecting && html`<button class="btn small" style="align-self:center" onClick=${() => strap.resetConnection()}>¿Atascado? Reiniciar conexión</button>`}
    ${s.notRecording && html`<div class="small bad" style="text-align:center"><b>⚠️ La pulsera no está grabando datos:</b> perdió la hora y, sin hora, no guarda nada. Pulso intenta ponérsela al conectar; si el aviso sigue, descarga el registro en Pulsera › Diagnóstico.</div>`}
    ${s.error && !busy && html`<div class="small bad" style="text-align:center">${s.error}</div>`}
    ${!strap.connected && !busy && html`<details class="small muted" style="text-align:center"><summary>¿Ha perdido el vínculo o no aparece en la lista?</summary>${REPAIR_HELP}</details>`}
  </div>`;
}

export function StatusPill() {
  useEventTarget(strap);
  const st = useStore();
  const s = strap.s, srv = st.status;
  const busy = ['syncing', 'uploading', 'connecting', 'pairing', 'handshaking'].includes(s.conn) || srv?.analysis?.running;
  const last = srv?.lastSync ? srv.lastSync * 1000 : s.lastSync;
  return html`<div class="sync-pill" title="Estado">
    <span class=${`dot ${busy ? 'busy' : strap.connected ? 'on' : ''}`}></span>
    <span>${strap.supported ? CONN[s.conn] : 'Solo lectura'}</span>
    ${srv?.analysis?.running && html`<span class="muted hide-mobile">· analizando ${srv.analysis.current || ''}</span>`}
    ${s.pending > 0 && html`<span class="warn">· ${s.pending} bloques por subir</span>`}
    ${batteryChip(srv?.battery, s)}
    <span class="muted hide-mobile">· ${ago(last)}</span>
    ${st.offline && html`<span class="bad">· servidor no disponible</span>`}
  </div>`;
}

export function Page({ title, right, children }) {
  return html`<div class="page">
    <div class="topbar"><h1>${title}</h1><div class="row">${right}<${StatusPill} /></div></div>
    <${SyncProgress} />
    ${children}
  </div>`;
}


function batteryChip(e, s) {
  if (!e?.known) return null;
  // always the server's coherent level: the raw strap value mixes in the battery pack while charging
  const lvl = e.estimated;
  const charging = e.charging || (strap.connected && s.charging);
  const h = e.remainingHours;
  const left = charging ? (e.toFullMinutes != null ? `llena en ${e.toFullMinutes >= 60 ? `${Math.floor(e.toFullMinutes / 60)} h ${e.toFullMinutes % 60} min` : `${e.toFullMinutes} min`}` : 'cargando')
    : h == null ? '' : h >= 48 ? `${Math.floor(h / 24)} d ${Math.round(h % 24)} h` : `${Math.round(h)} h`;
  const cls = charging ? '' : lvl <= 15 ? 'bad' : lvl <= 30 ? 'warn' : 'muted';
  return html`<a href="#/pulsera" class=${cls} style="color:inherit;display:inline-flex;gap:4px;align-items:center" title="Batería de la pulsera">
    · <${Icon} n="battery" size=${13} /> ${Math.round(lvl)} %${charging ? ' ⚡' : ''}${left ? html`<span class="muted"> · ${left}</span>` : null}</a>`;
}

/** Download / upload progress with percentage, ETA and a safe cancel button. */
export function SyncProgress() {
  useEventTarget(strap);
  const s = strap.s;
  const downloading = s.conn === 'syncing';
  const uploading = !downloading && s.pending > 0;
  if (!downloading && !uploading) return null;
  const p = s.prog;
  const fmt = (sec) => (sec == null ? 'calculando…' : sec < 60 ? `${Math.max(1, Math.round(sec))} s` : sec < 3600 ? `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')} s` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`);
  const since = p ? new Date(p.firstTs * 1000).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const upTotal = s.uploaded + s.pending * 1;
  return html`<div class="sync-card" role="status" aria-live="polite">
    ${downloading ? html`
      <div class="row between"><b>Descargando de la pulsera</b><b class="num">${p?.pct != null ? `${Math.floor(p.pct)} %` : '…'}</b></div>
      <div class=${`progress ${p?.pct == null ? 'indet' : ''}`}><i style=${{ width: `${p?.pct || 0}%` }}></i></div>
      <div class="row between small muted">
        <span>${s.records.toLocaleString('es-ES')} guardados · ${s.received.toLocaleString('es-ES')} recibidos${p?.rate ? ` · ${Math.round(p.rate)}× tiempo real` : ''}</span>
        <span>Queda ${fmt(p?.etaSec)}</span></div>
      <div class="tiny muted">${since ? `Datos desde ${since} · ` : ''}${s.chunks} bloques confirmados (guardados en el móvil y en el servidor)${s.discarded ? ` · ${s.discarded.toLocaleString('es-ES')} descartados` : ''}</div>
      <div class="row between"><span class="tiny muted">Mantén la pantalla encendida y Bluefy abierto.</span>
        <button class="btn small danger" onClick=${() => strap.cancelSync()}>Cancelar</button></div>`
    : html`
      <div class="row between"><b>Subiendo al servidor</b><span class="small muted">${s.pending} bloques pendientes</span></div>
      <div class="progress indet"><i></i></div>
      <div class="tiny muted">Puedes cerrar la app: lo pendiente está guardado en el móvil y se subirá al volver a abrirla.</div>`}
  </div>`;
}
