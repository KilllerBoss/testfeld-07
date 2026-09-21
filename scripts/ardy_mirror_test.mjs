// ═══════════════════════════════════════════════════════════
// ardy_mirror_test.mjs — v2.28.4 ARDY X-SPIEGELUNG:
//   ▸ mirrorArdyOutputX (reine Mathematik, immer gelaufen):
//       Positionen x→−x · Rotationen M·R·M (Elemente 1,2,3,6 negiert)
//       · det bleibt +1 · FK-Kette konsistent · doppelte Spiegelung
//         = Original · Knochenlängen invariant · Anatomie-Probe kippt
//   ▸ Real-Modell-Konventions-Pin (wenn decoder.onnx vorhanden):
//      _decoder-Walk zeigt „Right"-Knochen ANATOMISCH LINKS (das ist
//       der bewiesene Modell-Defekt) → nach Spiegelung anatomisch
//       RECHTS — falls das kippt, hat sich die Modell-Konvention
//       geändert (neuer Rev!) und der Mirror muss geprüft werden
//   ▸ Verdrahtungs-Pins: generate() spiegelt VOR Sanitizer,
//     VERSION 2.28.4, versionCode 45
// Usage: node scripts/ardy_mirror_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { strict as assert } from 'node:assert';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const ARDY = path.join(ROOT, 'scripts/ardy');

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const { mirrorArdyOutputX } = await import(path.join(WWW, 'js/ardy.js'));

const manifest = JSON.parse(readFileSync(path.join(ARDY, 'model.json'), 'utf8'));
const J = manifest.dimensions.num_joints;
const names = manifest.skeleton.joint_names;
const parents = manifest.skeleton.parents;

function mkOut(nFrames) {
  return {
    frameCount: nFrames,
    fps: 20,
    jointNames: names.slice(),
    parents: parents.slice(),
    joints: new Float32Array(nFrames * J * 3),
    globalRotations: new Float32Array(nFrames * J * 9),
    localRotations: new Float32Array(nFrames * J * 9),
    rootPositions: new Float32Array(nFrames * 3),
    footContacts: new Float32Array(nFrames * 4),
  };
}
// Deterministische „Pseudo-Rotationen" (determinant +1): Rz(a)·Ry(b)·Rx(c)
function rotMat(a, b, c) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const Rx = [1, 0, 0, 0, cc, -sc, 0, sc, cc];
  const Ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const Rz = [ca, -sa, 0, sa, ca, 0, 0, 0, 1];
  const mul = (A, B) => {
    const C = new Float32Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] = A[r * 3] * B[k] + A[r * 3 + 1] * B[3 + k] + A[r * 3 + 2] * B[6 + k];
    return C;
  };
  return mul(Rz, mul(Ry, Rx));
}
const det3 = (M) => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
const mul = (A, B) => {
  const C = new Float32Array(9);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] = A[r * 3] * B[k] + A[r * 3 + 1] * B[3 + k] + A[r * 3 + 2] * B[6 + k];
  return C;
};

console.log('\n[1] Positionen + rootPositions: x → −x');
await ok('joints.x negiert, y/z unverändert', () => {
  const out = mkOut(3);
  for (let f = 0; f < 3; f++) for (let j = 0; j < J; j++) {
    const o = (f * J + j) * 3;
    out.joints[o] = 0.1 + f + j; out.joints[o + 1] = 0.5 + j; out.joints[o + 2] = -0.2 + f;
  }
  out.rootPositions.set([1.5, 0.9, -0.3], 3); // Frame 1
  mirrorArdyOutputX(out);
  for (let f = 0; f < 3; f++) for (let j = 0; j < J; j++) {
    const o = (f * J + j) * 3;
    assert.ok(Math.abs(out.joints[o] + (0.1 + f + j)) < 1e-6, 'x f' + f + ' j' + j);
    assert.ok(Math.abs(out.joints[o + 1] - (0.5 + j)) < 1e-6, 'y f' + f + ' j' + j);
    assert.ok(Math.abs(out.joints[o + 2] + (0.2 - f)) < 1e-6, 'z f' + f + ' j' + j);
  }
  assert.ok(Math.abs(out.rootPositions[3] + 1.5) < 1e-6);
  assert.ok(Math.abs(out.rootPositions[4] - 0.9) < 1e-6);
  assert.ok(Math.abs(out.rootPositions[5] + 0.3) < 1e-6);
});

