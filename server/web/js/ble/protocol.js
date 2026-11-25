// WHOOP 4.0 BLE protocol — JavaScript port of WhoopKit (verified against captured packets).
//
// Frame: [0xAA][len u16 LE][crc8(len)] [type][seq][cmd] payload… [crc32 LE of bytes 4..len)]
// total = len + 4

export const UUID = {
  service: '61080001-8d6d-82b8-614a-1c8cb0f8dcc6',
  cmdTo: '61080002-8d6d-82b8-614a-1c8cb0f8dcc6',
  cmdFrom: '61080003-8d6d-82b8-614a-1c8cb0f8dcc6',
  events: '61080004-8d6d-82b8-614a-1c8cb0f8dcc6',
  data: '61080005-8d6d-82b8-614a-1c8cb0f8dcc6',
  memfault: '61080007-8d6d-82b8-614a-1c8cb0f8dcc6',
  hrService: 0x180d, hrMeasurement: 0x2a37, batteryService: 0x180f, batteryLevel: 0x2a19,
};

export const TYPE = { command: 35, response: 36, puffinResponse: 38, realtime: 40, raw: 43, history: 47, event: 48, metadata: 49, logs: 50, puffinMeta: 56 };

export const CMD = {
  toggleRealtimeHR: 3, reportVersion: 7, setClock: 10, getClock: 11, toggleGenericHR: 14,
  abortHistory: 20, sendHistory: 22, historyResult: 23, getBattery: 26, reboot: 29, getDataRange: 34,
  getHello: 35, rawRealtime: 63, setAlarm: 66, getAlarm: 67, runAlarm: 68, disableAlarm: 69,
  getAdvName: 76, runHaptics: 79, bodyLocation: 84, exitHighFreqSync: 97, extendedBattery: 98,
};
// Destructive commands (FORCE_TRIM, POWER_CYCLE, firmware, DFU, fuel gauge) — never sent.
const FORBIDDEN = new Set([25, 32, 36, 37, 38, 45, 99]);

export const EVENTS = {
  3: 'Nivel de batería', 7: 'Cargando', 8: 'Carga finalizada', 9: 'Pulsera puesta', 10: 'Pulsera quitada',
  13: 'Reloj interno perdido', 14: 'Doble toque', 17: 'Temperatura', 23: 'Emparejada', 33: 'FC en directo activada',
  34: 'FC en directo desactivada', 40: 'Saturación óptica', 41: 'Saturación óptica', 42: 'Saturación acelerómetro',
  56: 'Alarma programada', 57: 'Alarma ejecutada', 58: 'Alarma (app) ejecutada', 59: 'Alarma desactivada',
  60: 'Vibración', 63: 'Info batería extendida', 96: 'Sincronización rápida', 97: 'Sinc. rápida ON', 98: 'Sinc. rápida OFF', 100: 'Vibración terminada',
};

// ---------------------------------------------------------------- checksums
export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- little endian
export const u16 = (b, o) => (o + 2 <= b.length ? b[o] | (b[o + 1] << 8) : null);
export const i16 = (b, o) => { const v = u16(b, o); return v === null ? null : (v << 16) >> 16; };
export const u32 = (b, o) => (o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : null);
export function f32(b, o) {
  if (o + 4 > b.length) return null;
  return new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
}
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

// ---------------------------------------------------------------- frames
export function buildFrame(type, seq, cmd, payload = [0]) {
  if (type === TYPE.command && FORBIDDEN.has(cmd)) throw new Error('comando bloqueado');
  const inner = [type & 0xff, seq & 0xff, cmd & 0xff, ...payload];
  const len = inner.length + 4;
  const l0 = len & 0xff, l1 = (len >> 8) & 0xff;
  const out = new Uint8Array(len + 4);
  out.set([0xaa, l0, l1, crc8([l0, l1])], 0);
  out.set(inner, 4);
  const c = crc32(out, 4, len);
  out.set([c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff], len);
  return out;
}

export function validFrame(b) {
  if (b.length < 11 || b[0] !== 0xaa) return false;
  const len = b[1] | (b[2] << 8);
  if (len < 7 || len + 4 !== b.length) return false;
  if (crc8([b[1], b[2]]) !== b[3]) return false;
  return u32(b, len) === crc32(b, 4, len);
}

