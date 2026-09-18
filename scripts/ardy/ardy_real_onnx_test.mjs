// ═══════════════════════════════════════════════════════════
// ardy_real_onnx_test.mjs — Validierung gegen die ECHTEN
// ONNX-Graphen (fp32, vom HF-Repo): Text-Encoder-Inferez mit
// unserem WordPiece-Tokenizer + Decoder-Inferez mit synthetischen
// Hybrid-Tokens (Kontrakt: float-Masken, globalTranslation [1,3],
// Output-Layout posedJoints [80,27,3] usw.).
// ═══════════════════════════════════════════════════════════
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import ort from 'onnxruntime-node';
import { BertWordPiece } from '/home/z/my-project/app/src/main/assets/www/js/ardytoken.js';
import { PortableRandom, buildWindow, recenterWindow, padMask, ddimStep, ddimUpdate } from '/home/z/my-project/app/src/main/assets/www/js/ardy.js';

const manifest = JSON.parse(gunzipSync(readFileSync('/home/z/my-project/scripts/ardy/model.json.gz')));
const dims = manifest.dimensions;

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e && e.message)); }
}

console.log('■ Echte ONNX-Sessions (fp32)');
const tokJson = JSON.parse(gunzipSync(readFileSync('/home/z/my-project/scripts/ardy/tokenizer.json.gz')));
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);

const te = await ort.InferenceSession.create('/home/z/my-project/scripts/ardy/text_encoder.onnx');
console.log('  text_encoder geladen — inputs:', JSON.stringify(te.inputNames));
const dec = await ort.InferenceSession.create('/home/z/my-project/scripts/ardy/decoder.onnx');
console.log('  decoder geladen — inputs:', JSON.stringify(dec.inputNames));

await ok('Text-Encoder: Prompt → textConditions [1,1,2048] (echte Inferenz)', async () => {
  const enc = tokenizer.encode('a person walks forward at a steady pace');
  console.log('  Tokenizer: ' + enc.sequenceLength + ' Tokens, ids[0..3] = ' + Array.from(enc.inputIds.slice(0, 4)));
  assert.equal(Number(enc.inputIds[0]), 101); // [CLS]
  const out = await te.run({
    input_ids: new ort.Tensor('int64', enc.inputIds, [1, enc.sequenceLength]),
    attention_mask: new ort.Tensor('int64', enc.attentionMask, [1, enc.sequenceLength]),
    token_type_ids: new ort.Tensor('int64', enc.tokenTypeIds, [1, enc.sequenceLength]),
  });
  const outName = te.outputNames[0];
  const t = out[outName];
  assert.equal(t.dims.join(','), '1,1,2048', 'dims=' + t.dims.join(','));
  const data = t.data;
  let mean = 0, mx = -1e9, mn = 1e9;
  for (let i = 0; i < data.length; i++) { mean += data[i]; mx = Math.max(mx, data[i]); mn = Math.min(mn, data[i]); }
  mean /= data.length;
  console.log('  textConditions: mean=' + mean.toFixed(4) + ' min=' + mn.toFixed(4) + ' max=' + mx.toFixed(4));
  assert.ok(Number.isFinite(mean), 'endliche Werte');
  assert.ok(mx > 1e-3 || mn < -1e-3, 'nicht alles ~0');
});

await ok('Text-Encoder: verschiedener Prompt ⇒ andere Einbettung, gleicher Prompt ⇒ gleiche', async () => {
  const run1 = await te.run({
    input_ids: new ort.Tensor('int64', tokenizer.encode('a person dances').inputIds, [1, tokenizer.encode('a person dances').sequenceLength]),
    attention_mask: null, token_type_ids: null,
  }).catch(() => null);
  // (nur Schema-Check oben; Determinismus hier sauber:)
  const enc1 = tokenizer.encode('a person dances');
  const enc2 = tokenizer.encode('a person dances');
  const enc3 = tokenizer.encode('a person jumps');
  const feed = (e) => ({
    input_ids: new ort.Tensor('int64', e.inputIds, [1, e.sequenceLength]),
    attention_mask: new ort.Tensor('int64', e.attentionMask, [1, e.sequenceLength]),
    token_type_ids: new ort.Tensor('int64', e.tokenTypeIds, [1, e.sequenceLength]),
  });
  const o1 = await te.run(feed(enc1));
  const o2 = await te.run(feed(enc2));
  const o3 = await te.run(feed(enc3));
  const d1 = o1[te.outputNames[0]].data, d2 = o2[te.outputNames[0]].data, d3 = o3[te.outputNames[0]].data;
  for (let i = 0; i < 128; i++) assert.equal(d1[i], d2[i], 'Determinismus');
  let differs = false;
  for (let i = 0; i < 128; i++) if (d1[i] !== d3[i]) { differs = true; break; }
  assert.ok(differs, 'verschiedener Prompt ⇒ andere Einbettung');
});

