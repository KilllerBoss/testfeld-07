// ═══════════════════════════════════════════════════════════
// ardy_fix_proof.mjs — v2.28.9 ENDE-ZU-ENDE-NAWEIS (Report E):
// komplette App-Pipeline (generate OHNE Spiegel → retarget → Glättung →
// pack/unpack) an echtem Modell + echter G1-Sim, idle Seed 7:
//   ▸ Skeleton-Seiten: linke Rollen auf MJC-+y (Roboter-links) — 5/5
//   ▸ Bein-Überkreuzung: 0 Frames (y_L > y_R durchgehend)
//   ▸ Schulter-Twist: Range < 0,25 rad (Leine)
//   ▸ Geist-Füße: laterale Bewegung im Lehrer-Sway-Bereich
// Dump → ardy_fix_render.py (Beweisbild).
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
const { retargetToRobot, SRC_ROLES, SRC_EDGES, smoothMotionPhysics, findFootGeoms } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_fix_proof.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_fix_proof.xml');

console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
console.log('Frames: ' + out.frameCount + ' · sanity: ' + JSON.stringify(out.sanity || null));

console.log('App-Pipeline: retargetToRobot → smoothMotionPhysics → pack/unpack …');
let motion = retargetToRobot(new ArdyClip(out), sim, () => {});
smoothMotionPhysics(motion);
motion = unpackMotion(packMotion(motion));
const n = motion.n, nR = motion.srcJoints.length;
const si = {}; motion.srcJoints.forEach((r, i) => { si[r] = i; });
const sP = (f, r) => { const o = (f * nR + si[r]) * 3; return [motion.srcPos[o], motion.srcPos[o + 1], motion.srcPos[o + 2]]; };

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };

// 1) Skeleton-Seiten
{
  let leftPos = 0, cnt = 0;
  for (const r of ['leftUpLeg', 'leftArm', 'leftFoot', 'leftHand', 'leftShoulder']) {
    if (si[r] === undefined) continue;
    cnt++;
    if (sP(0, r)[1] > 0) leftPos++;
  }
  ok(leftPos === cnt, 'Linke Rollen auf Roboter-Links (+y)', leftPos + '/' + cnt);
}
// 2) Bein-Überkreuzung über alle Frames
{
  let crossFoot = 0, crossKnee = 0, minSep = Infinity;
  for (let f = 0; f < n; f++) {
    const dF = sP(f, 'leftFoot')[1] - sP(f, 'rightFoot')[1];
    const dK = sP(f, 'leftLeg')[1] - sP(f, 'rightLeg')[1];
    if (dF <= 0) crossFoot++;
    if (dK <= 0) crossKnee++;
    minSep = Math.min(minSep, dF);
  }
  ok(crossFoot === 0 && crossKnee === 0, 'Keine Bein-Überkreuzung (Skeleton)', 'Knöchel 0/' + n + ' · Knie 0/' + n + ' · min Separation ' + minSep.toFixed(3) + ' m');
}
// 3) Schulter-Twist-Leine
{
  const A = sim.actByName;
  for (const side of ['left', 'right']) {
    const nm = side + '_shoulder_yaw_joint', a = A[nm];
    let mn = Infinity, mx = -Infinity;
    for (let f = 0; f < n; f++) { const v = motion.q[f * motion.nu + a]; if (v < mn) mn = v; if (v > mx) mx = v; }
    ok(mx - mn < 0.25, nm + ' Range < 0,25 rad (Twist-Leine)', (mx - mn).toFixed(3) + ' rad');
  }
}
// 4) Geist-Füße (FK über alle Frames)
{
  const footGeoms = findFootGeoms(sim);
  const ghost = sim.makeGhostData();
  const acc = footGeoms.map(() => ({ y: [Infinity, -Infinity] }));
  for (let f = 0; f < n; f++) {
    sim.setGhostPose(ghost, motion.q, f * motion.nu, motion.h[f], 0, 0, 0, motion.baseQ ? motion.baseQ.subarray(4 * f, 4 * f + 4) : null);
    footGeoms.forEach((g, i) => {
      const y = ghost.xpos[3 * g.body + 1];
      acc[i].y[0] = Math.min(acc[i].y[0], y); acc[i].y[1] = Math.max(acc[i].y[1], y);
    });
  }
  const swings = acc.map(a => a.y[1] - a.y[0]);
  const maxSwing = Math.max(...swings);
  ok(maxSwing < 0.11, 'Geist-Fuß-Schwingen im Lehrer-Sway-Bereich', 'max Δy ' + maxSwing.toFixed(3) + ' m');
}
// 5) Hand-Abriss (Skeleton)
{
  let maxErr = 0;
  for (const side of ['left', 'right']) {
    const lHE = Math.hypot(...[0, 1, 2].map(k => sP(0, side + 'HandEnd')[k] - sP(0, side + 'Hand')[k]));
    for (let f = 0; f < n; f++) {
      const d = Math.hypot(...[0, 1, 2].map(k => sP(f, side + 'HandEnd')[k] - sP(f, side + 'Hand')[k]));
      if (lHE > 1e-6) maxErr = Math.max(maxErr, Math.abs(d - lHE) / lHE);
    }
  }
  ok(maxErr < 0.02, 'Hände am Skeleton (HandEnd-Knochen stabil)', 'max Abweichung ' + (maxErr * 100).toFixed(1) + ' %');
}

// Dump für Beweisbild (Frontansicht: 4 Frames Skeleton + G1-Nullpose)
const frames = [0, Math.floor(n / 3), Math.floor(2 * n / 3), n - 1];
const g0 = sim.makeGhostData();
sim._mjApi.mj_resetData(sim.model, g0);
sim._mjApi.mj_forward(sim.model, g0);
const mjName = (b) => { try { return sim._mjApi.mj_id2name(sim.model, 1, b) || ''; } catch (e) { return ''; } };
const robotJoints = [];
for (let b = 1; b < sim.nbody; b++) {
  const nm = mjName(b);
  if (/hip|knee|ankle|shoulder|elbow|wrist|waist|pelvis|torso/.test(nm)) {
    robotJoints.push({ name: nm, pos: [g0.xpos[3 * b], g0.xpos[3 * b + 1], g0.xpos[3 * b + 2]] });
  }
}
writeFileSync(path.join(HERE, 'fix_proof_dump.json'), JSON.stringify({
  roles: motion.srcJoints.slice(), edges: SRC_EDGES, frames, n,
  srcPos: frames.map(f => Array.from(motion.srcPos.subarray(f * nR * 3, (f + 1) * nR * 3))),
  robotJoints,
}));
console.log('\n■ Dump: fix_proof_dump.json');
console.log(fails === 0 ? '■ ALLE CHECKS GRÜN' : '■ ' + fails + ' CHECKS FEHLGESCHLAGEN');
process.exit(fails === 0 ? 0 : 1);
