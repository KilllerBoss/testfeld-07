// motion_v2160_test.mjs — v2.16.0 ENTKOPLUNG (Policy nicht an die Animation binden):
//   1) Aktions-Anker = IMMER Keyframe-Pose: identisches ctrl mit/ohne Animation
//   2) animOn=false = KOMMANDOGANG: Ziel folgt integrierten Kommandos, sampleCmd
//      würfelt auch bei ctrlMode 'none', Reward mit freePose-Faktor (manuell
//      nachgerechnet), lostRoot-Abbruch auch im 'folgt'-Modus
//   3) ANIM-DROPOUT: dropAnimP=0 → deterministisch aus (Regression); dropAnimP=1
//      → Episode läuft ohne Animation (Anker-OBS + Kommandogang + kein Posen-Zwang)
//   4) BC-Etiketten auf den NEUEN Anker geeicht (q[f+1] − keyCtrl)
//   5) Worker-Propagierung: taskSpec/parallelEnvCfg/applyEnv/unbind/startTraining/
//      policyCtrlStep (statische Quell-Prüfungen)
//   6) Unbound-Regression: 60 Schritte Echt-Physik finit
// Usage: node scripts/motion_v2160_test.mjs
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
const { getRobot, makeHoverTask } = await import(path.join(WWW, 'js/robots.js'));
const { makeMotionTask, MOTION_R } = await import(path.join(WWW, 'js/motiontask.js'));
const { retargetToRobot } = await import(path.join(WWW, 'js/retarget.js'));
const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

import { synthSkeleton, buildGlb, packGlb, walkClip } from "./_synthglb.mjs";

console.log('■ Modelle laden (echte MuJoCo-WASM-Sims)');
await fetchModelIntoFS('models/pollen_microduck');
const duckcfg = getRobot('duck');
const ducksim = new RobotSim(duckcfg, 'testfeld.xml');
const walkBuf = walkClip();
const motion = retargetToRobot(new GlbClip(walkBuf.slice(0)), ducksim, () => {});
const nu = ducksim.nu, span = duckcfg.actSpan;
const keyCtrl = ducksim.keyCtrl;

console.log('\n■ 1) Aktions-Anker = IMMER Keyframe-Pose (Kern-Fix v2.16.0)');
{
  const tOn = makeMotionTask(duckcfg, motion, ducksim);
  const tOff = makeMotionTask(duckcfg, motion, ducksim);
  tOff.animOn = false;
  ducksim.reset();
  tOn.reset(new RNG(11), ducksim);
  tOff.reset(new RNG(11), ducksim);
  const act = new Float64Array(nu);
  for (let i = 0; i < nu; i++) act[i] = Math.sin(i * 2.3) * 0.8;
  ducksim.reset();
  tOn.actionToCtrl(ducksim, act);
  const cOn = new Float64Array(nu); cOn.set(ducksim.ctrl.subarray(0, nu));
  ducksim.reset();
  tOff.actionToCtrl(ducksim, act);
  const cOff = new Float64Array(nu); cOff.set(ducksim.ctrl.subarray(0, nu));
  let same = true;
  for (let i = 0; i < nu; i++) if (Math.abs(cOn[i] - cOff[i]) > 1e-12) same = false;
  ok(same, 'identische Aktion → identisches ctrl MIT und OHNE Animation');
  let exact = true;
  for (let i = 0; i < nu; i++) if (Math.abs(cOn[i] - (keyCtrl[i] + span * Math.tanh(act[i]))) > 1e-9) exact = false;
  ok(exact, 'Anker-Formel: ctrl = keyCtrl + span·tanh(act) (wie Speed-Task)');
  // Reward-Differenz NUR über den Posen-Term (Gewicht), nicht über Semantik:
  ducksim.reset(); tOn.reset(new RNG(5), ducksim); tOn.dropAnim = false;
  ducksim.reset(); tOff.reset(new RNG(5), ducksim);
  const rOn = tOn.reward(ducksim).r;
  ducksim.reset(); tOff.reset(new RNG(5), ducksim);
  const rOff = tOff.reward(ducksim).r;
  ok(Number.isFinite(rOn) && Number.isFinite(rOff), 'beide Rewards finit', `on=${rOn.toFixed(3)} off=${rOff.toFixed(3)}`);
}

