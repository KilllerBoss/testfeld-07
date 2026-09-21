// ═══════════════════════════════════════════════════════════
// ardy_smooth_test.mjs — v2.28.11 „PLAYBACK-GLÄTTUNG"
// Nutzer: „Perfekt. Zittert aber. Wie ist es bei ardy mini space
// auf hugginface? Hat man dort mit Glättung?"
//
// Space-Analyse (intsuc/ardy-mini, assets/index-DHzs1hy7.js.map):
//   KEIN Filter im Decoder-Stream (kein EMA/Low-Pass, kein Fenster-
//   Naht-Blending) — Glättung NUR im Playback: float frameCursor,
//   Lerp für Positionen, slerpQuaternions für Rotationen.
//
// Beweise:
//   [A] sampleArdyDisplay: Lerp-Exaktheit, Wrap (i1 = (i0+1) % n),
//       Höhen-Lerp, baseQ-Slerp kürzester Pfad, u=0/1-Identität
//   [B] JITTER-METRIK: 60-Hz-Anzeige-Sampling — max Gelenksprung je
//       Render-Frame interpoliert << Nearest-Frame (floor)
//   [C] KONSISTENZ: Anzeige-Pose == Physik-Referenz (sampleRef, blend=1)
//       bitnah für ein 60-Hz-Phasen-Raster — der Geist zeigt exakt die
//       Pose, die die Policy trackt
//   [D] ghostAnchor 'folgt': Anker interpoliert (kein Math.floor mehr)
//   [E] GLB unverändert: Else-Zweig bleibt Nearest-Frame (fr*clip.nu)
//   [F] Version 2.28.11 / versionCode 52
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JS = path.join(ROOT, 'app/src/main/assets/www/js');

let fails = 0, count = 0;
const ok = (c, m, extra = '') => {
  count++;
  if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : ''));
  else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); }
};

// ── Test-Clip: 20 fps, 40 Frames (2 s Loop), 3 Gelenke ──────
const N = 40, FPS = 20, NU = 3;
const mkClip = () => {
  const q = new Float32Array(N * NU);
  for (let f = 0; f < N; f++) {
    for (let j = 0; j < NU; j++) {
      q[f * NU + j] = 0.3 * Math.sin(2 * Math.PI * f / N + j) + (j === 0 ? 0.1 : 0);
    }
  }
  const h = new Float32Array(N);
  for (let f = 0; f < N; f++) h[f] = 0.79 + 0.01 * Math.sin(2 * Math.PI * f / N);
  const baseQ = new Float32Array(4 * N); // Nick-Schwankung ±5°
  for (let f = 0; f < N; f++) {
    const a = 0.0436 * Math.sin(2 * Math.PI * f / N) / 2;
    baseQ[4 * f] = Math.sin(a); baseQ[4 * f + 3] = Math.cos(a);
  }
  return { n: N, fps: FPS, nu: NU, q, h, baseQ };
};

// [A] sampleArdyDisplay — Funktionsprüfungen
console.log('\n[A] sampleArdyDisplay — Mathematik');
const { sampleArdyDisplay, makeMotionTask } = await import(path.join(JS, 'motiontask.js'));

