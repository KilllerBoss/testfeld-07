// ═══════════════════════════════════════════════════════════
// ardy_skeleton_fit_diag.mjs — v2.28.8-Beweis: „G1 ist falsch gemappt an den
// Skelett … Als wäre es nicht Skelett sondern Exoskelett" (Nutzer-Screenshot:
// grüne Wirbelsäule über dem Kopf, Arme/Beine außerhalb der Roboter-Gliedmaßen).
//
// Wurzel: reproportion fehlte — das uniforme Höhen-Fit (v2.28.5) behält
// Menschen-Proportionen (cskel27 ≈ 1,7 m). Fix (v2.28.8): Knochenlängen-
// Transfer — RICHTUNGEN aus den Lehrer-Daten, LÄNGEN vom G1 gemessen
// (Nullpose-Distanzen der Körper-Ursprünge).
//
// Beweis an der ECHTEN Kette (fp32-Modell + echte G1-Sim):
//   VORHER = alter Pfad (Lehrer-srcPos, geerdet + uniformer Fit auf h[0])
//   NACHHER = retargetToRobot mit Knochenlängen-Transfer (srcRig=1)
//   Je Gelenk: 3D-Abstand Skelett-Gelenk ↔ G1-Körper-Ursprung (Nullpose),
//   relativ zur Hüfte (Overlay-Anker). Erwartung: VORHER > 0,25 m an Kopf/
//   Schulter/Hand, NACHHER < 0,15 m überall.
// Usage: node scripts/ardy/ardy_skeleton_fit_diag.mjs
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

console.log('Lade echte ONNX-Sessions (fp32) …');
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
const { retargetToRobot, SRC_ROLES, GHOST_ROLES, groundSrcPosTrack, fitSrcPosToRobot, reproportionSrcPos } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_skel_fit.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_skel_fit.xml');

// ── 1) Echte Generierung + neuer Retarget (mit Transfer) ───
console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
const logs = [];
const motion = retargetToRobot(new ArdyClip(out), sim, (m) => logs.push(m));
for (const l of logs) console.log('  [RT] ' + l);

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };
ok(motion.srcRig === 1, 'Knochenlängen-Transfer aktiv (srcRig=1)');
ok(motion.srcJoints.length === 27, '27 Rollen in srcPos');

// ── 2) VORHER-Zustand rekonstruieren (alter Pfad v2.28.5–28.7) ──
// Lehrer-Weltpositionen (App-Permutation GLB→MJC, Scale 1) → erden → uniformer Fit
{
  const J = 27, n = out.frameCount;
  const human = new Float32Array(n * 27 * 3);
  for (let f = 0; f < n; f++) for (let j = 0; j < J; j++) {
    const b = (f * J + j) * 3, o = (f * 27 + j) * 3;
    human[o] = out.joints[b + 2]; human[o + 1] = out.joints[b]; human[o + 2] = out.joints[b + 1];
  }
  groundSrcPosTrack(human, n, SRC_ROLES.slice());
  const mOld = { srcPos: human, srcJoints: SRC_ROLES.slice(), n, h: motion.h };
  const F = fitSrcPosToRobot(mOld);
  var beforePos = mOld.srcPos;
  console.log('  VORHER-Rekonstruktion: uniformer Fit F=' + (F || 1).toFixed(3));
}

