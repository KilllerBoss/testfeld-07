// ═══════════════════════════════════════════════════════════
// ardy_skeleton27_diag.mjs — v2.28.7-Beweis: „der skellet ist falsch"
// (Nutzer-Report mit Referenz-Screenshot aus der ARDY-Browser-Demo).
//
// WARUM: Die App trug in srcPos nur die 13 IK-Rollen (GHOST_ROLES) —
// das grüne Lehrer-Skelett war ein Stumpf ohne Hände, Zehen, Schultern
// und ohne Wirbelsäulen-Dichte. Das ARDY-Modell liefert 27 Gelenke.
//
// Beweis an der ECHTEN Kette (fp32-Modell + ArdyRuntime.generate +
// ArdyClip + retargetToRobot an echter G1-Sim):
//   1) srcJoints = 27 Rollen in cskel27-Reihenfolge
//   2) srcPos vollständig endlich, Hüfte ~Geist-Basishöhe, Füße geerdet
//   3) srcBonePairs: 27-Rollen → 26-Kanten-Baum; 13-Rollen → EXAKT die
//      alte 12-Paare-Struktur (Abwärtskompatibilität alter Clips)
//   4) JSON-Dump Frame 0 + Mitte → ardy_skeleton27_render.py zeichnet
//      Front/Seite/3-4-Ansicht (Vergleich mit dem Nutzer-Referenzbild)
// Usage: node scripts/ardy/ardy_skeleton27_diag.mjs
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
const t0 = Date.now();
const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
console.log('  Sessions geladen in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass } = await import(path.join(WWW, 'js/ardy.js'));
const { BertWordPiece } = await import(path.join(WWW, 'js/ardytoken.js'));
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');

// ── Echte G1-Sim (wie ardy_robot_diag) ─────────────────────
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
const { retargetToRobot, resolveSrcJoints, srcBonePairs, SRC_ROLES, SRC_EDGES, GHOST_ROLES } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_skel27.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_skel27.xml');
console.log('■ G1-Sim bereit (nu=' + sim.nu + ')');

// ── 1) Echte Generierung: idle ─────────────────────────────
console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
console.log('  frameCount=' + out.frameCount + ', joints=' + out.joints.length + ' Werte');

// ── 2) Voller Retarget an der echten Sim ───────────────────
const logs = [];
const motion = retargetToRobot(new ArdyClip(out), sim, (m) => logs.push(m));
for (const l of logs) console.log('  [RT] ' + l);

const srcJoints = motion.srcJoints;
const nR = srcJoints.length;
console.log('■ srcJoints (' + nR + '): ' + srcJoints.join(', '));

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };

ok(nR === 27, 'srcJoints trägt ALLE 27 cskel27-Gelenke', 'n=' + nR);
ok(JSON.stringify(srcJoints) === JSON.stringify(SRC_ROLES), 'Reihenfolge = SRC_ROLES (manifest-joint_names)');
ok(motion.srcPos.length === 3 * motion.n * 27, 'srcPos-Länge 3·n·27', motion.srcPos.length + ' vs ' + 3 * motion.n * 27);

// Endlichkeit + Anatomie-Verifikation
let nan = 0;
for (let i = 0; i < motion.srcPos.length; i++) if (!Number.isFinite(motion.srcPos[i])) nan++;
ok(nan === 0, 'srcPos vollständig endlich', nan + ' NaN');

const idx = {}; srcJoints.forEach((r, i) => { idx[r] = i; });
const P = (f, r) => { const o = (f * nR + idx[r]) * 3; return [motion.srcPos[o], motion.srcPos[o + 1], motion.srcPos[o + 2]]; };
const f0 = 0, fM = Math.floor(motion.n / 2);
for (const f of [f0, fM]) {
  const hip = P(f, 'hips');
  const footL = P(f, 'leftFoot'), footR = P(f, 'rightFoot');
  const toeL = P(f, 'leftToeBase'), handL = P(f, 'leftHand'), handR = P(f, 'rightHand');
  const shoulderL = P(f, 'leftShoulder'), head = P(f, 'head');
  const minFootZ = Math.min(footL[2], footR[2], toeL[2]);
  ok(hip[2] > 0.5 && hip[2] < 1.1, 'Frame ' + f + ': Hüfte in Menschen-/Geist-Größe', hip[2].toFixed(3) + ' m');
  ok(minFootZ > -0.01, 'Frame ' + f + ': Füße geerdet', minFootZ.toFixed(4) + ' m');
  ok(Math.abs(shoulderL[2] - hip[2]) > 0.15, 'Frame ' + f + ': Schulter ÜBER der Hüfte (Dichte-Wirbelsäule)', (shoulderL[2] - hip[2]).toFixed(3) + ' m');
  ok(head[2] > shoulderL[2], 'Frame ' + f + ': Kopf über Schulter');
  const armL = Math.hypot(handL[0] - shoulderL[0], handL[1] - shoulderL[1], handL[2] - shoulderL[2]);
  ok(armL > 0.4, 'Frame ' + f + ': Arm hat echte Länge (Schulter→Hand)', armL.toFixed(3) + ' m');
  const spread = Math.abs(handL[1] - handR[1]);
  console.log('    Hand-Spreizung (y-Abstand L/R): ' + spread.toFixed(3) + ' m — idle-Arme hängen am Körper (< 0,35 m = anatomisch, T-Pose wäre ~1,4 m)');
}

