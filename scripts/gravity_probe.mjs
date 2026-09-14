import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const b = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString("utf8")), text: async () => b.toString("utf8") };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot, makeTrackTask } = await import(path.join(WWW, 'js/robots.js'));
const { drFromLevel } = await import(path.join(WWW, 'js/dr.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));
await fetchModelIntoFS('models/unitree_g1');
const cfg = getRobot('g1'); cfg.dr = drFromLevel('stark');
const sim = new RobotSim(cfg, 'testfeld.xml');
const g0 = sim.model.opt.gravity[2];
const vals = new Set();
for (let k = 0; k < 8; k++) {
  sim.model.opt.gravity[2] = g0;
  const t = makeTrackTask({ ...cfg });
  t.reset(new RNG(100 + k), sim);
  vals.add(sim.model.opt.gravity[2].toFixed(4));
}
console.log('g0 =', g0, '| 8 Seeds →', [...vals].join(', '), '| schreibbar:', vals.size > 1);
