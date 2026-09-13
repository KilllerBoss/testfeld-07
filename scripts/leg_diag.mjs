// leg_diag.mjs — Quantitative Bein-Diagnose: Lehrer (GLB) vs. G1-Geist (Retarget)
// Usage: node scripts/leg_diag.mjs <glb-file> [animIndex]
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

const glbPath = process.argv[2];
const animIdx = parseInt(process.argv[3] || '0', 10);

// ── Synthetischer March-Clip (falls kein GLB-Argument) ──
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
function buildMarchClip({ duration = 2.4, fps = 30 } = {}) {
  // Mixamo-artiges Skelett, Beine deutlich bewegt: Knie 55° gebeugt,
  // Oberschenkel abwechselnd 35° angehoben (X-Rotation = Sagittal)
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
  const channels = [], samplers = [];
  const track = (node, comp) => {
    const times = new Float32Array(K);
    for (let k = 0; k < K; k++) times[k] = k / fps;
    const s = { _times: times, _output: new Float32Array(K * comp), _comp: comp, interpolation: 'LINEAR' };
    samplers.push(s);
    channels.push({ sampler: samplers.length - 1, target: { node, path: comp === 4 ? 'rotation' : 'translation' } });
    return s._output;
  };
  const hipsT = track(0, 3), uLegL = track(8, 4), uLegR = track(11, 4);
  const legL = track(9, 4), legR = track(12, 4), footL = track(10, 4), footR = track(13, 4);
  for (let k = 0; k < K; k++) {
    const t = k / fps, w = 2 * Math.PI * t / (duration / 2);
    const s = Math.sin(w); // +1 = links oben
    const liftL = Math.max(0, s), liftR = Math.max(0, -s);
    uLegL.set(quatAxis([1, 0, 0], 35 * liftL - 5), k * 4);
    uLegR.set(quatAxis([1, 0, 0], 35 * liftR - 5), k * 4);
    legL.set(quatAxis([1, 0, 0], 55 * liftL), k * 4);
    legR.set(quatAxis([1, 0, 0], 55 * liftR), k * 4);
    footL.set(quatAxis([1, 0, 0], -20 * liftL), k * 4);
    footR.set(quatAxis([1, 0, 0], -20 * liftR), k * 4);
    hipsT.set([0, 95 - 4 * (liftL + liftR), 0], k * 3);
  }
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
  const ab = packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: defs,
    animations: [{ name: 'March', samplers: samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  }, bin);
  return ab;
}

let ab, label;
if (glbPath) {
  const fb = await readFile(glbPath);
  ab = fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength);
  label = path.basename(glbPath) + (animIdx ? ' anim#' + animIdx : '');
} else {
  ab = buildMarchClip({});
  label = 'SYNTH March (Knie 55°, OS-Lift 35°)';
}
const clip = new GlbClip(ab);
if (glbPath) console.log(`GLB: ${path.basename(glbPath)} — ${clip.animations.length} Animation(en): ${clip.animations.map(a => `${a.name}(${a.duration.toFixed(2)}s,#${a.index})`).join(', ')}`);
if (animIdx > 0) clip.useAnimation(animIdx);
const motion = retargetToG1(clip, sim, (m) => { if (!/Retargeting/.test(m)) console.log('  ' + m); });

const { q, h, n, nu, baseQ, yaw, srcPos, srcJoints } = motion;
const ji = (nm) => sim.actByName[nm];
const gidx = {};
srcJoints.forEach((r, i) => { gidx[r] = i; });

const worst = {};
const ghost = sim.makeGhostData();
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const rotZ = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; };
const angDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180 / Math.PI;

// G1-Körper
const bodyOfAct = (name) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[name]]];
const B = {};
for (const side of ['left', 'right']) {
  B[side] = {
    hip: bodyOfAct(side + '_hip_pitch_joint'),
    knee: bodyOfAct(side + '_knee_joint'),
    ankle: bodyOfAct(side + '_ankle_pitch_joint'),
  };
}
const gpos = (b, out) => { out[0] = ghost.xpos[3 * b]; out[1] = ghost.xpos[3 * b + 1]; out[2] = ghost.xpos[3 * b + 2]; return out; };

