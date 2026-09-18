// ═══════════════════════════════════════════════════════════
// ardy_retarget_diag.mjs — WARUM steht der grüne Skeleton/Geist
// im Boden? Echte Kette mit Zahlen: Decoder (echtes ONNX,
// synthetische Geh-Tokens) → ArdyClip → retargetToG1 (echtes
// MuJoCo-wasm G1) → srcPos-/h-/root-/Geist-Fuß-Statistik +
// Anzeige-Anker je refMode.
// Usage: node scripts/ardy/ardy_retarget_diag.mjs   (CWD = scripts/ardy)
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '../../app/src/main/assets/www');

// fetch-Shim für relative URLs (models/… aus WWW) — wie leg_diag.mjs
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('file:') && !url.startsWith('/')) {
    const p = path.resolve(WWW, decodeURIComponent(url.split('?')[0]));
    const buf = await import('node:fs/promises').then(fs => fs.readFile(p));
    return { ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const manifest = JSON.parse(new TextDecoder().decode(
  await import('node:zlib').then(z => z.gunzipSync(readFileSync(path.join(HERE, 'model.json.gz'))))));
const dims = manifest.dimensions;
const g = manifest.graphs.decoder.inputs;
const o = manifest.graphs.decoder.outputs;

// ── 1) Echte Decoder-Inferenz (wie ardy_real_onnx_test, Geh-Tokens) ──
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
const GEN_TOKENS = 10; // 40 Frames
for (let tokI = 0; tokI < GEN_TOKENS; tokI++) {
  const base = tokI * dims.hybrid_dim;
  for (let f = 0; f < NFPT; f++) {
    const fb = base + f * dims.root_features_per_frame;
    // Geh-Bahn: leichte Vorwärtsbewegung in ARDY-Ebene
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
const J = dims.num_joints, N = 40;
const joints = new Float32Array(out[o.posedJoints].data.subarray(0, N * J * 3));
const rootPos = new Float32Array(out[o.rootPositions].data.subarray(0, N * 3));
const grots = new Float32Array(out[o.globalRotations].data.subarray(0, N * J * 9));

const stat3 = (arr, n, stride, off) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let f = 0; f < n; f++) for (let a = 0; a < 3; a++) {
    const v = arr[f * stride + off + a];
    if (!Number.isFinite(v)) continue;
    mn[a] = Math.min(mn[a], v); mx[a] = Math.max(mx[a], v);
  }
  return { mn, mx };
};
console.log('■ ARDY-Decoder-Ausgabe (40 Frames, echt):');
const jStat = stat3(joints, N, J * 3, 0); // alle Gelenke
console.log('  joints  x:[' + jStat.mn[0].toFixed(2) + ',' + jStat.mx[0].toFixed(2) + '] y:[' + jStat.mn[1].toFixed(2) + ',' + jStat.mx[1].toFixed(2) + '] z:[' + jStat.mn[2].toFixed(2) + ',' + jStat.mx[2].toFixed(2) + ']');
const rStat = stat3(rootPos, N, 3, 0);
console.log('  rootPos x:[' + rStat.mn[0].toFixed(2) + ',' + rStat.mx[0].toFixed(2) + '] y:[' + rStat.mn[1].toFixed(2) + ',' + rStat.mx[1].toFixed(2) + '] z:[' + rStat.mn[2].toFixed(2) + ',' + rStat.mx[2].toFixed(2) + ']');

// ── 2) ArdyClip + echtes RetargetToG1 mit echtem MuJoCo-wasm ──
const wasmBinary = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/unitree_g1');
const sim = new RobotSim(cfg, cfg.scene);

const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));
const clip = new ArdyClip({
  frameCount: N, fps: 20, joints, globalRotations: grots,
  jointNames: manifest.skeleton.joint_names, parents: manifest.skeleton.parents,
  prompt: 'diag', seed: rngSeed,
});
const motion = retargetToG1(clip, sim, (m) => process.stdout.write('  [RT] ' + m + '\n'));

const mnMx = (arr, stride) => {
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < arr.length; i += stride) { mn = Math.min(mn, arr[i]); mx = Math.max(mx, arr[i]); }
  return { mn, mx };
};
console.log('■ retargetToG1-Ergebnis:');
console.log('  h[]   = [' + mnMx(motion.h, 1).mn.toFixed(3) + ', ' + mnMx(motion.h, 1).mx.toFixed(3) + ']  (Geist-Wurzelhöhe)');
console.log('  root  = [' + mnMx(motion.root, 2).mn.toFixed(3) + ', ' + mnMx(motion.root, 2).mx.toFixed(3) + '] je Achse');
const srcZ = mnMx(motion.srcPos.subarray(2), 3);
console.log('  srcPos z (HÖHE) = [' + srcZ.mn.toFixed(3) + ', ' + srcZ.mx.toFixed(3) + ']  (grüner Skeleton)');
const srcX = mnMx(motion.srcPos.subarray(0), 3);
const srcY = mnMx(motion.srcPos.subarray(1), 3);
console.log('  srcPos x = [' + srcX.mn.toFixed(3) + ', ' + srcX.mx.toFixed(3) + '], y = [' + srcY.mn.toFixed(3) + ', ' + srcY.mx.toFixed(3) + ']');

// ── 3) Geist-Fußhöhe prüfen (steht der CYAN-Geist auf dem Boden?) ──
const ghost = sim.makeGhostData();
let footMin = 1e9, footMax = -1e9;
const findFootGeoms = (s) => {
  // wie retarget.js findFootGeoms: Fuß-Geoms über Namen
  const outFg = [];
  const names = (s.cfg && s.cfg.footGeoms) || ['left_foot_collision', 'right_foot_collision', 'left_foot', 'right_foot'];
  for (const nm of names) {
    try { const gid = s.geomId(nm); if (gid >= 0) outFg.push({ body: s.geomBody(gid), lowZ: 0 }); } catch (e) { /* egal */ }
  }
  return outFg;
};
const fgs = findFootGeoms(sim);
for (let f = 0; f < N; f++) {
  sim.setGhostPose(ghost, motion.q, f * motion.nu, motion.h[f], motion.root[2 * f], motion.root[2 * f + 1], motion.yaw[f], motion.baseQ.subarray(4 * f, 4 * f + 4));
  for (const fg of fgs) {
    const z = ghost.xpos[3 * fg.body + 2];
    footMin = Math.min(footMin, z); footMax = Math.max(footMax, z);
  }
}
console.log('■ Geist-Fußkörper-z (ohne lowZ-Feinkorrektur): [' + footMin.toFixed(3) + ', ' + footMax.toFixed(3) + '] — ~0 = erdet richtig');

// ── 4) Anzeige-Anker je refMode (Abstand Skeleton ↔ Geist) ──
console.log('■ Anker-Logik (Boden-x/y):');
console.log('  frei : Skeleton bei _srcBase(0,,-1.1)+srcPos-Pfad | Geist bei refRoot-Pfad — parallel, OK');
console.log('  folgt: Skeleton bei Roboter-Anker + ABSOLUTE srcPos-Pfad | Geist bei Roboter-Anker + relative Bahn');
console.log('       → wenn srcPos NICHT bei (0,0) startet, wandert der Skeleton DOPPELT weg!');
console.log('  srcPos-Start (Hüfte) = [' + motion.srcPos[0].toFixed(3) + ', ' + motion.srcPos[1].toFixed(3) + ', ' + motion.srcPos[2].toFixed(3) + ']');
console.log('  clip.root-Start      = [' + motion.root[0].toFixed(3) + ', ' + motion.root[1].toFixed(3) + ']');
process.exit(0);
