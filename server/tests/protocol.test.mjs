// node --test server/tests/protocol.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, validFrame, FrameAssembler, parse, fromHex, hex, decodeChunk, encodeSamples, payload, detectLayout, parseHeartRate, CMD, TYPE } from '../web/js/ble/protocol.js';

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
