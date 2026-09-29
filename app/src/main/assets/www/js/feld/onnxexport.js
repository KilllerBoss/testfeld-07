// ═══════════════════════════════════════════════════════════
// feld/onnxexport.js — ONNX-EXPORT der Soft-MoE-LLN-Policy
//
// Eigener ONNX-Writer (Protobuf, ohne Abhängigkeiten). Der Graph
// bildet die SoftMoEPolicy exakt ab (siehe train.js forward):
//
//   obs [N,D] (roh)
//    ├─ (optional Norm: obs_n = (obs − mean)/std) → Encoder
//    ├─ h1 Tanh(Gemm) → h2 Tanh(Gemm)
//    ├─ Router: Concat(h2, Relu(Slice obs skill)) → Gemm·Tanh
//    │          → Gemm + kPrior·Log(Relu(skill)+0.06) → Softmax = w
//    ├─ Experten e: Tanh(Gemm) → Tanh(Gemm) = EL_e ; mix = Σ w[:,e]·EL_e
//    ├─ Style: Gemm(Relu(Slice obs style), SE^T)
//    └─ Decoder: Concat(mix, style) → Tanh(Gemm) → Gemm → mu
//   Output: mu [N,A] (deterministische Policy)
//
// Der Router/Style liest IMMER die ROHE Obs (wie net.forward(xn, raw));
// wird opts.norm übergeben, läuft der Encoder auf (obs−mean)/std —
// dann ist der Export in der App 1:1 einsatzbereit.
//
// VARIANTEN: fp32 · fp16 (Cast in/out) · int8 (W8A32: int8-Gewichte
// + DequantizeLinear vor jedem Gemm)
// AUSFÜHRUNG: onnxruntime-web (CDN + Cache), EP: CPU=wasm · GPU=webgpu
// · NPU=webnn (Samsung S26 Ultra) · Auto (webnn→webgpu→wasm)
//
// v3.5.0 POLLEN-PROFIL — Format 1:1 wie die Original-Policies von Pollen
// Robotics (microduck-policies, exportiert über rsl_rl export_policy_to_onnx
// opset 18 + torch 2.9.1 + mjlab attach_metadata_to_onnx):
//   • ir_version 8 · producer_name 'pytorch' · producer_version '2.9.1'
//   • opset 18 (domain '') · Graph-Name 'main_graph'
//   • Eingang  „obs“     fp32, FEST [1, obsDim]  (kein dynamisches N —
//     die Originale tracen mit torch.zeros(1, D), dynamische Batch-Dims
//     hat KEIN Original)
//   • Ausgang „actions“  fp32, FEST [1, actDim] (vorher 'mu' — Loader auf
//     dem Duck/Playground greifen namentlich nach 'actions')
//   • 8 metadata_props wie im Original (mjlab get_base_metadata):
//     run_path · joint_names · joint_stiffness · joint_damping ·
//     default_joint_pos · command_names · observation_names · action_scale
//     — Listen als %.3f-Komma-CSV (list_to_csv_str), ehrliche Werte aus
//     unserem Microduck (dasselbe Pollen-MJCF: Aktuator-Order, STAND-
//     Keyframe, kp 2.2 / kv 0 aus chosen_actuator, actSpan 0.35)
//   • KEINE value_info für Zwischentensoren (das Original hat auch keine;
//     feste Dims machen die Shape-Inferenz vollständig)
//   • Softmax ab opset 13: axis als int64-SCALAR-Input, nicht Attribut
// ═══════════════════════════════════════════════════════════

import { SoftMoEPolicy } from '../train.js';