{
  const clip = mkClip();
  const outQ = new Float32Array(NU), outH = new Float32Array(1), outBQ = new Float32Array(4);

  // A1: Halb-Frame = exaktes Mittel (t = phase·n; n=40 → phase=0.0125 ⇒ t=0.5)
  sampleArdyDisplay(clip, 0.0125, outQ, outH, outBQ);
  const m0 = (clip.q[0] + clip.q[NU]) / 2, m1 = (clip.q[1] + clip.q[NU + 1]) / 2, m2 = (clip.q[2] + clip.q[NU + 2]) / 2;
  ok(Math.abs(outQ[0] - m0) < 1e-6 && Math.abs(outQ[1] - m1) < 1e-6 && Math.abs(outQ[2] - m2) < 1e-6,
    'A1 Lerp bei t=0.5 = exaktes Mittel der Nachbar-Frames (float32-Toleranz)',
    `Δ=${Math.abs(outQ[0] - m0).toExponential(2)}`);
  ok(Math.abs(outH[0] - (clip.h[0] + clip.h[1]) / 2) < 1e-6, 'A1b Höhen-Lerp bei t=0.5', `h=${outH[0].toFixed(6)}`);

  // A2: Wrap am Loop-Ende (i1 = (i0+1) % n) — t=39.5 → phase=0.9875
  sampleArdyDisplay(clip, 0.9875, outQ, outH, outBQ);
  const w0 = (clip.q[39 * NU] + clip.q[0]) / 2;
  ok(Math.abs(outQ[0] - w0) < 1e-6, 'A2 Wrap: t=39.5 interpoliert Frame 39 → 0 (endlos)', `q0=${outQ[0].toFixed(6)} vs ${w0.toFixed(6)}`);

  // A3: u=0 / u=1 Identität (exakter Frame) — t=2 → phase=0.05, t=3 → 0.075
  sampleArdyDisplay(clip, 0.05, outQ, outH, outBQ);
  ok(outQ[0] === clip.q[2 * NU] && outQ[1] === clip.q[2 * NU + 1], 'A3 u=0 → exakter Clip-Frame (keine Rundung am Frame-Grenzpunkt)');
  sampleArdyDisplay(clip, 0.075, outQ, outH, outBQ);
  ok(outQ[0] === clip.q[3 * NU], 'A3b Frame-Grenze → exakter nächster Frame');

  // A4: baseQ-Slerp kürzester Pfad (d < 0 → Flip)
  const c2 = mkClip();
  c2.baseQ[0] = 1; c2.baseQ[1] = 0; c2.baseQ[2] = 0; c2.baseQ[3] = 0;        // Frame 0
  c2.baseQ[4] = -1; c2.baseQ[5] = 0; c2.baseQ[6] = 0; c2.baseQ[7] = 0;       // Frame 1 = −q0
  const bq = new Float32Array(4);
  sampleArdyDisplay(c2, 0.0125, outQ, outH, bq); // t=0.5
  ok(Math.abs(bq[0]) > 0.999 && Math.abs(bq[1]) < 1e-6, 'A4 Slerp kürzester Weg: q und −q (dieselbe Rotation) interpolieren zur Identität — kein 360°-Schwenk',
    `[${bq.map(v => v.toFixed(3))}]`);

  // A5: Slerp 90°-Rotation, u=0.5 → 22.5°
  const c3 = mkClip();
  const a45 = Math.PI / 4, a225 = Math.PI / 8;
  c3.baseQ[4] = Math.sin(a45); c3.baseQ[7] = Math.cos(a45);
  sampleArdyDisplay(c3, 0.0125, outQ, outH, bq);
  ok(Math.abs(bq[0] - Math.sin(a225)) < 1e-6 && Math.abs(bq[3] - Math.cos(a225)) < 1e-6,
    'A5 Slerp 90°-Drehung bei u=0.5 → exakt 22.5°', `err=${Math.abs(bq[0] - Math.sin(a225)).toExponential(2)}`);

  // A6: Norm = 1
  let maxDev = 0;
  for (let k = 0; k <= 20; k++) {
    sampleArdyDisplay(c3, 0.0125 * k / 20, outQ, outH, bq);
    const nrm = Math.hypot(bq[0], bq[1], bq[2], bq[3]);
    maxDev = Math.max(maxDev, Math.abs(nrm - 1));
  }
  ok(maxDev < 1e-6, 'A6 Slerp-Ausgabe normiert über den ganzen Pfad', `max|‖q‖−1|=${maxDev.toExponential(2)}`);

  // A7: keine baseQ → Rückgabe null
  const c4 = mkClip(); delete c4.baseQ;
  ok(sampleArdyDisplay(c4, 0.05, outQ, outH, bq) === null, 'A7 Clip ohne baseQ → null (setGhostPose bq=null)');

  // A8: outH optional
  const hSave = outH[0];
  sampleArdyDisplay(clip, 0.06, outQ, null, bq);
  ok(outH[0] === hSave, 'A8 outH optional (kein Crash, kein Schreibzugriff)');
}

// [B] JITTER-METRIK: Anzeige-Sampling 60 Hz — floor vs. interpoliert
console.log('\n[B] Jitter-Metrik (60-Hz-Anzeige, 20-Hz-Motion)');
{
  const clip = mkClip();
  const outQ = new Float32Array(NU), outH = new Float32Array(1), outBQ = new Float32Array(4);
  const maxStep = (get) => {
    let prev = null, max = 0;
    for (let k = 0; k <= 60; k++) { // 1 s bei 60 Hz
      const phase = (k / 60) * FPS / N; // k/60 s × fps/n
      const cur = get(phase);
      if (prev !== null) max = Math.max(max, Math.abs(cur - prev));
      prev = cur;
    }
    return max;
  };
  const floorStep = maxStep((ph) => clip.q[Math.floor(ph * N) % N * NU]); // ALT: fr = floor(phase*n)
  sampleArdyDisplay(clip, 0, outQ, outH, outBQ);
  let prev = new Float32Array(outQ), maxI = 0;
  for (let k = 1; k <= 60; k++) {
    const phase = (k / 60) * FPS / N;
    sampleArdyDisplay(clip, phase, outQ, outH, outBQ);
    maxI = Math.max(maxI, Math.abs(outQ[0] - prev[0]));
    prev.set(outQ);
  }
  ok(maxI < floorStep * 0.6, 'B max Gelenksprung je Render-Frame: interpoliert < 60 % des Nearest-Frame',
    `floor=${floorStep.toExponential(3)} → interp=${maxI.toExponential(3)} rad (Faktor ${(floorStep / maxI).toFixed(1)} glatter)`);
  ok(floorStep > 0 && maxI > 0, 'B beide Pfade messen echte Bewegung (keine Null-Messung)');
}

