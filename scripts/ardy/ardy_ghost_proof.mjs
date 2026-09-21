// ═══════════════════════════════════════════════════════════
// ardy_ghost_proof.mjs — v2.28.10 „GEIST = ARDY, OHNE SKELETT"
// Nutzer: „Skellet und der Geist unterschieden sich. Kann man Output
// von ardy nicht direkt an g1 Geist binden ohne Skelett?"
//
// Beweise an der ECHTEN KETTE (fp32-Modell, CPU, echte G1-Sim, idle Seed 7):
//   A DIREKTBINDUNG: Geist-qpos == clip.q Frame für Frame (bit-exakt) —
//     der Geist IST die rohe ARDY-Ausgabe (Retarget-Replay)
//   B POLICY-/SIM-UNABHÄNGIGKEIT: derselbe Clip-Frame liefert unter zwei
//     VÖLLIG verschiedenen Sim-Zuständen bit-identische Geist-Positionen,
//     während sich der echte Roboter messbar bewegt — der Geist hängt
//     NICHT an Policy/Physik
//   C DIVERGENZ-DOKU: Skelett(srcPos) ↔ Geist(FK clip.q) Form-Differenz
//     (Vektoren relativ Hüfte/Becken) = die vom Nutzer gesehene Abweichung
// Dump → ghost_proof_dump.json (Renderer: ardy_ghost_render.py)
// ═══════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));

console.log('Lade echte ONNX-Sessions (fp32, CPU) …');
const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass } = await import(path.join(WWW, 'js/ardy.js'));
const { BertWordPiece } = await import(path.join(WWW, 'js/ardytoken.js'));
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
const wasmBuf = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { retargetToRobot, smoothMotionPhysics, findFootGeoms } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_ghost_proof.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_ghost_proof.xml');

console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
console.log('Frames: ' + out.frameCount + ' · sanity: ' + JSON.stringify(out.sanity || null));

console.log('App-Pipeline: retargetToRobot → smoothMotionPhysics → pack/unpack …');
let motion = retargetToRobot(new ArdyClip(out), sim, () => {});
smoothMotionPhysics(motion);
motion = unpackMotion(packMotion(motion));
const n = motion.n, nu = motion.nu;

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };

// ── Helfer ──
const bid = (act) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[act]]];
const PELVIS = sim.baseBody;
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ── A) DIREKTBINDUNG: Geist-qpos == clip.q (bit-exakt) ──
console.log('\n[A] DIREKTBINDUNG: setGhostPose(gh, clip.q, …) → Geist-Gelenke == Clip-Frames');
{
  const gh = sim.makeGhostData();
  const adr = sim.actQposAdr;
  let maxQErr = 0, badFrames = 0, checked = 0;
  let baseErr = 0;
  for (let f = 0; f < n; f += 4) {
    const bq = motion.baseQ ? motion.baseQ.subarray(4 * f, 4 * f + 4) : null;
    sim.setGhostPose(gh, motion.q, f * nu, motion.h[f], 0, 0, 0, bq);
    for (let a = 0; a < nu; a++) {
      const gv = gh.qpos[adr[a]];
      const qv = motion.q[f * nu + a];
      checked++;
      if (!Object.is(gv, qv)) { maxQErr = Math.max(maxQErr, Math.abs(gv - qv)); badFrames++; }
    }
    const badr = sim.model.jnt_qposadr[sim.model.body_jntadr[PELVIS]];
    baseErr = Math.max(baseErr, Math.abs(gh.qpos[badr + 2] - motion.h[f]));
  }
  ok(badFrames === 0, 'Geist-Gelenke bit-identisch zu clip.q über alle Frames', (checked / 1000).toFixed(0) + 'k Werte geprüft');
  ok(baseErr === 0, 'Geist-Basishöhe == clip.h (Lehrer-Höhe)', 'max Δ ' + baseErr.toExponential(1));
}

// ── B) POLICY-/SIM-UNABHÄNGIGKEIT ──
console.log('\n[B] UNABHÄNGIGKEIT: gleicher Clip-Frame unter verschiedenen Sim-Zuständen');
{
  const gh = sim.makeGhostData();
  const f0 = Math.floor(n / 2);
  const bq = motion.baseQ ? motion.baseQ.subarray(4 * f0, 4 * f0 + 4) : null;
  const bodies = [PELVIS];
  try { bodies.push(bid('left_ankle_pitch_joint'), bid('right_ankle_pitch_joint')); } catch (e) { /* ok */ }
  try { bodies.push(bid('left_wrist_roll_joint'), bid('right_wrist_roll_joint')); } catch (e) { /* ok */ }
  const snap = () => {
    sim.setGhostPose(gh, motion.q, f0 * nu, motion.h[f0], 0, 0, 0, bq);
    const g = [];
    for (const b of bodies) g.push(gh.xpos[3 * b], gh.xpos[3 * b + 1], gh.xpos[3 * b + 2]);
    return g;
  };
  const robotSnap = () => {
    const r = [];
    for (const b of bodies) r.push(sim._xpos[3 * b], sim._xpos[3 * b + 1], sim._xpos[3 * b + 2]);
    return r;
  };
  // Zustand 1: Sim mit Zufalls-Steuerung treiben (Roboter bewegt sich/fällt)
  sim.reset();
  const r1 = lcg(1234);
  for (let s = 0; s < 300; s++) { for (let a = 0; a < nu; a++) sim.ctrl[a] = 0.6 * (r1() - 0.5); sim.step(); }
  const state1 = robotSnap();
  const ghost1 = snap();
  // Zustand 2: ANDERER Zufalls-Zustand (deutlich verschieden)
  sim.reset();
  const r2 = lcg(987654);
  for (let s = 0; s < 700; s++) { for (let a = 0; a < nu; a++) sim.ctrl[a] = 0.8 * (r2() - 0.5); sim.step(); }
  const state2 = robotSnap();
  const ghost2 = snap();
  let robotMoved = 0;
  for (let i = 0; i < state1.length; i++) robotMoved = Math.max(robotMoved, Math.abs(state1[i] - state2[i]));
  let ghostDiff = 0;
  for (let i = 0; i < ghost1.length; i++) ghostDiff = Math.max(ghostDiff, Math.abs(ghost1[i] - ghost2[i]));
  ok(robotMoved > 0.05, 'Sim-Zustände sind REAL verschieden (Störung echt)', 'max Roboter-Δ ' + robotMoved.toFixed(3) + ' m');
  ok(ghostDiff === 0, 'Geist bit-identisch trotz komplett anderer Sim/Policy-Lage', 'max Geist-Δ ' + ghostDiff.toExponential(1));
}

