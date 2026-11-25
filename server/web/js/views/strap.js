import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, ago, download, useEventTarget, dateTime, C } from '../core.js';
import { Card, Stat, Spinner, ChartBox, timeX } from '../ui.js';
import { Page, SyncButton } from '../layout.js';
import { strap, CONN, CONNECT_HELP, REPAIR_HELP } from '../ble/strap.js';
import { Icon } from '../icons.js';
import { AlarmControl } from './alarm.js';

export function StrapView() {
  useEventTarget(strap);
  const { status } = useStore();
  const log = useApi('/sync/log?limit=20');
  const events = useApi('/events?limit=40');
  const s = strap.s;
  const dev = status?.device || {};
  return html`<${Page} title="Pulsera">
    <div class="grid">
      <${BatteryCard} />
      <${Card} span="5" title=${s.name || dev.name || 'WHOOP 4.0'} icon=${html`<${Icon} n="watch" />`}>
        <div class="row"><span class=${`dot ${strap.connected ? 'on' : ''}`}></span><b>${strap.supported ? CONN[s.conn] : 'Navegador sin Bluetooth'}</b></div>
        <${SyncButton} big />
        ${s.conn !== 'syncing' && s.syncStarted && html`<div class="small">Última descarga: <b>${n(s.records)}</b> registros guardados · ${n(s.received)} recibidos · ${s.chunks} bloques confirmados${s.discarded ? ` · ${n(s.discarded)} descartados` : ''}</div>`}
        <${Stat} k="En la muñeca" v=${s.worn == null ? '–' : s.worn ? 'Sí' : 'No'} />
        <${Stat} k="Nº de serie" v=${s.serial || dev.serial || '–'} />
        <${Stat} k="Firmware" v=${s.firmware || dev.firmware || '–'} />
        <${Stat} k="Reloj de la pulsera" v=${clockText(s, dev)} />
        <${Stat} k="Última descarga" v=${ago(s.lastSync || (status?.lastSync || 0) * 1000)} />
        <${Stat} k="Pendiente de subir al servidor" v=${`${s.pending} bloques`} />
        <${Stat} k="Bloques en crudo en el servidor" v=${status?.raw ? `${n(status.raw.chunks)}${status.raw.unstored ? ` · ${n(status.raw.unstored)} sin registros guardados` : ''}` : '–'} />
        ${s.note && html`<${Stat} k="Formato de registro" v=${s.note} />`}
        ${s.pending > 0 && html`<button class="btn small" onClick=${() => strap.upload()}>Reintentar subida</button>`}<//>
      <${Card} span="7" title="Acciones" icon=${html`<${Icon} n="bt" />`}>
        <div class="row">
          <button class="btn" disabled=${!strap.connected} onClick=${() => strap.syncHistory()}><${Icon} n="sync" />Descargar historial</button>
          <button class="btn" disabled=${!strap.connected} onClick=${() => strap.setLive(!s.liveOn)}><${Icon} n="heart" />${s.liveOn ? 'Desactivar' : 'Activar'} FC por Bluetooth estándar</button>
          <button class="btn" disabled=${!strap.connected} onClick=${() => strap.buzz()}>Hacer vibrar</button>
          <button class="btn" disabled=${!strap.connected} onClick=${() => strap.disconnect()}>Desconectar</button>
          <button class="btn danger" onClick=${() => strap.forget()}>Olvidar pulsera</button>
        </div>
        <div class="field"><label>Despertador en la pulsera (vibra aunque el móvil esté lejos)</label><${AlarmControl} /></div>
        <div class="small muted"><b>Cómo funciona la sincronización:</b> la pulsera guarda días de datos segundo a segundo. Al pulsar Sincronizar, Bluefy los descarga, los guarda primero en el móvil (para no perder nada) y después la pulsera borra solo lo confirmado. Luego se suben al servidor, que lo analiza todo. Mantén la pantalla encendida hasta que termine (1–3 min por día de datos).</div>
        <div class="small muted"><b>«Conectado» en Ajustes del iPhone:</b> es normal que iOS muestre la WHOOP siempre conectada; mantiene el emparejamiento por su cuenta. Pulso solo habla con la pulsera mientras Bluefy está abierto, y al volver a Bluefy intenta reconectar sola.</div>
        <div class="small muted"><b>Primera vez:</b> cierra la app oficial de WHOOP (solo una app puede tener la pulsera), pulsa Conectar y acepta el emparejamiento de iOS.</div>
        <div class="small muted"><b>Si no conecta:</b> ${CONNECT_HELP}</div>
        <div class="small muted"><b>Para volver a emparejarla</b> (si se perdió el vínculo Bluetooth): ${REPAIR_HELP}</div><//>
      ${status?.settings?.ignoreBefore && html`<${Card} span="12" title="Pulsera de segunda mano" icon=${html`<${Icon} n="watch" />`}><${SecondHand} status=${status} /><//>`}
      <${Card} span="6" title="Sincronizaciones" icon=${html`<${Icon} n="sync" />`}>
        ${(log.data || []).map((l) => html`<${Stat} k=${dateTime(l.ts)} v=${`${n(l.records)} registros · ${l.first_ts ? `${dateTime(l.first_ts)} → ${dateTime(l.last_ts)}` : ''}`} />`)}
        ${!log.data?.length && html`<div class="small muted">Sin sincronizaciones todavía.</div>`}<//>
      <${Card} span="6" title="Eventos" icon=${html`<${Icon} n="live" />`}>
        ${(events.data || []).slice(0, 15).map((e) => html`<${Stat} k=${e.label} v=${dateTime(e.ts)} />`)}
        ${!events.data?.length && html`<div class="small muted">Sin eventos.</div>`}<//>
      <${Card} span="12" title="Diagnóstico Bluetooth" icon=${html`<${Icon} n="bt" />`}>
        <label class="switch"><span>Capturar tramas crudas (para analizar un firmware nuevo) · ${s.rawCount} capturadas</span><input type="checkbox" checked=${s.raw} onChange=${(e) => strap.setRaw(e.target.checked)} /></label>
        <div class="row">
          <button class="btn small" onClick=${() => download(`pulso-tramas-${Date.now()}.csv`, strap.rawCSV(), 'text/csv')} disabled=${!s.rawCount}>Descargar tramas</button>
          <button class="btn small" onClick=${() => download('pulso-ble-log.txt', strap.logText())}>Descargar registro</button>
          <${Reprocess} status=${status} />
        </div>
        <div class="tiny muted">Cada bloque de historial se guarda en crudo (en el móvil y en el servidor) antes de leerlo, y la pulsera solo borra un bloque cuando sus registros ya están guardados en los dos sitios. «Reprocesar» vuelve a leer los bloques del servidor que no dieron registros (por ejemplo, por una hora mal puesta) y guarda lo que se pueda recuperar.</div>
        <div class="log">${[...s.log].reverse().slice(0, 200).map((l) => html`<div class=${l.level}>${new Date(l.t).toLocaleTimeString('es-ES')} ${l.text}</div>`)}</div><//>
    </div>
  <//>`;
}

