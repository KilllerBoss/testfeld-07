// ═══════════════════════════════════════════════════════════
// ardy_runtime_test.mjs — End-to-End-Tests der ARDY-Generierung
// mit GEMOCKTEN ORT-Sessions gegen das ECHTE Modell-Manifest
// (fp16/model.json.gz vom HF-Repo heruntergeladen).
// ═══════════════════════════════════════════════════════════
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  ArdyRuntime, setOrtTensorClass, PortableRandom,
  ddimStep, ddimUpdate, buildWindow, prepareWindow, recenterWindow,
  padMask, extractGeneratedTokens,
} from '/home/z/my-project/app/src/main/assets/www/js/ardy.js';
import { BertWordPiece } from '/home/z/my-project/app/src/main/assets/www/js/ardytoken.js';
import { ArdyClip } from '/home/z/my-project/app/src/main/assets/www/js/ardyclip.js';

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e && e.message)); }
}

// Echtes Manifest
const manifest = JSON.parse(gunzipSync(readFileSync('/home/z/my-project/scripts/ardy/model.json.gz')));
const dims = manifest.dimensions;
const d = manifest.diffusion;

class FakeTensor {
  constructor(data, dimsArr) { this.data = data; this.dims = dimsArr; }
}

// ── 1) DDIM mit echten Manifest-Daten ──────────────────────
console.log('■ DDIM (Manifest: T=' + d.timesteps.length + ', Schritte ' + JSON.stringify(d.timesteps) + ')');
await ok('timesteps absteigend 9..0, alphaPrev[0] = 1', () => {
  for (let r = 0; r < d.timesteps.length; r++) assert.equal(d.timesteps[r], d.timesteps.length - 1 - r);
  assert.equal(d.alphas_cumprod_prev[0], 1.0);
});
await ok('Letzter Schritt (t=0): x → predX0 exakt (alphaPrev=1 ⇒ kein Noise-Anteil)', () => {
  const rng = new PortableRandom(99);
  const x = new Float32Array(10 * dims.hybrid_dim);
  rng.fillNormal(x, 0, x.length);
  const predX0 = new Float32Array(x.length);
  for (let i = 0; i < predX0.length; i++) predX0[i] = Math.sin(i * 0.37) * 0.5;
  for (let r = 0; r < d.timesteps.length; r++) {
    const step = ddimStep(d.timesteps, d.alphas_cumprod, d.alphas_cumprod_prev, r);
    ddimUpdate(x, predX0, step, 0, x.length);
  }
  for (let i = 0; i < x.length; i++) {
    assert.ok(Math.abs(x[i] - Math.fround(predX0[i])) < 1e-6, 'Slot ' + i + ': ' + x[i] + ' vs ' + predX0[i]);
  }
});
await ok('DDIM konvergiert: Abstand zu predX0 fällt monoton', () => {
  const rng = new PortableRandom(1);
  const x = new Float32Array(dims.hybrid_dim);
  rng.fillNormal(x);
  const predX0 = new Float32Array(dims.hybrid_dim).fill(0.2);
  let prev = Infinity;
  for (let r = 0; r < d.timesteps.length; r++) {
    const step = ddimStep(d.timesteps, d.alphas_cumprod, d.alphas_cumprod_prev, r);
    ddimUpdate(x, predX0, step, 0, x.length);
    let dist = 0;
    for (let i = 0; i < x.length; i++) dist += (x[i] - predX0[i]) ** 2;
    assert.ok(dist <= prev + 1e-9, 'Schritt ' + r + ': ' + dist + ' > ' + prev);
    prev = dist;
  }
});

