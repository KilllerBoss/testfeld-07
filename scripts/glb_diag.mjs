// glb_diag.mjs — Repro-Harness für „Zucken/Kicken + komplette Drehungen"
// am G1-Retargeting. Läuft in Node mit ECHTEM MuJoCo-WASM.
// Usage: node scripts/glb_diag.mjs <glb-file> [animIndex]
//        node scripts/glb_diag.mjs            (synthetische Clips)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

// ── fetch-Shim für relative URLs (Node hat kein file://-fetch) ──
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

// ── Engine + Roboter ──
const enginePath = path.join(WWW, 'js/engine.js');
const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, fetchModelIntoFS, RobotSim } = await import(enginePath);
await initEngine(() => {}, { wasmBinary });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/unitree_g1');
const sim = new RobotSim(cfg, cfg.scene);
console.log(`G1 geladen: nu=${sim.nu} nq=${sim.nq} nbody=${sim.nbody} timestep=${sim.timestep}`);

// ── GLB + Retargeting ──
const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));
const { quatRot: quatRotGlb } = await import(path.join(WWW, 'js/glb.js'));

const log = (m) => console.log('  ' + m);

function analyze(name, motion) {
  const { q, h, n, nu, yaw, root, baseQ, fps } = motion;
  console.log(`\n═══ ${name}: n=${n} fps=${fps} nu=${nu} ═══`);
  const jointNames = sim.actName;
  const deltas = new Float32Array(nu);
  let maxD = 0, maxJ = -1, maxF = -1;
  const spikes = [];
  for (let f = 1; f < n; f++) {
    for (let j = 0; j < nu; j++) {
      const d = Math.abs(q[f * nu + j] - q[(f - 1) * nu + j]);
      if (d > deltas[j]) deltas[j] = d;
      if (d > maxD) { maxD = d; maxJ = j; maxF = f; }
      if (d > 0.5) spikes.push({ f, j: jointNames[j], d: +(d.toFixed(2)) });
    }
  }
  const top = [...deltas.keys()].sort((a, b) => deltas[b] - deltas[a]).slice(0, 8);
  console.log('Max-Δ je Gelenk (Top 8, rad/Frame):');
  for (const j of top) console.log(`  ${jointNames[j].padEnd(28)} ${deltas[j].toFixed(3)}`);
  console.log(`Größter Spike: ${jointNames[maxJ]} f=${maxF} Δ=${maxD.toFixed(2)} rad`);
  console.log(`Spikes >0,5 rad/Frame: ${spikes.length}${spikes.length ? ' → ' + spikes.slice(0, 12).map(s => `${s.j}@${s.f}:${s.d}`).join(', ') : ''}`);
  // Zeitreihe des schlimmsten Gelenks (Diagnose)
  if (process.env.SERIES && maxJ >= 0) {
    const row = [];
    for (let f = 0; f < n; f++) row.push(`${f}:${q[maxF !== undefined ? f * nu + maxJ : 0].toFixed(2)}`);
    console.log(`Zeitreihe ${jointNames[maxJ]}: ${row.slice(0, 24).join(' ')}`);
    // Alle Gelenk-Spikes > 0,3 mit Frame-Nummern gruppieren
    const byF = {};
    for (let f = 1; f < n; f++) for (let j = 0; j < nu; j++) {
      const d = Math.abs(q[f * nu + j] - q[(f - 1) * nu + j]);
      if (d > 0.3) (byF[f] || (byF[f] = [])).push(`${jointNames[j]}=${d.toFixed(2)}`);
    }
    for (const [f, lst] of Object.entries(byF)) console.log(`  Zuckung @f=${f}: ${lst.join(', ')}`);
  }

  let seam = 0, seamJ = -1;
  for (let j = 0; j < nu; j++) {
    const d = Math.abs(q[j] - q[(n - 1) * nu + j]);
    if (d > seam) { seam = d; seamJ = j; }
  }
  console.log(`Loop-Naht (f=${n - 1}→0): max Δ=${seam.toFixed(3)} rad (${jointNames[seamJ]})`);

  let yawMaxJump = 0, yawF = -1;
  for (let f = 1; f < n; f++) {
    const d = Math.abs(yaw[f] - yaw[f - 1]);
    if (d > yawMaxJump) { yawMaxJump = d; yawF = f; }
  }
  const yawRange = Math.max(...yaw) - Math.min(...yaw);
  console.log(`Yaw: max Frame-Sprung=${(yawMaxJump * 180 / Math.PI).toFixed(1)}° @f=${yawF}, Spannweite=${(yawRange * 180 / Math.PI).toFixed(1)}°`);
  if (process.env.SERIES) {
    console.log(`Yaw-Timeline: ${[...yaw].map(v => (v * 180 / Math.PI).toFixed(1)).join(' ')}`);
    if (motion.rawYaw) console.log(`rawYaw-Roh:     ${[...motion.rawYaw].map(v => (v * 180 / Math.PI).toFixed(1)).join(' ')}`);
    if (motion.triadYaw) console.log(`triadYaw-Roh:   ${[...motion.triadYaw].map(v => (v * 180 / Math.PI).toFixed(1)).join(' ')}`);
  }

  let bqMaxJump = 0, bqF = -1;
  for (let f = 1; f < n; f++) {
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += baseQ[4 * f + k] * baseQ[4 * (f - 1) + k];
    const d = 2 * Math.acos(Math.min(1, Math.abs(dot)));
    if (d > bqMaxJump) { bqMaxJump = d; bqF = f; }
  }
  console.log(`baseQ: max Frame-Sprung=${(bqMaxJump * 180 / Math.PI).toFixed(1)}° @f=${bqF}`);

  let hMaxJump = 0;
  for (let f = 1; f < n; f++) hMaxJump = Math.max(hMaxJump, Math.abs(h[f] - h[f - 1]));
  console.log(`Höhe: max Frame-Sprung=${(hMaxJump * 100).toFixed(2)} cm, Bereich [${Math.min(...h).toFixed(2)}, ${Math.max(...h).toFixed(2)}] m`);

  if (root) {
    let rMaxJump = 0;
    for (let f = 1; f < n; f++) {
      const d = Math.hypot(root[2 * f] - root[2 * f - 2], root[2 * f + 1] - root[2 * f - 1]);
      rMaxJump = Math.max(rMaxJump, d);
    }
    console.log(`Root: max Frame-Schritt=${(rMaxJump * 100).toFixed(2)} cm`);
  }
  return { maxD, seam, yawMaxJump, bqMaxJump, hMaxJump };
}

