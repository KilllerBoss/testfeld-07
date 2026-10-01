// ═══════════════════════════════════════════════════════════
// feld_v380_test.mjs — TELEPORT-BUTTON + UI-REDESIGN (v3.8.0)
//
// Nutzer: „Füge Möglichkeit das es beim ausführen auf Startseite
// ein kleinen Button gibt um den Roboter zurück auf seine Stelle
// zu teleportieren zurück auf die Beine. Und mache ganze app
// minimalistischer und redesigne ui/ux"
//
// Dieser Test pinnt:
//   1) TELEPORT: kleiner Button „↺ AUFSTELLEN" in der Feld-Leiste
//      (Startseite/FELD), teleportDuck() = task.reset(rng, sim)
//      (STAND-Keyframe am Startpunkt, Velocities 0, Aufsteh-Fenster
//      geschlossen, Schubser-Timer neu) — Training/PPO-Puffer und
//      ONNX-Aktivierung bleiben unangetastet, ONNX-Befehl wird
//      neutralisiert, Echtzeit-Takt frisch, __feld.teleport暴露.
//   2) UI-REDESIGN: Neo-Minimal-CSS — Design-Tokens, schwebende
//      Pill-Tabbar, echte Toggle-Schalter, Custom-Range, Karten-
//      Radien, Teleport-Pill; ALLE Legacy-Selektoren bleiben
//      (feldconsole/fold-panel/translateY(115%)/fold-btn/seg/
//      cmd-chan/dimrow/pointer-events — Regressionssuiten).
//   3) HTML-Integrität: JEDE $('id')-Referenz aus feld.js hat ein
//      id="…" in index.html (Redesign darf nichts trennen) +
//      Tab-Icons (.tico) + alle vorherigen Karten/IDs.
//   4) Version 108 / 3.8.0 + CI-OR-Kette (…|8\.0)
// Aufruf: node scripts/feld_v380_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const read = (p) => readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const fj = read(join(WWW, 'js/feld/feld.js'));
const html = read(join(WWW, 'index.html'));
const css = read(join(WWW, 'style.css'));
const vj = read(join(WWW, 'js/feld/version.js'));
const gradle = read(join(ROOT, 'app/build.gradle'));
const workflow = read(join(ROOT, '.github/workflows/build-apk.yml'));

console.log('── 1. TELEPORT: Button + Funktion + Verdrahtung ──');
ok(html.includes('id="btnTeleport"'), 'index.html: Teleport-Button in der Feld-Leiste');
ok(html.includes('↺ AUFSTELLEN'), 'index.html: Beschriftung „↺ AUFSTELLEN" (klein, selbsterklärend)');
ok(html.includes('aria-label="Roboter zurück auf die Beine teleportieren"'), 'index.html: aria-label (Bedienbarkeit)');
ok(/<button id="btnTeleport" class="tele"[\s\S]{0,120}>↺ AUFSTELLEN<\/button>\s*<span id="modeChip"/.test(html), 'index.html: Button sitzt in der field-bar (neben START, vor dem Modus-Chip)');
ok(fj.includes('function teleportDuck()'), 'feld.js: teleportDuck() existiert');
ok(fj.includes("$('btnTeleport').addEventListener('click', teleportDuck);"), 'feld.js: Button verdrahtet (wireTabs)');
ok(fj.includes('task.reset(rng, S.sim);') && /const rng = S\.trainer \? S\.trainer\.rng : new RNG\(/.test(fj), 'feld.js: Teleport = Episoden-Reset am Keyframe (Trainer-RNG im Training)');
ok(/if \(S\.trainer\) S\.trainer\._epR = 0;/.test(fj), 'feld.js: Teil-Episode verfällt (wie RESET-Button, PPO-Logik bleibt konsistent)');
ok(/if \(S\.ortInfer\) S\._ortMu = new Float32Array\(task\.actDim\);/.test(fj), 'feld.js: ONNX-Befehl wird beim Teleport neutralisiert (kein alter Schub)');
ok(/S\._liveAcc = 0; \/\/ Echtzeit-Takt frisch/.test(fj), 'feld.js: Echtzeit-Takt frisch (kein Sprung im Bild)');
ok(fj.includes('Teleport: Ente steht wieder auf den Beinen'), 'feld.js: deutsche Status-Meldung im Boot-Log');
ok(/teleport: teleportDuck, \/\/ v3\.8\.0/.test(fj), 'feld.js: __feld.teleport für Browser-Tests/Power-User');
ok(/resetToKeyframe passiert in[\s\S]{0,40}task\.reset/.test(fj), 'feld.js: Dokumentation — Keyframe-Reset läuft über task.reset(keepPose=false)');

console.log('── 2. UI-REDESIGN: Neo-Minimal-CSS ──');
ok(css.includes('--r-lg: 18px') && css.includes('--r-md: 12px') && css.includes('--acc: #7ee85f'), 'Design-Tokens: Radien + helleres Feldgrün');
ok(/\.card\s*{[^}]*border-radius: var\(--r-lg\)/.test(css), 'Karten: große Radien, weiche Flächen statt harte Rahmen');
ok(/\.tabs\s*{[^}]*border-radius: 999px/.test(css) && /\.tab\.on\s*{[^}]*background: var\(--acc\)/.test(css), 'Tab-Leiste: schwebende Pill, aktiver Tab gefüllt');
ok(/\.switch input\s*{[^}]*appearance: none/.test(css) && css.includes('.switch input:checked::after'), 'Toggle-Schalter: echter Pill-Switch (CSS only, Logik = Checkbox)');
ok(css.includes('::-webkit-slider-runnable-track') && css.includes('::-webkit-slider-thumb'), 'Range-Regler: eigene Spur + Knopf (präziser greifbar)');
ok(css.includes('.field-bar') && /backdrop-filter/.test(css), 'Feld-Leiste: schwebend mitBlur');
ok(css.includes('button.tele') && /button\.tele:active[^}]*var\(--acc\)/.test(css), 'Teleport-Pill gestylt (Akzent beim Drücken)');
ok(css.includes('.tico'), 'Tab-Icons (.tico) gestylt — schmale Glyphen statt Text-Wüste');
ok(css.includes('.hud') && /10\.5px/.test(css), 'HUD: dezenter, monospaced, kleiner');
ok(css.includes('env(safe-area-inset-bottom'), 'Tab-Leiste respektiert Safe-Area (Edge-to-Edge-Handys)');

