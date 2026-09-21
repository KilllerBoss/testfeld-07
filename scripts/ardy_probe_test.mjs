// ═══════════════════════════════════════════════════════════
// ardy_probe_test.mjs — v2.28.6 INTEGRITÄTSPROBE-Tests
//
// Beweist:
//   1. Prüfsummen-Mathematik (tensorChecksums/checksumDeviation/probeDeviation)
//   2. Probe-Builder: deterministisch, richtige Feed-Namen/Formen je Graph
//   3. ECHTE Probe gegen die eingebrannte ARDY_PROBE_REFERENCE (CPU) —
//      Abweichung muss ~0 sein (gleiche Maschine, gleiche Dateien)
//   4. Decoder-Fingerprint: DECODER_FP32_BYTES === echte Dateigröße
//   5. deToEn: "steh still" sauber, Subjekt-Ergänzung, Bestand unverändert
//   6. Verdrahtung: loadArdyRuntime ruft verifySessionIntegrity,
//      main.js loggt Probe-Notizen, VERSION 2.28.6, versionCode 47
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = '/home/z/my-project/app/src/main/assets/www';
const ARDY_DIR = '/home/z/my-project/scripts/ardy';
let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ── ORT (node) laden BEVOR ardy.js genutzt wird (setOrtTensorClass) ──
// onnxruntime-node liegt unter scripts/ardy/node_modules — absolut importieren.
// onnxruntime-node robust laden (Environment-Resets verschieben node_modules):
// 1) scripts/ardy/node_modules (historisch) · 2) /home/z/node_modules · 3) bare
let ort = null;
for (const cand of [
  'file:///home/z/my-project/scripts/ardy/node_modules/onnxruntime-node/dist/index.js',
  'file:///home/z/node_modules/onnxruntime-node/dist/index.js',
  'onnxruntime-node',
]) {
  try { ort = (await import(cand)).default; break; } catch (e) { /* nächster Kandidat */ }
}
if (!ort) throw new Error('onnxruntime-node nicht gefunden (weder scripts/ardy/node_modules noch /home/z/node_modules)');
const ardy = await import(path.join(WWW, 'js/ardy.js'));
ardy.setOrtTensorClass(ort.Tensor);
const manifest = JSON.parse(readFileSync(path.join(ARDY_DIR, 'model.json'), 'utf8'));

console.log('■ 1) Prüfsummen-Mathematik');
await ok('tensorChecksums: korrekt über [1,-2,3]', () => {
  const c = ardy.tensorChecksums(new Float32Array([1, -2, 3]));
  assert.equal(c.s2, 6);
  assert.equal(c.absMax, 3);
  assert.equal(c.spread, 5);
});
await ok('tensorChecksums: NaN → null, Inf → null', () => {
  assert.equal(ardy.tensorChecksums(new Float32Array([1, NaN])), null);
  assert.equal(ardy.tensorChecksums(new Float32Array([Infinity])), null);
});
await ok('checksumDeviation: identisch 0, skaliert >Toleranz, null → ∞', () => {
  const a = { s2: 100, absMax: 10, spread: 20 };
  assert.equal(ardy.checksumDeviation(a, a), 0);
  assert.ok(ardy.checksumDeviation({ s2: 1000, absMax: 100, spread: 200 }, a) > 8);
  assert.equal(ardy.checksumDeviation(null, a), Infinity);
  assert.equal(ardy.checksumDeviation({ s2: NaN, absMax: 1, spread: 1 }, a), Infinity);
});
await ok('probeDeviation: Längen-Mismatch → ∞; max über Teile', () => {
  assert.equal(ardy.probeDeviation([{ s2: 1, absMax: 1, spread: 1 }], [{ s2: 1, absMax: 1, spread: 1 }, { s2: 1, absMax: 1, spread: 1 }]), Infinity);
  const big = { s2: 2, absMax: 1, spread: 1 };
  const one = { s2: 1, absMax: 1, spread: 1 };
  assert.equal(ardy.probeDeviation([one, one], [one, big]), 0.5); // |1-2|/2
});

