// feld_live_v33_test.mjs — v3.3.0: POLICY-Betrieb in ECHTZEIT
//   1) Live-Loop wanduhrgetrieben (Zeitakkumulator + Aufholbudget) statt
//      „ein Zyklus je Render-Frame" (war: Zeitlupe bei 30 fps, Zittern
//      bei schwankender fps, Überlicht bei 120 Hz)
//   2) ONNX entkoppelt: Physik wartet nicht auf die Inferenz (letzter
//      Befehl wird gehalten) — vorher fror die Sim beim Inferenz-Warten ein
//   3) Render-Interpolation (snapPrev/renderPose) gegen das 50/60-Hz-Beat
//   4) Pacing-Simulation: 30/60/120 fps und Jitter → alle ~50 Zyklen/s
// Usage: node scripts/feld_live_v33_test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const F = join(WWW, 'js/feld/feld.js');
const EN = join(WWW, 'js/engine.js');
const RD = join(WWW, 'js/render3d.js');

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ FAIL ' + label); } };
const sec = (t) => console.log('\n— ' + t + ' —');

const feldjs = readFileSync(F, 'utf8');
const enginejs = readFileSync(EN, 'utf8');
const rdjs = readFileSync(RD, 'utf8');
const vjs = readFileSync(join(WWW, 'js/feld/version.js'), 'utf8');
const gradle = readFileSync(join(ROOT, 'app/build.gradle'), 'utf8');

