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
 * Neu in v2.3.1: root-Bahn + yaw (Root-Motion) und srcPos/srcJoints
 * (Lehrer-Ghost = Original-Animation).
 */
export function packMotion(motion) {
  const out = {
    q: Array.from(motion.q),
    h: Array.from(motion.h),
    fps: motion.fps,
    n: motion.n,
    nu: motion.nu,
    name: motion.name,
    duration: motion.duration,
    mapped: motion.mapped,
    mergedFrom: motion.mergedFrom || 0,
    alg: motion.alg || 0, // Retargeting-Algorithmus-Version (Auto-Re-Retarget, v2.6.1)
  };
  if (motion.root) out.root = Array.from(motion.root);
  if (motion.yaw) out.yaw = Array.from(motion.yaw);
  if (motion.srcPos) out.srcPos = Array.from(motion.srcPos);
  if (motion.srcJoints) out.srcJoints = motion.srcJoints.slice();
  if (motion.baseQ) out.baseQ = Array.from(motion.baseQ);
  if (motion.locomotion !== undefined) out.locomotion = !!motion.locomotion;
  return out;
}

export function unpackMotion(rec) {
  const q = new Float32Array(rec.q);
  const h = new Float32Array(rec.h);
  const m = {
    name: rec.name, fps: rec.fps, n: rec.n, nu: rec.nu,
    q, h, duration: rec.duration, mapped: rec.mapped || [],
    mergedFrom: rec.mergedFrom || 0,
    alg: rec.alg || 0, // alte Datensätze: 0 (< RT_ALG) → activateClip re-retargetet
    locomotion: rec.locomotion !== false, // alte Datensätze: Rebase wie bisher an
  };
  // Alte Datensätze (vor Root-Motion) bleiben lauffähig — Felder optional
  if (rec.root && rec.yaw && rec.root.length === 2 * rec.n && rec.yaw.length === rec.n) {
    m.root = new Float32Array(rec.root);
    m.yaw = new Float32Array(rec.yaw);
  }
  if (rec.srcPos && rec.srcJoints && rec.srcPos.length === 3 * rec.n * rec.srcJoints.length) {
    m.srcPos = new Float32Array(rec.srcPos);
    m.srcJoints = rec.srcJoints.slice();
  }
  // Basis-Orientierung (Lehrer-Nick/Roll) — alte Datensätze ohne baseQ weiter ok
  if (rec.baseQ && rec.baseQ.length === 4 * rec.n) m.baseQ = new Float32Array(rec.baseQ);
  return m;
}
