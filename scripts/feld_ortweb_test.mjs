// ═══════════════════════════════════════════════════════════
// feld_ortweb_test.mjs — Parität mit ORT-WEB 1.27.0 (App-Version!)
// Lädt das echte ort-web vom CDN (lokal gespiegelt) in Node und
// prüft: Export-Bytes (fp32/fp16/int8) laden + mu-Parität.
// ═══════════════════════════════════════════════════════════

import { SoftMoEPolicy } from '../app/src/main/assets/www/js/train.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';
import { moeToOnnx } from '../app/src/main/assets/www/js/feld/onnxexport.js';

const ort = await import('/tmp/ortweb/ort.all.min.mjs');
ort.env.wasm.wasmPaths = { mjs: '/tmp/ortweb/ort-wasm-simd-threaded.jsep.mjs', wasm: '/tmp/ortweb/ort-wasm-simd-threaded.jsep.wasm' };
ort.env.wasm.numThreads = 1;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

const net = new SoftMoEPolicy(74, 14, new RNG(42), { E: 4 });
for (const n of net.pNames) {
  const P = net[n];
  for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.7 + P.length * 1e-4) * (P.length % 3) * 0.05;
}
const D = net.obsDim;
const raw = new Float32Array(D);
for (let i = 0; i < D; i++) raw[i] = Math.sin(i * 1.3) * 0.5 + (i % 5 === 0 ? 0.1 : 0);
raw[D - 13] = 0.12; raw[D - 13 + 3] = 1; raw[D - 13 + 7] = 1;
const muRef = net.forward(raw, raw).slice();

console.log('── ORT-WEB 1.27.0 (App-Version) PARITÄT ──');
for (const [fmt, tol] of [['fp32', 1e-5], ['fp16', 3e-2], ['int8', 3e-1]]) {
  const { bytes, ops } = moeToOnnx(net, { format: fmt });
  const session = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: 'all' });
  const t = new ort.Tensor('float32', Float32Array.from(raw), [1, D]);
  const out = await session.run({ obs: t });
  const mu = Array.from(out.mu.data);
  let mx = 0;
  for (let i = 0; i < mu.length; i++) mx = Math.max(mx, Math.abs(mu[i] - muRef[i]));
  ok(mx < tol, fmt.toUpperCase() + ': max|Δ| = ' + mx.toExponential(3) + ' < ' + tol + ' (' + ops + ' Knoten)');
}
console.log('\nERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) process.exit(1);
