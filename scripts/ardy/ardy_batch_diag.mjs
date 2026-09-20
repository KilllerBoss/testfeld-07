// ═══════════════════════════════════════════════════════════
// ardy_batch_diag.mjs — Wie oft kollabiert/explodiert ARDY Mini
// (fp32) über typische Prompts × Seeds? Quantifiziert die
// Kollaps-Häufigkeit, die die App abfangen muss.
// Usage: node scripts/ardy/ardy_batch_diag.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));
const dims = manifest.dimensions;

const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass } = await import('/home/z/my-project/app/src/main/assets/www/js/ardy.js');
const { BertWordPiece } = await import('/home/z/my-project/app/src/main/assets/www/js/ardytoken.js');
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');

const J = dims.num_joints;
const parents = manifest.skeleton.parents;
const bones = [];
for (let j = 0; j < J; j++) if (parents[j] >= 0) bones.push({ c: j, p: parents[j] });

function quickStats(out) {
  const n = out.frameCount, pos = out.joints;
  // Referenzlängen aus Frame 0 (robust: Median der ersten 10 Frames)
  const refLen = bones.map(({ c, p }) => {
    const L = [];
    for (let f = 0; f < Math.min(10, n); f++) {
      const b = f * J * 3;
      L.push(Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]));
    }
    L.sort((a, b) => a - b);
    return L[Math.floor(L.length / 2)] || 0;
  });
  let nan = 0, bad30 = 0, bad100 = 0, firstBad = -1;
  let hipMin = Infinity, hipMax = -Infinity;
  for (let f = 0; f < n; f++) {
    const b = f * J * 3;
    let fmx = 0, hasNan = false;
    for (let i = 0; i < J * 3; i++) if (Number.isNaN(pos[b + i])) { hasNan = true; break; }
    if (hasNan) { nan++; continue; }
    for (let k = 0; k < bones.length; k++) {
      const { c, p } = bones[k];
      const L = Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]);
      if (refLen[k] > 1e-4) {
        const e = Math.abs(L - refLen[k]) / refLen[k];
        if (e > fmx) fmx = e;
      }
    }
    if (fmx > 0.3) { bad30++; if (firstBad < 0) firstBad = f; }
    if (fmx > 1.0) bad100++;
    const hy = pos[b + 1];
    if (Number.isFinite(hy)) { hipMin = Math.min(hipMin, hy); hipMax = Math.max(hipMax, hy); }
  }
  return { n, nan, bad30, bad100, firstBad, hipMin, hipMax };
}

const prompts = [
  'a person walks forward at a steady pace',
  'a person dances energetically',
  'a person jumps up and down',
  'a person waves both hands',
  'a person kicks a ball',
];
const seeds = [7, 42];
let exploded = 0, total = 0;
for (const prompt of prompts) {
  for (const seed of seeds) {
    const out = await rt.generate({ prompt, seconds: 8, seed });
    const s = quickStats(out);
    total++;
    const bad = s.nan > 0 || s.bad30 > s.n * 0.15 || s.hipMax > 2.2 || (Number.isFinite(s.hipMin) && s.hipMin < 0.32);
    if (bad) exploded++;
    console.log(
      (bad ? '✗ EXPLODIERT/KOLLABIERT' : '✓ ok               ') +
      ' · „' + prompt.slice(10, 34) + '” · seed ' + seed +
      ' · NaN ' + s.nan + '/' + s.n +
      ' · >30% ' + s.bad30 + ' · >100% ' + s.bad100 +
      ' · 1.bad@' + s.firstBad +
      ' · Hüfte ' + (Number.isFinite(s.hipMin) ? s.hipMin.toFixed(2) : 'NaN') + '–' + (Number.isFinite(s.hipMax) ? s.hipMax.toFixed(2) : 'NaN')
    );
  }
}
console.log('\nBilanz: ' + exploded + '/' + total + ' Generationen auffällig');
