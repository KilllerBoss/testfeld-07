// feld_v340_test.mjs — v3.4.0: ONNX-Export in den Download-Ordner ·
// Sturz-Verhalten (NEUSTART/WEITERÜBEN) · ONNX-Latenz-Probe + Warm-up ·
// Render-Blend-Basis je Zyklus
//
//   1) EXPORT: store.exportBytes über TrainrobotBridge.saveFile (MediaStore/
//      Downloads) — die Android-WebView führt kein <a download> aus; das alte
//      .onnx.json (JSON-Wrapper) war für echte Roboter unlesbar. Jetzt echte
//      feld-policy-<fmt>.onnx (rohes Protobuf).
//   2) STURZ: NEUSTART (Episode endet sofort) vs. WEITERÜBEN (recoverOnFall
//      + Aufsteh-Fenster recStepsMax, Slider) — Trainings-Terminierung wird
//      zur Nutzer-Wahl; Autosave/Import in-place.
//   3) ONNX: createSession misst Inferenz-Latenz (2 Warm-ups + 3 Läufe,
//      Median, Budget 8 ms) und springt trägele NPU/GPU-Provider automatisch
//      an (ruckartige Befehle in Schüben); Aktivierung warmt auf und füllt
//      S._ortMu mit einem echten Startbefehl (keine Null-Phase).
//   4) RENDER: snapPrev VOR JEDEM Aufholzyklus — Blend-Basis war bei 2+
//      Zyklen je Frame mehrere Zyklen alt (gestreckte Sprünge).
// Usage: node scripts/feld_v340_test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const F = join(WWW, 'js/feld/feld.js');
const ST = join(WWW, 'js/feld/store.js');
const OX = join(WWW, 'js/feld/onnxexport.js');
const RB = join(WWW, 'js/robots.js');
const HT = join(WWW, 'index.html');

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ FAIL ' + label); } };
const sec = (t) => console.log('\n— ' + t + ' —');

const feldjs = readFileSync(F, 'utf8');
const storejs = readFileSync(ST, 'utf8');
const onnxjs = readFileSync(OX, 'utf8');
const robotsjs = readFileSync(RB, 'utf8');
const html = readFileSync(HT, 'utf8');
const vjs = readFileSync(join(WWW, 'js/feld/version.js'), 'utf8');
const gradle = readFileSync(join(ROOT, 'app/build.gradle'), 'utf8');

// ════════════════ 1 · VERSION ════════════════
sec('VERSION 3.4.0 / 104');
ok(vjs.includes("export const VERSION = '3.4.0';") || vjs.includes("export const VERSION = '3.5.0';") || vjs.includes("export const VERSION = '3.6.0';") || vjs.includes("export const VERSION = '3.7.0';"), 'version.js VERSION = 3.4.0/3.5.0');
ok(vjs.includes('export const VERSION_CODE = 104;') || vjs.includes('export const VERSION_CODE = 105;') || vjs.includes('export const VERSION_CODE = 106;') || vjs.includes('export const VERSION_CODE = 107;'), 'version.js VERSION_CODE = 104/105');
ok((((gradle.includes('versionCode 104') && gradle.includes('versionName "3.4.0"') || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || (gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"'))))))) || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || (gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"')))))))) || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || (gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"')))))), 'build.gradle 104/3.4.0 oder 105/3.5.0');

