// ═══════════════════════════════════════════════════════════
// physics_filter_test.mjs — v2.28.5 „Roboter zappelt/schlägt/springt/fällt
// bei ARDY" (Nutzer-Report) — DREI Fixes, jeder bewiesen:
//   0) Diagnose-Basis (Messbefund ardy_robot_diag.mjs): ARDY-Referenzen
//      haben Gelenk-Raten bis 63 rad/s (GLB: ~5) + Blick-Ruckler ±178°
//   1) smoothMotionPhysics — Rate-Klemme + Zero-Phase-EMA + yaw-Unwrap:
//      Raten ≤ rateMax, Sprünge weg, Bewegung bleibt (keine Phasenverschiebung)
//   2) fitSrcPosToRobot — grünes Skelett auf Geist-Größe fitten (Füße geerdet)
//   3) packMotion/unpackMotion: pf-Marker-Roundtrip (Idempotenz der Migration)
//   4) Verdrahtung: main.js (Migration + BC-Autostart + VERSION), build.gradle
// Usage: node scripts/physics_filter_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const { smoothMotionPhysics, fitSrcPosToRobot, PHYS_FILTER_VERSION, ardyMotionQuality } =
  await import(path.join(WWW, 'js/retarget.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};
const N = 100, NU = 29, FPS = 20;

function mkMotion(over = {}) {
  const q = new Float32Array(N * NU);
  for (let f = 0; f < N; f++)
    for (let j = 0; j < NU; j++)
      q[f * NU + j] = 0.1 * Math.sin(2 * Math.PI * f / 25 + j); // glatte Basis
  const h = new Float32Array(N); for (let f = 0; f < N; f++) h[f] = 0.72 + 0.01 * Math.sin(f);
  const root = new Float32Array(2 * N); for (let f = 0; f < N; f++) { root[2 * f] = 0.02 * f; root[2 * f + 1] = 0; }
  const yaw = new Float32Array(N); for (let f = 0; f < N; f++) yaw[f] = 0.01 * f;
  const baseQ = new Float32Array(4 * N); for (let f = 0; f < N; f++) baseQ[4 * f + 3] = 1;
  return Object.assign({ q, h, root, yaw, baseQ, n: N, nu: NU, fps: FPS, duration: N / FPS }, over);
}

const maxRate = (q, n, nu, dt) => {
  let mx = 0;
  for (let f = 0; f < n - 1; f++) for (let j = 0; j < nu; j++)
    mx = Math.max(mx, Math.abs(q[(f + 1) * nu + j] - q[f * nu + j]) / dt);
  return mx;
};

// ── 1) smoothMotionPhysics ─────────────────────────────────
console.log('\n[1] smoothMotionPhysics — Rate-Klemme, EMA, yaw');
{
  const m = mkMotion();
  // 12 Riesen-Sprünge (50 rad/s) + ein ±178°-Blick-Ruckler + h-Zittern
  for (const f of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    for (const j of [3, 7, 15]) m.q[f * NU + j] += 2.5 * (j % 2 ? 1 : -1);
  }
  m.yaw[55] = m.yaw[54] + 3.12; // ~178° Ruckler
  m.yaw[56] = m.yaw[55] + 0.01;
  for (let f = 1; f < N; f += 2) m.h[f] += 0.06; // Höhen-Zittern

  const dt = 1 / FPS;
  const before = maxRate(m.q, N, NU, dt);
  const yawBefore = Math.abs(m.yaw[55] - m.yaw[54]);
  ok(before > 45, 'Testaufbau: Riesen-Raten vorhanden', before.toFixed(1) + ' rad/s');
  ok(yawBefore > 3.0, 'Testaufbau: Blick-Ruckler vorhanden', (yawBefore * 180 / Math.PI).toFixed(0) + '°');

  const res = smoothMotionPhysics(m);
  ok(res.changed === true, 'Filter meldet changed=true');
  const after = maxRate(m.q, N, NU, dt);
  ok(after <= 8 + 1e-5, 'Gelenk-Raten nach Filter ≤ 8 rad/s (STRENG)', before.toFixed(1) + ' → ' + after.toFixed(1));
  ok(res.before && res.before.max > 45 && res.after.max <= 8 + 1e-5, 'Statistik vor/nach im Ergebnis', res.before.max.toFixed(1) + ' → ' + res.after.max.toFixed(1));
  ok(res.yawBefore > 3.0 && res.yawAfter <= 3.0 / FPS + 1e-5, 'Blick-Ruckler unwrapped + geklemmt (≤ 3 rad/s je Frame)', 'Δ ' + (res.yawBefore * 180 / Math.PI).toFixed(0) + '° → ' + (res.yawAfter * 180 / Math.PI / FPS * FPS).toFixed(2) + ' rad/Frame');
  ok(m.pf === PHYS_FILTER_VERSION, 'pf-Marker gesetzt (PHYS_FILTER_VERSION=1)', String(m.pf));

  // Bewegung bleibt: glatte Sinus-Kanäle nur marginal verändert (≤ 15 % Amplitude)
  const m2 = mkMotion();
  const ref = m2.q.slice();
  smoothMotionPhysics(m2);
  let dev = 0;
  for (let i = 0; i < ref.length; i++) dev = Math.max(dev, Math.abs(m2.q[i] - ref[i]));
  ok(dev < 0.03, 'Saubere Bewegung bleibt erhalten (max. Abweichung < 0.03 rad)', dev.toFixed(4));

  // Zero-Phase: Sinus-Phase bleibt (Kreuzpunkt-Ort ±1 Frame)
  let lagBest = 0, best = Infinity;
  for (let lag = -3; lag <= 3; lag++) {
    let s = 0;
    for (let f = 5; f < N - 5; f++) s += Math.abs(m2.q[f * NU] - ref[(f + lag) * NU]);
    if (s < best) { best = s; lagBest = lag; }
  }
  ok(Math.abs(lagBest) <= 1, 'Zero-Phase-EMA: keine Phasenverschiebung', 'best lag=' + lagBest);

  // Höhen-Zittern geglättet
  const m3 = mkMotion();
  for (let f = 1; f < N; f += 2) m3.h[f] += 0.06;
  let hJmp0 = 0; for (let f = 1; f < N; f++) hJmp0 = Math.max(hJmp0, Math.abs(m3.h[f] - m3.h[f - 1]));
  smoothMotionPhysics(m3);
  let hJmp1 = 0; for (let f = 1; f < N; f++) hJmp1 = Math.max(hJmp1, Math.abs(m3.h[f] - m3.h[f - 1]));
  ok(hJmp1 < hJmp0 * 0.5, 'Höhen-Zittern mehr als halbiert', hJmp0.toFixed(3) + ' → ' + hJmp1.toFixed(3));

  // Idempotenz: zweiter Aufruf tut nichts
  const qSnap = m.q.slice();
  const res2 = smoothMotionPhysics(m);
  ok(res2.changed === false, 'Zweiter Aufruf = changed:false (pf-Marker)');
  let same = qSnap.length === m.q.length;
  for (let i = 0; same && i < qSnap.length; i++) if (qSnap[i] !== m.q[i]) same = false;
  ok(same, 'Zweiter Aufruf verändert NICHTS (bitweise)');
}

// ── Guards ─────────────────────────────────────────────────
console.log('\n[2] Guards (NaN/leer/kurz)');
{
  const res = smoothMotionPhysics(null);
  ok(res.changed === false, 'null → changed:false');
  const m = mkMotion({ n: 3, nu: NU });
  m.q = new Float32Array(3 * NU); m.h = new Float32Array(3);
  ok(smoothMotionPhysics(m).changed === false, 'n<4 → changed:false');
  const m2 = mkMotion();
  for (let i = 0; i < m2.q.length; i++) m2.q[i] = NaN;
  const r2 = smoothMotionPhysics(m2);
  ok(r2.changed === true, 'NaN-Timeline: Filter läuft crash-frei (Rates statisch NaN-safe)');
  ok(!Number.isFinite(m2.q[0]), 'NaN-Quelle bleibt NaN (keine Korruption durch Klemme/EMA — Sanitizer läuft vorher in der Pipeline)');
}

// ── 3) fitSrcPosToRobot ────────────────────────────────────
console.log('\n[3] fitSrcPosToRobot — Skelett auf Geist-Größe');
{
  const ROLES = ['hips', 'spine', 'head', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];
  const mkSrc = (hipH) => {
    const srcPos = new Float32Array(N * ROLES.length * 3);
    for (let f = 0; f < N; f++) {
      const o = (f * ROLES.length) * 3;
      srcPos[o + 2] = hipH + 0.01 * Math.sin(f);           // hips
      srcPos[o + 3 * 1 + 2] = hipH + 0.18;                  // spine
      srcPos[o + 3 * 2 + 2] = hipH + 0.45;                  // head
      srcPos[o + 3 * 5 + 2] = 0;                            // leftFoot (geerdet)
      srcPos[o + 3 * 8 + 2] = 0;                            // rightFoot (geerdet)
      srcPos[o] = 0.1 * f;                                  // hips x (Bahn)
    }
    return srcPos;
  };
  const m = mkMotion();
  m.srcJoints = ROLES.slice();
  m.srcPos = mkSrc(0.90); // Menschen-Größe
  m.h[0] = 0.72;          // G1-Geist-Hüfte
  const F = fitSrcPosToRobot(m);
  ok(F > 0.7 && F < 0.9, 'Faktor im erwarteten Bereich (0.72/0.90 ≈ 0.80)', 'F=' + F.toFixed(3));
  const hipsZ = m.srcPos[2];
  ok(Math.abs(hipsZ - 0.72) < 0.005, 'Hüfthöhe exakt auf Geist-Basishöhe', hipsZ.toFixed(4) + ' m');
  const nR = ROLES.length;
  ok(m.srcPos[(0 * nR + 5) * 3 + 2] === 0 && m.srcPos[(0 * nR + 8) * 3 + 2] === 0, 'Füße bleiben geerdet (0·F = 0)');
  ok(m.srcPos[0] < 0.1 * N, 'Bahn skaliert mit (konsistent)');
  const F2 = fitSrcPosToRobot(m);
  ok(F2 === 0, 'Idempotent: zweiter Aufruf = 0 (schon passend)');

  // maxFactor-Klemme: target/srcH = 0.30/0.90 = 0.333 → 1/F = 3 > maxFactor
  // → F wird auf 1/maxFactor = 0.714 begrenzt (Klemme symmetrisch um 1)
  const m4 = mkMotion(); m4.srcJoints = ROLES.slice(); m4.srcPos = mkSrc(0.90); m4.h[0] = 0.30;
  const F4 = fitSrcPosToRobot(m4, { maxFactor: 1.4 });
  ok(Math.abs(F4 - 1 / 1.4) < 1e-3, 'Klemme: F auf 1/maxFactor begrenzt', 'F=' + F4.toFixed(4));

  // Guards
  const g1 = mkMotion(); ok(fitSrcPosToRobot(g1) === 0, 'ohne srcPos → 0');
  const g2 = mkMotion(); g2.srcJoints = ROLES.slice(); g2.srcPos = mkSrc(NaN); ok(fitSrcPosToRobot(g2) === 0, 'NaN-Hüfte → 0');
  const g3 = mkMotion(); g3.srcJoints = ROLES.slice(); g3.srcPos = mkSrc(0.90); g3.h[0] = 0.05; ok(fitSrcPosToRobot(g3) === 0, 'unsinnige Zielhöhe → 0');
}

// ── 4) packMotion-Roundtrip mit pf ─────────────────────────
console.log('\n[4] packMotion/unpackMotion — pf-Marker persistiert');
{
  const m = mkMotion();
  m.name = 'T', m.mapped = [], m.duration = N / FPS;
  const rec = packMotion(m);
  ok(rec.pf === 0, 'ungefiltert: pf=0 im Paket');
  const u1 = unpackMotion(rec);
  ok(u1.pf === 0, 'unpack: pf=0 (Migration greift später)');
  smoothMotionPhysics(m);
  const rec2 = packMotion(m);
  ok(rec2.pf === PHYS_FILTER_VERSION, 'gefiltert: pf=1 im Paket');
  const u2 = unpackMotion(rec2);
  ok(u2.pf === PHYS_FILTER_VERSION, 'unpack: pf=1 — Idempotenz überlebt Persistenz');
  // alte Datensätze ohne pf-Feld
  const u3 = unpackMotion({ q: rec.q, h: rec.h, fps: FPS, n: N, nu: NU, duration: 5, mapped: [] });
  ok(u3.pf === 0, 'alter Bestand ohne pf-Feld → 0 (rückwärtskompatibel)');
}

// ── 5) Verdrahtung ─────────────────────────────────────────
console.log('\n[5] Verdrahtung (main.js / glbstore.js / build.gradle)');
{
  const main = readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
  ok(main.includes("smoothMotionPhysics, fitSrcPosToRobot, PHYS_FILTER_VERSION") && main.includes("ARDY_MV, mirrorMotionY } from './retarget.js'"), 'main.js importiert die drei neuen Exporte');
  ok(main.includes("const VERSION = '2.28.5'") || main.includes("const VERSION = '2.28.6'") || main.includes("const VERSION = '2.28.7'") || main.includes("const VERSION = '2.28.8'") || main.includes("const VERSION = '2.28.9'") || main.includes("const VERSION = '2.28.10'") || main.includes("const VERSION = '2.28.11'"), 'main.js VERSION 2.28.5-2.28.11');
  ok(main.includes('v2.28.5 ARDY-MIGRATION: PHYSIK-GLÄTTUNG + SKELETT-FIT'), 'activateClip: Migrationsblock vorhanden');
  ok(main.includes('smoothMotionPhysics(S.motionClip)'), 'Migration ruft smoothMotionPhysics');
  ok(main.includes('fitSrcPosToRobot(S.motionClip)'), 'Migration ruft fitSrcPosToRobot');
  ok(main.includes('(S.motionClip.pf || 0) < PHYS_FILTER_VERSION'), 'Migration prüft pf-Marker (keine Doppel-Glättung)');
  ok(main.includes("rec.src === 'ardy' && !S.trainer && S.task && S.task.kind === 'motion'"), 'BC-Autostart nur bei ARDY ohne Policy');
  ok(main.includes('runBC().catch'), 'BC-Autostart ruft runBC (bestehendes Supervised-Training)');
  ok(main.includes('Imitations-Vorab-Training'), 'BC-Autostart mit klarer deutscher Meldung');
  const grad = readFileSync(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(grad.includes('versionCode 46') || grad.includes('versionCode 47') || grad.includes('versionCode 48') || grad.includes('versionCode 49') || grad.includes('versionCode 50') || grad.includes('versionCode 51') || grad.includes('versionCode 52'), 'build.gradle versionCode 46-52');
  ok(grad.includes('versionName "2.28.5"') || grad.includes('versionName "2.28.6"') || grad.includes('versionName "2.28.7"') || grad.includes('versionName "2.28.8"') || grad.includes('versionName "2.28.9"') || grad.includes('versionName "2.28.10"') || grad.includes('versionName "2.28.11"'), 'build.gradle versionName 2.28.5-2.28.11');
  // ardyMotionQuality weiter exportiert (v2.28.3-Vertrag)
  ok(typeof ardyMotionQuality === 'function', 'ardyMotionQuality unverändert exportiert (v2.28.3-Vertrag)');
}

console.log('\n─ PHYSIK-FILTER-SUITE: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen ─');
if (fail > 0) process.exit(1);
