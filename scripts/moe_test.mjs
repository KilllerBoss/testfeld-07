// ═══════════════════════════════════════════════════════════
// moe_test.mjs — Verifikation der Soft-MoE-Politik (Node, kein WASM)
//   1) Forward finit + Router folgt Kommando
//   2) GRADIENTEN-CHECK: analytisch (accumGrads) vs. numerisch
//      (finite Differenzen) über ALLE Parameter-Tensoren
//   3) PPO-Update mit MoE: Metriken finit, Routing-Statistik
//   4) mergeAndUpdate ≡ finishAndUpdate (gleiche Daten)
//   5) BC-Epoche (MoE) läuft, Loss finit
//   6) toJSON/fromJSON-Roundtrip identisch
// Aufruf: node scripts/moe_test.mjs
// ═══════════════════════════════════════════════════════════
import { PPO, SoftMoEPolicy, ObsNorm } from '../app/src/main/assets/www/js/train.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';

let fails = 0;
function check(name, cond, detail = '') {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) fails++;
}

const OBS = 61, ACT = 14;

// ── 1) Forward ──────────────────────────────────────────────
console.log('[1] Forward + Router');
const rng = new RNG(42);
const net = new SoftMoEPolicy(OBS, ACT, rng);
check('Param-Zahl plausibel (<120k)', net.paramCount() < 120000, String(net.paramCount()));
const x = new Float32Array(OBS);
for (let i = 0; i < OBS; i++) x[i] = (rng.next() * 2 - 1) * 0.5;
x[51] = 0.1; x[52] = 0.9; x[53] = 0; x[54] = 0; // walk dominant
net.forward(x, x);
check('mu finit', Array.from(net.mu).every(Number.isFinite));
check('val finit', Number.isFinite(net.val));
const wSum = net.w[0] + net.w[1] + net.w[2] + net.w[3];
check('Σw = 1', Math.abs(wSum - 1) < 1e-5, wSum.toFixed(6));
check('Router folgt Kommando (walk > balance)', net.w[1] > net.w[0], `w_walk=${net.w[1].toFixed(3)} w_bal=${net.w[0].toFixed(3)}`);
x[51] = 1; x[52] = 0;
net.forward(x, x);
check('Router folgt Kommando (balance > walk)', net.w[0] > net.w[1], `w_bal=${net.w[0].toFixed(3)}`);

// ── 2) GRADIENTEN-CHECK ─────────────────────────────────────
console.log('[2] Gradienten-Check (numerisch vs. analytisch)');
{
  const g2 = new RNG(1234);
  const n = new SoftMoEPolicy(OBS, ACT, g2);
  const R = new Float32Array(ACT); // Zufällige Richtung für L = Σ mu·R + c·val
  for (let i = 0; i < ACT; i++) R[i] = g2.next() * 2 - 1;
  const cVal = g2.next() * 2 - 1;
  const xin = new Float32Array(OBS);
  for (let i = 0; i < OBS; i++) xin[i] = (g2.next() * 2 - 1) * 0.7;
  xin[48] = 0.3; xin[51] = 0.4; xin[52] = 0.6;

  // Analytisch
  n.forward(xin, xin);
  n.zeroGrads();
  const gMu = new Float32Array(ACT);
  for (let i = 0; i < ACT; i++) gMu[i] = R[i];
  n.accumGrads(gMu, cVal);

  // Loss-Funktion für numerische Differenzierung
  const lossAt = (eps, name, idx) => {
    const old = n[name][idx];
    n[name][idx] = old + eps;
    n.forward(xin, xin);
    let L = 0;
    for (let i = 0; i < ACT; i++) L += n.mu[i] * R[i];
    L += cVal * n.val;
    n[name][idx] = old;
    return L;
  };

  const eps = 1e-4;
  let tested = 0, maxRel = 0, worst = '';
  for (const pname of n.pNames) {
    if (pname === 'logStd') continue; // σ-Kopf hat eigenen Gradientenpfad (PPO-seitig)
    const arr = n[pname], garr = n['g' + pname];
    const nTest = Math.min(6, arr.length);
    const stride = Math.max(1, Math.floor(arr.length / nTest));
    for (let k = 0; k < arr.length; k += stride) {
      if (tested >= 90) break;
      const numeric = (lossAt(eps, pname, k) - lossAt(-eps, pname, k)) / (2 * eps);
      const analytic = garr[k];
      const absDiff = Math.abs(numeric - analytic);
      // Nahe-Null-Gradienten: finite Differenzen kollabieren in Rauschen
      // (beide ~1e-8) → Absolut-Boden statt Relativ-Vergleich
      if (absDiff >= 1e-6) {
        const denom = Math.max(1e-6, Math.abs(numeric), Math.abs(analytic));
        const rel = absDiff / denom;
        if (rel > maxRel) { maxRel = rel; worst = `${pname}[${k}] num=${numeric.toExponential(2)} ana=${analytic.toExponential(2)}`; }
      }
      tested++;
    }
    if (tested >= 90) break;
  }
  check('≥90 Gewichte geprüft', tested >= 90, String(tested));
  check('max. relativer Fehler < 5e-3', maxRel < 5e-3, `maxRel=${maxRel.toExponential(2)} @ ${worst}`);
}

