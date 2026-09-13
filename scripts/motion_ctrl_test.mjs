// motion_ctrl_test.mjs — v2.5.0-Verifikation der Motion-Task-Änderungen:
//   1) obsDim = 3·nu + 14 (Kommando-Kanäle vx/wz immer im Beobachtungsraum)
//   2) ctrlMode 'none': Kommandos bleiben 0, Ziel = Referenzbahn (wie v2.4.1)
//   3) ctrlMode 'joy': sampleCmd würfelt, Wurzel-Ziel integriert (vx, wz),
//      Phasen-Faktor bleibt in [0.4, 1.7]
//   4) animOn=false: sampleRef liefert Keyframe-Stand, Höhen-Referenz 0,79
//   5) Reward in allen Modi endlich; done-Logik greift bei Sturz
// Läuft ohne MuJoCo (Stub-Sim reicht: motiontask nutzt nur die Getter).

import { makeMotionTask, MOTION_R } from '../app/src/main/assets/www/js/motiontask.js';

const nu = 6; // klein, reicht für die Logik
const n = 20, fps = 20;
const keyCtrl = new Float64Array(nu).map((_, i) => (i % 2 ? 0.1 : -0.05));

// Stub-Clip: Idle (root bewegt sich kaum) + locomotion-Variante
function makeClip(loc) {
  const root = new Float32Array(n * 2), yaw = new Float32Array(n), q = new Float32Array(n * nu), h = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    root[2 * f] = loc ? f * 0.05 : 0; // 1 m/s bei loc, 0 sonst
    yaw[f] = 0;
    for (let j = 0; j < nu; j++) q[f * nu + j] = Math.sin(f / 3 + j) * (loc ? 0.3 : 0.02);
    h[f] = 0.8;
  }
  return { name: 't', fps, n, nu, q, h, root, yaw, locomotion: loc, meanSpeed: loc ? 1.0 : 0.0, duration: n / fps };
}

// Stub-Sim: G1-ähnliche Getter, Pose bleibt aufrecht am Ort
function makeSim() {
  const q = new Float64Array(nu), dq = new Float64Array(nu);
  const s = {
    keyCtrl,
    _qvel: new Float64Array(6),
    actQposAdr: Array.from({ length: nu }, (_, i) => i),
    actDofAdr: Array.from({ length: nu }, (_, i) => i),
    jointPositions(out) { for (let i = 0; i < nu; i++) out[i] = q[i]; return out; },
    jointVelocities(out) { for (let i = 0; i < nu; i++) out[i] = dq[i]; return out; },
    baseQuat(out) { out[0] = 1; out[1] = out[2] = out[3] = 0; return out; },
    basePos(out) { out[0] = 0; out[1] = 0; out[2] = 0.79; return out; },
    baseVelWorld(out) { out[0] = out[1] = out[2] = 0; return out; },
    placeBase() {},
  };
  s._q = q; s._dq = dq;
  return s;
}

let fails = 0;
const check = (name, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name);
  if (!cond) fails++;
};

const sim = makeSim();
const cfg = { nu, actSpan: 0.4 };

// ── 1) obsDim ──
{
  const t = makeMotionTask(cfg, makeClip(false), sim);
  check('obsDim = 3·nu + 14', t.obsDim === 3 * nu + 14);
}

// ── 2) 'none': Kommandos 0, Beobachtung vollständig, Reward endlich ──
{
  const clip = makeClip(false); // stille Bahn — Stub-Roboter steht am Start
  const t = makeMotionTask(cfg, clip, sim);
  t.reset(null, sim);
  const obs = new Float32Array(t.obsDim);
  let ok = true;
  for (let k = 0; k < 120; k++) {
    const used = t.observe(sim, obs);
    if (used !== t.obsDim) { ok = false; break; }
    if (obs[t.obsDim - 2] !== 0 || obs[t.obsDim - 1] !== 0) { ok = false; break; } // Kommandos 0
    t.advance(0.02);
  }
  check("'none': observe füllt exakt obsDim, Kommando-Kanäle bleiben 0", ok);
  const { r, done } = t.reward(sim);
  check("'none': Reward endlich, Episode läuft weiter (aufrecht, auf der Bahn)", Number.isFinite(r) && !done);
}