/** Re-assembles frames from fragmented notifications. */
export class FrameAssembler {
  constructor() { this.buf = new Uint8Array(0); this.dropped = 0; this.crcFail = 0; }
  push(chunk) {
    const nb = new Uint8Array(this.buf.length + chunk.length);
    nb.set(this.buf); nb.set(chunk, this.buf.length);
    this.buf = nb;
    const frames = [];
    for (;;) {
      const idx = this.buf.indexOf(0xaa);
      if (idx < 0) { this.dropped += this.buf.length; this.buf = new Uint8Array(0); break; }
      if (idx > 0) { this.dropped += idx; this.buf = this.buf.slice(idx); }
      if (this.buf.length < 4) break;
      const len = this.buf[1] | (this.buf[2] << 8);
      if (crc8([this.buf[1], this.buf[2]]) !== this.buf[3] || len < 7 || len + 4 > 8192) {
        this.buf = this.buf.slice(1); this.dropped++; continue;
      }
      const total = len + 4;
      if (this.buf.length < total) break;
      const cand = this.buf.slice(0, total);
      if (validFrame(cand)) { frames.push(cand); this.buf = this.buf.slice(total); }
      else { this.crcFail++; this.buf = this.buf.slice(1); this.dropped++; }
    }
    return frames;
  }
}

// ---------------------------------------------------------------- parsing
export function parse(b) {
  const len = b[1] | (b[2] << 8);
  const type = b[4];
  switch (type) {
    case TYPE.response: case TYPE.puffinResponse:
      return { kind: 'response', cmd: b[6], seq: b[7], result: b[8], body: b.slice(9, len) };
    case TYPE.event: {
      const e = { kind: 'event', code: b[6], ts: u32(b, 8) };
      if (b[6] === 3 && len >= 19) { e.battery = u16(b, 17) / 10; e.mv = u16(b, 21); e.charging = ((b[26] ?? 0) & 1) === 1; e.raw = hex(b); }
      return e;
    }
    case TYPE.metadata: case TYPE.puffinMeta: {
      const m = { kind: 'meta', meta: b[6], unix: u32(b, 7) };
      if (b[6] === 2 && len >= 25) { m.trim = u32(b, 17); m.ack = b.slice(17, 25); }
      else if (b[6] === 2 && len >= 21) { m.trim = u32(b, 17); m.ack = new Uint8Array([...b.slice(17, 21), 0, 0, 0, 0]); }
      return m;
    }
    case TYPE.history: return { kind: 'history', raw: b };
    case TYPE.realtime: {
      const n = Math.min(b[13] ?? 0, 4), rr = [];
      for (let i = 0; i < n; i++) { const v = u16(b, 14 + 2 * i); if (v) rr.push(v); }
      return { kind: 'realtime', unix: u32(b, 6), bpm: b[12], rr };
    }
    case TYPE.raw: case 51: case 52: case TYPE.logs: return { kind: 'raw', type };
    default: return { kind: 'unknown', type, len: b.length };
  }
}

// ---------------------------------------------------------------- history records
// The timestamp is returned as the strap wrote it, even when it is not plausible (clock lost → 1970,
// clock never set, future): decodeChunk decides what to do with it and leaves a trace of every discard.
function decodeV24(b) {
  const ts = u32(b, 11);
  if (ts == null) return null;
  const hr = b[21] ?? 0, n = Math.min(b[22] ?? 0, 4), rr = [];
  for (let i = 0; i < n; i++) { const v = u16(b, 23 + 2 * i); if (v >= 250 && v <= 2500) rr.push(v); }
  let g = null;
  const x = f32(b, 40), y = f32(b, 44), z = f32(b, 48);
  if ([x, y, z].every(Number.isFinite)) { const m = Math.hypot(x, y, z); if (m > 0.3 && m < 3) g = [x, y, z]; }
  return { ts, bpm: hr, rr, g, contact: (b[55] ?? 1) !== 0 && hr > 0, temp: u16(b, 72) ?? 0, red: u16(b, 68) ?? 0, ir: u16(b, 70) ?? 0, amb: u16(b, 74) ?? 0, resp: u16(b, 80) ?? 0 };
}