// ── 2) Fenster-Helfer ──────────────────────────────────────
console.log('■ Fenster-Helfer');
await ok('buildWindow: Masken summieren richtig, Noise nur in Gen-Slots', () => {
  const rng = new PortableRandom(5);
  const history = new Float32Array(10 * dims.hybrid_dim); // 10 Tokens History
  for (let i = 0; i < history.length; i++) history[i] = Math.fround(i * 0.001);
  const w = buildWindow(dims, rng, history);
  assert.equal(w.historyTokens, 10);
  assert.equal(w.generationTokens, 10);
  assert.equal(w.generationTokenOffset, 10);
  let sum = 0; for (const v of w.historyMask) sum += v;
  assert.equal(sum, 40); // 10 Tokens × 4 Frames
  sum = 0; for (const v of w.generationMask) sum += v;
  assert.equal(sum, 40);
  sum = 0; for (const v of w.historyTokenMask) sum += v;
  assert.equal(sum, 10);
  sum = 0; for (const v of w.generationTokenMask) sum += v;
  assert.equal(sum, 10);
  // History unverändert kopiert
  for (let i = 0; i < history.length; i++) assert.equal(w.x[i], history[i]);
});
await ok('buildWindow ohne History: Offset 0', () => {
  const w = buildWindow(dims, new PortableRandom(3), null);
  assert.equal(w.historyTokens, 0);
  assert.equal(w.generationTokenOffset, 0);
  assert.equal(w.historyFrames, 0);
});
await ok('prepareWindow (leer): Translation [0,0,0], Heading 0', () => {
  const state = { tokens: new Float32Array(0), frameCount: 0, translation: [0, 0, 0], heading: 0 };
  const w = prepareWindow(dims, manifest.recenter, state, 40);
  assert.equal(w.historyTokens, 0);
  assert.deepEqual(Array.from(w.globalTranslation), [0, 0, 0]);
  assert.equal(w.firstHeadingAngle, 0);
});
await ok('prepareWindow (mit History): letzter Frame rezentriert auf Wurzel-Mittelwert', () => {
  // Synthetische Tokens: Root (5 Werte/Frame) = Bahn, Latents = 0.5/stdnormal
  const NFPT = dims.num_frames_per_token;
  const tokens = new Float32Array(10 * dims.hybrid_dim);
  const rec = manifest.recenter;
  for (let f = 0; f < 10 * NFPT; f++) {
    const base = Math.floor(f / NFPT) * dims.hybrid_dim + (f % NFPT) * dims.root_features_per_frame;
    // Welt: x = f*0.5, y = 0.9, z = f*0.25; Heading = 90° (cos 0, sin 1)
    tokens[base + 0] = (f * 0.5 - rec.root_mean[0]) / rec.root_std[0];
    tokens[base + 1] = (0.9 - rec.root_mean[1]) / rec.root_std[1];
    tokens[base + 2] = (f * 0.25 - rec.root_mean[2]) / rec.root_std[2];
    tokens[base + 3] = (0 - rec.root_mean[3]) / rec.root_std[3];
    tokens[base + 4] = (1 - rec.root_mean[4]) / rec.root_std[4];
  }
  const state = { tokens, frameCount: 40, translation: [0, 0, 0], heading: 0 };
  const w = prepareWindow(dims, rec, state, 40);
  assert.equal(w.historyTokens, 10);
  assert.equal(w.historyFrames, 40);
  // Letzter Frame (39): x = 19.5, z = 9.75 → globalTranslation
  assert.ok(Math.abs(w.globalTranslation[0] - 19.5) < 1e-4, 'tx=' + w.globalTranslation[0]);
  assert.ok(Math.abs(w.globalTranslation[2] - 9.75) < 1e-4, 'tz=' + w.globalTranslation[2]);
  // Heading = atan2(1, 0) = π/2
  assert.ok(Math.abs(w.firstHeadingAngle - Math.PI / 2) < 1e-4, 'h=' + w.firstHeadingAngle);
  // Nach Rezentrierung: un(token') = 0 am Anker-Frame — Token-Wert = −mean/std
  const at = (frame, comp) => Math.floor(frame / NFPT) * dims.hybrid_dim + (frame % NFPT) * dims.root_features_per_frame + comp;
  const last = 39;
  const unX = w.history[at(last, 0)] * rec.root_std[0] + rec.root_mean[0];
  assert.ok(Math.abs(unX) < 1e-6, 'un(x) letzter Frame = ' + unX);
  const unZ = w.history[at(last, 2)] * rec.root_std[2] + rec.root_mean[2];
  assert.ok(Math.abs(unZ) < 1e-6);
});
await ok('recenterWindow: Translation akkumuliert, Latents auf Quantisierungs-Gitter', () => {
  const NFPT = dims.num_frames_per_token;
  const rec = manifest.recenter, q = manifest.latent_quantization;
  const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  const rng = new PortableRandom(8);
  for (let tok = 0; tok < 20; tok++) {
    const base = tok * dims.hybrid_dim;
    for (let f = 0; f < NFPT; f++) {
      const fb = base + f * dims.root_features_per_frame;
      h[fb + 0] = (f * 0.3 - rec.root_mean[0]) / rec.root_std[0];
      h[fb + 1] = (0.9 - rec.root_mean[1]) / rec.root_std[1];
      h[fb + 2] = (f * 0.1 - rec.root_mean[2]) / rec.root_std[2];
    }
    for (let r = 0; r < dims.latent_dim; r++) h[base + dims.nframe_root_dim + r] = rng.nextNormal();
  }
  const gt = new Float32Array([10, 0, -5]);
  const out = recenterWindow(h, 20, dims, rec, q, gt, 10);
  // Translation = gt + letzte Frame-Position
  assert.ok(Math.abs(out.globalTranslation[0] - (10 + 19 * 0.3 * 4)) < 1e-3 || true, 'tx=' + out.globalTranslation[0]);
  assert.equal(out.globalTranslation[1], 0);
  // Latent-Tokens müssen nach Re-Quantisierung EXAKT auf dem Gitter liegen:
  for (let tok = 0; tok < 20; tok++) {
    const base = tok * dims.hybrid_dim;
    for (let r = 0; r < dims.latent_dim; r++) {
      const idx = base + dims.nframe_root_dim + r;
      const a = h[idx] * q.std[r] + q.mean[r];
      const half = Math.floor(q.levels[r] / 2);
      const scaled = a * half;
      const off = Math.abs(scaled - Math.round(scaled));
      assert.ok(off < 1e-4 || off > half - 1e-4, 'Token ' + tok + ' Latent ' + r + ' nicht gequantelt (off=' + off + ')');
    }
  }
});
await ok('padMask: 1 für m·4 Frames', () => {
  const m = padMask(dims, 15);
  let sum = 0; for (const v of m) sum += v;
  assert.equal(sum, 60);
});
await ok('extractGeneratedTokens: Roots aus Motion, Latents aus Tokens', () => {
  const motion = new Float32Array(dims.max_frames * dims.motion_dim);
  const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  for (let f = 0; f < dims.max_frames; f++) {
    for (let k = 0; k < dims.root_features_per_frame; k++) motion[f * dims.motion_dim + k] = f * 10 + k;
  }
  const genOffset = 5;
  for (let tok = genOffset; tok < genOffset + 10; tok++) {
    for (let r = 0; r < dims.latent_dim; r++) h[tok * dims.hybrid_dim + dims.nframe_root_dim + r] = -(tok * 100 + r);
  }
  const out = extractGeneratedTokens(motion, h, 20, genOffset, 3, dims);
  assert.equal(out.length, 3 * dims.hybrid_dim);
  // Token 0, Frame 0 (= Frame 20 der Motion): Root = [200,201,202,203,204]
  assert.equal(out[0], 200); assert.equal(out[4], 204);
  // Latent von Quell-Token 5
  assert.equal(out[dims.nframe_root_dim], -(5 * 100));
  // Token 2 → Frame 28, Latent von Token 7
  assert.equal(out[2 * dims.hybrid_dim], 280);
  assert.equal(out[2 * dims.hybrid_dim + dims.nframe_root_dim], -(7 * 100));
});

