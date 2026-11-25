// Durable local storage (IndexedDB) for history downloads. Survives page reloads and Tailscale outages.
//
// · `raw`: every history chunk exactly as the strap sent it (all its frames) plus the decoded 32-byte
//   samples and a diagnostic summary. It is written BEFORE anything is acknowledged to the strap, so a
//   chunk can always be re-parsed later. Uploaded chunks are kept for RAW_KEEP_DAYS as a local backup.
// · `chunks`: legacy queue of decoded samples only (older versions of the web). Still flushed.
// · `events`: strap events (worn / removed / charging…) waiting to be uploaded.

const DB_NAME = 'pulso-queue';
const RAW_KEEP_DAYS = 14;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('raw')) {
        // `pending` exists (=1) only until the server has stored the chunk, so the index lists just those.
        db.createObjectStore('raw', { keyPath: 'id', autoIncrement: true }).createIndex('pending', 'pending');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => { dbp = null; reject(new Error('IndexedDB bloqueada por otra pestaña: ciérrala y vuelve a intentarlo')); };
  });
  return dbp;
}

/** Runs `fn(store)` in a transaction and resolves with its result only once the transaction is committed. */
function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; }, (e) => { try { t.abort(); } catch { /* already done */ } reject(e); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transacción abortada'));
  }));
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const all = (s) => req(s.getAll());

export const queue = {
  // ---- raw chunks
  /** Stores a raw chunk; resolves with its id once durably committed. */
  async putRaw(rec) { return tx('raw', 'readwrite', (s) => req(s.add({ ...rec, created: Date.now(), uploaded: null, pending: 1 }))); },
  /** Marks a raw chunk as stored on the server (keeps the bytes as a local backup, drops the samples). */
  async markUploaded(id, result) {
    return tx('raw', 'readwrite', async (s) => {
      const rec = await req(s.get(id));
      if (!rec) return;
      rec.uploaded = Date.now(); rec.result = result; delete rec.samples; delete rec.pending;
      await req(s.put(rec));
    });
  },
  async pendingRaw(limit = 20) { return tx('raw', 'readonly', (s) => req(s.index('pending').getAll(1, limit))); },
  async pendingRawCount() { return tx('raw', 'readonly', (s) => req(s.index('pending').count(1))); },
  async rawStats() {
    return tx('raw', 'readonly', async (s) => ({ total: await req(s.count()), pending: await req(s.index('pending').count(1)) }));
  },
  /** Deletes uploaded raw chunks older than RAW_KEEP_DAYS (they are also on the server). */
  async pruneRaw() {
    const limit = Date.now() - RAW_KEEP_DAYS * 86400000;
    return tx('raw', 'readwrite', (s) => new Promise((resolve, reject) => {
      let n = 0;
      const c = s.openCursor();
      c.onerror = () => reject(c.error);
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) { resolve(n); return; }
        if (cur.value.uploaded && cur.value.created < limit) { cur.delete(); n++; }
        cur.continue();
      };
    }));
  },
  // ---- legacy decoded chunks
  async chunks(limit = 50) { return tx('chunks', 'readonly', async (s) => (await all(s)).slice(0, limit)); },
  async remove(id) { return tx('chunks', 'readwrite', (s) => req(s.delete(id))); },
  /** Chunks still waiting to be uploaded (raw + legacy). */
  async count() {
    const [a, b] = await Promise.all([tx('chunks', 'readonly', (s) => req(s.count())), queue.pendingRawCount()]);
    return a + b;
  },
  // ---- events
  async putEvent(e) { return tx('events', 'readwrite', (s) => req(s.add(e))); },
  async events() { return tx('events', 'readonly', (s) => req(s.getAll())); },
  async clearEvents(ids) { return tx('events', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }); },
};

// ------------------------------------------------------------------ upload

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Sends one raw chunk (+ its decoded samples) to the server. Resolves with the server's answer
 *  ({ rawSaved, stored, discarded, reasons, … }) or throws. */
export async function uploadChunk(rec, timeoutMs = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/chunk', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ raw: b64(rec.bytes), samples: b64(rec.samples || new Uint8Array(0)), meta: rec.meta || {} }),
    });
    if (!r.ok) throw new Error(`servidor ${r.status}${r.status === 404 ? ' (actualiza el servidor)' : ''}`);
    return await r.json();
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'el servidor no respondió a tiempo' : (e.message || String(e)));
  } finally { clearTimeout(timer); }
}

let flushing = null;

/** Uploads everything still pending (raw chunks that could not be sent during the download, legacy
 *  chunks and events). Returns the number of records the server stored. */
export function flush(onProgress) {
  if (flushing) return flushing;
  flushing = (async () => {
    let total = 0;
    try {
      for (;;) {
        const list = await queue.pendingRaw(20);
        if (!list.length) break;
        for (const rec of list) {
          const res = await uploadChunk(rec);
          if (!res.rawSaved) throw new Error('el servidor no guardó el bloque');
          await queue.markUploaded(rec.id, res);
          total += res.stored || 0;
          onProgress?.(total);
        }
      }
      for (;;) {
        const list = await queue.chunks(20);
        if (!list.length) break;
        for (const c of list) {
          const r = await fetch('/api/samples', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: c.bytes });
          if (!r.ok) throw new Error(`servidor ${r.status}`);
          const j = await r.json().catch(() => ({}));
          await queue.remove(c.id);
          total += j.stored ?? c.bytes.byteLength / 32;
          onProgress?.(total);
        }
      }
      const evs = await queue.events();
      if (evs.length) {
        const r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evs.map(({ id, ...e }) => e)) });
        if (r.ok) await queue.clearEvents(evs.map((e) => e.id));
      }
      queue.pruneRaw().catch(() => {});
    } finally {
      flushing = null;
    }
    return total;
  })();
  return flushing;
}