const stats = {};
const acc = (key, v) => { (stats[key] || (stats[key] = [])).push(v); };
const teacherKnee = { left: [], right: [] }; // Lehrer-Kniebeuge (Winkel OS↔SB)
const g1Knee = { left: [], right: [] };

for (let f = 0; f < n; f++) {
  sim.setGhostPose(ghost, q, f * nu, h[f], 0, 0, 0, [baseQ[4 * f], baseQ[4 * f + 1], baseQ[4 * f + 2], baseQ[4 * f + 3]]);
  const dy = -yaw[f];
  for (const side of ['left', 'right']) {
    // Lehrer-Richtungen (srcPos: Welt in MJC-Rahmen, yaw noch drin) → ent-yawt
    const pU = [srcPos[(f * srcJoints.length + gidx[side + 'UpLeg']) * 3], srcPos[(f * srcJoints.length + gidx[side + 'UpLeg']) * 3 + 1], srcPos[(f * srcJoints.length + gidx[side + 'UpLeg']) * 3 + 2]];
    const pL = [srcPos[(f * srcJoints.length + gidx[side + 'Leg']) * 3], srcPos[(f * srcJoints.length + gidx[side + 'Leg']) * 3 + 1], srcPos[(f * srcJoints.length + gidx[side + 'Leg']) * 3 + 2]];
    const pF = [srcPos[(f * srcJoints.length + gidx[side + 'Foot']) * 3], srcPos[(f * srcJoints.length + gidx[side + 'Foot']) * 3 + 1], srcPos[(f * srcJoints.length + gidx[side + 'Foot']) * 3 + 2]];
    if (pU.some(Number.isNaN) || pL.some(Number.isNaN) || pF.some(Number.isNaN)) continue;
    const dThighT = norm(rotZ([pL[0] - pU[0], pL[1] - pU[1], pL[2] - pU[2]], dy));
    const dShinT = norm(rotZ([pF[0] - pL[0], pF[1] - pL[1], pF[2] - pL[2]], dy));
    // G1-Geist-Richtungen
    const pA = [0, 0, 0], pB = [0, 0, 0], pC = [0, 0, 0];
    gpos(B[side].hip, pA); gpos(B[side].knee, pB); gpos(B[side].ankle, pC);
    const dThighG = norm([pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]]);
    const dShinG = norm([pC[0] - pB[0], pC[1] - pB[1], pC[2] - pB[2]]);
    acc(side + '_thigh', angDeg(dThighG, dThighT));
    acc(side + '_shin', angDeg(dShinG, dShinT));
    if (!worst[side] || angDeg(dShinG, dShinT) > worst[side].v) worst[side] = { f, v: angDeg(dShinG, dShinT), dThighT, dShinT, dThighG, dShinG };
    // Lehrer-Kniebeuge (Winkel zwischen OS und SB; 180° = gestreckt)
    teacherKnee[side].push(angDeg(dThighT, dShinT));
    g1Knee[side].push(Math.abs(q[f * nu + ji(side + '_knee_joint')]) * 180 / Math.PI);
  }
}

const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const report = (key) => {
  const a = stats[key];
  if (!a || !a.length) return 'n/a';
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return `mean=${mean.toFixed(1)}° p50=${pct(a, 0.5).toFixed(1)}° p95=${pct(a, 0.95).toFixed(1)}° max=${Math.max(...a).toFixed(1)}°`;
};

