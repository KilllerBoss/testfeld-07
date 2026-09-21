// ═══════════════════════════════════════════════════════════
// ardy_retry_test.mjs — v2.28.3 ARDY AUTO-RETRY:
//   ▸ retarget.js ardyMotionQuality (reine Versuchs-Bewertung):
//       - saubere Bewegung (h≈0,78) → nicht kollabiert, score ≥ 1e9
//       - kollabierte Bewegung (Haufen am Boden, Nutzer-Screenshot
//         2026-09-21) → collapsed, score < 1e9
//       - Teilkollaps via hMin / via hMax, leerer/NaN-Track
//       - sanityBad: Sanitizer-Eingriff (NaN-Frames, >15 % repariert)
//       - Score-Ordnung: sauber > kollabiert; unter Gleichen höchste hMax
//   ▸ Retry-Loop-Semantik (Spiegel der runArdy-Schleife):
//       Versuch 1 kollabiert → Versuch 2 (Seed+202) sauber → bricht ab,
//       bestes Ergebnis gewinnt, attemptsUsed stimmt
//   ▸ Verdrahtungs-Pins main.js: MAX 3 Versuche, Seed-Eskalation,
//     Best-Wahl, Warnungen am gewählten Ergebnis, VERSION 2.28.3
// Usage: node scripts/ardy_retry_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

const { ardyMotionQuality } = await import(path.join(WWW, 'js/retarget.js'));

console.log('\n[1] ardyMotionQuality — saubere Bewegung');
{
  const h = new Float32Array(100).map((_, i) => 0.78 + 0.03 * Math.sin(i / 9));
  const q = ardyMotionQuality({ h }, null, 100);
  ok(!q.collapsed && !q.bad, 'Stehen/Gehen (h 0,75–0,81) ist NICHT kollabiert');
  ok(q.score >= 1e9, 'sauberer Versuch: score ≥ 1e9 (' + q.score + ')');
  ok(Math.abs(q.hMin - 0.75) < 1e-5 && Math.abs(q.hMax - 0.81) < 1e-5, 'hMin/hMax exakt erfasst (0,75/0,81, float32-Toleranz)');
}

console.log('\n[2] ardyMotionQuality — Kollaps (Nutzer-Screenshot-Symptom)');
{
  const h = new Float32Array(120).fill(0.22); // Geist als Haufen am Boden
  const q = ardyMotionQuality({ h }, null, 120);
  ok(q.collapsed && q.bad, 'komplett kollabiert (h=0,22) → bad');
  ok(q.score < 1e9, 'kollabierter Versuch verliert gegen jeden sauberen');
  const q2 = ardyMotionQuality({ h: new Float32Array(60).fill(0.30) }, null, 60);
  ok(q2.score > q.score, 'weniger kollabiert (0,30) gewinnt unter Kollabierten (0,22)');
}
{
  const h = Array.from({ length: 50 }, (_, i) => (i < 25 ? 0.90 : 0.10)); // halb ok, halb eingesunken
  const q = ardyMotionQuality({ h }, null, 50);
  ok(q.collapsed && q.hMin === 0.10 && q.hMax === 0.90, 'Teilkollaps via hMin erkannt (0,10 < 0,32)');
}
{
  const h = Array.from({ length: 40 }, (_, i) => 0.42 + 0.06 * (i % 2)); // niedrige Decke, nie unter 0,32
  const q = ardyMotionQuality({ h }, null, 40);
  ok(q.collapsed && q.hMin === 0.42 && q.hMax === 0.48, 'Teilkollaps via hMax erkannt (0,48 < 0,55)');
}

console.log('\n[3] ardyMotionQuality — leerer/NaN-Track');
{
  const q = ardyMotionQuality({}, null, 0);
  ok(q.collapsed && q.bad && q.hMin === 0 && q.hMax === 0, 'leerer h-Track = Kollaps (nicht Infinity-Leck)');
  const qNaN = ardyMotionQuality({ h: new Float32Array([0.78, NaN, 0.77]) }, null, 3);
  ok(!qNaN.bad && Math.abs(qNaN.hMax - 0.78) < 1e-6, 'einzelner NaN wird ignoriert, Finite bleiben maßgeblich');
  const qAll = ardyMotionQuality({ h: new Float32Array([NaN, NaN]) }, null, 2);
  ok(qAll.bad && qAll.hMin === 0, 'Track nur aus NaN = Kollaps');
}