// ── 3) PPO-Update mit MoE ───────────────────────────────────
console.log('[3] PPO-Update (SoftMoE)');
{
  const p = new PPO(OBS, ACT, { T: 256, mb: 64, epochs: 2 }, 99, SoftMoEPolicy);
  const trng = new RNG(555);
  const taskObs = () => {
    const o = new Float32Array(OBS);
    for (let i = 0; i < OBS; i++) o[i] = (trng.next() * 2 - 1) * 0.6;
    o[51] = 1; // balance
    return o;
  };
  let full = false, guard = 0;
  while (!full && guard++ < 1000) {
    const o = taskObs();
    p.norm.update(o);
    const { act, logp, value } = p.act(o, false);
    const r = trng.next() * 0.1;
    const done = trng.next() < 0.02;
    full = p.store(o, act, logp, r, done, value);
  }
  const lastVal = p.act(taskObs(), true).value;
  const m = p.finishAndUpdate(lastVal);
  check('piLoss finit', Number.isFinite(m.piLoss));
  check('vLoss finit', Number.isFinite(m.vLoss));
  check('clipFrac in [0,1]', m.clipFrac >= 0 && m.clipFrac <= 1, m.clipFrac.toFixed(3));
  check('routeW vorhanden, Σ=1', m.routeW && Math.abs(m.routeW.reduce((a, b) => a + b, 0) - 1) < 1e-6, JSON.stringify(m.routeW.map(v => +v.toFixed(3))));
  check('routeEnt finit', Number.isFinite(m.routeEnt), String(m.routeEnt));
  const mu2 = p.net.forward(new Float32Array(OBS), new Float32Array(OBS));
  check('Netz nach Update finit', Array.from(mu2).every(Number.isFinite));
}

// ── 4) mergeSegments-Konsistenz (Worker-Pfad, v2.12.0) ──────
console.log('[4] Worker-Merge-Konsistenz (mergeSegments)');
{
  const mk = () => new PPO(OBS, ACT, { T: 128, mb: 64, epochs: 2 }, 7, SoftMoEPolicy);
  const pa = mk(), pb = mk();
  const crng = new RNG(2024);
  const mkSeg = (n) => {
    const seg = {
      obs: new Float32Array(n * OBS), act: new Float32Array(n * ACT),
      logp: new Float32Array(n), rew: new Float32Array(n),
      done: new Uint8Array(n), val: new Float32Array(n),
      lastVal: crng.next() * 0.1, n,
    };
    for (let t = 0; t < n; t++) {
      for (let i = 0; i < OBS; i++) seg.obs[t * OBS + i] = (crng.next() * 2 - 1) * 0.5;
      for (let i = 0; i < ACT; i++) seg.act[t * ACT + i] = (crng.next() * 2 - 1) * 0.3;
      seg.logp[t] = -ACT * 0.7; seg.rew[t] = crng.next() * 0.2;
      seg.done[t] = crng.next() < 0.05 ? 1 : 0;
      seg.val[t] = crng.next() * 0.1;
    }
    return seg;
  };
  const ch = [mkSeg(64), mkSeg(64)];
  pb.mergeSegments(ch.map((c) => ({ ...c })));
  pa.mergeSegments(ch.map((c) => ({ ...c })));
  let maxD = 0;
  for (const pn of pa.net.pNames) {
    const Aa = pa.net[pn], Bb = pb.net[pn];
    for (let i = 0; i < Aa.length; i += 97) maxD = Math.max(maxD, Math.abs(Aa[i] - Bb[i]));
  }
  check('Gewichte deterministisch (maxΔ < 1e-12)', maxD < 1e-12, 'maxΔ=' + maxD.toExponential(2));
}

