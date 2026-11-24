// Layout pieces shared by all views (kept separate from main.js to avoid import cycles).
import { html } from '../vendor/preact-htm.js';
import { useStore, ago, useEventTarget, toast } from './core.js';
import { Icon } from './icons.js';
import { strap, CONN } from './ble/strap.js';

// ------------------------------------------------------------ sync button
export function SyncButton({ big }) {
  useEventTarget(strap);
  const s = strap.s;
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
  return html`<button class=${`btn ${big ? 'big primary' : 'small'}`} onClick=${onClick} disabled=${busy}>
    ${busy ? html`<span class="spinner"></span>` : html`<${Icon} n="sync" />`}
    ${busy ? (s.conn === 'syncing' ? `${s.records} registros…` : CONN[s.conn]) : strap.connected ? 'Sincronizar' : 'Conectar pulsera'}
  </button>`;
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
    ${children}
  </div>`;
}


function batteryChip(e, s) {
  if (!e?.known) return null;
  const lvl = s.battery != null && strap.connected ? s.battery : e.estimated;
  const charging = strap.connected ? s.charging : e.charging;
  const h = e.remainingHours;
  const left = charging ? (e.toFullMinutes != null ? `llena en ${e.toFullMinutes >= 60 ? `${Math.floor(e.toFullMinutes / 60)} h ${e.toFullMinutes % 60} min` : `${e.toFullMinutes} min`}` : 'cargando')
    : h == null ? '' : h >= 48 ? `${Math.floor(h / 24)} d ${Math.round(h % 24)} h` : `${Math.round(h)} h`;
  const cls = charging ? '' : lvl <= 15 ? 'bad' : lvl <= 30 ? 'warn' : 'muted';
  return html`<a href="#/pulsera" class=${cls} style="color:inherit;display:inline-flex;gap:4px;align-items:center" title="Batería de la pulsera">
    · <${Icon} n="battery" size=${13} /> ${Math.round(lvl)} %${charging ? ' ⚡' : ''}${left ? html`<span class="muted"> · ${left}</span>` : null}</a>`;
}
