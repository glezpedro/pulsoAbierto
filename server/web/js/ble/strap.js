// Web Bluetooth driver for the WHOOP 4.0 (works in Bluefy on iPhone and Chrome on desktop/Android).
//
// History download rules (nothing may be lost):
//  1. Every chunk is stored RAW (all its frames, byte for byte) on the phone before it is parsed.
//  2. A chunk is acknowledged to the strap — which then frees that memory — only when it has ≥ 1 valid
//     record AND it is stored on the phone AND the server has saved the raw chunk and its records.
//  3. Anything else (0 valid records, phone storage error, server unreachable, server stored nothing)
//     stops the download WITHOUT acknowledging: the chunk stays on the strap and is logged in detail.
//  4. The strap clock is read and, if wrong, set BEFORE asking for the history. If it was wrong, the
//     measured offset is used to fix the timestamps of the records written with that wrong clock.
import { UUID, TYPE, CMD, EVENTS, FrameAssembler, buildFrame, parse, decodeChunk, encodeSamples, payload, read, parseHeartRate,
  hex, u32, packFrames, splitFrames, describeFrame, logText, TS_MIN } from './protocol.js';
import { queue, flush, uploadChunk } from './queue.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(msg)), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
const nowS = () => Date.now() / 1000;
const fmtTs = (ts) => (ts == null ? '?' : `${new Date(ts * 1000).toLocaleString('es-ES')} (${ts})`);
const CLOCK_TOLERANCE = 60;          // seconds of drift accepted without setting the clock
const MAX_FRAMES_PER_CHUNK = 5000;   // safety cap for non-history frames kept for diagnosis

export const CONN = {
  unsupported: 'Este navegador no tiene Bluetooth (usa Bluefy en iPhone)',
  idle: 'Sin conectar', choosing: 'Elige tu pulsera…', connecting: 'Conectando…', pairing: 'Emparejando…',
  handshaking: 'Preparando…', ready: 'Conectada', syncing: 'Descargando historial…', uploading: 'Subiendo al servidor…',
  disconnected: 'Desconectada',
};

/** What to do when the connection fails (iOS only offers «Omitir», which breaks the bond). */
export const CONNECT_HELP = 'Cierra Bluefy, apaga y enciende el Bluetooth en Ajustes y vuelve a intentarlo. NO pulses «Omitir».';
/** How to put the strap back in pairing mode when the bond was lost. */
export const REPAIR_HELP = 'Quítatela, pon el sensor hacia arriba y da toques firmes unos 30 s hasta que la luz parpadee en azul; luego pulsa Conectar.';

class Strap extends EventTarget {
  constructor() {
    super();
    this.s = {
      conn: navigator.bluetooth ? 'idle' : 'unsupported', name: null, battery: null, charging: false, worn: null, mv: null,
      serial: null, firmware: null,
      clock: null, clockOk: null, clockDrift: null, clockRaw: null, clockBefore: null,
      received: 0,      // history frames received in this download
      records: 0,       // records the SERVER stored in this download (the real number)
      discarded: 0,     // records the server discarded (second-hand filter…), they stay in the raw chunks
      chunks: 0,        // chunks acknowledged to the strap
      unconfirmed: 0,   // chunks NOT acknowledged (they stay on the strap)
      pending: 0, uploaded: 0, note: '',
      liveHR: null, liveRR: [], liveOn: false, lastSync: Number(localStorage.getItem('pulso.lastSync') || 0) || null,
      error: null, log: [], raw: false, rawCount: 0, syncStarted: null,
      prog: null,   // { firstTs, lastTs, startedAt, pct, etaSec, rate } while downloading history
    };
    this.device = null; this.chars = {}; this.asm = {}; this.seq = 0; this.pending = new Map();
    this.chunk = null; this.historyActive = false; this.stopping = false; this.lastTraffic = 0; this.rawFrames = [];
    this.commitChain = Promise.resolve();
    this.hrListeners = new Set(); this.wakeLock = null; this.busyWrite = Promise.resolve();
    queue.count().then((n) => this.set({ pending: n })).catch(() => {});
  }

