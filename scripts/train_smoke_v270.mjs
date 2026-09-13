// train_smoke_v270.mjs — Echtes PPO-Training auf den neuen Robotern (go2, duck)
// + G1 in einer Zufallswelt: obs→act→step→reward→store→update-Zyklus muss
// mit der neuen Sensorik-Dimension laufen (finale Werte endlich, Updates OK).
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
const { initEngine, fetchModelIntoFS, RobotSim, writeWorldFile } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { PPO, finiteArr } = await import(path.join(WWW, 'js/train.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

async function trainSmoke(id, worldId = 'testfeld', seed = 7) {
  const cfg = getRobot(id);
  await fetchModelIntoFS('models/' + cfg.dir);
  writeWorldFile(cfg.dir, 'welt_test.xml', buildWorldXML(cfg, worldId, seed));
  const sim = new RobotSim(cfg, 'welt_test.xml');
  const task = cfg.task(cfg);
  const trainer = new PPO(task.obsDim, task.actDim, {}, 99);
  const obs = new Float32Array(task.obsDim);
  task.reset(new RNG(1), sim);
  let steps = 0, episodes = 0, finite = true, updated = 0;
  for (let i = 0; i < 3000; i++) {
    if (task.stepsLeft <= 0) task.sampleCmd(trainer.rng);
    task.observe(sim, obs);
    if (!finiteArr(obs)) { finite = false; break; }
    trainer.norm.update(obs);
    const { act, logp, value } = trainer.act(obs, false);
    task.actionToCtrl(sim, act);
    sim.stepN(Math.max(1, Math.round(0.02 / sim.timestep)));
    if (task.kind === 'motion') task.advance(0.02);
    const { r, done } = task.reward(sim);
    for (let k = 0; k < act.length; k++) task.lastAct[k] = act[k];
    const full = trainer.store(obs, act, logp, r, done, value);
    if (done) { episodes++; sim.reset(); task.reset(trainer.rng, sim); }
    if (full) { const lastObs = task.observe(sim, obs); const v = trainer.act(lastObs, true).value; trainer.finishAndUpdate(v); updated++; }
    steps++;
  }
  check(`${id}/${worldId}: 3000 Trainingschritte endlich`, finite && steps === 3000, `${steps} Schritte, ${episodes} Episoden`);
  check(`${id}/${worldId}: PPO-Updates vollzogen`, updated >= 2, `${updated} Updates, stepCount=${trainer.stepCount}`);
  check(`${id}/${worldId}: obsDim = ${3 * cfg.nu + 8 + 9 + cfg.footBodies.length}`, task.obsDim === 3 * cfg.nu + 17 + cfg.footBodies.length, task.obsDim + '');
  sim.dispose();
}

await trainSmoke('go2');
await trainSmoke('duck');
await trainSmoke('g1', 'zufall', 12345);
console.log(fails === 0 ? '\nTRAINING-SMOKE GRÜN' : `\n${fails} FEHLER`);
process.exit(fails === 0 ? 0 : 1);
