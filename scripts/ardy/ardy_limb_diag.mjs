// ═══════════════════════════════════════════════════════════
// ardy_limb_diag.mjs — v2.28.9-Diagnose zu Report E:
// „Beine und Hände nicht am Skelett … bewegen sich hin und her und
//  überkreuzen sich und bewegen sich auch wenn Skelett sich nicht bewegt.
//  Policy an Geist? Der Geist sollte rohe Ausgabe von ardy sein."
//
// Misst an der ECHTEN Kette (fp32-Modell, CPU, echte G1-Sim) — idle:
//   A) ROHE Decoder-Ausgabe (out.joints nach Spiegel, wie generate() liefert):
//      Bewegungs-Aktivität je Gelenkklasse (Torso vs. Arme/Hände/Beine/Füße)
//      → schwingen die DISTALEN Gliedmaßen, während der Torso still steht?
//   B) LINKS/RECHTS-Konsistenz: seitliche Vorzeichen der Paare (UpLeg/Arm/Foot)
//   C) srcPos nach der VOLLSTÄNDIGEN App-Pipeline (retargetToRobot inkl.
//      Reproportion+Erden, dann smoothMotionPhysics wie activateClip):
//      Gliedmaßen-Bewegung, Bein-Überkreuzen (y-Übertritt), Hand-Abriss
//   D) Geist-Gelenkspur q: Raten je Gelenk (idle ⇒ ruhig)
//   E) Geist-FK: Fußpositionen je Frame (setGhostPose) — Überkreuzen/Schwingen
//   Dump: ardy_limb_dump.json (+ PNG-Render via ardy_limb_render.py)
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
const { retargetToRobot, SRC_ROLES, GHOST_ROLES, SRC_EDGES, smoothMotionPhysics, findFootGeoms } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_limb_diag.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_limb_diag.xml');

console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
const n = out.frameCount, J = 27;
console.log(`Frames: ${n} @ ${out.fps} fps · sanity: ` + JSON.stringify(out.sanity || null));

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };

// ── A) ROHE Decoder-Ausgabe: Aktivität je Gelenk ───────────
// Decoder-Welt (nach X-Spiegel): x=lateral, y=hoch, z=vorwärts
const JN = out.jointNames;
const rawIdx = {}; JN.forEach((nm, i) => { rawIdx[nm.toLowerCase()] = i; });
const rawP = (f, j) => { const b = (f * J + j) * 3; return [out.joints[b], out.joints[b + 1], out.joints[b + 2]]; };
const CLASSES = {
  torso: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Head'],
  arm: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'RightShoulder', 'RightArm', 'RightForeArm'],
  hand: ['LeftHand', 'LeftHandEnd', 'LeftHandThumb1', 'RightHand', 'RightHandEnd', 'RightHandThumb1'],
  leg: ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'],
  foot: ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'],
};
console.log('\n■ A) ROHE Decoder-Ausgabe (nach Spiegelung) — Bewegung je Gelenk (m):');
const rawStats = {};
for (const [cls, names] of Object.entries(CLASSES)) {
  let sumMax = 0, sumDf = 0, cnt = 0, worst = '';
  for (const nm of names) {
    const j = rawIdx[nm.toLowerCase()];
    if (j === undefined) continue;
    let maxD = 0, df = 0;
    for (let f = 1; f < n; f++) {
      const a = rawP(f - 1, j), b = rawP(f, j);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      df += d;
      const d0 = Math.hypot(b[0] - rawP(0, j)[0], b[1] - rawP(0, j)[1], b[2] - rawP(0, j)[2]);
      if (d0 > maxD) maxD = d0;
    }
    sumMax += maxD; sumDf += df / (n - 1); cnt++;
    if (maxD > 0.02 && maxD > (rawStats[cls]?.max ?? 0)) worst = nm;
    console.log(`   ${nm.padEnd(18)} max|Δ zu f0|=${maxD.toFixed(4)} m · Ø Frame-Delta=${(df / (n - 1)).toFixed(4)} m`);
  }
  rawStats[cls] = { avgMax: sumMax / Math.max(1, cnt), avgDf: sumDf / Math.max(1, cnt), worst };
}
console.log(`   → Klassen-Ø (max|Δ zu f0|): ` + Object.entries(rawStats).map(([k, v]) => `${k}=${v.avgMax.toFixed(3)} m`).join(' · '));

// ── B) Links/Rechts-Konsistenz (roh + nach App-Permutation) ─
console.log('\n■ B) Links/Rechts-Konsistenz (rohe Decoder-Welt, x=lateral):');
for (const [l, r] of [['LeftUpLeg', 'RightUpLeg'], ['LeftArm', 'RightArm'], ['LeftFoot', 'RightFoot'], ['LeftHand', 'RightHand']]) {
  const jl = rawIdx[l.toLowerCase()], jr = rawIdx[r.toLowerCase()];
  const pl = rawP(0, jl), pr = rawP(0, jr);
  console.log(`   ${l.padEnd(12)} x=${pl[0].toFixed(3)} · ${r.padEnd(12)} x=${pr[0].toFixed(3)} → ${pl[0] > pr[0] ? 'L>R ✓' : 'L<R ✗ (vertauscht?)'}`);
}

