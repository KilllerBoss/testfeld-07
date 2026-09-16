// motion_v2150_test.mjs — v2.15.0 GLB FÜR JEDEN ROBOTER + REFERENZ-MODI:
//   1) G1-Regression: synthetischer Walk-Clip → Beine+Arme bewegt, Root-Bahn
//   2) MicroDuck-Retarget: nu=14, Beine bewegt, Kopf/Hals = STAND, Höhenband
//   3) X2-Flugbahn: nu=4, q = Hover-Schub, Root-Bahn vorhanden
//   4) Motion-Task refMode 'stelle'/'frei'/'folgt' (Reward-Semantik)
//   5) Unbound: animOn=false mit STUB-Clip (ohne Animationsdaten) läuft
//   6) Drohnen-Lehrpfad: setPath + updateCmd + ghostAnchor je Modus
//   7) packMotion/unpackMotion robotId-Roundtrip
// Usage: node scripts/motion_v2150_test.mjs
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
const { retargetToRobot, PROFILES } = await import(path.join(WWW, 'js/retarget.js'));
const { makeMotionTask, MOTION_R } = await import(path.join(WWW, 'js/motiontask.js'));
const { makeHoverTask } = await import(path.join(WWW, 'js/robots.js'));
const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

import { quatAxis, synthSkeleton, buildGlb, packGlb, walkClip } from "./_synthglb.mjs";

const rangeOf = (motion, j) => {
  let mn = Infinity, mx = -Infinity;
  for (let f = 0; f < motion.n; f++) { const v = motion.q[f * motion.nu + j]; if (v < mn) mn = v; if (v > mx) mx = v; }
  return { mn, mx, span: mx - mn };
};
const travelOf = (motion) => {
  let t = 0;
  for (let f = 1; f < motion.n; f++) t += Math.hypot(motion.root[2 * f] - motion.root[2 * f - 2], motion.root[2 * f + 1] - motion.root[2 * f - 1]);
  return t;
};

console.log('■ Modelle laden (echte MuJoCo-WASM-Sims)');
await fetchModelIntoFS('models/unitree_g1');
await fetchModelIntoFS('models/pollen_microduck');
await fetchModelIntoFS('models/skydio_x2');
const g1cfg = getRobot('g1'), duckcfg = getRobot('duck'), x2cfg = getRobot('x2');
const g1sim = new RobotSim(g1cfg, 'testfeld.xml');
const ducksim = new RobotSim(duckcfg, 'testfeld.xml');
const x2sim = new RobotSim(x2cfg, 'testfeld.xml');
const walkBuf = walkClip();

console.log('\n■ 1) G1-Regression (humanoides Vollprofil)');
{
  const m = retargetToRobot(new GlbClip(walkBuf.slice(0)), g1sim, () => {});
  ok(m.nu === g1sim.nu && m.robotId === 'g1', `nu=g1sim.nu (${g1sim.nu}), robotId=g1`, `${m.nu}/${m.robotId}`);
  const hipL = rangeOf(m, g1sim.actByName['left_hip_pitch_joint']);
  ok(hipL.span > 0.3, 'G1 Hüfte bewegt', `${hipL.span.toFixed(2)} rad`);
  // HINWEIS: Arme/Taille sind im synthetischen Clip schon seit v2.4.x
  // unbewegt (präexistierende Verhaltensweise, alt==neu verifiziert) —
  // kein Bestandteil dieses Releases.
  ok(travelOf(m) > 1.5, 'G1 Root-Bahn läuft', `${travelOf(m).toFixed(2)} m`);
  ok(m.locomotion === true, 'G1 locomotion-Flag');
}

