// ═══════════════════════════════════════════════════════════
// ardy_walk_probe.mjs — echte GEH-Fahrt durch den Decoder
// (Root-Feature X rampt 0→1 m) → misst:
//   ▸ drift̂ (Welt) — wohin läuft die Figur?
//   ▸ facing_lokal = G_hips^T · drift̂ → ±Z lokal = Blickrichtung
//   ▸ rechts_lokal = up × drift̂, Seite der "Right"-Knochen
// Entscheide: NAMEN GETAUSCHT (A) vs. BLICK −Z (B)
// Usage: node scripts/ardy/ardy_walk_probe.mjs  (CWD = scripts/ardy)
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
const rec = manifest.recenter;

async function decode(rootFn) {
  const dec = await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx'));
  const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  let _s = 4242 >>> 0;
  const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const NFPT = dims.num_frames_per_token;
  const TOK = 10;
  for (let tokI = 0; tokI < TOK; tokI++) {
    const base = tokI * dims.hybrid_dim;
    for (let f = 0; f < NFPT; f++) {
      const fb = base + f * dims.root_features_per_frame;
      const r = rootFn(tokI * NFPT + f); // Welt-Root-FEATURES (x,y,z,h0,h1)
      h[fb + 0] = (r[0] - rec.root_mean[0]) / rec.root_std[0];
      h[fb + 1] = (r[1] - rec.root_mean[1]) / rec.root_std[1];
      h[fb + 2] = (r[2] - rec.root_mean[2]) / rec.root_std[2];
      h[fb + 3] = (r[3] - rec.root_mean[3]) / rec.root_std[3];
      h[fb + 4] = (r[4] - rec.root_mean[4]) / rec.root_std[4];
    }
    for (let rr = 0; rr < dims.latent_dim; rr++) h[base + dims.nframe_root_dim + rr] = Math.fround(gauss() * 0.01);
  }
  const mask = new Float32Array(dims.max_frames);
  mask.fill(1, 0, TOK * NFPT);
  const out = await dec.run({
    [g.hybridTokens]: new ort.Tensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
    [g.motionPadMask]: new ort.Tensor('float32', mask, [1, dims.max_frames]),
    [g.globalTranslation]: new ort.Tensor('float32', new Float32Array([0, 0, 0]), [1, 3]),
  });
  const N = TOK * NFPT;
  return {
    N,
    pos: new Float32Array(out[o.posedJoints].data.subarray(0, N * J * 3)),
    root: new Float32Array(out[o.rootPositions].data.subarray(0, N * 3)),
    G: new Float32Array(out[o.globalRotations].data.subarray(0, N * J * 9)),
  };
}

function mvecT(M, v) {
  return [
    M[0] * v[0] + M[3] * v[1] + M[6] * v[2],
    M[1] * v[0] + M[4] * v[1] + M[7] * v[2],
    M[2] * v[0] + M[5] * v[1] + M[8] * v[2],
  ];
}

// WALK: Welt-X rampt 0 → 1.0 m über 40 Frames (≈ 0.9 m/s), Höhe 0.9, Heading (1,0)
const w = await decode((f) => [f * (1.0 / 39), 0.9, 0, 1, 0]);
const N = w.N;
console.log('■ Walk-Probe (' + N + ' Frames, Root-X rampt 0→1 m):');
const drift = [
  w.root[(N - 1) * 3] - w.root[0],
  w.root[(N - 1) * 3 + 1] - w.root[1],
  w.root[(N - 1) * 3 + 2] - w.root[2],
];
const dl = Math.hypot(...drift) || 1;
console.log('   rootPos-Drift Welt = [' + drift.map(v => v.toFixed(3)).join(', ') + ']  |Δ|=' + dl.toFixed(3) + ' m');
const dhat = drift.map(v => v / dl);

// facing_lokal: Mittel über Frames von G_hips^T · d̂
{
  let acc = [0, 0, 0];
  for (let f = 0; f < N; f++) {
    const Gh = w.G.subarray((f * J + 0) * 9, (f * J + 0) * 9 + 9);
    const v = mvecT(Gh, dhat);
    acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2];
  }
  const m = acc.map(v => v / N);
  const len = Math.hypot(...m) || 1;
  console.log('   facing in Hüft-LOKAL = [' + m.map(v => (v / len).toFixed(3)).join(', ') + ']  → Blick = lokal ' +
    (Math.abs(m[2]) > Math.abs(m[0]) ? (m[2] > 0 ? '+Z' : '−Z') : (m[0] > 0 ? '+X' : '−X')));
}
// rechts_Welt = up × d̂ ; Seite der Right-Knochen relativ zur Laufrichtung
{
  const up = [0, 1, 0];
  const right = [
    up[1] * dhat[2] - up[2] * dhat[1],
    up[2] * dhat[0] - up[0] * dhat[2],
    up[0] * dhat[1] - up[1] * dhat[0],
  ]; // up × fwd = rechts (RH)
  const side = (j) => {
    let acc = 0;
    for (let f = 0; f < N; f++) {
      acc += (w.pos[f * J * 3 + j * 3] - w.root[f * 3]) * right[0] +
             (w.pos[f * J * 3 + j * 3 + 1] - w.root[f * 3 + 1]) * right[1] +
             (w.pos[f * J * 3 + j * 3 + 2] - w.root[f * 3 + 2]) * right[2];
    }
    return acc / N;
  };
  console.log('   rechts_Welt (up×drift) = [' + right.map(v => v.toFixed(3)).join(', ') + ']');
  console.log('   RightUpLeg(19)-Seite: ' + side(19).toFixed(3) + ' m   ·  LeftUpLeg(23)-Seite: ' + side(23).toFixed(3) + ' m');
  console.log('   → ' + (side(19) > 0
    ? '„Right"-Knochen LIEGT anatomisch RECHTS → Namen OK, Problem = Blick/Achse'
    : '„Right"-Knochen liegt anatomisch LINKS → NAMEN GETAUSCHT (Spiegel)'));
}
process.exit(0);
