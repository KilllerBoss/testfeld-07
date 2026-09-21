// ═══════════════════════════════════════════════════════════
// ardy_convention_diag.mjs — ARDY-Decoder-KONVENTIONEN beweisen
// (Spiegelsymmetrie-invariante Checks!):
//   1) Rotations-Verkettung: G_j ≈ G_parent·L_j (row-major M·v)?
//      Alternativen: L·G, G^T-L-Kombis → bester Match
//   2) Links/Rechts: Hüft-lokale Knochenrichtungen der UpLegs/
//      Shoulders — GLB/Mixamo-Erwartung: rechts=+X, links=−X,
//      Kopf=+Y (up), Blick=+Z (fwd)
//   3) mat3ToQuat-Verträglichkeit: aus G_hips gebaute Quaternion
//      vs. Matrix — dreht rotVec gleich?
// Usage: node scripts/ardy/ardy_convention_diag.mjs  (CWD = scripts/ardy)
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const manifest = JSON.parse(new TextDecoder().decode(
  await import('node:zlib').then(z => z.gunzipSync(readFileSync(path.join(HERE, 'model.json.gz'))))));
const dims = manifest.dimensions;
const g = manifest.graphs.decoder.inputs;
const o = manifest.graphs.decoder.outputs;
const J = dims.num_joints;
const names = manifest.skeleton.joint_names;
const parents = manifest.skeleton.parents;

// ── Decoder mit denselben statischen Idle-Tokens wie ardy_retarget_diag ──
const dec = await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx'));
const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
const rec = manifest.recenter;
const rngSeed = 4242;
let _s = rngSeed >>> 0;
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const NFPT = dims.num_frames_per_token;
const GEN_TOKENS = 10;
for (let tokI = 0; tokI < GEN_TOKENS; tokI++) {
  const base = tokI * dims.hybrid_dim;
  for (let f = 0; f < NFPT; f++) {
    const fb = base + f * dims.root_features_per_frame;
    h[fb + 0] = (0 - rec.root_mean[0]) / rec.root_std[0];
    h[fb + 1] = (0.9 - rec.root_mean[1]) / rec.root_std[1];
    h[fb + 2] = (0 - rec.root_mean[2]) / rec.root_std[2];
    h[fb + 3] = (1 - rec.root_mean[3]) / rec.root_std[3];
    h[fb + 4] = (0 - rec.root_mean[4]) / rec.root_std[4];
  }
  for (let r = 0; r < dims.latent_dim; r++) h[base + dims.nframe_root_dim + r] = Math.fround(gauss() * 0.01);
}
const mask = new Float32Array(dims.max_frames);
mask.fill(1, 0, GEN_TOKENS * NFPT);
const out = await dec.run({
  [g.hybridTokens]: new ort.Tensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
  [g.motionPadMask]: new ort.Tensor('float32', mask, [1, dims.max_frames]),
  [g.globalTranslation]: new ort.Tensor('float32', new Float32Array([0, 0, 0]), [1, 3]),
});
const N = GEN_TOKENS * NFPT;
const pos = new Float32Array(out[o.posedJoints].data.subarray(0, N * J * 3));
const G = new Float32Array(out[o.globalRotations].data.subarray(0, N * J * 9));
const L = new Float32Array(out[o.localRotations].data.subarray(0, N * J * 9));

// ── Matrizen-Mul (row-major, 9 floats) ──
function mul(A, B) { // C = A·B (row-major)
  const C = new Float32Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  }
  return C;
}
function transpose(A) {
  return Float32Array.of(A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]);
}
function matErr(A, B) {
  let e = 0;
  for (let i = 0; i < 9; i++) e = Math.max(e, Math.abs(A[i] - B[i]));
  return e;
}

