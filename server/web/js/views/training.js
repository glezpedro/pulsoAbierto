import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast, store, n, hm, hhmm, C, ZONE_COLORS, todayKey, alpha } from '../core.js';
import { Card, Stat, ChartBox, Seg, Empty, Spinner, Modal, ZoneTable, ZoneBar, timeX, Md } from '../ui.js';
import { Page } from '../layout.js';
import { WorkoutTable } from './load.js';
import { Icon } from '../icons.js';

const GOALS = [['hypertrophy', 'Hipertrofia'], ['strength', 'Fuerza'], ['fatLoss', 'Pérdida de grasa'], ['endurance', 'Resistencia'], ['hybrid', 'Híbrido'], ['health', 'Salud general']];
const LEVELS = [['beginner', 'Principiante'], ['intermediate', 'Intermedio'], ['advanced', 'Avanzado']];
const EQUIP = [['fullGym', 'Gimnasio completo'], ['dumbbells', 'Mancuernas en casa'], ['bodyweight', 'Peso corporal']];
const CARDIO = [['running', 'Correr'], ['cycling', 'Bici'], ['rowing', 'Remo'], ['none', 'Sin cardio']];
const MUSCLES = [['chest', 'Pecho'], ['back', 'Espalda'], ['shoulders', 'Hombros'], ['biceps', 'Bíceps'], ['triceps', 'Tríceps'], ['quads', 'Cuádriceps'], ['hamstrings', 'Isquios'], ['glutes', 'Glúteos'], ['calves', 'Gemelos'], ['core', 'Core']];
const MUSCLE_ES = Object.fromEntries([...MUSCLES, ['fullBody', 'Cuerpo completo'], ['cardio', 'Cardio']]);
const DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function TrainingView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [tab, setTab] = useState(q.get('w') ? 'hist' : 'plan');
  const [sel, setSel] = useState(q.get('w'));
  useEffect(() => { const f = () => { const w = new URLSearchParams(location.hash.split('?')[1] || '').get('w'); if (w) { setSel(w); setTab('hist'); } }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return html`<${Page} title="Entreno" right=${html`<${Seg} value=${tab} onChange=${setTab} options=${[['plan', 'Plan'], ['hist', 'Historial'], ['prog', 'Progreso']]} />`}>
    ${tab === 'plan' && html`<${PlanTab} />`}
    ${tab === 'hist' && html`<${HistoryTab} onOpen=${setSel} />`}
    ${tab === 'prog' && html`<${ProgressTab} />`}
    <${WorkoutModal} uid=${sel} onClose=${() => { setSel(null); if (location.hash.includes('?w=')) history.replaceState(null, '', '#/entreno'); }} />
  <//>`;
}

// ------------------------------------------------------------ plan
function PlanTab() {
  const plans = useApi('/plans');
  const today = useApi('/plan/today');
  const [builder, setBuilder] = useState(false);
  const [week, setWeek] = useState(null);
  const active = plans.data?.find((p) => p.active)?.plan;
  const wi = week ?? (active ? Math.max(0, Math.min(active.weeks.length - 1, Math.floor((Date.now() / 1000 - active.startDate) / (7 * 86400)))) : 0);
  return html`<div class="grid">
    ${!active && html`<${Card} span="12"><${Empty} icon="🏋️" title="Sin plan activo">Genera un plan periodizado según tu objetivo. Cada día se adapta a tu recuperación.<//>
      <button class="btn primary" onClick=${() => setBuilder(true)}><${Icon} n="plus" />Crear plan</button><//>`}
    ${active && html`
      <${Card} span="7" title=${active.name} icon=${html`<${Icon} n=${active.source === 'ia' ? 'spark' : 'dumbbell'} />`} right=${html`<button class="btn small" onClick=${() => setBuilder(true)}><${Icon} n="plus" />Nuevo</button>`}>
        <div class="small muted">${active.summary}</div>
        <div class="small">Inicio ${new Date(active.startDate * 1000).toLocaleDateString('es-ES')} · ${active.weeks.length} semanas</div><//>
      <${Card} span="5" title="Hoy" icon=${html`<${Icon} n="today" />`}><${TodaySession} t=${today.data} /><//>
      <${Card} span="12" title=${`Semana ${wi + 1} · ${active.weeks[wi]?.phase || ''}`} icon=${html`<${Icon} n="today" />`}
        right=${html`<div class="seg">${active.weeks.map((w) => html`<button class=${w.index === wi ? 'on' : ''} onClick=${() => setWeek(w.index)}>${w.index + 1}</button>`)}</div>`}>
        <div class="small muted">${active.weeks[wi]?.focus}</div>
        <div class="grid">${(active.weeks[wi]?.sessions || []).map((s) => html`<div class="card span-4" style="background:var(--panel-2)">
          <div class="row between"><b>${DAYS[s.weekday]}</b><span class="pill blue">strain ${n(s.targetStrain)}</span></div>
          <div><b>${s.title}</b> <span class="small muted">· ~${s.estimatedMinutes} min</span></div>
          ${(s.exercises || []).map((e) => html`<div class="row between small"><span>${e.name}</span><span class="num muted">${e.sets}×${e.reps} · RIR ${e.rir}${e.suggestedKg ? ` · ${n(e.suggestedKg, 1)} kg` : ''}</span></div>`)}
          ${s.cardio && html`<div class="small muted">${s.cardio.description}</div>`}
        </div>`)}</div><//>`}
    ${plans.data?.filter((p) => !p.active).length > 0 && html`<${Card} span="12" title="Planes anteriores">${plans.data.filter((p) => !p.active).map((p) => html`
      <div class="row between" style="padding:6px 0"><span>${p.plan.name} <span class="small muted">· ${new Date(p.created * 1000).toLocaleDateString('es-ES')}</span></span>
      <div class="row"><button class="btn small" onClick=${async () => { await api(`/plans/${p.id}/activate`, { method: 'POST' }); store.bump(); }}>Activar</button>
      <button class="btn small danger" onClick=${async () => { await api(`/plans/${p.id}`, { method: 'DELETE' }); store.bump(); }}>Borrar</button></div></div>`)}<//>`}
    <${PlanBuilder} open=${builder} onClose=${() => setBuilder(false)} />
  </div>`;
}

function TodaySession({ t }) {
  if (!t) return html`<${Spinner} />`;
  if (t.rest) return html`<div class="small muted">Hoy toca descanso. Paseo, movilidad y buen sueño.</div>`;
  if (!t.adapted) return html`<div class="small muted">El plan aún no ha empezado o ya terminó.</div>`;
  const s = t.adapted;
  return html`<div><b>${s.title}</b></div>
    <div class=${`small ${t.band === 'green' ? 'good' : t.band === 'yellow' ? 'warn' : t.band === 'red' ? 'bad' : 'muted'}`}>${t.note}</div>
    ${(s.exercises || []).map((e) => html`<div class="col" style="gap:2px;padding:6px 0;border-bottom:1px solid var(--line)">
      <div class="row between"><b class="small">${e.name}</b><span class="num" style=${{ color: C.accent }}>${e.sets}×${e.reps}</span></div>
      <div class="tiny muted">RIR ${e.rir} · descanso ${Math.floor(e.restSeconds / 60)}:${String(e.restSeconds % 60).padStart(2, '0')}${e.suggestedKg ? ` · ~${n(e.suggestedKg, 1)} kg` : ''}${e.notes ? ` · ${e.notes}` : ''}</div></div>`)}
    ${s.cardio && html`<div class="small">${s.cardio.description}</div>`}
    <a class="btn small" href="#/directo">Empezar con FC en directo</a>`;
}

function PlanBuilder({ open, onClose }) {
  const { status } = useStore();
  const [req, setReq] = useState({ goal: 'hypertrophy', daysPerWeek: 4, sessionMinutes: 60, experience: 'intermediate', equipment: 'fullGym', weeks: 8, cardio: 'running', priorityMuscles: [], notes: '' });
  const [ai, setAi] = useState(false);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const up = (k, v) => setReq({ ...req, [k]: v });
  const gen = async () => {
    setBusy(true); setPreview(null);
    try { setPreview(await api('/plans/generate', { json: { request: req, ai, extra } })); } catch (e) { toast(e.message, 6000); }
    setBusy(false);
  };
  const save = async () => { await api('/plans', { json: preview }); toast('Plan activado'); store.bump(); onClose(); };
  const sel = (k, opts) => html`<select value=${req[k]} onChange=${(e) => up(k, e.target.value)}>${opts.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>`;
  return html`<${Modal} open=${open} onClose=${onClose} title="Nuevo plan de entrenamiento">
    <div class="form-grid">
      <div class="field"><label>Objetivo</label>${sel('goal', GOALS)}</div>
      <div class="field"><label>Nivel</label>${sel('experience', LEVELS)}</div>
      <div class="field"><label>Material</label>${sel('equipment', EQUIP)}</div>
      <div class="field"><label>Cardio</label>${sel('cardio', CARDIO)}</div>
      <div class="field"><label>Días/semana: ${req.daysPerWeek}</label><input type="range" min="2" max="6" value=${req.daysPerWeek} onInput=${(e) => up('daysPerWeek', +e.target.value)} /></div>
      <div class="field"><label>Minutos/sesión: ${req.sessionMinutes}</label><input type="range" min="30" max="120" step="5" value=${req.sessionMinutes} onInput=${(e) => up('sessionMinutes', +e.target.value)} /></div>
      <div class="field"><label>Semanas: ${req.weeks}</label><input type="range" min="4" max="16" value=${req.weeks} onInput=${(e) => up('weeks', +e.target.value)} /></div>
    </div>
    <div class="field"><label>Músculos prioritarios</label><div class="chips">${MUSCLES.map(([k, l]) => html`<button class=${`chip ${req.priorityMuscles.includes(k) ? 'on' : ''}`}
      onClick=${() => up('priorityMuscles', req.priorityMuscles.includes(k) ? req.priorityMuscles.filter((x) => x !== k) : [...req.priorityMuscles, k])}>${l}</button>`)}</div></div>
    ${status?.hasAnthropic && html`<label class="switch"><span>Generar con IA (usa tus datos, 1RM de Strong y recuperación)</span><input type="checkbox" checked=${ai} onChange=${(e) => setAi(e.target.checked)} /></label>`}
    ${ai && html`<div class="field"><label>Indicaciones extra</label><textarea value=${extra} onInput=${(e) => setExtra(e.target.value)} placeholder="Lesiones, horarios, deportes que practicas…"></textarea></div>`}
    <div class="row"><button class="btn primary" onClick=${gen} disabled=${busy}>${busy ? html`<span class="spinner"></span>` : null}${busy && ai ? 'La IA está diseñando tu plan (1–3 min)…' : 'Generar'}</button></div>
    ${preview && html`<div class="card" style="background:var(--panel-2)"><b>${preview.name}</b><div class="small muted">${preview.summary}</div>
      ${(preview.weeks[0]?.sessions || []).map((s) => html`<div class="small">${DAYS[s.weekday]} · <b>${s.title}</b> — ${(s.exercises || []).map((e) => `${e.name} ${e.sets}×${e.reps}`).join(', ')}${s.cardio ? ` · ${s.cardio.description}` : ''}</div>`)}
      <button class="btn primary" onClick=${save}>Activar este plan</button></div>`}
  <//>`;
}

// ------------------------------------------------------------ history
function HistoryTab({ onOpen }) {
  const [src, setSrc] = useState('');
  const list = useApi(`/workouts?days=365${src ? `&source=${src}` : ''}`, [src]);
  const { status } = useStore();
  const [busy, setBusy] = useState('');
  const upload = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy('strong');
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api('/strong/import', { method: 'POST', body: fd }); toast(`Strong: ${r.added} entrenos nuevos de ${r.total}`); store.bump(); } catch (err) { toast(err.message); }
    setBusy(''); e.target.value = '';
  };
  const stravaImport = async () => { setBusy('strava'); try { const r = await api('/strava/import', { method: 'POST' }); toast(`Strava: ${r.added} nuevas`); store.bump(); } catch (e) { toast(e.message); } setBusy(''); };
  return html`<div class="grid">
    <${Card} span="12">
      <div class="row between">
        <div class="row">
          <label class="btn small">${busy === 'strong' ? html`<span class="spinner"></span>` : html`<${Icon} n="plus" />`}Importar CSV de Strong<input type="file" accept=".csv,text/csv" onChange=${upload} hidden /></label>
          ${status?.strava?.connected && html`<button class="btn small" onClick=${stravaImport} disabled=${!!busy}>${busy === 'strava' ? html`<span class="spinner"></span>` : html`<${Icon} n="sync" />`}Importar Strava</button>`}
          <a class="btn small" href="#/directo"><${Icon} n="live" />Grabar entreno</a>
        </div>
        <select value=${src} onChange=${(e) => setSrc(e.target.value)} style="width:auto">
          <option value="">Todas las fuentes</option><option value="strap">Detectados por la pulsera</option><option value="live">Grabados en directo</option>
          <option value="strong">Strong</option><option value="strava">Strava</option><option value="manual">Manual</option></select>
      </div>
      <div class="tiny faint">Strong: Perfil › Ajustes › Exportar datos de Strong → súbelo aquí, o en el iPhone usa el Atajo «Enviar a Pulso» (instrucciones en <a href="#/ajustes">Ajustes</a>). Se cruza con la FC de la pulsera para calcular el esfuerzo de cada sesión.</div><//>
    <${Card} span="12">${list.data ? html`<${WorkoutTable} list=${list.data} />` : html`<${Spinner} />`}<//>
  </div>`;
}