// ════════════════ 2 · EXPORT — DOWNLOAD-ORDNER ════════════════
sec('ONNX-EXPORT — echte .onnx über die Android-Brücke');
ok(storejs.includes('export function exportBytes(name, u8, mime)'), 'store: exportBytes(name, u8, mime) existiert');
ok(storejs.includes('window.TrainrobotBridge') && storejs.includes('B.saveFile(name, u8ToB64(u8)'), 'store: native Brücke TrainrobotBridge.saveFile (base64) wird benutzt');
ok(storejs.includes("if (!ok) throw new Error('Android-Speicherung fehlgeschlagen (Download-Ordner)');"), 'store: Brücken-Fehler wird geworfen (kein stummer Verlust)');
ok(storejs.includes("return 'download';") && storejs.includes("return 'browser';"), 'store: Rückgabewert download|browser (Anzeige des Wegs)');
ok(storejs.includes('const CH = 0x8000;'), 'store: base64-Chunking 32k (kein Stack-Overflow bei großen Netzen)');
ok(storejs.includes('export function exportJSON(name, obj)'), 'store: exportJSON (Sitzungs-Export über denselben Weg)');
ok(storejs.includes("new Blob([u8], { type: mime || 'application/octet-stream' })"), 'store: Browser-Fallback (Blob) bleibt');
// feld.js verdrahtet den Export mit der echten Datei:
ok(feldjs.includes("const name = 'feld-policy-' + fmt + '.onnx';"), 'feld: Export-Name feld-policy-<fmt>.onnx (kein .json-Wrapper mehr)');
ok(feldjs.includes("store.exportBytes(name, bytes, 'application/octet-stream')"), 'feld: Bytes gehen über exportBytes (Download-Ordner)');
ok(!feldjs.includes("'feld-policy-' + fmt + '.onnx.json'") && !feldjs.includes('onnx: Array.from(bytes)'), 'feld: alter JSON-Wrapper-Export (.onnx.json + Array.from) ist ENTFERNT (nur der Historien-Kommentar bleibt)');
ok(feldjs.includes("' → Ordner Download'"), 'feld: Statuszeile nennt den Download-Ordner');
ok(feldjs.includes("store.exportJSON('feld-sitzung-'"), 'feld: Sitzungs-JSON über exportJSON (gleicher Weg)');
ok(html.includes('Download-Ordner</b> des Handys'), 'html: Hinweis nennt den Download-Ordner');
ok(html.includes('Eingang „obs“') && html.includes('„actions“'), 'html: Obs/Actions-Layout für den echten Roboter dokumentiert');
// Android-Seite unverändert vorhanden (Bridge schreibt nach MediaStore/Downloads):
const mainJava = readFileSync(join(ROOT, 'app/src/main/java/com/trainrobot/app/MainActivity.java'), 'utf8');
ok(mainJava.includes('public boolean saveFile(String name, String base64, String mime)'), 'Android: saveFile-Bridge vorhanden');
ok(mainJava.includes('MediaStore.Downloads.EXTERNAL_CONTENT_URI'), 'Android: MediaStore/Downloads als Ziel');

// ════════════════ 3 · STURZ-VERHALTEN ════════════════
sec('STURZ-VERHALTEN — NEUSTART vs. WEITERÜBEN');
ok(feldjs.includes("fallMode: 'reset',") && feldjs.includes('fallWinS: 6,'), 'S: fallMode/fallWinS angelegt');
ok(feldjs.includes("const FALL_MODES = [\n  { id: 'reset', label: 'NEUSTART' },\n  { id: 'ueben', label: 'WEITERÜBEN' },\n];"), 'FALL_MODES: NEUSTART + WEITERÜBEN');
ok(feldjs.includes('S.task.recoverOnFall = S.fallMode === \'ueben\';'), 'applyFallMode: recoverOnFall nur bei WEITERÜBEN');
ok(feldjs.includes('S.task.recStepsMax = Math.max(50, Math.min(1500, Math.round((S.fallWinS || 6) * 50)));'), 'applyFallMode: Fenster = winS × 50 Zyklen, geklemmt 1–30 s');
ok(feldjs.includes('function buildFallUI()') && feldjs.includes("const host = $('fallSeg');"), 'buildFallUI baut die Segmente');
ok(feldjs.includes("winRow.classList.toggle('dimrow', S.fallMode !== 'ueben')"), 'Fenster-Regler nur bei WEITERÜBEN aktiv (dimrow)');
ok(feldjs.includes('function setFallMode(m)') && feldjs.includes("S.fallMode = m === 'ueben' ? 'ueben' : 'reset';"), 'setFallMode normalisiert die Wahl');
ok(feldjs.includes('applyFallMode(); // v3.4.0: Sturz-Verhalten (recoverOnFall + Fenster) am Task'), 'Boot: applyFallMode am Task vor dem ersten reset()');
ok(feldjs.includes('buildFallUI();\n  const fw = $(\'fallWin\');'), 'wireTrainUI: Karte gebaut + Fenster-Slider verdrahtet');
ok(feldjs.includes("fall: { mode: S.fallMode || 'reset', winS: S.fallWinS || 6 },"), 'sessionBlob: Sturz-Verhalten im Autosave');
ok(feldjs.includes("if (sess.fall) {\n      S.fallMode = sess.fall.mode === 'ueben' ? 'ueben' : 'reset';"), 'applySession: Sturz-Verhalten wird restauriert (in-place)');
ok(html.includes('<div class="seg" id="fallSeg"></div>'), 'html: Segmente fallSeg vorhanden');
ok(html.includes('id="fallWin"') && html.includes('id="fallWinVal"'), 'html: Aufsteh-Fenster-Slider vorhanden');
ok(html.includes('STURZ-VERHALTEN'), 'html: Karte STURZ-VERHALTEN im Train-Tab');
ok(html.includes('Längeres Anpassen pro Runde'), 'html: Hint erklärt WEITERÜBEN');
// Task-Maschinerie (robots.js) existiert und passt:
ok(robotsjs.includes('recoverOnFall: false,'), 'robots: recoverOnFall-Feld existiert');
ok(robotsjs.includes('recStepsMax: 300,'), 'robots: recStepsMax-Feld existiert (Default 6 s)');
ok(robotsjs.includes('_enterRecover(steps)') && robotsjs.includes('this._recSteps = Math.max(50, steps | 0);'), 'robots: Aufsteh-Fenster (_enterRecover) vorhanden');
ok(robotsjs.includes('if (this.recoverOnFall && rW.recover > 0) {'), 'robots: Sturz → Recover-Fenster statt Sofort-Abbruch (wenn aktiviert)');
ok(robotsjs.includes("done = this._recSteps <= 0;"), 'robots: nur das Fenster beendet die Episode im Recover-Modus');