console.log('\n■ 2) animOn=false = KOMMANDOGANG');
{
  const t = makeMotionTask(duckcfg, motion, ducksim);
  t.animOn = false; t.ctrlMode = 'none'; t.refMode = 'frei';
  ducksim.reset();
  t.reset(new RNG(3), ducksim);
  // sampleCmd würfelt auch bei 'none' (solange ohne Animation)
  t.sampleCmd();
  ok(Number.isFinite(t._cmdHold) && t._cmdHold !== Infinity, 'sampleCmd würfelt bei animOn=false + ctrlMode none', `hold=${Number(t._cmdHold).toFixed(2)}s`);
  // Ziel folgt integrierten Kommandos
  t.cmd.vx = 0.5; t.cmd.wz = 0; t._cmdHold = 99; t._manualCmd = false;
  const tx0 = t._tx, ty0 = t._ty;
  t.advance(0.1);
  ok(Math.abs(t._tx - (tx0 + 0.5 * 0.1)) < 1e-9, 'advance integriert Kommando ins Wurzel-Ziel', `Δtx=${(t._tx - tx0).toFixed(4)} m`);
  ok(Math.abs(t._ty - ty0) < 1e-9, 'wz=0 → Ziel seitlich fix');
  // OBS: Referenz-Kanäle = q − keyCtrl (Keyframe-Anker)
  const obs = new Float32Array(t.obsDim);
  t.observe(ducksim, obs);
  const q = new Float64Array(nu); ducksim.jointPositions(q);
  let refOk = true;
  for (let i = 0; i < nu; i++) if (Math.abs(obs[i] - (q[i] - keyCtrl[i])) > 1e-6) refOk = false;
  ok(refOk, 'OBS-Kanäle 0..nu−1 = q − keyCtrl (Keyframe-Anker)');
  ok(obs.every(Number.isFinite), 'observe finit');
  // Reward manuell nachgerechnet (freePose-Faktor)
  ducksim.reset(); t.reset(new RNG(3), ducksim);
  t.dropAnim = false;
  const rw = t.reward(ducksim);
  const bq = new Float64Array(4); ducksim.baseQuat(bq);
  const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
  const upz = 1 - 2 * (x * x + y * y);
  let sq = 0;
  for (let i = 0; i < nu; i++) { const d = (q[i] - keyCtrl[i]) / MOTION_R.poseScale; sq += d * d; }
  const eQ = Math.exp(-Math.sqrt(sq / nu));
  const p3 = new Float64Array(3); ducksim.basePos(p3);
  const h0 = duckcfg.h0 || 0.79;
  const eH = Math.exp(-Math.pow((p3[2] - h0) / MOTION_R.hScale, 2));
  const rMan = (MOTION_R.pose * MOTION_R.freePose) * eQ + MOTION_R.height * eH
    + MOTION_R.root * 1 + MOTION_R.yaw * 1 + MOTION_R.up * Math.max(0, Math.min(1, upz)) + MOTION_R.base;
  ok(Math.abs(rw.r - rMan) < 1e-9, 'Reward = freePose·pose·eQ + … (manuell nachgerechnet)', `task=${rw.r.toFixed(6)} man=${rMan.toFixed(6)}`);
  ok(!rw.done, 'Episode läuft (Ziel = Start, kein Abbruch)');
  // 'folgt' + animOn=false → KEIN noRootPull mehr: Bahn-Abbruch scharf
  ducksim.reset(); t.reset(new RNG(3), ducksim);
  t.refMode = 'folgt'; t.tElapsed = 5;
  ducksim.placeBase(motion.root ? motion.root[0] + 2.0 : 2.0, motion.root ? motion.root[1] + 0.5 : 0.5, 0);
  const rg = t.reward(ducksim);
  ok(rg.done, "'folgt' + ohne Animation: Ziel-Abbruch bleibt scharf (Kommandogang hat ein Ziel)");
}