  set(p) { Object.assign(this.s, p); this.dispatchEvent(new Event('change')); }
  log(text, level = 'info') {
    const line = { t: Date.now(), text, level };
    this.s.log = [...this.s.log.slice(-600), line];
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
    if (!navigator.bluetooth || this.connected || this.s.conn !== 'idle') return false;
    try {
      // same page session (back from the background): the device object is still valid
      let device = this.device || null;
      if (!device && navigator.bluetooth.getDevices) {
        const id = localStorage.getItem('pulso.deviceId');
        device = (await navigator.bluetooth.getDevices()).find((d) => d.id === id) || null;
      }
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
    await withTimeout(this.open(), 90000, 'La pulsera no respondió a tiempo.');
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
    this.chunk = null;
    clearInterval(this.battTimer);
    this.releaseWake();
    // after a failed attempt with the remembered strap, the next tap goes straight to the chooser
    this.skipKnown = true;
    this.set({ conn: 'idle', error: msg ? `${msg} ${CONNECT_HELP}` : null, prog: null, liveOn: false });
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
      if (!c.__pulso) { c.addEventListener('characteristicvaluechanged', (ev) => this.onValue(k, ev.target.value)); c.__pulso = true; }
      try { await c.startNotifications(); } catch (e) { this.log(`Notificaciones ${k}: ${e.message}`, k === 'data' ? 'error' : 'warn'); }
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
    await this.syncClock();            // BEFORE the history: records must carry the right time
    await this.send(CMD.rawRealtime, [0]);
    const range = await this.send(CMD.getDataRange);
    if (range) this.log(`Rango de datos en la pulsera: ${hex(range.body)}`);
    const b = await this.send(CMD.getBattery);
    const lvl = b ? read.battery(b) : null;
    if (lvl != null) { this.set({ battery: lvl }); this.postBattery({ battery: lvl, charging: this.s.charging, mv: null, source: 'lectura' }); }
    await this.readAlarm();
    this.set({ conn: 'ready' });
    this.postDevice();
    // Battery readings every 60 s while connected: they feed the time-left / time-to-full estimates.
    clearInterval(this.battTimer);
    this.battTimer = setInterval(() => { if (this.connected && !this.historyActive) this.refreshBattery().catch(() => {}); }, 60000);
    await sleep(800);
    await this.syncHistory();
  }

  // ------------------------------------------------------------ strap clock
  clockFixes() {
    try { return JSON.parse(localStorage.getItem('pulso.clockFixes') || '[]'); } catch { return []; }
  }
  addClockFix(fix) {
    const list = this.clockFixes().filter((f) => Math.abs(f.offset - fix.offset) > 120);
    list.unshift(fix);
    localStorage.setItem('pulso.clockFixes', JSON.stringify(list.slice(0, 6)));
    const h = Math.abs(fix.offset) / 3600;
    const by = h >= 48 ? `${Math.round(h / 24).toLocaleString('es-ES')} días` : h >= 1 ? `${Math.round(h)} h` : `${Math.round(Math.abs(fix.offset) / 60)} min`;
    this.log(`La pulsera tenía la hora mal (marcaba ${fmtTs(fix.strapAt)}): los registros grabados con esa hora se corrigen ${by}${fix.offset < 0 ? ' hacia atrás' : ''}.`, 'warn');
  }

  /** Reads the strap clock; if it is unreadable, invalid or more than CLOCK_TOLERANCE s off, sets it and
   *  reads it back. The byte offset of the clock in the GET_CLOCK reply (undocumented) is learnt from the
   *  reading that matches the phone right after SET_CLOCK. Returns true when the clock is verified. */
  async syncClock() {
    let byte = localStorage.getItem('pulso.clockByte');
    byte = byte == null ? null : Number(byte);
    const t0 = nowS();
    const before = await this.send(CMD.getClock);
    if (before && byte == null) {
      const o = read.clockOffsetNear(before, t0, CLOCK_TOLERANCE);
      if (o != null) { byte = o; localStorage.setItem('pulso.clockByte', String(o)); }
    }
    let strapBefore = before ? read.clockAt(before, byte) : null;
    const okBefore = strapBefore != null && Math.abs(strapBefore - t0) <= CLOCK_TOLERANCE;
    this.log(`Reloj de la pulsera al conectar: ${before ? `${byte != null ? fmtTs(strapBefore) : 'formato aún desconocido'} · bytes ${hex(before.body)}` : 'sin respuesta'}`, okBefore ? 'info' : 'warn');

    let ok = okBefore, after = null, strapAfter = okBefore ? strapBefore : null, tAfter = t0;
    // Try the remembered SET_CLOCK layout first, then the other known layouts; each one is checked by
    // reading the clock back. The first that works is remembered for next time.
    const known = localStorage.getItem('pulso.clockVariant');
    const variants = payload.setClockVariants();
    variants.sort((a, b) => (b.id === known) - (a.id === known));
    let attempt = 0;
    for (const vr of [...variants, ...variants]) {     // two rounds: the strap sometimes ignores a command
      if (ok) break;
      attempt++;
      const bytes = payload.setClockVariants().find((x) => x.id === vr.id).bytes;   // fresh time for every attempt
      const sc = await this.send(CMD.setClock, bytes);
      await sleep(400);
      after = await this.send(CMD.getClock);
      tAfter = nowS();
      const o = after ? read.clockOffsetNear(after, tAfter, 120) : null;
      if (o != null) {
        byte = o; localStorage.setItem('pulso.clockByte', String(o)); localStorage.setItem('pulso.clockVariant', vr.id);
        strapAfter = read.clockAt(after, o); ok = true;
      }
      this.log(`Ajuste de hora ${attempt}/${variants.length * 2} (formato ${vr.id}): respuesta ${sc ? `${sc.result} ${hex(sc.body)}` : 'ninguna'} → ${after ? `reloj ${hex(after.body)}` : 'sin respuesta'} → ${ok ? 'correcta' : 'sigue sin cuadrar'}`, ok ? 'info' : 'warn');
      if (!ok) await sleep(300);
    }
    // now that the clock position is known, re-read the value the strap had when we connected
    if (before && byte != null) strapBefore = read.clockAt(before, byte);
    if (!okBefore && strapBefore != null && byte != null && ok) {
      const offset = Math.round(t0 - strapBefore);
      if (Math.abs(offset) >= 300) this.addClockFix({ strapAt: strapBefore, offset, measuredAt: Math.round(t0) });
    }
    if (ok) this.set({ notRecording: false });
    const shown = strapAfter ?? strapBefore;
    const ref = strapAfter != null ? tAfter : t0;
    const rawBody = after || before;
    this.set({
      clock: shown != null ? new Date(shown * 1000) : null, clockOk: ok, clockBefore: strapBefore,
      clockDrift: shown != null ? Math.round(shown - ref) : null, clockRaw: rawBody ? hex(rawBody.body) : null,
    });
    if (!ok) this.log(`No se pudo comprobar la hora de la pulsera (bytes ${rawBody ? hex(rawBody.body) : 'sin respuesta'}). No se confirmará ningún bloque hasta que la hora cuadre: los datos se quedan en la pulsera y se guardan en crudo.`, 'error');
    return ok;
  }

  onDisconnect() {
    this.log('Desconectada', 'warn');
    for (const [, p] of this.pending) p.resolve(null);
    this.pending.clear();
    const wasSync = this.historyActive;
    this.historyActive = false;
    this.chunk = null;               // a chunk cut halfway is not acknowledged: the strap resends it
    clearInterval(this.battTimer);
    this.releaseWake();
    this.set({ conn: 'disconnected', liveOn: false, liveHR: null, prog: null });
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
    const asm = this.asm[k];
    const before = asm.crcFail;
    for (const f of asm.push(bytes)) this.onFrame(f, k);
    if (asm.crcFail > before) this.log(`${asm.crcFail - before} trama(s) con CRC incorrecto descartadas en ${k}`, 'warn');
  }

  liveTick(bpm, rr) {
    this.s.liveHR = bpm;
    if (rr.length) this.s.liveRR = rr;
    for (const fn of this.hrListeners) fn(bpm, rr);
    this.dispatchEvent(new Event('change'));
  }

  /** True for the frames that still arrive for a short while after a download was stopped: ignored
   *  (and therefore never acknowledged — they stay on the strap). */
  isTail() { return !this.historyActive && this.cancelledAt && Date.now() - this.cancelledAt < 10000; }

  onFrame(f, k) {
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
        if (this.isTail()) break;
        if (m.meta === 1) {
          if (this.chunk?.frames.length > 1) this.log(`Bloque anterior sin final (${this.chunk.frames.length} tramas): no se confirma`, 'warn');
          this.chunk = { frames: [f], start: m.unix };
          if (!this.historyActive) { this.historyActive = true; this.set({ conn: 'syncing' }); }
        } else if (m.meta === 2) {
          const c = this.chunk || { frames: [], start: null, noStart: true };
          c.frames.push(f);
          this.chunk = null;
          this.enqueueCommit(c, m);
        } else if (m.meta === 3) {
          this.commitChain.then(() => this.finishHistory(true));
        } else this.log(`Metadatos de historial tipo ${m.meta}: ${describeFrame(f)}`, 'warn');
        break;
      case 'history':
        if (this.isTail()) break;
        this.lastTraffic = Date.now();
        if (!this.historyActive) { this.historyActive = true; this.set({ conn: 'syncing' }); }
        if (!this.chunk) this.chunk = { frames: [], start: null, noStart: true };
        this.chunk.frames.push(f);
        this.s.received++;
        this.track(f);
        if (this.s.received % 100 === 0) this.dispatchEvent(new Event('change'));
        break;
      case 'realtime': this.liveTick(m.bpm, m.rr); break;
      case 'raw':
      case 'unknown':
        // Not history as we know it. While a chunk is open it is kept (it will be in the raw copy and
        // counted in the diagnosis) so a new record type can never be thrown away unnoticed.
        if (this.chunk && !this.isTail()) {
          this.lastTraffic = Date.now();
          if (this.chunk.frames.length < MAX_FRAMES_PER_CHUNK) this.chunk.frames.push(f);
          if (!this.chunk.loggedOther) { this.chunk.loggedOther = true; this.log(`Trama no reconocida dentro de un bloque (${k}): ${describeFrame(f)}`, 'warn'); }
        } else if (m.kind === 'unknown') this.log(`Trama tipo ${m.type} (${m.len} B) sin decodificar: ${describeFrame(f, 24)}`, 'warn');
        break;
      default: break;
    }
  }

