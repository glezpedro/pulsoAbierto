// Bienestar: estrés de hoy, respiración guiada con biofeedback, medición de VFC matinal, hábitos,
// medidas y despertador de la pulsera.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useApi, useStore, n, hm, hhmm, C, useEventTarget } from '../core.js';
import { Card, Spinner } from '../ui.js';
import { Icon } from '../icons.js';
import { SyncButton, SyncProgress } from '../layout.js';
import { strap } from '../ble/strap.js';
import { HRVCheck, Breathe } from './live.js';
import { AlarmControl } from './alarm.js';
import { BarChart } from '../charts.js';

export function BienestarView() {
  useEventTarget(strap);
  const [tab, setTab] = useState('hoy');
  // the breathing and HRV tools need live heart rate through the standard profile
  const live = tab === 'respirar' || tab === 'vfc';
  useEffect(() => { if (live && strap.connected && !strap.s.liveOn) strap.setLive(true).catch(() => {}); }, [live, strap.connected]);
  useEffect(() => { if (!live && strap.connected && strap.s.liveOn) strap.setLive(false).catch(() => {}); }, [live]);
  useEffect(() => () => { if (strap.connected && strap.s.liveOn) strap.setLive(false).catch(() => {}); }, []);
  return html`<div class="page">
    <div class="topbar"><h1>Bienestar</h1></div>
    <div class="pills">${[['hoy', 'Hoy'], ['respirar', 'Respirar'], ['vfc', 'Medir VFC'], ['despertador', 'Despertador']].map(([v, l]) => html`
      <button class=${tab === v ? 'on' : ''} onClick=${() => setTab(v)}>${l}</button>`)}</div>
    <${SyncProgress} />
    ${live && !strap.connected && html`<${SyncButton} big />`}
    ${tab === 'hoy' && html`<${Hoy} go=${setTab} />`}
    ${tab === 'respirar' && html`<${Breathe} />`}
    ${tab === 'vfc' && html`<${HRVCheck} />`}
    ${tab === 'despertador' && html`<div class="grid"><${Card} span="7" title="Despertador en la pulsera" icon=${html`<${Icon} n="alarm" />`} color="var(--orange)"><${AlarmControl} /><//></div>`}
  </div>`;
}

function Hoy({ go }) {
  const { date } = useStore();
  const day = useApi(`/day/${date}`, [date]);
  const spots = useApi('/spot?limit=7');
  const m = day.data?.metrics || {};
  const stress = (day.data?.report?.stress || []).filter((p) => !p.active);
  const items = stress.map((p) => ({ key: p.ts, t: p.ts, label: '', value: p.level, color: p.level >= 2 ? C.red : p.level >= 1 ? C.yellow : C.green }));
  const level = m.avgStress;
  const word = level == null ? '–' : level < 1 ? 'Calma' : level < 2 ? 'Moderado' : 'Alto';
  const lastSpot = spots.data?.[0];
  return html`<div class="grid">
    <section class="card span-7" style="--cat:var(--mind)">
      <div class="card-h"><h2><${Icon} n="mind" /> Estrés de hoy</h2><a class="small" href="#/m/avgStress">Detalle</a></div>
      ${day.loading && !day.data ? html`<${Spinner} />` : html`
        <div class="row between" style="align-items:flex-end"><span class="gt-value">${word}</span><span class="small muted">${level != null ? `${n(level, 1)} de 3 de media` : ''}${m.highStressMin ? ` · ${hm(m.highStressMin)} en nivel alto` : ''}</span></div>
        ${items.length > 1 ? html`<${BarChart} items=${items} height=${120} yMin=${0} yMax=${3} labelEvery=${1e9} />` : html`<div class="small muted">Sin datos de estrés hoy.</div>`}
        <div class="tiny faint">Se estima cuando estás quieto: frecuencia cardiaca por encima de tu reposo y VFC por debajo de tu media. Los ratos con movimiento no cuentan.</div>`}
    </section>
    <div class="span-5 col" style="gap:10px">
      <a class="card well-tile" href="#" onClick=${(e) => { e.preventDefault(); go('respirar'); }} style="--cat:var(--mind)">
        <span class="pr-ic"><${Icon} n="wind" size=${18} /></span><span class="col grow" style="gap:0"><b>Respiración guiada</b><span class="tiny muted">6 respiraciones por minuto, con tu VFC en directo</span></span><${Icon} n="chev" /></a>
      <a class="card well-tile" href="#" onClick=${(e) => { e.preventDefault(); go('vfc'); }} style="--cat:var(--heart)">
        <span class="pr-ic"><${Icon} n="heart" size=${18} /></span><span class="col grow" style="gap:0"><b>Medición de VFC (2 min)</b><span class="tiny muted">${lastSpot ? `Última: ${n(lastSpot.rmssd)} ms · ${new Date(lastSpot.ts * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : 'Cada mañana, para seguir tu adaptación'}</span></span><${Icon} n="chev" /></a>
      <a class="card well-tile" href="#/diario" style="--cat:var(--green)">
        <span class="pr-ic"><${Icon} n="book" size=${18} /></span><span class="col grow" style="gap:0"><b>Diario de hábitos</b><span class="tiny muted">Alcohol, cafeína, pantallas… y cómo te afectan</span></span><${Icon} n="chev" /></a>
      <a class="card well-tile" href="#/cuerpo" style="--cat:var(--body)">
        <span class="pr-ic"><${Icon} n="body" size=${18} /></span><span class="col grow" style="gap:0"><b>Medidas corporales</b><span class="tiny muted">Peso, grasa y perímetros</span></span><${Icon} n="chev" /></a>
      <a class="card well-tile" href="#" onClick=${(e) => { e.preventDefault(); go('despertador'); }} style="--cat:var(--orange)">
        <span class="pr-ic"><${Icon} n="alarm" size=${18} /></span><span class="col grow" style="gap:0"><b>Despertador</b><span class="tiny muted">La pulsera vibra a la hora que elijas</span></span><${Icon} n="chev" /></a>
    </div>
  </div>`;
}
