// node --test server/tests/protocol.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, validFrame, FrameAssembler, parse, fromHex, hex, decodeChunk, encodeSamples, payload, detectLayout, parseHeartRate, CMD, TYPE,
  packFrames, splitFrames, fixTimestamp, read, TS_MIN, logText } from '../web/js/ble/protocol.js';

const captured = [
  'aa0800a823080e016c935474', 'aa0800a823070e00c7e40f08', 'aa0800a8230e16001147c585',
  'aa10005723704201126d6566000000003d59d8fd', 'aa1800ff2802ad896566f0654201670600000000000001013ba00d4d',
  'aa1c00ab311802f65c7066804043000000' + '2e470100040000000000007f873cf3',
];

test('captured frames validate', () => { for (const h of captured) assert.ok(validFrame(fromHex(h)), h); });

test('build matches capture', () => {
  assert.equal(hex(buildFrame(TYPE.command, 0x08, CMD.toggleGenericHR, [1])), captured[0]);
  assert.equal(hex(buildFrame(TYPE.command, 0x0e, CMD.sendHistory, [0])), captured[2]);
  assert.equal(hex(buildFrame(TYPE.command, 0x70, CMD.setAlarm, payload.alarm(new Date(0x66656d12 * 1000)))), captured[3]);
});

test('assembler with fragments and garbage', () => {
  const a = fromHex(captured[4]), b = fromHex(captured[5]);
  const stream = new Uint8Array([0, 0x13, ...a, ...b]);
  const asm = new FrameAssembler(); const frames = [];
  for (let i = 0; i < stream.length; i += 7) frames.push(...asm.push(stream.slice(i, i + 7)));
  assert.equal(frames.length, 2);
  assert.equal(parse(frames[0]).kind, 'realtime');
  const m = parse(frames[1]);
  assert.equal(m.kind, 'meta'); assert.equal(m.meta, 2); assert.equal(m.trim, 0x0001472e);
  assert.equal(hex(m.ack), '2e47010004000000');
});

test('v24 record decode + encode', () => {
  const inner = new Uint8Array(88); inner[0] = 47; inner[1] = 0x0c; inner[2] = 7;
  const put = (bytes, off) => bytes.forEach((x, i) => { inner[off - 4 + i] = x; });
  const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  put(le32(1716000000), 11); put([88, 2], 21); put([696 & 255, 696 >> 8, 697 & 255, 697 >> 8], 23);
  const fb = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return [...new Uint8Array(d.buffer)]; };
  put([...fb(0.1), ...fb(0.2), ...fb(0.97)], 40); put([1], 55); put([3300 & 255, 3300 >> 8], 72);
  const f = buildFrame(inner[0], inner[1], inner[2], [...inner.slice(3)]);
  assert.equal(f.length, 96);
  const { samples } = decodeChunk([f]);
  assert.equal(samples[0].ts, 1716000000); assert.equal(samples[0].bpm, 88); assert.deepEqual(samples[0].rr, [696, 697]);
  const enc = encodeSamples(samples);
  assert.equal(enc.length, 32);
  const dv = new DataView(enc.buffer);
  assert.equal(dv.getUint32(0, true), 1716000000); assert.equal(enc[4], 88); assert.equal(enc[5], 3); assert.equal(dv.getUint16(22, true), 3300);
});

test('layout detector', () => {
  const frames = [];
  for (let i = 0; i < 120; i++) {
    const b = new Uint8Array(84); const ts = 1716000000 + i;
    b.set([ts & 255, (ts >>> 8) & 255, (ts >>> 16) & 255, ts >>> 24], 11);
    const hr = 60 + (i % 10); b[30] = hr; b[31] = 1; const rr = Math.round(60000 / hr); b[32] = rr & 255; b[33] = rr >> 8;
    b[20] = Math.floor(Math.random() * 256); frames.push(b);
  }
  const r = detectLayout(frames);
  assert.equal(r.tsOffset, 11); assert.equal(r.hrOffset, 30);
});

test('standard heart rate', () => {
  const r = parseHeartRate(new Uint8Array([0x10, 72, 0x55, 0x03]));
  assert.equal(r.bpm, 72); assert.deepEqual(r.rr, [833]);
});

