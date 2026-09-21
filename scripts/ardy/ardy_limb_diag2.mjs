// ═══════════════════════════════════════════════════════════
// ardy_limb_diag2.mjs — Vertiefung:
//   F) q-Bereiche je Gelenk (nicht nur Raten) + baseQ-Euler je Frame
//   G) SPiegel-Vergleich: rohe Ausgabe OHNE mirror (rekonstruiert) —
//      liegt LeftUpLeg dann auf der MJC-LINKS-Seite (+y)?
//   H) Skeleton-Seite vs. Roboter-Seite (Overlay-Geometrie)
//   Dump für Render.
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
const { ArdyRuntime, setOrtTensorClass, mirrorArdyOutputX } = await import(path.join(WWW, 'js/ardy.js'));
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

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_limb_diag2.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_limb_diag2.xml');

console.log('Generiere „a person stands still, idle" (Seed 7, 4 s) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
const n = out.frameCount, J = 27;

// ── G) Spiegel-Vergleich ────────────────────────────────────
// out ist BEREITS gespiegelt (generate tut das). Rekonstruiere die UNMIRROR-
// Version (x → −x; Rotations-Flip ist involutiv) und vergleiche die Seiten.
const unmirror = JSON.parse(JSON.stringify({ j: Array.from(out.joints) }));
const JN = out.jointNames;
const rawIdx = {}; JN.forEach((nm, i) => { rawIdx[nm.toLowerCase()] = i; });
console.log('\n■ G) Seiten-Vergleich (MJC-lateral = decoder-x via GLB-Permutation):');
const sideOf = (arr, f, j) => { const b = (f * J + j) * 3; return arr[b]; }; // decoder x
let withMirrorOk = 0, withoutMirrorOk = 0;
for (const [l, r] of [['LeftUpLeg', 'RightUpLeg'], ['LeftArm', 'RightArm'], ['LeftFoot', 'RightFoot'], ['LeftHand', 'RightHand'], ['LeftShoulder', 'RightShoulder']]) {
  const jl = rawIdx[l.toLowerCase()], jr = rawIdx[r.toLowerCase()];
  const xMirL = sideOf(out.joints, 0, jl), xMirR = sideOf(out.joints, 0, jr);
  const xRawL = -xMirL, xRawR = -xMirR; // un-mirror
  const mirOk = xMirL > xMirR;   // GLB-Konvention: Links = +x
  const rawOk = xRawL > xRawR;
  if (mirOk) withMirrorOk++; if (rawOk) withoutMirrorOk++;
  console.log(`   ${l.padEnd(14)} MIT Spiegel: L=${xMirL.toFixed(3)} R=${xMirR.toFixed(3)} ${mirOk ? '✓' : '✗ VERTAUSCHT'}   OHNE Spiegel: L=${xRawL.toFixed(3)} R=${xRawR.toFixed(3)} ${rawOk ? '✓' : '✗ VERTAUSCHT'}`);
}
console.log(`   → MIT Spiegel ${withMirrorOk}/5 korrekt · OHNE Spiegel ${withoutMirrorOk}/5 korrekt`);

// ── App-Pipeline mit beiden Varianten ───────────────────────
// Variante 1: WIE APP (gespiegelt) — Variante 2: OHNE Spiegel
function buildMotion(ardyOut, label) {
  const logs = [];
  const m = retargetToRobot(new ArdyClip(ardyOut), sim, (mm) => logs.push(mm));
  smoothMotionPhysics(m);
  console.log(`\n[Variante: ${label}]`);
  return m;
}
const motionApp = buildMotion(out, 'WIE APP (mit X-Spiegel)');

const outRaw = { ...out };
outRaw.joints = out.joints.slice();
mirrorArdyOutputX(outRaw); // involutiv → zurück zum Rohzustand
// Sanitizer-Metriken liegen schon vor; ArdyClip braucht joints/globalRotations
const motionRaw = buildMotion(outRaw, 'OHNE X-Spiegel');

// ── F) q-Bereiche + baseQ-Euler (App-Variante) ──────────────
console.log('\n■ F) q-Bereiche (App-Variante, nach Glättung):');
{
  const nu = motionApp.nu, A = sim.actByName;
  const rows = [];
  for (const side of ['left', 'right']) {
    for (const nm of [side + '_hip_yaw_joint', side + '_hip_roll_joint', side + '_hip_pitch_joint', side + '_knee_joint', side + '_shoulder_pitch_joint', side + '_shoulder_roll_joint', side + '_shoulder_yaw_joint', side + '_elbow_joint']) {
      const a = A[nm]; if (a === undefined) continue;
      let mn = Infinity, mx = -Infinity;
      for (let f = 0; f < n; f++) { const v = motionApp.q[f * nu + a]; if (v < mn) mn = v; if (v > mx) mx = v; }
      rows.push({ nm, range: mx - mn, mn, mx });
      console.log(`   ${nm.padEnd(28)} Range ${(mx - mn).toFixed(3)} rad [${mn.toFixed(2)}, ${mx.toFixed(2)}]`);
    }
  }
}
console.log('\n   baseQ-Euler (Nick/Roll) je Frame — Schwankung des Geist-Oberkörpers:');
{
  const bq = motionApp.baseQ;
  const eu = (q) => { // xyzw → roll(x), pitch(y)
    const roll = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[0] * q[0] + q[1] * q[1]));
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q[0] * q[3] - q[1] * q[2]))));
    return [roll, pitch];
  };
  let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity;
  for (let f = 0; f < n; f++) {
    const [r, p] = eu([bq[4 * f], bq[4 * f + 1], bq[4 * f + 2], bq[4 * f + 3]]);
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (p < pMin) pMin = p; if (p > pMax) pMax = p;
  }
  console.log(`   Roll-Range ${(rMax - rMin).toFixed(3)} rad (${((rMax - rMin) * 180 / Math.PI).toFixed(1)}°) · Pitch-Range ${(pMax - pMin).toFixed(3)} rad (${((pMax - pMin) * 180 / Math.PI).toFixed(1)}°)`);
}

