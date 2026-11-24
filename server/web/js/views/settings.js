import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast, store, n } from '../core.js';
import { Card, Stat, Spinner } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';
import { HealthShortcutGuide } from './health.js';

export function SettingsView() {
  const { status } = useStore();
  useEffect(() => {
    const q = location.hash.split('?')[1] || '';
    if (q.includes('strava=ok')) toast('Strava conectado ✅');
    if (q.includes('strava=error')) toast('No se pudo conectar Strava');
  }, []);
  if (!status) return html`<${Page} title="Ajustes"><${Spinner} /><//>`;
  return html`<${Page} title="Ajustes">
    <div class="grid">
      <${Card} span="6" title="Perfil" icon=${html`<${Icon} n="body" />`}><${Profile} p=${status.profile} hrMax=${status.hrMax} /><//>
      <${Card} span="6" title="Telegram" icon=${html`<${Icon} n="send" />`}><${Telegram} status=${status} /><//>
      <${Card} span="6" title="Notificaciones" icon=${html`<${Icon} n="send" />`}><${Notifs} s=${status.settings} /><//>
      <${Card} span="6" title="Strava" icon=${html`<${Icon} n="trend" />`}><${Strava} st=${status.strava} /><//>
      <${Card} span="6" title="Strong y app Salud" icon=${html`<${Icon} n="heart" />`}><${Health} s=${status.settings} /><//>
      <${Card} span="12" title="Datos" icon=${html`<${Icon} n="report" />`}><${Data} status=${status} /><//>
      <${Card} span="12" title="Coach IA (opcional, de pago)" icon=${html`<${Icon} n="spark" />`}>
        <details><summary class="small muted" style="cursor:pointer">Pulso funciona completo sin IA. Si algún día quieres el chat con Claude, el análisis redactado o planes generados por IA, configúralo aquí.</summary>
          <div class="col" style="margin-top:10px"><${AI} status=${status} /></div></details><//>
    </div>
  <//>`;
}

const putSettings = async (p) => { try { await api('/settings', { method: 'PUT', json: p }); store.set({ status: { ...store.s.status, settings: { ...store.s.status.settings, ...p } } }); } catch (e) { toast(e.message); } };

function Profile({ p, hrMax }) {
  const [f, setF] = useState(p);
  const up = (k, v) => setF({ ...f, [k]: v });
  const save = async () => {
    try { await api('/profile', { method: 'PUT', json: { ...f, heightCm: +f.heightCm, weightKg: +f.weightKg, sleepNeedHours: +f.sleepNeedHours, maxHROverride: f.maxHROverride ? +f.maxHROverride : null } }); toast('Perfil guardado'); }
    catch (e) { toast(e.message); return; }
    if (confirm('¿Recalcular todo el historial con el perfil nuevo?')) { await api('/analyze', { json: { all: true } }); toast('Recalculando historial…'); }
  };
  return html`<div class="form-grid">
      <div class="field"><label>Nombre</label><input type="text" value=${f.name} onInput=${(e) => up('name', e.target.value)} /></div>
      <div class="field"><label>Nacimiento</label><input type="date" value=${f.birthDate} onChange=${(e) => up('birthDate', e.target.value)} /></div>
      <div class="field"><label>Sexo biológico</label><select value=${f.sex} onChange=${(e) => up('sex', e.target.value)}><option value="male">Hombre</option><option value="female">Mujer</option></select></div>
      <div class="field"><label>Altura (cm)</label><input type="number" value=${f.heightCm} onInput=${(e) => up('heightCm', e.target.value)} /></div>
      <div class="field"><label>Peso (kg)</label><input type="number" step="0.1" value=${f.weightKg} onInput=${(e) => up('weightKg', e.target.value)} /></div>
      <div class="field"><label>FC máxima (vacío = ${n(hrMax)} auto)</label><input type="number" value=${f.maxHROverride || ''} onInput=${(e) => up('maxHROverride', e.target.value)} /></div>
      <div class="field"><label>Necesidad base de sueño (h)</label><input type="number" step="0.25" value=${f.sleepNeedHours} onInput=${(e) => up('sleepNeedHours', e.target.value)} /></div>
      <div class="field"><label>Hora de despertar</label><input type="time" value=${f.wakeTime} onChange=${(e) => up('wakeTime', e.target.value)} /></div>
    </div>
    <div class="field"><label>Objetivo</label><textarea value=${f.goal} onInput=${(e) => up('goal', e.target.value)} placeholder="p. ej. bajar a 75 kg manteniendo fuerza y correr 10 km en 45 min"></textarea></div>
    <button class="btn primary" onClick=${save}>Guardar perfil</button>`;
}

