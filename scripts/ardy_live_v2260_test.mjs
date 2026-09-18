// ardy_live_v2260_test.mjs — v2.26.0 LIVE-STEERUNG von ARDY Mini:
// opts.getLivePrompt wird an jedem Fensteranfang befragt; ein geänderter
// Prompt wird sofort neu kodiert (Text-Anteil), History/Seed bleiben.
// Beweis mit gemocktem Runtime-Subclass (keine echten ONNX-Sessions).
//
// Usage: node scripts/ardy_live_v2260_test.mjs

import { ArdyRuntime } from '../app/src/main/assets/www/js/ardy.js';

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name); if (!cond) fails++; };

// ── Minimales Manifest (nur was generate() + Pure-Helfer anfassen) ──
const dims = {
  fps: 20, num_frames_per_token: 4, generation_frames: 8,
  history_tokens: 10, generation_tokens: 2, max_tokens: 50, max_frames: 200,
  hybrid_dim: 80, nframe_root_dim: 8, root_features_per_frame: 8, latent_dim: 72,
  motion_dim: 160, num_joints: 27, history_frames: 40,
};
const manifest = {
  generation: { min_frames: 8, max_frames: 200, default_cfg_weight: 2 },
  diffusion: { timesteps: [11, 5], alphas_cumprod: [0.9, 0.5], alphas_cumprod_prev: [0.9, 0.2] },
  dimensions: dims,
  recenter: {
    position_indices: [0, 1, 2], heading_indices: [6, 7],
    root_mean: new Float32Array(8), root_std: new Float32Array(8).fill(1),
  },
  latent_quantization: null,
  skeleton: { joint_names: Array.from({ length: 27 }, (_, i) => 'J' + i), parents: Array.from({ length: 27 }, (_, i) => (i ? 0 : -1)) },
};

class MockRuntime extends ArdyRuntime {
  constructor(encodeLog) { super(manifest, null, {}, 'wasm'); this._encodeLog = encodeLog; }
  async _encodeText(prompt /*, signal */) { this._encodeLog.push(prompt); return { __textCond: prompt }; }
  async _denoiseWindow() { /* kein Denoising im Mock */ }
  async _decode(_h, _validTokens, _gt) {
    const L = dims.max_frames, J = dims.num_joints;
    return {
      motion: new Float32Array(L * dims.motion_dim),
      joints: new Float32Array(L * J * 3),
      localRotations: new Float32Array(L * J * 9),
      globalRotations: new Float32Array(L * J * 9),
      rootPositions: new Float32Array(L * 3),
      footContacts: null,
      globalRootHeading: new Float32Array(L * 2),
    };
  }
}

// 2 s → 40 Frames → 5 Fenster à 8 Frames
const SECONDS = 2;
const WINDOWS = 5;

console.log('■ Live-Steuerung (getLivePrompt)');

// A) Prompt wechselt nach dem 1. Fenster → genau 1 Neu-Kodierung
{
  const encodeLog = [];
  const rt = new MockRuntime(encodeLog);
  let calls = 0;
  const out = await rt.generate({
    prompt: 'a person walks', seconds: SECONDS,
    getLivePrompt: () => { calls++; return calls >= 2 ? 'a person runs' : 'a person walks'; },
  });
  check('getLivePrompt an jedem Folgefester-Anfang befragt (' + calls + '×, Fenster 0 nutzt den Start-Prompt)', calls === WINDOWS - 1);
  check('Initiale Kodierung + 1 Live-Wechsel = 2 Kodierungen', encodeLog.length === 2);
  check('Reihenfolge: „a person walks“ → „a person runs“', encodeLog[0] === 'a person walks' && encodeLog[1] === 'a person runs');
  check('Ergebnis trägt den finalen Live-Prompt (promptsLive)', out.promptsLive === 'a person runs');
  check('Alle Frames generiert (40)', out.frameCount === 40);
}

// B) Gleicher Prompt → KEINE Neu-Kodierung
{
  const encodeLog = [];
  const rt = new MockRuntime(encodeLog);
  const out = await rt.generate({
    prompt: 'a person walks', seconds: SECONDS,
    getLivePrompt: () => 'a person walks',
  });
  check('Unveränderter Prompt: nur 1 Kodierung', encodeLog.length === 1);
  check('promptsLive bleibt undefined (kein Wechsel)', out.promptsLive === undefined);
}

// C) Leer/gelöschter Prompt wird ignoriert (kein Abbruch, kein Wechsel)
{
  const encodeLog = [];
  const rt = new MockRuntime(encodeLog);
  let flip = false;
  const out = await rt.generate({
    prompt: 'a person walks', seconds: SECONDS,
    getLivePrompt: () => { flip = !flip; return flip ? '' : 'a person walks'; },
  });
  check('Leerer Live-Prompt: keine zusätzliche Kodierung', encodeLog.length === 1);
  check('Generation läuft trotzdem durch', out.frameCount === 40);
}

// D) Ohne getLivePrompt alles wie v2.25.0
{
  const encodeLog = [];
  const rt = new MockRuntime(encodeLog);
  const out = await rt.generate({ prompt: 'a person walks', seconds: SECONDS });
  check('Ohne getLivePrompt: Verhalten unverändert (1 Kodierung)', encodeLog.length === 1 && out.frameCount === 40 && out.promptsLive === undefined);
}

// E) Seed-Determinismus bleibt erhalten (gleicher Seed ⇒ gleiche Rotationen)
{
  const a = await new MockRuntime([]).generate({ prompt: 'x', seconds: SECONDS, seed: 1234 });
  const b = await new MockRuntime([]).generate({ prompt: 'x', seconds: SECONDS, seed: 1234 });
  let same = a.globalRotations.length === b.globalRotations.length;
  for (let i = 0; i < a.globalRotations.length; i += 97) { if (a.globalRotations[i] !== b.globalRotations[i]) { same = false; break; } }
  check('Seed-Determinismus unangetastet', same);
}

console.log('');
console.log(fails ? 'FEHLER: ' + fails : 'ALLE CHECKS GRÜN (ardy_live_v2260)');
process.exit(fails ? 1 : 0);