// ════════════════ 4 · ONNX — LATENZ-PROBE + WARM-UP ════════════════
sec('ONNX-AKTIVIERUNG — schnellster Provider, Warm-up, Startbefehl');
ok(onnxjs.includes('async function probeMs(session, ort, dim, runs = 3)'), 'onnxexport: Latenz-Probe (2 Warm-ups + 3 gemessene Läufe)');
ok(onnxjs.includes('await run1(); await run1(); // Warm-up'), 'onnxexport: Warm-ups kompilieren Kernel/Allocator VOR der Messung');
ok(onnxjs.includes('xs.sort((a, b) => a - b);') && onnxjs.includes('return xs[Math.floor(runs / 2)];'), 'onnxexport: Median (robust gegen Ausreißer)');
ok(onnxjs.includes('const budgetMs = opts.budgetMs || 8;'), 'onnxexport: Budget 8 ms (Regelzyklus 20 ms)');
ok(onnxjs.includes('if (ms < 0 || ms <= budgetMs) return cand; // schnell genug'), 'onnxexport: schnelles EP gewinnt sofort');
ok(onnxjs.includes('lastOk = cand; // zu langsam — gemerkt, Kette weiterprobieren'), 'onnxexport: träges EP wird übersprungen');
ok(onnxjs.includes('if (lastOk) return lastOk; // alles über Budget → schnellster gefunden'), 'onnxexport: Notfall liefert den SCHNELLESTEN statt zu werfen');
ok(onnxjs.includes('export async function createSession(onnxBytes, epMode = \'auto\', ort = null, opts = {})'), 'onnxexport: createSession-API rückwärtskompatibel (opts optional)');
ok(feldjs.includes("{ warmDim: D, budgetMs: 8 }"), 'feld: Aktivierung übergibt warmDim (Probe aktiv)');
ok(feldjs.includes('const warm = new Float32Array(D); // v3.6.0: Null-Kommando = neutrale Stand-Startlage'), 'feld: Warm-up-Obs = Null-Kommando (v3.6.0: kein Skill/Style-Vektor mehr — Pollen-Obs)');
ok(feldjs.includes('S._ortMu = Float32Array.from(out.actions.data);') && feldjs.includes('Startbefehl aus dem Warm-up'), 'feld: Startbefehl aus dem Warm-up (keine Null-Phase)');
ok(feldjs.includes("' · ~' + ms.toFixed(1) + ' ms/Inferenz'"), 'feld: epReal zeigt die gemessenen ms');
ok(feldjs.includes('S._liveAcc = 0; // frischer Takt'), 'feld: Zeitakkumulator startet frisch nach der Aktivierung');
// EP-Ketten unverändert (auto/cpu/gpu/npu):
ok(onnxjs.includes("auto: [{ name: 'webnn', deviceType: 'npu' }, { name: 'webnn', deviceType: 'gpu' }, 'webgpu', 'wasm'],"), 'onnxexport: Auto-Kette NPU→GPU→wasm bleibt');
ok(onnxjs.includes("cpu: ['wasm'],"), 'onnxexport: CPU-Kette bleibt');
ok(html.includes('werden automatisch übersprungen'), 'html: Hinweis auf die automatische Provider-Auswahl');
// ONNX-Pfad in liveCycle unverändert rückwärtsfest (v3.3.0-Semantik):
ok(feldjs.includes('const mu = S._ortMu || (S._ortMu = new Float32Array(task.actDim));'), 'liveCycle: hält letzten Befehl (v3.3.0-Semantik bleibt)');