function AI({ status }) {
  const [key, setKey] = useState('');
  const save = async () => { await api('/secrets', { method: 'PUT', json: { anthropic: key } }); setKey(''); toast(key ? 'Clave guardada' : 'Clave eliminada'); store.set({ status: { ...status, hasAnthropic: !!key } }); };
  return html`<div class="row"><span class=${`pill ${status.hasAnthropic ? 'green' : ''}`}>${status.hasAnthropic ? 'Clave configurada' : 'Sin clave'}</span></div>
    <div class="row"><input type="password" placeholder="sk-ant-…" value=${key} onInput=${(e) => setKey(e.target.value)} class="grow" style="flex:1" autocomplete="off" /><button class="btn" onClick=${save}>${key ? 'Guardar' : 'Borrar'}</button></div>
    <div class="field"><label>Modelo</label><select value=${status.settings.claudeModel} onChange=${(e) => putSettings({ claudeModel: e.target.value })}>
      <option value="claude-opus-5-5">Claude Opus 5.5 (máxima calidad)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 (equilibrado)</option><option value="claude-haiku-5-5">Claude Haiku 5.5 (rápido y barato)</option></select></div>
    <label class="switch"><span>Análisis automático cada mañana</span><input type="checkbox" checked=${status.settings.autoDailyAnalysis} onChange=${(e) => putSettings({ autoDailyAnalysis: e.target.checked })} /></label>
    <label class="switch"><span>Informe semanal redactado por IA</span><input type="checkbox" checked=${status.settings.autoWeeklyAI} onChange=${(e) => putSettings({ autoWeeklyAI: e.target.checked })} /></label>
    <div class="tiny faint">La clave se guarda solo en tu servidor y se envía únicamente a api.anthropic.com. Créala en console.anthropic.com › API Keys.</div>`;
}

function Telegram({ status }) {
  const tg = useApi('/telegram');
  const [tok, setTok] = useState('');
  const t = tg.data || {};
  const saveTok = async () => { await api('/secrets', { method: 'PUT', json: { telegram_token: tok } }); setTok(''); toast('Token guardado. Conectando con Telegram…'); setTimeout(tg.reload, 4000); };
  const test = async () => { try { await api('/telegram/test', { method: 'POST' }); toast('Mensaje enviado'); } catch (e) { toast(e.message); } };
  const unlink = async () => { await api('/telegram/unlink', { method: 'POST' }); tg.reload(); };
  return html`
    <div class="row"><span class=${`pill ${t.paired ? 'green' : t.configured ? 'yellow' : ''}`}>${t.paired ? `Vinculado${t.username ? ` · @${t.username}` : ''}` : t.configured ? (t.running ? `Bot @${t.username} esperando vinculación` : 'Bot configurado (conectando…)') : 'Sin configurar'}</span></div>
    ${t.error && html`<div class="tiny bad">${t.error}</div>`}
    <ol class="small" style="margin:0;padding-left:18px">
      <li>En Telegram abre <b>@BotFather</b> → <code>/newbot</code> → copia el token.</li>
      <li>Pégalo aquí y guarda.</li>
      <li>Abre tu bot${t.username ? html` (<a href=${`https://t.me/${t.username}`} target="_blank" rel="noopener">@${t.username}</a>)` : ''} y envíale: <code>/start ${t.code || '······'}</code></li>
    </ol>
    <div class="row"><input type="password" placeholder="Token del bot" value=${tok} onInput=${(e) => setTok(e.target.value)} style="flex:1" autocomplete="off" /><button class="btn" onClick=${saveTok} disabled=${!tok}>Guardar</button></div>
    <div class="row"><button class="btn small" onClick=${test} disabled=${!t.paired}>Enviar prueba</button>${t.paired && html`<button class="btn small danger" onClick=${unlink}>Desvincular</button>`}</div>
    <div class="tiny faint">Comandos del bot: /hoy, /sueno, /semana, /carga, /plan, /bateria y /coach (o escríbele directamente para hablar con el coach IA).</div>`;
}

function Notifs({ s }) {
  const sw = (k, label) => html`<label class="switch"><span>${label}</span><input type="checkbox" checked=${s[k]} onChange=${(e) => putSettings({ [k]: e.target.checked })} /></label>`;
  return html`${sw('notifyMorning', 'Resumen de recuperación al sincronizar por la mañana')}
    ${sw('notifyBedtime', 'Aviso 30 min antes de la hora ideal para acostarte')}
    ${sw('notifyWeekly', 'Informe semanal')}
    <div class="row"><span class="small muted">Día y hora del informe</span>
      <select value=${s.weeklyDay} onChange=${(e) => putSettings({ weeklyDay: +e.target.value })} style="width:auto">${['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => html`<option value=${i}>${d}</option>`)}</select>
      <input type="time" value=${s.weeklyTime} onChange=${(e) => putSettings({ weeklyTime: e.target.value })} style="width:auto" /></div>
    ${sw('notifyNoSync', 'Recordatorio si llevas más de 20 h sin sincronizar')}
    ${sw('notifyBattery', 'Batería baja de la pulsera (20 % y 10 %)')}
    ${sw('notifyWorkouts', 'Actividad detectada por la pulsera')}
    ${sw('notifyStrava', 'Actividades nuevas de Strava')}`;
}

