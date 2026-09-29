// ═══════════════════════════════════════════════════════════
// gen_pollen_fixture.mjs — baut feld_export_{fp32,fp16,int8}.onnx neu
// (v3.6.0: ABS-Modus, obs [1,61] wie velstand.onnx, Skalierung eingebacken)
// für scripts/pollen_profile_check.py (Feld-für-Feld-Vergleich).
// Aufruf: node scripts/gen_pollen_fixture.mjs
// ═══════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SoftMoEPolicy } from '../app/src/main/assets/www/js/train.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';
import { moeToOnnx } from '../app/src/main/assets/www/js/feld/onnxexport.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'pollen_ref');

// ABS-Netz exakt wie in der App: obs 61, command an 48, 4 Experten
const net = new SoftMoEPolicy(61, 14, new RNG(7), { E: 4, cmdOff: 48 });
if (!net.absCmd || net.cmdOff !== 48) throw new Error('ABS-Modus nicht aktiv!?');
for (const n of net.pNames) {
  const P = net[n];
  for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.7 + P.length * 1e-4) * (P.length % 3) * 0.05;
}
const D = 61;
const mean = Array.from({ length: D }, (_, i) => Math.sin(i * 0.31) * 0.05);
const std = Array.from({ length: D }, (_, i) => 1 + Math.abs(Math.cos(i * 0.53)) * 0.5);

for (const fmt of ['fp32', 'fp16', 'int8']) {
  const { bytes, ops } = moeToOnnx(net, {
    format: fmt,
    norm: { mean, std },
    actSpan: 0.35, jointResidual: 1.0, // Einbackung wie in der App (MicroDuck)
    meta: {}, // default_joint_pos → POLL_DEFAULT_POS (== Original-%.3f)
  });
  const p = join(OUT, 'feld_export_' + fmt + '.onnx');
  writeFileSync(p, bytes);
  console.log(fmt.padEnd(4), bytes.length, 'bytes ·', ops, 'Knoten →', p);
}
console.log('Fixtures neu gebaut (obs [1,61], actions [1,14], opset 18).');
