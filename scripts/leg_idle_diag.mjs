// leg_idle_diag.mjs — Bein-Diagnose mit GERADEM Lehrer-Bein (Idle-Stand).
// Misst je Seite: laterale Winkel (Frontalebene) von Oberschenkel (OS) und
// Schienbein (SB) im G1-Geist nach dem Retargeting + Hüft-Gelenkzeilen.
// Erwartung (v2.6.1-Ziel): OS ~±9° nach AUßEN, SB ~0° (vertikal) = natürlicher
// G1-A-Stand, symmetrisch links/rechts.  Usage: node scripts/leg_idle_diag.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('file:')) {
    const p = path.resolve(WWW, decodeURIComponent(url.split('?')[0]));
    const buf = await readFile(p);
    return {
      ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8'),
    };
  }
  return realFetch(url);
};

const enginePath = path.join(WWW, 'js/engine.js');
const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, fetchModelIntoFS, RobotSim } = await import(enginePath);
await initEngine(() => {}, { wasmBinary });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/unitree_g1');
const sim = new RobotSim(cfg, cfg.scene);

const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));

function quatAxis(axis, deg) {
  const a = deg * Math.PI / 180, s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
function packGlb(gltf, bin) {
  const enc = new TextEncoder();
  let jsonStr = JSON.stringify(gltf);
  jsonStr += ' '.repeat((4 - enc.encode(jsonStr).length % 4) % 4);
  const jsonBytes = enc.encode(jsonStr);
  const binPad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length + binPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, bin.length + binPad, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  u8.set(bin, binOff + 8);
  return out;
}
// Statischer Idle: ALLE Gelenke Identität — Beine perfekt gerade nach unten,
// Füße flach. Das ist der „straight leg"-Fall, für den die Valgus-Regel gilt.
function buildIdleClip({ duration = 2.0, fps = 30 } = {}) {
  const defs = [];
  const add = (name, parent, translation) => { defs.push({ name, parent, translation }); return defs.length - 1; };
  const hips = add('mixamorig:Hips', -1, [0, 95, 0]);
  add('mixamorig:Spine', hips, [0, 10, 0]);
  add('mixamorig:Neck', 1, [0, 22, 0]);
  add('mixamorig:Head', 2, [0, 10, 0]);
  add('mixamorig:LeftArm', 1, [-14, 18, 0]);
  add('mixamorig:LeftForeArm', 4, [-26, 0, 0]);
  add('mixamorig:RightArm', 1, [14, 18, 0]);
  add('mixamorig:RightForeArm', 6, [26, 0, 0]);
  const lul = add('mixamorig:LeftUpLeg', hips, [-9, -6, 0]);
  add('mixamorig:LeftLeg', lul, [0, -44, 0]);
  add('mixamorig:LeftFoot', 9, [0, -42, 0]);
  const rul = add('mixamorig:RightUpLeg', hips, [9, -6, 0]);
  add('mixamorig:RightLeg', rul, [0, -44, 0]);
  add('mixamorig:RightFoot', 12, [0, -42, 0]);
  const K = Math.round(duration * fps) + 1;
  const samplers = [], channels = [];
  const track = (node, comp) => {
    const times = new Float32Array(K);
    for (let k = 0; k < K; k++) times[k] = k / fps;
    const s = { _times: times, _output: new Float32Array(K * comp), _comp: comp, interpolation: 'LINEAR' };
    samplers.push(s);
    channels.push({ sampler: samplers.length - 1, target: { node, path: comp === 4 ? 'rotation' : 'translation' } });
    // WICHTIG: konstante Tracks müssen die STATIC-Werte der Node tragen —
    // ein Animations-Track ÜBERSCHREIBT die Node-Translation! Nullen würden
    // das Skelett zusammenfallen lassen (Richtung = 0-Vektor → kein Ziel).
    if (comp === 3) {
      const t = defs[node].translation || [0, 0, 0];
      for (let k = 0; k < K; k++) { s._output[k * 3] = t[0]; s._output[k * 3 + 1] = t[1]; s._output[k * 3 + 2] = t[2]; }
    }
    return s._output;
  };
  for (let i = 0; i < defs.length; i++) { track(i, 3); track(i, 4); }
  const accessors = [], bufferViews = [], binChunks = [];
  let off = 0;
  const binFor = (s) => {
    const bytes = new Uint8Array(s._output.buffer, s._output.byteOffset, s._output.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    off += bytes.length;
    s.output = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: s._comp === 3 ? 'VEC3' : 'VEC4' });
    const tb = new Uint8Array(s._times.buffer, s._times.byteOffset, s._times.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(tb);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: tb.length });
    off += tb.length;
    s.input = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: 'SCALAR' });
  };
  samplers.forEach(binFor);
  const bin = Buffer.concat(binChunks);
  defs.forEach((nd, i) => { const ch = []; defs.forEach((m, j) => { if (m.parent === i) ch.push(j); }); if (ch.length) nd.children = ch; });
  return packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: defs,
    animations: [{ name: 'Idle', samplers: samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  }, bin);
}

