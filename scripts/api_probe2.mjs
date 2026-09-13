// api_probe2.mjs — Kontakt-Struktur + Gyro-Frame-Konvention (qvel[3:6]).
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

// ── 1) Kontakt-Struktur: testfeld (mit Boden) laden ──
const model = m.MjModel.from_xml_path('/models/unitree_g1/testfeld.xml');
const data = new m.MjData(model);
m.mj_resetDataKeyframe(model, data, 0);
m.mj_forward(model, data);
console.log('ncon nach Keyframe+forward:', data.ncon);
console.log('contact.length:', data.contact.length);
if (data.ncon > 0) {
  const c = data.contact[0];
  const props = [];
  let p = Object.getPrototypeOf(c);
  while (p && p.constructor.name !== 'Object') { props.push(...Object.getOwnPropertyNames(p)); p = Object.getPrototypeOf(p); }
  console.log('mjContact-Felder:', props.filter(k => k !== 'constructor' && !k.startsWith('is') && k !== 'clone' && k !== 'delete' && k !== 'deleteLater').join(' '));
  console.log('contact[0]: geom', c.geom ? Array.from(c.geom) : '-', 'geom1', c.geom1, 'geom2', c.geom2, 'dist', c.dist);
}

// ── 2) Gyro-Frame: qvel[3:6] Welt- oder Körperform? ──
// Test A: Identität, ω=(0,0.5,0) → Sensor sollte (0,0.5,0) zeigen
// Test B: Basis um +90° um X gedreht (Nase zeigt −Y?), ω=(0,0.5,0):
//   wenn qvel WELT: Körper-y-Achse zeigt nach −Z... Sensor-y müsste dann 0 sein
//   wenn qvel LOKAL: Sensor-y bleibt 0.5
const adr = 0; // Basis = erster Körper mit freiem Gelenk; qpos-Quat-Offset ermitteln
const jadr = model.jnt_qposadr[model.body_jntadr[1]];
function setQuat90() { data.qpos[jadr + 3] = Math.cos(Math.PI / 4); data.qpos[jadr + 4] = Math.sin(Math.PI / 4); data.qpos[jadr + 5] = 0; data.qpos[jadr + 6] = 0; }
function setId() { data.qpos[jadr + 3] = 1; data.qpos[jadr + 4] = 0; data.qpos[jadr + 5] = 0; data.qpos[jadr + 6] = 0; }
const gyroAdr = model.sensor_adr[2]; // imu-pelvis-angular-velocity
function readGyro() { m.mj_forward(model, data); return [data.sensordata[gyroAdr], data.sensordata[gyroAdr + 1], data.sensordata[gyroAdr + 2]]; }

data.qvel[3] = 0; data.qvel[4] = 0.5; data.qvel[5] = 0;
setId();
const gA = readGyro();
setQuat90();
const gB = readGyro();
console.log('\nTest A (Identität, qvelω=(0,0.5,0)):  gyro =', gA.map(v => v.toFixed(3)).join(', '));
console.log('Test B (+90° um X,  qvelω=(0,0.5,0)): gyro =', gB.map(v => v.toFixed(3)).join(', '));
console.log('→ qvel[3:6] ist', Math.abs(gB[2] - 0.5) < 1e-6 ? 'KÖRPERFRAME (lokal)' : Math.abs(gB[1] - 0.5) > 1e-6 ? 'WELTFRAME' : 'unklar');

// ── 3) Fuß-Geoms auflösen (body → collision geoms) ──
for (const bn of ['left_ankle_roll_link', 'right_ankle_roll_link']) {
  const bid = m.mj_name2id(model, 1, bn);
  const ids = [];
  for (let g = 0; g < model.body_geomnum[bid]; g++) ids.push(model.body_geomadr[bid] + g);
  console.log('body', bn, 'id', bid, 'geoms', ids.join(','), 'contype', ids.map(g => model.geom_contype[g]).join(','));
}
data.delete(); model.delete();