// Knochenlängen-Konsistenz zwischen Frame 0 und Mitte (Starres Skelett)
const bonePairs = srcBonePairs(idx);
ok(bonePairs.length === SRC_EDGES.length, '27-Rollen → voller Baum (' + SRC_EDGES.length + ' Kanten)', bonePairs.length + ' Paare');
let maxBoneDrift = 0;
for (const [a, b] of bonePairs) {
  const l0 = Math.hypot(P(f0, a)[0] - P(f0, b)[0], P(f0, a)[1] - P(f0, b)[1], P(f0, a)[2] - P(f0, b)[2]);
  const lM = Math.hypot(P(fM, a)[0] - P(fM, b)[0], P(fM, a)[1] - P(fM, b)[1], P(fM, a)[2] - P(fM, b)[2]);
  if (l0 > 0.02) maxBoneDrift = Math.max(maxBoneDrift, Math.abs(l0 - lM) / l0);
}
ok(maxBoneDrift < 0.12, 'Knochenlängen stabil zwischen Frames (kein Verzerr-Skelett)', 'maxDrift=' + (100 * maxBoneDrift).toFixed(2) + ' %');

// ── 3) Legacy-Kompatibilität: 13-Rollen → alte 12 Paare ────
const LEGACY_PAIRS = [
  ['hips', 'spine'], ['spine', 'head'],
  ['hips', 'leftUpLeg'], ['leftUpLeg', 'leftLeg'], ['leftLeg', 'leftFoot'],
  ['hips', 'rightUpLeg'], ['rightUpLeg', 'rightLeg'], ['rightLeg', 'rightFoot'],
  ['spine', 'leftArm'], ['leftArm', 'leftForeArm'],
  ['spine', 'rightArm'], ['rightArm', 'rightForeArm'],
];
const legacyIdx = {}; GHOST_ROLES.forEach((r, i) => { legacyIdx[r] = i; });
const legacyPairs = srcBonePairs(legacyIdx).map(([a, b]) => [a, b]).sort();
const expect = LEGACY_PAIRS.slice().sort();
ok(JSON.stringify(legacyPairs) === JSON.stringify(expect), '13-Rollen-Layout → EXAKT die alten 12 Knochen-Paare', legacyPairs.length + ' Paare');

// ── 4) fitSrcPosToRobot + pack/unpack (Persistenz) ─────────
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));
const rec = JSON.parse(JSON.stringify(packMotion(motion)));
const back = unpackMotion(rec, 'ardy');
ok(back.srcJoints && back.srcJoints.length === 27, 'pack/unpack erhält 27-Rollen-srcPos');
const { fitSrcPosToRobot } = await import(path.join(WWW, 'js/retarget.js'));
const F = fitSrcPosToRobot(back);
console.log('  fitSrcPosToRobot: F=' + (F || 1).toFixed(3) + (F ? ' (auf Geist-Basishöhe gefittet)' : ' (schon passend)'));
if (F) {
  const hip2 = P2(back, f0, 'hips');
  ok(Math.abs(hip2[2] - motion.h[0]) < 0.05, 'nach Fit: Hüfte ≈ Geist-Basishöhe', hip2[2].toFixed(3) + ' vs h0=' + motion.h[0].toFixed(3));
}
function P2(m, f, r) { const jj = m.srcJoints.indexOf(r); const o = (f * m.srcJoints.length + jj) * 3; return [m.srcPos[o], m.srcPos[o + 1], m.srcPos[o + 2]]; }

// ── 5) Dump für PNG-Render (Front/Seite/¾) ─────────────────
const dump = {
  prompt: out.prompt, seed: out.seed, frames: [f0, fM],
  roles: srcJoints,
  edges: bonePairs,
  srcPos: Array.from(motion.srcPos),
  fitted: F ? { factor: F, srcPos: Array.from(back.srcPos) } : null,
  n: motion.n, hips: Array.from(motion.h).slice(0, 5),
};
writeFileSync(path.join(HERE, 'skeleton27_dump.json'), JSON.stringify(dump));
console.log('■ Dump geschrieben: ' + path.join(HERE, 'skeleton27_dump.json'));
console.log(fails === 0 ? '■ ALLE CHECKS GRÜN' : '■ ' + fails + ' CHECKS FEHLGESCHLAGEN');
process.exit(fails === 0 ? 0 : 1);