function WorkoutModal({ uid, onClose }) {
  const w = useApi(uid ? `/workouts/${encodeURIComponent(uid)}` : null, [uid]);
  const { status } = useStore();
  const [busy, setBusy] = useState('');
  if (!uid) return null;
  const d = w.data;
  const act = async (path, method = 'POST', msg) => { setBusy(path); try { await api(`/workouts/${encodeURIComponent(uid)}${path}`, { method }); if (msg) toast(msg); w.reload(); store.bump(); } catch (e) { toast(e.message, 6000); } setBusy(''); };
  const del = async () => { await api(`/workouts/${encodeURIComponent(uid)}`, { method: 'DELETE' }); store.bump(); onClose(); };
  const rename = async () => { const name = prompt('Nombre del entreno', d.name); if (name) { await api(`/workouts/${encodeURIComponent(uid)}`, { method: 'PUT', json: { name } }); w.reload(); } };
  return html`<${Modal} open=${true} onClose=${onClose} title=${d?.name || 'Entreno'}>
    ${!d ? html`<${Spinner} />` : html`
      <div class="row" style="gap:6px"><span class="pill">${d.source}</span><span class="pill">${d.sport}</span>${d.strava_uploaded ? html`<span class="pill" style="color:#fc4c02">Subido a Strava</span>` : null}</div>
      <div class="tiles">
        <div class="tile"><div class="t">Esfuerzo</div><div class="v" style=${{ color: C.strain }}>${n(d.strain, 1)}</div></div>
        <div class="tile"><div class="t">Duración</div><div class="v">${hm((d.end - d.start) / 60)}</div></div>
        <div class="tile"><div class="t">FC media / máx</div><div class="v">${n(d.avg_hr)}/${n(d.max_hr)}</div></div>
        <div class="tile"><div class="t">Calorías</div><div class="v">${n(d.kcal)}</div></div>
        ${d.distance_km ? html`<div class="tile"><div class="t">Distancia</div><div class="v">${n(d.distance_km, 2)}<small>km</small></div></div>` : null}
      </div>
      <div class="small muted">${new Date(d.start * 1000).toLocaleString('es-ES')} → ${hhmm(d.end)}</div>
      ${d.series?.some((p) => p.hr) && html`<${ChartBox} height=${180} deps=${[d.uid]} config=${() => ({
        type: 'line', data: { datasets: [{ data: d.series.map((p) => ({ x: p.t * 1000, y: p.hr })), borderColor: C.hr, pointRadius: 0, borderWidth: 1.6, fill: true, backgroundColor: alpha(C.hr, 0.12), tension: 0.3 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: timeX('minute'), y: { grace: '5%' } } } })} />`}
      ${d.zones?.length > 0 && html`<${ZoneTable} zones=${d.zones} />`}
      ${d.strong && html`<div class="col" style="gap:8px"><b>Series (Strong)</b>${Object.entries(groupSets(d.strong.sets)).map(([ex, sets]) => html`<div>
        <div class="small"><b>${ex}</b></div><div class="small muted num">${sets.map((s) => `${s.setType === 'W' ? 'W ' : ''}${n(s.weightKg, 1)}×${s.reps}${s.rpe ? ` @${s.rpe}` : ''}`).join('  ·  ')}</div></div>`)}
        <div class="small">Volumen total <b>${n(d.strong.sets.filter((s) => s.setType !== 'W').reduce((a, s) => a + s.weightKg * s.reps, 0))} kg</b></div></div>`}
      <div class="row">
        <button class="btn small" onClick=${rename}>Renombrar</button>
        <button class="btn small" disabled=${!!busy} onClick=${() => act('/recompute', 'POST', 'Esfuerzo recalculado')}>Recalcular esfuerzo</button>
        ${status?.strava?.connected && d.source !== 'strava' && html`<button class="btn small" disabled=${!!busy} onClick=${() => act('/strava', 'POST', 'Subido a Strava')}>${busy === '/strava' ? html`<span class="spinner"></span>` : null}Subir a Strava con FC</button>`}
        ${d.strava_id && html`<a class="btn small" href=${`https://www.strava.com/activities/${d.strava_id}`} target="_blank" rel="noopener">Ver en Strava</a>`}
        <button class="btn small danger" onClick=${del}>Eliminar</button>
      </div>`}
  <//>`;
}

function groupSets(sets) { const g = {}; for (const s of sets) (g[s.exercise] ||= []).push(s); return g; }

// ------------------------------------------------------------ progress
function ProgressTab() {
  const st = useApi('/strong/stats');
  const [ex, setEx] = useState(null);
  const d = st.data;
  if (!d) return html`<${Spinner} />`;
  if (!d.progress.length) return html`<div class="card"><${Empty} icon="📈" title="Sin datos de fuerza">Importa tu CSV de Strong en Historial para ver tu progresión, 1RM estimados y volumen por músculo.<//></div>`;
  const cur = d.progress.find((p) => p.exercise === ex) || d.progress[0];
  const pts = cur.points.filter((p) => p.e1RM > 0);
  const first = pts[0]?.e1RM, last = pts[pts.length - 1]?.e1RM;
  const weekly = Object.entries(d.weeklySets).sort((a, b) => b[1] - a[1]);
  return html`<div class="grid">
    <${Card} span="8" title="Progresión (1RM estimado, Epley)" icon=${html`<${Icon} n="trend" />`}
      right=${html`<select value=${cur.exercise} onChange=${(e) => setEx(e.target.value)} style="width:auto;max-width:260px">${d.progress.slice(0, 60).map((p) => html`<option value=${p.exercise}>${p.exercise}</option>`)}</select>`}>
      <${ChartBox} height=${240} deps=${[cur.exercise]} config=${() => ({
        type: 'line', data: { datasets: [
          { label: '1RM est.', data: pts.map((p) => ({ x: p.date * 1000, y: p.e1RM })), borderColor: C.accent, pointRadius: 3, tension: 0.25, yAxisID: 'y' },
          { label: 'Peso máx', data: pts.map((p) => ({ x: p.date * 1000, y: p.topWeight })), borderColor: C.strain, pointRadius: 2, tension: 0.25, yAxisID: 'y' },
          { type: 'bar', label: 'Volumen (kg)', data: cur.points.map((p) => ({ x: p.date * 1000, y: p.volume })), backgroundColor: alpha(C.muted, 0.25), yAxisID: 'y2' },
        ] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { x: timeX('week'), y: { grace: '10%' }, y2: { position: 'right', grid: { display: false } } } } })} />
      <div class="row" style="gap:18px"><span class="small">Mejor <b>${n(cur.best, 1)} kg</b></span>
        ${first && last ? html`<span class=${`small ${last >= first ? 'good' : 'bad'}`}>${last >= first ? '+' : ''}${n(((last - first) / first) * 100, 1)} % desde el inicio</span>` : null}
        <span class="small muted">${MUSCLE_ES[cur.muscle] || cur.muscle} · ${cur.points.length} sesiones</span></div><//>
    <${Card} span="4" title="Series por músculo (7 días)" icon=${html`<${Icon} n="body" />`}>
      ${weekly.length ? weekly.map(([m, v]) => html`<div class="row" style="gap:8px"><span class="small" style="width:110px">${MUSCLE_ES[m] || m}</span>
        <div class="bar grow"><i style=${{ width: `${Math.min(100, (v / 22) * 100)}%`, background: v >= 10 && v <= 20 ? C.green : v > 20 ? C.yellow : C.strain }}></i></div><span class="small num" style="width:26px">${v}</span></div>`) : html`<div class="small muted">Sin entrenos esta semana.</div>`}
      <div class="tiny faint">Referencia de hipertrofia: 10–20 series semanales por grupo muscular.</div><//>
    <${Card} span="6" title="Récords personales" icon=${html`<${Icon} n="trophy" />`}>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ejercicio</th><th>1RM est.</th><th>Serie</th><th>Fecha</th></tr></thead><tbody>
        ${d.records.slice(0, 15).map((r) => html`<tr><td>${r.exercise}</td><td style=${{ color: C.yellow, fontWeight: 700 }}>${n(r.e1RM, 1)} kg</td><td>${n(r.weight, 1)}×${r.reps}</td><td class="muted">${new Date(r.date * 1000).toLocaleDateString('es-ES')}</td></tr>`)}
      </tbody></table></div><//>
    <${Card} span="6" title="Volumen semanal" icon=${html`<${Icon} n="report" />`}>
      <${ChartBox} height=${230} deps=${[d.weeklyVolume.length]} config=${() => ({
        type: 'bar', data: { labels: d.weeklyVolume.slice(-20).map((w) => w.week.split('-')[1]), datasets: [{ data: d.weeklyVolume.slice(-20).map((w) => w.kg / 1000), backgroundColor: C.strain, borderRadius: 4 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${n(c.raw, 1)} t` } } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'toneladas' } } } } })} /><//>
  </div>`;
}