// ── Protobuf-Primitive ─────────────────────────────────────
function varint(v) {
  const out = [];
  let x = v >>> 0;
  while (x > 0x7f) { out.push((x & 0x7f) | 0x80); x >>>= 7; }
  out.push(x);
  return new Uint8Array(out);
}
/** 64-bit-varint für nicht-negative Werte < 2^53 (Slice-Indizes, Dims). */
function varint64(v) {
  if (v < 0 || v >= 9007199254740992) throw new Error('varint64 außerhalb: ' + v);
  const out = [];
  let x = v;
  while (x > 0x7f) { out.push((x % 128) | 0x80); x = Math.floor(x / 128); }
  out.push(x);
  return new Uint8Array(out);
}
const tag = (f, w) => varint((f << 3) | w);
function bf(f, buf) {
  const t = tag(f, 2), l = varint(buf.length);
  const out = new Uint8Array(t.length + l.length + buf.length);
  out.set(t, 0); out.set(l, t.length); out.set(buf, t.length + l.length);
  return out;
}
function vf(f, v) {
  const t = tag(f, 0), l = varint(v);
  const out = new Uint8Array(t.length + l.length);
  out.set(t, 0); out.set(l, t.length);
  return out;
}
function concatBytes(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const utf8 = (s) => new TextEncoder().encode(s);

// ── v3.5.0 Pollen-Formatprofil ─────────────────────────────
export const POLL_PROFILE = {
  ir: 8, producer: 'pytorch', producerVer: '2.9.1', graph: 'main_graph',
  inName: 'obs', outName: 'actions', opset: 18,
};
/** Aktuator-/Joint-Order = microduck.xml <actuator>-Reihenfolge (identisch
 *  mit den Original-Modellen von Pollen — dieselbe MJCF-Basis). */
export const POLL_JOINTS = [
  'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
  'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll',
  'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle',
];
/** STAND-Keyframe (ctrl) des Pollen-MJCF = default_joint_pos der Originale. */
export const POLL_DEFAULT_POS = [
  0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
  0.3490658503988659, 0.3490658503988659, 0, 0, 0,
  0.08726646259971647, 0.457924, 0.004940, -0.452984,
];
/** chosen_actuator im Pollen-MJCF: position kp=2.2, kv=0 (gainprm/biasprm). */
export const POLL_STIFFNESS = 2.2, POLL_DAMPING = 0.0;
/** Obs-Blöcke in EXAKTER Reihenfolge des observe()-Layouts (74 Dims). */
export const POLL_OBS_NAMES = [
  'joint_pos', 'joint_vel', 'proj_gravity_quat', 'yaw_rate', 'base_vel_yaw',
  'cmd', 'actions', 'gyro', 'proj_gravity', 'height', 'foot_contacts',
  'phase_clock', 'soft_cmd', 'skill', 'style',
];
/** Kommando-Blöcke (wie command_manager.active_terms der Originale). */
export const POLL_CMD_NAMES = ['soft_cmd', 'skill', 'style'];

/** %.3f-Komma-CSV — Format von mjlab list_to_csv_str (decimals=3). */
const csv3 = (arr) => Array.from(arr, (x) => Number(x).toFixed(3)).join(',');

/** metadata_props-Eintrag (StringStringEntryProto: key=1, value=2). */
const metaEntry = (k, v) => concatBytes([bf(1, utf8(k)), bf(2, utf8(v))]);

/**
 * Die 8 Original-Metadaten (mjlab get_base_metadata-Reihenfolge) mit ECHTEN
 * Werten unseres Microduck-Policies. meta-Overrides (feld.js):
 *   { defaultJointPos, actionScale, runPath }
 */
export function buildPollenMeta(net, meta = {}) {
  const djp = meta.defaultJointPos && meta.defaultJointPos.length === net.actDim
    ? meta.defaultJointPos : POLL_DEFAULT_POS;
  const actScale = meta.actionScale != null ? Number(meta.actionScale) : 0.35;
  return [
    ['run_path', meta.runPath != null ? String(meta.runPath) : 'None'],
    ['joint_names', POLL_JOINTS.join(',')],
    ['joint_stiffness', csv3(new Array(net.actDim).fill(POLL_STIFFNESS))],
    ['joint_damping', csv3(new Array(net.actDim).fill(POLL_DAMPING))],
    ['default_joint_pos', csv3(djp)],
    ['command_names', POLL_CMD_NAMES.join(',')],
    ['observation_names', POLL_OBS_NAMES.join(',')],
    ['action_scale', actScale.toFixed(3)],
  ];
}

/**
 * manifest.json (Pollen policy-manifest schema 2) — kommt ALS DATEI neben
 * das .onnx (die Originale fahren als policy.onnx + manifest.json):
 * robotctl/Playground lesen obs_len/action_len/robot.model daraus.
 */
export function buildManifest(net, meta = {}) {
  return {
    schema_version: 2,
    model_api: 1, // Feed-Forward (LSTM wäre 2)
    obs_len: net.obsDim,
    action_len: net.actDim,
    robot: { model: 'microduck', hw_rev: 1, servos: 'xl330', control_hz: 50 },
    name: meta.name || 'feld-policy',
    kind: 'perpetual',
    entry_pose: 'standing',
    description: 'Soft-MoE policy trained on-device in the Feld app. '
      + 'Obs/action layout: see observation_names/joint_names metadata in the ONNX file.',
    command: { encoding: 'constant', idle: [0, 0, 0] },
    training: {
      task_id: 'feld-softmoe', repo: 'Feld-App (On-Device-RL)',
      exported: new Date().toISOString(),
    },
  };
}

// ── Tensoren ───────────────────────────────────────────────
const DT = { FLOAT: 1, INT8: 3, INT64: 7, FLOAT16: 10 };

function f32ToF16Bits(f) {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = f;
  const x = new Uint32Array(buf)[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man ? 1 : 0);
  const e = exp - 127;
  if (e > 15) return sign | 0x7c00;
  if (e >= -14) {
    const round = man >>> 13;
    let h = ((e + 15) << 10) | round;
    if ((man & 0x1fff) > 0x1000 || ((man & 0x1fff) === 0x1000 && (round & 1))) h++;
    return sign | h;
  }
  if (e >= -25) {
    let m = (0x800000 | man) >>> (-e - 24);
    if (((man >>> (-e - 25)) & 1) && (m & 1)) m++;
    return sign | m;
  }
  return sign;
}

function tensor(name, dims, dataType, raw) {
  const parts = [];
  for (const d of dims) parts.push(vf(1, d));
  parts.push(vf(2, dataType));
  parts.push(bf(8, utf8(name)));
  if (raw instanceof Uint8Array) parts.push(bf(9, raw));
  return concatBytes(parts);
}
const rawF32 = (arr) => new Uint8Array(Float32Array.from(arr).buffer);
function rawF16(arr) {
  const u16 = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) u16[i] = f32ToF16Bits(arr[i]);
  return new Uint8Array(u16.buffer);
}
function quantizeInt8(arr) {
  let mx = 0;
  for (let i = 0; i < arr.length; i++) { const a = Math.abs(arr[i]); if (a > mx) mx = a; }
  const scale = mx > 0 ? mx / 127 : 1;
  const q = new Int8Array(arr.length);
  for (let i = 0; i < arr.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(arr[i] / scale)));
  return { q, scale };
}
function tensorI64(name, dims, values) {
  const parts = [];
  for (const d of dims) parts.push(vf(1, d));
  parts.push(vf(2, DT.INT64));
  parts.push(bf(8, utf8(name)));
  const inner = concatBytes(values.map((v) => varint64(v))); // packed int64_data
  parts.push(bf(7, inner));
  return concatBytes(parts);
}
function tensorScalar(name, v, dt = DT.FLOAT) {
  return tensor(name, [], dt, dt === DT.FLOAT16 ? rawF16([v]) : rawF32([v]));
}

