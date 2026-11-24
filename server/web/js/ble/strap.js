// Web Bluetooth driver for the WHOOP 4.0 (works in Bluefy on iPhone and Chrome on desktop/Android).
import { UUID, TYPE, CMD, EVENTS, FrameAssembler, buildFrame, parse, decodeChunk, encodeSamples, payload, read, parseHeartRate, hex, u32 } from './protocol.js';
import { queue, flush } from './queue.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(msg)), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

export const CONN = {
  unsupported: 'Este navegador no tiene Bluetooth (usa Bluefy en iPhone)',
  idle: 'Sin conectar', choosing: 'Elige tu pulsera…', connecting: 'Conectando…', pairing: 'Emparejando…',
  handshaking: 'Preparando…', ready: 'Conectada', syncing: 'Descargando historial…', uploading: 'Subiendo al servidor…',
  disconnected: 'Desconectada',
};

class Strap extends EventTarget {
  constructor() {
    super();
    this.s = {
      conn: navigator.bluetooth ? 'idle' : 'unsupported', name: null, battery: null, charging: false, worn: null,
      serial: null, firmware: null, clock: null, records: 0, chunks: 0, pending: 0, uploaded: 0, note: '',
      liveHR: null, liveRR: [], liveOn: false, lastSync: Number(localStorage.getItem('pulso.lastSync') || 0) || null,
      error: null, log: [], raw: false, rawCount: 0, syncStarted: null,
      prog: null,   // { firstTs, lastTs, startedAt, pct, etaSec, rate } while downloading history
    };
    this.device = null; this.chars = {}; this.asm = {}; this.seq = 0; this.pending = new Map();
    this.historyFrames = []; this.historyActive = false; this.lastTraffic = 0; this.rawFrames = [];
    this.hrListeners = new Set(); this.wakeLock = null; this.busyWrite = Promise.resolve();
    queue.count().then((n) => this.set({ pending: n })).catch(() => {});
  }

  set(p) { Object.assign(this.s, p); this.dispatchEvent(new Event('change')); }
  log(text, level = 'info') {
    const line = { t: Date.now(), text, level };
    this.s.log = [...this.s.log.slice(-400), line];
    this.dispatchEvent(new Event('change'));
  }
  onHR(fn) { this.hrListeners.add(fn); return () => this.hrListeners.delete(fn); }

  get supported() { return !!navigator.bluetooth; }
  get connected() { return ['handshaking', 'ready', 'syncing', 'uploading'].includes(this.s.conn); }