// ---------------------------------------------------------------- history chunks, clock and raw copies
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
/** A real-format v24 history frame (96 bytes) with the given strap timestamp and heart rate. */
function v24(ts, bpm = 60, seq = 1) {
  const inner = new Uint8Array(88); inner[0] = TYPE.history; inner[1] = seq; inner[2] = 7;
  const put = (bytes, off) => bytes.forEach((x, i) => { inner[off - 4 + i] = x; });
  put(le32(ts), 11); put([bpm, 1], 21); put([1000 & 255, 1000 >> 8], 23); put([1], 55);
  return buildFrame(inner[0], inner[1], inner[2], [...inner.slice(3)]);
}
const NOW = 1795600000;   // 2026-11-25

test('records with an impossible date are counted, not silently dropped', () => {
  const frames = [v24(NOW - 10), v24(NOW - 9), v24(3600), v24(3601), v24(NOW + 5000)];
  const { samples, stats } = decodeChunk(frames, { nowS: NOW });
  assert.equal(samples.length, 2);
  assert.deepEqual([stats.frames, stats.decoded, stats.valid, stats.tooOld, stats.future], [5, 5, 2, 2, 1]);
  assert.equal(stats.rawFirst, 3600);
});

test('clock fix moves the records written with the wrong strap clock', () => {
  // strap clock lost: it said 1970 + 50000 s when the real time was NOW
  const fixes = [{ strapAt: 50000, offset: NOW - 50000 }];
  const night = Array.from({ length: 30 }, (_, i) => v24(50000 - 8 * 3600 + i));   // recorded 8 h before connecting
  const { samples, stats } = decodeChunk(night, { fixes, nowS: NOW });
  assert.equal(samples.length, 30);
  assert.equal(stats.fixed, 30);
  assert.equal(samples[0].ts, NOW - 8 * 3600);
  assert.equal(samples[0].rawTs, 50000 - 8 * 3600);
  // records written with a correct clock are not touched by an unrelated fix
  assert.deepEqual(fixTimestamp(NOW - 100, fixes), { ts: NOW - 100, fixed: false });
  // tiny offsets are not "fixes"
  assert.equal(fixTimestamp(NOW, [{ strapAt: NOW, offset: 30 }]).fixed, false);
  assert.ok(TS_MIN > 1e9);
});

test('raw chunk copy round-trips byte for byte', () => {
  const meta1 = buildFrame(TYPE.metadata, 1, 1, [...le32(NOW), 0, 0, 0, 0]);
  const frames = [meta1, v24(NOW - 3), v24(NOW - 2), buildFrame(51, 9, 0, [1, 2, 3]), fromHex(captured[5])];
  const raw = packFrames(frames);
  assert.equal(raw.length, frames.reduce((a, f) => a + f.length, 0));
  const back = splitFrames(raw);
  assert.equal(back.length, frames.length);
  back.forEach((f, i) => assert.equal(hex(f), hex(frames[i])));
  const end = parse(back[4]);
  assert.equal(end.kind, 'meta'); assert.equal(end.meta, 2); assert.equal(hex(end.ack), '2e47010004000000');
});

test('GET_CLOCK: the clock offset is learnt from the reading that matches the phone', () => {
  const body = [0x01, ...le32(12345), ...le32(NOW + 3), 0, 0];
  const r = { body: new Uint8Array(body) };
  assert.equal(read.clockOffsetNear(r, NOW, 120), 5);
  assert.equal(read.clockAt(r, 5), NOW + 3);
  assert.equal(read.clockOffsetNear(r, NOW + 100000, 120), null);
  assert.equal(read.clockAt(r, 1), 12345);
});

test('battery event keeps its raw bytes for later decoding', () => {
  const pl = new Array(24).fill(0);
  const put = (bytes, off) => bytes.forEach((x, i) => { pl[off - 7 + i] = x; });
  put([0x10, 0x27, 0, 0], 8); put([725 & 255, 725 >> 8], 17); put([3830 & 255, 3830 >> 8], 21); put([1], 26);
  const f = buildFrame(TYPE.event, 4, 3, pl);
  const e = parse(f);
  assert.equal(e.kind, 'event'); assert.equal(e.battery, 72.5); assert.equal(e.mv, 3830); assert.equal(e.charging, true);
  assert.equal(e.raw, hex(f));
});

test('firmware console logs (type 50) are read as text across frames', () => {
  const head = [0x2a, 0x8f, 0xa4, 0x69, 0x08, 0x5b, 0x34, 0x00, 0x01];      // binary header seen on 41.17.6.0
  const part = (t, seq) => buildFrame(TYPE.logs, seq, 2, [0x00, ...head, ...Buffer.from(t, 'latin1')]);
  const txt = logText([part(' 34, 427219819: Flash: RTC ti', 1), part('mestamp 31963220 is invalid; not saving data to flash.', 2)]);
  assert.match(txt, /RTC timestamp 31963220 is invalid; not saving data/);
});

