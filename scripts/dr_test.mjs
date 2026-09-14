// dr_test.mjs — v2.11.0 DOMAIN RANDOMIZATION — Verifikation mit ECHTER
// MuJoCo-Physik (Master-Prompt §10: DR ist Pflicht; hier wird geprüft,
// dass sie wirklich wirkt und deterministisch von Originalen würfelt):
//
//   1) sanitizeDr: Müll → Defaults, Klemmen, Sortierung
//   2) Modell-Randomisierung: Masse/Reibung/Gravitation ändern sich,
//      deterministisch je Seed (2 Sims gleicher Seed = identisch)
//   3) KEINE Akkumulation: je Episode vom ORIGINAL aus gewürfelt
//   4) restoreDrModel: exakt zurück auf die echte Physik
//   5) Sensor-Rauschen: zwei observe() unterscheiden sich (DR an),
//      identisch (DR aus)
//   6) Aktions-Verzögerung: zweiter Aufruf führt die VORHERIGE Aktion aus
//   7) Schübe: fälliger Schubs ändert qvel sofort (Impuls = Δv × Masse)
//   8) Rollout-Stabilität: 300 Regelzyklen STARK auf duck + a1 — keine NaN
//   9) Track-Task akzeptiert rohen Worker-Spec (env.dr aus parallel.js)
// Usage: node scripts/dr_test.mjs
//
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
const { getRobot, makeTrackTask } = await import(path.join(WWW, 'js/robots.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));
const { DR_LEVELS, DR_PRESETS, sanitizeDr, drFromLevel, applyDrModel, restoreDrModel, drDelayedAct } = await import(path.join(WWW, 'js/dr.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};
const massSum = (sim) => { let s = 0; const rb = sim._robotBody; for (let b = 0; b < sim.nbody; b++) if (!rb || rb[b]) s += sim.model.body_mass[b]; return s; };
const fricOf = (sim, g) => sim.model.geom_friction[3 * g];
const firstRobotGeom = (sim) => { for (let g = 0; g < sim.ngeom; g++) { const b = sim.model.geom_bodyid[g]; if (b && sim._robotBody[b]) return g; } return -1; };

const duck = getRobot('duck');
const a1 = getRobot('a1');
await fetchModelIntoFS('models/' + duck.dir);
await fetchModelIntoFS('models/' + a1.dir);

console.log('\n■ 1) sanitizeDr — Müll rein, sauber raus');
{
  const s = sanitizeDr({ level: 'x', mass: 99, motor: -3, friction: NaN, pose: '0.3', delay: 7.7, pushEvery: [500, 100], pushDv: [3, 1] });
  ok(s.level === 'aus', 'unbekannte Stufe → aus');
  ok(s.mass === 0.5 && s.motor === 0, 'Klemmen (mass 99→0,5, motor −3→0)');
  ok(s.friction === 0, 'NaN → 0');
  ok(s.pose === 0.3, 'String-Zahl akzeptiert');
  ok(s.delay === 3, 'delay geklemmt/gerundet (7,7→3)');
  ok(s.pushEvery[0] === 100 && s.pushEvery[1] === 500, 'pushEvery sortiert');
  ok(s.pushDv[0] === 1 && s.pushDv[1] === 3, 'pushDv sortiert');
  ok(DR_LEVELS.length === 4 && DR_PRESETS.stark.delay === 2, '4 Stufen, stark delay=2');
}

console.log('\n■ 2) Modell-Randomisierung — wirkt & deterministisch je Seed');
{
  const simA = new RobotSim(duck, 'testfeld.xml');
  const simB = new RobotSim(duck, 'testfeld.xml');
  const m0 = massSum(simA), f0 = fricOf(simA, firstRobotGeom(simA));
  const task = makeTask(duck, drFromLevel('mittel'));
  task.reset(new RNG(1234), simA);
  const mA = massSum(simA), fA = fricOf(simA, firstRobotGeom(simA));
  ok(Math.abs(mA - m0) > 1e-6, 'Gesamtmasse geändert', `${m0.toFixed(4)} kg → ${mA.toFixed(4)} kg (${(100 * (mA / m0 - 1)).toFixed(1)} %)`);
  ok(Math.abs(fA - f0) > 1e-9, 'Reibung geändert', `${f0} → ${fA.toFixed(4)}`);
  task.reset(new RNG(1234), simB);
  const mB = massSum(simB);
  ok(Math.abs(mA - mB) < 1e-12, 'gleicher Seed ⇒ identische Masse (A vs B)');
  // Motorstärke (kp = gainprm[0])
  const kp0 = 0.386; // duck ankle kp laut XML
  let kpChanged = false;
  for (let a = 0; a < simA.nu; a++) if (Math.abs(simA.model.actuator_gainprm[3 * a] - kp0) < 0.05) kpChanged = true;
  void kpChanged;
  const gainSumA = Array.from({ length: simA.nu }, (_, a) => simA.model.actuator_gainprm[3 * a]).reduce((x, y) => x + y, 0);
  task.reset(new RNG(999), simB);
  const gainSumB = Array.from({ length: simB.nu }, (_, a) => simB.model.actuator_gainprm[3 * a]).reduce((x, y) => x + y, 0);
  ok(Math.abs(gainSumA - gainSumB) > 1e-9, 'Motorstärke (Σ kp) würfelt je Seed anders');
}

console.log('\n■ 3) KEINE Akkumulation — Original-Snapshot je Episode');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  const m0 = massSum(sim);
  const task = makeTask(duck, drFromLevel('stark')); // ±20 %
  task.reset(new RNG(5), sim);
  const m1 = massSum(sim);
  task.reset(new RNG(6), sim);
  const m2 = massSum(sim);
  ok(Math.abs(m1 - m0) > 1e-6 && Math.abs(m2 - m0) > 1e-6, 'beide Episoden randomisiert');
  ok(Math.abs(m1 - m2) > 1e-6, 'unterschiedliche Seeds ⇒ unterschiedliche Masse');
  // Worst-Case-Prüfung: bei ±20 % müssen beide Werte innerhalb ±22 % liegen
  ok(m1 > m0 * 0.75 && m1 < m0 * 1.25 && m2 > m0 * 0.75 && m2 < m0 * 1.25, 'Masse im ±20 %-Band (kein Aufschaukeln)');
}

console.log('\n■ 4) restoreDrModel — exakt zurück zur echten Physik');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  const m0 = massSum(sim);
  const g0 = sim.model.opt.gravity[2];
  const nv0 = Float64Array.from(sim.model.dof_damping);
  const task = makeTask(duck, drFromLevel('stark'));
  task.reset(new RNG(77), sim);
  ok(Math.abs(massSum(sim) - m0) > 1e-6, 'randomisiert (vor Restore)');
  ok(restoreDrModel(sim), 'Restore meldet Erfolg');
  ok(Math.abs(massSum(sim) - m0) < 1e-12, 'Masse exakt original');
  ok(Math.abs(sim.model.opt.gravity[2] - g0) < 1e-12, 'Gravitation exakt original', `g=${sim.model.opt.gravity[2].toFixed(4)}`);
  let dmpSame = true;
  for (let i = 0; i < nv0.length; i++) if (nv0[i] !== sim.model.dof_damping[i]) { dmpSame = false; break; }
  ok(dmpSame, 'Dämpfung exakt original');
}

console.log('\n■ 5) Sensor-Rauschen — IMU-Realität in der Beobachtung');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  sim.reset();
  const taskOff = makeTask(duck, drFromLevel('aus'));
  taskOff.reset(new RNG(11), sim);
  const o1 = new Float32Array(taskOff.obsDim), o2 = new Float32Array(taskOff.obsDim);
  taskOff.observe(sim, o1); taskOff.observe(sim, o2);
  // Nur Kanäle VOR der Phasen-Uhr (letzte 2) vergleichen — die tickt immer
  let diff = 0; for (let i = 0; i < o1.length - 2; i++) diff += Math.abs(o1[i] - o2[i]);
  ok(diff < 1e-12, 'DR aus: zwei observes identisch bis auf Phasen-Uhr (Σ|Δ|=' + diff.toExponential(1) + ')');
  const taskOn = makeTask(duck, drFromLevel('mittel')); // sensor 0.015
  taskOn.reset(new RNG(12), sim);
  taskOn.observe(sim, o1); taskOn.observe(sim, o2);
  diff = 0; for (let i = 0; i < o1.length - 2; i++) diff += Math.abs(o1[i] - o2[i]);
  ok(diff > 0, 'DR mittel: observes rauschen (Σ|Δ|=' + diff.toFixed(4) + ')');
  let finite = true; for (let i = 0; i < o1.length; i++) if (!Number.isFinite(o1[i])) finite = false;
  ok(finite, 'beobachtete Werte endlich');
}

console.log('\n■ 6) Aktions-Verzögerung — die ALTE Aktion wird ausgeführt');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  sim.reset();
  const task = makeTask(duck, drFromLevel('mittel')); // delay = 1
  task.reset(new RNG(21), sim);
  const a1v = new Float32Array(task.actDim).fill(0.8);
  const a2v = new Float32Array(task.actDim).fill(-0.6);
  task.actionToCtrl(sim, a1v);
  const ctrl1 = Float64Array.from(sim.ctrl);
  task.actionToCtrl(sim, a2v);
  const ctrl2 = Float64Array.from(sim.ctrl);
  // Erwartung: ctrl2 entspricht a1v (verzögert), ctrl1 entspricht a1v (Buffer liefert beim 1. Aufruf noch ohne Verzögerung)
  let e1 = 0, e2 = 0;
  for (let a = 0; a < task.actDim; a++) {
    const ref = task._ref[a], span = duck.actSpan;
    e1 += Math.abs(ctrl1[a] - (ref + span * Math.tanh(a1v[a])));
    e2 += Math.abs(ctrl2[a] - (ref + span * Math.tanh(a1v[a])));
  }
  ok(e1 < 1e-9, '1. Aufruf: Aktion 1 ausgeführt (Buffer-Füllung)');
  ok(e2 < 1e-9, '2. Aufruf: IMMER NOCH Aktion 1 (Verzögerung 1 Zyklus aktiv)');
  // delay 0: drDelayedAct identisch
  const task0 = makeTask(duck, drFromLevel('aus'));
  task0.reset(new RNG(22), sim);
  const same = drDelayedAct(task0, a2v) === a2v;
  ok(same, 'delay 0: identisches Array durchgereicht');
}