// ── Nodes/Attrs ────────────────────────────────────────────
let nodeSeq = 0;
function node(opType, inputs, outputs, attrs = []) {
  const parts = [];
  for (const i of inputs) parts.push(bf(1, utf8(i)));
  for (const o of outputs) parts.push(bf(2, utf8(o)));
  parts.push(bf(3, utf8(opType.toLowerCase() + '_' + (++nodeSeq))));
  parts.push(bf(4, utf8(opType)));
  for (const a of attrs) parts.push(bf(5, a));
  return concatBytes(parts);
}
// AttributeProto: name=1 (bytes), i=3 (VARINT, wt0!), f=2 (fixed32, wt5!), type=20 (varint).
// i/f MÜSSEN wt0/wt5 tragen — wt2 (length-delimited) auf einem scalar-Feld
// wird von ORT stillschweigend als 0 gelesen (bytes-förmig ignoriert).
function tagFixed32(f) { return varint((f << 3) | 5); }
const attrF = (name, v) => concatBytes([bf(1, utf8(name)), concatBytes([tagFixed32(2), rawF32([v])]), vf(20, 1)]);
const attrI = (name, v) => concatBytes([bf(1, utf8(name)), vf(3, v), vf(20, 2)]);
const gemmAttrs = () => [attrF('alpha', 1), attrF('beta', 1), attrI('transA', 0), attrI('transB', 1)];
function gemm(a, b, c, out) { // c: Bias-Name oder null
  return node('Gemm', c ? [a, b, c] : [a, b], [out], gemmAttrs());
}