console.log('■ 2) Probe-Builder (echtes Manifest)');
await ok('Builder-Determinismus: gleicher Seed → bitgleich', () => {
  const a = ardy.buildDecoderProbeInput(manifest);
  const b = ardy.buildDecoderProbeInput(manifest);
  assert.deepEqual(Array.from(a[Object.keys(a)[2]].data), Array.from(b[Object.keys(b)[2]].data));
  const da = ardy.buildDenoiserProbeInput(manifest);
  const db = ardy.buildDenoiserProbeInput(manifest);
  const kx = manifest.graphs.denoiser.inputs.x;
  assert.deepEqual(Array.from(da[kx].data), Array.from(db[kx].data));
});
await ok('Decoder-Feeds: 3 Einträge, korrekte Namen/Formen', () => {
  const f = ardy.buildDecoderProbeInput(manifest);
  const g = manifest.graphs.decoder.inputs;
  assert.deepEqual(Object.keys(f).sort(), [g.globalTranslation, g.hybridTokens, g.motionPadMask].sort());
  assert.deepEqual(f[g.hybridTokens].dims, [1, manifest.dimensions.max_tokens, manifest.dimensions.hybrid_dim]);
  assert.deepEqual(f[g.motionPadMask].dims, [1, manifest.dimensions.max_frames]);
  const pm = f[g.motionPadMask].data;
  let ones = 0; for (const v of pm) if (v === 1) ones++;
  assert.equal(ones, 40); // 10 gültige Tokens × 4 Frames
});
await ok('Denoiser-Feeds: 11 Einträge, history 0 / generation 40', () => {
  const f = ardy.buildDenoiserProbeInput(manifest);
  const g = manifest.graphs.denoiser.inputs;
  assert.equal(Object.keys(f).length, 11);
  assert.equal(f[g.historyLength].data[0], 0n);
  assert.equal(f[g.generationLength].data[0], 40n);
  assert.equal(f[g.timestep].data[0], BigInt(manifest.diffusion.timesteps[0]));
  const gm = f[g.generationMask].data;
  let ones = 0; for (const v of gm) if (v === 1) ones++;
  assert.equal(ones, 40);
});
await ok('Text-Encoder-Feeds: 3 int64-Einträge, Länge 6', () => {
  const f = ardy.buildTextEncoderProbeInput(manifest);
  const g = manifest.graphs.text_encoder.inputs;
  assert.equal(Object.keys(f).length, 3);
  for (const k of Object.keys(f)) assert.deepEqual(f[k].dims, [1, 6]);
  assert.equal(f[g.inputIds].data[0], 101n);
});

console.log('■ 3) ECHTE Probe gegen ARDY_PROBE_REFERENCE (CPU)');
{
  const sessions = {
    text_encoder: await ort.InferenceSession.create(path.join(ARDY_DIR, 'text_encoder.onnx')),
    denoiser: await ort.InferenceSession.create(path.join(ARDY_DIR, 'denoiser.onnx')),
    decoder: await ort.InferenceSession.create(path.join(ARDY_DIR, 'decoder.onnx')),
  };
  for (const graph of ['text_encoder', 'denoiser', 'decoder']) {
    await ok('Probe „' + graph + '" trifft Referenz (Abw. < 1e-6)', async () => {
      const parts = await ardy.probeSession(graph, sessions[graph], manifest);
      const dev = ardy.probeDeviation(parts, ardy.ARDY_PROBE_REFERENCE[graph]);
      assert.ok(Number.isFinite(dev) && dev < 1e-6, 'Abweichung ' + dev);
    });
  }
  await ok('verifySessionIntegrity: saubere Sessions → keine Notizen', async () => {
    const notes = await ardy.verifySessionIntegrity(
      { textEncoder: sessions.text_encoder, denoiser: sessions.denoiser, decoder: sessions.decoder },
      manifest,
      async () => { throw new Error('darf NICHT neu erstellt werden'); },
    );
    assert.equal(notes.length, 0);
  });
  await ok('verifySessionIntegrity: explodierter Decoder → WASM-Fallback + Notiz', async () => {
    const on = manifest.graphs.decoder.outputs;
    const J = manifest.dimensions.num_joints, F = manifest.dimensions.max_frames;
    const badSession = {
      run: async () => ({
        [on.posedJoints]: { data: new Float32Array(J * 3 * F).fill(999) },   // Explosion
        [on.rootPositions]: { data: new Float32Array(F * 3).fill(7) },
      }),
    };
    const notes = await ardy.verifySessionIntegrity(
      { textEncoder: sessions.text_encoder, denoiser: sessions.denoiser, decoder: badSession },
      manifest,
      async (graph) => { assert.equal(graph, 'decoder'); return sessions.decoder; }, // "WASM" liefert die saubere Session
      () => {},
    );
    assert.equal(notes.length, 1);
    assert.ok(notes[0].includes('decoder') && notes[0].includes('WASM'));
  });
}