console.log('\n[2] Rotationen: M·R·M-Konjugation');
await ok('Elemente 1,2,3,6 negiert; 0,4,5,7,8 unverändert', () => {
  const out = mkOut(2);
  const R0 = rotMat(0.3, -0.7, 1.1);
  out.globalRotations.set(R0, 4 * 9); // Frame 0, Joint 1
  out.localRotations.set(R0, 4 * 9);
  mirrorArdyOutputX(out);
  const got = out.globalRotations.subarray(4 * 9, 4 * 9 + 9);
  const want = [R0[0], -R0[1], -R0[2], -R0[3], R0[4], R0[5], -R0[6], R0[7], R0[8]];
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-12, 'idx ' + i);
});
await ok('det bleibt +1 (echte Drehung, keine Verrillung)', () => {
  const out = mkOut(1);
  for (let j = 0; j < J; j++) { out.globalRotations.set(rotMat(j * 0.13, j * 0.29, -j * 0.07), j * 9); out.localRotations.set(rotMat(j * 0.07, -j * 0.11, j * 0.03), j * 9); }
  mirrorArdyOutputX(out);
  for (let j = 0; j < J; j++) {
    assert.ok(Math.abs(det3(out.globalRotations.subarray(j * 9, j * 9 + 9)) - 1) < 1e-6, 'G joint ' + j);
    assert.ok(Math.abs(det3(out.localRotations.subarray(j * 9, j * 9 + 9)) - 1) < 1e-6, 'L joint ' + j);
  }
});
await ok('FK-Kette (klar): gespiegelte Globale = Komposition gespiegelter Lokale', () => {
  const M = Float32Array.of(-1, 0, 0, 0, 1, 0, 0, 0, 1);
  const out = mkOut(1);
  for (let j = 0; j < J; j++) {
    out.globalRotations.set(rotMat(j * 0.17, -j * 0.23, j * 0.31), j * 9);
    out.localRotations.set(rotMat(j * 0.11, j * 0.37, -j * 0.19), j * 9);
  }
  const G0 = [], L0 = [];
  for (let j = 0; j < J; j++) {
    G0.push(Float32Array.from(out.globalRotations.subarray(j * 9, j * 9 + 9)));
    L0.push(Float32Array.from(out.localRotations.subarray(j * 9, j * 9 + 9)));
  }
  mirrorArdyOutputX(out);
  for (let j = 1; j < J; j++) {
    const p = parents[j];
    if (p < 0) continue;
    const M_Gp_M = mul(M, mul(G0[p], M));
    const M_Lj_M = mul(M, mul(L0[j], M));
    const lhs = mul(M_Gp_M, M_Lj_M);            // gespiegelte Komposition
    const rhs = mul(M, mul(mul(G0[p], L0[j]), M)); // Spiegel der Original-Komposition
    for (let i = 0; i < 9; i++) assert.ok(Math.abs(lhs[i] - rhs[i]) < 1e-12, 'joint ' + j + ' idx ' + i);
    // UND: die gespiegelte Globale ist genau das, was der Mirror geschrieben hat
    const wrote = out.globalRotations.subarray(p * 9, p * 9 + 9);
    for (let i = 0; i < 9; i++) assert.ok(Math.abs(M_Gp_M[i] - wrote[i]) < 1e-12, 'wrote joint ' + p + ' idx ' + i);
  }
});
await ok('Doppelte Spiegelung = Original (Involution)', () => {
  const out = mkOut(2);
  for (let f = 0; f < 2; f++) for (let j = 0; j < J; j++) {
    out.joints.set([0.3 + f, 0.9, -0.4 + j], (f * J + j) * 3);
    out.globalRotations.set(rotMat(j * 0.21, f * 0.13, -j * 0.05), (f * J + j) * 9);
    out.localRotations.set(rotMat(-j * 0.11, 0.07, j * 0.29), (f * J + j) * 9);
    out.rootPositions.set([0.7 + f, 0.91, -0.2], f * 3);
  }
  const origJ = Float32Array.from(out.joints);
  const origG = Float32Array.from(out.globalRotations);
  const origL = Float32Array.from(out.localRotations);
  const origR = Float32Array.from(out.rootPositions);
  mirrorArdyOutputX(out);
  mirrorArdyOutputX(out);
  for (let i = 0; i < origJ.length; i++) assert.equal(out.joints[i], origJ[i]);
  for (let i = 0; i < origG.length; i++) assert.equal(out.globalRotations[i], origG[i]);
  for (let i = 0; i < origL.length; i++) assert.equal(out.localRotations[i], origL[i]);
  for (let i = 0; i < origR.length; i++) assert.equal(out.rootPositions[i], origR[i]);
});
await ok('Knochenlängen invariant (Sanitizer-kompatibel)', () => {
  const out = mkOut(1);
  for (let j = 0; j < J; j++) out.joints.set([j * 0.05 - 0.3, 0.9 - j * 0.1, (j % 3) * 0.2], j * 3);
  const boneLen = (data) => {
    let sum = 0;
    for (let j = 1; j < J; j++) {
      const p = parents[j];
      if (p < 0) continue;
      sum += Math.hypot(data[j * 3] - data[p * 3], data[j * 3 + 1] - data[p * 3 + 1], data[j * 3 + 2] - data[p * 3 + 2]);
    }
    return sum;
  };
  const before = boneLen(out.joints);
  mirrorArdyOutputX(out);
  assert.ok(Math.abs(boneLen(out.joints) - before) < 1e-9);
});
await ok('Anatomie-Probe: Knochen an +X wandert nach −X (Seitenwechsel)', () => {
  const out = mkOut(1);
  out.joints.set([0.09, 0.88, 0], 19 * 3); // „RightUpLeg"-Position bei +X
  out.joints.set([0, 0.9, 0], 0 * 3);
  mirrorArdyOutputX(out);
  assert.ok(out.joints[19 * 3] < 0, 'jetzt bei −X');
  out.joints.set([-0.09, 0.88, 0], 23 * 3);
  mirrorArdyOutputX(out);
  assert.ok(out.joints[23 * 3] > 0, 'jetzt bei +X');
});