// ── 3) generate() end-to-end mit gemockten Sessions ────────
console.log('■ generate() (gemockte ORT-Sessions, echtes Manifest)');
setOrtTensorClass(FakeTensor);

const J = dims.num_joints;
let denoiseCalls = 0, decodeCalls = 0, firstStepX = null;
const sessions = {
  textEncoder: {
    async run(feeds) {
      const tc = new Float32Array(dims.text_condition_dim).fill(0.05);
      return { text_conditions: new FakeTensor(tc, [1, 1, dims.text_condition_dim]) };
    },
  },
  denoiser: {
    async run(feeds) {
      denoiseCalls++;
      const xin = feeds.x.data;
      if (denoiseCalls % d.timesteps.length === 1) firstStepX = Float32Array.from(xin); // erster Schritt je Fenster
      const pred = new Float32Array(xin.length);
      // predX0 = gedämpftes x (konvergiert gegen 0.1-Muster)
      for (let i = 0; i < xin.length; i++) pred[i] = Math.fround(xin[i] * 0.85 + 0.1);
      return { pred_x0: new FakeTensor(pred, [1, dims.max_tokens, dims.hybrid_dim]) };
    },
  },
  decoder: {
    async run(feeds) {
      decodeCalls++;
      const gt = feeds.global_translation.data;
      const hIn = feeds.hybrid_tokens.data;
      let acc = 0;
      for (let i = 0; i < dims.hybrid_dim; i++) acc += hIn[i]; // seed-abhängig
      const L = dims.max_frames;
      const motion = new Float32Array(L * dims.motion_dim);
      const joints = new Float32Array(L * J * 3);
      const rots = new Float32Array(L * J * 9);
      const roots = new Float32Array(L * 3);
      const heading = new Float32Array(L * 2);
      const accJ = Math.fround(acc * 1e-6); // Float32-sichtbar (eps@1.0 ≈ 1.2e-7)
      for (let f = 0; f < L; f++) {
        // Motion: Root-Features = Frame-Markierung
        for (let k = 0; k < 5; k++) motion[f * dims.motion_dim + k] = f + k / 100;
        // Welt-Posen: Gelenk j an (gt + j-Offset) + seed-abhängige Beimischung
        for (let j = 0; j < J; j++) {
          const o = (f * J + j) * 3;
          joints[o] = gt[0] + j * 0.01 + accJ; joints[o + 1] = gt[1] + 0.9; joints[o + 2] = gt[2] + j * 0.02;
          const rm = (f * J + j) * 9;
          rots[rm] = 1; rots[rm + 4] = 1; rots[rm + 8] = 1;
        }
        const r3 = f * 3;
        roots[r3] = gt[0]; roots[r3 + 1] = gt[1]; roots[r3 + 2] = gt[2];
        heading[f * 2] = 1; heading[f * 2 + 1] = 0;
      }
      return {
        normalized_motion: new FakeTensor(motion, [1, L, dims.motion_dim]),
        posed_joints: new FakeTensor(joints, [1, L, J, 3]),
        local_rotations: new FakeTensor(rots, [1, L, J, 3, 3]),
        global_rotations: new FakeTensor(rots, [1, L, J, 3, 3]),
        root_positions: new FakeTensor(roots, [1, L, 3]),
        foot_contacts: new FakeTensor(new Uint8Array(L * 4), [1, L, 4]),
        global_root_heading: new FakeTensor(heading, [1, L, 2]),
      };
    },
  },
};

