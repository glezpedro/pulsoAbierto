// Despertador de la pulsera: ver a qué hora está programado, programarlo, quitarlo y cómo pararlo.
import { html, useState } from '../../vendor/preact-htm.js';
import { useStore, store, api, toast, useEventTarget } from '../core.js';
import { HKCard } from '../ui.js';
import { strap } from '../ble/strap.js';

const fmtTime = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 86400000);
  return diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
};
const inTxt = (sec) => { const m = Math.max(0, Math.round(sec / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/** Upcoming alarm (unix s) from the strap state or the server settings; null if none or already past. */
export function useAlarm() {
  useEventTarget(strap);
  const { status } = useStore();
  const at = strap.s.alarmAt !== undefined ? strap.s.alarmAt : status?.settings?.alarmAt;
  const rang = status?.settings?.alarmRangAt;
  const now = Date.now() / 1000;
  return { at: at && at > now - 120 ? at : null, past: at && at <= now - 120 ? at : null, rang };
}

export const STOP_HINT = 'Cuando vibre: dale dos toques seguidos a la pulsera para pararla. Si no haces nada, se para sola a los ~30 segundos. No tiene repetición (snooze).';

/** Compact card for the mobile summary. Only shown when an alarm is programmed. */
export function AlarmSummary() {
  const { at } = useAlarm();
  if (!at) return null;
  const d = new Date(at * 1000);
  return html`<${HKCard} cat="var(--orange, #ff9500)" icon="alarm" title="Despertador" when=${fmtDay(d)} href="#/pulsera"
    value=${fmtTime(d)} label=${`Suena en ${inTxt(at - Date.now() / 1000)} · doble toque en la pulsera para pararla`} />`;
}

/** Full control for the Pulsera page. */
export function AlarmControl() {
  const { status } = useStore();
  const { at, past, rang } = useAlarm();
  const def = at ? fmtTime(new Date(at * 1000)) : status?.profile?.wakeTime || '07:00';
  const [time, setTime] = useState(def);
  const [busy, setBusy] = useState(false);
  const refresh = () => api('/status').then((s) => store.set({ status: s })).catch(() => {});
  const program = async () => {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1);
    setBusy(true);
    const ok = await strap.setAlarm(d).catch(() => false);
    setBusy(false);
    toast(ok ? `Despertador: ${fmtDay(d)} a las ${fmtTime(d)}` : 'La pulsera no confirmó la alarma. Prueba otra vez.');
    setTimeout(refresh, 800);
  };
  const remove = async () => {
    setBusy(true);
    const ok = await strap.disableAlarm().catch(() => false);
    setBusy(false);
    toast(ok ? 'Despertador quitado' : 'La pulsera no respondió');
    setTimeout(refresh, 800);
  };
  const d = at ? new Date(at * 1000) : null;
  return html`<div class="col" style="gap:8px">
    <div class="hk-card" style="--cat:var(--orange, #ff9500);box-shadow:none;background:var(--panel-2)">
      ${d ? html`<div class="hk-val" style="font-size:2rem">${fmtTime(d)}<small> ${fmtDay(d)}</small></div>
        <div class="hk-label">Programado en la pulsera · suena en ${inTxt(at - Date.now() / 1000)}</div>`
      : html`<div class="hk-val" style="font-size:1.2rem">Sin despertador</div>
        <div class="hk-label">${past ? `El último era ${fmtDay(new Date(past * 1000))} a las ${fmtTime(new Date(past * 1000))}` : 'No hay ninguno programado'}${rang ? ` · sonó ${fmtDay(new Date(rang * 1000))} a las ${fmtTime(new Date(rang * 1000))}` : ''}</div>`}
    </div>
    <div class="row"><input type="time" value=${time} onChange=${(e) => setTime(e.target.value)} style="width:auto" />
      <button class="btn small primary" disabled=${!strap.connected || busy} onClick=${program}>${at ? 'Cambiar' : 'Programar'}</button>
      ${at && html`<button class="btn small" disabled=${!strap.connected || busy} onClick=${remove}>Quitar</button>`}</div>
    ${!strap.connected && html`<div class="tiny muted">Conecta la pulsera para programarlo o quitarlo. Una vez programado, suena aunque el móvil esté apagado o lejos.</div>`}
    <div class="small"><b>Para pararlo:</b> ${STOP_HINT.replace('Cuando vibre: d', 'D')}</div>
  </div>`;
}