  // ------------------------------------------------------------ connection
  /** Tap on «Conectar pulsera». Order: reuse the device of this page → the strap already authorised
   *  (it may still be linked to iOS from a previous visit and then does not show in the chooser) →
   *  the chooser. Every step has a timeout so the button can never stay stuck. */
  async connect() {
    if (!navigator.bluetooth) throw new Error(CONN.unsupported);
    this.set({ error: null });
    try {
      if (this.device && !this.skipKnown) {
        await this.openWithTimeout(this.device);
        return;
      }
      if (!this.skipKnown && navigator.bluetooth.getDevices) {
        let known = null;
        try { known = (await navigator.bluetooth.getDevices()).find((d) => d.id === localStorage.getItem('pulso.deviceId')) || null; } catch { /* unsupported */ }
        if (known) { await this.openWithTimeout(known); return; }
      }
      this.skipKnown = false;
      this.set({ conn: 'choosing' });
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUID.service] }, { namePrefix: 'WHOOP' }],
        optionalServices: [UUID.service, 'heart_rate', 'battery_service'],
      });
      localStorage.setItem('pulso.deviceId', device.id);
      await this.openWithTimeout(device);
    } catch (e) {
      const msg = e?.name === 'NotFoundError' ? 'No se eligió ninguna pulsera.' : (e.message || String(e));
      this.fail(msg);
      throw new Error(msg);
    }
  }

  /** Silent reconnect when the page opens (only where the browser implements getDevices()). */
  async autoConnect() {
    if (!navigator.bluetooth?.getDevices || this.connected || this.s.conn !== 'idle') return false;
    try {
      const id = localStorage.getItem('pulso.deviceId');
      const device = (await navigator.bluetooth.getDevices()).find((d) => d.id === id);
      if (!device) return false;
      await this.openWithTimeout(device);
      return true;
    } catch (e) {
      this.log(`Reconexión automática no disponible: ${e.message || e}`, 'warn');
      this.fail(null);
      return false;
    }
  }

  async openWithTimeout(device) {
    this.attach(device);
    await withTimeout(this.open(), 60000, 'La pulsera no respondió a tiempo.');
  }

  attach(device) {
    if (this.device !== device) {
      this.device?.removeEventListener?.('gattserverdisconnected', this.onDiscBound);
      this.device = device;
      this.onDiscBound = this.onDiscBound || (() => this.onDisconnect());
      device.addEventListener('gattserverdisconnected', this.onDiscBound);
    }
  }

  /** Leaves everything ready for a clean retry. `msg` null = silent. */
  fail(msg) {
    try { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); } catch { /* ignore */ }
    for (const [, p] of this.pending) p.resolve(null);
    this.pending.clear();
    this.historyActive = false;
    clearInterval(this.battTimer);
    this.releaseWake();
    // after a failed attempt with the remembered strap, the next tap goes straight to the chooser
    this.skipKnown = true;
    const hint = msg ? `${msg} Pulsa «Conectar pulsera» otra vez. Si la pulsera no aparece en la lista: en el iPhone ve a Ajustes › Bluetooth › WHOOP › ⓘ › Desconectar y vuelve a intentarlo.` : null;
    this.set({ conn: 'idle', error: hint, prog: null, liveOn: false });
    if (msg) this.log(`Error de conexión: ${msg}`, 'error');
  }

  /** Manual reset from the UI («¿Atascado? Reiniciar conexión»). */
  resetConnection() {
    this.fail(null);
    this.skipKnown = false;
    this.log('Conexión reiniciada manualmente.', 'warn');
  }

  async open() {
    this.set({ conn: 'connecting', name: this.device.name || 'WHOOP' });
    const already = this.device.gatt.connected;
    this.log(`${already ? 'Reutilizando la conexión con' : 'Conectando a'} ${this.device.name || 'WHOOP'}…`);
    const server = already ? this.device.gatt : await withTimeout(this.device.gatt.connect(), 15000, 'No se pudo abrir la conexión Bluetooth.');
    this.chars = {}; this.asm = {}; this.busyWrite = Promise.resolve();
    const svc = await withTimeout(server.getPrimaryService(UUID.service), 10000, 'La pulsera no mostró su servicio.');
    for (const [k, u] of Object.entries({ cmdTo: UUID.cmdTo, cmdFrom: UUID.cmdFrom, events: UUID.events, data: UUID.data })) {
      this.chars[k] = await withTimeout(svc.getCharacteristic(u), 8000, 'La pulsera no respondió.');
    }
    try { this.chars.memfault = await svc.getCharacteristic(UUID.memfault); } catch { /* optional */ }
    try {
      const hr = await server.getPrimaryService('heart_rate');
      this.chars.hr = await hr.getCharacteristic('heart_rate_measurement');
    } catch { this.log('Servicio de FC estándar no disponible', 'warn'); }

    // 1) confirmed write → iOS pairing dialog (encrypted characteristic)
    this.set({ conn: 'pairing' });
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await withTimeout(this.rawWrite(buildFrame(TYPE.command, this.nextSeq(), CMD.getBattery, [0])), 10000, 'tiempo agotado');
        break;
      } catch (e) {
        this.log(`Escritura rechazada (${e.message}). Acepta el emparejamiento de iOS… (${attempt}/4)`, 'warn');
        if (attempt === 4) throw new Error('La pulsera no aceptó el emparejamiento. Cierra la app oficial de WHOOP y vuelve a intentarlo.');
        await sleep(3000);
      }
    }
    // 2) notifications
    for (const k of ['cmdFrom', 'events', 'data', 'memfault', 'hr']) {
      const c = this.chars[k];
      if (!c) continue;
      this.asm[k] = new FrameAssembler();
      c.addEventListener('characteristicvaluechanged', (ev) => this.onValue(k, ev.target.value));
      try { await c.startNotifications(); } catch (e) { this.log(`Notificaciones ${k}: ${e.message}`, 'warn'); }
    }
    await this.handshake();
  }

  async handshake() {
    this.set({ conn: 'handshaking' });
    await sleep(500);
    const hello = await this.send(CMD.getHello);
    if (hello) this.set({ serial: read.serial(hello) });
    const nm = await this.send(CMD.getAdvName);
    if (nm) this.set({ name: read.name(nm) || this.s.name });
    const v = await this.send(CMD.reportVersion);
    if (v) this.set({ firmware: read.versions(v) });
    const sc = await this.send(CMD.setClock, payload.setClock());   // the strap clock ships unset
    const gc = await this.send(CMD.getClock);
    if (gc) this.set({ clock: read.clock(gc) });
    this.log(`Reloj ajustado (res ${sc?.result ?? '?'}) → ${this.s.clock?.toLocaleString() ?? '?'}`);
    await this.send(CMD.rawRealtime, [0]);
    await this.send(CMD.getDataRange);
    const b = await this.send(CMD.getBattery);
    if (b) this.set({ battery: read.battery(b) });
    this.set({ conn: 'ready' });
    this.postDevice();
    // Battery readings every 60 s while connected: they feed the time-left / time-to-full estimates.
    clearInterval(this.battTimer);
    this.battTimer = setInterval(() => { if (this.connected && !this.historyActive) this.refreshBattery().catch(() => {}); }, 60000);
    await sleep(800);
    await this.syncHistory();
  }

  onDisconnect() {
    this.log('Desconectada', 'warn');
    for (const [, p] of this.pending) p.resolve(null);
    this.pending.clear();
    const wasSync = this.historyActive;
    this.historyActive = false;
    clearInterval(this.battTimer);
    this.releaseWake();
    this.set({ conn: 'disconnected', liveOn: false, liveHR: null });
    if (wasSync) this.upload();
  }

  disconnect() { try { this.device?.gatt?.disconnect(); } catch { /* ignore */ } }

  async forget() {
    this.disconnect();
    localStorage.removeItem('pulso.deviceId');
    try { await this.device?.forget?.(); } catch { /* ignore */ }
    this.device = null;
    this.set({ conn: 'idle', serial: null, firmware: null });
  }

  // ------------------------------------------------------------ IO
  nextSeq() { this.seq = (this.seq + 1) & 0xff || 1; return this.seq; }

  rawWrite(frame) {
    const c = this.chars.cmdTo;
    const op = () => (c.writeValueWithResponse ? c.writeValueWithResponse(frame) : c.writeValue(frame));
    this.busyWrite = this.busyWrite.then(op, op);
    return this.busyWrite;
  }

  async send(cmd, pl = [0], timeout = 4000) {
    if (!this.chars.cmdTo) return null;
    const s = this.nextSeq();
    const frame = buildFrame(TYPE.command, s, cmd, pl);
    this.log(`→ cmd ${cmd} ${hex(pl)}`, 'tx');
    const p = new Promise((resolve) => {
      const timer = setTimeout(() => { if (this.pending.get(s)) { this.pending.delete(s); resolve(null); } }, timeout);
      this.pending.set(s, { cmd, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
    try { await this.rawWrite(frame); } catch (e) { this.log(`Escritura fallida: ${e.message}`, 'error'); this.pending.get(s)?.resolve(null); this.pending.delete(s); }
    return p;
  }

  onValue(k, dv) {
    const bytes = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
    if (k === 'hr') {
      const hr = parseHeartRate(bytes);
      if (hr) this.liveTick(hr.bpm, hr.rr);
      return;
    }
    if (this.s.raw) { this.rawFrames.push(`${Math.floor(Date.now() / 1000)},${k},${hex(bytes)}`); this.s.rawCount = this.rawFrames.length; }
    for (const f of this.asm[k].push(bytes)) this.onFrame(f);
  }

  liveTick(bpm, rr) {
    this.s.liveHR = bpm;
    if (rr.length) this.s.liveRR = rr;
    for (const fn of this.hrListeners) fn(bpm, rr);
    this.dispatchEvent(new Event('change'));
  }

  onFrame(f) {
    const m = parse(f);
    switch (m.kind) {
      case 'response': {
        this.log(`← resp cmd ${m.cmd} res ${m.result}`, 'rx');
        let p = this.pending.get(m.seq);
        let key = m.seq;
        if (!p && this.pending.size === 1) { key = [...this.pending.keys()][0]; p = this.pending.get(key); }
        if (p) { this.pending.delete(key); p.resolve(m); }
        break;
      }
      case 'event': this.onEvent(m); break;
      case 'meta':
        this.lastTraffic = Date.now();
        if (!this.historyActive && this.cancelledAt && Date.now() - this.cancelledAt < 10000) break;
        if (m.meta === 1) this.historyFrames = [];
        else if (m.meta === 2) { const frames = this.historyFrames; this.historyFrames = []; this.commit(frames, m.ack); }
        else if (m.meta === 3) this.finishHistory();
        break;
      case 'history':
        if (!this.historyActive && this.cancelledAt && Date.now() - this.cancelledAt < 10000) break;  // tail after a cancel: not acked, stays on the strap
        this.lastTraffic = Date.now();
        if (!this.historyActive) { this.historyActive = true; this.set({ conn: 'syncing' }); }
        this.historyFrames.push(m.raw);
        this.s.records++;
        this.track(m.raw);
        if (this.s.records % 100 === 0) this.dispatchEvent(new Event('change'));
        break;
      case 'realtime': this.liveTick(m.bpm, m.rr); break;
      case 'unknown': this.log(`Trama tipo ${m.type} (${m.len} B) sin decodificar`, 'warn'); break;
      default: break;
    }
  }

  onEvent(e) {
    const label = EVENTS[e.code] || `Evento ${e.code}`;
    this.log(`Evento: ${label}`, 'rx');
    const p = {};
    if (e.code === 3 && e.battery != null) { p.battery = e.battery; p.charging = e.charging; if (e.mv) p.mv = e.mv; }
    if (e.code === 7) p.charging = true;
    if (e.code === 8) p.charging = false;
    if (e.code === 9) p.worn = true;
    if (e.code === 10) p.worn = false;
    if (e.code === 33) p.liveOn = true;
    if (e.code === 34) p.liveOn = false;
    if (Object.keys(p).length) { this.set(p); this.postDevice(); }
    if ([7, 8, 9, 10, 13, 14, 57].includes(e.code)) queue.putEvent({ ts: Math.floor(Date.now() / 1000), code: e.code, label }).catch(() => {});
    this.dispatchEvent(new CustomEvent('strapevent', { detail: e }));
  }

  // ------------------------------------------------------------ history
  /** Progress from record timestamps: records are chronological, one per second, so the share of the
   *  span [first record … now] already received is the share of the download done. */
  track(raw) {
    const ts = u32(raw, 11);
    const nowS = Date.now() / 1000;
    if (!ts || ts < 1.5e9 || ts > nowS + 86400) return;
    const p = this.s.prog || { firstTs: ts, lastTs: ts, startedAt: Date.now() };
    p.firstTs = Math.min(p.firstTs, ts);
    p.lastTs = Math.max(p.lastTs, ts);
    const span = Math.max(1, nowS - p.firstTs);
    p.pct = Math.max(0, Math.min(99.5, ((p.lastTs - p.firstTs) / span) * 100));
    const el = (Date.now() - p.startedAt) / 1000;
    p.rate = el > 3 ? (p.lastTs - p.firstTs) / el : null;          // seconds of data per real second
    p.etaSec = p.rate ? Math.max(0, (nowS - p.lastTs) / p.rate) : null;
    this.s.prog = p;
  }

  /** Stops the download safely: the strap is told to abort, the chunk in progress is NOT acknowledged
   *  (so it stays on the strap for next time) and everything already acknowledged is kept and uploaded. */
  async cancelSync() {
    if (!this.historyActive) return;
    this.cancelledAt = Date.now();
    this.historyActive = false;
    this.historyFrames = [];
    this.releaseWake();
    this.log('Sincronización cancelada por el usuario: el bloque en curso se queda en la pulsera.', 'warn');
    this.set({ conn: this.device?.gatt?.connected ? 'ready' : 'disconnected', prog: null });
    try { await this.send(CMD.abortHistory, [0], 2500); } catch { /* ignore */ }
    this.upload();
  }

  async syncHistory() {
    if (!this.connected || this.historyActive) return;
    this.historyActive = true;
    this.cancelledAt = null;
    this.set({ conn: 'syncing', records: 0, chunks: 0, syncStarted: Date.now(), error: null, prog: null });
    this.lastTraffic = Date.now();
    this.acquireWake();
    this.log('Iniciando descarga de historial…');
    await this.send(CMD.sendHistory, [0]);
    const watchdog = setInterval(async () => {
      if (!this.historyActive) { clearInterval(watchdog); return; }
      if (Date.now() - this.lastTraffic > 45000) {
        clearInterval(watchdog);
        this.log('Historial inactivo 45 s: se da por terminado', 'warn');
        await this.send(CMD.abortHistory, [0]);
        this.finishHistory();
      }
    }, 5000);
  }

  async commit(frames, ack) {
    const { samples, note } = decodeChunk(frames);
    try {
      if (samples.length) {
        await queue.putChunk(encodeSamples(samples), { first: samples[0].ts, last: samples[samples.length - 1].ts, note });
      }
    } catch (e) {
      this.log(`No se pudo guardar el bloque en el móvil (${e.message}): NO se confirma`, 'error');
      return;
    }
    if (ack) {
      const r = await this.send(CMD.historyResult, payload.ack(ack));
      this.s.chunks++;
      this.log(`Bloque confirmado: ${samples.length} reg (${note}) res ${r?.result ?? '?'}`);
    }
    queue.count().then((n) => this.set({ pending: n, note: note || this.s.note }));
    this.upload();
  }

  finishHistory() {
    if (!this.historyActive) return;
    this.historyActive = false;
    const now = Date.now();
    localStorage.setItem('pulso.lastSync', String(now));
    this.set({ conn: this.device?.gatt?.connected ? 'ready' : 'disconnected', lastSync: now, prog: null });
    this.log(`Descarga completa: ${this.s.records} registros en ${Math.round((now - (this.s.syncStarted || now)) / 1000)} s`);
    this.releaseWake();
    this.upload();
  }

  async upload() {
    try {
      const n = await flush((t) => this.set({ uploaded: t }));
      const pending = await queue.count();
      this.set({ pending });
      if (n) this.log(`Subidos ${n} registros al servidor`);
      this.dispatchEvent(new Event('uploaded'));
    } catch (e) {
      const pending = await queue.count().catch(() => this.s.pending);
      this.set({ pending, error: `Sin conexión con el servidor: ${e.message}. Los datos quedan guardados en el móvil.` });
    }
  }

  postDevice() {
    const s = this.s;
    fetch('/api/device', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ battery: s.battery, charging: s.charging, mv: s.mv, worn: s.worn, serial: s.serial, firmware: s.firmware, name: s.name, clock: s.clock ? Math.floor(s.clock / 1000) : null }) }).catch(() => {});
  }

  // ------------------------------------------------------------ actions
  async setLive(on) { await this.send(CMD.toggleGenericHR, [on ? 1 : 0]); this.set({ liveOn: on }); if (!on) this.set({ liveHR: null }); }
  async buzz() { await this.send(CMD.runHaptics, payload.haptics()); await this.send(CMD.runAlarm, [1]); }
  async setAlarm(date) { const r = await this.send(CMD.setAlarm, payload.alarm(date)); return r?.result === 1; }
  async disableAlarm() { await this.send(CMD.disableAlarm, [1]); }
  async refreshBattery() {
    const b = await this.send(CMD.getBattery);
    const v = b ? read.battery(b) : null;
    if (v != null) { this.set({ battery: v }); this.postDevice(); this.dispatchEvent(new Event('battery')); }
    return v;
  }
  async reboot() { await this.send(CMD.reboot, [0]); }

  setRaw(on) { this.set({ raw: on }); if (!on) { this.rawFrames = []; this.set({ rawCount: 0 }); } }
  rawCSV() { return 'unix,char,hex\n' + this.rawFrames.join('\n'); }
  logText() { return this.s.log.map((l) => `${new Date(l.t).toISOString()} [${l.level}] ${l.text}`).join('\n'); }

  async acquireWake() { try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ } }
  releaseWake() { try { this.wakeLock?.release(); } catch { /* ignore */ } this.wakeLock = null; }
}

export const strap = new Strap();

// Al salir de la página se suelta la conexión para que la próxima visita pueda conectar sin bloqueo.
window.addEventListener('pagehide', () => { if (strap.device?.gatt?.connected) { try { strap.device.gatt.disconnect(); } catch { /* ignore */ } } });
// Al volver a la app: si el enlace murió mientras estaba en segundo plano, reflejarlo.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && strap.device && !strap.device.gatt?.connected && strap.connected) strap.onDisconnect();
});
// Vigilante: ningún estado de conexión puede quedarse colgado más de 75 s.
let stuckSince = 0;
setInterval(() => {
  const busy = ['connecting', 'pairing', 'handshaking'].includes(strap.s.conn);
  if (!busy) { stuckSince = 0; return; }
  stuckSince = stuckSince || Date.now();
  if (Date.now() - stuckSince > 75000) { stuckSince = 0; strap.fail('La conexión se quedó atascada.'); }
}, 5000);