function clockText(s, dev) {
  if (s.clock) {
    const d = s.clockDrift;
    const drift = d == null ? '' : Math.abs(d) < 2 ? ' · en hora' : ` · ${d > 0 ? '+' : ''}${n(d)} s`;
    return `${s.clock.toLocaleString('es-ES')}${drift}${s.clockOk === false ? ' ⚠️ sin verificar' : ''}`;
  }
  if (s.clockRaw) return `ilegible (bytes ${s.clockRaw})`;
  if (s.clockOk === false) return 'perdida: se ajustará al conectar';
  if (dev.clock && dev.clockOk) return `${new Date(dev.clock * 1000).toLocaleString('es-ES')} (última conexión)`;
  return 'sin leer: conecta la pulsera';
}

/** Read-only: the filter was applied when the strap arrived; the previous owner's data is gone. */
function SecondHand({ status }) {
  const cut = status?.settings?.ignoreBefore;
  const pg = status?.purge;
  return html`
    <div class="row"><span class="pill yellow">Datos del dueño anterior descartados (todo lo grabado antes del ${new Date(cut * 1000).toLocaleString('es-ES')})</span></div>
    <div class="small muted">${n(status?.discardedPrevious || 0)} registros descartados al descargar${pg?.done ? ` · ${n(pg.moved)} registros que ya estaban guardados se retiraron del análisis${pg.days?.length ? ` (días ${pg.days.join(', ')})` : ''}` : ''}. Todo lo que grabes a partir de esa fecha se guarda con normalidad.</div>`;
}