  onEvent(e) {
    const label = EVENTS[e.code] || `Evento ${e.code}`;
    this.log(`Evento: ${label}`, 'rx');
    const p = {};
    // Battery events: while the pack charges the strap they alternate between the strap and the pack, so
    // each one is sent as it came (never mixed with other readings); the server tells them apart.
    // «charging» comes from events 7/8; a battery event only confirms it (the pack's events say «not charging»).
    if (e.code === 3 && e.battery != null) { if (e.charging) p.charging = true; this.postBattery({ battery: e.battery, charging: e.charging, mv: e.mv || null, raw: e.raw, source: 'evento' }); }
    if (e.code === 7) p.charging = true;
    if (e.code === 8) p.charging = false;
    if (e.code === 9) p.worn = true;
    if (e.code === 10) p.worn = false;
    if (e.code === 13) { p.clockOk = false; this.log('La pulsera avisa de que ha perdido la hora: se ajustará antes de la próxima descarga.', 'warn'); }
    if (e.code === 33) p.liveOn = true;
    if (e.code === 34) p.liveOn = false;
    if (e.code === 57) this.saveAlarm(null, Math.floor(Date.now() / 1000));   // 58 = «Hacer vibrar» desde la app
    if (e.code === 59) this.saveAlarm(null);
    if (Object.keys(p).length) { this.set(p); if (e.code !== 13 && e.code !== 3) this.postDevice(); }
    if ([7, 8, 9, 10, 13, 14, 57, 58, 59].includes(e.code)) queue.putEvent({ ts: Math.floor(Date.now() / 1000), code: e.code, label }).catch(() => {});
    this.dispatchEvent(new CustomEvent('strapevent', { detail: e }));
  }

