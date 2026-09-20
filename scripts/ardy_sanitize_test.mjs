// ═══════════════════════════════════════════════════════════
// ardy_sanitize_test.mjs — v2.28.2 Explosions-Fix:
//   • modelFilePrecision: Decoder IMMER fp32 (WebGPU-f16-Defekt)
//   • sanitizeArdyOutput: NaN-Frames halten, Knochenlängen
//     reparieren, Metriken korrekt, Sauberes unangetastet
//   • generate()-Integration (gemockte Sessions, echtes Manifest)
//   • Denoiser-NaN-Wache (klare deutsche Meldung)
// Usage: node scripts/ardy_sanitize_test.mjs
// ═══════════════════════════════════════════════════════════
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ArdyRuntime, setOrtTensorClass, sanitizeArdyOutput, modelFilePrecision, PortableRandom,
} from '/home/z/my-project/app/src/main/assets/www/js/ardy.js';
import { BertWordPiece } from '/home/z/my-project/app/src/main/assets/www/js/ardytoken.js';

const manifest = JSON.parse(readFileSync('/home/z/my-project/scripts/ardy/model.json', 'utf8'));
const dims = manifest.dimensions;
const J = dims.num_joints;
const parents = manifest.skeleton.parents;

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e && e.message)); }
}

// ORT-Signatur: new Tensor(type, data, dims) — sonst landet 'float32'
// als "data" und die Feeds sind Müll (lief still NaN durch alte Tests).
class FakeTensor {
  constructor(type, data, dimsArr) { this.type = type; this.data = data; this.dims = dimsArr; }
}

// Hilfsbau: sauberes „Skeleton“-Out (alle Knochen exakt 0,3 m, Hüfte 0,9)
function mkOut(n) {
  const joints = new Float32Array(n * J * 3);
  const rots = new Float32Array(n * J * 9);
  const roots = new Float32Array(n * 3);
  const feet = new Float32Array(n * 4);
  for (let f = 0; f < n; f++) {
    const b = f * J * 3;
    joints[b] = f * 0.1; joints[b + 1] = 0.9; joints[b + 2] = 0;
    for (let j = 1; j < J; j++) {
      const p = parents[j];
      joints[b + j * 3] = joints[b + p * 3] + 0.3;
      joints[b + j * 3 + 1] = joints[b + p * 3 + 1];
      joints[b + j * 3 + 2] = joints[b + p * 3 + 2];
    }
    const rm = f * J * 9;
    for (let j = 0; j < J; j++) { rots[rm + j * 9] = 1; rots[rm + j * 9 + 4] = 1; rots[rm + j * 9 + 8] = 1; }
    roots[f * 3] = f * 0.1; roots[f * 3 + 1] = 0.9;
  }
  return {
    frameCount: n, joints, globalRotations: rots, localRotations: rots.slice(),
    rootPositions: roots, footContacts: feet,
    jointNames: manifest.skeleton.joint_names.slice(), parents: parents.slice(),
  };
}

// Max. relativen Knochenlängenfehler eines Out neu messen
function boneErr(out) {
  let mx = 0;
  const n = out.frameCount;
  for (let f = 0; f < n; f++) {
    const b = f * J * 3;
    for (let j = 1; j < J; j++) {
      const p = parents[j];
      const L = Math.hypot(
        out.joints[b + j * 3] - out.joints[b + p * 3],
        out.joints[b + j * 3 + 1] - out.joints[b + p * 3 + 1],
        out.joints[b + j * 3 + 2] - out.joints[b + p * 3 + 2]);
      // Referenz = 0,3 (Konstruktion)
      mx = Math.max(mx, Math.abs(L - 0.3) / 0.3);
    }
  }
  return mx;
}