function valueInfo(name, elemType, dims) {
  const dimList = dims.map((d) => (d === null ? concatBytes([bf(2, utf8('N'))]) : concatBytes([vf(1, d)])));
  const shape = concatBytes(dimList.map((d) => bf(1, d)));
  const tt = concatBytes([vf(1, elemType), bf(2, shape)]);
  return concatBytes([bf(1, utf8(name)), bf(2, concatBytes([bf(1, tt)]))]);
}

/** Spalten-Slice einer row-major-Matrix [rows, cols] → [rows, c1−c0]. */
function sliceCols(w, rows, cols, c0, c1) {
  const n = c1 - c0, o = new Float32Array(rows * n);
  for (let r = 0; r < rows; r++) for (let c = c0; c < c1; c++) o[r * n + (c - c0)] = w[r * cols + c];
  return o;
}

// ── Export ─────────────────────────────────────────────────
export const EXPORT_FORMATS = ['fp32', 'fp16', 'int8'];

export function moeToOnnx(net, opts = {}) {
  nodeSeq = 0;
  const fmt = opts.format || 'fp32';
  if (!EXPORT_FORMATS.includes(fmt)) throw new Error('Unbekanntes Export-Format: ' + fmt);
  if (net.E !== 4) throw new Error('Export aktuell für 4 Experten (Standard) — gefunden: ' + net.E);
  const D = net.obsDim, A = net.actDim, E = net.E;
  const H = net.H, RH = net.RH, HL = net.HL, EL = net.EL, SL = net.SL, DH = net.DH;
  const CMD = D - 13;

  const dt = fmt === 'fp16' ? DT.FLOAT16 : DT.FLOAT;
  const pack = (arr) => (fmt === 'fp16' ? rawF16(arr) : rawF32(arr));

  const inits = [];
  const nodes = [];

  let cur = 'obs'; // Encoder-Eingang (ggf. normalisiert)
  const N = net;

  /** Bias: bleibt IMMER float (auch bei int8 — W8A32-Standard). */
  const Wb = (name, dims, arr) => {
    inits.push(tensor(name, dims, dt, pack(arr)));
    return name;
  };

  /** Gewicht (+ int8-Dequant) registrieren → Name für Gemm. */
  const W = (name, dims, arr) => {
    if (fmt === 'int8') {
      const { q, scale } = quantizeInt8(arr);
      inits.push(tensor(name, dims, DT.INT8, new Uint8Array(q.buffer.slice(0))));
      inits.push(tensorScalar(name + '_s', scale, DT.FLOAT));
      inits.push(tensor(name + '_zp', [], DT.INT8, new Uint8Array(Int8Array.from([0]).buffer)));
      nodes.push(node('DequantizeLinear', [name, name + '_s', name + '_zp'], [name + '_f']));
      return name + '_f';
    }
    inits.push(tensor(name, dims, dt, pack(arr)));
    return name;
  };

  // Normierung (Encoder liest xn, Router/Style lesen RAW — wie forward)
  if (opts.norm) {
    const mean = opts.norm.mean, std = opts.norm.std;
    inits.push(tensor('norm_mean', [1, D], dt, pack(mean)));
    inits.push(tensor('norm_std', [1, D], dt, pack(std)));
    if (fmt === 'fp16') {
      nodes.push(node('Cast', ['obs'], ['obs_h'], [attrI('to', DT.FLOAT16)]));
      nodes.push(node('Sub', ['obs_h', 'norm_mean'], ['obs_s']));
      nodes.push(node('Div', ['obs_s', 'norm_std'], ['obs_n']));
    } else {
      nodes.push(node('Sub', ['obs', 'norm_mean'], ['obs_s']));
      nodes.push(node('Div', ['obs_s', 'norm_std'], ['obs_n']));
    }
    cur = 'obs_n';
  } else if (fmt === 'fp16') {
    nodes.push(node('Cast', ['obs'], ['obs_h'], [attrI('to', DT.FLOAT16)]));
    cur = 'obs_h';
  }

  // Encoder
  const W1 = W('enc1', [H, D], N.W1);
  const b1 = Wb('enc1b', [1, H], N.b1);
  nodes.push(gemm(cur, W1, b1, 'enc1_a'), node('Tanh', ['enc1_a'], ['h1']));
  const W2 = W('enc2', [H, H], N.W2);
  const b2 = Wb('enc2b', [1, H], N.b2);
  nodes.push(gemm('h1', W2, b2, 'enc2_a'), node('Tanh', ['enc2_a'], ['h2']));

  // Router: Skill-Kommandos (RAW, reluiert — wie forward)
  const S64 = (n, v) => tensorI64(n, [1], [v]);
  inits.push(S64('sk_s', CMD + 3), S64('sk_e', CMD + 7), S64('ax1', 1), S64('st1', 1));
  nodes.push(node('Slice', ['obs', 'sk_s', 'sk_e', 'ax1', 'st1'], ['skill_raw']));
  nodes.push(node('Relu', ['skill_raw'], ['skill_f']));
  if (fmt === 'fp16') nodes.push(node('Cast', ['skill_f'], ['skill'], [attrI('to', DT.FLOAT16)]));
  else nodes.push(node('Identity', ['skill_f'], ['skill']));
  // Router L1 DISTRIBUIV (kein Concat): rh = Tanh(Wr1h·h2 + Wr1s·skill + br1)
  const Wr1h = W('rout1h', [RH, H], sliceCols(N.Wr1, RH, H + 4, 0, H));
  const Wr1s = W('rout1s', [RH, 4], sliceCols(N.Wr1, RH, H + 4, H, H + 4));
  const br1 = Wb('rout1b', [1, RH], N.br1);
  nodes.push(gemm('h2', Wr1h, null, 'rout1_h'), gemm('skill', Wr1s, null, 'rout1_s'));
  nodes.push(node('Add', ['rout1_h', 'rout1_s'], ['rout1_hs']));
  nodes.push(node('Add', ['rout1_hs', 'rout1b'], ['rout1_a']));
  nodes.push(node('Tanh', ['rout1_a'], ['rh']));
  const Wr2 = W('rout2', [E, RH], N.Wr2);
  const br2 = Wb('rout2b', [1, E], N.br2);
  nodes.push(gemm('rh', Wr2, br2, 'rlogits_pure'));
  inits.push(tensorScalar('k_eps', 0.06, dt));
  inits.push(tensorScalar('k_prior', N.kPrior, dt));
  nodes.push(node('Add', ['skill', 'k_eps'], ['skill_a']));
  nodes.push(node('Log', ['skill_a'], ['skill_l']));
  nodes.push(node('Mul', ['skill_l', 'k_prior'], ['skill_p']));
  nodes.push(node('Add', ['rlogits_pure', 'skill_p'], ['rlogits']));
  // Softmax: axis bleibt bis einschließlich opset 18 ein ATTRIBUT (das
  // axis-als-Input-Muster gilt nur für die Reduce-Ops) — [1, E] → Achse 1.
  nodes.push(node('Softmax', ['rlogits'], ['w'], [attrI('axis', 1)]));

  // Experten
  const mixParts = [];
  for (let e = 0; e < E; e++) {
    const ew1 = W('ex' + e + '1', [HL, H], N.EW1.subarray(e * HL * H, (e + 1) * HL * H));
    const eb1 = Wb('ex' + e + '1b', [1, HL], N.Eb1.subarray(e * HL, (e + 1) * HL));
    nodes.push(gemm('h2', ew1, eb1, 'ex' + e + 'a'), node('Tanh', ['ex' + e + 'a'], ['ex' + e + 'h']));
    const ew2 = W('ex' + e + '2', [EL, HL], N.EW2.subarray(e * EL * HL, (e + 1) * EL * HL));
    const eb2 = Wb('ex' + e + '2b', [1, EL], N.Eb2.subarray(e * EL, (e + 1) * EL));
    nodes.push(gemm('ex' + e + 'h', ew2, eb2, 'ex' + e + 'la'), node('Tanh', ['ex' + e + 'la'], ['ex' + e + 'l']));
    inits.push(S64('ws' + e, e), S64('we' + e, e + 1));
    nodes.push(node('Slice', ['w', 'ws' + e, 'we' + e, 'ax1', 'st1'], ['wcol' + e]));
    nodes.push(node('Mul', ['wcol' + e, 'ex' + e + 'l'], ['wmx' + e]));
    mixParts.push('wmx' + e);
  }
  nodes.push(node('Sum', mixParts, ['mix']));

  // Style
  inits.push(S64('ss_s', CMD + 7), S64('ss_e', D));
  nodes.push(node('Slice', ['obs', 'ss_s', 'ss_e', 'ax1', 'st1'], ['style_raw']));
  nodes.push(node('Relu', ['style_raw'], ['style_f']));
  if (fmt === 'fp16') nodes.push(node('Cast', ['style_f'], ['stylein'], [attrI('to', DT.FLOAT16)]));
  else nodes.push(node('Identity', ['style_f'], ['stylein']));
  const SE = W('style_e', [net.NS, SL], N.SE);
  // SE ist eine [in,out]-Embedding-Matrix (NS→SL) — hier OHNE transB:
  nodes.push(node('Gemm', ['stylein', SE], ['style'], [attrF('alpha', 1), attrF('beta', 1), attrI('transA', 0), attrI('transB', 0)]));

  // Decoder L1 DISTRIBUIV (kein Concat): Tanh(Wd1m·mix + Wd1s·style + bd1)
  const Wd1m = W('dec1m', [DH, EL], sliceCols(N.Wd1, DH, EL + SL, 0, EL));
  const Wd1s = W('dec1s', [DH, SL], sliceCols(N.Wd1, DH, EL + SL, EL, EL + SL));
  const bd1 = Wb('dec1b', [1, DH], N.bd1);
  nodes.push(gemm('mix', Wd1m, null, 'dec1_m'), gemm('style', Wd1s, null, 'dec1_s'));
  nodes.push(node('Add', ['dec1_m', 'dec1_s'], ['dec1_ms']));
  nodes.push(node('Add', ['dec1_ms', 'dec1b'], ['dec1_a']));
  nodes.push(node('Tanh', ['dec1_a'], ['dech']));
  const Wd2 = W('dec2', [A, DH], N.Wd2);
  const bd2 = Wb('dec2b', [1, A], N.bd2);
  nodes.push(gemm('dech', Wd2, bd2, 'mu_raw'));

  // Value-Kopf (optional)
  let extraOut = [];
  if (opts.valueHead) {
    const Wv = W('val', [1, H], N.Wv);
    const bv = Wb('valb', [1, 1], N.bv);
    nodes.push(gemm('h2', Wv, bv, 'val_raw'));
    extraOut = ['val'];
  }

  // Ausgänge immer float32 — v3.5.0 heißt der Hauptausgang „actions“
  // (wie bei den Pollen-Originalen; „mu“ verstand ihr Loader nicht).
  nodes.push(node('Cast', ['mu_raw'], [POLL_PROFILE.outName], [attrI('to', DT.FLOAT)]));
  if (opts.valueHead) nodes.push(node('Cast', ['val_raw'], ['val'], [attrI('to', DT.FLOAT)]));

  // v3.5.0: KEINE value_info für Zwischentensoren mehr — das Pollen-Original
  // hat auch keine, und mit FESTEN Dims ([1, D]) ist ORTs Shape-Inferenz
  // vollständig (die alte „Inferred vs Declared“-Sorge galt dynamischen Dims).
  const graph = concatBytes([
    ...nodes.map((n) => bf(1, n)),
    bf(2, utf8(POLL_PROFILE.graph)),
    ...inits.map((t) => bf(5, t)),
    bf(11, valueInfo(POLL_PROFILE.inName, DT.FLOAT, [1, D])),
    bf(12, valueInfo(POLL_PROFILE.outName, DT.FLOAT, [1, A])),
    ...(opts.valueHead ? [bf(12, valueInfo('val', DT.FLOAT, [1, 1]))] : []),
  ]);
  const opset = concatBytes([bf(1, utf8('')), vf(2, POLL_PROFILE.opset)]);
  const model = concatBytes([
    vf(1, POLL_PROFILE.ir),
    bf(2, utf8(POLL_PROFILE.producer)),
    bf(3, utf8(POLL_PROFILE.producerVer)),
    bf(7, graph),
    bf(8, opset),
    ...buildPollenMeta(net, opts.meta || {}).map(([k, v]) => bf(14, metaEntry(k, v))),
  ]);
  return {
    bytes: model, format: fmt, ops: nodes.length, params: net.paramCount(),
    outputs: [POLL_PROFILE.outName].concat(extraOut),
    meta: buildPollenMeta(net, opts.meta || {}),
  };

}