// [C] KONSISTENZ: Anzeige == Physik-Referenz (sampleRef, blend=1) bei n == fps
// (dort sind Timeline-Skala phase·n und Referenz-Skala phase·fps identisch);
// bei n ≠ fps ist die Referenz-Skala ein dokumentierter SEPARATER Befund.
console.log('\n[C] Konsistenz Anzeige ↔ Physik-Referenz (n == fps)');
{
  const CN = 20; // n = fps = 20 → Skalen identisch
  const q = new Float32Array(CN * NU);
  for (let f = 0; f < CN; f++) for (let j = 0; j < NU; j++) q[f * NU + j] = 0.3 * Math.sin(2 * Math.PI * f / CN + j);
  const h = new Float32Array(CN);
  for (let f = 0; f < CN; f++) h[f] = 0.79 + 0.01 * Math.sin(2 * Math.PI * f / CN);
  const clip = { n: CN, fps: CN, nu: NU, q, h };
  const cfg = { nu: NU, h0: 0.79, actSpan: 1.0 };
  const task = makeMotionTask(cfg, clip, null);
  task.animOn = true; task.dropAnim = false; task.tElapsed = 1.0; // blend = 1
  const dispQ = new Float32Array(NU), dispH = new Float32Array(1);
  const refQ = new Float64Array(NU), refH = new Float64Array(1);
  let maxDq = 0, maxDh = 0;
  for (let k = 0; k < 121; k++) {
    const phase = (k / 120) % 1;
    sampleArdyDisplay(clip, phase, dispQ, dispH, new Float32Array(4));
    task.sampleRef(phase, refQ, refH);
    for (let j = 0; j < NU; j++) maxDq = Math.max(maxDq, Math.abs(dispQ[j] - refQ[j]));
    maxDh = Math.max(maxDh, Math.abs(dispH[0] - refH[0]));
  }
  ok(maxDq < 1e-6 && maxDh < 1e-6, 'C Anzeige-Pose == sampleRef-Pose (n == fps, blend=1) über 60-Hz-Raster',
    `max|Δq|=${maxDq.toExponential(2)} rad, max|Δh|=${maxDh.toExponential(2)} m`);
}

// [D] ghostAnchor 'folgt' interpoliert
console.log('\n[D] ghostAnchor \'folgt\' — Anker-Glättung');
{
  const clip = mkClip();
  clip.root = new Float32Array(2 * N); clip.yaw = new Float32Array(N);
  for (let f = 0; f < N; f++) {
    // VOLL ZYKLISCHE Bahnen (Sinus) — Loop-Naht glatt, die Metrik misst
    // ausschließlich 20-Hz-Treppen vs. Sub-Frame-Glättung
    clip.root[2 * f] = 0.3 * Math.sin(2 * Math.PI * f / N);
    clip.root[2 * f + 1] = 0.3 * Math.cos(2 * Math.PI * f / N);
    clip.yaw[f] = 0.05 * Math.sin(2 * Math.PI * f / N);
  }
  const cfg = { nu: NU, h0: 0.79, actSpan: 1.0 };
  const task = makeMotionTask(cfg, clip, null);
  task.refMode = 'folgt';
  const out = [0, 0, 0], robot = [1.0, 2.0], yawR = 0.3;
  let prev = null, maxI = 0, prevF = null, maxF = 0;
  for (let k = 0; k <= 120; k++) {
    const phase = (k / 120) % 1;
    task.ghostAnchor(phase, robot, yawR, out);
    if (prev) maxI = Math.max(maxI, Math.abs(out[0] - prev[0]), Math.abs(out[2] - prev[2]));
    prev = [...out];
    // Referenz: alte floor-Formel (t = phase·fps, Skala unverändert)
    const t = (phase * FPS) % N, i = Math.floor(t);
    const ax = robot[0] + (clip.root[2 * i] - clip.root[0]);
    const ay2 = yawR + ((clip.yaw[i] || 0) - (clip.yaw[0] || 0));
    if (prevF) maxF = Math.max(maxF, Math.abs(ax - prevF[0]), Math.abs(ay2 - prevF[2]));
    prevF = [ax, 0, ay2];
  }
  ok(maxI < maxF, 'D interpolierter Anker springt weniger als die alte floor-Version',
    `floor=${maxF.toExponential(3)} → interp=${maxI.toExponential(3)}`);
  // Wrap-Check (separater Clip mit π-Sprung bei f=10): der Sprung wird über
  // den KÜRZESTEN Weg interpoliert (aufsteigend +3.12 rad, kein Umschlag auf
  // die −π-Seite/kein Schwenk −3.16)
  const cj = mkClip();
  cj.root = new Float32Array(2 * N); cj.yaw = new Float32Array(N);
  for (let f = 0; f < N; f++) { cj.root[2 * f] = 0; cj.root[2 * f + 1] = 0; cj.yaw[f] = f < N / 4 ? 0.01 : Math.PI - 0.01; }
  const task2 = makeMotionTask({ nu: NU, h0: 0.79, actSpan: 1.0 }, cj, null);
  task2.refMode = 'folgt';
  const o1 = [0, 0, 0], o2 = [0, 0, 0];
  task2.ghostAnchor((N / 4 - 0.5) / FPS, robot, yawR, o1); // kurz vor dem Sprung (t=9.5)
  task2.ghostAnchor((N / 4 + 0.0) / FPS, robot, yawR, o2); // am Sprung (t=10)
  const d1 = o1[2] - yawR, d2 = o2[2] - yawR;
  ok(d1 > 0 && d2 > 0 && d1 < Math.PI && d2 < Math.PI, 'D yaw-Wrap: Sprung über kürzesten Weg (positiv, < π, kein −π-Schwenk)',
    `vor=${d1.toFixed(3)} nach=${d2.toFixed(3)} rad`);
}