  // ------------------------------------------------------------ history
  /** Progress from record timestamps: records are chronological, one per second, so the share of the
   *  span [first record … now] already received is the share of the download done. */
  track(raw) {
    const ts = u32(raw, 11);
    const t = nowS();
    if (!ts || ts < TS_MIN || ts > t + 86400) return;
    const p = this.s.prog || { firstTs: ts, lastTs: ts, startedAt: Date.now() };
    p.firstTs = Math.min(p.firstTs, ts);
    p.lastTs = Math.max(p.lastTs, ts);
    const span = Math.max(1, t - p.firstTs);
    p.pct = Math.max(0, Math.min(99.5, ((p.lastTs - p.firstTs) / span) * 100));
    const el = (Date.now() - p.startedAt) / 1000;
    p.rate = el > 3 ? (p.lastTs - p.firstTs) / el : null;          // seconds of data per real second
    p.etaSec = p.rate ? Math.max(0, (t - p.lastTs) / p.rate) : null;
    this.s.prog = p;
  }

  /** Stops the download safely: the strap is told to abort, the chunk in progress is NOT acknowledged
   *  (so it stays on the strap for next time) and everything already stored is kept and uploaded. */
  async cancelSync() {
    if (!this.historyActive) return;
    await this.stopHistory('Sincronización cancelada por el usuario: el bloque en curso se queda en la pulsera.', 'warn');
  }

