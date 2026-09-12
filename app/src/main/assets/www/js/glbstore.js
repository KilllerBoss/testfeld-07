// ═══════════════════════════════════════════════════════════
// glbstore.js — Persistenz für GLB-Clips + retargetete Timelines
// über IndexedDB (localStorage ist zu klein für Binärdaten).
// ═══════════════════════════════════════════════════════════

const DB_NAME = 'trainrobot';
const STORE = 'clips';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export async function putClip(record) {
  const db = await openDB();
  return tx(db, 'readwrite', (s) => s.put(record));
}

export async function listClips() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteClip(id) {
  const db = await openDB();
  return tx(db, 'readwrite', (s) => s.delete(id));
}

/**
 * Retargetete Timeline serialisieren (Float32Array → normale Arrays).
 */
export function packMotion(motion) {
  return {
    q: Array.from(motion.q),
    h: Array.from(motion.h),
    fps: motion.fps,
    n: motion.n,
    nu: motion.nu,
    name: motion.name,
    duration: motion.duration,
    mapped: motion.mapped,
  };
}

export function unpackMotion(rec) {
  const q = new Float32Array(rec.q);
  const h = new Float32Array(rec.h);
  return {
    name: rec.name, fps: rec.fps, n: rec.n, nu: rec.nu,
    q, h, duration: rec.duration, mapped: rec.mapped || [],
  };
}
