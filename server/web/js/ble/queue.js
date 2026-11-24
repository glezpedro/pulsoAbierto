// Durable local queue (IndexedDB): history chunks are stored here BEFORE the strap is told to
// delete them, then uploaded to the server. Survives page reloads and Tailscale outages.

const DB_NAME = 'pulso-queue';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abort'));
  }));
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const queue = {
  /** Resolves only after the transaction is durably committed. */
  async putChunk(bytes, meta = {}) {
    return tx('chunks', 'readwrite', (s) => req(s.add({ bytes, meta, created: Date.now() })));
  },
  async chunks(limit = 50) {
    return tx('chunks', 'readonly', (s) => new Promise((res) => {
      const out = [];
      s.openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (c && out.length < limit) { out.push(c.value); c.continue(); } else res(out);
      };
    }));
  },
  async remove(id) { return tx('chunks', 'readwrite', (s) => req(s.delete(id))); },
  async count() { return tx('chunks', 'readonly', (s) => req(s.count())); },
  async putEvent(e) { return tx('events', 'readwrite', (s) => req(s.add(e))); },
  async events() { return tx('events', 'readonly', (s) => req(s.getAll())); },
  async clearEvents(ids) { return tx('events', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }); },
};

let flushing = null;

/** Uploads queued chunks to the server; returns number of records uploaded. */
export function flush(onProgress) {
  if (flushing) return flushing;
  flushing = (async () => {
    let total = 0;
    try {
      for (;;) {
        const list = await queue.chunks(20);
        if (!list.length) break;
        for (const c of list) {
          const r = await fetch('/api/samples', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: c.bytes });
          if (!r.ok) throw new Error(`servidor ${r.status}`);
          await queue.remove(c.id);
          total += c.bytes.byteLength / 32;
          onProgress?.(total);
        }
      }
      const evs = await queue.events();
      if (evs.length) {
        const r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evs.map(({ id, ...e }) => e)) });
        if (r.ok) await queue.clearEvents(evs.map((e) => e.id));
      }
    } finally {
      flushing = null;
    }
    return total;
  })();
  return flushing;
}
