// grad_diag.mjs — Wo genau entsteht das NaN im PPO-Update?
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
const trainPath = path.join(WWW, 'js/train.js');
const { PPO, finiteArr } = await import(trainPath);
const { RNG } = await import(path.join(WWW, 'js/math.js'));

// Adaptive Instrumentierung: fange die erste nicht-endliche Größe
const cfg = getRobot('a1');
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');
const task = cfg.task(cfg);
const trainer = new PPO(task.obsDim, task.actDim, {}, 99);
const obs = new Float32Array(task.obsDim);
task.reset(new RNG(1), sim);

let mbCount = 0;
const origAdam = PPO.prototype._adamStep;
// Prototypen-Patch auf der INSTANZ
trainer._adamStep = function () {
  mbCount++;
  let worst = 0, worstName = '';
  for (const [p, g] of [['W1', 'gW1'], ['b1', 'gb1'], ['W2', 'gW2'], ['b2', 'gb2'], ['Wm', 'gWm'], ['bm', 'gbm'], ['Wv', 'gWv'], ['bv', 'gbv'], ['logStd', 'gLogStd']]) {
    const G = this.net[g];
    let mx = 0;
    for (let i = 0; i < G.length; i++) { const v = Math.abs(G[i]); if (!(v <= Infinity)) { console.log(`MB ${mbCount}: ${g}[${i}] = ${G[i]} (NaN/Inf)`); } else if (v > mx) mx = v; }
    if (mx > worst) { worst = mx; worstName = g; }
  }
  if (mbCount <= 5 || worst > 1e6) console.log(`MB ${mbCount}: max|g| = ${worst.toExponential(2)} @ ${worstName}`);
  origAdam.call(this);
};

let stored = [];
for (let i = 0; i < 1030; i++) {
  if (task.stepsLeft <= 0) task.sampleCmd(trainer.rng);
  task.observe(sim, obs);
  if (!finiteArr(obs)) { console.log('obs NaN @', i); sim.reset(); task.reset(trainer.rng, sim); continue; }
  trainer.norm.update(obs);
  const { act, logp, value } = trainer.act(obs, false);
  if (!Number.isFinite(logp)) console.log('logp NaN @', i);
  for (let k = 0; k < act.length; k++) if (!Number.isFinite(act[k])) console.log('act NaN @', i);
  task.actionToCtrl(sim, act);
  sim.stepN(Math.max(1, Math.round(0.02 / sim.timestep)));
  const { r, done } = task.reward(sim);
  if (!Number.isFinite(r)) console.log('reward NaN @', i);
  for (let k = 0; k < act.length; k++) task.lastAct[k] = act[k];
  const full = trainer.store(obs, act, logp, r, done, value);
  if (done) { sim.reset(); task.reset(trainer.rng, sim); }
  if (full) {
    const lastObs = task.observe(sim, obs);
    const v = trainer.act(lastObs, true).value;
    console.log('lastVal:', v);
    const m = trainer.finishAndUpdate(v);
    console.log('Metriken:', JSON.stringify(m));
    let nan = false;
    for (const p of ['W1', 'b1', 'W2', 'b2', 'Wm', 'bm', 'Wv', 'bv', 'logStd']) {
      for (const x of trainer.net[p]) if (!Number.isFinite(x)) { nan = true; break; }
      if (nan) { console.log('NETZ NaN ab Parameter:', p); break; }
    }
    if (!nan) console.log('Netz nach Update endlich');
    break;
  }
}
sim.dispose();