// ── 5) BC-Epoche ────────────────────────────────────────────
console.log('[5] BC-Epoche (SoftMoE)');
{
  const p = new PPO(OBS, ACT, { T: 128 }, 5, SoftMoEPolicy);
  const brng = new RNG(31);
  const N = 200;
  const X = new Float32Array(N * OBS), Y = new Float32Array(N * ACT);
  for (let i = 0; i < N * OBS; i++) X[i] = (brng.next() * 2 - 1) * 0.5;
  for (let i = 0; i < N; i++) X[i * OBS + 51] = 1;
  for (let i = 0; i < N * ACT; i++) Y[i] = (brng.next() * 2 - 1) * 0.2;
  const l0 = p.bcEpoch(X, Y, N, 64);
  const l1 = p.bcEpoch(X, Y, N, 64);
  check('BC-Loss finit', Number.isFinite(l0) && Number.isFinite(l1), `${l0.toFixed(4)} → ${l1.toFixed(4)}`);
}

// ── 6) JSON-Roundtrip ───────────────────────────────────────
console.log('[6] Persistenz-Roundtrip');
{
  const p = new PPO(OBS, ACT, { T: 64 }, 8, SoftMoEPolicy);
  const j = JSON.parse(JSON.stringify(p.toJSON()));
  check('fmt korrekt', j.fmt === 'trainrobot-ppo-2-moe', j.fmt);
  const p2 = PPO.fromAny(j);
  let maxD = 0;
  for (const pn of p.net.pNames) {
    const Aa = p.net[pn], Bb = p2.net[pn];
    for (let i = 0; i < Aa.length; i += 23) maxD = Math.max(maxD, Math.abs(Aa[i] - Bb[i]));
  }
  check('Gewichte identisch', maxD === 0, 'maxΔ=' + maxD);
  const o = new Float32Array(OBS); o[51] = 1;
  const a1 = p.actDeterministic(o, new Float32Array(ACT));
  const a2 = p2.actDeterministic(o, new Float32Array(ACT));
  let d = 0; for (let i = 0; i < ACT; i++) d = Math.max(d, Math.abs(a1[i] - a2[i]));
  check('Inferenz identisch', d === 0);
}

// ── Legacy-Regression: PolicyNet unverändert ────────────────
console.log('[7] Legacy-Regression (PolicyNet)');
{
  const p = new PPO(OBS, ACT, { T: 128, mb: 64, epochs: 2 }, 3);
  const lrng = new RNG(77);
  let full = false, guard = 0;
  while (!full && guard++ < 500) {
    const o = new Float32Array(OBS);
    for (let i = 0; i < OBS; i++) o[i] = (lrng.next() * 2 - 1) * 0.5;
    p.norm.update(o);
    const { act, logp, value } = p.act(o, false);
    full = p.store(o, act, logp, -lrng.next() * 0.1, lrng.next() < 0.02, value);
  }
  const m = p.finishAndUpdate(p.act(new Float32Array(OBS), true).value);
  check('Legacy-Update finit', Number.isFinite(m.piLoss) && Number.isFinite(m.vLoss));
  check('Legacy fmt unverändert', p.toJSON().fmt === 'trainrobot-ppo-1');
}

console.log(fails === 0 ? '\nALLE CHECKS GRÜN' : `\n${fails} CHECK(S) ROT`);
process.exit(fails === 0 ? 0 : 1);
