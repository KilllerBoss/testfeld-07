// Debug: Welche Aktuatoren verletzen die Spiegel-Identität?
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
const wasmBuf = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { mirrorMotionY } = await import(path.join(WWW, 'js/retarget.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_dbg.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_dbg.xml');
const nu = sim.nu;

const fk = (q) => {
  const g = sim.makeGhostData();
  sim.setGhostPose(g, q, 0, 0.8, 0, 0, 0, null);
  const out = [];
  for (let b = 0; b < sim.nbody; b++) out.push([g.xpos[3 * b], g.xpos[3 * b + 1], g.xpos[3 * b + 2]]);
  return out;
};
const errOf = (pa, pb) => {
  let mx = 0, bi = -1;
  for (let b = 1; b < sim.nbody; b++) {
    const e = Math.hypot(pa[b][0] - pb[b][0], pa[b][1] + pb[b][1], pa[b][2] - pb[b][2]);
    if (e > mx) { mx = e; bi = b; }
  }
  return { mx, bi };
};

// 1) Null-Konfiguration: Spiegel von 0 = 0 → FK muss identisch sein
{
  const q = new Float32Array(nu);
  const pm = fk(q);
  const e = errOf(fk(q), pm);
  console.log('Null-Konfig: maxErr', e.mx.toExponential(2), 'body', e.bi);
}
// 2) Je Aktuator einzeln ±0.5 rad — der Spiegel muss FK-identisch sein
console.log('\nJe-Aktuator-Probe (θ=±0.5):');
const mjName = (b) => { try { return sim._mjApi.mj_id2name(sim.model, 1, b); } catch (e) { return String(b); } };
for (let a = 0; a < nu; a++) {
  const q1 = new Float32Array(nu); q1[a] = 0.5;
  const mirrored = new Float32Array(nu);
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  mirrored.set(m1.q);
  const e = errOf(fk(mirrored), fk(q1));
  const diffBodies = [];
  const pa = fk(mirrored), pb = fk(q1);
  for (let b = 1; b < sim.nbody; b++) {
    const ee = Math.hypot(pa[b][0] - pb[b][0], pa[b][1] + pb[b][1], pa[b][2] - pb[b][2]);
    if (ee > 1e-4) diffBodies.push(mjName(b) + ':' + ee.toFixed(3));
  }
  const flag = e.mx > 1e-4 ? ' ✗' : '';
  console.log(`  ${sim.actName[a].padEnd(30)} k=${signK(m1.q[a], 0.5)} maxErr=${e.mx.toFixed(4)} (${mjName(e.bi)})${flag}${diffBodies.length ? ' → ' + diffBodies.slice(0, 5).join(' ') : ''}`);
}
function signK(got, want) { return Math.abs(got - want) < 1e-9 ? '+0.5' : Math.abs(got + want) < 1e-9 ? '−0.5' : (got / want).toFixed(2); }
