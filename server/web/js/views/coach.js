import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useApi, useStore, api, toast } from '../core.js';
import { Card, Md, Empty } from '../ui.js';
import { Page } from '../layout.js';
import { Icon } from '../icons.js';

const SUGGESTIONS = [
  '¿Cómo estoy hoy y qué entreno me recomiendas?', 'Analiza mi última semana de sueño', '¿Por qué ha bajado mi VFC?',
  'Ajusta mi sesión de hoy: solo tengo 40 minutos', '¿Estoy progresando en press de banca?', '¿Cómo va mi carga de entrenamiento?',
  'Dame un plan de alimentación para mi objetivo', '¿A qué hora debería acostarme hoy y por qué?', 'Revisa mis medidas y dime cómo voy',
  '¿Qué hábitos me están perjudicando más la recuperación?',
];

export function CoachView() {
  const { status } = useStore();
  const hist = useApi('/chat');
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [stream, setStream] = useState(null);
  const end = useRef(null);
  useEffect(() => { if (hist.data) setMsgs(hist.data); }, [hist.data]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, stream]);

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || stream !== null) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: t, ts: Date.now() / 1000 }]);
    setStream('');
    let full = '';
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.t) { full += ev.t; setStream(full); }
          if (ev.error) throw new Error(ev.error);
        }
      }
      setMsgs((m) => [...m, { role: 'assistant', text: full, ts: Date.now() / 1000 }]);
    } catch (e) {
      toast(e.message, 6000);
      if (full) setMsgs((m) => [...m, { role: 'assistant', text: full }]);
    }
    setStream(null);
  };

  const clear = async () => { await api('/chat', { method: 'DELETE' }); setMsgs([]); };

  return html`<${Page} title="Coach IA" right=${html`<button class="btn small" onClick=${clear}>Nueva conversación</button>`}>
    ${!status?.hasAnthropic && html`<div class="card"><b>Configura tu coach</b><span class="small muted">Pulso usa Claude con tu propia clave de API de Anthropic (pagas solo lo que uses). Créala en console.anthropic.com y pégala en <a href="#/ajustes">Ajustes</a>. El coach ve tus últimos 30 días, entrenos, plan, medidas, diario y mediciones de VFC. También responde por Telegram.</span></div>`}
    <div class="grid">
      <div class="span-8 col">
        <div class="chat">
          ${!msgs.length && stream === null && html`<div class="card"><${Empty} icon="✦" title="Pregúntame lo que quieras">Sobre tus datos, entrenos, sueño, nutrición o cómo encaja todo.<//></div>`}
          ${msgs.map((m) => html`<div class=${`bubble ${m.role === 'user' ? 'user' : ''}`}>${m.role === 'user' ? m.text : html`<${Md} text=${m.text} />`}
            ${m.channel === 'telegram' && html`<div class="tiny faint">vía Telegram</div>`}</div>`)}
          ${stream !== null && html`<div class="bubble">${stream ? html`<${Md} text=${stream} />` : html`<span class="spinner"></span>`}</div>`}
          <div ref=${end}></div>
        </div>
        <div class="chat-input">
          <textarea rows="1" value=${input} placeholder="Escribe al coach…" onInput=${(e) => setInput(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} style="min-height:44px"></textarea>
          <button class="btn primary" onClick=${() => send()} disabled=${!input.trim() || stream !== null || !status?.hasAnthropic} aria-label="Enviar"><${Icon} n="send" /></button>
        </div>
      </div>
      <${Card} span="4" title="Ideas" icon=${html`<${Icon} n="spark" />`}>
        ${SUGGESTIONS.map((s) => html`<button class="chip" style="text-align:left" disabled=${!status?.hasAnthropic || stream !== null} onClick=${() => send(s)}>${s}</button>`)}
        <div class="tiny faint">Modelo: ${status?.settings?.claudeModel}. Cámbialo en Ajustes.</div><//>
    </div>
  <//>`;
}