  /** Ends the download without acknowledging anything else. `reason` is shown to the user. */
  async stopHistory(reason, level = 'error') {
    if (this.stopping) return;
    this.stopping = true;
    this.cancelledAt = Date.now();
    this.historyActive = false;
    this.chunk = null;
    this.releaseWake();
    this.log(reason, level);
    this.set({ conn: this.device?.gatt?.connected ? 'ready' : 'disconnected', prog: null, error: level === 'error' ? reason : this.s.error });
    try { await this.send(CMD.abortHistory, [0], 2500); } catch { /* ignore */ }
    this.upload();
  }

  async syncHistory() {
    if (!this.connected || this.historyActive) return;
    this.historyActive = true;
    this.stopping = false;
    this.cancelledAt = null;
    this.chunk = null;
    this.commitChain = Promise.resolve();
    this.set({ conn: 'syncing', received: 0, records: 0, discarded: 0, chunks: 0, unconfirmed: 0, syncStarted: Date.now(), error: null, prog: null });
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
        await this.commitChain;
        this.finishHistory(false);
      }
    }, 5000);
  }

  enqueueCommit(c, m) {
    this.commitChain = this.commitChain
      .then(() => this.commit(c, m))
      .catch((e) => this.stopHistory(`Error inesperado al guardar un bloque (${e.message || e}): NO se ha confirmado.`));
  }

  /** Stores, uploads and — only if everything went well — acknowledges one history chunk. */
  async commit(c, m) {
    if (this.stopping) return;
    const hist = c.frames.filter((f) => f[4] === TYPE.history);
    const types = {};
    for (const f of c.frames) types[f[4]] = (types[f[4]] || 0) + 1;
    const typesTxt = Object.entries(types).map(([t, n]) => `tipo ${t}×${n}`).join(', ');
    const fixes = this.clockFixes();
    const { samples, note, stats } = decodeChunk(hist, { fixes });
    const meta = {
      at: Math.floor(nowS()), ack: m.ack ? hex(m.ack) : null, trim: m.trim ?? null, chunkStart: c.start, noStart: !!c.noStart,
      types, note, stats, fixes, clock: { ok: this.s.clockOk, before: this.s.clockBefore, drift: this.s.clockDrift },
      firmware: this.s.firmware, serial: this.s.serial,
      head: hist[0] ? describeFrame(hist[0], 48) : (c.frames[0] ? describeFrame(c.frames[0], 48) : null),
    };
    const rec = { bytes: packFrames(c.frames), samples: encodeSamples(samples), meta };

    // 1) raw + samples on the phone, before anything else
    let id;
    try { id = await queue.putRaw(rec); }
    catch (e) { return this.stopHistory(`No se pudo guardar el bloque en el móvil (${e.message}): NO se confirma y sigue en la pulsera.`); }
    queue.count().then((n) => this.set({ pending: n })).catch(() => {});

    // 2a) a chunk with no sensor data at all, only the strap's own console logs (type 50): it is not
    //     health data. Kept raw (phone + server) and acknowledged — otherwise the strap re-sends the
    //     same chunk forever and the real data behind it never arrives.
    const nonMeta = c.frames.filter((f) => f[4] !== TYPE.metadata && f[4] !== TYPE.puffinMeta);
    if (!samples.length && !hist.length && nonMeta.every((f) => f[4] === TYPE.logs)) {
      const txt = logText(c.frames);
      if (txt) this.log(`Registro interno de la pulsera: ${txt.slice(0, 400)}${txt.length > 400 ? '…' : ''}`, 'rx');
      const rtc = txt.match(/RTC timestamp (\d+) is invalid; not saving data/);
      if (rtc && this.s.clockOk !== true) {
        // the clock could not be set in this connection: the strap is still not recording
        this.set({ notRecording: true });
        this.log(`La pulsera dice que NO está guardando datos: su reloj interno (${rtc[1]} s ≈ ${new Date(Number(rtc[1]) * 1000).toISOString().slice(0, 10)}) no es válido. Mientras no tenga la hora, no graba nada.`, 'error');
      } else if (rtc) {
        this.log('Estos registros internos son de antes de ponerle la hora: durante ese tiempo la pulsera no guardó datos («RTC timestamp invalid»). Ahora ya tiene la hora y vuelve a grabar.', 'warn');
      }
      let res;
      try { res = await uploadChunk(rec); } catch (e) { return this.stopHistory(`No se pudo subir un bloque de registros internos (${e.message}). NO se confirma.`); }
      if (!res.rawSaved) return this.stopHistory('El servidor no guardó un bloque de registros internos: NO se confirma.');
      await queue.markUploaded(id, res).catch(() => {});
      if (!m.ack || this.stopping) return;
      const r = await this.send(CMD.historyResult, payload.ack(m.ack));
      this.set({ chunks: this.s.chunks + 1 });
      this.log(`Bloque de registros internos de la pulsera (${nonMeta.length} tramas, sin datos de salud): guardado en crudo y confirmado · respuesta ${r?.result ?? 'ninguna'}`);
      return;
    }

    // 2) nothing valid → diagnose, keep it raw (phone + server), do NOT acknowledge
    if (!samples.length) {
      this.log(`Bloque con 0 registros válidos: ${c.frames.length} tramas (${typesTxt || 'ninguna'}), ${hist.length} de historial, `
        + `${stats.decoded} decodificados, ${stats.tooOld} con fecha anterior a 2017/1970, ${stats.future} con fecha futura`
        + `${stats.rawFirst != null ? ` · fechas en bruto ${fmtTs(stats.rawFirst)} → ${fmtTs(stats.rawLast)}` : ''}`
        + ` · formato ${note || '—'} · primera trama: ${meta.head || '—'}`, 'error');
      try { const res = await uploadChunk(rec); if (res.rawSaved) await queue.markUploaded(id, res); } catch { /* stays pending on the phone */ }
      return this.stopHistory('Ha llegado un bloque sin registros válidos. NO se ha confirmado: sigue en la pulsera y guardado en crudo para analizarlo (Pulsera › Diagnóstico).');
    }
    // 2b) strap clock not verified → the dates may be wrong but look plausible: keep everything raw
    //     (phone + server) and acknowledge nothing, so no record is freed with a wrong date.
    if (this.s.clockOk === false) {
      const rawOnly = { ...rec, samples: new Uint8Array(0) };
      try { const res = await uploadChunk(rawOnly); if (res.rawSaved) await queue.markUploaded(id, { ...res, rawOnly: true }); } catch { /* stays pending on the phone */ }
      return this.stopHistory('No se ha podido verificar la hora de la pulsera, así que no se confirma ningún bloque (sus fechas podrían ser falsas). Los datos siguen en la pulsera y el primer bloque queda guardado en crudo. Vuelve a conectar; si se repite, descarga el registro en Diagnóstico.');
    }
    if (stats.tooOld || stats.future) this.log(`En el bloque hay ${stats.tooOld + stats.future} registros con fecha imposible (${stats.tooOld} antiguos, ${stats.future} futuros): no se guardan como datos, pero quedan en crudo.`, 'warn');

    // 3) server: raw chunk + records
    let res;
    try { res = await uploadChunk(rec); }
    catch (e) { return this.stopHistory(`No se pudo subir el bloque al servidor (${e.message}). NO se ha confirmado: sigue en la pulsera y guardado en el móvil.`); }
    const reasons = res.reasons || {};
    const reasonsTxt = [reasons.invalid && `${reasons.invalid} con fecha imposible`, reasons.future && `${reasons.future} futuros`,
      reasons.beforeFilter && `${reasons.beforeFilter} anteriores al filtro de segunda mano`, reasons.duplicate && `${reasons.duplicate} ya guardados`].filter(Boolean).join(', ');
    if (!res.rawSaved) return this.stopHistory('El servidor no guardó el bloque en crudo: NO se confirma.');
    // accepted = stored now, already stored before (re-sent chunk) or deliberately filtered (previous owner)
    if ((res.stored || 0) + (reasons.beforeFilter || 0) + (reasons.duplicate || 0) < 1 && !res.duplicate) {
      return this.stopHistory(`El servidor no guardó ningún registro del bloque${reasonsTxt ? ` (${reasonsTxt})` : ''}. NO se ha confirmado: sigue en la pulsera.`);
    }
    await queue.markUploaded(id, res).catch(() => {});

    // 4) everything is safe → acknowledge (the strap may now free this memory)
    if (!m.ack) { this.log('El bloque no trae código de confirmación: guardado, pero la pulsera lo volverá a enviar.', 'warn'); return; }
    if (this.stopping) return;
    const r = await this.send(CMD.historyResult, payload.ack(m.ack));
    const dup = res.duplicate ? (res.stored || 0) : (reasons.duplicate || 0);
    this.set({ chunks: this.s.chunks + 1, records: this.s.records + (res.duplicate ? 0 : (res.stored || 0)),
      discarded: this.s.discarded + Math.max(0, (res.discarded || 0) - dup), note: note || this.s.note });
    this.log(`Bloque confirmado: ${samples.length} válidos, ${res.stored || 0} guardados${res.discarded ? `, ${res.discarded} descartados (${reasonsTxt})` : ''}${res.duplicate ? ' (ya estaba en el servidor)' : ''} · ${note} · respuesta ${r?.result ?? 'ninguna'}`);
    queue.count().then((n) => this.set({ pending: n })).catch(() => {});
  }

  finishHistory(complete) {
    if (!this.historyActive || this.stopping) return;
    this.historyActive = false;
    this.chunk = null;
    const now = Date.now();
    const p = { conn: this.device?.gatt?.connected ? 'ready' : 'disconnected', prog: null };
    if (complete) { localStorage.setItem('pulso.lastSync', String(now)); p.lastSync = now; }
    this.set(p);
    this.log(`Descarga ${complete ? 'completa' : 'terminada'}: ${this.s.records} registros guardados en el servidor, ${this.s.received} recibidos, ${this.s.chunks} bloques confirmados en ${Math.round((now - (this.s.syncStarted || now)) / 1000)} s`);
    this.releaseWake();
    this.upload();
  }

  async upload() {
    try {
      const n = await flush((t) => this.set({ uploaded: t }));
      const pending = await queue.count();
      this.set({ pending });
      if (n) this.log(`Subidos ${n} registros pendientes al servidor`);
      this.dispatchEvent(new Event('uploaded'));
    } catch (e) {
      const pending = await queue.count().catch(() => this.s.pending);
      this.set({ pending });
      if (pending) this.log(`Subida pendiente: ${e.message}. Los datos quedan guardados en el móvil.`, 'warn');
    }
  }

  /** Re-parses the raw chunks the server holds whose records were not stored (for example because the
   *  strap clock was wrong) and stores what can be recovered. Does not need the strap. */
  async reprocessRaw(onProgress) {
    const r = await fetch('/api/raw?unstored=1&limit=5000');
    if (!r.ok) throw new Error(`servidor ${r.status}`);
    const items = (await r.json()).items || [];
    let stored = 0, valid = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rb = await fetch(`/api/raw/${it.id}`);
      if (!rb.ok) continue;
      const frames = splitFrames(new Uint8Array(await rb.arrayBuffer())).filter((f) => f[4] === TYPE.history);
      const fixes = [...(it.meta?.fixes || []), ...this.clockFixes()];
      const { samples, stats } = decodeChunk(frames, { fixes });
      valid += stats.valid;
      const up = await fetch(`/api/raw/${it.id}/samples`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: encodeSamples(samples) });
      if (up.ok) stored += (await up.json()).stored || 0;
      onProgress?.(i + 1, items.length, stored);
    }
    this.log(`Reprocesados ${items.length} bloques en crudo del servidor: ${valid} registros válidos, ${stored} guardados.`);
    return { chunks: items.length, valid, stored };
  }

  /** Device info for the server (no battery: readings go through postBattery, one by one). */
  postDevice() {
    const s = this.s;
    fetch('/api/device', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ charging: s.charging, worn: s.worn, serial: s.serial, firmware: s.firmware, name: s.name,
        clock: s.clock ? Math.floor(s.clock / 1000) : null, clockOk: s.clockOk, clockDrift: s.clockDrift }) }).catch(() => {});
  }

  /** One battery reading exactly as the strap gave it. */
  postBattery(b) {
    fetch('/api/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, worn: this.s.worn }) })
      .then(() => this.dispatchEvent(new Event('battery'))).catch(() => {});
  }

  // ------------------------------------------------------------ actions
  async setLive(on) { await this.send(CMD.toggleGenericHR, [on ? 1 : 0]); this.set({ liveOn: on }); if (!on) this.set({ liveHR: null }); }
  async buzz() { await this.send(CMD.runHaptics, payload.haptics()); await this.send(CMD.runAlarm, [1]); }
  async setAlarm(date) {
    const r = await this.send(CMD.setAlarm, payload.alarm(date));
    const ok = r?.result === 1;
    if (ok) this.saveAlarm(date);
    return ok;
  }
  async disableAlarm() { const r = await this.send(CMD.disableAlarm, [1]); if (r) this.saveAlarm(null); return !!r; }
  /** Ask the strap which alarm it holds (read-only). Only trusted when the reply contains a plausible time. */
  async readAlarm() {
    try {
      const r = await this.send(CMD.getAlarm, [0], 3000);
      if (!r) return;
      this.log(`Alarma en la pulsera: ${hex(r.body)}`);
      const d = read.alarm(r);
      // The reply may still carry an alarm that was removed or already rang: adopt it only if nothing
      // is stored and it isn't the one we cleared.
      const st = this.serverSettings || {};
      const at = d ? Math.floor(d / 1000) : null;
      if (at && !st.alarmAt && at !== st.alarmCleared) this.saveAlarm(d, undefined, true);
    } catch { /* optional */ }
  }
  /** Remember the programmed alarm on the server so every screen (and the desktop) can show it. */
  saveAlarm(date, rangAt, fromStrap = false) {
    const at = date ? Math.floor(date.getTime() / 1000) : null;
    if (fromStrap && at === this.s.alarmAt) return;
    const body = { alarmAt: at };
    const prev = this.s.alarmAt ?? this.serverSettings?.alarmAt;
    if (!date && prev) body.alarmCleared = prev;
    if (rangAt !== undefined) body.alarmRangAt = rangAt;
    this.set({ alarmAt: at });
    fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => this.dispatchEvent(new Event('alarm'))).catch(() => {});
  }
  async refreshBattery() {
    const b = await this.send(CMD.getBattery);
    const v = b ? read.battery(b) : null;
    if (v != null) { this.set({ battery: v }); this.postBattery({ battery: v, charging: this.s.charging, mv: null, source: 'lectura' }); }
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
// y volver a conectar sola (una vez por regreso, sin abrir la lista) para descargar lo nuevo.
let lastAutoTry = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (strap.device && !strap.device.gatt?.connected && strap.connected) strap.onDisconnect();
  if (!strap.connected && strap.s.conn === 'idle' && Date.now() - lastAutoTry > 20000) {
    lastAutoTry = Date.now();
    setTimeout(() => strap.autoConnect().catch(() => {}), 700);
  }
});
// Vigilante: ningún estado de conexión puede quedarse colgado más de 100 s.
let stuckSince = 0;
setInterval(() => {
  const busy = ['connecting', 'pairing', 'handshaking'].includes(strap.s.conn);
  if (!busy) { stuckSince = 0; return; }
  stuckSince = stuckSince || Date.now();
  if (Date.now() - stuckSince > 100000) { stuckSince = 0; strap.fail('La conexión se quedó atascada.'); }
}, 5000);
