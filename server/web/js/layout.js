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
    ${srv?.analysis?.running && html`<span class="muted">· analizando ${srv.analysis.current || ''}</span>`}
    ${s.pending > 0 && html`<span class="warn">· ${s.pending} bloques por subir</span>`}
    ${srv?.device?.battery != null && html`<span class="muted">· <${Icon} n="battery" size=${13} /> ${Math.round(srv.device.battery)} %</span>`}
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