// ── C) App-Pipeline exakt wie in der App ────────────────────
console.log('\n■ C) App-Pipeline (ArdyClip → retargetToRobot → smoothMotionPhysics):');
const logs = [];
const clip = new ArdyClip(out);
let motion = retargetToRobot(clip, sim, (m) => logs.push(m));
for (const l of logs) console.log('  [RT] ' + l);
smoothMotionPhysics(motion); // wie activateClip für src==='ardy'
// pack/unpack-Runde (Persistenz-Fidelity)
const packed = packMotion(motion);
motion = unpackMotion(packed);
const srcPos = motion.srcPos, srcJoints = motion.srcJoints;
const nR = srcJoints.length;
ok(nR === 27, '27 Rollen in srcPos', String(nR));
const si = {}; srcJoints.forEach((r, i) => { si[r] = i; });
const sP = (f, r) => { const o = (f * nR + si[r]) * 3; return [srcPos[o], srcPos[o + 1], srcPos[o + 2]]; };

// C1) Aktivität je Klasse (MJC-Rahmen)
console.log('  srcPos-Bewegung je Klasse (m):');
const srcStats = {};
for (const [cls, names] of Object.entries(CLASSES)) {
  let sumMax = 0, cnt = 0;
  for (const nm of names) {
    if (si[nm] === undefined) continue;
    let maxD = 0;
    for (let f = 1; f < n; f++) {
      const a = sP(f - 1, nm), b = sP(f, nm);
      const d0 = Math.hypot(b[0] - sP(0, nm)[0], b[1] - sP(0, nm)[1], b[2] - sP(0, nm)[2]);
      if (d0 > maxD) maxD = d0;
    }
    sumMax += maxD; cnt++;
  }
  srcStats[cls] = sumMax / Math.max(1, cnt);
  console.log(`   ${cls.padEnd(6)} Ø max|Δ zu f0|=${(sumMax / Math.max(1, cnt)).toFixed(4)} m`);
}
// C2) Bein-Überkreuzen: linke Struktur muss SEITLICH rechts von der rechten bleiben
// MJC: srcPos[1] = lateral (GLB x nach Spiegel), srcPos[0] = vorwärts
let crossFoot = 0, crossKnee = 0, crossUpLeg = 0, crossToe = 0;
let minSepFoot = Infinity, minSepKnee = Infinity;
for (let f = 0; f < n; f++) {
  const dFoot = sP(f, 'leftFoot')[1] - sP(f, 'rightFoot')[1];
  const dKnee = sP(f, 'leftLeg')[1] - sP(f, 'rightLeg')[1];
  const dUp = sP(f, 'leftUpLeg')[1] - sP(f, 'rightUpLeg')[1];
  const dToe = sP(f, 'leftToeBase')[1] - sP(f, 'rightToeBase')[1];
  if (dFoot <= 0) crossFoot++;
  if (dKnee <= 0) crossKnee++;
  if (dUp <= 0) crossUpLeg++;
  if (dToe <= 0) crossToe++;
  minSepFoot = Math.min(minSepFoot, dFoot); minSepKnee = Math.min(minSepKnee, dKnee);
}
console.log(`  Bein-Überkreuzen (y_L ≤ y_R): UpLeg ${crossUpLeg}/${n} · Knie ${crossKnee}/${n} · Knöchel ${crossFoot}/${n} · Zehen ${crossToe}/${n} Frames`);
console.log(`  Minimale laterale Separation: Knie ${minSepKnee.toFixed(3)} m · Knöchel ${minSepFoot.toFixed(3)} m`);
// C3) Hand-Abriss: Knochenlängen Hand→HandEnd / Hand→Thumb1 je Frame
let handEndErr = 0, thumbErr = 0;
{
  const refL = (a, b) => Math.hypot(sP(0, b)[0] - sP(0, a)[0], sP(0, b)[1] - sP(0, a)[1], sP(0, b)[2] - sP(0, a)[2]);
  for (const side of ['left', 'right']) {
    const lHE = refL(side + 'Hand', side + 'HandEnd');
    const lTH = refL(side + 'Hand', side + 'HandThumb1');
    for (let f = 0; f < n; f++) {
      const dHE = Math.hypot(...[0, 1, 2].map(k => sP(f, side + 'HandEnd')[k] - sP(f, side + 'Hand')[k]));
      const dTH = Math.hypot(...[0, 1, 2].map(k => sP(f, side + 'HandThumb1')[k] - sP(f, side + 'Hand')[k]));
      if (lHE > 1e-6) handEndErr = Math.max(handEndErr, Math.abs(dHE - lHE) / lHE);
      if (lTH > 1e-6) thumbErr = Math.max(thumbErr, Math.abs(dTH - lTH) / lTH);
    }
  }
}
console.log(`  Hand-Abriss: max relative Knochenlängen-Abweichung HandEnd ${((handEndErr) * 100).toFixed(1)} % · Thumb1 ${((thumbErr) * 100).toFixed(1)} %`);