function Reprocess({ status }) {
  const [busy, setBusy] = useState(null);
  const unstored = status?.raw?.unstored || 0;
  const run = async () => {
    setBusy('0 %');
    try {
      const r = await strap.reprocessRaw((i, total) => setBusy(`${Math.round((i / Math.max(1, total)) * 100)} %`));
      toast(r.chunks ? `Reprocesados ${n(r.chunks)} bloques: ${n(r.stored)} registros recuperados` : 'No hay bloques pendientes de reprocesar');
      api('/status').then((st) => store.set({ status: st })).catch(() => {}); store.bump();
    } catch (e) { toast(e.message); }
    setBusy(null);
  };
  return html`<button class="btn small" disabled=${!!busy || !unstored} onClick=${run}>${busy ? html`<span class="spinner"></span>Reprocesando ${busy}` : `Reprocesar bloques en crudo${unstored ? ` (${n(unstored)})` : ''}`}</button>`;
}

export function BatteryCard({ compact }) {
  useEventTarget(strap);
  useEventTarget(strap, 'battery');
  const b = useApi('/battery?days=14', [strap.s.battery, strap.s.charging]);
  const e = b.data;
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    try {
      const v = await strap.refreshBattery();
      if (v == null) toast('La pulsera no respondió');
      else setTimeout(async () => { const e2 = await api('/battery?days=1').catch(() => null); toast(e2?.known ? `Batería ${n(e2.estimated)} %` : `Batería ${n(v)} %`); b.reload(); }, 800);
    } catch (err) { toast(err.message); }
    setBusy(false);
  };
  if (!e) return html`<${Card} title="Batería" icon=${html`<${Icon} n="battery" />`} span=${compact ? undefined : '12'}><${Spinner} /><//>`;
  if (!e.known) return html`<${Card} title="Batería" icon=${html`<${Icon} n="battery" />`} span=${compact ? undefined : '12'}><div class="small muted">Sin lecturas todavía. Conecta la pulsera desde Bluefy: cada sincronización guarda el nivel y con unas pocas lecturas se calcula cuánto le queda.</div><//>`;
  const lvl = e.estimated;
  const col = e.charging ? C.strain : lvl <= 15 ? C.red : lvl <= 30 ? C.yellow : C.green;
  const fmtH = (h) => (h == null ? '–' : h >= 48 ? `${Math.floor(h / 24)} d ${Math.round(h % 24)} h` : h >= 1 ? `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min` : `${Math.round(h * 60)} min`);
  const when = (ts) => new Date(ts * 1000).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const hist = e.history || [];
  const cfg = () => ({
    type: 'line',
    data: { datasets: [
      { label: 'Batería', data: hist.map((r) => ({ x: r.ts * 1000, y: r.level })), borderColor: C.green, pointRadius: 2, borderWidth: 1.6, tension: 0.2,
        segment: { borderColor: (c) => (hist[c.p1DataIndex]?.charging ? C.strain : C.green) } },
      ...(e.charging ? [] : [{ label: 'Previsión', data: [{ x: Date.now(), y: lvl }, { x: e.emptyAt * 1000, y: 0 }], borderColor: C.muted, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.2 }]),
    ] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ...timeX('day'), max: e.charging ? undefined : Math.max(Date.now(), e.emptyAt * 1000) }, y: { min: 0, max: 100, ticks: { callback: (v) => `${v} %` } } } },
  });
  return html`<${Card} title="Batería" icon=${html`<${Icon} n="battery" />`} span=${compact ? undefined : '12'}
    right=${html`<button class="btn small" disabled=${!strap.connected || busy} onClick=${read}>${busy ? html`<span class="spinner"></span>` : html`<${Icon} n="sync" />`}Leer ahora</button>`}>
    <div class="row" style="gap:22px;align-items:center">
      <div class="col" style="gap:6px;min-width:150px">
        <div class="big-number" style=${{ fontSize: '3.4rem', color: col }}>${n(lvl)}<span style="font-size:1.4rem"> %</span></div>
        <div style="height:14px;width:150px;border-radius:5px;border:2px solid var(--line);position:relative;overflow:hidden">
          <div style=${{ position: 'absolute', inset: 0, width: `${lvl}%`, background: col }}></div></div>
        <span class=${`pill ${e.charging ? 'blue' : lvl <= 15 ? 'red' : lvl <= 30 ? 'yellow' : 'green'}`} style="align-self:flex-start">${e.charging ? '⚡ Cargando' : 'En uso'}</span>
      </div>
      <div class="col grow" style="gap:0;min-width:220px">
        ${e.charging
          ? html`<${Stat} k="Llena en" v=${html`<b>${fmtH(e.toFullMinutes / 60)}</b>`} /><${Stat} k="Hora estimada" v=${when(e.fullAt)} />
              <${Stat} k="Velocidad de carga" v=${`${n(e.chargePerHour)} %/h (${e.chargeSource})`} /><${Stat} k="Autonomía después" v=${`~${n(e.afterChargeDays, 1)} días`} />`
          : html`<${Stat} k="Le queda" v=${html`<b>${fmtH(e.remainingHours)}</b>`} /><${Stat} k="Se agota hacia" v=${when(e.emptyAt)} />
              <${Stat} k="Gasto" v=${`${n(e.dischargePerDay, 1)} %/día · ${e.dischargeSource}`} /><${Stat} k="Autonomía por carga" v=${`~${n(e.fullLifeDays, 1)} días`} />`}
        <${Stat} k="Última carga" v=${e.lastChargedAt ? when(e.lastChargedAt) : '–'} />
        ${e.avgLifeDays && html`<${Stat} k="Duración media real" v=${`${n(e.avgLifeDays, 1)} días (${e.cycles} ciclos)`} />`}
        ${e.mv && html`<${Stat} k="Voltaje" v=${`${(e.mv / 1000).toFixed(2)} V`} />`}
        ${e.pack && Date.now() / 1000 - e.pack.ts < 6 * 3600 && html`<${Stat} k="Batería del cargador (pack)" v=${`${n(e.pack.level)} %${e.pack.mv ? ` · ${(e.pack.mv / 1000).toFixed(2)} V` : ''}`} />`}
      </div>
    </div>
    ${!compact && hist.length > 1 && html`<${ChartBox} config=${cfg} height=${190} deps=${[hist.length, e.lastReading, e.charging]} />
      <div class="legend"><span><i style=${{ background: C.green }}></i>Descarga</span><span><i style=${{ background: C.strain }}></i>Carga</span><span><i style=${{ background: C.muted }}></i>Previsión</span></div>`}
    <div class="tiny faint">Última lectura ${when(e.lastReading)} · el nivel actual se estima con tu ritmo de gasto (fiabilidad ${e.confidence}). Mientras la pulsera está conectada se lee cada minuto; ponle el cargador con Bluefy abierto para ver la carga en tiempo real. Telegram te avisa por la noche si no llega a la mañana.</div>
  <//>`;
}