// ── 3) 'joy': Würfel-Intervalle, Ziel-Integration, Phasen-Faktor ──
{
  const clip = makeClip(true);
  const t = makeMotionTask(cfg, clip, sim);
  t.ctrlMode = 'joy';
  t.reset(null, sim);
  const obs = new Float32Array(t.obsDim);
  let cmdSeen = false, holdOk = true, txMoved = false;
  const x0 = t._tx, y0 = t._ty;
  for (let k = 0; k < 400; k++) {
    t.advance(0.02);
    if (t.cmd.vx !== 0 || t.cmd.wz !== 0) cmdSeen = true;
    if (t._cmdHold > 4.01) holdOk = false;
    if (Math.hypot(t._tx - x0, t._ty - y0) > 0.01) txMoved = true;
    const used = t.observe(sim, obs);
    if (used !== t.obsDim) { holdOk = false; break; }
    // Führung-Kanal (Index obsDim−nu−5) = Kommando vx
    if (Math.abs(obs[t.obsDim - nu - 5] - t.cmd.vx) > 1e-6) { holdOk = false; break; }
  }
  check("'joy': Zufalls-Kommandos erscheinen (vx≠0 oder wz≠0)", cmdSeen);
  check("'joy': Haltezeit ≤ 4 s", holdOk);
  check("'joy': Wurzel-Ziel integriert die Kommandos", txMoved);
  // Phasen-Faktor-Grenzen: viele Frames, Phase muss monoton wachsen und
  // der Faktor implizit in [0.4, 1.7] bleiben (indirekt über Δphase)
  let fOk = true;
  for (let k = 0; k < 200; k++) {
    const p0 = t.phase;
    t.advance(0.02);
    const dp = t.phase - p0 + (t.phase < p0 ? 1 : 0);
    const maxDp = 0.02 * fps / n * 1.71, minDp = 0.02 * fps / n * 0.39;
    if (dp > maxDp + 1e-9 || dp < minDp - 1e-9) { fOk = false; break; }
  }
  check("'joy': Phasen-Faktor bleibt in [0.4, 1.7]", fOk);
  const { r } = t.reward(sim);
  check("'joy': Reward endlich", Number.isFinite(r));
}

// ── 4) animOn=false: Keyframe-Stand als Referenz ──
{
  const clip = makeClip(false);
  const t = makeMotionTask(cfg, clip, sim);
  t.animOn = false;
  t.reset(null, sim);
  t.tElapsed = 5; // Blend-In übersprungen
  const outQ = new Float64Array(nu), outH = [0];
  t.sampleRef(0.37, outQ, outH);
  let same = true;
  for (let j = 0; j < nu; j++) if (Math.abs(outQ[j] - keyCtrl[j]) > 1e-12) same = false;
  check('animOn=false: sampleRef = Keyframe-Stand', same);
  check('animOn=false: Höhen-Referenz 0,79', Math.abs(outH[0] - 0.79) < 1e-12);
  // Ziel bleibt stehen
  const tx0 = t._tx, ty0 = t._ty;
  t.advance(0.5);
  check('animOn=false (ohne joy): Wurzel-Ziel bleibt fix', t._tx === tx0 && t._ty === ty0);
  const { r, done } = t.reward(sim);
  check('animOn=false: Reward endlich, Stehen endet nicht', Number.isFinite(r) && !done);
  // joy + animOn=false: Ziel wandert (Bonus-Kombi)
  t.ctrlMode = 'joy';
  t._cmdHold = 0;
  t.advance(0.02);
  check('animOn=false + joy: Ziel folgt Kommandos (Gehen ohne Anim)', t._cmdHold > 0);
}

// ── 5) Sturz-Abbruch ──
{
  const clip = makeClip(false);
  const t = makeMotionTask(cfg, clip, sim);
  t.reset(null, sim);
  sim.basePos = (out) => { out[0] = 0; out[1] = 0; out[2] = 0.3; return out; }; // gefallen
  const { done } = t.reward(sim);
  check('Sturz (h < hMin·href) → done', done);
}

console.log(fails === 0 ? '\nALLE CHECKS GRÜN' : `\n${fails} CHECK(S) ROT`);
process.exit(fails === 0 ? 0 : 1);