// ── onnxruntime-web (CDN + Cache) ──────────────────────────
const ORT_VERSION = '1.27.0';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist';
let _ortP = null;

async function blobUrlFor(url) {
  let bytes = null;
  try {
    const c = await caches.open('feld-ort-v1');
    const hit = await c.match(url);
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
    if (!bytes) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download fehlgeschlagen: ' + url);
      bytes = new Uint8Array(await res.arrayBuffer());
      await c.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    }
  } catch (e) {
    if (!bytes) bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  return URL.createObjectURL(new Blob([bytes], { type: url.endsWith('.mjs') ? 'text/javascript' : 'application/wasm' }));
}

export function loadOrt() {
  if (_ortP) return _ortP;
  _ortP = (async () => {
    const ortUrl = await blobUrlFor(ORT_BASE + '/ort.all.min.mjs');
    const ort = await import(/* webpackIgnore: true */ ortUrl);
    try {
      const wasmMjsUrl = await blobUrlFor(ORT_BASE + '/ort-wasm-simd-threaded.jsep.mjs');
      const wasmBinUrl = await blobUrlFor(ORT_BASE + '/ort-wasm-simd-threaded.jsep.wasm');
      ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmBinUrl };
      ort.env.wasm.numThreads = 1;
    } catch (e) { /* ort.all kümmert sich selbst um seine WASM-Pfade */ }
    return ort;
  })();
  _ortP.catch(() => { _ortP = null; });
  return _ortP;
}