// ════════════════ 5 · RENDER — BLEND-BASIS JE ZYKLUS ════════════════
sec('RENDER — snapPrev vor JEDEM Aufholzyklus');
ok(feldjs.includes('S.sim.snapPrev(); // v3.4.0: Basis = Zustand vor DIESEM Zyklus'), 'feld: snapPrev INNERHALB der Aufholschleife');
const loopIdx = feldjs.indexOf('while (S._liveAcc >= CYC && guard < 15) {');
const loopEnd = feldjs.indexOf('if (performance.now() - t0 > 9) break;', loopIdx);
const loopBody = feldjs.slice(loopIdx, loopEnd);
ok(loopBody.includes('snapPrev()') && loopBody.indexOf('snapPrev()') < loopBody.indexOf('liveCycle();'), 'Reihenfolge in der Schleife: snapPrev VOR liveCycle');
ok(feldjs.includes('S.sim.snapPrev(); // Pose VOR diesem Frame für die Render-Interpolation sichern'), 'feld: Pre-Loop-snapPrev bleibt (Frames ohne Schritt blenden weiter)');
ok(feldjs.includes('while (S._liveAcc >= CYC && guard < 15) {'), 'Aufholschleife (v3.3.0) bleibt');

// ════════════════ 6 · MEDIANS-MATHEMATIK ════════════════
sec('MATH — Median + Klemmen (Spiegel der Logik)');
{
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  ok(med([40, 1, 2]) === 2, 'Median [40,1,2] = 2 (NPU-Ausreißer wird ignoriert)');
  ok(med([9, 8, 7]) === 8, 'Median [9,8,7] = 8');
  const clampSteps = (s) => Math.max(50, Math.min(1500, Math.round(s * 50)));
  ok(clampSteps(6) === 300, '6 s → 300 Zyklen (Robots-Default)');
  ok(clampSteps(20) === 1000, '20 s → 1000 Zyklen');
  ok(clampSteps(0.2) === 50, 'Unterklemme 50 Zyklen (1 s)');
  ok(clampSteps(99) === 1500, 'Oberklemme 1500 Zyklen (30 s)');
}

// ════════════════ 7 · REGRESSION — PINS ════════════════
sec('REGRESSION — alte Features unangetastet');
ok(feldjs.includes("task._schubLive = !!(S.schubser && S.schubser.on && S.schubser.live);"), 'v3.2.0: Schubser-Live-Gating bleibt');
ok(feldjs.includes('groundPhoneStep(0.02); // v3.2.0: Handy + beweglicher Boden JE Zyklus (wie im Training)'), 'v3.2.0: Boden+Handy je Zyklus bleibt');
ok(feldjs.includes('if (cmdDriven()) pushUserCmd();'), 'v3.1.0: Konsole/Generator verdrahtet bleibt');
ok(feldjs.includes('const CYC = 0.02;'), 'v3.3.0: Regelzyklus 0,02 s bleibt');
ok(feldjs.includes('if (S._liveAcc > CYC * 4) S._liveAcc = CYC; // Notbremse'), 'v3.3.0: Notbremse bleibt');
ok(feldjs.includes("S._liveAcc = Math.min(0.25, (S._liveAcc || 0) + Math.max(0, dt));"), 'v3.3.0: Zeitakkumulator bleibt');

console.log('\n══════════════════════════════════════');
console.log('PASS ' + pass + ' · FAIL ' + fail);
process.exit(fail ? 1 : 0);
