// api_probe3.mjs — Wie greift man auf data.contact zu?
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

const model = m.MjModel.from_xml_path('/models/unitree_g1/testfeld.xml');
const data = new m.MjData(model);
m.mj_resetDataKeyframe(model, data, 0);
m.mj_forward(model, data);
console.log('ncon:', data.ncon);

const c = data.contact;
console.log('typeof contact:', typeof c, c && c.constructor && c.constructor.name);
if (c && c.constructor === Uint8Array) console.log('Uint8Array Länge:', c.length, '(mjContact sizeof:', c.length / Math.max(1, data.ncon), 'Bytes/Kontakt)');
if (c && c.constructor !== Uint8Array) {
  const props = Object.getOwnPropertyNames(c).slice(0, 30);
  console.log('Eigene Props:', props.join(' '));
}

// Alternative: mj_contact über mj bindings? Prüfen, ob m.mj_contact oder ähnliches existiert
const apiNames = Object.getOwnPropertyNames(m).filter(k => /contact/i.test(k));
console.log('Modul-API mit "contact":', apiNames.join(' ') || 'keine');

// Packed-Array-Interpretation: mjContact (MuJoCo 3.9, 64-bit): int geom[2] (8) + int flex[2]? ...
// Struktur: int geom[2]; int flex[2]; int elem[2]? dist, pos[3], ... Wir probieren:
// Annahme sizeof=136? Prüfen ob 8-Kontakt-Anzahl auf plausible Werte mapped.
if (c && c.constructor === Uint8Array) {
  const f64 = new Float64Array(c.buffer, c.byteOffset, c.length / 8);
  const i32 = new Int32Array(c.buffer, c.byteOffset, c.length / 4);
  console.log('erste 24 i32:', Array.from(i32.slice(0, 24)).join(' '));
  console.log('erste 12 f64:', Array.from(f64.slice(0, 12)).map(v => +v.toFixed(3)).join(' '));
}
data.delete(); model.delete();