function decodeGeneric(b, tsOff, hrOff) {
  const ts = u32(b, tsOff);
  if (ts == null) return null;
  let hr = 0; const rr = [];
  if (hrOff != null) {
    hr = b[hrOff] ?? 0;
    const n = Math.min(b[hrOff + 1] ?? 0, 4);
    for (let i = 0; i < n; i++) { const v = u16(b, hrOff + 2 + 2 * i); if (v >= 250 && v <= 2500) rr.push(v); }
  }
  let g = null;
  if (b.length >= 84) {
    const x = i16(b, 73) / 16384, y = i16(b, 75) / 16384, z = i16(b, 77) / 16384;
    const m = Math.hypot(x, y, z);
    if (m > 0.3 && m < 3) g = [x, y, z];
  }
  return { ts, bpm: hr, rr, g, contact: hr > 0, temp: 0, red: 0, ir: 0, amb: 0, resp: 0 };
}

/** Finds the per-second heart-rate offset in undocumented layouts (e.g. 84-byte "v25"). */
export function detectLayout(frames) {
  const minLen = Math.min(...frames.map((f) => f.length));
  if (!frames.length || minLen <= 20) return { tsOffset: 11, hrOffset: null, confidence: 0 };
  let tsOffset = 11, bestTs = -1;
  for (let o = 6; o < Math.min(20, minLen - 4); o++) {
    const vals = frames.map((f) => u32(f, o));
    let plausible = 0, mono = 0;
    vals.forEach((v, i) => {
      if (v > 1.5e9 && v < 2.5e9) plausible++;
      if (i > 0 && v >= vals[i - 1] && v - vals[i - 1] < 120) mono++;
    });
    if (plausible + mono > bestTs) { bestTs = plausible + mono; tsOffset = o; }
  }
  let best = null, bestScore = 0;
  for (let k = 12; k < minLen - 6; k++) {
    if (k >= tsOffset && k < tsOffset + 4) continue;
    let score = 0, prev = null;
    for (const f of frames) {
      const hr = f[k], n = f[k + 1];
      if (hr < 30 || hr > 220 || n > 4) { prev = null; continue; }
      let s = 0.3;
      if (n > 0) {
        const rrs = []; for (let i = 0; i < n; i++) rrs.push(u16(f, k + 2 + 2 * i));
        const valid = rrs.filter((v) => v >= 250 && v <= 2500);
        if (valid.length === n) {
          const implied = 60000 / (valid.reduce((a, c) => a + c, 0) / valid.length);
          s += Math.abs(implied - hr) / hr < 0.2 ? 1 : -0.3;
        } else s -= 0.5;
      }
      if (prev !== null && Math.abs(prev - hr) <= 8) s += 0.3;
      prev = hr; score += s;
    }
    if (score > bestScore) { bestScore = score; best = k; }
  }
  const conf = Math.min(1, bestScore / (1.6 * frames.length));
  return { tsOffset, hrOffset: conf > 0.35 ? best : null, confidence: conf };
}

// ---------------------------------------------------------------- timestamps
/** Oldest timestamp accepted as real (2017-07-14). Older = the strap clock was never set or was lost. */
export const TS_MIN = 1.5e9;
/** Records more than this many seconds in the future are rejected. */
export const TS_FUTURE = 600;

/** Clock fixes measured when connecting: if the strap clock was wrong, `{ strapAt, offset }` says that at
 *  strap time `strapAt` the real time was `strapAt + offset`. Records written with that wrong clock (strap
 *  time within the 30 days before `strapAt`) are shifted by `offset`. Returns { ts, fixed }. */
export function fixTimestamp(ts, fixes = []) {
  for (const f of fixes || []) {
    if (!f || !Number.isFinite(f.offset) || Math.abs(f.offset) < 300) continue;
    if (ts <= f.strapAt + 120 && ts >= f.strapAt - 30 * 86400) return { ts: ts + f.offset, fixed: true };
  }
  return { ts, fixed: false };
}

/** Decodes the history frames of one chunk. Only records with a plausible timestamp (after applying the
 *  clock fixes) are returned in `samples`; `stats` counts everything else so nothing disappears silently. */