console.log('\n[4] ardyMotionQuality — Sanitizer-Metriken (sanityBad)');
{
  const h = new Float32Array(100).fill(0.78);
  ok(!ardyMotionQuality({ h }, undefined, 100).sanityBad, 'keine sanity-Metrik → nicht verdächtig');
  ok(!ardyMotionQuality({ h }, { nanFrames: 0, fixedFrames: 2 }, 100).sanityBad, '2/100 repariert (≤ 15 %) → ok');
  ok(ardyMotionQuality({ h }, { nanFrames: 0, fixedFrames: 20 }, 100).sanityBad, '20/100 repariert (> 15 %) → sanityBad');
  ok(ardyMotionQuality({ h }, { nanFrames: 1, fixedFrames: 0 }, 100).sanityBad, '1 NaN-Frame → sanityBad');
  ok(!ardyMotionQuality({ h }, { nanFrames: 1, fixedFrames: 0 }, 0).sanityBad, 'frameCount 0 → keine Sanity-Bewertung (Div/0-Wache)');
  ok(ardyMotionQuality({ h }, { nanFrames: 1, fixedFrames: 0 }, 100).bad, 'sanityBad macht den Versuch bad (Retry-Auslöser)');
}

console.log('\n[5] Retry-Loop-Semantik (Spiegel der runArdy-Schleife)');
{
  // simuliert: Versuch 1 kollabiert, Versuch 2 sauber → Loop bricht bei 2 ab
  const gen = [
    { h: new Float32Array(80).fill(0.20), sanity: null, frameCount: 80, seed: 7 },
    { h: new Float32Array(80).fill(0.78), sanity: null, frameCount: 80, seed: 209 },
  ];
  const ARDY_MAX_ATTEMPTS = 3;
  let best = null, attemptsUsed = 0;
  for (let attempt = 1; attempt <= ARDY_MAX_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    const useSeed = attempt === 1 ? 7 : 7 + attempt * 101; // wie main.js
    const g = gen[attempt - 1];
    const q = ardyMotionQuality({ h: g.h }, g.sanity, g.frameCount);
    if (!best || q.score > best.q.score) best = { out: g, q };
    if (!q.bad) break;
  }
  ok(attemptsUsed === 2, 'Loop bricht nach dem ersten sauberen Versuch ab (2, nicht 3)');
  ok(best.out.seed === 209 && best.q.score >= 1e9, 'bestes (sauberes) Ergebnis gewinnt: Seed 209, h=0,78');
  // alle kollabiert → bester der drei, bad bleibt true (Warnung)
  const genBad = [0.20, 0.30, 0.25].map((v) => ({ h: new Float32Array(10).fill(v), sanity: null, frameCount: 10 }));
  best = null; attemptsUsed = 0;
  for (let attempt = 1; attempt <= ARDY_MAX_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    const g = genBad[attempt - 1];
    const q = ardyMotionQuality({ h: g.h }, g.sanity, g.frameCount);
    if (!best || q.score > best.q.score) best = { out: g, q };
    if (!q.bad) break;
  }
  ok(attemptsUsed === 3, 'alle kollabiert → alle 3 Versuche');
  ok(best.q.collapsed && Math.abs(best.q.hMax - 0.30) < 1e-6, 'best-of-3 = der am wenigsten kollabierte (0,30) — Warnung bleibt aktiv');
}

console.log('\n[6] Verdrahtungs-Pins (main.js)');
{
  const mainJs = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const retJs = await readFile(path.join(WWW, 'js/retarget.js'), 'utf8');
  ok(mainJs.includes('const ARDY_MAX_ATTEMPTS = 3;'), 'ARDY_MAX_ATTEMPTS = 3');
  ok(mainJs.includes('seed0 + attempt * 101'), 'Seed-Eskalation bei Retry (seed0 + attempt·101)');
  ok(mainJs.includes("const useSeed = attempt === 1 ? seed0 :"), 'Versuch 1 nutzt den Nutzer-Seed unverändert');
  ok(mainJs.includes('Neuer Versuch ' + "' + attempt + '/" ) || mainJs.includes("'Neuer Versuch '"), 'Statuszeile: „Neuer Versuch n/3 …“');
  ok(mainJs.includes('ardyMotionQuality(motion, out.sanity, out.frameCount)'), 'Qualität aus motion + Sanitizer-Metriken bewertet');
  ok(mainJs.includes('q.score > best.q.score'), 'Best-Wahl über Score');
  ok(mainJs.includes('if (!q.bad) break;'), 'Loop bricht beim ersten sauberen Versuch ab');
  ok(mainJs.includes('sauberes Ergebnis nach '), 'Log: sauberes Ergebnis nach n Versuchen');
  ok(mainJs.includes('if (best.q.collapsed) {'), 'Kollaps-Warnung am GEWÄHLTEN Ergebnis (nach Retry)');
  ok(mainJs.includes('attemptsUsed'), 'Warnung nennt die Versuchsanzahl');
  ok(mainJs.includes('ardyMotionQuality } from'), 'Import: ardyMotionQuality aus retarget.js');
  ok(retJs.includes('export function ardyMotionQuality'), 'retarget.js: ardyMotionQuality exportiert');
  ok(mainJs.includes("const VERSION = '2.28.4';"), 'VERSION 2.28.4');
  const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(gradle.includes('versionCode 45') && gradle.includes('versionName "2.28.4"'), 'versionCode 45 / versionName 2.28.4');
}

console.log('\n═══ Ergebnis: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen ═══');
if (fail > 0) process.exit(1);