await ok('Decoder: Kontrakt + Output-Layout (echte Inferenz, synthetische Tokens)', async () => {
  const g = manifest.graphs.decoder.inputs;
  const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  const rng = new PortableRandom(11);
  // Plausible Tokens: Root ~ stehend (Mittelwerte), Latents ~ Quant-Gitter-Mitte
  const rec = manifest.recenter, q = manifest.latent_quantization;
  const NFPT = dims.num_frames_per_token;
  for (let tokI = 0; tokI < dims.max_tokens; tokI++) {
    const base = tokI * dims.hybrid_dim;
    for (let f = 0; f < NFPT; f++) {
      const fb = base + f * dims.root_features_per_frame;
      h[fb + 0] = (0 - rec.root_mean[0]) / rec.root_std[0];
      h[fb + 1] = (0.9 - rec.root_mean[1]) / rec.root_std[1];
      h[fb + 2] = (0 - rec.root_mean[2]) / rec.root_std[2];
      h[fb + 3] = (1 - rec.root_mean[3]) / rec.root_std[3];
      h[fb + 4] = (0 - rec.root_mean[4]) / rec.root_std[4];
    }
    for (let r = 0; r < dims.latent_dim; r++) h[base + dims.nframe_root_dim + r] = Math.fround(rng.nextNormal() * 0.01);
  }
  const gt = new Float32Array([0, 0, 0]);
  const feeds = {
    [g.hybridTokens]: new ort.Tensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
    [g.motionPadMask]: new ort.Tensor('float32', padMask(dims, 10), [1, dims.max_frames]),
    [g.globalTranslation]: new ort.Tensor('float32', gt, [1, 3]),
  };
  const out = await dec.run(feeds);
  const o = manifest.graphs.decoder.outputs;
  const posed = out[o.posedJoints];
  assert.equal(posed.dims.join(','), [1, dims.max_frames, dims.num_joints, 3].join(','), 'posedJoints dims=' + posed.dims.join(','));
  const roots = out[o.rootPositions];
  assert.equal(roots.dims.join(','), [1, dims.max_frames, 3].join(','), 'rootPositions dims=' + roots.dims.join(','));
  const grots = out[o.globalRotations];
  assert.equal(grots.dims.join(','), [1, dims.max_frames, dims.num_joints, 3, 3].join(','), 'globalRotations dims=' + grots.dims.join(','));
  const foot = out[o.footContacts];
  assert.equal(foot.dims.join(','), [1, dims.max_frames, 4].join(','), 'footContacts dims=' + foot.dims.join(','));
  // Plausibilität: Gelenkpositionen um die globalTranslation, endliche Werte,
  // Hüfte (Joint 0) nahe (0, ~0.9, 0) — die stehende Referenzpose
  const J = posed.data;
  let finite = true;
  for (let i = 0; i < J.length; i++) if (!Number.isFinite(J[i])) { finite = false; break; }
  assert.ok(finite, 'posedJoints endlich');
  const hip = [J[0], J[1], J[2]];
  console.log('  Hüfte @Frame0 = [' + hip.map(v => v.toFixed(3)).join(', ') + ']');
  assert.ok(Math.abs(hip[0]) < 0.5 && Math.abs(hip[1] - 0.9) < 0.5 && Math.abs(hip[2]) < 0.5, 'Hüfte plausibel');
  // Rotationen: Zeilen der Matrizen ≈ Einheitslänge
  const R = grots.data;
  let rotOk = true;
  for (let j = 0; j < dims.num_joints; j++) {
    const o9 = j * 9;
    const l0 = Math.hypot(R[o9], R[o9 + 1], R[o9 + 2]);
    if (Math.abs(l0 - 1) > 0.05) { rotOk = false; break; }
  }
  assert.ok(rotOk, 'Rotations-Matrizen orthonormal (Zeile 0 |v|≈1)');
  const footD = foot.data;
  let fsum = 0;
  for (let i = 0; i < 40; i++) fsum += Number(footD[i]) || 0;
  console.log('  footContacts[0..39] Summe =', fsum, '(0 = in der Luft, 4 = beide Füße…)');
  assert.ok(fsum >= 0, 'footContacts numerisch');
});

console.log('');
console.log('Ergebnis: ' + passed + ' OK, ' + failed + ' FEHLER');
process.exit(failed ? 1 : 0);
