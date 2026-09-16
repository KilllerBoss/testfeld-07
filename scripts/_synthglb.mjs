import { Buffer } from "node:buffer";
// ── Synthetische GLB-Builds (Mixamo-artig, cm, Y-up) ─────────────
export function quatAxis(axis, deg) {
  const a = deg * Math.PI / 180, s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
export function synthSkeleton() {
  const defs = [];
  const add = (name, parent, translation) => { defs.push({ name, parent, translation }); return defs.length - 1; };
  const hips = add('mixamorig:Hips', -1, [0, 95, 0]);
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
export function buildGlb(nodeDefs, anim, name) {
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
  const nodes = nodeDefs.map((n) => { const o = { name: n.name }; if (n.translation) o.translation = n.translation; return o; });
  nodeDefs.forEach((n, i) => {
    const ch = [];
    nodeDefs.forEach((m, j) => { if (m.parent === i) ch.push(j); });
    if (ch.length) nodes[i].children = ch;
  });
  const gltf = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }], scene: 0,
    nodes,
    animations: [{ name, samplers: anim.samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels: anim.channels }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  };
  return packGlb(gltf, bin);
}
export function packGlb(gltf, bin) {
  const enc = new TextEncoder();
  const jsonB = enc.encode(JSON.stringify(gltf));
  const pad4 = (n) => (4 - (n % 4)) % 4;
  const jPad = pad4(jsonB.length), bPad = pad4(bin.length);
  const total = 12 + 8 + jsonB.length + jPad + 8 + bin.length + bPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonB.length + jPad, true);
  dv.setUint32(16, 0x4E4F534A, true);
  u8.set(jsonB, 20);
  for (let i = 0; i < jPad; i++) u8[20 + jsonB.length + i] = 0x20; // GLB: JSON-Padding = Space
  const boff = 20 + jsonB.length + jPad;
  dv.setUint32(boff, bin.length + bPad, true);
  dv.setUint32(boff + 4, 0x004E4942, true);
  u8.set(bin, boff + 8);
  return out;
}
export function walkClip({ duration = 2.4, fps = 30 } = {}) {
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
  const uLegL = track(8, 4), uLegR = track(11, 4), legL = track(9, 4), legR = track(12, 4);
  const armL = track(4, 4), armR = track(6, 4);
  const spd = 1.2;
  for (let k = 0; k < K; k++) {
    const t = k / fps, w = 2 * Math.PI * t / (duration / 2);
    const s = Math.sin(w), c = Math.cos(w);
    hipsR.set(quatAxis([1, 0, 0], 4 * s), k * 4);
    hipsT.set([0, 95 + 2.5 * Math.abs(c), t * spd * 100], k * 3);
    uLegL.set(quatAxis([1, 0, 0], 28 * s - 5), k * 4);
    uLegR.set(quatAxis([1, 0, 0], -28 * s - 5), k * 4);
    legL.set(quatAxis([1, 0, 0], Math.max(0, 42 * -s)), k * 4);
    legR.set(quatAxis([1, 0, 0], Math.max(0, 42 * s)), k * 4);
    armL.set(quatAxis([1, 0, 0], -24 * s), k * 4);
    armR.set(quatAxis([1, 0, 0], 24 * s), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Walk_synth');
}