console.log('■ [1] Rotations-Verkettung (max |Δ| über alle Frames/Gelenke):');
{
  const cands = {
    'G = Gp·L  (row-major, wie glTF/ardyclip.js-Kommentar)': (Gp, Lj) => mul(Gp, Lj),
    'G = L·Gp': (Gp, Lj) => mul(Lj, Gp),
    'G = Gp·L^T': (Gp, Lj) => mul(Gp, transpose(Lj)),
    'G = L^T·Gp': (Gp, Lj) => mul(transpose(Lj), Gp),
    'G = Gp^T·L': (Gp, Lj) => mul(transpose(Gp), Lj),
  };
  const errs = Object.keys(cands).map(() => 0);
  for (let f = 0; f < N; f++) {
    for (let j = 0; j < J; j++) {
      const p = parents[j];
      if (p < 0) continue;
      const Gj = G.subarray((f * J + j) * 9, (f * J + j) * 9 + 9);
      const Gp = G.subarray((f * J + p) * 9, (f * J + p) * 9 + 9);
      const Lj = L.subarray((f * J + j) * 9, (f * J + j) * 9 + 9);
      Object.keys(cands).forEach((k, i) => {
        errs[i] = Math.max(errs[i], matErr(cands[k](Gp, Lj), Gj));
      });
    }
  }
  Object.keys(cands).forEach((k, i) => console.log('   ' + k.padEnd(52) + ' Δ=' + errs[i].toExponential(2)));
}

// ── RotVec-Helper: M·v (row-major) ──
function mvec(M, v) {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}
function mvecT(M, v) { // M^T·v
  return [
    M[0] * v[0] + M[3] * v[1] + M[6] * v[2],
    M[1] * v[0] + M[4] * v[1] + M[7] * v[2],
    M[2] * v[0] + M[5] * v[1] + M[8] * v[2],
  ];
}

console.log('\n■ [2] Hüft-lokale Knochenrichtungen (Mittel über Frames, R_hips^T·Δp):');
{
  const probe = [
    ['RightUpLeg-Bone  (idx19←0,  Name sagt RECHTS)', 19, 0],
    ['LeftUpLeg-Bone   (idx23←0,  Name sagt LINKS)', 23, 0],
    ['RightShoulder→Arm (idx8←7,  Name sagt RECHTS)', 8, 7],
    ['LeftShoulder→Arm  (idx14←13, Name sagt LINKS)', 14, 13],
    ['RightShoulder-Offset (idx7←4)', 7, 4],
    ['LeftShoulder-Offset  (idx13←4)', 13, 4],
    ['Neck→Head (idx6←5 — erwartet +Y/up)', 6, 5],
    ['RightLeg→RightFoot (idx21←20 — erwartet −Y/down)', 21, 20],
  ];
  for (const [label, c, p] of probe) {
    const sum = [0, 0, 0]; let cnt = 0;
    for (let f = 0; f < N; f++) {
      const Gh = G.subarray((f * J + 0) * 9, (f * J + 0) * 9 + 9); // Hips = idx 0
      const dv = [
        pos[f * J * 3 + c * 3] - pos[f * J * 3 + p * 3],
        pos[f * J * 3 + c * 3 + 1] - pos[f * J * 3 + p * 3 + 1],
        pos[f * J * 3 + c * 3 + 2] - pos[f * J * 3 + p * 3 + 2],
      ];
      // Knochenrichtung in den LOKALEN Rahmen des PARENT-Knochens (nicht Hips)
      const Gp = G.subarray((f * J + p) * 9, (f * J + p) * 9 + 9);
      const v = mvecT(Gp, dv); // Gp^T·Δp = lokal
      sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2]; cnt++;
    }
    const m = sum.map(s => (s / cnt));
    const len = Math.hypot(...m) || 1;
    console.log('   ' + label.padEnd(46) + ' lokal=[' + m.map(v => (v / len).toFixed(3)).join(', ') + ']  |Δp|≈' + len.toFixed(3) + ' m');
  }
  console.log('   → GLB/Mixamo-Erwartung: RECHTS=+X, LINKS=−X, Head=+Y, Foot=−Y');
}