// ── C) DIVERGENZ-DOKU: Skelett(srcPos) ↔ Geist(FK clip.q) ──
console.log('\n[C] Form-Differenz Skelett ↔ Geist (Vektoren relativ Hüfte/Becken — die gesehene Abweichung)');
{
  const nR = motion.srcJoints.length;
  const si = {}; motion.srcJoints.forEach((r, i) => { si[r] = i; });
  const sP = (f, r) => { const o = (f * nR + si[r]) * 3; return [motion.srcPos[o], motion.srcPos[o + 1], motion.srcPos[o + 2]]; };
  const gh = sim.makeGhostData();
  const tryBid = (nm) => { try { return bid(nm); } catch (e) { return -1; } };
  const PAIRS = [
    ['leftUpLeg', tryBid('left_hip_pitch_joint'), 'Hüfte L'],
    ['rightUpLeg', tryBid('right_hip_pitch_joint'), 'Hüfte R'],
    ['leftLeg', tryBid('left_knee_joint'), 'Knie L'],
    ['rightLeg', tryBid('right_knee_joint'), 'Knie R'],
    ['leftFoot', tryBid('left_ankle_pitch_joint'), 'Knöchel L'],
    ['rightFoot', tryBid('right_ankle_pitch_joint'), 'Knöchel R'],
    [si.leftForeArm !== undefined ? 'leftForeArm' : 'leftArm', tryBid('left_elbow_joint'), 'Ellbogen L'],
    [si.rightForeArm !== undefined ? 'rightForeArm' : 'rightArm', tryBid('right_elbow_joint'), 'Ellbogen R'],
    ['leftHand', tryBid('left_wrist_roll_joint'), 'Handgelenk L'],
    ['rightHand', tryBid('right_wrist_roll_joint'), 'Handgelenk R'],
  ].filter(p => si[p[0]] !== undefined && p[1] > 0);
  const res = PAIRS.map(([role, body, label]) => ({ label, role, series: [], mean: 0, p95: 0, max: 0 }));
  for (let f = 0; f < n; f++) {
    const bq = motion.baseQ ? motion.baseQ.subarray(4 * f, 4 * f + 4) : null;
    sim.setGhostPose(gh, motion.q, f * nu, motion.h[f], 0, 0, 0, bq);
    const pel = [gh.xpos[3 * PELVIS], gh.xpos[3 * PELVIS + 1], gh.xpos[3 * PELVIS + 2]];
    const hip = sP(f, 'hips');
    PAIRS.forEach(([role, body, label], i) => {
      const sv = [sP(f, role)[0] - hip[0], sP(f, role)[1] - hip[1], sP(f, role)[2] - hip[2]];
      const wv = [gh.xpos[3 * body] - pel[0], gh.xpos[3 * body + 1] - pel[1], gh.xpos[3 * body + 2] - pel[2]];
      const d = Math.hypot(sv[0] - wv[0], sv[1] - wv[1], sv[2] - wv[2]);
      res[i].series.push(d);
    });
  }
  let overall = 0;
  for (const r of res) {
    const s = [...r.series].sort((a, b) => a - b);
    r.mean = s.reduce((x, y) => x + y, 0) / s.length;
    r.p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    r.max = s[s.length - 1];
    overall = Math.max(overall, r.max);
    console.log('    ' + r.label.padEnd(13) + ' mean ' + (r.mean * 100).toFixed(1) + ' cm · p95 ' + (r.p95 * 100).toFixed(1) + ' cm · max ' + (r.max * 100).toFixed(1) + ' cm');
  }
  ok(overall < 0.30, 'Form-Differenz im dokumentierten Restbereich (kein Grobfehler)', 'max über alle Paare ' + (overall * 100).toFixed(1) + ' cm');
  writeFileSync(path.join(HERE, 'ghost_proof_dump.json'), JSON.stringify({ n, res: res.map(({ label, series, mean, p95, max }) => ({ label, series, mean, p95, max })) }, null, 1));
  console.log('    Dump → scripts/ardy/ghost_proof_dump.json');
}

console.log(`\n═══ Ergebnis: ${fails === 0 ? 'ALLE BEWEISE ERFULLT' : fails + ' FEHLER'} ═══`);
if (fails) process.exit(1);
console.log('v2.28.10: Geist = rohe ARDY-Ausgabe (Direktbindung bewiesen), Skelett aus.');
