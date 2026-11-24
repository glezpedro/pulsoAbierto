// Enviar datos a la app Salud mediante el Atajo de iOS «Pulso a Salud».
import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useIsMobile, toast, isToday } from '../core.js';

const SHORTCUT = 'Pulso a Salud';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Button that runs the Shortcut for a given day. */
export function SendToHealth({ date, small }) {
  const st = useApi(`/health/exported?day=${date}`, [date]);
  const mobile = useIsMobile();
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT)}&input=text&text=${date}`;
  const at = st.data?.exportedAt;
  const when = at ? new Date(at * 1000).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const onClick = (e) => {
    if (!isIOS()) { e.preventDefault(); toast('Se envía desde el iPhone: abre Pulso en Bluefy y pulsa este botón (necesita el Atajo «Pulso a Salud», ver Ajustes).', 6000); return; }
    setTimeout(() => st.reload(), 15000);
  };
  if (small) {
    return html`<a class="btn small" href=${url} onClick=${onClick} title=${when ? `Enviado ${when}` : 'Enviar los datos de este día a la app Salud'}>
      ${heartIcon()} ${when ? 'Reenviar a Salud' : 'Enviar a Salud'}</a>`;
  }
  return html`<div class="hk-card" style="--cat:var(--heart)">
    <div class="hk-head"><span class="hk-cat">${heartIcon()} App Salud</span><span class="hk-when">${when ? `Enviado ${when}` : 'Sin enviar'}</span></div>
    <div class="small muted">Sueño (fases), frecuencia cardiaca, FC en reposo, respiración y energía activa de ${isToday(date) ? 'hoy' : date}.</div>
    <a class="btn ${when ? '' : 'primary'}" href=${url} onClick=${onClick}>${heartIcon('#fff')} ${when ? 'Volver a enviar a Salud' : 'Enviar a Salud'}</a>
    ${!mobile ? html`<div class="tiny muted">Funciona desde el iPhone (Bluefy) con el Atajo «${SHORTCUT}». Instrucciones en Ajustes.</div>` : html`<a class="tiny" href="#/ajustes">¿Primera vez? Crea el Atajo «${SHORTCUT}» (Ajustes)</a>`}
  </div>`;
}

const heartIcon = (color) => html`<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style=${{ fill: color || 'var(--heart)' }}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/></svg>`;

function Copy({ value }) {
  const copy = async () => { try { await navigator.clipboard.writeText(value); toast('Copiado'); } catch { toast('Mantén pulsado el texto para copiarlo'); } };
  return html`<div class="row" style="gap:6px"><code style="flex:1;word-break:break-all;padding:8px 10px;background:var(--panel-2);border-radius:8px">${value}</code><button class="btn small" onClick=${copy}>Copiar</button></div>`;
}

/** Step-by-step guide to build the Shortcut (shown in Ajustes). */
export function HealthShortcutGuide() {
  const base = `${location.origin}/api/health`;
  const loop = (list, stage) => html`<li><b>Obtener valor del diccionario</b> <code>${list}</code> del «Contenido de la URL» → <b>Repetir con cada elemento</b>. Dentro del bucle:
    <b>Obtener valor del diccionario</b> <code>start</code> y otro <code>end</code> del «Elemento repetido» → <b>Registrar muestra de salud</b>: tipo <b>Análisis del sueño</b>, valor <b>${stage}</b>, fecha de inicio = <i>start</i>, fecha de finalización = <i>end</i>.</li>`;
  return html`<details class="card" style="background:var(--panel-2);gap:8px">
    <summary style="cursor:pointer"><b>Atajo «${SHORTCUT}»</b> <span class="small muted">· envía tus datos a la app Salud</span></summary>
    <div class="small muted">Una web no puede escribir en Salud: lo hace este Atajo, que lee los datos de tu servidor y los registra. El botón «Enviar a Salud» de Resumen lo ejecuta para el día que estés viendo.</div>
    <div class="small"><b>Crear el Atajo (una vez, en el iPhone)</b></div>
    <ol class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>App <b>Atajos</b> › <b>+</b> › nombre exacto: <b>${SHORTCUT}</b>. En ⓘ activa que reciba <b>Texto</b> (es la fecha del día; si va vacío, usa hoy).</li>
      <li><b>Obtener contenido de URL</b>: <code>${base}/export?day=</code> seguido de la variable <b>Entrada del atajo</b>. Método GET.<${Copy} value=${`${base}/export?day=`} /></li>
      <li><b>Obtener valor del diccionario</b> <code>restingHR</code> → <b>Registrar muestra de salud</b>: <b>Frecuencia cardiaca en reposo</b>, valor = ese valor, fecha = valor del diccionario <code>wake</code>.</li>
      <li>Igual con <code>respiratoryRate</code> → <b>Frecuencia respiratoria</b> y con <code>activeKcal</code> → <b>Energía activa</b> (fecha <code>date</code>).</li>
      ${loop('sleepDeep', 'Sueño profundo')}
      ${loop('sleepCore', 'Sueño básico')}
      ${loop('sleepREM', 'Sueño REM')}
      ${loop('sleepAwake', 'Despierto')}
      <li><b>Obtener valor del diccionario</b> <code>heartRate</code> → <b>Repetir con cada elemento</b> → dentro: <code>value</code> y <code>date</code> del elemento → <b>Registrar muestra de salud</b>: <b>Frecuencia cardiaca</b>, valor = <i>value</i>, fecha = <i>date</i>.</li>
      <li>Al final: <b>Obtener contenido de URL</b> <code>${base}/exported</code>, método <b>POST</b>, cuerpo <b>JSON</b> con clave <code>day</code> = valor <code>day</code> del primer diccionario. Luego <b>Mostrar notificación</b> «Enviado a Salud».<${Copy} value=${`${base}/exported`} /></li>
    </ol>
    <div class="small"><b>Automático (opcional)</b>: en Atajos › Automatización › <b>Hora del día</b> (p. ej. 10:00) › Ejecutar inmediatamente › «${SHORTCUT}». Sin entrada envía los datos de hoy.</div>
    <div class="tiny faint">Para no duplicar datos en Salud, envía cada día una sola vez (Pulso marca qué días ya enviaste). La primera vez iOS te pedirá permiso para que Atajos escriba en Salud. Tailscale debe estar activo. La VFC no se envía porque Salud la guarda como SDNN y Pulso mide RMSSD.</div>
  </details>`;
}