// ── 3) G1-Körper-Ursprünge (Nullpose) + Vergleichspaare ────
const g0 = sim.makeGhostData();
sim._mjApi.mj_resetData(sim.model, g0);
sim._mjApi.mj_forward(sim.model, g0);
const pos0 = (b) => [g0.xpos[3 * b], g0.xpos[3 * b + 1], g0.xpos[3 * b + 2]];
const dist0 = (b1, b2) => Math.hypot(pos0(b2)[0] - pos0(b1)[0], pos0(b2)[1] - pos0(b1)[1], pos0(b2)[2] - pos0(b1)[2]);
const bid = (act) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[act]]];
const PELVIS = sim.baseBody;
const shoulderOf = (elbowBody) => { // höchster Vorfahre = Schultergelenk (wie App-Code)
  let best = elbowBody, bestZ = pos0(elbowBody)[2], cur = elbowBody;
  for (let g = 0; g < 6; g++) {
    const par = sim.model.body_parentid[cur];
    if (par === undefined || par <= 0) break;
    const z = pos0(par)[2];
    if (z <= bestZ + 1e-9) break;
    best = par; bestZ = z; cur = par;
  }
  return best;
};
const SH_L = shoulderOf(bid('left_elbow_joint')), SH_R = shoulderOf(bid('right_elbow_joint'));
// Kopf-Niveau: höchste Geom-Mitte in der Nullpose (G1 hat keinen Kopf-Body)
let headTopZ = -Infinity;
for (let gg = 0; gg < g0.geom_xpos.length / 3; gg++) {
  const bid2 = sim.model.geom_bodyid ? sim.model.geom_bodyid[gg] : 0;
  if (bid2 === 0) continue;
  headTopZ = Math.max(headTopZ, g0.geom_xpos[3 * gg + 2]);
}
console.log('Schulter L body', SH_L, pos0(SH_L).map(v => v.toFixed(3)).join(','), '· Kopf-Proxy z:', headTopZ.toFixed(3));
const PAIRS = [ // [skeletonRole, robotBodyId, Label]
  ['leftUpLeg', bid('left_hip_pitch_joint'), 'Hüfte L'],
  ['leftLeg', bid('left_knee_joint'), 'Knie L'],
  ['leftFoot', bid('left_ankle_pitch_joint'), 'Knöchel L'],
  ['rightUpLeg', bid('right_hip_pitch_joint'), 'Hüfte R'],
  ['rightLeg', bid('right_knee_joint'), 'Knie R'],
  ['rightFoot', bid('right_ankle_pitch_joint'), 'Knöchel R'],
  ['leftArm', SH_L, 'Schulter L'],
  ['leftForeArm', bid('left_elbow_joint'), 'Ellbogen L'],
  ['leftHand', (() => { const e = bid('left_elbow_joint'); for (let b = 1; b < sim.nbody; b++) if (sim.model.body_parentid[b] === e) return b; return -1; })(), 'Handgelenk L'],
  ['rightArm', SH_R, 'Schulter R'],
  ['rightForeArm', bid('right_elbow_joint'), 'Ellbogen R'],
  ['rightHand', (() => { const e = bid('right_elbow_joint'); for (let b = 1; b < sim.nbody; b++) if (sim.model.body_parentid[b] === e) return b; return -1; })(), 'Handgelenk R'],
];
function measure(srcPos) {
  const nR = 27, idx = {}; SRC_ROLES.forEach((r, i) => { idx[r] = i; });
  const f0 = 0;
  const P = (r) => { const o = (f0 * nR + idx[r]) * 3; return [srcPos[o], srcPos[o + 1], srcPos[o + 2]]; };
  const hipS = P('hips'), pelvisR = pos0(PELVIS);
  const rows = [];
  for (const [role, body, label] of PAIRS) {
    if (body < 0 || body === undefined) { rows.push({ label, d: NaN, rel: NaN }); continue; }
    const s = P(role), r = pos0(body);
    const d = Math.hypot(s[0] - r[0], s[1] - r[1], s[2] - r[2]);
    // relativ: Overlay verankert die Hüfte — Differenz zur Becken-Hüfte messen
    const sRel = [s[0] - hipS[0], s[1] - hipS[1], s[2] - hipS[2]];
    const rRel = [r[0] - pelvisR[0], r[1] - pelvisR[1], r[2] - pelvisR[2]];
    const rel = Math.hypot(sRel[0] - rRel[0], sRel[1] - rRel[1], sRel[2] - rRel[2]);
    rows.push({ label, d, rel });
  }
  // Kopf: keine Kopf-Körper beim G1 — Höhe über der Hüfte vs. Geom-Kopf-Proxy
  const head = P('head');
  rows.push({ label: 'Kopf-Höhe über Hüfte', d: head[2] - hipS[2], rel: head[2] - hipS[2], headOnly: true });
  const pelvisZ = pos0(PELVIS)[2];
  rows.push({ label: 'Roboter: Kopf-Proxy (höchste Geom)', d: headTopZ - pelvisZ, rel: headTopZ - pelvisZ, headOnly: true, robotRef: true });
  return rows;
}
const rowsBefore = measure(beforePos);
const rowsAfter = measure(motion.srcPos);

