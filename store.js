// Small binary key-value store for ROMs, saves and states.
// Cache Storage is the storage Meta documents for Ray-Ban Display web apps,
// IndexedDB is the fallback, memory the last resort.
const CACHE = 'metamon-data';
const base = new URL('__data/', location.href);
const keyUrl = (k) => new URL(encodeURIComponent(k), base).href;

let backend = null;
async function pick() {
  if (backend) return backend;
  try {
    if (self.caches) { await caches.open(CACHE); backend = cacheBackend; return backend; }
  } catch {}
  try {
    if (self.indexedDB) { await idbOpen(); backend = idbBackend; return backend; }
  } catch {}
  backend = memBackend; return backend;
}

const cacheBackend = {
  name: 'cache',
  async put(k, bytes) { const c = await caches.open(CACHE); await c.put(keyUrl(k), new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); },
  async get(k) { const c = await caches.open(CACHE); const r = await c.match(keyUrl(k)); return r ? new Uint8Array(await r.arrayBuffer()) : null; },
  async del(k) { const c = await caches.open(CACHE); await c.delete(keyUrl(k)); },
  async keys() { const c = await caches.open(CACHE); return (await c.keys()).map((r) => r.url).filter((u) => u.startsWith(base.href)).map((u) => decodeURIComponent(u.slice(base.href.length))); },
};

let dbp = null;
function idbOpen() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('metamon', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const t = db.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
}
const idbBackend = {
  name: 'indexeddb',
  put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  get: async (k) => { const v = await tx('readonly', (s) => s.get(k)); return v ? new Uint8Array(v) : null; },
  del: (k) => tx('readwrite', (s) => s.delete(k)),
  keys: async () => (await tx('readonly', (s) => s.getAllKeys())).map(String),
};

const mem = new Map();
const memBackend = {
  name: 'memory',
  put: async (k, v) => { mem.set(k, v); }, get: async (k) => mem.get(k) || null,
  del: async (k) => { mem.delete(k); }, keys: async () => [...mem.keys()],
};

export const put = async (k, v) => (await pick()).put(k, v);
export const get = async (k) => (await pick()).get(k);
export const del = async (k) => (await pick()).del(k);
export const keys = async () => (await pick()).keys();
export const backendName = async () => (await pick()).name;