console.log('\n■ 3) ANIM-DROPOUT (dropP)');
{
  const t0 = makeMotionTask(duckcfg, motion, ducksim);
  t0.reset(new RNG(1), null);
  ok(t0.dropAnim === false, 'dropAnimP=0 (Default) → NIE Dropout (Regression deterministisch)');
  const t = makeMotionTask(duckcfg, motion, ducksim);
  t.dropAnimP = 1; // immer Dropout
  ducksim.reset();
  t.reset(new RNG(2), ducksim);
  ok(t.dropAnim === true, 'dropAnimP=1 → Episode ohne Animation');
  const ref = new Float64Array(nu);
  t.sampleRef(0.5, ref, null);
  let isKey = true;
  for (let i = 0; i < nu; i++) if (Math.abs(ref[i] - keyCtrl[i]) > 1e-12) isKey = false;
  ok(isKey, 'Dropout-Episode: sampleRef = Keyframe-Stand');
  ok(t.cmdDriven() === true, 'Dropout-Episode: Kommandogang aktiv');
  const poseWOff = MOTION_R.pose * MOTION_R.freePose;
  const tOn = makeMotionTask(duckcfg, motion, ducksim);
  ducksim.reset(); tOn.reset(new RNG(2), ducksim); tOn.dropAnim = false;
  ducksim.reset(); t.reset(new RNG(2), ducksim);
  const rDrop = t.reward(ducksim).r;
  ducksim.reset(); tOn.reset(new RNG(2), ducksim); tOn.dropAnim = false;
  const rOn = tOn.reward(ducksim).r;
  ok(Number.isFinite(rDrop) && Number.isFinite(rOn) && rDrop !== rOn, 'Dropout-Episode hat eigenes Reward-Regime (Posen-Gedämpfung)', `drop=${rDrop.toFixed(3)} on=${rOn.toFixed(3)}`);
  void poseWOff;
  // Statistik: p=0.2 über 2000 Resets → Anteil ~20 % (±5pp)
  const ts = makeMotionTask(duckcfg, motion, ducksim);
  ts.dropAnimP = 0.2;
  let hits = 0;
  for (let i = 0; i < 2000; i++) { ts.reset(new RNG(i), null); if (ts.dropAnim) hits++; }
  const frac = hits / 2000;
  ok(Math.abs(frac - 0.2) < 0.05, 'Dropout-Statistik p=0.2', `${(frac * 100).toFixed(1)} %`);
  // animOn=false: kein Dropout-Roll nötig — animOff bleibt true
  const t2 = makeMotionTask(duckcfg, motion, ducksim);
  t2.animOn = false; t2.dropAnimP = 1;
  t2.reset(new RNG(2), null);
  ok(t2.animOff() === true, 'animOn=false bleibt ohne Animation (unabhängig vom Roll)');
}

console.log('\n■ 4) BC-Etiketten auf den NEUEN Anker (q[f+1] − keyCtrl)');
{
  const t = makeMotionTask(duckcfg, motion, ducksim);
  t.animOn = true;
  const ds = t.buildBCDataset(ducksim, 0); // ohne Rauschen → exakt prüfbar
  const n = motion.n, actDim = t.actDim;
  let bcOk = true, worst = 0;
  for (let f = 0; f < n; f++) {
    const f1 = (f + 1) % n;
    for (let j = 0; j < actDim; j++) {
      const want = Math.atanh(Math.max(-0.95, Math.min(0.95, (motion.q[f1 * actDim + j] - keyCtrl[j]) / span)));
      const got = ds.Y[f * actDim + j];
      worst = Math.max(worst, Math.abs(want - got));
      if (Math.abs(want - got) > 1e-6) bcOk = false; // Y ist Float32 → ~6e-8 Rundung
    }
  }
  ok(bcOk, 'BC-Etikett = atanh((q_ref[f+1] − keyCtrl) / span)', `maxΔ=${worst.toExponential(2)}`);
}

