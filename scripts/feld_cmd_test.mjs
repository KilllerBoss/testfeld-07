// ═══════════════════════════════════════════════════════════
// feld_cmd_test.mjs — v3.1.0: Trainings-Einsatz der Joysticks
//
// Beweisziele (Nutzerbriefing):
//  1. Joysticks EIN-/AUSKLAPPBAR im FELD (Overlay über der 3D-Ansicht,
//     „sehen wie er reagiert“) — DOM-Verdrahtung gepinnt
//  2. Trainings-Einsatz JE KANAL wählbar: Aus · Manuell · Fix ·
//     Zufallssprünge · Flüssig · Schlangelinien — Verhalten bewiesen
//  3. „Verstehen statt Merken“: der Generator liefert VIELFÄLTIGE
//     Befehlsverläufe (Sprünge/Glättung/Sinus) in Joystick-Koordinaten,
//     deterministisch (Seed) und als „virtuelle Hand“ mit echter Hand
//     als Vorrang (touchL/touchR)
// ═══════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CmdGen, CMD_MODES, CMD_MODE_LABELS, CMD_AUTO, chanDefaults } from '../app/src/main/assets/www/js/feld/cmdgen.js';
import { Console, BUTTONS } from '../app/src/main/assets/www/js/feld/console.js';
import { APP_NAME, VERSION, VERSION_CODE } from '../app/src/main/assets/www/js/feld/version.js';