function Strava({ st }) {
  const [id, setId] = useState(st.clientId || '');
  const [secret, setSecret] = useState('');
  const saveCfg = async () => { await api('/strava/config', { method: 'PUT', json: { client_id: id, client_secret: secret || undefined } }); setSecret(''); toast('Configuración guardada'); };
  const connect = async () => { try { await saveCfg(); const r = await api('/strava/authorize'); location.href = r.url; } catch (e) { toast(e.message); } };
  const disc = async () => { await api('/strava/disconnect', { method: 'POST' }); store.bump(); toast('Strava desconectado'); };
  const imp = async () => { try { const r = await api('/strava/import', { method: 'POST' }); toast(`${r.added} actividades nuevas`); } catch (e) { toast(e.message); } };
  return html`
    <div class="row"><span class=${`pill ${st.connected ? 'green' : ''}`}>${st.connected ? `Conectado${st.athlete ? ` · ${st.athlete}` : ''}` : 'No conectado'}</span>
      ${st.lastImport && html`<span class="tiny muted">última importación ${new Date(st.lastImport * 1000).toLocaleString('es-ES')}</span>`}</div>
    <ol class="small" style="margin:0;padding-left:18px">
      <li>Crea tu app gratis en <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a>.</li>
      <li>En <b>Authorization Callback Domain</b> pon: <code>${new URL(st.redirect).host}</code></li>
      <li>Copia aquí el Client ID y el Client Secret y pulsa Conectar.</li>
    </ol>
    <div class="form-grid"><div class="field"><label>Client ID</label><input type="text" value=${id} onInput=${(e) => setId(e.target.value)} /></div>
      <div class="field"><label>Client Secret ${st.hasSecret ? '(guardado)' : ''}</label><input type="password" value=${secret} onInput=${(e) => setSecret(e.target.value)} autocomplete="off" /></div></div>
    <div class="row">${st.connected ? html`<button class="btn small" onClick=${imp}>Importar ahora</button><button class="btn small danger" onClick=${disc}>Desconectar</button>` : html`<button class="btn primary" onClick=${connect} disabled=${!id || (!secret && !st.hasSecret)}>Conectar con Strava</button>`}</div>
    <label class="switch"><span>Importar actividades cada hora automáticamente</span><input type="checkbox" checked=${true} disabled /></label>
    <div class="tiny faint">Desde Entreno puedes subir cualquier sesión (por ejemplo de Strong) a Strava con la curva de FC de la pulsera.</div>`;
}

function CopyField({ value }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast('Copiado'); }
    catch { toast('Mantén pulsado el texto para copiarlo'); }
  };
  return html`<div class="row" style="gap:6px"><code style="flex:1;word-break:break-all;padding:8px 10px">${value}</code><button class="btn small" onClick=${copy}>Copiar</button></div>`;
}

function StrongShortcut() {
  const url = `${location.origin}/api/strong/import-raw`;
  return html`<details class="card" style="background:var(--panel-2);gap:8px">
    <summary style="cursor:pointer"><b>Atajo «Enviar a Pulso»</b> <span class="small muted">· Strong → Pulso en dos toques</span></summary>
    <div class="small"><b>Crear el Atajo (una vez, en el iPhone)</b></div>
    <ol class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
      <li>Abre <b>Atajos</b> › <b>+</b> y ponle de nombre <b>Enviar a Pulso</b>.</li>
      <li>Toca el icono <b>ⓘ</b> (Detalles) › activa <b>Mostrar en hoja de compartir</b>. En los tipos de entrada deja solo <b>Archivos</b>.</li>
      <li>En el primer bloque «Recibir <i>Archivos</i> de <i>Hoja de compartir</i>», elige <b>Si no hay entrada: Solicitar archivo</b>. Así también puedes lanzarlo a mano y elegir el CSV en Archivos.</li>
      <li>Añade la acción <b>Obtener contenido de URL</b> con esta URL:<${CopyField} value=${url} />
        Despliega las opciones: <b>Método: POST</b> · <b>Cuerpo de la solicitud: Archivo</b> · Archivo: <b>Entrada del atajo</b>.</li>
      <li>Añade <b>Obtener valor del diccionario</b>: clave <code>message</code>, del «Contenido de la URL».</li>
      <li>Añade <b>Mostrar notificación</b> con el «Valor del diccionario». Te dirá cuántos entrenos nuevos se han añadido.</li>
    </ol>
    <div class="small"><b>Usarlo después de entrenar</b></div>
    <ol class="small" style="margin:0;padding-left:18px">
      <li>Tailscale activo en el iPhone.</li>
      <li>Strong › Perfil › Ajustes › <b>Exportar datos de Strong</b>.</li>
      <li>En la hoja de compartir toca <b>Enviar a Pulso</b>. Listo: en unos segundos ves la notificación y la sesión aparece en Entreno con su esfuerzo y FC.</li>
    </ol>
    <div class="tiny faint">Puedes enviar siempre la exportación completa: Pulso solo añade lo nuevo. Si Strong guarda el archivo en vez de abrir la hoja de compartir, lanza el Atajo desde la app Atajos y elige el CSV.</div>
  </details>`;
}