console.log('\n■ 2) MicroDuck-Retarget (Beine, Kopf = STAND)');
{
  const m = retargetToRobot(new GlbClip(walkBuf.slice(0)), ducksim, () => {});
  ok(m.nu === 14 && m.robotId === 'duck', 'nu=14, robotId=duck', `${m.nu}/${m.robotId}`);
  const hip = rangeOf(m, ducksim.actByName['left_hip_pitch']);
  const knee = rangeOf(m, ducksim.actByName['left_knee']);
  ok(hip.span > 0.15, 'Duck Hüfte bewegt', `${hip.span.toFixed(2)} rad`);
  ok(knee.span > 0.1, 'Duck Knie bewegt', `${knee.span.toFixed(2)} rad`);
  // Gelenk-Limits: keine IK-Angel außerhalb jnt_range
  let inLim = true;
  for (const nm of ['left_hip_pitch', 'left_knee', 'right_ankle']) {
    const a = ducksim.actByName[nm], j = ducksim.actJoint[a];
    const r = rangeOf(m, a);
    const lo = ducksim.model.jnt_range[2 * j], hi = ducksim.model.jnt_range[2 * j + 1];
    if (hi > lo && (r.mn < lo - 1e-4 || r.mx > hi + 1e-4)) inLim = false;
  }
  ok(inLim, 'Duck IK respektiert jnt_range');
  // Kopf/Hals = STAND-Preset (keyCtrl), NICHT 0
  const hp = ducksim.actByName['head_pitch'];
  const standV = ducksim.keyCtrl[hp];
  const rH = rangeOf(m, hp);
  ok(Math.abs(rH.mx - standV) < 1e-4 && Math.abs(rH.mn - standV) < 1e-4, 'Duck Kopf bleibt auf STAND-Pose', `stand=${standV.toFixed(3)}`);
  const hMin = Math.min(...m.h), hMax = Math.max(...m.h);
  ok(hMin >= 0.049 && hMax <= 0.321, 'Duck Höhenband [0.05, 0.32]', `[${hMin.toFixed(3)}, ${hMax.toFixed(3)}]`);
  ok(travelOf(m) > 1.0, 'Duck Root-Bahn läuft', `${travelOf(m).toFixed(2)} m`);
  // Motion-Task läuft mit dem Duck-Clip
  const t = makeMotionTask(duckcfg, m, ducksim);
  ok(t.obsDim === 3 * 14 + 27, 'Duck Motion-Task obsDim=69', String(t.obsDim));
  const rng = new RNG(7);
  t.reset(rng, ducksim);
  const obs = new Float32Array(t.obsDim);
  t.observe(ducksim, obs);
  ok(obs.every(Number.isFinite), 'Duck Motion-Task observe finit');
  ducksim.reset();
  t.reset(rng, ducksim);
  const act = new Float32Array(14);
  t.actionToCtrl(ducksim, act);
  for (let s = 0; s < 40; s++) { ducksim.stepN(2); t.advance(ducksim.timestep * 2); }
  const rw = t.reward(ducksim);
  ok(Number.isFinite(rw.r), 'Duck Motion-Task 40 Schritte Echt-Physik finit', `r=${rw.r.toFixed(3)}`);
}

console.log('\n■ 3) refMode-Semantik (Duck-Sim, gleicher Clip)');
{
  const m = retargetToRobot(new GlbClip(walkBuf.slice(0)), ducksim, () => {});
  const mk = () => { const t = makeMotionTask(duckcfg, m, ducksim); t.reset(new RNG(7), ducksim); return t; };
  const stelle = mk(); stelle.refMode = 'stelle';
  const frei = mk(); frei.refMode = 'frei';
  const folgt = mk(); folgt.refMode = 'folgt';
  // gleicher Zustand: Roboter 2 m weit weg von der Bahn
  for (const t of [stelle, frei, folgt]) {
    t.reset(new RNG(7), ducksim);
    t.tElapsed = 5; // Bahn-Abbruch würde sonst gar nicht erst scharf
    ducksim.placeBase(m.root[0] + 2.0, m.root[1] + 0.5, 0);
  }
  const rs = stelle.reward(ducksim), rf = frei.reward(ducksim), rg = folgt.reward(ducksim);
  ok(rs.r <= rg.r, 'stelle: Bahn-Distanz kostet (≤ folgt, wo Ort egal ist)', `stelle=${rs.r.toFixed(3)} ≤ folgt ${rg.r.toFixed(3)}`);
  ok(rg.r > rf.r, 'folgt bestraft Bahn-Distanz NICHT (mehr Reward als frei)', `folgt ${rg.r.toFixed(3)} > frei ${rf.r.toFixed(3)}`);
  ok(!rg.done, 'folgt: kein Bahn-Abbruch 2 m neben der Bahn');
  ok(rf.done, 'frei: 2 m Abstand → Episode beendet (rootDone)');
  ok(rs.done, 'stelle: 2 m vom Fixpunkt → Episode beendet');
  // ghostAnchor
  const out = [0, 0, 0];
  stelle.ghostAnchor(0.3, [5, 5, 0.5], 1.0, out);
  ok(Math.abs(out[0] - m.root[0]) < 1e-6 && Math.abs(out[1] - m.root[1]) < 1e-6, 'stelle: Geist fix am Bahn-Anfang');
  folgt.ghostAnchor(0.3, [5, 5, 0.5], 1.0, out);
  ok(Math.abs(out[0] - 5) < 2 && Math.abs(out[1] - 5) < 2, 'folgt: Geist nahe am Roboter');
  folgt.advance(0.1);
  ok(Number.isFinite(folgt.phase), 'folgt: advance ok');
}