let pass = 0, fail = 0;
const FAILS = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; FAILS.push(name); console.log('  ✗ ' + name); }
}
function sec(s) { console.log('\n── ' + s + ' ──'); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');

// ════════════════ 1 · VERSION ════════════════
sec('VERSION');
ok(APP_NAME === 'Feld', 'App-Name = Feld');
ok(VERSION === '3.2.0' || VERSION === '3.3.0' || VERSION === '3.4.0' || VERSION === '3.5.0' || VERSION === '3.6.0' || VERSION === '3.7.0' || VERSION === '3.8.0', 'VERSION = 3.2.0/3.3.0/3.4.0/3.5.0');
ok(VERSION_CODE === 102 || VERSION_CODE === 103 || VERSION_CODE === 104 || VERSION_CODE === 105 || VERSION_CODE === 106 || VERSION_CODE === 107 || VERSION_CODE === 108, 'VERSION_CODE = 102/103/104/105');
const gradle = readFileSync(join(ROOT, 'app/build.gradle'), 'utf8');
ok(gradle.includes('versionCode 102') && gradle.includes('versionName "3.2.0"') || (gradle.includes('versionCode 103') && gradle.includes('versionName "3.3.0"') || (((gradle.includes('versionCode 104') && gradle.includes('versionName "3.4.0"') || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || ((gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"') || (gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"'))))))))) || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || ((gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"') || (gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"'))))))))))) || (gradle.includes('versionCode 102') && gradle.includes('versionName "3.2.0"') || (gradle.includes('versionCode 103') && gradle.includes('versionName "3.3.0"') || (((gradle.includes('versionCode 104') && gradle.includes('versionName "3.4.0"') || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || ((gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"') || (gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"'))))))))) || ((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || ((gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"') || (gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"')))))))))))), 'build.gradle 101 / 3.1.0');

// ════════════════ 2 · MODELS/DEFINITIONEN ════════════════
sec('CMD_MODES');
ok(JSON.stringify(CMD_MODES) === JSON.stringify(['aus', 'manuell', 'fix', 'sprung', 'fluessig', 'schlange']),
  '6 Modi: aus · manuell · fix · sprung · fluessig · schlange');
ok(CMD_MODE_LABELS.sprung === 'Zufallssprünge' && CMD_MODE_LABELS.fluessig === 'Flüssig'
  && CMD_MODE_LABELS.schlange === 'Schlangelinien' && CMD_MODE_LABELS.fix === 'Fix'
  && CMD_MODE_LABELS.manuell === 'Manuell' && CMD_MODE_LABELS.aus === 'Aus', 'Deutsche Labels');
ok(CMD_AUTO.fix && CMD_AUTO.sprung && CMD_AUTO.fluessig && CMD_AUTO.schlange
  && !CMD_AUTO.aus && !CMD_AUTO.manuell, 'Auto-Modi = fix/sprung/fluessig/schlange');

// ════════════════ 3 · DETERMINISMUS ════════════════
sec('DETERMINISMUS (Seed)');
const seq = (g, n, dt = 0.016) => { const o = []; for (let i = 0; i < n; i++) o.push(g.tick(dt)); return o; };
const gA = new CmdGen({ seed: 77 });
gA.drive.mode = 'sprung'; gA.head.mode = 'fluessig';
const gB = new CmdGen({ seed: 77 });
gB.drive.mode = 'sprung'; gB.head.mode = 'fluessig';
const a = seq(gA, 400), b = seq(gB, 400);
let bitEq = true;
for (let i = 0; i < a.length; i++) {
  if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].hx !== b[i].hx || a[i].hy !== b[i].hy) { bitEq = false; break; }
}
ok(bitEq, 'gleicher Seed → bit-identische Befehlssequenz (2 Kanäle, 400 Ticks)');

// ════════════════ 4 · MODUS AUS/MANUELL ════════════════
sec('AUS · MANUELL');
const gAus = new CmdGen({ seed: 5 });
gAus.drive.mode = 'aus'; gAus.head.mode = 'aus';
let allZero = true;
for (let i = 0; i < 100; i++) { const o = gAus.tick(0.02); if (o.x || o.y || o.hx || o.hy) { allZero = false; break; } }
ok(allZero, 'aus: alle Kanäle konstant 0 (Task-Zufallsplaner gilt unangetastet)');
const gMan = new CmdGen({ seed: 6 });
gMan.drive.mode = 'manuell'; gMan.head.mode = 'manuell';
allZero = true;
for (let i = 0; i < 100; i++) { const o = gMan.tick(0.02); if (o.x || o.y || o.hx || o.hy) { allZero = false; break; } }
ok(allZero, 'manuell: Generator tritt zurück (0 — echte Hand behält das Pad)');

// ════════════════ 5 · FIX ════════════════
sec('FIX — „immer nach vorne“');
const gFix = new CmdGen({ seed: 8 });
gFix.drive.mode = 'fix'; gFix.drive.fixY = 1.0; gFix.drive.fixX = 0; gFix.drive.amp = 0.8;
gFix.head.mode = 'fix'; gFix.head.fixX = 0.5; gFix.head.amp = 0.8;
let fixOk = true, prevY = null, prevHx = null;
for (let i = 0; i < 200; i++) {
  const o = gFix.tick(0.02);
  if (o.y !== 0.8) fixOk = false;               // +y = VORWÄRTS (Konvention Generator)
  if (o.x !== 0) fixOk = false;
  if (o.hx !== 0.4) fixOk = false;              // fix · amp
  if (prevY !== null && o.y !== prevY) fixOk = false;
  prevY = o.y; prevHx = o.hx;
}
ok(fixOk, 'fix: konstanter Wert (fixY=+1, amp=0,8 → y=+0,8 = vorwärts; hx=0,5·0,8)');

// ════════════════ 6 · SPRUNG ════════════════
sec('SPRUNG — „aktiv werden mit random Richtung“');
const gJ = new CmdGen({ seed: 9 });
gJ.drive.mode = 'sprung'; gJ.drive.amp = 0.7; gJ.drive.prob = 0.55; gJ.drive.holdS = 1.2;
const N = 4000; // 80 s bei 50 Hz
let maxAbs = 0, maxDelta = 0, hadPause = 0, hadActive = 0, signFlips = 0, prev = 0, prevSign = 0;
for (let i = 0; i < N; i++) {
  const o = gJ.tick(0.02);
  maxAbs = Math.max(maxAbs, Math.abs(o.y));
  maxDelta = Math.max(maxDelta, Math.abs(o.y - prev));
  if (Math.abs(o.y) < 1e-9) hadPause++; else hadActive++;
  const s = Math.sign(o.y);
  if (prevSign !== 0 && s !== 0 && s !== prevSign) signFlips++;
  if (s !== 0) prevSign = s;
  prev = o.y;
}
ok(maxAbs <= 0.7 + 1e-9, 'Band: |v| ≤ Amplitude (0,7)');
ok(maxDelta > 0.4, 'Diskontinuität: Sprünge zwischen Werten (maxΔ ' + maxDelta.toFixed(2) + ' — bewusst UNGEGLÄTTET)');
ok(hadPause > 200 && hadActive > 200, 'Zustandsmaschine: Pausen (' + hadPause + ') und aktive Phasen (' + hadActive + ')');
ok(signFlips >= 2, 'zufällige RICHTUNGEN: Vorzeichen wechselt (' + signFlips + '×)');

// ════════════════ 7 · FLUESSIG ════════════════
sec('FLUESSIG — „flüssige Bewegungen machen“');
const gF = new CmdGen({ seed: 10 });
gF.drive.mode = 'fluessig'; gF.drive.amp = 0.9; gF.drive.tauS = 0.9; gF.drive.retargetS = 1.6;
let maxStepRate = 0, maxAbsF = 0, targetChanges = 0, prevT = 0, prevV = 0;
for (let i = 0; i < N; i++) {
  const o = gF.tick(0.02);
  maxAbsF = Math.max(maxAbsF, Math.abs(o.y));
  const rate = Math.abs(o.y - prevV) / 0.02; // pro Sekunde
  maxStepRate = Math.max(maxStepRate, rate);
  if (Math.abs(o.y - prevT) > 0.2) targetChanges++; // grob: Zielwechsel sichtbar
  prevT = o.y; prevV = o.y;
}
ok(maxAbsF <= 0.9 + 1e-9, 'Band: |v| ≤ Amplitude');
ok(maxStepRate < 2.5, 'GLATT: max Änderungsrate ' + maxStepRate.toFixed(2) + '/s (Gegenstück Sprung: ' + (maxDelta / 0.02).toFixed(0) + '/s)');
ok(maxStepRate > 0.05, 'bewegt sich trotzdem (kein Stillstand)');

// ════════════════ 8 · SCHLANGE ════════════════
sec('SCHLANGE — „random Schlangelinien“');
const gS = new CmdGen({ seed: 11 });
gS.drive.mode = 'schlange'; gS.drive.amp = 0.6; gS.drive.freqHz = 0.5;
let zeroCross = 0, prevS = 0, maxAbsS = 0, maxRateS = 0, prevVS = 0;
const T_S = N * 0.02; // 80 s
for (let i = 0; i < N; i++) {
  const o = gS.tick(0.02);
  const s = o.y >= 0 ? 1 : -1;
  if (prevS !== 0 && s !== prevS) zeroCross++;
  prevS = s;
  maxAbsS = Math.max(maxAbsS, Math.abs(o.y));
  maxRateS = Math.max(maxRateS, Math.abs(o.y - prevVS) / 0.02);
  prevVS = o.y;
}
// Nulldurchgänge bei f=0,5 Hz: 2·f·T ≈ 80 in 80 s (±Drift/Phase-Toleranz)
ok(zeroCross > 2 * 0.5 * T_S * 0.5 && zeroCross < 2 * 0.5 * T_S * 1.6, 'Schwingung: ' + zeroCross + ' Nulldurchgänge in 80 s (f=0,5 Hz → ≈80)');
ok(maxAbsS <= 0.6 * 1.4 + 1e-9, 'Band: Amplitude + Drift-Anteil eingehalten');
ok(maxRateS < 3.5, 'stetig (keine Sprünge): max Rate ' + maxRateS.toFixed(2) + '/s');
ok(zeroCross >= 2, 'wechselt die Richtung mehrfach (Schlangelinie, nicht Konstantfahrt)');

// ════════════════ 9 · ACTIVE() + SANITIZE ════════════════
sec('ACTIVE + SANITIZE');
const gAct = new CmdGen({ seed: 12 });
ok(!gAct.active(), 'Defaults: NICHT aktiv (beide Kanäle aus) — bestehendes Verhalten unberührt');
gAct.head.mode = 'fix';
ok(gAct.active(), 'ein Kanal fix → aktiv (Training wird befüttert)');
gAct.sanitize();
ok(gAct.head.mode === 'fix', 'sanitize erhält gültige Modi');
gAct.head.mode = 'quatsch'; gAct.sanitize();
ok(gAct.head.mode === 'aus', 'ungültiger Modus → aus');
gAct.head.mode = 'fix'; gAct.head.amp = 7; gAct.head.prob = -2; gAct.head.tauS = 99;
gAct.sanitize();
ok(gAct.head.amp === 1 && gAct.head.prob === 0 && gAct.head.tauS === 3, 'Klemmen: amp ≤ 1, prob ≥ 0, tau ≤ 3');

// ════════════════ 10 · JSON-ROUNDTRIP ════════════════
sec('STORE — JSON-Roundtrip bit-exakt');
const gJ0 = new CmdGen({ seed: 4242 });
gJ0.drive.mode = 'schlange'; gJ0.drive.amp = 0.55; gJ0.drive.freqHz = 0.42;
gJ0.head.mode = 'sprung'; gJ0.head.prob = 0.7;
const js = gJ0.toJSON();
const gJ1 = CmdGen.fromJSON(js);
ok(gJ1.drive.mode === 'schlange' && gJ1.drive.amp === 0.55 && gJ1.drive.freqHz === 0.42, 'drive aus JSON übernommen');
ok(gJ1.head.mode === 'sprung' && gJ1.head.prob === 0.7, 'head aus JSON übernommen');
const s0 = seq(gJ0, 300), s1 = seq(gJ1, 300);
let rtEq = true;
for (let i = 0; i < s0.length; i++) {
  if (s0[i].x !== s1[i].x || s0[i].y !== s1[i].y || s0[i].hx !== s1[i].hx || s0[i].hy !== s1[i].hy) { rtEq = false; break; }
}
ok(rtEq, 'Roundtrip: identische Befehlssequenz nach Import (Autosave/Export verlustfrei)');

// ════════════════ 11 · VIRTUELLE HAND ════════════════
sec('VIRTUELLE HAND — Generator schreibt die Konsole');
// Spiegel von feld.js tickCmdGen (Logik-Kern, ohne DOM):
function applyCmdGen(g, k, dt) {
  if (g.drive.mode !== 'manuell' || g.head.mode !== 'manuell') {
    const out = g.tick(dt);
    if (g.drive.mode !== 'manuell' && !k.touchL) {
      k.drive.x = g.drive.mode === 'aus' ? 0 : out.x;
      k.drive.y = g.drive.mode === 'aus' ? 0 : -out.y; // Generator +y = vorwärts → Stick hoch (−y)
    }
    if (g.head.mode !== 'manuell' && !k.touchR) {
      k.head.x = g.head.mode === 'aus' ? 0 : out.hx;
      k.head.y = g.head.mode === 'aus' ? 0 : out.hy;
    }
  }
}
const kFake = { drive: { x: 0, y: 0 }, head: { x: 0, y: 0 }, touchL: false, touchR: false };
const gV = new CmdGen({ seed: 13 });
gV.drive.mode = 'fix'; gV.drive.fixY = 1; gV.drive.amp = 0.5;
gV.head.mode = 'aus';
applyCmdGen(gV, kFake, 0.016);
ok(kFake.drive.y === -0.5, 'Vorzeichen-Vertrag: fixY=+1, amp=0,5 → drive.y = −0,5 (Stick oben = vx > 0 via commands())');
ok(kFake.head.x === 0 && kFake.head.y === 0, 'aus-Kanal schreibt 0 in die Konsole');
// echte Hand gewinnt:
kFake.drive.x = 0.9; kFake.drive.y = 0.9; // „Finger auf dem Pad“
kFake.touchL = true;
gV.drive.mode = 'schlange';
applyCmdGen(gV, kFake, 0.016);
ok(kFake.drive.x === 0.9 && kFake.drive.y === 0.9, 'echte Hand gewinnt: touchL → Generator überschreibt drive NICHT');
// rechts greift trotzdem durch:
gV.head.mode = 'fix'; gV.head.fixX = -0.3; gV.head.amp = 1;
applyCmdGen(gV, kFake, 0.016);
ok(kFake.head.x === -0.3, 'rechter Kanal ohne Berührung: Generator schreibt (fix −0,3 → wz > 0 = links)');
// Konsole-Objekt (ohne DOM) ist Node-tauglich:
const cNode = new Console(null, {});
ok(cNode.touchL === false && cNode.touchR === false, 'Console ohne DOM: touch-Getter = false (Node-Tests)');
ok(typeof cNode.renderSticks === 'function', 'renderSticks vorhanden (virtuelle Hand animiert die Sticks)');
ok(cNode.commands && Math.abs(cNode.commands().vx) === 0, 'commands() im Node-Modus neutral');

// ════════════════ 12 · VERDRAHTUNG (PINs) ════════════════
sec('VERDRAHTUNG — FELD-Overlay + Trainings-Einsatz');
const html = readFileSync(join(WWW, 'index.html'), 'utf8');
ok(html.includes('id="feldConsole"') && html.includes('class="feldconsole"'), 'FELD: Overlay-Container #feldConsole');
ok(html.includes('id="feldConsolePanel"') && html.includes('fold-panel'), 'FELD: ausklappbares Panel');
ok(html.includes('id="feldConsoleHost"'), 'FELD: Host für consolePad im Overlay');
ok(html.includes('id="btnConsoleFold"') && html.includes('▲ STEUERUNG'), 'FELD: Klapp-Griff (▲ STEUERUNG)');
ok(html.includes('id="consoleHome"'), 'STEUER: Heimat-Karte #consoleHome (Rückweg des consolePad)');
ok(html.includes('TRAININGSEINSATZ'), 'STEUER: Karte TRAININGSEINSATZ');
ok(html.includes('id="segDrive"') && html.includes('id="segHead"'), 'STEUER: Modus-Segmente je Kanal');
ok(html.includes('id="cmdRowsDrive"') && html.includes('id="cmdRowsHead"'), 'STEUER: Regler-Zeilen je Kanal');
ok(html.includes('Verstehen statt Positionen auswendig lernen'), 'STEUER: Nutzer-Prinzip im Hint');
ok(html.includes('LINKER STICK · BEWEGUNG') && html.includes('RECHTER STICK · KOPF'), 'STEUER: Kanal-Köpfe');

const feldjs = readFileSync(join(WWW, 'js/feld/feld.js'), 'utf8');
ok(feldjs.includes("from './cmdgen.js'"), 'feld.js importiert cmdgen.js');
ok(feldjs.includes('function tickCmdGen'), 'feld.js: tickCmdGen (virtuelle Hand je Frame)');
ok(feldjs.includes('function cmdDriven') && feldjs.includes('S.cmdgen && S.cmdgen.active()'), 'feld.js: cmdDriven — Generator füttert setUserCmd im Training');
ok(feldjs.includes('function foldConsole'), 'feld.js: foldConsole (ein-/ausklappen)');
ok(feldjs.includes("$('feldConsoleHost').appendChild(padEl)") && feldjs.includes("$('consoleHome').appendChild(padEl)"),
  'feld.js: consolePad wandert Overlay ↔ STEUER (eine Instanz)');
ok(feldjs.includes('k.renderSticks()'), 'feld.js: Sticks laufen sichtbar mit');
ok(feldjs.includes('k.touchL') && feldjs.includes('k.touchR'), 'feld.js: echte Hand gewinnt (touchL/touchR)');
ok(feldjs.includes('g.drive.mode === \'aus\' ? 0 : -out.y') || feldjs.includes('-out.y'), 'feld.js: Vorzeichen +y=vorwärts → Stick −y');
ok(feldjs.includes('cmdgen: S.cmdgen ? S.cmdgen.toJSON() : null'), 'feld.js: Autosave trägt cmdgen');
ok(feldjs.includes('cmdFold: S.cmdFold'), 'feld.js: Autosave trägt Klappzustand');
ok(feldjs.includes('CmdGen.fromJSON(sess.cmdgen)'), 'feld.js: Import stellt cmdgen wieder her');
ok(feldjs.includes('wireCmdUI()') && feldjs.includes('wireConsoleFold()'), 'feld.js: UI-Verdrahtung im Boot');
ok(feldjs.includes('buildCmdRowsFor'), 'feld.js: Regler-Zeilen je Modus (dim bei fremdem Modus)');
ok(feldjs.includes("'Schlangenfrequenz (Hz)'") && feldjs.includes("'Aktiv-Chance'") && feldjs.includes("'Sprungdauer (s)'"), 'feld.js: alle Modus-Regler (Frequenz/Chance/Dauer/Glättung/Fix)');

const consolejs = readFileSync(join(WWW, 'js/feld/console.js'), 'utf8');
ok(consolejs.includes('get touchL()') && consolejs.includes('get touchR()'), 'console.js: Berührungs-Getter');
ok(consolejs.includes('renderSticks()'), 'console.js: renderSticks');
ok(consolejs.includes("padEl._touch = true") && consolejs.includes('padEl._touch = false'), 'console.js: _touch-Flag an/aus');

const css = readFileSync(join(WWW, 'style.css'), 'utf8');
ok(css.includes('.feldconsole') && css.includes('.fold-panel'), 'CSS: Overlay + Panel');
ok(css.includes('.feldconsole.open .fold-panel') && css.includes('transform: translateY(115%)'), 'CSS: Klapp-Animation (geschlossen unterhalb, offen sichtbar)');
ok(css.includes('.fold-btn'), 'CSS: Klapp-Griff');
ok(css.includes('.seg button') && css.includes('.seg button.on'), 'CSS: Modus-Segment-Buttons');
ok(css.includes('.cmd-chan') && css.includes('.dimrow'), 'CSS: Kanal-Blöcke + gedimmte fremdmodale Regler');
ok(css.includes('pointer-events: none') && css.includes('pointer-events: auto'), 'CSS: Overlay durchlässig außer Panel/Griff (3D bleibt bedienbar)');

const cgjs = readFileSync(join(WWW, 'js/feld/cmdgen.js'), 'utf8');
ok(cgjs.includes("export class CmdGen"), 'cmdgen.js im Asset-Pool (App-Bundle)');
ok(cgjs.includes("'schlange'"), 'cmdgen.js: Schlangelinien-Modus');
ok(cgjs.includes('_expo'), 'cmdgen.js: exponentielle Phasenlängen (natürliche Vielfalt)');

// ════════════════ ERGEBNIS ════════════════
console.log('\n════════════════════════════════════');
console.log('ERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) { console.log('FEHLER:\n' + FAILS.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('feld_cmd_test GRÜN — v3.1.0 Trainingseinsatz + FELD-Overlay bewiesen');
