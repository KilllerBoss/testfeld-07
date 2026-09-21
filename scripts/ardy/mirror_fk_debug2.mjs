// Debug 2: Mit korrekter Seiten-Paarung — welcher Aktuator verletzt die Identität?
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
const wasmBuf = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { mirrorMotionY } = await import(path.join(WWW, 'js/retarget.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_dbg2.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_dbg2.xml');
const nu = sim.nu;

const mjName = (b) => { try { return sim._mjApi.mj_id2name(sim.model, 1, b) || String(b); } catch (e) { return String(b); } };
const nameOf = []; for (let b = 0; b < sim.nbody; b++) nameOf.push(mjName(b));
const pairOf = nameOf.map((nm) => {
  if (/^left/.test(nm)) return nameOf.indexOf(nm.replace(/^left/, 'right'));
  if (/^right/.test(nm)) return nameOf.indexOf(nm.replace(/^right/, 'left'));
  return nameOf.indexOf(nm);
});

// Gelenk-Weltachsen in der Nullpose ausgeben
{
  const g0 = sim.makeGhostData();
  sim._mjApi.mj_resetData(sim.model, g0);
  sim._mjApi.mj_forward(sim.model, g0);
  console.log('Gelenk-Achsen (Nullpose, Welt):');
  const seen = new Set();
  for (let a = 0; a < nu; a++) {
    const jid = sim.actJoint[a];
    if (seen.has(jid)) continue;
    seen.add(jid);
    const b = sim.model.jnt_bodyid[jid];
    const ax = [sim.model.jnt_axis[3 * jid], sim.model.jnt_axis[3 * jid + 1], sim.model.jnt_axis[3 * jid + 2]];
    const q = [g0.xquat[4 * b + 1], g0.xquat[4 * b + 2], g0.xquat[4 * b + 3], g0.xquat[4 * b]];
    const w = rotV(q, ax);
    console.log(`  ${sim.actName[a].padEnd(30)} lokal=(${ax.map(v => v.toFixed(2)).join(',')}) welt=(${w.map(v => v.toFixed(3)).join(',')})`);
  }
  function rotV(q, v) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
}

const fk = (q) => {
  const g = sim.makeGhostData();
  sim.setGhostPose(g, q, 0, 0.8, 0, 0, 0, null);
  const out = [];
  for (let b = 0; b < sim.nbody; b++) out.push([g.xpos[3 * b], g.xpos[3 * b + 1], g.xpos[3 * b + 2]]);
  return out;
};
const errPaired = (pa, pb) => {
  let mx = 0, bi = -1;
  for (let b = 1; b < sim.nbody; b++) {
    const p = pairOf[b];
    const e = Math.hypot(pa[b][0] - pb[p][0], pa[b][1] + pb[p][1], pa[b][2] - pb[p][2]);
    if (e > mx) { mx = e; bi = b; }
  }
  return { mx, bi };
};

console.log('\nJe-Aktuator-Probe (θ=+0.5, gepaart):');
for (let a = 0; a < nu; a++) {
  const q1 = new Float32Array(nu); q1[a] = 0.5;
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  const e = errPaired(fk(m1.q), fk(q1));
  const flag = e.mx > 1e-4 ? ' ✗' : '';
  console.log(`  ${sim.actName[a].padEnd(30)} maxErr=${e.mx.toFixed(4)} (${nameOf[e.bi]})${flag}`);
}

// Random-Konfigurationen: welche Körper weichen ab?
console.log('\nRandom-Konfigurations-Probe:');
let _s = 20260921 >>> 0;
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
for (let trial = 0; trial < 5; trial++) {
  const q1 = new Float32Array(nu);
  for (let a = 0; a < nu; a++) {
    const lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
    q1[a] = lo + rnd() * (hi - lo);
  }
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  const pa = fk(m1.q), pb = fk(q1);
  const worst = [];
  for (let b = 1; b < sim.nbody; b++) {
    const p = pairOf[b];
    const e = Math.hypot(pa[b][0] - pb[p][0], pa[b][1] + pb[p][1], pa[b][2] - pb[p][2]);
    if (e > 1e-4) worst.push(nameOf[b] + ':' + e.toFixed(3));
  }
  console.log(`  Trial ${trial}: ${worst.length ? worst.slice(0, 8).join(' ') : 'OK'}`);
}
// Body-Namen + Paarung ausgeben (Suche nach nicht-gespiegelten Namen)
console.log('\nBody-Namen und Paarung:');
for (let b = 0; b < sim.nbody; b++) {
  if (pairOf[b] !== b) console.log(`  ${b} ${nameOf[b]} ↔ ${pairOf[b]} ${nameOf[pairOf[b]]}`);
}

// Inkrementelle Kombinations-Probe: welche Joint-Kombination bricht?
console.log('\nInkrementelle Kombination (Arm-Kette):');
const armL = ['left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint', 'left_wrist_roll_joint', 'left_wrist_pitch_joint', 'left_wrist_yaw_joint'];
const AByName = sim.actByName;
for (let k = 1; k <= armL.length; k++) {
  const q1 = new Float32Array(nu);
  for (let i = 0; i < k; i++) q1[AByName[armL[i]]] = 0.5;
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  const e = errPaired(fk(m1.q), fk(q1));
  console.log(`  ${k} Gelenke (bis ${armL[k - 1]}): maxErr=${e.mx.toFixed(5)} (${nameOf[e.bi]})${e.mx > 1e-4 ? ' ✗' : ''}`);
}
console.log('\nMit Waist vorab:');
for (const wz of [['waist_yaw_joint', 0.5], ['waist_roll_joint', 0.3], ['waist_pitch_joint', 0.3]]) {
  const q1 = new Float32Array(nu);
  q1[AByName[wz[0]]] = wz[1];
  q1[AByName['left_shoulder_pitch_joint']] = 0.5;
  q1[AByName['left_elbow_joint']] = 0.4;
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  const e = errPaired(fk(m1.q), fk(q1));
  console.log(`  ${wz[0]}=${wz[1]} + shoulder_pitch + elbow: maxErr=${e.mx.toFixed(5)} (${nameOf[e.bi]})${e.mx > 1e-4 ? ' ✗' : ''}`);
}

// Exakte Test-Replikation (4 Frames, zufällige Höhen, gleiche RNG-Reihenfolge)
console.log('\nTest-Replikation:');
let _s2 = 20260921 >>> 0;
const rnd2 = () => { _s2 = (_s2 * 1664525 + 1013904223) >>> 0; return _s2 / 4294967296; };
const NFR2 = 4;
const mkQ = () => {
  const q = new Float32Array(NFR2 * nu);
  for (let f = 0; f < NFR2; f++) for (let a = 0; a < nu; a++) {
    const lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
    q[f * nu + a] = lo + rnd2() * (hi - lo);
  }
  return q;
};
const qT = mkQ();
const hT = []; for (let f = 0; f < NFR2; f++) hT.push(0.7 + rnd2() * 0.2);
const gA = sim.makeGhostData(), gB = sim.makeGhostData();
for (let f = 0; f < NFR2; f++) {
  const q1 = qT.subarray(f * nu, (f + 1) * nu);
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  sim.setGhostPose(gB, q1, 0, hT[f], 0, 0, 0, null);
  sim.setGhostPose(gA, m1.q, 0, hT[f], 0, 0, 0, null);
  let mx = 0, bi = -1;
  for (let b = 1; b < sim.nbody; b++) {
    const p = pairOf[b];
    const e = Math.hypot(gA.xpos[3 * b] - gB.xpos[3 * p], gA.xpos[3 * b + 1] + gB.xpos[3 * p + 1], gA.xpos[3 * b + 2] - gB.xpos[3 * p + 2]);
    if (e > mx) { mx = e; bi = b; }
  }
  console.log(`  Frame ${f} (h=${hT[f].toFixed(3)}): maxErr=${mx.toFixed(5)} (${nameOf[bi]})${mx > 1e-4 ? ' ✗' : ''}`);
}

// Höhen-Isolation: gleiche q, verschiedene h
console.log('\nHöhen-Isolation (Frame 0 der Replikation):');
{
  const q1 = qT.subarray(0, nu);
  const m1 = { q: Float32Array.from(q1), n: 1, nu };
  mirrorMotionY(m1, sim);
  for (const h of [0.8, 0.765, 0.9, 1.1]) {
    const gA2 = sim.makeGhostData(), gB2 = sim.makeGhostData();
    sim.setGhostPose(gB2, q1, 0, h, 0, 0, 0, null);
    sim.setGhostPose(gA2, m1.q, 0, h, 0, 0, 0, null);
    let mx = 0, bi = -1;
    for (let b = 1; b < sim.nbody; b++) {
      const p = pairOf[b];
      const e = Math.hypot(gA2.xpos[3 * b] - gB2.xpos[3 * p], gA2.xpos[3 * b + 1] + gB2.xpos[3 * p + 1], gA2.xpos[3 * b + 2] - gB2.xpos[3 * p + 2]);
      if (e > mx) { mx = e; bi = b; }
    }
    console.log(`  h=${h}: maxErr=${mx.toFixed(5)} (${nameOf[bi]})${mx > 1e-4 ? ' ✗' : ''}`);
  }
  // Frische vs. wiederverwendete Ghost-Daten bei h=0.765
  const gB3 = sim.makeGhostData(), gA3 = sim.makeGhostData();
  sim.setGhostPose(gB3, q1, 0, 0.765, 0, 0, 0, null);
  sim.setGhostPose(gA3, m1.q, 0, 0.765, 0, 0, 0, null);
  let mx3 = 0, bi3 = -1;
  for (let b = 1; b < sim.nbody; b++) {
    const p = pairOf[b];
    const e = Math.hypot(gA3.xpos[3 * b] - gB3.xpos[3 * p], gA3.xpos[3 * b + 1] + gB3.xpos[3 * p + 1], gA3.xpos[3 * b + 2] - gB3.xpos[3 * p + 2]);
    if (e > mx3) { mx3 = e; bi3 = b; }
  }
  console.log(`  h=0.765 frische Ghosts: maxErr=${mx3.toFixed(5)} (${nameOf[bi3]})${mx3 > 1e-4 ? ' ✗' : ''}`);
}