console.log('■ modelFilePrecision (v2.28.2 Decoder-fp32-Vertrag)');
await ok('Decoder IMMER aus fp32 — egal welche Präzision gewählt', () => {
  assert.equal(modelFilePrecision('decoder', 'fp16'), 'fp32');
  assert.equal(modelFilePrecision('decoder', 'fp32'), 'fp32');
});
await ok('Text-Encoder/Denoiser folgen der gewählten Präzision (byteidentisch fp32-Inhalt)', () => {
  assert.equal(modelFilePrecision('text_encoder', 'fp16'), 'fp16');
  assert.equal(modelFilePrecision('denoiser', 'fp16'), 'fp16');
  assert.equal(modelFilePrecision('text_encoder', 'fp32'), 'fp32');
});

console.log('■ sanitizeArdyOutput');
await ok('Saubere Ausgabe bleibt UNANGETASTET (keine Reparatur, Metriken 0)', () => {
  const out = mkOut(40);
  const before = Float32Array.from(out.joints);
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.nanFrames, 0);
  assert.equal(s.fixedFrames, 0);
  assert.equal(s.checkedFrames, 40);
  assert.ok(s.maxBoneErr < 1e-5, 'maxBoneErr=' + s.maxBoneErr); // nur f32-Messrauschen, kein Rewrite
  for (let i = 0; i < before.length; i++) assert.equal(out.joints[i], before[i], 'joint ' + i + ' verändert');
});
await ok('Explodierte Frames (5× Knochen) werden auf Referenzlänge repariert', () => {
  const out = mkOut(40);
  for (let f = 30; f < 36; f++) {
    const b = f * J * 3;
    for (let j = 1; j < J; j++) {
      const p = parents[j];
      out.joints[b + j * 3] = out.joints[b + p * 3] + 1.5; // 5× Streckung
    }
  }
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.fixedFrames, 6, 'fixedFrames=' + s.fixedFrames);
  assert.ok(s.maxBoneErr >= 4, 'pre-Reparatur-Fehler sichtbar: ' + s.maxBoneErr);
  assert.ok(boneErr(out) < 0.01, 'nach Reparatur: ' + boneErr(out));
  // Style bleibt: Frame 29 unangetastet (Position = Root + 0,3, Epsilon wegen Float32)
  assert.ok(Math.abs(out.joints[29 * J * 3 + 3] - (29 * 0.1 + 0.3)) < 1e-5, 'Frame 29 verändert: ' + out.joints[29 * J * 3 + 3]);
});
await ok('Ketten-Reparatur: Eltern zuerst — beide Knochen exakt Referenzlänge', () => {
  const out = mkOut(40);
  const b = 20 * J * 3;
  // Spine (1←0) UND Spine1 (2←1) beide überdehnt
  out.joints[b + 1 * 3] = out.joints[b + 0 * 3] + 0.9;   // 3×
  out.joints[b + 2 * 3] = out.joints[b + 1 * 3] + 0.9;   // 3× relativ zum gedehnten Elternteil
  sanitizeArdyOutput(out);
  const L1 = Math.hypot(out.joints[b + 3] - out.joints[b], out.joints[b + 4] - out.joints[b + 1], out.joints[b + 5] - out.joints[b + 2]);
  const L2 = Math.hypot(out.joints[b + 6] - out.joints[b + 3], out.joints[b + 7] - out.joints[b + 4], out.joints[b + 8] - out.joints[b + 5]);
  assert.ok(Math.abs(L1 - 0.3) < 1e-6, 'Spine: ' + L1);
  assert.ok(Math.abs(L2 - 0.3) < 1e-6, 'Spine1: ' + L2);
});
await ok('NaN-Frames werden auf den letzten guten Frame GEHALTEN (alle Arrays)', () => {
  const out = mkOut(40);
  const snap11 = {
    j: Float32Array.from(out.joints.subarray(11 * J * 3, 12 * J * 3)),
    g: Float32Array.from(out.globalRotations.subarray(11 * J * 9, 12 * J * 9)),
    l: Float32Array.from(out.localRotations.subarray(11 * J * 9, 12 * J * 9)),
    r: Float32Array.from(out.rootPositions.subarray(11 * 3, 12 * 3)),
  };
  for (const a of [out.joints, out.globalRotations, out.rootPositions]) {
    for (const f of [12, 13]) a.fill(NaN, f * (a === out.joints ? J * 3 : a === out.globalRotations ? J * 9 : 3), (f + 1) * (a === out.joints ? J * 3 : a === out.globalRotations ? J * 9 : 3));
  }
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.nanFrames, 2, 'nanFrames=' + s.nanFrames);
  const cmp = (ta, tb) => { for (let i = 0; i < ta.length; i++) assert.equal(ta[i], tb[i]); };
  cmp(out.joints.subarray(12 * J * 3, 13 * J * 3), snap11.j);
  cmp(out.globalRotations.subarray(12 * J * 9, 13 * J * 9), snap11.g);
  cmp(out.localRotations.subarray(12 * J * 9, 13 * J * 9), snap11.l);
  cmp(out.rootPositions.subarray(12 * 3, 13 * 3), snap11.r);
  cmp(out.joints.subarray(13 * J * 3, 14 * J * 3), snap11.j);
  assert.ok(boneErr(out) < 0.01, 'nach Halt: ' + boneErr(out));
});
await ok('NaN im Frame 0 (kein guter Vorgänger) → Identitäts-Rotationen, kein Crash', () => {
  const out = mkOut(40);
  out.joints.fill(NaN, 0, J * 3);
  out.globalRotations.fill(NaN, 0, J * 9);
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.nanFrames, 1);
  assert.equal(out.joints[0], 0);
  assert.equal(out.globalRotations[0], 1);
  assert.equal(out.globalRotations[4], 1);
  assert.equal(out.globalRotations[8], 1);
  assert.equal(out.globalRotations[1], 0);
});
await ok('footContacts-NaN wird gehalten', () => {
  const out = mkOut(40);
  out.footContacts.fill(NaN, 11 * 4, 12 * 4);
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.nanFrames, 1);
  assert.equal(out.footContacts[11 * 4], out.footContacts[10 * 4]);
});
await ok('frameCount=0 und leere Eingaben werfen nicht', () => {
  const out = mkOut(0);
  out.frameCount = 0;
  const s = sanitizeArdyOutput(out).sanity;
  assert.equal(s.checkedFrames, 0);
  assert.equal(s.nanFrames, 0);
});