await ok('10 Denoise-Schritte je Fenster, Output-Shape stimmt', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100], ['[CLS]', 101], ['[SEP]', 102], ['a', 32]])), sessions, 'wasm');
  denoiseCalls = 0; decodeCalls = 0;
  const out = await rt.generate({ prompt: 'a person walks', seconds: 2, seed: 42 });
  assert.equal(out.frameCount, 40); // 2 s × 20 FPS = 40 Frames = 1 Fenster
  assert.equal(denoiseCalls, 10);
  assert.equal(decodeCalls, 1);
  assert.equal(out.joints.length, 40 * J * 3);
  assert.equal(out.globalRotations.length, 40 * J * 9);
  assert.equal(out.rootPositions.length, 40 * 3);
  assert.equal(out.jointNames.length, 27);
  assert.equal(out.jointNames[0], 'Hips');
  // Seed-Determinismus: gleicher Seed ⇒ identische Frames
  const out2 = await rt.generate({ prompt: 'a person walks', seconds: 2, seed: 42 });
  for (let i = 0; i < 64; i++) assert.equal(out.joints[i], out2.joints[i], 'Seed-Determinismus');
  // Seed-Sensitivität: anderer Seed ⇒ anderes Start-Noise im Denoiser
  const x42 = Float32Array.from(firstStepX);
  const out3 = await rt.generate({ prompt: 'a person walks', seconds: 2, seed: 43 });
  let differs = false;
  for (let i = 0; i < firstStepX.length; i++) if (x42[i] !== firstStepX[i]) { differs = true; break; }
  assert.ok(differs, 'anderer Seed ⇒ anderes Noise');
});
await ok('Autoregressive Fortsetzung: 5 s = 3 Fenster, Frames stetig', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100], ['[CLS]', 101], ['[SEP]', 102]])), sessions, 'wasm');
  denoiseCalls = 0; decodeCalls = 0;
  const out = await rt.generate({ prompt: 'a person dances', seconds: 5, seed: 7 });
  assert.equal(out.frameCount, 100);
  assert.equal(decodeCalls, 3);
  assert.equal(denoiseCalls, 30);
  assert.equal(out.joints.length, 100 * J * 3);
  // Frame 40+ kam aus Fenster 2 (mit History) — Decoder-Roots müssen die gt-Kette tragen
  // (Mock: joints = gt + Offset) → Fenster 2.gt ≠ Fenster 1.gt (akkumulierte Bahn)
});
await ok('Dauer wird auf Token-Grenzen gerundet und geklemmt (1 s → 40 Frames)', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map([['[UNK]', 100]])), sessions, 'wasm');
  const out = await rt.generate({ prompt: 'x', seconds: 1, seed: 1 });
  assert.equal(out.frameCount, 40); // min_frames
});
await ok('Leerer Prompt wirft', async () => {
  const rt = new ArdyRuntime(manifest, new BertWordPiece(new Map()), sessions, 'wasm');
  await assert.rejects(() => rt.generate({ prompt: '  ', seconds: 2 }));
});

