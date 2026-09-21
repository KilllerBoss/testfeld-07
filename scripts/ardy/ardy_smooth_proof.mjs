// ═══════════════════════════════════════════════════════════
// ardy_smooth_proof.mjs — v2.28.11 „PLAYBACK-GLÄTTUNG"
// Nutzer: „Perfekt. Zittert aber."
//
// Beweise an der ECHTEN KETTE (echte G1-Sim, MuJoCo-WASM, CPU):
//   A JITTER q-Ebene: max Gelenksprung je Render-Frame (60 Hz) —
//     Nearest-Frame (v2.28.10) vs. sampleArdyDisplay (v2.28.11)
//   B JITTER FK-Ebene: max KÖRPERPOSITIONS-Sprung (gh.xpos aller
//     Bodies) = das sichtbare Zittern in Pixeln/Metern
//   C DESYNC-DOKU: Physik-Referenz (sampleRef, t = phase·fps) sieht
//     bei n ≠ fps nur die ersten fps Frames (Zeitstreckung n/fps) —
//     bewusst UNVERÄNDERT (Policy-Semantik), dokumentiert für die
//     nächste Iteration
// Dump → smooth_proof_dump.json · Plot → download/ardy_smooth_proof.png
// ═══════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

console.log('Lade echte G1-Sim (MuJoCo-WASM, CPU) …');
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
// fetch-Interceptor: „models/…" auf die App-Assets mappen (wie ardy_ghost_proof)
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && (url.startsWith('models/') || url.startsWith('www/'))) {
    const p = path.join(WWW, url.startsWith('www/') ? url.slice(4) : url);
    const buf = readFileSync(p);
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const wasmBuf = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { sampleArdyDisplay } = await import(path.join(WWW, 'js/motiontask.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_smooth_proof.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_smooth_proof.xml');
const nu = cfg.nu, keyCtrl = sim.keyCtrl;
console.log('G1: nu=' + nu + ' · h0=' + (cfg.h0 || 0.79).toFixed(2));

// ── Synthetischer „idle"-Clip: 80 Frames @ 20 fps (5-s-UI-Standard,
//    max_frames), ZYKLISCH (2 Sinus-Perioden) auf der echten Ruheset-Pose
const N = 80, FPS = 20;
const clip = { n: N, fps: FPS, nu, srcOverlay: true };
clip.q = new Float32Array(N * nu);
for (let f = 0; f < N; f++) {
  for (let a = 0; a < nu; a++) {
    clip.q[f * nu + a] = keyCtrl[a] + 0.08 * Math.sin(4 * Math.PI * f / N + a * 0.7) * (a % 3 === 0 ? 1 : 0.35);
  }
}
clip.h = new Float32Array(N);
for (let f = 0; f < N; f++) clip.h[f] = (cfg.h0 || 0.79) + 0.004 * Math.sin(4 * Math.PI * f / N);
clip.baseQ = new Float32Array(4 * N);
for (let f = 0; f < N; f++) {
  const a = 0.02 * Math.sin(4 * Math.PI * f / N) / 2;
  clip.baseQ[4 * f] = Math.sin(a); clip.baseQ[4 * f + 3] = Math.cos(a);
}

let fails = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); } };

// ── Render-Sampling: 60 Hz über 4 s (240 Samples, Loop = n/fps = 4 s)
const STEPS = 240;
const dispQ = new Float32Array(nu), dispH = new Float32Array(1), dispBQ = new Float32Array(4);
const gh = sim.makeGhostData();
const adr = sim.actQposAdr;
const NB = sim.model.nbody;
const snapXpos = (buf) => { for (let b = 0; b < 3 * NB; b++) buf[b] = gh.xpos[b]; };
const bufA = new Float64Array(3 * NB), bufB = new Float64Array(3 * NB);

const floorQ = new Float32Array(nu);
const maxStepQ_floor = { v: 0 }, maxStepQ_interp = { v: 0 };
const maxStepX_floor = { v: 0 }, maxStepX_interp = { v: 0 };
const traceQfloor = [], traceQinterp = [], tracePhase = [];
const J0 = 0; // Gelenk 0 für den Trace

let prevQf = null, prevQi = null, prevXf = null, prevXi = null;
for (let k = 0; k <= STEPS; k++) {
  const phase = (k / STEPS) % 1;
  // Nearest-Frame (v2.28.10-Anzeige-Code)
  const fr = Math.floor(phase * N) % N;
  for (let a = 0; a < nu; a++) floorQ[a] = clip.q[fr * nu + a];
  const bqf = clip.baseQ.subarray(4 * fr, 4 * fr + 4);
  sim.setGhostPose(gh, floorQ, 0, clip.h[fr], 0, 0, 0, bqf);
  snapXpos(bufA);
  // Interpoliert (v2.28.11)
  const dbq = sampleArdyDisplay(clip, phase, dispQ, dispH, dispBQ);
  sim.setGhostPose(gh, dispQ, 0, dispH[0], 0, 0, 0, dbq);
  snapXpos(bufB);

  if (prevQf !== null) {
    let dF = 0, dI = 0;
    for (let a = 0; a < nu; a++) {
      dF = Math.max(dF, Math.abs(floorQ[a] - prevQf[a]));
      dI = Math.max(dI, Math.abs(dispQ[a] - prevQi[a]));
    }
    maxStepQ_floor.v = Math.max(maxStepQ_floor.v, dF);
    maxStepQ_interp.v = Math.max(maxStepQ_interp.v, dI);
    let xF = 0, xI = 0;
    for (let b = 0; b < 3 * NB; b++) {
      xF = Math.max(xF, Math.abs(bufA[b] - prevXf[b]));
      xI = Math.max(xI, Math.abs(bufB[b] - prevXi[b]));
    }
    maxStepX_floor.v = Math.max(maxStepX_floor.v, xF);
    maxStepX_interp.v = Math.max(maxStepX_interp.v, xI);
  }
  prevQf = Float32Array.from(floorQ); prevQi = Float32Array.from(dispQ);
  prevXf = Float64Array.from(bufA); prevXi = Float64Array.from(bufB);
  traceQfloor.push(floorQ[J0]); traceQinterp.push(dispQ[J0]); tracePhase.push(phase);
}