export const EP_MODES = {
  auto: [{ name: 'webnn', deviceType: 'npu' }, { name: 'webnn', deviceType: 'gpu' }, 'webgpu', 'wasm'],
  cpu: ['wasm'],
  gpu: ['webgpu', 'wasm'],
  npu: [{ name: 'webnn', deviceType: 'npu' }, { name: 'webnn', deviceType: 'gpu' }, 'webgpu', 'wasm'],
};

/**
 * v3.4.0: LATENZ-PROBE — Winz-Netze (diese Policy) laufen auf NPU/GPU oft
 * LANGSAMER als auf der CPU, weil der Dispatch-Roundtrip je Aufruf dominiert
 * (WebNN/WebGPU: 10–60 ms je run() → Befehle kommen in Schüben = ruckartig,
 * während die Physik weiterläuft). Deshalb: nach dem Session-Bau 2 Warm-ups
 * (Kernel-Kompilierung/Allocator) + 3 gemessene Läufe → Median. Über Budget
 * → nächster Provider der Kette. Liefert {ms} mit zurück.
 */
async function probeMs(session, ort, dim, runs = 3) {
  const run1 = async () => {
    const t0 = performance.now();
    await session.run({ obs: new ort.Tensor('float32', new Float32Array(dim), [1, dim]) });
    return performance.now() - t0;
  };
  await run1(); await run1(); // Warm-up: erstes run() kompiliert/allocationiert
  const xs = [];
  for (let i = 0; i < runs; i++) xs.push(await run1());
  xs.sort((a, b) => a - b);
  return xs[Math.floor(runs / 2)];
}
const epLabel = (ep) => (typeof ep === 'string' ? ep : ep.name + ':' + ep.deviceType);