// ── D) Geist-Gelenkspur q: Raten ────────────────────────────
console.log('\n■ D) Geist-Gelenkspur q (nach Physik-Glättung):');
{
  const nu = motion.nu, dt = 1 / (motion.fps || 20);
  const actNames = [];
  const A = sim.actByName;
  for (const side of ['left', 'right']) {
    for (const nm of [side + '_hip_yaw_joint', side + '_hip_roll_joint', side + '_hip_pitch_joint', side + '_knee_joint', side + '_ankle_pitch_joint', side + '_shoulder_pitch_joint', side + '_shoulder_roll_joint', side + '_shoulder_yaw_joint', side + '_elbow_joint']) {
      if (A[nm] !== undefined) actNames.push(nm);
    }
  }
  let maxRate = 0, worstJ = '';
  for (const nm of actNames) {
    const a = A[nm];
    let mx = 0;
    for (let f = 1; f < n; f++) {
      const r = Math.abs(motion.q[f * nu + a] - motion.q[(f - 1) * nu + a]) / dt;
      if (r > mx) mx = r;
    }
    if (mx > maxRate) { maxRate = mx; worstJ = nm; }
    console.log(`   ${nm.padEnd(28)} max Rate ${(mx).toFixed(2)} rad/s`);
  }
  console.log(`   → max Gelenk-Rate: ${maxRate.toFixed(2)} rad/s (${worstJ}) — GLB-Referenz ≈ 5 rad/s`);
}

// ── E) Geist-FK: Fußpositionen je Frame ─────────────────────
console.log('\n■ E) Geist-FK (setGhostPose je Frame):');
const footGeoms = findFootGeoms(sim);
{
  const ghost = sim.makeGhostData();
  const nu = motion.nu;
  const rows = [];
  for (let f = 0; f < n; f++) {
    sim.setGhostPose(ghost, motion.q, f * nu, motion.h[f], 0, 0, 0, motion.baseQ ? motion.baseQ.subarray(4 * f, 4 * f + 4) : null);
    const fp = footGeoms.map(g => [ghost.xpos[3 * g.body], ghost.xpos[3 * g.body + 1], ghost.xpos[3 * g.body + 2] + g.lowZ]);
    rows.push(fp);
  }
  // Fuß-Überkreuzen in der Geist-Anzeige: Fuß y-Seiten
  let gCross = 0, minSep = Infinity, maxSwing = 0;
  for (let f = 0; f < n; f++) {
    const sep = rows[f][0][1] - rows[f][1][1]; // y links − y rechts (Reihenfolge wie findFootGeoms)
    if (sep <= 0) gCross++;
    minSep = Math.min(minSep, sep);
    maxSwing = Math.max(maxSwing, Math.abs(rows[f][0][1] - rows[0][0][1]), Math.abs(rows[f][1][1] - rows[0][1][1]));
  }
  console.log(`   Fuß-Überkreuzen: ${gCross}/${n} Frames · min laterale Separation ${minSep.toFixed(3)} m · max Fuß-Schwingen ${maxSwing.toFixed(3)} m`);
  console.log(`   Fuß z: f0 ${rows[0].map(p => p[2].toFixed(3)).join('/')} · f${n - 1} ${rows[n - 1].map(p => p[2].toFixed(3)).join('/')}`);
}

// ── Dump für Render ─────────────────────────────────────────
const frames = [...new Set([0, Math.floor(n / 6), Math.floor(n / 3), Math.floor(n / 2), Math.floor(2 * n / 3), Math.floor(5 * n / 6), n - 1])];
const dump = {
  roles: srcJoints.slice(),
  edges: SRC_EDGES,
  frames,
  n,
  srcPos: frames.map(f => Array.from(srcPos.subarray(f * nR * 3, (f + 1) * nR * 3))),
  raw: frames.map(f => {
    const a = new Array(J * 3);
    for (let j = 0; j < J; j++) { const b = (f * J + j) * 3; a[j * 3] = out.joints[b + 2]; a[j * 3 + 1] = out.joints[b]; a[j * 3 + 2] = out.joints[b + 1]; }
    return a;
  }),
  qFeet: null,
  stats: { raw: rawStats, src: srcStats, crossFoot, crossKnee, crossUpLeg, crossToe, minSepFoot, minSepKnee, handEndErr, thumbErr },
};
writeFileSync(path.join(HERE, 'limb_dump.json'), JSON.stringify(dump));
console.log('\n■ Dump: ' + path.join(HERE, 'limb_dump.json'));
console.log(fails === 0 ? '■ PIPELINE-CHECKS GRÜN (Messwerte oben interpretieren)' : '■ ' + fails + ' CHECKS FEHLGESCHLAGEN');