export function decodeChunk(frames, { fixes = [], nowS = Date.now() / 1000 } = {}) {
  const groups = new Map();
  for (const f of frames) { if (!groups.has(f.length)) groups.set(f.length, []); groups.get(f.length).push(f); }
  const decoded = [], notes = [];
  for (const [size, list] of groups) {
    if (size === 96) { list.forEach((f) => { const s = decodeV24(f); if (s) decoded.push(s); }); notes.push(`v24×${list.length}`); }
    else {
      const d = detectLayout(list);
      list.forEach((f) => { const s = decodeGeneric(f, d.tsOffset, d.hrOffset); if (s) decoded.push(s); });
      notes.push(`len${size}×${list.length} hr@${d.hrOffset ?? '?'} conf ${d.confidence.toFixed(2)}`);
    }
  }
  const stats = { frames: frames.length, decoded: decoded.length, valid: 0, fixed: 0, tooOld: 0, future: 0,
    rawFirst: null, rawLast: null, first: null, last: null, sizes: [...groups.keys()] };
  const out = [];
  for (const s of decoded) {
    stats.rawFirst = stats.rawFirst == null ? s.ts : Math.min(stats.rawFirst, s.ts);
    stats.rawLast = stats.rawLast == null ? s.ts : Math.max(stats.rawLast, s.ts);
    const { ts, fixed } = fixTimestamp(s.ts, fixes);
    if (ts < TS_MIN) { stats.tooOld++; continue; }
    if (ts > nowS + TS_FUTURE) { stats.future++; continue; }
    if (fixed) stats.fixed++;
    out.push({ ...s, ts, rawTs: s.ts });
  }
  out.sort((a, b) => a.ts - b.ts);
  stats.valid = out.length;
  if (out.length) { stats.first = out[0].ts; stats.last = out[out.length - 1].ts; }
  if (stats.fixed) notes.push(`hora corregida ×${stats.fixed}`);
  return { samples: out, note: notes.join(', '), stats };
}