console.log('\n[A] JITTER q-Ebene (max Gelenksprung je Render-Frame, 60 Hz)');
ok(maxStepQ_interp.v < maxStepQ_floor.v * 0.6, 'A interpoliert deutlich glatter als Nearest-Frame',
  'floor=' + maxStepQ_floor.v.toExponential(3) + ' → interp=' + maxStepQ_interp.v.toExponential(3) + ' rad (Faktor ' + (maxStepQ_floor.v / maxStepQ_interp.v).toFixed(1) + ')');
ok(maxStepQ_interp.v > 0, 'A Bewegung ist echt vorhanden (keine Null-Messung)');

console.log('\n[B] JITTER FK-Ebene (max Körpersprung je Render-Frame, alle ' + NB + ' Bodies)');
ok(maxStepX_interp.v < maxStepX_floor.v * 0.6, 'B sichtbares Zittern (Körper-Positionen) drastisch reduziert',
  'floor=' + maxStepX_floor.v.toExponential(3) + ' → interp=' + maxStepX_interp.v.toExponential(3) + ' m (Faktor ' + (maxStepX_floor.v / maxStepX_interp.v).toFixed(1) + ')');
ok(maxStepX_floor.v > 1e-4, 'B Nearest-Frame-Treppen sind messbar (das gesehene Zittern)', (maxStepX_floor.v * 1000).toFixed(1) + ' mm Sprünge');

// ── C) DESYNC-DOKU (bewusst unverändert): Referenz-Skala phase·fps
console.log('\n[C] DESYNC-DOKU: Physik-Referenz (sampleRef, t = phase·fps) bei n=' + N + ', fps=' + FPS);
const { makeMotionTask } = await import(path.join(WWW, 'js/motiontask.js'));
const task = makeMotionTask({ nu, h0: cfg.h0 || 0.79, actSpan: 1 }, clip, sim);
task.tElapsed = 10; // blend = 1 (reine Clip-Referenz)
const refQ = new Float64Array(nu), refH = new Float64Array(1);
let maxRefFrame = 0, refJump = 0, prevRef = null;
for (let s = 0; s <= 200; s++) {
  task.advance(0.02);
  task.sampleRef(task.phase, refQ, refH);
  const t = (task.phase * FPS) % N;
  maxRefFrame = Math.max(maxRefFrame, Math.floor(t));
  if (prevRef !== null) {
    let d = 0;
    for (let a = 0; a < nu; a++) d = Math.max(d, Math.abs(refQ[a] - prevRef[a]));
    refJump = Math.max(refJump, d);
  }
  prevRef = Float64Array.from(refQ);
}
ok(maxRefFrame <= FPS + 1, 'C Befund bestätigt: die Referenz sieht nur Frames 0…' + maxRefFrame + ' von 0…' + (N - 1) + ' (Zeitstreckung Faktor ' + (N / FPS).toFixed(1) + ')',
  'Referenz = ' + (maxRefFrame / FPS).toFixed(1) + ' s Material, geloopt in ' + (N / FPS).toFixed(1) + ' s');
ok(refJump > 0.01, 'C Befund bestätigt: Referenz springt am Loop-Nahtpunkt mitten in der Motion (' + refJump.toFixed(3) + ' rad) — die „random"-Sprünge aus Report B');
console.log('  → BEWUSST UNVERÄNDERT: Policy-Semantik (Training/obs) — Lösung in der nächsten Iteration mit eigener Migration.');

// ── Dump + Plot ──
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'smooth_proof_dump.json'), JSON.stringify({
  version: '2.28.11', nu, n: N, fps: FPS,
  q: { floor: maxStepQ_floor.v, interp: maxStepQ_interp.v, factor: maxStepQ_floor.v / maxStepQ_interp.v },
  xpos: { floor: maxStepX_floor.v, interp: maxStepX_interp.v, factor: maxStepX_floor.v / maxStepX_interp.v },
  desync: { n: N, fps: FPS, maxRefFrame, refJump },
  trace: { phase: tracePhase, floor: traceQfloor, interp: traceQinterp, joint: J0 },
}));
console.log('\nDump → scripts/ardy/smooth_proof_dump.json');
process.exit(fails ? 1 : 0);