console.log('\n[3] Verdrahtungs-Pins');
{
  const ardyJs = readFileSync(path.join(WWW, 'js/ardy.js'), 'utf8');
  const mainJs = readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
  const gradle = readFileSync(path.join(ROOT, 'app/build.gradle'), 'utf8');
  const iMirror = ardyJs.indexOf('mirrorArdyOutputX(out);');
  const iSan = ardyJs.indexOf('sanitizeArdyOutput(out);', iMirror);
  await ok('generate(): mirror VOR sanitize (Metriken beschreiben finale Daten)', () => {
    assert.ok(iMirror > 0 && iSan > iMirror);
  });
  await ok('mirrorArdyOutputX exportiert', () => assert.ok(ardyJs.includes('export function mirrorArdyOutputX')));
  await ok('VERSION 2.28.5/2.28.6 + versionCode 46/47', () => {
    assert.ok(mainJs.includes("const VERSION = '2.28.5';") || mainJs.includes("const VERSION = '2.28.6';") || mainJs.includes("const VERSION = '2.28.7';"));
    assert.ok((gradle.includes('versionCode 46') && gradle.includes('versionName "2.28.5"')) || (gradle.includes('versionCode 47') && gradle.includes('versionName "2.28.6"')) || (gradle.includes('versionCode 48') && gradle.includes('versionName "2.28.7"')));
  });
}