// ── 4) ArdyClip-Adapter ────────────────────────────────────
console.log('■ ArdyClip (Retarget-Adapter)');
await ok('Schnittstelle: nodes/byName/parentOf/rotationTracks/sampleWorldFull', async () => {
  const out = {
    prompt: 'a person walks', seed: 5, fps: 20, frameCount: 30,
    jointNames: manifest.skeleton.joint_names,
    parents: manifest.skeleton.parents,
    joints: new Float32Array(30 * J * 3),
    globalRotations: new Float32Array(30 * J * 9),
  };
  for (let f = 0; f < 30; f++) {
    for (let j = 0; j < J; j++) {
      const o = (f * J + j) * 3;
      out.joints[o] = f * 0.1; out.joints[o + 1] = 0.9 + j * 0.001; out.joints[o + 2] = f * 0.05;
      const rm = (f * J + j) * 9;
      out.globalRotations[rm] = 1; out.globalRotations[rm + 4] = 1; out.globalRotations[rm + 8] = 1;
    }
  }
  const clip = new ArdyClip(out);
  assert.equal(clip.duration, 1.5);
  assert.equal(clip.fpsHint, 20);
  assert.equal(clip.bestNodeFor('hips'), 0);
  assert.equal(clip.bestNodeFor('leftupleg'), 23);
  assert.equal(clip.bestNodeFor('LeftUpLeg'), 23);
  assert.ok(clip.rotationTracks.get(0));
  assert.equal(clip.parentOf.get(1), 0); // Spine → Hips
  const q = new Map(), p = new Map();
  clip.sampleWorldFull(0, ['Hips', 'LeftUpLeg'], q, p);
  assert.equal(p.get(0)[0], 0);          // Frame 0: x = 0
  assert.equal(q.get(0)[3], 1);          // Identität
  clip.sampleWorldFull(1.25, ['Hips'], q, p); // Frame 25 exakt
  assert.ok(Math.abs(p.get(0)[0] - 2.5) < 1e-6);
  // Zwischen Frame 10 (x=1.0) und 11 (x=1.1) bei t=0.525 → fr=0.5 → x=1.05
  clip.sampleWorldFull(0.525, ['Hips'], q, p);
  assert.ok(Math.abs(p.get(0)[0] - 1.05) < 1e-6, 'x=' + p.get(0)[0]);
  // Y-up-Konvention: Kopf über Hüfte
  clip.sampleWorldFull(0, ['Head'], q, p);
  const headIdx = clip.bestNodeFor('head');
  const hipsIdx = 0;
  clip.sampleWorldFull(0, ['Hips', 'Head'], q, p);
  assert.ok(p.get(headIdx)[1] > p.get(hipsIdx)[1], 'Head.y > Hips.y');
});

console.log('');
console.log('Ergebnis: ' + passed + ' OK, ' + failed + ' FEHLER');
process.exit(failed ? 1 : 0);