// ── GLB-Builder ─────────────────────────────────────────────
function buildGlb(nodeDefs, anim, name) {
  // nodeDefs: [{name, parent, translation, rotation}]
  // anim: { samplers:[{_times,_output,_comp}], channels:[{sampler,target}] }
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
  const nodes = nodeDefs.map((n) => {
    const o = { name: n.name };
    if (n.translation) o.translation = n.translation;
    if (n.rotation) o.rotation = n.rotation;
    return o;
  });
  nodeDefs.forEach((n, i) => {
    const ch = [];
    nodeDefs.forEach((m, j) => { if (m.parent === i) ch.push(j); });
    if (ch.length) o0(nodes, i, ch);
  });
  function o0(arr, i, ch) { arr[i].children = ch; }
  const gltf = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }], scene: 0,
    nodes,
    animations: [{
      name,
      samplers: anim.samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })),
      channels: anim.channels,
    }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  };
  return packGlb(gltf, bin);
}

function packGlb(gltf, bin) {
  const enc = new TextEncoder();
  let jsonStr = JSON.stringify(gltf);
  // glTF-Spez: JSON-Chunk mit LEERZEICHEN auf 4 auffüllen
  jsonStr += ' '.repeat((4 - enc.encode(jsonStr).length % 4) % 4);
  const jsonBytes = enc.encode(jsonStr);
  const jsonPad = 0;
  const binPad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binOff, bin.length + binPad, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  u8.set(bin, binOff + 8);
  return out;
}

function quatAxis(axis, deg) {
  const a = deg * Math.PI / 180, s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}