/**
 * ONNX-Session mit EP-Fallback-Kette + LATENZ-AUSWAHL.
 * @param opts { warmDim, budgetMs } — warmDim = Obs-Dimension (aktiviert die
 *   Probe); budgetMs = Zielzeit je Inferenz (Default 8 ms, Regelzyklus 20 ms).
 *   Trifft KEIN Provider das Budget, wird der SCHNELLESTE trotzdem geliefert.
 */
export async function createSession(onnxBytes, epMode = 'auto', ort = null, opts = {}) {
  ort = ort || (await loadOrt());
  const chain = EP_MODES[epMode] || EP_MODES.auto;
  const budgetMs = opts.budgetMs || 8;
  const dim = opts.warmDim | 0;
  let lastErr = null, lastOk = null;
  for (const ep of chain) {
    try {
      const session = await ort.InferenceSession.create(new Uint8Array(onnxBytes), { executionProviders: [ep], graphOptimizationLevel: 'all' });
      const ms = dim > 0 ? await probeMs(session, ort, dim) : -1;
      const cand = { session, ep: epLabel(ep), ort, ms };
      if (ms < 0 || ms <= budgetMs) return cand; // schnell genug (oder ungemessen)
      lastOk = cand; // zu langsam — gemerkt, Kette weiterprobieren
    } catch (e) { lastErr = e; }
  }
  if (lastOk) return lastOk; // alles über Budget → schnellster gefunden läuft trotzdem
  throw new Error('Kein Execution-Provider verfügbar: ' + (lastErr ? lastErr.message : ''));
}

