/* Mirror-Runner: <robot> <seed> <steps> <genomeSeed>
 * Fährt die JS-Env mit festem Genom und druckt Fit + Obs als JSON
 * (volle double-Genauigkeit) — Vergleichspartner für kaggle/mirror_run.py. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'sim', 'src');
for (const f of ['rng.js', 'nn.js', 'envs.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
}
const TF = globalThis.TF07;
const [robot, seed, steps, genomeSeed] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const env = TF.makeEnv(robot, seed);
const nAct = TF.nn.ARCHS[robot][3];
const genome = TF.nn.initGenome(genomeSeed, TF.nn.ARCHS[robot][0], nAct);
let done = false;
for (let i = 0; i < steps && !done; i++) {
  const a = TF.nn.forward(genome, env.getObs(), nAct);
  if (robot === 'duck') done = env.step(a[0], a[1]).done;
  else if (robot === 'arm') done = env.step(a[0], a[1], a[2], a[3], a[4]).done;
  else done = env.step(a).done;
}
const obs = env.getObs();
console.log(JSON.stringify({
  fit: env.fit,
  steps: env.steps,
  reached: env.reached || env.delivered || 0,
  obs: Array.from(obs)
}));
