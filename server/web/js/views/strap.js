import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, store, api, toast, n, ago, download, useEventTarget, dateTime, C } from '../core.js';
import { Card, Stat, Spinner, ChartBox, timeX } from '../ui.js';
import { Page, SyncButton } from '../layout.js';
import { strap, CONN } from '../ble/strap.js';
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
        ${s.error && html`<div class="small bad">${s.error}</div>`}
        ${s.conn === 'syncing' && html`<div class="small">Descargando: <b>${s.records}</b> registros · ${s.chunks} bloques confirmados</div>`}
        <${Stat} k="En la muñeca" v=${s.worn == null ? '–' : s.worn ? 'Sí' : 'No'} />
        <${Stat} k="Nº de serie" v=${s.serial || dev.serial || '–'} />
        <${Stat} k="Firmware" v=${s.firmware || dev.firmware || '–'} />
        <${Stat} k="Reloj de la pulsera" v=${s.clock ? s.clock.toLocaleString('es-ES') : '–'} />
        <${Stat} k="Última descarga" v=${ago(s.lastSync || (status?.lastSync || 0) * 1000)} />
        <${Stat} k="Pendiente de subir al servidor" v=${`${s.pending} bloques`} />
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
        <div class="small muted"><b>Primera vez:</b> cierra la app oficial de WHOOP (solo una app puede tener la pulsera), pulsa Conectar y acepta el emparejamiento de iOS.</div><//>
      <${Card} span="12" title="Pulsera de segunda mano" icon=${html`<${Icon} n="watch" />`}><${SecondHand} status=${status} /><//>
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
        </div>
        <div class="log">${[...s.log].reverse().slice(0, 200).map((l) => html`<div class=${l.level}>${new Date(l.t).toLocaleTimeString('es-ES')} ${l.text}</div>`)}</div><//>
    </div>
  <//>`;
}

function SecondHand({ status }) {
  const cut = status?.settings?.ignoreBefore;
  const toLocal = (ts) => { const d = new Date(ts * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [when, setWhen] = useState(cut ? toLocal(cut) : toLocal(Math.floor(Date.now() / 1000)));
  const save = async (ts) => {
    try {
      await api('/settings', { method: 'PUT', json: { ignoreBefore: ts } });
      store.set({ status: { ...status, settings: { ...status.settings, ignoreBefore: ts } } });
      toast(ts ? `Se descartará todo lo grabado antes del ${new Date(ts * 1000).toLocaleString('es-ES')}` : 'Filtro quitado: se guardará todo');
    } catch (e) { toast(e.message); }
  };
  return html`
    <div class="small">Si la pulsera era de otra persona, su memoria puede tener días de datos suyos sin descargar. Pulso los <b>descarga y los descarta</b>: la pulsera libera la memoria de la forma normal (al confirmar cada bloque) y no se usa ningún comando de borrado. Así no se mezclan con tus métricas ni con tu línea base.</div>
    ${cut
      ? html`<div class="row"><span class="pill yellow">Descartando todo lo anterior a ${new Date(cut * 1000).toLocaleString('es-ES')}</span>
          <span class="small muted">${n(status?.discardedPrevious || 0)} registros descartados hasta ahora</span></div>`
      : html`<div class="row"><span class="pill">Sin filtro: se guarda todo</span></div>`}
    <div class="row">
      <button class="btn primary" onClick=${() => save(Math.floor(Date.now() / 1000))}>Descartar todo lo anterior a ahora</button>
      <input type="datetime-local" value=${when} onChange=${(e) => setWhen(e.target.value)} style="width:auto" />
      <button class="btn small" onClick=${() => save(Math.floor(new Date(when).getTime() / 1000))}>Usar esta fecha</button>
      ${cut && html`<button class="btn small" onClick=${() => save(null)}>Quitar filtro</button>`}
    </div>
    <div class="small muted"><b>Orden recomendado al recibirla:</b> 1) el dueño anterior la elimina de su cuenta de WHOOP y la olvida en Ajustes › Bluetooth de su iPhone; 2) cárgala; 3) aquí, pulsa «Descartar todo lo anterior a ahora»; 4) conéctala y sincroniza (la primera descarga puede tardar varios minutos si tenía muchos días guardados; deja la pantalla encendida); 5) póntela. Puedes dejar el filtro puesto: solo afecta a datos anteriores a esa fecha.</div>`;
}

export function BatteryCard({ compact }) {
  useEventTarget(strap);
  useEventTarget(strap, 'battery');
  const b = useApi('/battery?days=14', [strap.s.battery, strap.s.charging]);
  const e = b.data;
  const [busy, setBusy] = useState(false);
  const read = async () => { setBusy(true); try { const v = await strap.refreshBattery(); toast(v != null ? `Batería ${n(v)} %` : 'La pulsera no respondió'); setTimeout(b.reload, 800); } catch (err) { toast(err.message); } setBusy(false); };
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
      </div>
    </div>
    ${!compact && hist.length > 1 && html`<${ChartBox} config=${cfg} height=${190} deps=${[hist.length, e.lastReading, e.charging]} />
      <div class="legend"><span><i style=${{ background: C.green }}></i>Descarga</span><span><i style=${{ background: C.strain }}></i>Carga</span><span><i style=${{ background: C.muted }}></i>Previsión</span></div>`}
    <div class="tiny faint">Última lectura ${when(e.lastReading)} · el nivel actual se estima con tu ritmo de gasto (fiabilidad ${e.confidence}). Mientras la pulsera está conectada se lee cada minuto; ponle el cargador con Bluefy abierto para ver la carga en tiempo real. Telegram te avisa por la noche si no llega a la mañana.</div>
  <//>`;
}