console.log('\n■ Gelenk-Abstand Skelett ↔ G1 (Nullpose, Frame 0) — ILLUSTRATIV, mischt Rig- + Pose-Differenz:');
console.log('  Gelenk          VORHER(abs/rel)      NACHHER(abs/rel)');
let maxRelBefore = 0, maxRelAfter = 0;
for (let i = 0; i < rowsBefore.length; i++) {
  const b = rowsBefore[i], a = rowsAfter[i];
  if (b.headOnly) {
    console.log('  ' + b.label.padEnd(24) + (b.d.toFixed(3) + ' m').padStart(10) + '          ' + (a.d.toFixed(3) + ' m').padStart(10) + (a.robotRef ? '  (Roboter-Referenz)' : '  (Skelett)'));
    continue;
  }
  maxRelBefore = Math.max(maxRelBefore, b.rel);
  maxRelAfter = Math.max(maxRelAfter, a.rel);
  console.log('  ' + b.label.padEnd(16) + (b.d.toFixed(3) + '/' + b.rel.toFixed(3)).padStart(14) + ' m    ' + (a.d.toFixed(3) + '/' + a.rel.toFixed(3)).padStart(14) + ' m');
}
console.log('\n  max relativer Abstand (Gliedmaßen): VORHER ' + maxRelBefore.toFixed(3) + ' m → NACHHER ' + maxRelAfter.toFixed(3) + ' m');
ok(maxRelBefore > maxRelAfter + 0.05, 'Gelenk-Annäherung messbar (VORHER Exoskelett)', maxRelBefore.toFixed(3) + ' → ' + maxRelAfter.toFixed(3) + ' m');

// ── 3b) DER EIGENTLICHE RIG-Beweis: Skelett-Knochenlängen = G1-Knochenlängen ──
// (Die Gelenk-Positionen mischen immer POSE-Unterschiede ein — Lehrer-IDLE-
// Stance ≠ Roboter-Nullpose. Gleiche Knochenlängen + gleicher Boden + gleiche
// Hüfthöhe = Gelenke liegen auf dem Roboter, sobald die Pose übereinstimmt —
// und die Pose kommt im Overlay aus demselben Lehrer.)
console.log('\n■ RIG-VERGLEICH Skelett-Knochenlängen ↔ G1 (Frame 0):');
{
  const nR = 27, idx = {}; SRC_ROLES.forEach((r, i) => { idx[r] = i; });
  const SL = (r1, r2) => { const o1 = idx[r1] * 3, o2 = idx[r2] * 3; return Math.hypot(motion.srcPos[o2] - motion.srcPos[o1], motion.srcPos[o2 + 1] - motion.srcPos[o1 + 1], motion.srcPos[o2 + 2] - motion.srcPos[o1 + 2]); };
  const pairs = [
    ['Oberschenkel L', SL('leftUpLeg', 'leftLeg'), dist0(bid('left_hip_pitch_joint'), bid('left_knee_joint'))],
    ['Unterschenkel L', SL('leftLeg', 'leftFoot'), dist0(bid('left_knee_joint'), bid('left_ankle_pitch_joint'))],
    ['Oberschenkel R', SL('rightUpLeg', 'rightLeg'), dist0(bid('right_hip_pitch_joint'), bid('right_knee_joint'))],
    ['Unterschenkel R', SL('rightLeg', 'rightFoot'), dist0(bid('right_knee_joint'), bid('right_ankle_pitch_joint'))],
    ['Hüft-Breite L', SL('hips', 'leftUpLeg'), dist0(PELVIS, bid('left_hip_pitch_joint'))],
    ['Hüft-Breite R', SL('hips', 'rightUpLeg'), dist0(PELVIS, bid('right_hip_pitch_joint'))],
    ['Oberarm L', SL('leftArm', 'leftForeArm'), dist0(SH_L, bid('left_elbow_joint'))],
    ['Unterarm L', SL('leftForeArm', 'leftHand'), dist0(bid('left_elbow_joint'), (() => { const e = bid('left_elbow_joint'); for (let b = 1; b < sim.nbody; b++) if (sim.model.body_parentid[b] === e) return b; return -1; })())],
    ['Oberarm R', SL('rightArm', 'rightForeArm'), dist0(SH_R, bid('right_elbow_joint'))],
    ['Unterarm R', SL('rightForeArm', 'rightHand'), dist0(bid('right_elbow_joint'), (() => { const e = bid('right_elbow_joint'); for (let b = 1; b < sim.nbody; b++) if (sim.model.body_parentid[b] === e) return b; return -1; })())],
  ];
  let maxDL = 0;
  for (const [label, s, r] of pairs) {
    const dl = Math.abs(s - r); maxDL = Math.max(maxDL, dl);
    console.log('  ' + label.padEnd(18) + 'Skelett ' + s.toFixed(3) + ' m · G1 ' + r.toFixed(3) + ' m · Δ ' + (dl * 100).toFixed(1) + ' cm');
  }
  ok(maxDL < 0.025, 'Skelett-Gliedmaßen = G1-Gliedmaßen (max Δ < 2,5 cm)', 'max Δ ' + (maxDL * 100).toFixed(1) + ' cm');
  // Wirbelsäule: Hips→Spine3-Kette = Schulter-Niveau über dem Becken
  const spineS = SL('hips', 'spine') + SL('spine', 'spine1') + SL('spine1', 'spine2') + SL('spine2', 'spine3');
  const spineR = pos0(SH_L)[2] - pos0(PELVIS)[2];
  console.log('  Wirbelkette Hips→Spine3  Skelett ' + spineS.toFixed(3) + ' m · G1 (Becken→Schulter-Niveau) ' + spineR.toFixed(3) + ' m');
  ok(Math.abs(spineS - spineR) < 0.05, 'Wirbelsäulen-Kette = Becken→Schulter-Niveau', 'Δ ' + (Math.abs(spineS - spineR) * 100).toFixed(1) + ' cm');
  // Hüfthöhe: Skelett-Hüfte nach Erdung ≈ Roboter-Becken (beide = Bein-Reichweite)
  const hipS = motion.srcPos[idx['hips'] * 3 + 2];
  const pelvisR = pos0(PELVIS)[2];
  console.log('  Hüfthöhe  Skelett ' + hipS.toFixed(3) + ' m · G1-Becken ' + pelvisR.toFixed(3) + ' m');
  ok(Math.abs(hipS - pelvisR) < 0.15, 'Skelett-Hüfte auf Roboter-Beckenniveau (Bein-Reichweite)', 'Δ ' + (Math.abs(hipS - pelvisR) * 100).toFixed(1) + ' cm');
}
// Kopf: Skelett-Kopf nahe am Roboter-Kopf-Niveau, UND niedriger als das Menschen-Skelett
const headBefore = rowsBefore[rowsBefore.length - 2].d, headAfter = rowsAfter[rowsAfter.length - 2].d;
const headRobotRef = rowsAfter[rowsAfter.length - 1].d;
ok(headAfter < headBefore - 0.02, 'Kopf-Höhe sank (kein Menschen-Skelett mehr)', headBefore.toFixed(3) + ' → ' + headAfter.toFixed(3) + ' m über Hüfte');
ok(Math.abs(headAfter - headRobotRef) < 0.15, 'Kopf-Höhe ≈ Roboter-Kopf-Proxy', 'Skelett ' + headAfter.toFixed(3) + ' vs G1 ' + headRobotRef.toFixed(3) + ' m');