console.log('\n[4] Real-Modell-Konventions-Pin (decoder.onnx)');
{
  const decPath = path.join(ARDY, 'decoder.onnx');
  if (!existsSync(decPath)) {
    console.log('  ⚠ decoder.onnx fehlt (gitignored) — Real-Pin übersprungen (lokal: scripts/ardy laden)');
    console.log('    Test-Basis: ' + passed + ' bestanden, ' + failed + ' fehlgeschlagen');
    if (failed > 0) process.exit(1);
    process.exit(0);
  }
  const { createRequire } = await import('node:module');
  const requireFromArdy = createRequire(path.join(ARDY, 'package.json'));
  const ort = requireFromArdy('onnxruntime-node');
  const dims = manifest.dimensions;
  const g = manifest.graphs.decoder.inputs;
  const o = manifest.graphs.decoder.outputs;
  const session = await ort.InferenceSession.create(decPath);
  const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  const rec = manifest.recenter;
  let _s = 4242 >>> 0;
  const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const NFPT = dims.num_frames_per_token;
  const TOK = 10;
  for (let t = 0; t < TOK; t++) {
    const base = t * dims.hybrid_dim;
    for (let f = 0; f < NFPT; f++) {
      const fb = base + f * dims.root_features_per_frame;
      h[fb + 0] = ((t * NFPT + f) * (1.0 / 39) - rec.root_mean[0]) / rec.root_std[0]; // Walk +X
      h[fb + 1] = (0.9 - rec.root_mean[1]) / rec.root_std[1];
      h[fb + 2] = (0 - rec.root_mean[2]) / rec.root_std[2];
      h[fb + 3] = (1 - rec.root_mean[3]) / rec.root_std[3];
      h[fb + 4] = (0 - rec.root_mean[4]) / rec.root_std[4];
    }
    for (let r = 0; r < dims.latent_dim; r++) h[base + dims.nframe_root_dim + r] = Math.fround(gauss() * 0.01);
  }
  const mask = new Float32Array(dims.max_frames);
  mask.fill(1, 0, TOK * NFPT);
  const res = await session.run({
    [g.hybridTokens]: new ort.Tensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
    [g.motionPadMask]: new ort.Tensor('float32', mask, [1, dims.max_frames]),
    [g.globalTranslation]: new ort.Tensor('float32', new Float32Array([0, 0, 0]), [1, 3]),
  });
  const N = TOK * NFPT;
  const pos = new Float32Array(res[o.posedJoints].data.subarray(0, N * J * 3));
  const root = new Float32Array(res[o.rootPositions].data.subarray(0, N * 3));
  const out = mkOut(N);
  out.joints.set(pos);
  out.rootPositions.set(root);
  const anatomicalSide = (data) => {
    // rechts_Welt = up × drift̂ (RH); Drift aus den HIPS-POSITIONEN der
    // data selbst (Joint 0) — damit pre/post-Mirror konsistent gemessen wird
    const drift = [data[(N - 1) * J * 3] - data[0], data[(N - 1) * J * 3 + 1] - data[1], data[(N - 1) * J * 3 + 2] - data[2]];
    const dl = Math.hypot(...drift) || 1;
    const dhat = drift.map(v => v / dl);
    const right = [dhat[2], 0, -dhat[0]]; // up=(0,1,0) × d̂
    const side = (j) => {
      let acc = 0;
      for (let f = 0; f < N; f++) acc += (data[f * J * 3 + j * 3] - data[f * 3]) * right[0] + (data[f * J * 3 + j * 3 + 2] - data[f * 3 + 2]) * right[2];
      return acc / N;
    };
    return { rightSide: side(19), leftSide: side(23) };
  };
  const pre = anatomicalSide(out.joints);
  await ok('REAL pre-Mirror: „RightUpLeg" anatomisch LINKS (Modell-Defekt bestätigt)', () => {
    assert.ok(pre.rightSide < 0, 'rightSide=' + pre.rightSide.toFixed(3));
    assert.ok(pre.leftSide > 0, 'leftSide=' + pre.leftSide.toFixed(3));
  });
  mirrorArdyOutputX(out);
  const post = anatomicalSide(out.joints);
  await ok('REAL post-Mirror: „RightUpLeg" anatomisch RECHTS (Fix wirkt)', () => {
    assert.ok(post.rightSide > 0, 'rightSide=' + post.rightSide.toFixed(3));
    assert.ok(post.leftSide < 0, 'leftSide=' + post.leftSide.toFixed(3));
  });
}

console.log('\n═══ Ergebnis: ' + passed + ' bestanden, ' + failed + ' fehlgeschlagen ═══');
if (failed > 0) process.exit(1);
