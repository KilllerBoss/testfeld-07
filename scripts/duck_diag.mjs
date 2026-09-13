// duck_diag.mjs — Warum kippt der Duck im STAND?
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const cfg = getRobot('duck');
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');

sim.resetToKeyframe();
const p = new Float64Array(3), gy = new Float64Array(3), pg = new Float64Array(3), fc = new Float64Array(2);
const q = new Float64Array(sim.nu);
console.log('t | z | pg.x | footL footR | ctrl-Fehler (max) | aktuator-Kraft (max)');
for (let i = 0; i < 2500; i++) {
  sim.stepN(1);
  if (i % 250 === 0) {
    sim.basePos(p); sim.projectedGravity(pg); sim.footContacts(fc); sim.jointPositions(q);
    let maxErr = 0, maxErrJ = -1;
    for (let a = 0; a < sim.nu; a++) { const e = Math.abs(sim.ctrl[a] - q[a]); if (e > maxErr) { maxErr = e; maxErrJ = a; } }
    let maxF = 0, maxFJ = -1;
    for (let a = 0; a < sim.nu; a++) { const f = Math.abs(sim.data.actuator_force[a]); if (f > maxF) { maxF = f; maxFJ = a; } }
    console.log(`${(i * 0.002).toFixed(2)}s z=${p[2].toFixed(3)} pgx=${pg[0].toFixed(2)} f=${fc.join(',')} err=${maxErr.toFixed(3)}@${sim.actName[maxErrJ]} F=${maxF.toFixed(2)}@${sim.actName[maxFJ]}`);
  }
  sim.basePos(p);
  if (p[2] < 0.05) { console.log('GESTÜRZT bei', (i * 0.002).toFixed(2) + 's'); break; }
}
sim.dispose();