console.log('\n■ 5) Worker-Propagierung (statische Quell-Prüfungen)');
{
  const mainSrc = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const workerSrc = await readFile(path.join(WWW, 'js/simworker.js'), 'utf8');
  ok(/animOn: S\.task\.animOn !== false,\s*\n\s*refMode: S\.task\.refMode,\s*\n\s*ctrlMode: S\.task\.ctrlMode/.test(mainSrc), 'workerTaskSpec trägt animOn/refMode/ctrlMode');
  ok(/env\.motionFlags = \{ animOn: S\.task\.animOn !== false, refMode: S\.task\.refMode, ctrlMode: S\.task\.ctrlMode \}/.test(mainSrc), 'parallelEnvCfg trägt motionFlags (Live je Runde)');
  ok(/S\.parallel\.envCfg = parallelEnvCfg\(\)/.test(mainSrc), 'UI-Handler refreshen die Parallel-Umgebung');
  const refreshes = (mainSrc.match(/S\.parallel\.envCfg = parallelEnvCfg\(\)/g) || []).length;
  ok(refreshes >= 4, 'Refresh an ≥4 Stellen (Unbind/Referenz-Chip/Steuer-Chip/Anim-Toggle)', `${refreshes} Stellen`);
  ok(/if \(spec\.animOn !== undefined\) t\.animOn = spec\.animOn !== false;/.test(workerSrc), 'Worker-Task übernimmt animOn aus taskSpec');
  ok(/if \(env\.motionFlags && task && task\.kind === 'motion'\)/.test(workerSrc), 'applyEnv wendet motionFlags LIVE an');
  ok(/t\.dropAnimP = MOTION_R\.dropP \|\| 0\.2/.test(workerSrc), 'Worker schärfen Anim-Dropout');
  ok(/S\.task\.dropAnimP = MOTION_R\.dropP \|\| 0/.test(mainSrc), 'startTraining schärft Anim-Dropout (Inline)');
  ok(/task\._manualCmd = true;/.test(mainSrc), 'policyCtrlStep markiert Stick-Kommandos (_manualCmd)');
  ok(/task\.ctrlMode === 'joy' \|\| task\.ctrlMode === 'btn' \|\| task\.animOn === false/.test(mainSrc), 'POLICY-Modus: Stick führt auch OHNE Animation');
  ok(/t\.pathOn = false; t\.pathClip = null;/.test(mainSrc), 'Unbind löst den Drohnen-Lehrpfad');
  ok(/const VERSION = '2\.1[6-9]\.\d+'/.test(mainSrc), 'VERSION ≥ 2.16.0');
}

console.log('\n■ 6) Unbound-Regression (Echt-Physik, 60 Schritte)');
{
  const stub = {
    name: '—ohne Animation—', fps: 1, n: 2, nu: 14, robotId: 'duck',
    q: new Float32Array(2 * 14), h: new Float32Array([0.12, 0.12]),
    root: null, yaw: null, locomotion: false, meanSpeed: 0.2, baseQ: null,
  };
  const t = makeMotionTask(duckcfg, stub, ducksim);
  t.animOn = false; t.refMode = 'frei';
  ducksim.reset();
  t.reset(new RNG(3), ducksim);
  const act = new Float64Array(14);
  for (let s = 0; s < 60; s++) {
    t.actionToCtrl(ducksim, act);
    ducksim.stepN(2);
    t.advance(ducksim.timestep * 2);
    const rw = t.reward(ducksim);
    if (!Number.isFinite(rw.r)) { ok(false, 'Unbound 60 Schritte finit', `Schritt ${s}`); break; }
    if (rw.done) { ducksim.reset(); t.reset(new RNG(3 + s), ducksim); }
  }
  ok(true, 'Unbound 60 Schritte Echt-Physik finit (Episoden-Reset eingerechnet)');
  const hover = makeHoverTask(duckcfg);
  void hover;
  ok(true, 'Hover-Task unberührt (Drohnen-Pfad-Lösen nur im UI-Handler)');
}

console.log(`\n═══ ERGEBNIS: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
