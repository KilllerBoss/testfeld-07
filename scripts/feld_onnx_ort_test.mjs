// ═══════════════════════════════════════════════════════════
// feld_onnx_ort_test.mjs — ECHTE ORT-Parität des Feld-Exports
//
// onnxruntime-node lädt die selbstgebauten ONNX-Bytes (fp32, fp16,
// int8) und führt sie aus; wir vergleichen mu gegen den JS-Forward
// der SoftMoEPolicy. Beweis: der Export ist ein ECHTES, lauffähiges
// ONNX-Modell — gleiche Bytes, die auch ort-web im WebView nutzt.
// ═══════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ort = require('../scripts/ardy/node_modules/onnxruntime-node');
import { SoftMoEPolicy } from '../app/src/main/assets/www/js/train.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';
import { moeToOnnx } from '../app/src/main/assets/www/js/feld/onnxexport.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

const net = new SoftMoEPolicy(74, 14, new RNG(42), { E: 4 });
// deterministische, plausible Gewichte (nicht nur Zufall: verschiedene Größenordnungen)
for (const n of net.pNames) {
  const P = net[n];
  for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.7 + P.length * 1e-4) * (P.length % 3) * 0.05;
}

const D = net.obsDim;
const raw = new Float32Array(D);
for (let i = 0; i < D; i++) raw[i] = (Math.sin(i * 1.3) * 0.5) + (i % 5 === 0 ? 0.1 : 0);
raw[D - 13] = 0.12;      // vx
raw[D - 13 + 3] = 1;     // skill balance
raw[D - 13 + 7] = 1;     // style neutral

const muRef = net.forward(raw, raw).slice();

async function checkFormat(fmt, tol) {
  const { bytes, ops } = moeToOnnx(net, { format: fmt, valueHead: false });
  const session = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: 'all' });
  const t = new ort.Tensor('float32', Float32Array.from(raw), [1, D]);
  const out = await session.run({ obs: t });
  const mu = Array.from(out.mu.data);
  let mx = 0, sum = 0;
  for (let i = 0; i < mu.length; i++) {
    const d = Math.abs(mu[i] - muRef[i]);
    if (d > mx) mx = d;
    sum += d;
  }
  const mean = sum / mu.length;
  ok(mx < tol, fmt.toUpperCase() + '-Parität: max|Δ| = ' + mx.toExponential(3) + ' < ' + tol + ' (' + ops + ' Knoten)');
  return { mx, mean };
}

console.log('── ONNX-RUNTIME-PARITÄT (onnxruntime-node, echte Ausführung) ──');
const r32 = await checkFormat('fp32', 1e-5);
const r16 = await checkFormat('fp16', 3e-2);
const r8 = await checkFormat('int8', 3e-1);

// int8 muss besser als reines Zufallsrauschen sein (Korrelation mit muRef)
ok(Math.abs(r8.mx) < 0.25, 'int8 max|Δ| im quantisierten Band');

// fp32 besser als fp16 besser als int8 (Ordnung der Präzision)
ok(r32.mx <= r16.mx + 1e-9, 'Präzisionsordnung: fp32 ≤ fp16');
ok(r16.mx <= r8.mx + 1e-9, 'Präzisionsordnung: fp16 ≤ int8');

console.log('\nERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) process.exit(1);
