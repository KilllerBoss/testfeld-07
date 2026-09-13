// update_diag.mjs — Was passiert genau beim ersten PPO-Update (a1)?
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
const { PPO, finiteArr } = await import(path.join(WWW, 'js/train.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

const cfg = getRobot('a1');
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');
const task = cfg.task(cfg);
const trainer = new PPO(task.obsDim, task.actDim, {}, 99);
const obs = new Float32Array(task.obsDim);
task.reset(new RNG(1), sim);

for (let i = 0; i < 1200; i++) {
  if (task.stepsLeft <= 0) task.sampleCmd(trainer.rng);
  task.observe(sim, obs);
  if (!finiteArr(obs)) { console.log('STEP', i, 'obs NICHT endlich'); sim.reset(); task.reset(trainer.rng, sim); continue; }
  trainer.norm.update(obs);
  const { act, logp, value } = trainer.act(obs, false);
  if (i >= 1020 && i <= 1030) console.log('step', i, 'act:', Array.from(act.slice(0, 4)).map(v => v.toFixed(3)).join(','), 'r?');
  task.actionToCtrl(sim, act);
  sim.stepN(Math.max(1, Math.round(0.02 / sim.timestep)));
  const { r, done } = task.reward(sim);
  for (let k = 0; k < act.length; k++) task.lastAct[k] = act[k];
  const full = trainer.store(obs, act, logp, r, done, value);
  if (done) { sim.reset(); task.reset(trainer.rng, sim); }
  if (full) {
    const lastObs = task.observe(sim, obs);
    const v = trainer.act(lastObs, true).value;
    const m = trainer.finishAndUpdate(v);
    // Nach dem Update: Gewichte prüfen
    let nanW = 0;
    const w = trainer.pi ? trainer.pi : null;
    console.log('UPDATE @', i, '— Metriken:', JSON.stringify(m && m._lastMetrics ? m._lastMetrics : m).slice(0, 300));
    const { act: act2 } = trainer.act(task.observe(sim, obs), false);
    console.log('act nach Update:', Array.from(act2.slice(0, 4)).map(x => (+x).toFixed(3)).join(','), 'finite?', finiteArr(act2));
  }
}
sim.dispose();