console.log('\n■ [3] mat3ToQuat/rotVec-Verträglichkeit (App-Pfad):');
{
  // Aus G_hips (row-major M·v) per mat3ToQuat-Formel (ardyclip.js) → q;
  // kleine Rück-/Hin-Transformation = App-Annahme row-major M·v korrekt.
  const { mat3ToQuat } = await import(path.join(HERE, '../../app/src/main/assets/www/js/ardyclip.js'));
  function quatToMat(q) {
    const [x, y, z, w] = q;
    return Float32Array.of(
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y));
  }
  let errMV = 0, errT = 0;
  for (let f = 0; f < N; f++) {
    const M = G.subarray(0 * 9, 9); // G_hips Frame f (j=0)
    const q = mat3ToQuat(M);
    const Mq = quatToMat(q);
    // mat3ToQuat nimmt row-major M·v an → quatToMat liefert wieder M·v-Matrix
    errMV = Math.max(errMV, matErr(Mq, M));
  }
  console.log('   mat3ToQuat(G) → zurück zur Matrix: Δ=' + errMV.toExponential(2) +
    '  (klein = G IST row-major M·v, App-Annahme korrekt; groß = G ist transponiert!)');
}
console.log('\n■ [4] Welt-Achsen (statisch): Hips-Weltposition Frame-Mittel + Hand-X in WELT:');
{
  const acc = { hx: 0, hy: 0, hz: 0, rhx: 0, lhx: 0, cnt: 0 };
  for (let f = 0; f < N; f++) {
    acc.hx += pos[f * J * 3]; acc.hy += pos[f * J * 3 + 1]; acc.hz += pos[f * J * 3 + 2];
    acc.rhx += pos[f * J * 3 + 10 * 3]; acc.lhx += pos[f * J * 3 + 16 * 3];
    acc.cnt++;
  }
  console.log('   Hips-Welt ≈ [' + (acc.hx / acc.cnt).toFixed(3) + ', ' + (acc.hy / acc.cnt).toFixed(3) + ', ' + (acc.hz / acc.cnt).toFixed(3) + ']  (y≈0.9 → Y-up ✓)');
  console.log('   RightHand(10)-X = ' + (acc.rhx / acc.cnt).toFixed(3) + ' · LeftHand(16)-X = ' + (acc.lhx / acc.cnt).toFixed(3) + '  (GLB-Erwartung: rechts +X, links −X)');
}
// ── [5] G_hips + Welt-Joint-Positionen (entscheidet Spiegel vs. 180°) ──
console.log('\n■ [5] G_hips (Welt-Orientierung der Hüfte) + Welt-Positionen:');
{
  const show = (lbl, j) => {
    let acc = [0, 0, 0];
    for (let f = 0; f < N; f++) {
      acc[0] += pos[f * J * 3 + j * 3]; acc[1] += pos[f * J * 3 + j * 3 + 1]; acc[2] += pos[f * J * 3 + j * 3 + 2];
    }
    console.log('   ' + lbl.padEnd(24) + ' Welt-Mittel ≈ [' + acc.map(v => (v / N).toFixed(3)).join(', ') + ']');
  };
  show('RightUpLeg (19)', 19); show('LeftUpLeg (23)', 23);
  show('RightFoot (21)', 21); show('LeftFoot (25)', 25);
  show('Head (6)', 6); show('RightHand (10)', 10); show('LeftHand (16)', 16);
  console.log('   G_hips Frame0 (row-major):');
  for (let r = 0; r < 3; r++) {
    console.log('     [' + Array.from({ length: 3 }, (_, c) => G[r * 3 + c].toFixed(3).padStart(7)).join(', ') + ' ]');
  }
  // Mittel über alle Frames: R_hips als Achse — determinanter Check
  console.log('   det(G_hips f0) = ' + (() => {
    const M = G; return (M[0]*(M[4]*M[8]-M[5]*M[7]) - M[1]*(M[3]*M[8]-M[5]*M[6]) + M[2]*(M[3]*M[7]-M[4]*M[6])).toFixed(4);
  })());
}
process.exit(0);
