// elbow_debug.mjs — f=0..4 Schulter/Ellbogen-Timeline des synthetischen Idles
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
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/unitree_g1');
const sim = new RobotSim(cfg, cfg.scene);
const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));

// synthetisches Idle aus glb_diag.mjs nachbauen (T-Pose-Rest, Arme ±6° X)
function quatAxis(axis, deg) {
  const a = deg * Math.PI / 180, s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
function synthSkeleton() {
  const defs = [];
  const add = (name, parent, translation, rotation) => { defs.push({ name, parent, translation, rotation }); return defs.length - 1; };
  const H = 95;
  const hips = add('mixamorig:Hips', -1, [0, H, 0]);
  const spine = add('mixamorig:Spine', hips, [0, 10, 0]);
  const neck = add('mixamorig:Neck', spine, [0, 22, 0]);
  add('mixamorig:Head', neck, [0, 10, 0]);
  const larm = add('mixamorig:LeftArm', spine, [-14, 18, 0]);
  add('mixamorig:LeftForeArm', larm, [-26, 0, 0]);
  const rarm = add('mixamorig:RightArm', spine, [14, 18, 0]);
  add('mixamorig:RightForeArm', rarm, [26, 0, 0]);
  const lul = add('mixamorig:LeftUpLeg', hips, [-9, -6, 0]);
  add('mixamorig:LeftLeg', lul, [0, -44, 0]);
  add('mixamorig:LeftFoot', 9, [0, -42, 0]);
  const rul = add('mixamorig:RightUpLeg', hips, [9, -6, 0]);
  add('mixamorig:RightLeg', rul, [0, -44, 0]);
  add('mixamorig:RightFoot', 12, [0, -42, 0]);
  return defs;
}
function buildGlb(nodeDefs, anim, name) {
  // identisch zu glb_diag.mjs (vereinfacht übernommen)
  const accessors = [], bufferViews = [], binChunks = [];
  let off = 0;
  for (const s of anim.samplers) {
    const comp = s._comp;
    const bytes = new Uint8Array(s._output.buffer, s._output.byteOffset, s._output.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    off += bytes.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: comp === 3 ? 'VEC3' : 'VEC4' });
    s.output = accessors.length - 1;
    const tb = new Uint8Array(s._times.buffer, s._times.byteOffset, s._times.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(tb);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: tb.length });
    off += tb.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: 'SCALAR' });
    s.input = accessors.length - 1;
  }
  const bin = Buffer.concat(binChunks);
  const nodes = nodeDefs.map((n) => { const o = { name: n.name }; if (n.translation) o.translation = n.translation; if (n.rotation) o.rotation = n.rotation; return o; });
  nodeDefs.forEach((n, i) => {
    const ch = [];
    nodeDefs.forEach((m, j) => { if (m.parent === i) ch.push(j); });
    if (ch.length) nodes[i].children = ch;
  });
  const gltf = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes,
    animations: [{ name, samplers: anim.samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels: anim.channels }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
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

const duration = 1.33, fps = 30;
const defs = synthSkeleton();
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
const hipsT = track(0, 3), hipsR = track(0, 4);
const armL = track(4, 4), armR = track(6, 4), foreL = track(5, 4), foreR = track(7, 4);
const spine = track(1, 4), head = track(3, 4);
for (let k = 0; k < K; k++) {
  const t = k / fps;
  const sway = 4 * Math.sin(2 * Math.PI * t / duration) + 2.5 * Math.sin(2 * Math.PI * 2.7 * t / duration + 0.7);
  const bob = 1.2 * Math.sin(2 * Math.PI * 3.1 * t / duration + 0.3);
  hipsR.set(quatAxis([0, 1, 0], sway), k * 4);
  hipsT.set([0.8 * Math.sin(2 * Math.PI * t / duration), 95 + bob, 0], k * 3);
  spine.set(quatAxis([0, 1, 0], -0.6 * sway), k * 4);
  head.set(quatAxis([0, 1, 0], -0.3 * sway), k * 4);
  armL.set(quatAxis([1, 0, 0], 3 * Math.sin(2 * Math.PI * t / duration)), k * 4);
  armR.set(quatAxis([1, 0, 0], -3 * Math.sin(2 * Math.PI * t / duration)), k * 4);
}
const buf = buildGlb(defs, { samplers, channels }, 'Idle_sway');

const clip = new GlbClip(buf);
const motion = retargetToG1(clip, sim, (m) => console.log('  ' + m));
const names = sim.actName;
const watch = ['left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint',
  'right_shoulder_pitch_joint', 'right_elbow_joint', 'left_hip_pitch_joint', 'left_knee_joint'];
console.log('\nFrame-Timelines (rad):');
console.log('frame | ' + watch.map(n2 => n2.replace('_joint', '').padStart(11)).join(' | '));
for (let f = 18; f < 28 && f < motion.n; f++) {
  const row = watch.map(n2 => motion.q[f * motion.nu + sim.actByName[n2]].toFixed(3).padStart(11));
  console.log(String(f).padStart(5) + ' | ' + row.join(' | '));
}