console.log('\n■ 4) UNBOUND: animOn=false mit STUB-Clip (keine Animationsdaten)');
{
  const stub = {
    name: '—ohne Animation—', fps: 1, n: 2, nu: 14, robotId: 'duck',
    q: new Float32Array(2 * 14), h: new Float32Array([0.12, 0.12]),
    root: null, yaw: null, locomotion: false, meanSpeed: 0.2, baseQ: null,
  };
  const t = makeMotionTask(duckcfg, stub, ducksim);
  t.animOn = false; t.refMode = 'folgt';
  const rng = new RNG(3);
  t.reset(rng, ducksim);
  ducksim.reset();
  const obs = new Float32Array(t.obsDim);
  t.observe(ducksim, obs);
  ok(obs.every(Number.isFinite), 'Unbound observe finit');
  const rw = t.reward(ducksim);
  ok(Number.isFinite(rw.r) && !rw.done, 'Unbound reward finit, Episode läuft', `r=${rw.r.toFixed(3)}`);
  for (let s = 0; s < 60; s++) {
    t.advance(ducksim.timestep * 2);
    ducksim.stepN(2);
  }
  const rw2 = t.reward(ducksim);
  ok(Number.isFinite(rw2.r), 'Unbound 60 Schritte Echt-Physik finit');
  ok(t.sampleRef(t.phase, new Float64Array(14), null) === undefined, 'Unbound sampleRef (Keyframe-Stand) ok');
}

console.log('\n■ 5) X2-Flugbahn (Root-only-Profil + Lehrpfad-Task)');
{
  const m = retargetToRobot(new GlbClip(walkBuf.slice(0)), x2sim, () => {});
  ok(m.nu === 4 && m.robotId === 'x2', 'nu=4, robotId=x2', `${m.nu}/${m.robotId}`);
  const hover = x2sim.keyCtrl[0];
  let allHover = true;
  for (let f = 0; f < m.n; f++) for (let a = 0; a < 4; a++) if (Math.abs(m.q[f * 4 + a] - x2sim.keyCtrl[a]) > 1e-6) allHover = false;
  ok(allHover, 'X2 q-Zeilen = Hover-Schub (Keyframe)');
  ok(travelOf(m) > 1.0, 'X2 Flugbahn vorhanden', `${travelOf(m).toFixed(2)} m`);
  const hMin = Math.min(...m.h), hMax = Math.max(...m.h);
  ok(hMin >= 0.24 && hMax <= 1.61, 'X2 Höhenband', `[${hMin.toFixed(2)}, ${hMax.toFixed(2)}]`);
  // Lehrpfad-Task
  const task = makeHoverTask(x2cfg);
  ok(task.kind === 'hover' && typeof task.setPath === 'function', 'Hover-Task hat setPath');
  task.reset(new RNG(1));
  task.setPath(m, 'frei');
  ok(task.pathOn === true, 'Pfad aktiv');
  x2sim.reset();
  task.updateCmd(0.05, x2sim);
  ok(Number.isFinite(task.cmd.vx) && Number.isFinite(task.cmd.alt) && Number.isFinite(task.cmd.yaw), 'updateCmd liefert finite Kommandos', `vx=${task.cmd.vx.toFixed(2)} alt=${task.cmd.alt.toFixed(2)}`);
  // frei: Wegpunkt weit weg → vx > 0
  ok(task.cmd.vx > 0.05, 'frei: Drohne fährt an (vx > 0)', `vx=${task.cmd.vx.toFixed(2)}`);
  task.setPath(m, 'stelle');
  task.updateCmd(0.05, x2sim);
  ok(task.cmd.vx < 0.2, 'stelle: Hover am Startpunkt (vx ≈ 0)', `vx=${task.cmd.vx.toFixed(2)}`);
  const g1 = [0, 0, 0];
  task.setPath(m, 'folgt');
  task.ghostAnchor(0, [2, 3, 0.8], 0.7, g1);
  ok(Math.abs(g1[0] - 2) < 1e-6 && Math.abs(g1[1] - 3) < 1e-6, 'folgt: Geist-Anker = Drohnenposition');
  // Bei PROFI (Policy) bleibt obs-Dim unverändert
  ok(task.obsDim === 15, 'Hover-Task obsDim unverändert (15)');
}

console.log('\n■ 6) packMotion/unpackMotion robotId');
{
  const m = retargetToRobot(new GlbClip(walkBuf.slice(0)), ducksim, () => {});
  const p = packMotion(m);
  ok(p.robotId === 'duck', 'packMotion trägt robotId');
  const u = unpackMotion(p);
  ok(u.robotId === 'duck' && u.nu === 14, 'unpackMotion robotId-Roundtrip');
  const old = { ...p, robotId: undefined }; // Legacy-Datensatz
  ok(unpackMotion(old).robotId === null, 'Legacy ohne robotId → null (Kompatibilität)');
  ok(PROFILES.duck.hMax < 0.5 && PROFILES.g1.hMin > 0.3, 'Profile Höhenband korrekt');
}

console.log(`\n═══ ERGEBNIS: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