function Health({ s }) {
  const url = `${location.origin}/api/health/ingest`;
  return html`
    <div class="field"><label>Unidades de peso del CSV de Strong</label><select value=${s.strongUnit} onChange=${(e) => putSettings({ strongUnit: e.target.value })}><option value="kg">kg</option><option value="lb">lb</option></select></div>
    <div class="small muted">Strong no tiene API: exporta el CSV (Perfil › Ajustes › Exportar datos) y súbelo en <a href="#/entreno">Entreno › Historial</a>, o mándalo en dos toques con el Atajo de abajo. Solo se añaden las sesiones nuevas.</div>
    <${StrongShortcut} />
    <${HealthShortcutGuide} />
    <div class="small"><b>De Salud a Pulso con un Atajo (pasos y peso automáticos)</b></div>
    <ol class="small" style="margin:0;padding-left:18px">
      <li>App Atajos › Automatización › nueva › <b>Hora del día</b> (p. ej. 23:30, diaria) › Ejecutar inmediatamente.</li>
      <li>Acción <b>Buscar muestras de salud</b>: Pasos, fecha de inicio <i>hoy</i> → acción <b>Calcular estadísticas</b> › Suma.</li>
      <li>(Opcional) <b>Buscar muestras de salud</b>: Peso, ordenar por fecha, límite 1.</li>
      <li>Acción <b>Obtener contenido de URL</b>: <code style="word-break:break-all">${url}</code> · Método POST · Cuerpo JSON con <code>steps</code> = suma y <code>weightKg</code> = peso.</li>
    </ol>
    <div class="tiny faint">El iPhone debe tener Tailscale activo cuando se ejecute el Atajo. Para ver qué escribir en Salud, el Atajo puede leer <code>/api/health/export</code>.</div>`;
}

function Data({ status }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');
  const s = status.samples;
  const demo = async () => { setBusy('demo'); try { const r = await api('/demo', { json: { days: 21 } }); toast(`Demo: ${n(r.written)} muestras, analizando ${r.queued} días…`); } catch (e) { toast(e.message); } setBusy(''); };
  const wipe = async () => { try { await api('/wipe', { json: { confirm } }); toast('Datos borrados'); setConfirm(''); store.bump(); } catch (e) { toast(e.message); } };
  const reanalyze = async () => { const r = await api('/analyze', { json: { all: true } }); toast(`Recalculando ${r.queued} días…`); };
  return html`<div class="grid">
    <div class="span-4 col">
      <${Stat} k="Días con muestras" v=${s.files} /><${Stat} k="Espacio de muestras" v=${`${n(s.bytes / 1048576, 1)} MB`} />
      <${Stat} k="Días pendientes de analizar" v=${status.dirty} /><${Stat} k="Último análisis" v=${status.analysis.lastRun ? new Date(status.analysis.lastRun * 1000).toLocaleString('es-ES') : '–'} />
      ${status.analysis.lastError && html`<div class="tiny bad">${status.analysis.lastError}</div>`}
    </div>
    <div class="span-4 col">
      <a class="btn" href="/api/export/daily.csv">Exportar métricas diarias (CSV)</a>
      <a class="btn" href="/api/export/samples.csv?days=7">Exportar minuto a minuto, 7 días (CSV)</a>
      <a class="btn" href="/api/export/db">Descargar base de datos completa (SQLite)</a>
      <button class="btn" onClick=${reanalyze}>Recalcular todo el historial</button>
    </div>
    <div class="span-4 col">
      <button class="btn" onClick=${demo} disabled=${!!busy}>${busy === 'demo' ? html`<span class="spinner"></span>` : null}Generar 3 semanas de datos demo</button>
      <div class="tiny faint">Para probar todo antes de que llegue la pulsera. Bórralos antes de empezar a usarla de verdad.</div>
      <div class="row"><input type="text" placeholder="Escribe BORRAR" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} style="flex:1" /><button class="btn danger" disabled=${confirm !== 'BORRAR'} onClick=${wipe}>Borrar todo</button></div>
      <div class="tiny faint">Las copias de seguridad diarias (04:00, 14 días) se guardan en el volumen del servidor.</div>
    </div>
  </div>`;
}