console.log('── 3. Legacy-Selektoren UNVERÄNDERT (Regressionssuiten) ──');
ok(css.includes('.feldconsole') && css.includes('.fold-panel'), 'CSS: Overlay + Panel (feld_cmd_test)');
ok(css.includes('.feldconsole.open .fold-panel') && css.includes('transform: translateY(115%)'), 'CSS: Klapp-Animation exakt erhalten');
ok(css.includes('.fold-btn'), 'CSS: Klapp-Griff');
ok(css.includes('.seg button') && css.includes('.seg button.on'), 'CSS: Modus-Segment-Buttons');
ok(css.includes('.cmd-chan') && css.includes('.dimrow'), 'CSS: Kanal-Blöcke + gedimmte Regler');
ok(css.includes('pointer-events: none') && css.includes('pointer-events: auto'), 'CSS: Overlay durchlässig außer Panel/Griff');
ok(!css.includes('.console {'), 'CSS: Alt-App-Konsole bleibt weg (test_v2141)');
ok(!/max-height: 330px/.test(css), 'CSS: Listen-Bug bleibt beseitigt (canvas_v2200)');
ok(html.includes('<div class="seg" id="fallSeg"></div>') && html.includes('STURZ-VERHALTEN'), 'HTML: Sturz-Karte unverändert (feld_v340)');
ok(html.includes('btnImportOnnx') && html.includes('btnTestOnnx') && html.includes('impState'), 'HTML: IMPORT-Karte unverändert (feld_v370)');
ok(html.includes('btnGemGo') && html.includes('ALLES EINSTELLEN') && html.includes('gemWish') && html.includes('gemKey'), 'HTML: KI-SETUP-Karte unverändert (feld_v370)');
ok(html.includes('nur die .onnx, KEIN Manifest') && html.includes('1×61') && html.includes('GOT 61 EXPECTED 74'), 'HTML: Export-Hint unverändert (feld_v350/v360)');
ok(html.includes('Download-Ordner</b> des Handys'), 'HTML: Download-Ordner-Hint unverändert (feld_v340)');

console.log('── 4. HTML-Integrität: jede $()-Referenz hat ihr id ──');
{
  const ids = new Set();
  for (const m of fj.matchAll(/\$\('([^']+)'\)/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  ok(missing.length === 0, 'Alle ' + ids.size + ' feld.js-Element-IDs existieren in index.html', missing.length ? 'FEHLEND: ' + missing.join(', ') : '');
  const tabs = ['pgFeld', 'pgTrain', 'pgReward', 'pgConsole', 'pgModel'];
  ok(tabs.every((t) => html.includes(`data-page="${t}"`)), 'Alle 5 Tabs verdrahtet (Redesign ändert nichts an der Navigation)');
  ok((html.match(/class="tico"/g) || []).length === 5, '5 Tab-Icons im Markup');
}

console.log('── 5. feld.js Syntax-Sicherheit ──');
{
  ok((fj.match(/import \{ RNG \} from '\.\.\/math\.js';/g) || []).length === 1, 'RNG-Import genau EINMAL (kein Doppel-Import)');
  // echte ESM-Syntaxprüfung (ohne Ausführung): Kopie als .mjs parsen
  const tmp = mkdtempSync(join(tmpdir(), 'feld380-'));
  const tmpF = join(tmp, 'feld.mjs');
  copyFileSync(join(WWW, 'js/feld/feld.js'), tmpF);
  let parseOk = true, parseErr = '';
  try { execFileSync(process.execPath, ['--check', tmpF], { stdio: 'pipe' }); } catch (e) { parseOk = false; parseErr = String(e.stderr || e.message).split('\n')[0]; }
  rmSync(tmp, { recursive: true, force: true });
  ok(parseOk, 'feld.js: ESM-Parse (node --check) bestanden', parseErr);
  // Bilanz NACH Entfernen von Strings/Kommentaren (naiver Zähler reicht nicht)
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const bal = (s) => { let o = 0; for (const c of s) { if (c === '{') o++; else if (c === '}') o--; } return o; };
  ok(bal(strip(fj)) === 0, 'Geschweifte Klammern ausgeglichen (Strings/Kommentare bereinigt)');
  ok((fj.match(/function teleportDuck/g) || []).length === 1, 'teleportDuck genau EINMAL definiert');
}

console.log('── 6. Version 108 / 3.8.0 + CI ──');
ok(vj.includes("VERSION = '3.8.0'") && vj.includes('VERSION_CODE = 108'), 'version.js: 3.8.0 / 108');
ok(gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"'), 'build.gradle: 108 / 3.8.0');
ok(/3\\\.\(0\\\.0\|.*8\\\.0/.test(workflow) || workflow.includes('|8\\.0)'), 'CI-OR-Kette um 3.8.0 erweitert');

console.log('\n════════════════════════════════════');
console.log('ERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) { process.exit(1); }
console.log('feld_v380_test GRÜN — Teleport + Neo-Minimal-Redesign bewiesen');