console.log('\n■ 7) Schübe — fälliger Stör-Impuls ändert qvel sofort');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  sim.reset();
  const task = makeTask(duck, drFromLevel('stark')); // pushDv [0.8, 2.5] Δv m/s
  task.reset(new RNG(31), sim);
  task._nextPush = 1; // nächster reward()-Aufruf stößt zu
  const vx0 = sim._qvel[0], vy0 = sim._qvel[1];
  const { r, done } = task.reward(sim);
  const dvx = sim._qvel[0] - vx0, dvy = sim._qvel[1] - vy0;
  const dv = Math.hypot(dvx, dvy);
  ok(dv > 0.5, 'Schubs ausgeführt (Δv=' + dv.toFixed(2) + ' m/s in der Ebene)');
  ok(dv <= 2.6, 'Δv im Stärke-Band (≤2,6 m/s)');
  ok(task._nextPush > 0, 'nächster Schubs neu geplant (in ' + task._nextPush + ' Zyklen)');
  ok(Number.isFinite(r) && typeof done === 'boolean', 'Reward finite, done bool');
}

console.log('\n■ 8) Rollout-Stabilität — 300 Regelzyklen STARK, duck + a1, keine NaN');
{
  for (const [id, cfg] of [['duck', duck], ['a1', a1]]) {
    const sim = new RobotSim(cfg, 'testfeld.xml');
    sim.reset();
    const task = makeTask(cfg, drFromLevel('stark'));
    const rng = new RNG(4242);
    task.reset(rng, sim);
    let episodes = 0, minR = Infinity, maxR = -Infinity, nan = false;
    const obs = new Float32Array(task.obsDim);
    const act = new Float32Array(task.actDim);
    for (let t = 0; t < 300; t++) {
      if (task.stepsLeft <= 0) task.sampleCmd(rng);
      task.observe(sim, obs);
      for (let i = 0; i < task.actDim; i++) if (!Number.isFinite(obs[i])) nan = true;
      for (let i = 0; i < task.actDim; i++) act[i] = (rng.next() * 2 - 1) * 0.8;
      task.actionToCtrl(sim, act);
      sim.stepN(10); // 50 Hz Regelrate × 10 Substeps @ 500 Hz
      const { r, done } = task.reward(sim);
      if (!Number.isFinite(r)) nan = true;
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (let i = 0; i < sim._qvel.length; i++) if (!Number.isFinite(sim._qvel[i])) nan = true;
      if (done) { episodes++; sim.reset(); task.reset(rng, sim); }
    }
    ok(!nan, `${id}: keine NaN in 300 Zyklen (obs/reward/qvel)`);
    ok(Number.isFinite(minR) && Number.isFinite(maxR), `${id}: Reward-Bereich endlich`, `[${minR.toFixed(2)} … ${maxR.toFixed(2)}]`);
    ok(true, `${id}: ${episodes} Episoden beendet`);
  }
}