// Mixamo-ähnliches Skelett: Y-up, +Z-Blick, cm. 14 Knoten.
function synthSkeleton() {
  const defs = [];
  const add = (name, parent, translation, rotation) => {
    defs.push({ name, parent, translation, rotation });
    return defs.length - 1;
  };
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

function idleClip(duration = 1.6, fps = 30, signFlip = false) {
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
  const armL = track(4, 4), armR = track(6, 4), foreL = track(5, 4), foreR = track(7, 4);
  const spine = track(1, 4), head = track(3, 4);
  for (let k = 0; k < K; k++) {
    const t = k / fps, w = 2 * Math.PI * t / duration;
    const s = Math.sin(w);
    const flip = signFlip && (k % 2 === 1) ? -1 : 1;
    const qa = quatAxis([1, 0, 0], 6 * s);
    armL.set(qa.map(v => v * flip), k * 4); armR.set(qa.map(v => v * flip), k * 4);
    foreL.set(quatAxis([1, 0, 0], 12 + 6 * s).map(v => v * flip), k * 4);
    foreR.set(quatAxis([1, 0, 0], 12 + 6 * s).map(v => v * flip), k * 4);
    spine.set(quatAxis([0, 1, 0], 2 * s).map(v => v * flip), k * 4);
    head.set(quatAxis([0, 1, 0], -2 * s).map(v => v * flip), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Idle_planted');
}

// Idle mit Hüfbs-Sway (Rotation ±4°, NICHT periodisch zum Clip-Ende) +
// Hüfbs-Bob (Translation) — wie echte UE/Mixamo-Idles. Beine statisch.
function idleSwayClip(duration = 1.33, fps = 30) {
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
  const spine = track(1, 4), head = track(3, 4);
  const armL = track(4, 4), armR = track(6, 4);
  for (let k = 0; k < K; k++) {
    const t = k / fps;
    // Zwei inkommensurable Frequenzen → Clip-Ende ≠ Clip-Anfang (Loop-Drift-Falle)
    const sway = 4 * Math.sin(2 * Math.PI * t / duration) + 2.5 * Math.sin(2 * Math.PI * 2.7 * t / duration + 0.7);
    const bob = 1.2 * Math.sin(2 * Math.PI * 3.1 * t / duration + 0.3); // cm
    hipsR.set(quatAxis([0, 1, 0], sway), k * 4);
    hipsT.set([0.8 * Math.sin(2 * Math.PI * t / duration), 95 + bob, 0], k * 3);
    spine.set(quatAxis([0, 1, 0], -0.6 * sway), k * 4);
    head.set(quatAxis([0, 1, 0], -0.3 * sway), k * 4);
    armL.set(quatAxis([1, 0, 0], 3 * Math.sin(2 * Math.PI * t / duration)), k * 4);
    armR.set(quatAxis([1, 0, 0], -3 * Math.sin(2 * Math.PI * t / duration)), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Idle_sway');
}

function walkClip({ facing = 1, duration = 2.4, fps = 30 } = {}) {
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
  const spd = 1.2; // m/s
  const totalCm = duration * spd * 100;
  for (let k = 0; k < K; k++) {
    const t = k / fps, w = 2 * Math.PI * t / (duration / 2);
    const s = Math.sin(w), c = Math.cos(w);
    hipsR.set(quatAxis([1, 0, 0], 4 * s), k * 4);
    hipsT.set([0, 95 + 2.5 * Math.abs(c), facing * (t * spd * 100)], k * 3);
    uLegL.set(quatAxis([1, 0, 0], 28 * s - 5), k * 4);
    uLegR.set(quatAxis([1, 0, 0], -28 * s - 5), k * 4);
    legL.set(quatAxis([1, 0, 0], Math.max(0, 42 * -s)), k * 4);
    legR.set(quatAxis([1, 0, 0], Math.max(0, 42 * s)), k * 4);
    armL.set(quatAxis([1, 0, 0], -24 * s), k * 4);
    armR.set(quatAxis([1, 0, 0], 24 * s), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Walk_' + (facing > 0 ? 'plusZ' : 'minusZ'));
}

// ── Haupt ──
const arg = process.argv[2];
if (arg && arg.endsWith('.glb')) {
  const buf = await readFile(arg);
  const clip = new GlbClip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), +(process.argv[3] || 0));
  console.log(`GLB: ${clip.name}, ${clip.duration.toFixed(2)}s, mergedFrom=${clip.mergedFrom}`);
  const motion = retargetToG1(clip, sim, log);
  analyze(clip.name, motion);
} else if (arg === '--physics') {
  await physicsTest();
} else {
  console.log('── Synthetisch: statisches Idle (Beine gepflanzt) ──');
  const r1 = analyze('Idle_planted', retargetToG1(new GlbClip(idleClip()), sim, log));
  console.log('\n── Synthetisch: Idle mit Hüft-Sway + Bob (UE/„Zombie_Idle"-ähnlich) ──');
  const r15 = analyze('Idle_sway', retargetToG1(new GlbClip(idleSwayClip()), sim, log));
  console.log('\n── Synthetisch: Idle mit Quaternion-Vorzeichenflips je Keyframe ──');
  const r16 = analyze('Idle_signflip', retargetToG1(new GlbClip(idleClip(1.6, 30, true)), sim, log));
  console.log('\n── Synthetisch: Walk +Z (Blick in Bewegungsrichtung) ──');
  const r2 = analyze('Walk_plusZ', retargetToG1(new GlbClip(walkClip({ facing: 1 })), sim, log));
  console.log('\n── Synthetisch: Walk -Z (Blick GEGEN Bewegungsrichtung — Flip-Falle) ──');
  const r3 = analyze('Walk_minusZ', retargetToG1(new GlbClip(walkClip({ facing: -1 })), sim, log));
  console.log('\n── Simulation des DISPLAY-Pfads: 60 s Loop-Wiedergabe (Idle_sway) ──');
  const swayMotion = retargetToG1(new GlbClip(idleSwayClip()), sim, log);
  loopDisplayTest(swayMotion);
  console.log('\n── Simulation des DISPLAY-Pfads: 60 s Loop-Wiedergabe (Walk +Z) ──');
  const walkMotion = retargetToG1(new GlbClip(walkClip({ facing: 1 })), sim, log);
  loopDisplayTest(walkMotion);
  if (process.env.SERIES) {
    // Track-Rohdaten + FK des Sway-Clips inspizieren
    const c2 = new GlbClip(idleSwayClip());
    const tr = c2.rotationTracks.get(0);
    console.log('Hips-Rotations-Track (Quats k*4, alle 5):');
    for (let k = 0; k < tr.times.length; k += 5) {
      const v = [tr.values[4 * k], tr.values[4 * k + 1], tr.values[4 * k + 2], tr.values[4 * k + 3]];
      console.log(`  t=${tr.times[k].toFixed(2)} q=[${v.map(x => x.toFixed(3)).join(',')}]`);
    }
    const wm = new Map(), wp = new Map();
    const myRaw = [];
    for (let f = 0; f < 40; f++) {
      c2.sampleWorldFull(f / 30, ['mixamorig:Hips'], wm, wp);
      const q = wm.get(0);
      // exakt die retarget.js-Formel:
      const g = quatRotGlb(q, [0, 0, 1], [0, 0, 0]);          // GLB-Welt
      const m = quatRotGlb([0.5, 0.5, 0.5, 0.5], g, [0, 0, 0]); // ALIGN
      myRaw.push(Math.atan2(m[0], m[1]) * 180 / Math.PI);
      if (f >= 19 && f <= 22) console.log(`f=${f} hipsWorld=[${q.map(x => x.toFixed(3)).join(',')}] fwd_mjc=[${m.map(x => x.toFixed(3)).join(',')}] rawYaw=${myRaw[f].toFixed(2)}° t=${JSON.stringify(wp.get(0).map(x => +x.toFixed(2)))}`);
    }
    console.log('nachgerechnetes rawYaw: ' + myRaw.map(v => v.toFixed(1)).join(' '));
  }
  console.log('\n── Zusammenfassung ──');
  for (const [nm, r] of [['Idle', r1], ['Idle_sway', r15], ['Idle_signflip', r16], ['Walk+Z', r2], ['Walk-Z', r3]]) {
    console.log(`${nm}: maxGelenkΔ=${r.maxD.toFixed(2)}rad Naht=${r.seam.toFixed(2)}rad yawSprung=${(r.yawMaxJump * 180 / Math.PI).toFixed(0)}° baseQSprung=${(r.bqMaxJump * 180 / Math.PI).toFixed(0)}°`);
  }
}

// ── Display-Pfad-Simulation: refRoot + Loop-Drift über 60 s ──
function loopDisplayTest(motion) {
  const { root, yaw, n, fps, locomotion } = motion;
  console.log(`  (locomotion=${locomotion}, meanSpeed=${motion.meanSpeed ? motion.meanSpeed.toFixed(3) : '?'} m/s)`);
  // motiontask-Logik nachgebaut (MIT v2.4.1-Gating wie advance()):
  let phase = 0, loopX = 0, loopY = 0, loopYaw = 0;
  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const dt = 0.02;
  let maxYawAbs = 0, maxPosAbs = 0;
  for (let t = 0; t < 60; t += dt) {
    const old = phase;
    phase = (phase + dt * fps / n) % 1;
    if (phase < old && locomotion !== false) {
      loopX += root[2 * (n - 1)] - root[0];
      loopY += root[2 * (n - 1) + 1] - root[1];
      loopYaw = wrapAngle(loopYaw + wrapAngle(yaw[n - 1] - yaw[0]));
    }
    maxYawAbs = Math.max(maxYawAbs, Math.abs(loopYaw));
    maxPosAbs = Math.max(maxPosAbs, Math.hypot(loopX, loopY));
  }
  console.log(`Nach 60 s Wiedergabe (${Math.round(60 * fps / n)} Loops):`);
  console.log(`  Akkumulierte Loop-Yaw: ${(loopYaw * 180 / Math.PI).toFixed(1)}°  (max. |yaw|: ${(maxYawAbs * 180 / Math.PI).toFixed(1)}°)`);
  console.log(`  Akkumulierte Loop-Position: (${loopX.toFixed(3)}, ${loopY.toFixed(3)}) m — Betrag ${Math.hypot(loopX, loopY).toFixed(3)} m`);
  if (Math.abs(loopYaw) * 180 / Math.PI > 10) console.log('  ⚠ DER GEIST DREHT SICH ÜBER DIE Zeit IMMER WEITER — „dreht sich komplett um"');
  else console.log('  ✓ Keine Yaw-Akkumulation über Loops');
  if (Math.hypot(loopX, loopY) > 0.2) console.log('  ⚠ Der Geist wandert über die Zeit davon (trotz Idle-Referenz)');
}

// ── Physik-Test: echter G1 im MANUELL-Modus mit aktiver GLB-Referenz ──
async function physicsTest() {
  console.log('── Physik: G1 im March-Gait (MANUELL, Stick neutral) mit GLB-Referenz ──');
  const { GlbClip: G } = await import(path.join(WWW, 'js/glb.js'));
  const motion = retargetToG1(new G(idleSwayClip()), sim, log);
  // Roboter auf die Bahn setzen wie activateClip → task.reset
  sim.reset();
  try { sim.placeBase(motion.root[0], motion.root[1], motion.yaw[0]); } catch (e) { console.log('  placeBase: ' + e.message); }
  // March-Gait nachbauen (robots.js makeMarch, mov=0)
  const c = { hipPitch0: -0.15, knee0: 0.30, aKnee: 0.35, aSwing: 0.18, f0: 0.9, fv: 0.4, sway: 0.02, turnYaw: 0.18, push: 0.15 };
  const A = sim.actByName;
  const ankle0 = -(c.hipPitch0 + c.knee0);
  for (const side of ['left', 'right']) {
    sim.ctrl[A[side + '_hip_pitch_joint']] = c.hipPitch0;
    sim.ctrl[A[side + '_knee_joint']] = c.knee0; // mov=0
    sim.ctrl[A[side + '_ankle_pitch_joint']] = ankle0;
    sim.ctrl[A[side + '_ankle_roll_joint']] = 0;
    sim.ctrl[A[side + '_hip_roll_joint']] = 0;
    sim.ctrl[A[side + '_hip_yaw_joint']] = 0;
  }
  const dt = 0.002;
  let fallResets = 0, maxTip = 0, maxYawDrift = 0;
  const y0 = (() => { const o = 4 * sim.baseBody; const q = sim._xquat; return Math.atan2(2 * (q[o] * q[o + 3] + q[o + 1] * q[o + 2]), 1 - 2 * (q[o + 2] * q[o + 2] + q[o + 3] * q[o + 3])); })();
  let hMin = 9, hMax = 0;
  for (let t = 0; t < 20; t += dt) {
    sim.stepN(1);
    const o = 4 * sim.baseBody;
    const q = sim._xquat, w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
    const upz = 1 - 2 * (x * x + y * y);
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const h = sim._xpos[3 * sim.baseBody + 2];
    maxTip = Math.max(maxTip, 1 - upz);
    maxYawDrift = Math.max(maxYawDrift, Math.abs(yaw - y0));
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    // checkFall der App
    if (upz < 0.32 || h < 0.28) {
      fallResets++;
      sim.reset();
      for (const side of ['left', 'right']) {
        sim.ctrl[A[side + '_hip_pitch_joint']] = c.hipPitch0;
        sim.ctrl[A[side + '_knee_joint']] = c.knee0;
        sim.ctrl[A[side + '_ankle_pitch_joint']] = ankle0;
      }
    }
  }
  console.log(`20 s Physik (Stick neutral): Auto-Resets=${fallResets}, max Kippung=${(maxTip * 100).toFixed(1)}%, max Yaw-Drift=${(maxYawDrift * 180 / Math.PI).toFixed(1)}°, Höhe [${hMin.toFixed(2)}, ${hMax.toFixed(2)}] m`);
  if (fallResets > 0) console.log('  ⚠ Der echte Roboter kippt/fällt und wird zurückgesetzt → „zuckt"');
  if (maxYawDrift * 180 / Math.PI > 20) console.log('  ⚠ Der echte Roboter dreht sich weg → „dreht sich um"');
}