// [E] Pins: main.js-Verdrahtung (GLB unverändert)
console.log('\n[E] Verdrahtungs-Pins');
{
  const main = await readFile(path.join(JS, 'main.js'), 'utf8');
  const mt = await readFile(path.join(JS, 'motiontask.js'), 'utf8');

  ok(main.includes("import { makeMotionTask, MOTION_R, sampleArdyDisplay } from './motiontask.js'"),
    'E1 main.js importiert sampleArdyDisplay');
  ok(main.includes('if (clip.srcOverlay) {'), 'E2 ARDY-Gate: Interpolation nur für srcOverlay-Clips');
  ok(main.includes('sampleArdyDisplay(clip, phase, S._dispQ, S._dispH, S._dispBQ)'), 'E3 Render-Loop ruft sampleArdyDisplay');
  ok(main.includes('S.sim.setGhostPose(gh, S._dispQ, 0, S._dispH[0], rr[0], rr[1], rr[2], dbq)'),
    'E4 Geist bekommt interpolierte Pose (off=0, interpolierte Höhe, Slerp-baseQ)');
  ok(main.includes('S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], rr[0], rr[1], rr[2], bq)'),
    'E5 GLB-Else-Zweig UNVERÄNDERT (Nearest-Frame, Original-Mesh-Pfad)');
  ok(/S\._dispQ \|\| S\._dispQ\.length !== clip\.nu/.test(main), 'E6 Scratch-Puffer (allokationsfrei je Render-Frame)');
  ok(main.includes('PLAYBACK-GLÄTTUNG'), 'E7 Fix-Dokumentation im Render-Loop');

  ok(mt.includes('export function sampleArdyDisplay'), 'E8 motiontask.js exportiert sampleArdyDisplay');
  ok(mt.includes('function slerpQ'), 'E9 Slerp (kürzester Pfad) vorhanden');
  const oneLine = (mt.match(/const i0 = Math\.floor\(t\), i1 = \(i0 \+ 1\) % c\.n, u = t - i0;/g) || []).length;
  const twoLine = (mt.match(/const i0 = Math\.floor\(t\), i1 = \(i0 \+ 1\) % c\.n;\s*\n\s*const u = t - i0;/g) || []).length;
  ok(oneLine + twoLine >= 4, 'E10 Einheitliche Interpolations-Formel (sampleArdyDisplay, ghostAnchor \'folgt\', refRoot, refSpeed)',
    `${oneLine + twoLine} Stellen (einzeilig ${oneLine}, mehrzeilig ${twoLine})`);
  ok(!/folgt' && robotPos[\s\S]{0,400}Math\.floor\(t\);\s*\n\s*out\[0\]/.test(mt),
    'E11 ghostAnchor \'folgt\': KEIN Math.floor mehr im Anker-Offset');

  // Version
  ok(main.includes("const VERSION = '2.28.11'"), 'F1 main.js VERSION 2.28.11');
  const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(/versionCode 52/.test(gradle) && /versionName "2.28\.11"/.test(gradle), 'F2 build.gradle versionCode 52 / 2.28.11');
}

console.log(`\n═══ ardy_smooth_test: ${count - fails}/${count} Checks bestanden ═══`);
if (fails) { console.error(`${fails} FEHLER`); process.exit(1); }