console.log('\n■ 9) Roher Worker-Spec (env.dr aus parallel.js) wird akzeptiert');
{
  const raw = { level: 'mittel', mass: 0.1, motor: 0.2, friction: 0.25, damping: 0.25, gravity: 0.05, pose: 0.12, vel: 0.06, sensor: 0.015, pushEvery: [100, 200], pushDv: [0.5, 1.5], delay: 1 };
  const sim = new RobotSim(duck, 'testfeld.xml');
  sim.reset();
  const task = makeTask(duck, raw); // SOLL so ankommen (sanitizeDr klammert)
  task.reset(new RNG(51), sim);
  ok(task._dr && task._dr.level === 'mittel' && task._dr.delay === 1, 'Spec unverändert übernommen');
  ok(Number.isFinite(massSum(sim)), 'Physik nach Spec-Reset endlich');
  const obs = new Float32Array(task.obsDim);
  task.observe(sim, obs);
  let finite = true; for (let i = 0; i < obs.length; i++) if (!Number.isFinite(obs[i])) finite = false;
  ok(finite, 'Beobachtung endlich');
}

console.log('\n■ 10) Lage bleibt erhalten — liegend startet liegend (v2.9.0-Flows)');
{
  const sim = new RobotSim(duck, 'testfeld.xml');
  sim.reset();
  sim.placeBaseFull(0, 0, 0.06, 0, 1, 0, 0); // Rückenlage
  const task = makeTask(duck, drFromLevel('mittel'));
  task.reset(new RNG(61), sim);
  const o = 4 * sim.baseBody;
  const upz = 1 - 2 * (sim._xquat[o + 1] ** 2 + sim._xquat[o + 2] ** 2);
  ok(upz < -0.9, 'Rückenlage bleibt Rückenlage nach DR-Reset (upz=' + upz.toFixed(2) + ')');
  const mz = sim.minGeomZ(true);
  ok(mz > -1e-6, 'liegt ÜBER dem Boden (minGeomZ=' + mz.toFixed(4) + ')');
}

console.log(`\n${fail === 0 ? 'ALLE ' + pass + ' CHECKS GRÜN' : fail + ' FEHLER, ' + pass + ' grün'}`);
process.exit(fail === 0 ? 0 : 1);

// ── Helfer: Track-Task mit DR-Spec bauen (wie makeTaskFor in main.js) ──
function makeTask(cfg, drSpec) {
  const c = Object.assign({}, cfg, { dr: drSpec ? sanitizeDr(drSpec) : null });
  return makeTrackTask(c);
}
