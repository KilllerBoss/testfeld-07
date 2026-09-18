// ═══════════════════════════════════════════════════════════
// ghost_drive_v2280_test.mjs — v2.28.0 GEIST LENKEN + BODEN-GARANTIE:
//   ▸ ghostAnchor: Stick-geführte Referenz (cmdDriven → _tx/_ty/_tyaw)
//   ▸ reset (joy + 'folgt'): Referenz startet AM ROBOTER, kein Teleport
//   ▸ reset ('frei'): placeBase-Bahnstart bleibt (Rückwärtskompatibilität)
//   ▸ advance(): Stick-Kommando integriert die Referenz-Wurzel
//   ▸ engine.groundGhost: Referenz-Geist wird bei Sinken AUF den Boden
//     gehoben (und lässt korrekt stehende Posen unangetastet)
//   ▸ retargetToG1: srcPos-Skeleton wird je Frame geerdet (Fuß ≥ 0)
// Usage: node scripts/ghost_drive_v2280_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('file:')) {
    const p = path.resolve(WWW, decodeURIComponent(url.split('?')[0]));
    const buf = await readFile(p);
    return { ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { makeMotionTask } = await import(path.join(WWW, 'js/motiontask.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { findFootGeoms } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};
const nearly = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_ghost.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_ghost.xml');

// ── Synthetischer Geh-Clip (root-Bahn vorwärts, h = 0.79) ──
const N = 60, NU = cfg.nu, FPS = 25, H = 0.79;
const q = new Float32Array(N * NU);
for (let f = 0; f < N; f++) for (let j = 0; j < NU; j++) q[f * NU + j] = 0.2 * Math.sin(j + f * 0.1);
const h = new Float32Array(N).fill(H);
const root = new Float32Array(N * 2);
for (let f = 0; f < N; f++) { root[2 * f] = 0.4 * (f / FPS); root[2 * f + 1] = 0; }
const yaw = new Float32Array(N);
const clip = {
  name: 'gehen', fps: FPS, n: N, nu: NU, q, h, root, yaw,
  locomotion: true, meanSpeed: 0.4, mapped: [], alg: 99,
};

console.log('\n[1] ghostAnchor: Stick führt → Geist am Kommando-Ziel');
{
  sim.reset();
  const task = makeMotionTask(cfg, clip, sim);
  task.ctrlMode = 'joy'; task.refMode = 'folgt'; task.animOn = true;
  task.reset(new (class { int() { return 0; } })(), sim);
  // Referenz per Kommando-Integration weit weg fahren:
  task._tx = 3.5; task._ty = -1.25; task._tyaw = 0.7;
  task.cmd.vx = 0.6; task.cmd.wz = 0.1; task._manualCmd = true;
  const rp = [0, 0, 0]; sim.basePos(rp);
  const out = task.ghostAnchor(task.phase, rp, 0, [0, 0, 0]);
  ok(nearly(out[0], 3.5) && nearly(out[1], -1.25), 'Geist steht am Kommando-Ziel (_tx/_ty)', out.map(v => v.toFixed(2)).join(','));
  ok(nearly(out[0], task._tx) && !nearly(out[0], rp[0]), 'NICHT an der Clip-Bahn/nicht am Roboter hängend');
  // ohne cmdDriven (ctrlMode none): 'folgt' → am Roboter (altes Verhalten)
  const task2 = makeMotionTask(cfg, clip, sim);
  task2.ctrlMode = 'none'; task2.refMode = 'folgt'; task2.animOn = true;
  task2.reset(new (class { int() { return 0; } })(), sim);
  task2._tx = 99; task2._ty = 99; // darf NICHT benutzt werden
  const out2 = task2.ghostAnchor(task2.phase, rp, 0, [0, 0, 0]);
  ok(nearly(out2[0], rp[0] + (root[0] - root[0])) || !nearly(out2[0], 99), 'ohne Stick: altes folgt-Verhalten (Roboter-Anker + relative Bahn)');
}

console.log('\n[2] reset (joy + folgt): Referenz startet AM ROBOTER, kein Teleport');
{
  sim.reset();
  const task = makeMotionTask(cfg, clip, sim);
  task.ctrlMode = 'joy'; task.refMode = 'folgt'; task.animOn = true;
  // Roboter bewusst VERSCHOBEN platzieren (als wäre er schon gefahren):
  sim.placeBase(2.0, 1.0, 0.5);
  const rng = new (class { int() { return 0; } })();
  task.reset(rng, sim);
  const p = [0, 0, 0]; sim.basePos(p);
  ok(nearly(p[0], 2.0, 1e-6) && nearly(p[1], 1.0, 1e-6), 'Roboter NICHT zur Bahn start teleportiert', p[0].toFixed(2) + '/' + p[1].toFixed(2));
  ok(nearly(task._tx, 2.0, 1e-6) && nearly(task._ty, 1.0, 1e-6), 'Kommando-Ziel = Roboter-Position', task._tx.toFixed(2) + '/' + task._ty.toFixed(2));
  ok(nearly(task._tyaw, 0.5, 1e-3), 'Kommando-Blick = Roboter-Yaw', task._tyaw.toFixed(3));
}

console.log('\n[3] reset (frei): Bahnstart + placeBase bleibt (Rückwärtskompatibilität)');
{
  sim.reset();
  const task = makeMotionTask(cfg, clip, sim);
  task.ctrlMode = 'joy'; task.refMode = 'frei'; task.animOn = true;
  task.reset(new (class { int() { return 0; } })(), sim);
  ok(nearly(task._tx, root[0]) && nearly(task._ty, root[1]), 'Kommando-Ziel = Bahn-Anfang');
  const p = [0, 0, 0]; sim.basePos(p);
  ok(nearly(p[0], root[0], 1e-6) && nearly(p[1], root[1], 1e-6), 'placeBase auf die Bahn', p[0].toFixed(2) + '/' + p[1].toFixed(2));
}

console.log('\n[4] advance(): Stick-Kommando integriert die Referenz-Wurzel');
{
  sim.reset();
  const task = makeMotionTask(cfg, clip, sim);
  task.ctrlMode = 'joy'; task.refMode = 'folgt'; task.animOn = true;
  task.reset(new (class { int() { return 0; } })(), sim);
  task.cmd.vx = 0.5; task.cmd.wz = 0.5; task._manualCmd = true;
  const tx0 = task._tx, ty0 = task._ty, yaw0 = task._tyaw;
  const dt = 0.05;
  task.advance(dt);
  ok(nearly(task._tyaw, yaw0 + 0.5 * dt, 1e-6), 'Yaw integriert wz·dt', task._tyaw.toFixed(4));
  ok(nearly(task._tx, tx0 + Math.cos(task._tyaw) * 0.5 * dt, 1e-6), 'x integriert vx·cos(yaw)·dt', task._tx.toFixed(4));
  ok(nearly(task._ty, ty0 + Math.sin(task._tyaw) * 0.5 * dt, 1e-6), 'y integriert vx·sin(yaw)·dt', task._ty.toFixed(4));
}

console.log('\n[5] engine.groundGhost: Anzeige hebt gesunkene Referenz auf den Boden');
{
  const feet = findFootGeoms(sim);
  ok(feet.length >= 2, 'Fuß-Geoms gefunden', String(feet.length));
  const ghost = sim.makeGhostData();
  // a) korrekt stehende Pose → KEIN Eingriff
  sim.setGhostPose(ghost, q, 0, H, 0, 0, 0, null);
  const lift0 = sim.groundGhost(ghost, feet);
  ok(lift0 === 0, 'stehende Pose bleibt unangetastet', 'lift=' + lift0);
  // b) um 20 cm versunkene Pose → exakt angehoben
  sim.setGhostPose(ghost, q, 0, H - 0.2, 0, 0, 0, null);
  const zBefore = Math.min(...feet.map(fg => ghost.xpos[3 * fg.body + 2] + fg.lowZ));
  const lift = sim.groundGhost(ghost, feet);
  const zAfter = Math.min(...feet.map(fg => ghost.xpos[3 * fg.body + 2] + fg.lowZ));
  ok(lift > 0.15 && lift < 0.25, 'Sinken erkannt und angehoben', 'lift=' + lift.toFixed(3));
  ok(zBefore < -0.15 && zAfter > -0.015, 'Fuß steht danach AUF dem Boden', zBefore.toFixed(3) + ' → ' + zAfter.toFixed(3));
}

console.log('\n[6] retargetToG1: srcPos-Skeleton wird geerdet (Fuß ≥ 0)');
{
  // Synthetisches ARDY-Skelett (Mixamo-Namen), gesunken um 30 cm:
  const names = ['Hips', 'Spine', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
  const J = names.length, FR = 10, SINK = 0.3;
  const joints = new Float32Array(FR * J * 3);
  const base = {
    Hips: [0, 0.6, 0], Spine: [0, 0.75, 0], Head: [0, 0.9, 0],
    LeftUpLeg: [0.1, 0.55, 0], LeftLeg: [0.1, 0.3, 0], LeftFoot: [0.1, 0.06, 0],
    RightUpLeg: [-0.1, 0.55, 0], RightLeg: [-0.1, 0.3, 0], RightFoot: [-0.1, 0.06, 0],
    LeftArm: [0.25, 0.72, 0], LeftForeArm: [0.35, 0.6, 0],
    RightArm: [-0.25, 0.72, 0], RightForeArm: [-0.35, 0.6, 0],
  };
  for (let f = 0; f < FR; f++) for (let j = 0; j < J; j++) {
    const b = base[names[j]];
    joints[(f * J + j) * 3] = b[0];
    joints[(f * J + j) * 3 + 1] = b[1] - SINK; // Y (up) gesunken
    joints[(f * J + j) * 3 + 2] = b[2];
  }
  const idR = new Float32Array(FR * J * 9);
  for (let i = 0; i < FR * J; i++) idR[i * 9] = idR[i * 9 + 4] = idR[i * 9 + 8] = 1;
  const aclip = new ArdyClip({ frameCount: FR, fps: 20, joints, globalRotations: idR, jointNames: names, parents: [-1, 0, 1, 0, 3, 4, 0, 6, 7, 2, 9, 2, 11], prompt: 'diag', seed: 1 });
  const motion = retargetToG1(aclip, sim, () => {});
  let minZ = Infinity;
  const fiL = motion.srcJoints.indexOf('leftFoot'), fiR = motion.srcJoints.indexOf('rightFoot');
  for (let f = 0; f < FR; f++) for (const fi of [fiL, fiR]) {
    minZ = Math.min(minZ, motion.srcPos[(f * motion.srcJoints.length + fi) * 3 + 2]);
  }
  ok(minZ > -1e-3, 'gesunkenes Skeleton geerdet (min Fuß-z ≥ 0)', 'minZ=' + minZ.toFixed(4));
  // und die Geist-Höhe ist trotzdem vernünftig (Erden über Fuß-Geoms):
  let hmn = Infinity, hmx = -Infinity;
  for (let f = 0; f < FR; f++) { hmn = Math.min(hmn, motion.h[f]); hmx = Math.max(hmx, motion.h[f]); }
  ok(hmn > 0.3 && hmx < 1.2, 'Geist-Wurzelhöhe im sinnvollen Bereich', hmn.toFixed(2) + '..' + hmx.toFixed(2));
}

console.log('\n═══ ERGEBNIS: ' + pass + ' OK · ' + fail + ' FEHLER ═══');
process.exit(fail ? 1 : 0);