test('SET_CLOCK layouts carry the same, current time', () => {
  const d = new Date(NOW * 1000);
  const v = payload.setClockVariants(d);
  assert.deepEqual(v.map((x) => x.id), ['app9', 'ts+1', 'ts+4', 'ts+5', '1+ts+4', 'ts']);
  for (const x of v) assert.deepEqual(x.id === '1+ts+4' ? x.bytes.slice(1, 5) : x.bytes.slice(0, 4), le32(NOW));
  assert.deepEqual(v[2].bytes, payload.setClock(d));
  assert.equal(v[3].bytes.length, 9);
});

test('SET_CLOCK: official-app layout first (9 bytes with 0x439) and the 5-byte one', () => {
  const v = payload.setClockVariants(new Date(1794217260 * 1000));
  assert.equal(v[0].id, 'app9');
  // same bytes as the official app's HCI capture: 2c95f16a 39040000 00
  assert.deepEqual(v[0].bytes, [0x2c, 0x95, 0xf1, 0x6a, 0x39, 0x04, 0x00, 0x00, 0x00]);
  assert.equal(v[1].id, 'ts+1');
  assert.deepEqual(v[1].bytes, [0x2c, 0x95, 0xf1, 0x6a, 0x01]);
  // full frame identical to the capture (seq 1): aa10005723010a2c95f16a3904000000bd1b4689
  const f = buildFrame(TYPE.command, 1, CMD.setClock, v[0].bytes);
  assert.equal(hex(f).replace(/ /g, ''), 'aa10005723010a2c95f16a3904000000bd1b4689');
});

test('104-byte v24 records (MAXIM 41.17 / NORDIC 17.2): heart rate at byte 21, not guessed', () => {
  // real frame from a strap on that firmware (awake, 86 bpm)
  const f = fromHex('aa6400a12f180548f51101c22e076b785380542201560000000000000000000060d90fccf014953d7bace9becd0cb53d48e1613f00f0ffc67bace9becd0cb53d48e1613f33025d020c0356023a016007010c020c0000000000150001e73600000000000030e30199');
  assert.equal(f.length, 104);
  const { samples, note, stats } = decodeChunk([f, f], { nowS: 1795700000 });
  assert.equal(samples[0].bpm, 86);
  assert.equal(samples[0].ts, 0x6b072ec2);
  assert.ok(samples[0].g, 'gravity vector decoded');
  assert.match(note, /v24×2/);
  assert.equal(stats.nonHR, 0);
});

test('v25 records (84 bytes) carry no heart rate and are not stored as samples', () => {
  const v25 = fromHex('aa50000c2f190077f80000d231076b280f0400e968020019feeafdc2fe54ffa3fe26feb1fe30ff25006200fffe4bfed6fce9fcb7fd2200bb02e903ff00edfd65fa3af82bf87ffa480c113e6007010000acde2563');
  assert.equal(v25.length, 84);
  const { samples, stats } = decodeChunk([v25], { nowS: 1795700000 });
  assert.equal(samples.length, 0);
  assert.equal(stats.nonHR, 1);
});

test('weekly alarm: next occurrence on the chosen weekdays', async () => {
  const { nextAlarm } = await import('../web/js/alarmcalc.js');
  const wed2200 = new Date(2026, 10, 25, 22, 0, 0);          // miércoles 25 nov 2026, 22:00
  const weekdays = { time: '07:00', days: [1, 2, 3, 4, 5] };
  assert.equal(nextAlarm(weekdays, wed2200).toString(), new Date(2026, 10, 26, 7, 0, 0).toString());   // jueves 07:00
  const fri2200 = new Date(2026, 10, 27, 22, 0, 0);
  assert.equal(nextAlarm(weekdays, fri2200).toString(), new Date(2026, 10, 30, 7, 0, 0).toString());   // lunes 07:00
  const sameDayEarly = new Date(2026, 10, 25, 6, 0, 0);
  assert.equal(nextAlarm(weekdays, sameDayEarly).toString(), new Date(2026, 10, 25, 7, 0, 0).toString());
  assert.equal(nextAlarm({ time: '07:00', days: [] }, wed2200), null);
  assert.equal(nextAlarm({ time: 'xx', days: [1] }, wed2200), null);
});
