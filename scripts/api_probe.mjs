// api_probe.mjs — prüft die MjData-Binding-Oberfläche der vendored
// MuJoCo-WASM: sensordata, contact, ncon, xmat, ximat. Entscheiden damit,
// wie Sensorik (Gyro/Gravitation/Fußkontakte) gelesen wird.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const enginePath = path.join(WWW, 'js/engine.js');
const { initEngine, mj, fetchModelIntoFS } = await import(enginePath);
// Node-fetch-Stub für lokale Dateien (wie glb_diag.mjs)
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
await initEngine(() => {}, { wasmBinary });
const { mj: _mj } = {};
await fetchModelIntoFS('models/unitree_g1');
const m = mj();

const model = m.MjModel.from_xml_path('/models/unitree_g1/g1.xml');
const data = new m.MjData(model);

const props = [];
let proto = Object.getPrototypeOf(data);
while (proto && proto.constructor.name !== 'Object') {
  props.push(...Object.getOwnPropertyNames(proto));
  proto = Object.getPrototypeOf(proto);
}
console.log('MjData-Properties:', props.join(' '));

console.log('\nncon:', data.ncon !== undefined ? 'JA' : 'NEIN');
console.log('sensordata:', data.sensordata !== undefined ? 'JA' : 'NEIN');
if (data.sensordata) console.log('sensordata.length:', data.sensordata.length, 'nsensordata:', model.nsensordata);
console.log('contact:', data.contact !== undefined ? 'JA (' + (data.contact.length ?? '?') + ')' : 'NEIN');
console.log('xmat:', data.xmat !== undefined ? 'JA' : 'NEIN');
console.log('nsensor:', model.nsensor);

// Sensor-Namen lesen
try {
  const SENSOR = 20; // mjOBJ_SENSOR
  for (let s = 0; s < model.nsensor; s++) {
    const n = m.mj_id2name(model, SENSOR, s);
    console.log('sensor', s, JSON.stringify(n), 'adr', model.sensor_adr ? model.sensor_adr[s] : '?', 'dim', model.sensor_dim ? model.sensor_dim[s] : '?', 'type', model.sensor_type ? model.sensor_type[s] : '?');
  }
} catch (e) { console.log('Sensor-Iter:', e.message); }

// Kontakt-Zugriff testen: auf Boden setzen und mj_forward
m.mj_forward(model, data);
console.log('\nnach forward ncon =', data.ncon);
try {
  const c0 = data.contact[0];
  console.log('contact[0]:', typeof c0, c0 && c0.constructor && c0.constructor.name);
  if (c0) {
    console.log('  geom1', c0.geom1, 'geom2', c0.geom2, 'dist', c0.dist);
  }
} catch (e) { console.log('contact-Zugriff:', e.message); }

// mj_name2id für BODY
const bid = m.mj_name2id(model, 1, 'left_foot');
console.log('\nbody left_foot id:', bid, 'geomadr', bid >= 0 ? model.body_geomadr[bid] : '-', 'geomnum', bid >= 0 ? model.body_geomnum[bid] : '-');
data.delete(); model.delete();
