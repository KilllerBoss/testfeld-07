// ═══════════════════════════════════════════════════════════
// ardy_explode_diag.mjs — WARUM explodiert die ARDY-Animation
// auf dem Gerät („Streifen“ statt Skeleton, Geist zappelt)?
//
// Echte Full-Generation über den EXAKTEN App-Codepfad
// (ArdyRuntime.generate — prepareWindow/buildWindow/ddim/
// recenter/extract/decode) mit echten ONNX-Sessions, dann:
//   • NaN/Inf-Zählung in joints/globalRotations
//   • Knochenlängen je Frame vs. Median (Verletzung = Explosion)
//   • Hüftenhöhe + Horizontalspeed
//   • Explosion je Fenster (40 Frames) → erste schlechte Fenster
//
// Usage: node scripts/ardy/ardy_explode_diag.mjs [--seconds N] [--seed N] [--prompt "..."]
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};

const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));
const dims = manifest.dimensions;

// ── Echte Sessions unter den App-Keys laden ──
console.log('Lade echte ONNX-Sessions (fp32) …');
const t0 = Date.now();
const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
console.log('  Sessions geladen in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass } = await import('/home/z/my-project/app/src/main/assets/www/js/ardy.js');
const { BertWordPiece } = await import('/home/z/my-project/app/src/main/assets/www/js/ardytoken.js');
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');

// ── Analyse ──
function analyze(out, label) {
  const J = dims.num_joints, n = out.frameCount;
  const parents = out.parents;
  const pos = out.joints;
  let nanJ = 0, infJ = 0;
  for (let i = 0; i < pos.length; i++) {
    if (Number.isNaN(pos[i])) nanJ++;
    else if (!Number.isFinite(pos[i])) infJ++;
  }
  let nanR = 0;
  for (let i = 0; i < out.globalRotations.length; i++) if (Number.isNaN(out.globalRotations[i])) nanR++;

  // Referenz-Knochenlängen = Median über alle Frames
  const bones = [];
  for (let j = 0; j < J; j++) if (parents[j] >= 0) bones.push({ c: j, p: parents[j] });
  const refLen = bones.map(({ c, p }) => {
    const L = [];
    for (let f = 0; f < n; f++) {
      const b = f * J * 3;
      L.push(Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]));
    }
    L.sort((a, b) => a - b);
    return L[Math.floor(n / 2)] || 0;
  });

  // Je Frame: max rel. Knochenlängenfehler, Hüfte, Speed
  const frameErr = new Float64Array(n);
  let hipMin = Infinity, hipMax = -Infinity, hipSpeedMax = 0;
  let prevX = null, prevZ = null;
  for (let f = 0; f < n; f++) {
    const b = f * J * 3;
    let mx = 0;
    for (let k = 0; k < bones.length; k++) {
      const { c, p } = bones[k];
      const L = Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]);
      const ref = refLen[k];
      if (ref > 1e-4) {
        const e = Math.abs(L - ref) / ref;
        if (e > mx) mx = e;
      }
    }
    frameErr[f] = mx;
    const hy = pos[b + 1];
    if (Number.isFinite(hy)) { hipMin = Math.min(hipMin, hy); hipMax = Math.max(hipMax, hy); }
    const hx = pos[b], hz = pos[b + 2];
    if (prevX !== null && Number.isFinite(hx) && Number.isFinite(hz)) {
      hipSpeedMax = Math.max(hipSpeedMax, Math.hypot(hx - prevX, hz - prevZ) * out.fps);
    }
    prevX = hx; prevZ = hz;
  }

  // Je Fenster (40 Frames): erster Frame mit Fehler > 0,3?
  const WF = dims.generation_frames;
  let firstBadFrame = -1, firstBadWindow = -1;
  for (let f = 0; f < n; f++) {
    if (frameErr[f] > 0.3) { firstBadFrame = f; firstBadWindow = Math.floor(f / WF); break; }
  }
  const winStats = [];
  for (let w = 0; w * WF < n; w++) {
    let mx = 0, cnt = 0, nan = 0;
    for (let f = w * WF; f < Math.min(n, (w + 1) * WF); f++) {
      if (frameErr[f] > mx) mx = frameErr[f];
      if (frameErr[f] > 0.3) cnt++;
      const b = f * J * 3;
      for (let i = 0; i < J; i++) if (Number.isNaN(pos[b + i * 3])) { nan++; break; }
    }
    winStats.push({ w, maxErr: mx.toFixed(2), bad: cnt, nan });
  }

  console.log('\n═══ ' + label + ' ═══');
  console.log('  Frames: ' + n + '  (@' + out.fps + ' FPS, ' + (n / out.fps).toFixed(1) + ' s)');
  console.log('  NaN in joints: ' + nanJ + ' · Inf: ' + infJ + ' · NaN in globalRotations: ' + nanR);
  console.log('  Hüftenhöhe: ' + (Number.isFinite(hipMin) ? hipMin.toFixed(2) : 'NaN') + ' … ' + (Number.isFinite(hipMax) ? hipMax.toFixed(2) : 'NaN') + ' m · max Horizontalspeed: ' + hipSpeedMax.toFixed(1) + ' m/s');
  const bad30 = Array.from(frameErr).filter((e) => e > 0.3).length;
  const bad100 = Array.from(frameErr).filter((e) => e > 1.0).length;
  console.log('  Frames mit Knochenfehler >30 %: ' + bad30 + '/' + n + ' · >100 %: ' + bad100);
  console.log('  erstes schlechtes Frame: ' + (firstBadFrame < 0 ? 'keins' : firstBadFrame + ' (Fenster ' + firstBadWindow + ')'));
  for (const s of winStats) console.log('    Fenster ' + s.w + ': maxErr=' + s.maxErr + ' · Frames>30%: ' + s.bad + ' · NaN-Frames: ' + s.nan);

  // Extrembeispiel: schlechtestes Frame, längster Knochen
  if (bad30 > 0) {
    let worst = 0;
    for (let f = 0; f < n; f++) if (frameErr[f] > frameErr[worst]) worst = f;
    const b = worst * J * 3;
    let mxK = 0, mxV = 0;
    for (let k = 0; k < bones.length; k++) {
      const { c, p } = bones[k];
      const L = Math.hypot(pos[b + c * 3] - pos[b + p * 3], pos[b + c * 3 + 1] - pos[b + p * 3 + 1], pos[b + c * 3 + 2] - pos[b + p * 3 + 2]);
      if (refLen[k] > 1e-4) {
        const e = Math.abs(L - refLen[k]) / refLen[k];
        if (e > mxK) { mxK = e; mxV = L; }
      }
    }
    console.log('  schlimmstes Frame ' + worst + ': Knochen Soll ' + '?~' + ' Ist ' + mxV.toFixed(2) + ' m (Fehler ' + (mxK * 100).toFixed(0) + ' %)');
  }
  return { frameErr, bad30, firstBadFrame };
}

// ── Generationen ──
const prompt = arg('--prompt', 'a person walks forward at a steady pace');
const seed = parseInt(arg('--seed', '7'), 10);
const seconds = parseFloat(arg('--seconds', '4'));
console.log('\nPrompt: „' + prompt + '“ · Seed ' + seed + ' · ' + seconds + ' s');
const t1 = Date.now();
let lastP = 0;
const out = await rt.generate({
  prompt, seconds, seed,
  onProgress: (p) => {
    if (p.stage === 'denoising' && p.completed > lastP) { lastP = p.completed; console.log('  denoise ' + p.completed + '/' + p.total + ' (' + ((Date.now() - t1) / 1000).toFixed(0) + ' s)'); }
  },
});
console.log('Generation fertig in ' + ((Date.now() - t1) / 1000).toFixed(0) + ' s · frameCount=' + out.frameCount);
if (out.sanity) console.log('Sanity: NaN-Frames ' + out.sanity.nanFrames + ' · reparierte Frames ' + out.sanity.fixedFrames + ' · maxBoneErr ' + (out.sanity.maxBoneErr * 100).toFixed(3) + ' %');
analyze(out, prompt + ' / seed ' + seed);
