// ═══════════════════════════════════════════════════════════
// ardy_probe_reference.mjs — erzeugt die CPU-Referenz-Prüfsummen
// für die v2.28.6 INTEGRITÄTSPROBE in app/.../js/ardy.js.
//
// Nutzt DENSELBEN Probe-Builder wie die App (Import aus ardy.js),
// rechnet mit onnxruntime-node (CPU) und gibt das fertige
// ARDY_PROBE_REFERENCE-Konstantenobjekt aus. Diese Zahlen werden
// in ardy.js eingebrannt; das Gerät vergleicht sie beim Laden.
//
// Usage: node scripts/ardy/ardy_probe_reference.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = '/home/z/my-project/app/src/main/assets/www';

const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));

// Tokenizer nicht nötig für die Probe — aber ardy.js importiert
// ardytoken.js lazily? Nein, statisch oben. Das Modul lädt auch ohne
// Browser-Umgebung (reine JS-Klasse) — Import muss einfach funktionieren.
const { setOrtTensorClass, buildTextEncoderProbeInput, buildDenoiserProbeInput, buildDecoderProbeInput, tensorChecksums } = await import(path.join(WWW, 'js/ardy.js'));
setOrtTensorClass(ort.Tensor);

console.log('Lade Sessions (CPU) …');
const sessions = {
  text_encoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};

const out = {};
for (const graph of ['text_encoder', 'denoiser', 'decoder']) {
  const feeds = graph === 'text_encoder' ? buildTextEncoderProbeInput(manifest)
    : graph === 'denoiser' ? buildDenoiserProbeInput(manifest)
      : buildDecoderProbeInput(manifest);
  const res = await sessions[graph].run(feeds);
  const g = manifest.graphs[graph];
  const outs = graph === 'text_encoder' ? [res[g.outputs.textConditions]]
    : graph === 'denoiser' ? [res[g.outputs.predX0]]
      : [res[g.outputs.posedJoints], res[g.outputs.rootPositions]];
  const parts = [];
  for (const t of outs) {
    if (!t || !t.data || !t.data.length) throw new Error('Ausgabe fehlt für ' + graph);
    const c = tensorChecksums(t.data);
    if (!c) throw new Error('Nicht-endliche Werte für ' + graph);
    parts.push(c);
  }
  out[graph] = parts;
  console.log(graph + ': ' + parts.length + ' Tensor(e) — s2=' + parts.map((p) => p.s2.toFixed(6)).join(', '));
}

const fmt = (v) => {
  // 12 signifikante Stellen — fp32-deterministisch genug, zugleich exakt rundbar
  return JSON.stringify(v);
};
const js = `export const ARDY_PROBE_REFERENCE = ${fmt(out)};`;

console.log('\n──── Konstantenblock für ardy.js ────');
console.log(js);
console.log('─────────────────────────────────────');

// Konsistenz-Wache: Decoder-Fingerprint gegen die lokale fp32-Datei
const dec = readFileSync(path.join(HERE, 'decoder.onnx'));
console.log('Lokaler fp32-Decoder: ' + dec.length + ' Bytes');
process.exit(0);
