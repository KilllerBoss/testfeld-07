/* Stresstest: 200 Episoden zufälliger Politiken in allen Envs.
 * Fängt: Endlosschleifen (zeitbegrenzt), NaN/Infinity, Episoden-Ende. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'sim', 'src');
for (const f of ['rng.js', 'nn.js', 'envs.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
}
const TF = globalThis.TF07;
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name + (extra ? '  ' + extra : ''));
  else { console.error('  ✗ FAIL: ' + name + (extra ? '  ' + extra : '')); fails++; }
}
console.log('== Stresstest Envs ==');
const t0 = Date.now();
for (const robot of ['duck', 'arm', 'humanoid']) {
  const nAct = TF.nn.ARCHS[robot][3];
  let totalFit = 0, eps = 0, maxSteps = 0, nan = false, reached = 0;
  for (let ep = 0; ep < 200; ep++) {
    const env = TF.makeEnv(robot, 100 + ep);
    const genome = TF.nn.initGenome(7 + ep, TF.nn.ARCHS[robot][0], nAct);
    let steps = 0;
    for (; steps < TF.EP_LEN[robot] + 5; steps++) {
      const acts = TF.nn.forward(genome, env.getObs(), nAct);
      let out;
      if (robot === 'duck') out = env.step(acts[0], acts[1]);
      else if (robot === 'arm') out = env.step(acts[0], acts[1], acts[2], acts[3], acts[4]);
      else out = env.step(acts);
      if (!isFinite(out.reward) || !isFinite(env.fit)) { nan = true; break; }
      const o = env.getObs();
      for (let k = 0; k < o.length; k++) if (!isFinite(o[k])) { nan = true; break; }
      if (out.done) break;
    }
    if (robot === 'duck') reached += env.reached;
    maxSteps = Math.max(maxSteps, steps);
    totalFit += env.fit; eps++;
    if (nan) break;
  }
  check(robot + ': 200 Episoden ohne NaN/∞', !nan);
  check(robot + ': Episoden terminieren', maxSteps <= TF.EP_LEN[robot], 'maxSteps=' + maxSteps);
  check(robot + ': Fitnesse endlich', isFinite(totalFit), 'Ø fit=' + (totalFit / eps).toFixed(2));
  if (robot === 'duck') console.log('    (Zieltreffer mit Zufalls-Policies: ' + reached + ')');
}
console.log('    Dauer: ' + (Date.now() - t0) + ' ms');
console.log(fails === 0 ? '\nSTRESSTEST BESTANDEN' : '\n' + fails + ' FEHLER');
process.exit(fails ? 1 : 0);