console.log('■ 4) Decoder-Fingerprint');
await ok('DECODER_FP32_BYTES === echte decoder.onnx-Größe', () => {
  const real = readFileSync(path.join(ARDY_DIR, 'decoder.onnx')).length;
  assert.equal(ardy.DECODER_FP32_BYTES, real, 'Konstante ' + ardy.DECODER_FP32_BYTES + ' ≠ real ' + real);
});
await ok('Import-Guard verdrahtet (expectedBytes + Rejection + Getter)', () => {
  const src = readFileSync(path.join(WWW, 'js/ardy.js'), 'utf8');
  assert.ok(src.includes("expectedBytes: graph === 'decoder' ? DECODER_FP32_BYTES : undefined"), 'Decoder-Load mit expectedBytes');
  assert.ok(src.includes('_importRejection'), 'Rejection-Merkfeld');
  assert.ok(src.includes('export function ardyImportRejection()'), 'Getter exportiert');
});

console.log('■ 5) deToEn (v2.28.6)');
await ok('"steh still" → sauberes "a person stands still"', () => {
  assert.equal(ardy.deToEn('steh still'), 'a person stands still');
  assert.equal(ardy.deToEn('stehe still'), 'a person stands still');
  assert.equal(ardy.deToEn('steht still'), 'a person stands still');
  assert.ok(!ardy.deToEn('steh still').includes('steh '));
});
await ok('"idle" → "a person stands still" (Subjekt ergänzt)', () => {
  assert.equal(ardy.deToEn('idle'), 'a person stands still');
  assert.equal(ardy.deToEn('stands still'), 'a person stands still');
  assert.equal(ardy.deToEn('stand still'), 'a person stands still');
  assert.equal(ardy.deToEn('steht still'), 'a person stands still');
});
await ok('Bestand: mit Subjekt unverändert, Deutsch weiterhin gemappt', () => {
  assert.equal(ardy.deToEn('a person walks forward'), 'a person walks forward');
  assert.ok(ardy.deToEn('ein mann geht vorwärts').includes('walks'));
  assert.ok(ardy.deToEn('ein mann geht vorwärts').includes('person'));
  assert.equal(ardy.deToEn(''), '');
});

console.log('■ 6) Verdrahtung v2.28.6');
{
  const ardySrc = readFileSync(path.join(WWW, 'js/ardy.js'), 'utf8');
  const mainSrc = readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
  const gradle = readFileSync('/home/z/my-project/app/build.gradle', 'utf8');
  await ok('loadArdyRuntime ruft verifySessionIntegrity + bytesByGraph', () => {
    assert.ok(ardySrc.includes('await verifySessionIntegrity(sessions, manifest'), 'Probe im Load');
    assert.ok(ardySrc.includes('const bytesByGraph = {}'), 'bytesByGraph vorhanden');
    assert.ok(ardySrc.includes("_probeNotes = probeNotes;"), 'Probe-Notizen gemerkt');
  });
  await ok('main.js: ardyProbeNotes importiert + geloggt', () => {
    assert.ok(mainSrc.includes('ardyProbeNotes'), 'Import/Verwendung');
    assert.ok(mainSrc.includes('Integritätsprobe bestanden'), 'Erfolgs-Log');
    assert.ok(mainSrc.includes("const VERSION = '2.28.6';") || mainSrc.includes("const VERSION = '2.28.7';") || mainSrc.includes("const VERSION = '2.28.8';") || mainSrc.includes("const VERSION = '2.28.9';") || mainSrc.includes("const VERSION = '2.28.10';") || mainSrc.includes("const VERSION = '2.28.11';"), 'VERSION 2.28.6-2.28.11');
  });
  await ok('gradle: versionCode 47 / versionName 2.28.6', () => {
    assert.ok((gradle.includes('versionCode 47') && gradle.includes('versionName "2.28.6"')) || (gradle.includes('versionCode 48') && gradle.includes('versionName "2.28.7"')) || (gradle.includes('versionCode 49') && gradle.includes('versionName "2.28.8"')) || (gradle.includes('versionCode 50') && gradle.includes('versionName "2.28.9"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName "2.28.10"')) || (gradle.includes('versionCode 52') && gradle.includes('versionName "2.28.11"')));
  });
  await ok('Referenz-Struktur: 3 Graphen, Decoder 2 Teile, endlich', () => {
    const r = ardy.ARDY_PROBE_REFERENCE;
    assert.deepEqual(Object.keys(r).sort(), ['decoder', 'denoiser', 'text_encoder']);
    assert.equal(r.decoder.length, 2);
    for (const g of Object.keys(r)) for (const p of r[g]) {
      for (const k of ['s2', 'absMax', 'spread']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, g + '.' + k);
    }
  });
}

console.log('\n═══ ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen ═══');
process.exit(fail ? 1 : 0);