// ── H) Skeleton-Seite vs. Roboter-Seite (beide Varianten) ───
const sideCheck = (motion, label) => {
  const srcPos = motion.srcPos, srcJoints = motion.srcJoints, nR = srcJoints.length;
  const si = {}; srcJoints.forEach((r, i) => { si[r] = i; });
  const P = (f, r) => (f * nR + si[r]) * 3;
  let lOk = 0, cnt = 0;
  for (const r of ['leftUpLeg', 'leftArm', 'leftFoot', 'leftHand', 'leftShoulder']) {
    if (si[r] === undefined) continue;
    const y = srcPos[P(0, r) + 1];
    cnt++;
    if (y > 0) lOk++;
  }
  console.log(`   ${label}: linke Rollen auf MJC-+y (links): ${lOk}/${cnt}`);
  return { lOk, cnt };
};
console.log('\n■ H) Skeleton-Seite vs. Roboter (Roboter-links = MJC +y):');
sideCheck(motionApp, 'MIT Spiegel (App-Stand)');
sideCheck(motionRaw, 'OHNE Spiegel');

// Geist-Füße: Range je Achse (App-Variante)
const footGeoms = findFootGeoms(sim);
const gRange = (motion, label) => {
  const ghost = sim.makeGhostData(), nu = motion.nu;
  const acc = footGeoms.map(() => ({ x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] }));
  for (let f = 0; f < n; f++) {
    sim.setGhostPose(ghost, motion.q, f * nu, motion.h[f], 0, 0, 0, motion.baseQ ? motion.baseQ.subarray(4 * f, 4 * f + 4) : null);
    footGeoms.forEach((g, i) => {
      const x = ghost.xpos[3 * g.body], y = ghost.xpos[3 * g.body + 1], z = ghost.xpos[3 * g.body + 2] + g.lowZ;
      acc[i].x[0] = Math.min(acc[i].x[0], x); acc[i].x[1] = Math.max(acc[i].x[1], x);
      acc[i].y[0] = Math.min(acc[i].y[0], y); acc[i].y[1] = Math.max(acc[i].y[1], y);
      acc[i].z[0] = Math.min(acc[i].z[0], z); acc[i].z[1] = Math.max(acc[i].z[1], z);
    });
  }
  console.log(`   ${label} Geist-Füße Range:`);
  acc.forEach((a, i) => console.log(`     Fuß${i}: Δx=${(a.x[1] - a.x[0]).toFixed(3)} Δy=${(a.y[1] - a.y[0]).toFixed(3)} Δz=${(a.z[1] - a.z[0]).toFixed(3)} m · y-Mitte ${((a.y[0] + a.y[1]) / 2).toFixed(3)} m`));
};
console.log('\n■ I) Geist-Fuß-Bewegungsbereich:');
gRange(motionApp, 'MIT Spiegel');
gRange(motionRaw, 'OHNE Spiegel');

// ── Dump: beide Varianten je 5 Frames ───────────────────────
const dump = (motion, key) => {
  const srcPos = motion.srcPos, nR = motion.srcJoints.length;
  const frames = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])];
  return {
    frames,
    srcPos: frames.map(f => Array.from(srcPos.subarray(f * nR * 3, (f + 1) * nR * 3))),
    raw: frames.map(f => {
      const src = key === 'mir' ? out.joints : outRaw.joints;
      const a = new Array(J * 3);
      for (let j = 0; j < J; j++) { const b = (f * J + j) * 3; a[j * 3] = src[b + 2]; a[j * 3 + 1] = src[b]; a[j * 3 + 2] = src[b + 1]; }
      return a;
    }),
  };
};
writeFileSync(path.join(HERE, 'limb2_dump.json'), JSON.stringify({
  roles: SRC_ROLES.slice(), edges: SRC_EDGES, n,
  app: dump(motionApp, 'mir'),
  rawNoMirror: dump(motionRaw, 'raw'),
}));
console.log('\n■ Dump: limb2_dump.json');