/**
 * SELBSTTEST: Parität ONNX ↔ JS-Forward (auf Roh-Obs, ohne Norm).
 * @returns {maxDiff, meanDiff, n}
 */
export async function selfTest(net, epMode = 'cpu', opts = {}) {
  const { bytes } = moeToOnnx(net, Object.assign({ format: 'fp32', valueHead: false }, opts));
  const { session, ort } = await createSession(bytes, epMode);
  const D = net.obsDim;
  const raw = new Float32Array(D);
  for (let i = 0; i < D; i++) raw[i] = (Math.random() * 2 - 1) * 0.3;
  raw[D - 13] = 0.1;   // vx
  raw[D - 13 + 3] = 1; // skill balance
  raw[D - 13 + 7] = 1; // style neutral
  const mu = net.forward(raw, raw).slice();
  const t = new ort.Tensor('float32', Float32Array.from(raw), [1, D]);
  const out = await session.run({ obs: t });
  const onnxMu = Array.from(out[POLL_PROFILE.outName].data);
  let mx = 0, sum = 0;
  for (let i = 0; i < onnxMu.length; i++) {
    const d = Math.abs(onnxMu[i] - mu[i]);
    if (d > mx) mx = d;
    sum += d;
  }
  return { maxDiff: mx, meanDiff: sum / onnxMu.length, n: onnxMu.length };
}
