// ═══════════════════════════════════════════════════════════
// ardy_fp16_decoder_diag.mjs — Der fp16-Decoder ist der
// Hauptverdächtige für die Explosion auf dem Gerät (LFS-Hash
// zeigt: fp16-Denoiser == fp32-Denoiser, aber fp16-Decoder ist
// ein ECHTER fp16-Graph). Test: IDENTISCHE echte Hybrid-Tokens
// (Text-Encoder + Denoiser fp32, echter Prompt) → beide Decoder →
// posedJoints vergleichen.
// Usage: node scripts/ardy/ardy_fp16_decoder_diag.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));
const dims = manifest.dimensions;
const J = dims.num_joints;
const parents = manifest.skeleton.parents;

// ── 1) Echte Hybrid-Tokens erzeugen (App-Pfad, fp32) ──
const { ArdyRuntime, setOrtTensorClass, prepareWindow, buildWindow, recenterWindow, PortableRandom } =
  await import('/home/z/my-project/app/src/main/assets/www/js/ardy.js');
const { BertWordPiece } = await import('/home/z/my-project/app/src/main/assets/www/js/ardytoken.js');

const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz')))));
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');

const prompt = 'a person walks forward at a steady pace';
const textCond = await rt._encodeText(prompt);
const state = { tokens: new Float32Array(0), frameCount: 0, translation: [0, 0, 0], heading: 0 };
const win0 = prepareWindow(dims, manifest.recenter, state, dims.history_frames);
const win = buildWindow(dims, new PortableRandom(7), win0.history); // deterministisch
await rt._denoiseWindow(win, textCond, 2.0, win0.firstHeadingAngle, null, undefined, 0, 10);
const m = win.historyTokens + win.generationTokens;
const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
h.set(win.x.subarray(0, m * dims.hybrid_dim));
const rec = recenterWindow(h, m, dims, manifest.recenter, manifest.quant, win0.globalTranslation, win.generationTokenOffset);
console.log('Hybrid-Tokens erzeugt: ' + m + ' Tokens · globalTranslation ' + rec.globalTranslation.map((v) => v.toFixed(2)).join(','));

// ── 2) Beide Decoder auf identische Eingaben ──
const g = manifest.graphs.decoder.inputs;
const o = manifest.graphs.decoder.outputs;
const feeds = () => ({
  [g.hybridTokens]: new ort.Tensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
  [g.motionPadMask]: new ort.Tensor('float32', (() => {
    const a = new Float32Array(dims.max_frames);
    for (let i = 0; i < Math.ceil(m / dims.num_frames_per_token) * dims.num_frames_per_token; i++) a[i] = 1;
    return a;
  })(), [1, dims.max_frames]),
  [g.globalTranslation]: new ort.Tensor('float32', new Float32Array(rec.globalTranslation), [1, 3]),
});

const dec32 = await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx'));
const r32 = await dec32.run(feeds());
const joints32 = r32[o.posedJoints].data;

const dec16 = await ort.InferenceSession.create(path.join(HERE, 'decoder_fp16.onnx'));
const r16 = await dec16.run(feeds());
const joints16 = r16[o.posedJoints].data;

function stats(name, pos) {
  let nan = 0, inf = 0, mx = 0, mn = Infinity;
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i];
    if (Number.isNaN(v)) { nan++; continue; }
    if (!Number.isFinite(v)) { inf++; continue; }
    if (Math.abs(v) > mx) mx = Math.abs(v);
    if (v < mn) mn = v;
  }
  // Knochenlängen-Check (Median-Referenz wie im Batch-Diag)
  const bones = [];
  for (let j = 0; j < J; j++) if (parents[j] >= 0) bones.push([j, parents[j]]);
  const refLen = bones.map(([c, p]) => {
    const b = 0;
    return Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]);
  });
  let bad = 0, worst = 0;
  const nF = dims.max_frames;
  for (let f = 0; f < nF; f++) {
    const b = f * J * 3;
    for (let k = 0; k < bones.length; k++) {
      const [c, p] = bones[k];
      const ref = refLen[k];
      if (ref > 1e-4 && Number.isFinite(ref)) {
        const L = Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]);
        const e = Math.abs(L - ref) / ref;
        if (e > 0.3) bad++;
        if (e > worst) worst = e;
      }
    }
  }
  console.log(name + ': NaN=' + nan + ' Inf=' + inf + ' |max|=' + mx.toFixed(1) + ' min=' + mn.toFixed(2) + ' · Knochen>30%: ' + bad + ' · worst ' + (worst * 100).toFixed(0) + '%');
}
stats('fp32-Decoder', joints32);
stats('fp16-Decoder', joints16);

let diffMax = 0, diffSum = 0;
for (let i = 0; i < joints32.length; i++) {
  const d = Math.abs(joints32[i] - joints16[i]);
  if (Number.isFinite(d)) { if (d > diffMax) diffMax = d; diffSum += d; }
}
console.log('Diff fp32↔fp16: max=' + diffMax.toFixed(3) + ' m · mean=' + (diffSum / joints32.length).toFixed(4) + ' m');
