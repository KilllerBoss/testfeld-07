// api_probe5.mjs — Gyro-Frame-Konvention: ist qvel[3:6] Welt- oder Körperform?
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
const model = m.MjModel.from_xml_path('/models/unitree_g1/g1.xml');
const data = new m.MjData(model);
const jadr = model.jnt_qposadr[model.body_jntadr[1]];
const gyroAdr = model.sensor_adr[2]; // imu-pelvis-angular-velocity

function setId() { data.qpos[jadr + 3] = 1; data.qpos[jadr + 4] = 0; data.qpos[jadr + 5] = 0; data.qpos[jadr + 6] = 0; }
function setQuat90() { const h = Math.PI / 4; data.qpos[jadr + 3] = Math.cos(h); data.qpos[jadr + 4] = Math.sin(h); data.qpos[jadr + 5] = 0; data.qpos[jadr + 6] = 0; }
function readGyro() { m.mj_forward(model, data); return [data.sensordata[gyroAdr], data.sensordata[gyroAdr + 1], data.sensordata[gyroAdr + 2]]; }

data.qvel[3] = 0; data.qvel[4] = 0.5; data.qvel[5] = 0;
setId();
console.log('A: Identität,  qvelω=(0,0.5,0) → gyro =', readGyro().map(v => v.toFixed(3)).join(', '));
setQuat90();
console.log('B: +90° um X,  qvelω=(0,0.5,0) → gyro =', readGyro().map(v => v.toFixed(3)).join(', '));
// C: Body-frame-Test: ω lokal (0,0.5,0) ansetzen, via ximat zurückrechnen wäre Welt.
setQuat90();
data.qvel[3] = 0; data.qvel[4] = 0; data.qvel[5] = -0.5;
console.log('C: +90° um X,  qvelω=(0,0,-0.5) → gyro =', readGyro().map(v => v.toFixed(3)).join(', '));
console.log('Interpretation: B zeigt (0,0,∓0.5) → qvel ω ist WELTFRAME; B zeigt (0,0.5,0) → KÖRPERFRAME');
data.delete(); model.delete();