// ---------------------------------------------------------------- raw chunks
/** Frames are self-delimiting (0xAA + length + CRC), so a raw chunk is just their concatenation. */
export function packFrames(frames) {
  const total = frames.reduce((a, f) => a + f.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}
export function splitFrames(bytes) { return new FrameAssembler().push(bytes); }

/** Printable text of firmware console-log frames (type 50). */
export function logText(frames) {
  let out = '';
  for (const f of frames) {
    if (f[4] !== TYPE.logs) continue;
    const len = f[1] | (f[2] << 8);
    // [7..17) is a binary header (timestamp, counters); the text follows, split across frames
    for (let i = len > 17 ? 17 : 7; i < len; i++) { const c = f[i]; out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c === 10 ? '\n' : ''; }
  }
  return out;
}

/** Short description of a frame for the diagnostic log: type, length and the first bytes. */
export function describeFrame(f, n = 32) { return `tipo ${f[4]} · ${f.length} B · ${hex(f.slice(0, n))}`; }

/** Same 32-byte record the server/iOS store use. */
export function encodeSamples(samples) {
  const buf = new ArrayBuffer(samples.length * 32);
  const v = new DataView(buf);
  samples.forEach((s, i) => {
    const o = i * 32;
    v.setUint32(o, s.ts >>> 0, true);
    v.setUint8(o + 4, Math.max(0, Math.min(255, s.bpm | 0)));
    v.setUint8(o + 5, (s.contact ? 1 : 0) | (s.g ? 2 : 0));
    const rr = s.rr.slice(0, 4);
    v.setUint8(o + 6, rr.length);
    rr.forEach((x, k) => v.setUint16(o + 8 + k * 2, x, true));
    if (s.g) s.g.forEach((c, k) => v.setInt16(o + 16 + k * 2, Math.max(-32768, Math.min(32767, Math.round(c * 8192))), true));
    v.setUint16(o + 22, s.temp || 0, true);
    v.setUint16(o + 24, s.red || 0, true);
    v.setUint16(o + 26, s.ir || 0, true);
    v.setUint16(o + 28, s.amb || 0, true);
    v.setUint16(o + 30, s.resp || 0, true);
  });
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------- payloads & responses
export const payload = {
  setClock: (d = new Date()) => { const t = Math.floor(d.getTime() / 1000); return [t & 255, (t >>> 8) & 255, (t >>> 16) & 255, (t >>> 24) & 255, 0, 0, 0, 0]; },
  /** SET_CLOCK layouts seen in the community for WHOOP 4.0 firmwares. The one that works is learnt by
   *  reading the clock back (see Strap.syncClock) and remembered. */
  setClockVariants: (d = new Date()) => {
    const t = Math.floor(d.getTime() / 1000);
    const le = [t & 255, (t >>> 8) & 255, (t >>> 16) & 255, (t >>> 24) & 255];
    return [
      { id: 'ts+4', bytes: [...le, 0, 0, 0, 0] },
      { id: 'ts+5', bytes: [...le, 0, 0, 0, 0, 0] },
      { id: '1+ts+4', bytes: [1, ...le, 0, 0, 0, 0] },
      { id: 'ts', bytes: [...le] },
    ];
  },
  alarm: (d) => { const t = Math.floor(d.getTime() / 1000); return [1, t & 255, (t >>> 8) & 255, (t >>> 16) & 255, (t >>> 24) & 255, 0, 0, 0, 0]; },
  haptics: (pattern = 2, loops = 3) => [pattern, loops, 0, 0, 0],
  ack: (block) => [1, ...Array.from(block).slice(0, 8), ...new Array(Math.max(0, 8 - block.length)).fill(0)],
};

export const read = {
  battery: (r) => (r.body.length >= 2 ? u16(r.body, 0) / 10 : null),
  serial: (r) => { if (r.body.length < 24) return null; const f = r.body.slice(14, 24); const end = f.indexOf(0); return new TextDecoder().decode(end >= 0 ? f.slice(0, end) : f).trim() || null; },
  name: (r) => new TextDecoder().decode(r.body.filter((x) => x >= 0x20 && x < 0x7f)) || null,
  versions: (r) => {
    if (r.body.length < 33) return null;
    const h = [0, 1, 2, 3].map((i) => u32(r.body, 1 + i * 4)).join('.');
    const n = [0, 1, 2, 3].map((i) => u32(r.body, 17 + i * 4)).join('.');
    return `MAXIM ${h} · NORDIC ${n}`;
  },
  /** GET_ALARM reply: the body layout is undocumented, so look for a plausible upcoming unix time. */
  alarm: (r) => { const now = Date.now() / 1000; for (let o = 0; o <= r.body.length - 4; o++) { const v = u32(r.body, o); if (v > now - 3600 && v < now + 8 * 86400) return new Date(v * 1000); } return null; },
  /** GET_CLOCK reply layout is undocumented: every u32 of the first bytes is a candidate. The real offset
   *  is learnt after SET_CLOCK (the candidate that then matches the phone time). */
  clockCandidates: (r) => { const out = []; for (let o = 0; o + 4 <= r.body.length; o++) out.push({ o, v: u32(r.body, o) }); return out; },
  clockAt: (r, o) => (o != null && o + 4 <= r.body.length ? u32(r.body, o) : null),
  /** Offset of the candidate within `tol` seconds of `nowS`, or null. */
  clockOffsetNear: (r, nowS, tol = 120) => { let best = null; for (const c of read.clockCandidates(r)) { const d = Math.abs(c.v - nowS); if (d <= tol && (!best || d < best.d)) best = { o: c.o, d }; } return best ? best.o : null; },
};

/** Standard BLE Heart Rate Measurement (0x2A37). R-R returned in ms. */
export function parseHeartRate(b) {
  if (!b.length) return null;
  const flags = b[0]; let i = 1, bpm;
  if (flags & 1) { bpm = u16(b, i); i += 2; } else { bpm = b[i]; i += 1; }
  const contact = flags & 4 ? !!(flags & 2) : null;
  if (flags & 8) i += 2;
  const rr = [];
  if (flags & 0x10) while (i + 2 <= b.length) { rr.push(Math.round(u16(b, i) * 1000 / 1024)); i += 2; }
  return { bpm, rr, contact };
}

// ---------------------------------------------------------------- HRV helpers (live)
export function rmssd(rrIn) {
  const rr = []; let last = null;
  for (const v of rrIn) { if (v < 300 || v > 2000) continue; if (last && Math.abs(v - last) > 0.2 * last) { last = v; continue; } rr.push(v); last = v; }
  if (rr.length < 10) return null;
  let s = 0; for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
  return Math.sqrt(s / (rr.length - 1));
}