// ════════════════ 1 · VERSION ════════════════
sec('VERSION 3.3.0 / 103');
ok(vjs.includes("export const VERSION = '3.3.0';") || vjs.includes("export const VERSION = '3.4.0';") || vjs.includes("export const VERSION = '3.5.0';") || vjs.includes("export const VERSION = '3.6.0';"), 'version.js VERSION = 3.3.0/3.4.0/3.5.0');
ok(vjs.includes('export const VERSION_CODE = 103;') || vjs.includes('export const VERSION_CODE = 104;') || vjs.includes('export const VERSION_CODE = 105;') || vjs.includes('export const VERSION_CODE = 106;'), 'version.js VERSION_CODE = 103/104/105');
ok(gradle.includes('versionCode 103') && gradle.includes('versionName "3.3.0"') || (((gradle.includes('versionCode 104') && gradle.includes('versionName "3.4.0"') || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || (gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"'))))) || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || (gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"')))))), 'build.gradle 103 / 3.3.0');

// ════════════════ 2 · ECHTZEIT-LOOP ════════════════
sec('LIVE-LOOP — wanduhrgetrieben');
ok(feldjs.includes('function liveTick(dt)'), 'liveTick nimmt dt (echte Zeit) entgegen');
ok(feldjs.includes("S._liveAcc = Math.min(0.25, (S._liveAcc || 0) + Math.max(0, dt));"), 'Zeitakkumulator (App-Wechsel-Sprünge auf 0,25 s begrenzt)');
ok(feldjs.includes('const CYC = 0.02;'), 'Regelzyklus 0,02 s (10 Substeps × 0,002 s)');
ok(feldjs.includes('while (S._liveAcc >= CYC && guard < 15)'), 'Aufholschleife mit Guard 15');
ok(feldjs.includes('if (performance.now() - t0 > 9) break; // Aufholbudget: Render nie würgen'), '9-ms-Aufholbudget je Frame');
ok(feldjs.includes('if (S._liveAcc > CYC * 4) S._liveAcc = CYC; // Notbremse'), 'Notbremse gegen Zeitsprünge nach Systemlast');
ok(feldjs.includes('liveTick(dt);'), 'Loop ruft liveTick mit dt');
ok(feldjs.includes('_liveAcc: 0,') && feldjs.includes('_ortMu: null,'), 'S-Felder _liveAcc/_ortMu angelegt');
ok(feldjs.includes('task._schubLive = !!(S.schubser && S.schubser.on && S.schubser.live);'), 'Schubser-Live-Gating bleibt erhalten');
ok(feldjs.includes('if (cmdDriven()) pushUserCmd();'), 'Konsole/Befehls-Generator bleibt verdrahtet');

// ════════════════ 3 · ONNX ENTKOPPELT ════════════════
sec('ONNX — Physik wartet nicht mehr auf die Inferenz');
ok(feldjs.includes('function liveCycle()'), 'liveCycle: ein Regelzyklus gekapselt');
ok(feldjs.includes("S._ortMu = Float32Array.from(out.actions.data);"), 'Inferenz-Ergebnis wird gehalten (S._ortMu)');
ok(feldjs.includes('const mu = S._ortMu || (S._ortMu = new Float32Array(task.actDim));'), 'Hält letzten Befehl, solange Inferenz läuft');
// Physikschritt muss IMMER laufen — auch wenn S._ortBusy noch true ist:
const ortBlock = feldjs.slice(feldjs.indexOf('if (S.ortInfer) {'), feldjs.indexOf('} else {', feldjs.indexOf('if (S.ortInfer) {')));
ok(ortBlock.includes('sim.ctrl[i] = task._ref[i] + mu[i];') && ortBlock.includes('sim.stepN(10);'), 'ONNX-Pfad: Referenz+Offset aufs ctrl + stepN(10) JE Zyklus (kein Einfrieren; v3.6.0 Roboter-Aktuation)');
ok(!/\} else if \(!S\._ortBusy\) \{/.test(feldjs), 'Alter Fehlerzustand weg: „kein Schritt solange _ortBusy" ist entfernt');
ok(ortBlock.includes('task.reward(sim);') && ortBlock.includes('task.lastAct[i] = mu[i];'), 'ONNX-Pfad: reward + lastAct je Zyklus');
ok(feldjs.includes('groundPhoneStep(0.02); // v3.2.0: Handy + beweglicher Boden JE Zyklus (wie im Training)'), 'Boden+Handy JE Zyklus (Simzeit — war vorher fps-abhängig)');

// ════════════════ 4 · RENDER-INTERPOLATION ════════════════
sec('RENDER-INTERPOLATION');
ok(feldjs.includes('S.sim.snapPrev(); // Pose VOR diesem Frame für die Render-Interpolation sichern'), 'feld.js: snapPrev vor der Aufholschleife');
ok(feldjs.includes("S.sim.renderPose(Math.min(1, S._liveAcc / 0.02))"), 'feld.js: interpolierte Pose (alpha = Restzeit/Zyklus)');
ok(feldjs.includes("S.renderer.updateFrame(S.sim, dt, livePose);"), 'Renderer bekommt Pose im POLICY-Betrieb');
ok(enginejs.includes('snapPrev() {') && enginejs.includes('renderPose(alpha) {'), 'engine: snapPrev + renderPose');
ok(enginejs.includes('invalidateRender() { this._rsOn = false; this._rsDidStep = true; }'), 'engine: Reset invalidiert Interpolation');
ok(enginejs.includes('for (let i = 0; i < n; i++) m.mj_step(this.model, this.data);\n    this._rsDidStep = true;'), 'engine: stepN markiert Schritte (Blend-Base steht nur bei echten Schritten)');
ok(enginejs.includes('this.ctrl.set(this.keyCtrl);\n    this.invalidateRender();'), 'engine: resetToKeyframe ruft invalidateRender');
ok(rdjs.includes('updateFrame(sim, dt, pose) {'), 'render3d: updateFrame nimmt optionale Pose');
ok(rdjs.includes('const PX = pose ? pose.xpos : null, PQ = pose ? pose.xquat : null;'), 'render3d: Pose-Verzweigung (xpos/xquat)');
ok(rdjs.includes('if (PX) { p[0] = PX[3 * bb]; p[1] = PX[3 * bb + 1]; p[2] = PX[3 * bb + 2]; }'), 'render3d: Marker/Anker aus interpolierter Basis');

// Nlerp-Mathematik (Spiegel des engine-Codes, reine Zahlen):
sec('NLERP-MATHEMATIK (Vorzeichen-Flip + Normierung)');
{
  // Gegenprobe: q2 = -q1 ist DIESELBE Rotation — Interp(0.5) muss q1 liefern
  const q1 = [1, 0, 0, 0], q2 = [-1, 0, 0, 0]; // (w, x, y, z)
  const dot = q2[0] * q1[0] + q2[1] * q1[1] + q2[2] * q1[2] + q2[3] * q1[3];
  const sgn = dot < 0 ? -1 : 1;
  const w = q1[0] + (q2[0] * sgn - q1[0]) * 0.5;
  const n = Math.hypot(w, 0, 0, 0) || 1;
  ok(Math.abs(w / n - 1) < 1e-12, 'Gegenphasen-Quaternion blendet zu Identität (kein Flip-Artefakt)');
  // 90°-Nicken halbiert: Interp(0.5) liegt bei 45°
  const h = Math.SQRT1_2;
  const a = [1, 0, 0, 0], b = [h, h, 0, 0]; // 90° um X
  const d2 = b[0] * a[0] + b[1] * a[1] + b[2] * a[2] + b[3] * a[3];
  const s2 = d2 < 0 ? -1 : 1;
  const qw = a[0] + (b[0] * s2 - a[0]) * 0.5, qx = a[1] + (b[1] * s2 - a[1]) * 0.5;
  const half = 2 * Math.acos(Math.min(1, Math.hypot(qw, qx)));
  ok(Math.abs(half - Math.PI / 4) < 1e-9, 'Halbe Blendung = halber Winkel (45° von 90°)');
}

// ════════════════ 5 · PACING-SIMULATION ════════════════
sec('PACING — 30/60/120 fps + Jitter → alle ~50 Zyklen/s (Echtzeit)');
{
  // Spiegel der liveTick-Logik (Zeitakkumulator + Guard + Notbremse,
  // ohne das 9-ms-Budget — das ist das Gerätelimit, nicht die Semantik)
  const sim = (frameMs, seconds) => {
    let acc = 0, steps = 0;
    const frames = Math.round(seconds * 1000 / frameMs);
    for (let f = 0; f < frames; f++) {
      acc = Math.min(0.25, acc + frameMs / 1000);
      let guard = 0;
      while (acc >= 0.02 && guard < 15) { acc -= 0.02; guard++; steps++; }
      if (acc > 0.08) acc = 0.02;
    }
    return steps / seconds;
  };
  const r30 = sim(1000 / 30, 10), r60 = sim(1000 / 60, 10), r120 = sim(1000 / 120, 10);
  ok(Math.abs(r30 - 50) < 1, '30 fps → ' + r30.toFixed(1) + ' Zyklen/s (war 30 = 0,6× Zeitlupe)');
  ok(Math.abs(r60 - 50) < 1, '60 fps → ' + r60.toFixed(1) + ' Zyklen/s (war 60 = 1,2×)');
  ok(Math.abs(r120 - 50) < 1, '120 fps → ' + r120.toFixed(1) + ' Zyklen/s (war 120 = 2,4× Überlicht)');
  // Jitter: Frames 16–60 ms gemischt (Handy under Last)
  let acc = 0, steps = 0, t = 0;
  const pattern = [16, 33, 50, 20, 41, 16, 60, 25];
  while (t < 10000) {
    const fm = pattern[steps % pattern.length];
    t += fm;
    acc = Math.min(0.25, acc + fm / 1000);
    let guard = 0;
    while (acc >= 0.02 && guard < 15) { acc -= 0.02; guard++; steps++; }
    if (acc > 0.08) acc = 0.02;
  }
  const rj = steps / (t / 1000);
  ok(Math.abs(rj - 50) < 1.5, 'Jitter-Pattern → ' + rj.toFixed(1) + ' Zyklen/s (konstant, kein Zittern mehr)');
  // Aufholen nach Last-Spitze: 10 Frames à 200 ms (Hänger), dann 60-fps-Erholung
  let acc2 = 0, st2 = 0, t2 = 0;
  for (let f = 0; f < 10; f++) { t2 += 200; acc2 = Math.min(0.25, acc2 + 0.2); while (acc2 >= 0.02 && st2 - st2 < 15) { acc2 -= 0.02; st2++; if (acc2 <= 0.08) break; } if (acc2 > 0.08) acc2 = 0.02; }
  const stBefore = st2;
  for (let f = 0; f < 60; f++) { t2 += 16.7; acc2 = Math.min(0.25, acc2 + 0.0167); while (acc2 >= 0.02) { acc2 -= 0.02; st2++; } }
  ok(st2 - stBefore <= 62, 'Nach Last-Hänger kein Schrittschub (Notbremse greift): ' + (st2 - stBefore) + ' Zyklen in 1 s');
}

// ════════════════ 6 · TRAINING UNBERÜHRT ════════════════
sec('TRAINING — Budget-Semantik unverändert');
ok(feldjs.includes('const did = S.trainer.pump(S.budget);'), 'trainTick pumppt weiter budgetiert');
ok(feldjs.includes('budget: 30,               // RL-Schritte je Animation-Frame (nur TRAINING)'), 'Budget-Kommentar stellt Klarstellung „nur TRAINING"');
ok(feldjs.includes('S.renderer.updateFrame(S.sim, dt, livePose);') && feldjs.includes("S.mode === 'live' ? S.sim.renderPose"), 'Nur Live bekommt Interpolation — Trainings-Ansicht unverändert');

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
