/* Smoke-Tests: Konsole, NN, Envs (Node) — keine Browser-Abhängigkeit. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'sim', 'src');
for (const f of ['rng.js', 'nn.js', 'envs.js', 'console.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
}
const TF = globalThis.TF07;
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name + (extra ? '  ' + extra : ''));
  else { console.error('  ✗ FAIL: ' + name + (extra ? '  ' + extra : '')); fails++; }
}

console.log('== Konsole (Deutsch + JSON) ==');
{
  const S = { robot: 'duck', mode: 'manual', tod: 'day' };
  let r = TF.console.handle('trainiere den duck 120 generationen', S);
  check('deutsch: train', r.actions[0] && r.actions[0].op === 'train' && r.actions[0].robot === 'duck' && r.actions[0].gens === 120);
  r = TF.console.handle('{"cmd":"train","robot":"duck","gens":120}', S);
  check('json: train', r.actions[0].op === 'train' && r.actions[0].gens === 120);
  r = TF.console.handle('{"cmd":"robot","id":"humanoid"}', S);
  check('json: robot', r.actions[0].op === 'robot' && r.actions[0].id === 'humanoid');
  r = TF.console.handle('{"cmd":"mode","mode":"manual"}', S);
  check('json: mode', r.actions[0].op === 'mode' && r.actions[0].mode === 'manual');
  r = TF.console.handle('{"cmd":"tod","tod":"night"}', S);
  check('json: tod', r.actions[0].op === 'tod' && r.actions[0].tod === 'night');
  r = TF.console.handle('{"cmd":"save","name":"mein-champion"}', S);
  check('json: save', r.actions[0].op === 'save' && r.actions[0].name === 'mein-champion');
  r = TF.console.handle('nacht', S);
  check('deutsch: nacht', r.actions[0].op === 'tod' && r.actions[0].tod === 'night');
  r = TF.console.handle('roboter greifarm', S);
  check('deutsch: roboter arm', r.actions[0].op === 'robot' && r.actions[0].id === 'arm');
  r = TF.console.handle('stopp', S);
  check('deutsch: stopp', r.actions[0].op === 'trainStop');
  r = TF.console.handle('[{\"cmd\":\"reset\"},{\"cmd\":\"status\"}]', S);
  check('json: array', r.actions.length === 2);
  r = TF.console.handle('humbug', S);
  check('unverstanden → höflich', r.actions.length === 0 && r.replies.length > 0);
}

console.log('== NN & Policy-Format ==');
{
  const g = TF.nn.initGenome(42, 12, 2);
  check('Gewichtsanzahl duck', g.length === 12 * 32 + 32 + 32 * 32 + 32 + 2 * 32 + 2, '1536 erwartet: ' + g.length);
  const pol = TF.nn.genomeToPolicy(g, 'duck', 5, 12.5, 'lokal');
  check('format', pol.format === 'robofield-policy-v1');
  check('arch', JSON.stringify(pol.arch) === '[12,32,32,2]');
  check('weights: 6 Tensoren', pol.weights.length === 6);
  const v = TF.nn.validatePolicy(pol);
  check('roundtrip valid', v.ok);
  const g2 = TF.nn.policyToGenome(pol);
  let same = g2.length === g.length;
  for (let i = 0; i < g.length && same; i++) if (g2[i] !== g[i]) same = false;
  check('roundtrip bitgleich', same);
  const obs = new Float64Array(12).fill(0.5);
  const acts = TF.nn.forward(g, obs, 2);
  check('forward Range', acts.every(a => a >= -1 && a <= 1));
  const bad = JSON.parse(JSON.stringify(pol)); bad.arch[0] = 13;
  check('validiert arch-Fehler', TF.nn.validatePolicy(bad).ok === false);
}

console.log('== Env-Grundlagen ==');
{
  const e1 = new TF.DuckEnv(7), e2 = new TF.DuckEnv(7);
  let fit1 = 0, fit2 = 0;
  for (let i = 0; i < 300; i++) { const a = TF.nn.forward(TF.nn.initGenome(3, 12, 2), e1.getObs(), 2); fit1 += e1.step(a[0], a[1]).reward; }
  for (let i = 0; i < 300; i++) { const a = TF.nn.forward(TF.nn.initGenome(3, 12, 2), e2.getObs(), 2); fit2 += e2.step(a[0], a[1]).reward; }
  check('Duck deterministisch (gleicher Seed)', Math.abs(fit1 - fit2) < 1e-12, 'fit=' + fit1.toFixed(6));
  check('Duck obs-Dimension', e1.getObs().length === 12);
  check('Duck Ziel erreicht möglich (25er-Bonus)', e1.reached >= 0);

  const a1 = new TF.ArmEnv(9);
  const oa = a1.getObs();
  check('Arm obs-Dimension', oa.length === 15);
  const r1 = a1.step(0.2, -0.1, 0.3, 0, 1);
  check('Arm step liefert reward', typeof r1.reward === 'number' && isFinite(r1.reward));
  check('Arm FK erreichbar (ee in Reichweite)', Math.hypot(a1.ee[0], a1.ee[2]) < 1.3);

  const h1 = new TF.HumanoidEnv(5);
  check('Humanoid obs-Dimension', h1.getObs().length === 10);
  let steps = 0;
  for (let i = 0; i < 600; i++) { const out = h1.step([0.1, 0, 0, 0, 0]); steps++; if (out.done) break; }
  check('Humanoid Episode terminiert', steps <= 600, 'steps=' + steps + ' fit=' + h1.fit.toFixed(2));

  const r = TF.console.handle('hilfe', {});
  check('hilfe liefert Zeilen', r.replies.length >= 5);
}

console.log(fails === 0 ? '\nALLE TESTS BESTANDEN' : '\n' + fails + ' FEHLER');
process.exit(fails === 0 ? 0 : 1);
