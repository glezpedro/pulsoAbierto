import { html, useState } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast, store, n, C } from '../core.js';
import { Card, Stat, ChartBox, Empty, timeX, Tile } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';

const FIELDS = [['weight_kg', 'Peso', 'kg'], ['body_fat', '% Grasa', '%'], ['waist', 'Cintura', 'cm'], ['chest', 'Pecho', 'cm'], ['hips', 'Cadera', 'cm'],
  ['neck', 'Cuello', 'cm'], ['arm', 'Brazo', 'cm'], ['thigh', 'Muslo', 'cm'], ['calf', 'Gemelo', 'cm']];

export function BodyView() {
  const { status } = useStore();
  const list = useApi('/body');
  const [field, setField] = useState('weight_kg');
  const [form, setForm] = useState({});
  const p = status?.profile || {};
  const items = list.data || [];
  const latest = (k) => items.find((x) => x[k] != null)?.[k];
  const w = latest('weight_kg') ?? p.weightKg, h = p.heightCm || 178;
  const navy = (() => {
    const waist = latest('waist'), neck = latest('neck'), hips = latest('hips');
    if (!waist || !neck || waist <= neck) return null;
    if (p.sex !== 'female') return 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
    if (!hips) return null;
    return 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.221 * Math.log10(h)) - 450;
  })();
  const bf = latest('body_fat') ?? navy;
  const lean = bf != null && w ? w * (1 - bf / 100) : null;
  const save = async () => {
    const body = { date: Math.floor(new Date(form.date || Date.now()).getTime() / 1000), notes: form.notes || '' };
    for (const [k] of FIELDS) if (form[k]) body[k] = parseFloat(String(form[k]).replace(',', '.'));
    try { await api('/body', { json: body }); setForm({}); toast('Medición guardada'); store.bump(); } catch (e) { toast(e.message); }
  };
  const pts = items.filter((x) => x[field] != null).map((x) => ({ x: x.date * 1000, y: x[field] })).reverse();
  const F = FIELDS.find((f) => f[0] === field);
  return html`<${Page} title="Medidas corporales">
    <div class="grid">
      <${Card} span="12" title="Composición" icon=${html`<${Icon} n="body" />`}>
        <div class="tiles">
          <${Tile} t="Peso" v=${n(w, 1)} unit="kg" />
          <${Tile} t="IMC" v=${n(w / (h / 100) ** 2, 1)} />
          <${Tile} t="% Grasa" v=${n(bf, 1)} unit="%" color=${C.yellow} d=${latest('body_fat') == null && navy != null ? 'estimado (Marina EE. UU.)' : null} />
          <${Tile} t="Masa magra" v=${n(lean, 1)} unit="kg" color=${C.green} />
          <${Tile} t="FFMI" v=${lean ? n(lean / (h / 100) ** 2 + 6.1 * (1.8 - h / 100), 1) : '–'} color=${C.strain} />
          <${Tile} t="Metabolismo basal" v=${n(status?.bmr)} unit="kcal" color=${C.orange} />
          <${Tile} t="Cintura / altura" v=${latest('waist') ? n(latest('waist') / h, 2) : '–'} d=${latest('waist') ? (latest('waist') / h < 0.5 ? 'saludable (< 0,5)' : 'por encima de 0,5') : null} good=${latest('waist') ? latest('waist') / h < 0.5 : null} />
        </div><//>
      <${Card} span="7" title="Evolución" icon=${html`<${Icon} n="trend" />`} right=${html`<select value=${field} onChange=${(e) => setField(e.target.value)} style="width:auto">${FIELDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}>
        ${pts.length >= 2 ? html`<${ChartBox} height=${230} deps=${[field, pts.length]} config=${() => ({ type: 'line', data: { datasets: [{ data: pts, borderColor: C.accent, pointRadius: 4, tension: 0.25 }] },
          options: { plugins: { legend: { display: false } }, scales: { x: timeX('week'), y: { grace: '10%' } } } })} />
          <div class="small">${n(pts[pts.length - 1].y - pts[0].y, 1)} ${F[2]} desde ${new Date(pts[0].x).toLocaleDateString('es-ES')}</div>` : html`<div class="small muted">Añade al menos dos registros.</div>`}<//>
      <${Card} span="5" title="Nueva medición" icon=${html`<${Icon} n="plus" />`}>
        <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
          <div class="field" style="grid-column:1/-1"><label>Fecha</label><input type="date" value=${form.date || ''} onChange=${(e) => setForm({ ...form, date: e.target.value })} /></div>
          ${FIELDS.map(([k, l, u]) => html`<div class="field"><label>${l} (${u})</label><input type="number" step="0.1" inputmode="decimal" value=${form[k] || ''} onInput=${(e) => setForm({ ...form, [k]: e.target.value })} /></div>`)}
        </div>
        <input type="text" placeholder="Notas" value=${form.notes || ''} onInput=${(e) => setForm({ ...form, notes: e.target.value })} />
        <button class="btn primary" onClick=${save}>Guardar</button>
        <div class="tiny faint">El peso también llega solo desde Apple Salud con el Atajo (Ajustes › Apple Salud).</div><//>
      <${Card} span="12" title="Registros" icon=${html`<${Icon} n="report" />`}>
        ${items.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th>${FIELDS.map(([, l]) => html`<th>${l}</th>`)}<th>Notas</th><th></th></tr></thead><tbody>
          ${items.map((x) => html`<tr><td>${new Date(x.date * 1000).toLocaleDateString('es-ES')}</td>${FIELDS.map(([k]) => html`<td>${n(x[k], 1)}</td>`)}<td class="muted">${x.notes}</td>
          <td><button class="btn small danger" onClick=${async () => { await api(`/body/${x.id}`, { method: 'DELETE' }); store.bump(); }}>✕</button></td></tr>`)}
        </tbody></table></div>` : html`<${Empty} title="Sin registros" />`}<//>
    </div>
  <//>`;
}