console.log(`\n═══ Bein-Abweichung Lehrer→G1 (${label}, n=${n}) ═══`);
for (const side of ['left', 'right']) {
  console.log(`${side.toUpperCase()}: OS-Richtung  ${report(side + '_thigh')}`);
  console.log(`${' '.repeat(side.length)}  SB-Richtung  ${report(side + '_shin')}`);
  const tk = teacherKnee[side], gk = g1Knee[side];
  const tm = tk.reduce((x, y) => x + y, 0) / tk.length;
  const gm = gk.reduce((x, y) => x + y, 0) / gk.length;
  console.log(`     Kniebeuge: Lehrer ⌀ ${tm.toFixed(1)}° (Beugewinkel OS↔SB: 180°=gestreckt) | G1 knee ⌀ ${gm.toFixed(1)}° | Range G1 [${Math.min(...gk).toFixed(1)}°, ${Math.max(...gk).toFixed(1)}°]`);
}
// Gelenk-Zeitreihen (kurz) für die Beine
console.log('\nG1-Beingelenke ⌀ / min / max (rad):');
for (const nm of ['left_hip_pitch_joint', 'left_hip_roll_joint', 'left_hip_yaw_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint', 'right_hip_pitch_joint', 'right_hip_roll_joint', 'right_hip_yaw_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint']) {
  const a = ji(nm);
  if (a === undefined) continue;
  let mn = Infinity, mx = -Infinity, s = 0;
  for (let f = 0; f < n; f++) { const v = q[f * nu + a]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
  console.log(`  ${nm.padEnd(26)} ⌀${(s / n).toFixed(2).padStart(6)}  [${mn.toFixed(2)}, ${mx.toFixed(2)}]`);
}
// Erste Frames der Kniebeuge im Detail (Detektion: G1 streckt vs. Lehrer gebeugt)
console.log('\nKniebeuge-Kurven (erste 20 Frames, °):');
console.log('  f | Lehrer L/R      | G1-knee L/R');
for (let f = 0; f < Math.min(20, n); f++) {
  console.log(`  ${String(f).padStart(2)} | ${teacherKnee.left[f].toFixed(0).padStart(4)}/${teacherKnee.right[f].toFixed(0).padStart(4)}        | ${(g1Knee.left[f]).toFixed(0).padStart(4)}/${(g1Knee.right[f]).toFixed(0).padStart(4)}`);
}
console.log(`\nSchlechtester SB-Frame je Seite:`);
for (const side of ['left', 'right']) {
  const w = worst[side];
  if (!w) continue;
  console.log(`  ${side}: f=${w.f} err=${w.v.toFixed(1)}°  dThighT=[${w.dThighT.map(v=>v.toFixed(2))}] dThighG=[${w.dThighG.map(v=>v.toFixed(2))}]`);
  console.log(`  ${' '.repeat(side.length)}  dShinT=[${w.dShinT.map(v=>v.toFixed(2))}] dShinG=[${w.dShinG.map(v=>v.toFixed(2))}]  kneeT(p50-Frame)≈?`);
}
// Frame 0: Richtungs-Vektoren im Detail (wo genau liegt der Schien-Fehler?)
sim.setGhostPose(ghost, q, 0, h[0], 0, 0, 0, [baseQ[0], baseQ[1], baseQ[2], baseQ[3]]);
const dy0 = -yaw[0];
for (const side of ['left', 'right']) {
  const gi = { UpLeg: gidx[side + 'UpLeg'], Leg: gidx[side + 'Leg'], Foot: gidx[side + 'Foot'] };
  const gv = (r) => [srcPos[gi[r] * 3], srcPos[gi[r] * 3 + 1], srcPos[gi[r] * 3 + 2]];
  const pU = gv('UpLeg'), pL = gv('Leg'), pF = gv('Foot');
  const dThighT = norm(rotZ([pL[0] - pU[0], pL[1] - pU[1], pL[2] - pU[2]], dy0));
  const dShinT = norm(rotZ([pF[0] - pL[0], pF[1] - pL[1], pF[2] - pL[2]], dy0));
  const pA = [0, 0, 0], pB = [0, 0, 0], pC = [0, 0, 0];
  gpos(B[side].hip, pA); gpos(B[side].knee, pB); gpos(B[side].ankle, pC);
  const dThighG = norm([pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]]);
  const dShinG = norm([pC[0] - pB[0], pC[1] - pB[1], pC[2] - pB[2]]);
  console.log(`\nf0 ${side}:`);
  console.log(`  OS Lehrer=[${dThighT.map(v => v.toFixed(2))}] G1=[${dThighG.map(v => v.toFixed(2))}]  (MJC: x=vorn, y=links, z=hoch)`);
  console.log(`  SB Lehrer=[${dShinT.map(v => v.toFixed(2))}] G1=[${dShinG.map(v => v.toFixed(2))}]`);
}