const ab = buildIdleClip({});
const clip = new GlbClip(ab);
const motion = retargetToG1(clip, sim, () => {});
const { q, n, nu, baseQ } = motion;

const bodyOfAct = (name) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[name]]];
const ghost = sim.makeGhostData();
const B = {};
for (const side of ['left', 'right']) {
  B[side] = {
    hip: bodyOfAct(side + '_hip_pitch_joint'),
    knee: bodyOfAct(side + '_knee_joint'),
    ankle: bodyOfAct(side + '_ankle_pitch_joint'),
    foot: bodyOfAct(side + '_ankle_roll_joint'),
  };
}
const gpos = (b, out) => { out[0] = ghost.xpos[3 * b]; out[1] = ghost.xpos[3 * b + 1]; out[2] = ghost.xpos[3 * b + 2]; return out; };
const latAngDeg = (v) => Math.atan2(v[1], -v[2]) * 180 / Math.PI;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const stats = {};
const acc = (k, v) => { (stats[k] || (stats[k] = [])).push(v); };
const ji = (nm) => sim.actByName[nm];

for (let f = 0; f < n; f++) {
  sim.setGhostPose(ghost, q, f * nu, motion.h[f], 0, 0, 0, [baseQ[4 * f], baseQ[4 * f + 1], baseQ[4 * f + 2], baseQ[4 * f + 3]]);
  for (const side of ['left', 'right']) {
    const pA = [0, 0, 0], pB = [0, 0, 0], pC = [0, 0, 0], pD = [0, 0, 0];
    gpos(B[side].hip, pA); gpos(B[side].knee, pB); gpos(B[side].ankle, pC); gpos(B[side].foot, pD);
    const dThigh = norm([pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]]);
    const dShin = norm([pC[0] - pB[0], pC[1] - pB[1], pC[2] - pB[2]]);
    acc(side + '_thighLat', latAngDeg(dThigh));
    acc(side + '_shinLat', latAngDeg(dShin));
    acc(side + '_ankleY', pC[1]);
    for (const nm of ['_hip_yaw_joint', '_hip_roll_joint', '_hip_pitch_joint', '_knee_joint', '_ankle_roll_joint']) {
      acc(side + nm, q[f * nu + ji(side + nm)]);
    }
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const f2 = (v) => v.toFixed(2);
console.log(`\n═══ Gerades-Lehrer-Bein (Idle) — G1-Geist, n=${n} ═══`);
for (const side of ['left', 'right']) {
  console.log(`${side.toUpperCase()}:`);
  console.log(`  OS lateral: ${f2(mean(stats[side + '_thighLat']))}°  (+ = nach außen)`);
  console.log(`  SB lateral: ${f2(mean(stats[side + '_shinLat']))}°  (+ = nach außen; 0 = vertikal)`);
  console.log(`  Knöchel y:  ${f2(mean(stats[side + '_ankleY']))} m`);
  console.log(`  hip_yaw ⌀ ${f2(mean(stats[side + '_hip_yaw_joint']))}  hip_roll ⌀ ${f2(mean(stats[side + '_hip_roll_joint']))}  hip_pitch ⌀ ${f2(mean(stats[side + '_hip_pitch_joint']))}  knee ⌀ ${f2(mean(stats[side + '_knee_joint']))}  ankle_roll ⌀ ${f2(mean(stats[side + '_ankle_roll_joint']))}`);
}
const lt = mean(stats.left_thighLat), rt = mean(stats.right_thighLat);
const ls = mean(stats.left_shinLat), rs = mean(stats.right_shinLat);
console.log(`\nSymmetrie: |OS_L − (−OS_R)| = ${f2(Math.abs(lt - (-rt)))}°  |SB_L − (−SB_R)| = ${f2(Math.abs(ls - (-rs)))}°`);
console.log(`Ziel (v2.6.1): OS_L ≈ +9° außen, OS_R ≈ −9° außen, SB beide ≈ 0° (natürlicher A-Stand)`);