console.log('■ generate()-Integration (gemockte Sessions, echtes Manifest)');
setOrtTensorClass(FakeTensor);
function fakeSessions(opts = {}) {
  return {
    textEncoder: { async run() { return { text_conditions: new FakeTensor('float32', new Float32Array(dims.text_condition_dim).fill(0.05), [1, 1, dims.text_condition_dim]) }; } },
    denoiser: {
      async run(feeds) {
        const xin = feeds.x.data;
        const pred = new Float32Array(xin.length);
        // STABILES predX0 (Konstante) — ein x-abhängiges pred explodiert
        // unter DDIM-eps-Rückführung und würde die NaN-Wache zu Recht
        // auslösen (das ist kein Fake-Problem, sondern Physik des Tests).
        for (let i = 0; i < xin.length; i++) pred[i] = 0.1 + 1e-4 * (i % 7);
        if (opts.nanInDenoiser) pred[dims.hybrid_dim] = NaN; // Generation-Region!
        return { pred_x0: new FakeTensor('float32', pred, [1, dims.max_tokens, dims.hybrid_dim]) };
      },
    },
    decoder: {
      async run(feeds) {
        const gt = feeds.global_translation.data;
        const L = dims.max_frames;
        const joints = new Float32Array(L * J * 3);
        const rots = new Float32Array(L * J * 9);
        const roots = new Float32Array(L * 3);
        for (let f = 0; f < L; f++) {
          const b = f * J * 3;
          joints[b] = gt[0]; joints[b + 1] = gt[1] + 0.9; joints[b + 2] = gt[2];
          for (let j = 1; j < J; j++) {
            const p = parents[j];
            const s = (opts.explode && f >= 30 && f < 36) ? 5 : 1; // Explosion nur wenn(opts.explode)
            joints[b + j * 3] = joints[b + p * 3] + 0.3 * s;
            joints[b + j * 3 + 1] = joints[b + p * 3 + 1];
            joints[b + j * 3 + 2] = joints[b + p * 3 + 2];
          }
          const rm = f * J * 9;
          for (let j = 0; j < J; j++) { rots[rm + j * 9] = 1; rots[rm + j * 9 + 4] = 1; rots[rm + j * 9 + 8] = 1; }
          roots[f * 3] = gt[0]; roots[f * 3 + 1] = gt[1] + 0.9; roots[f * 3 + 2] = gt[2];
        }
        if (opts.nanInDecoder) for (let i = 37 * J * 3; i < 38 * J * 3; i++) joints[i] = NaN;
        return {
          normalized_motion: new FakeTensor('float32', new Float32Array(L * dims.motion_dim), [1, L, dims.motion_dim]),
          posed_joints: new FakeTensor('float32', joints, [1, L, J, 3]),
          local_rotations: new FakeTensor('float32', rots, [1, L, J, 3, 3]),
          global_rotations: new FakeTensor('float32', rots, [1, L, J, 3, 3]),
          root_positions: new FakeTensor('float32', roots, [1, L, 3]),
          foot_contacts: new FakeTensor('float32', new Float32Array(L * 4), [1, L, 4]),
          global_root_heading: new FakeTensor('float32', new Float32Array(L * 2), [1, L, 2]),
        };
      },
    },
  };
}
await ok('generate() sanitiziert automatisch: Explosion + NaN erkannt und repariert', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100]])), fakeSessions({ nanInDecoder: true, explode: true }), 'wasm');
  const out = await rt.generate({ prompt: 'a person walks', seconds: 2, seed: 42 });
  assert.equal(out.frameCount, 40);
  assert.ok(out.sanity, 'out.sanity fehlt');
  assert.equal(out.sanity.checkedFrames, 40);
  assert.equal(out.sanity.nanFrames, 1, 'nanFrames=' + out.sanity.nanFrames);
  assert.equal(out.sanity.fixedFrames, 6, 'fixedFrames=' + out.sanity.fixedFrames);
  // Frame 37 wurde von Frame 36 gehalten → Knochen ok
  const b = 37 * J * 3;
  const L = Math.hypot(out.joints[b + 3] - out.joints[b], out.joints[b + 4] - out.joints[b + 1], out.joints[b + 5] - out.joints[b + 2]);
  assert.ok(Math.abs(L - 0.3) < 1e-6, 'gehaltener Frame Knochen: ' + L);
});
await ok('Denoiser-NaN-Wache: klare deutsche Meldung statt vergifteter Generierung', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100]])), fakeSessions({ nanInDenoiser: true }), 'wasm');
  await assert.rejects(
    () => rt.generate({ prompt: 'a person walks', seconds: 2, seed: 42 }),
    (e) => /ungültige Werte/.test(e.message),
  );
});
await ok('Saubere Session ⇒ sanity ohne Reparatur (keine False Positives)', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100]])), fakeSessions({}), 'wasm');
  const out = await rt.generate({ prompt: 'a person walks', seconds: 2, seed: 42 });
  assert.equal(out.sanity.nanFrames, 0);
  assert.equal(out.sanity.fixedFrames, 0);
  assert.ok(out.sanity.maxBoneErr < 1e-9);
});

console.log('\n════════════════════════════════════════');
console.log('ERGEBNIS: ' + passed + ' bestanden, ' + failed + ' fehlgeschlagen');
process.exit(failed ? 1 : 0);
