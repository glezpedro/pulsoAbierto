import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast, store, n, todayKey, addDays, C } from '../core.js';
import { Card, Empty } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';

export function JournalView() {
  const [day, setDay] = useState(todayKey());
  const qs = useApi('/journal/questions');
  const entries = useApi('/journal?days=400');
  const impact = useApi('/journal/impact');
  const entry = (entries.data || []).find((e) => e.day === day);
  const [ans, setAns] = useState({});
  const [notes, setNotes] = useState('');
  useEffect(() => { setAns(entry?.answers || {}); setNotes(entry?.notes || ''); }, [day, entries.data]);
  const save = async (a = ans, nt = notes) => { try { await api(`/journal/${day}`, { method: 'PUT', json: { answers: a, notes: nt } }); } catch (e) { toast(e.message); } };
  const toggle = (k) => { const a = { ...ans, [k]: ans[k] ? 0 : 1 }; setAns(a); save(a); };
  return html`<${Page} title="Diario de hábitos">
    <div class="grid">
      <${Card} span="7" title="¿Qué hiciste?" icon=${html`<${Icon} n="book" />`} right=${html`<div class="row" style="gap:6px">
        <button class="btn small" onClick=${() => setDay(addDays(day, -1))}><${Icon} n="chevl" /></button>
        <input type="date" value=${day} max=${todayKey()} onChange=${(e) => e.target.value && setDay(e.target.value)} style="width:auto" />
        <button class="btn small" disabled=${day >= todayKey()} onClick=${() => setDay(addDays(day, 1))}><${Icon} n="chev" /></button></div>`}>
        <div class="small muted">Marca lo que hiciste ese día. Pulso lo cruza con tu recuperación de la mañana siguiente para descubrir qué te sienta bien y qué no.</div>
        <div class="chips">${(qs.data || []).map((q) => html`<button class=${`chip ${ans[q.key] ? 'on' : ''}`} onClick=${() => toggle(q.key)} title=${q.text}>${q.text}</button>`)}</div>
        <textarea placeholder="Notas: cómo te sentiste, comidas, molestias…" value=${notes} onInput=${(e) => setNotes(e.target.value)} onBlur=${() => save()}></textarea><//>
      <${Card} span="5" title="Impacto en tu recuperación" icon=${html`<${Icon} n="trend" />`}>
        ${impact.data?.length ? impact.data.map((x) => html`<div class="col" style="gap:3px">
          <div class="row between small"><span>${x.label}</span><span class=${`num ${x.delta >= 0 ? 'good' : 'bad'}`}><b>${x.delta > 0 ? '+' : ''}${n(x.delta)} %</b> <span class="muted">(${x.n} días)</span></span></div>
          <div style="position:relative;height:6px;background:var(--panel-2);border-radius:99px"><div style=${{ position: 'absolute', top: 0, bottom: 0, borderRadius: '99px', background: x.delta >= 0 ? C.green : C.red, left: x.delta >= 0 ? '50%' : `${50 + Math.max(-50, x.delta * 2)}%`, width: `${Math.min(50, Math.abs(x.delta) * 2)}%` }}></div></div></div>`)
          : html`<${Empty} icon="📓" title="Aún sin conclusiones">Con al menos 3 días con y 3 sin cada hábito verás aquí su efecto real en tu recuperación.<//>`}
        <div class="tiny faint">Diferencia media de recuperación al día siguiente entre los días con y sin el hábito. Es una asociación, no prueba causa.</div><//>
      <${Card} span="12" title="Últimos días" icon=${html`<${Icon} n="today" />`}>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Día</th><th>Hábitos</th><th>Notas</th></tr></thead><tbody>
          ${(entries.data || []).slice(0, 21).map((e) => html`<tr style="cursor:pointer" onClick=${() => setDay(e.day)}><td>${e.day}</td>
            <td style="white-space:normal">${(qs.data || []).filter((q) => e.answers[q.key]).map((q) => q.short).join(', ') || '–'}</td><td class="muted" style="white-space:normal">${e.notes}</td></tr>`)}
        </tbody></table></div><//>
    </div>
  <//>`;
}
