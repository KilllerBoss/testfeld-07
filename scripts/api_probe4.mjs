// api_probe4.mjs — MjContactVec-Member + MjContact-Felder korrekt lesen.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, mj, fetchModelIntoFS } = await import(path.join(WWW, 'js/engine.js'));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
await initEngine(() => {}, { wasmBinary });
await fetchModelIntoFS('models/unitree_g1');
const m = mj();

// MjContactVec-Klasse inspizieren
const model = m.MjModel.from_xml_path('/models/unitree_g1/testfeld.xml');
const data = new m.MjData(model);
m.mj_resetDataKeyframe(model, data, 0);
m.mj_forward(model, data);

const cvec = data.contact;
const proto = Object.getPrototypeOf(cvec);
console.log('MjContactVec-Methoden:', Object.getOwnPropertyNames(proto).join(' '));

// evtl. get(i)
for (const name of ['get', 'at', 'size', 'length']) {
  if (typeof cvec[name] === 'function') console.log(`cvec.${name}() →`, (() => { try { const v = cvec[name](); return v && v.constructor ? v.constructor.name : String(v); } catch (e) { return 'ERR ' + e.message; } })());
}
try {
  const c0 = cvec.get(0);
  const p2 = Object.getPrototypeOf(c0);
  console.log('MjContact-Felder:', Object.getOwnPropertyNames(p2).filter(k => !['constructor', 'clone', 'delete', 'deleteLater', 'isAliasOf', 'isDeleted'].includes(k)).join(' '));
  console.log('geom:', c0.geom ? Array.from(c0.geom) : '?', 'dist:', c0.dist, 'efc_address:', c0.efc_address);
} catch (e) { console.log('get(0) Fehler:', e.message); }
data.delete(); model.delete();