// Knochenlängen-Report (Kompakt)
{
  const nR = 27, idx = {}; SRC_ROLES.forEach((r, i) => { idx[r] = i; });
  const L = (r1, r2) => { const o1 = idx[r1] * 3, o2 = idx[r2] * 3; return Math.hypot(motion.srcPos[o2] - motion.srcPos[o1], motion.srcPos[o2 + 1] - motion.srcPos[o1 + 1], motion.srcPos[o2 + 2] - motion.srcPos[o1 + 2]); };
  console.log('\n■ Knochenlängen NACHHER (Skelett, Frame 0):');
  console.log('  OS L', L('leftUpLeg', 'leftLeg').toFixed(3), 'm · SB L', L('leftLeg', 'leftFoot').toFixed(3), 'm · Oberarm L', L('leftArm', 'leftForeArm').toFixed(3), 'm · Unterarm L', L('leftForeArm', 'leftHand').toFixed(3), 'm');
  // Füße exakt auf der Lehrer-Boden-Beziehung
  let minZ = Infinity;
  for (const r of ['leftFoot', 'rightFoot', 'leftToeBase', 'rightToeBase']) {
    const o = idx[r] * 3; minZ = Math.min(minZ, motion.srcPos[o + 2]);
  }
  ok(minZ > -0.005 && minZ < 0.005, 'Füße+Zehen nach Transfer geerdet', minZ.toFixed(4) + ' m');
  ok(Number.isFinite(minZ), 'srcPos endlich');
}

// ── 4) Dump für Overlay-PNG ────────────────────────────────
const dump = {
  roles: SRC_ROLES.slice(),
  edges: [[GHOST_ROLES[0], 'init']], // Platzhalter — echtes Kanten-Set unten
  before: Array.from(beforePos),
  after: Array.from(motion.srcPos),
  n: motion.n,
  robot: {
    pelvis: pos0(PELVIS),
    joints: PAIRS.map(([role, body, label]) => ({ label, role, pos: body >= 0 ? pos0(body) : null })),
  },
};
delete dump.edges;
const { SRC_EDGES } = await import(path.join(WWW, 'js/retarget.js'));
dump.edges = SRC_EDGES;
writeFileSync(path.join(HERE, 'skeleton_fit_dump.json'), JSON.stringify(dump));
console.log('■ Dump geschrieben: ' + path.join(HERE, 'skeleton_fit_dump.json'));
console.log(fails === 0 ? '■ ALLE CHECKS GRÜN' : '■ ' + fails + ' CHECKS FEHLGESCHLAGEN');
process.exit(fails === 0 ? 0 : 1);
