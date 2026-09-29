// ═══════════════════════════════════════════════════════════
// feld_schubser_test.mjs — v3.2.0: AUTOSCHUBSER
//
// Nutzerbriefing: „Ich will bei Belohnungssystem einstellen können
// ob Schubser kommen, wie oft und wie stark (beim Training)."
//
// Beweisziele:
//  1. AN/AUS — aus = nie ein Impuls
//  2. WIE OFT — Intervall (Sekunden) im Band [sMin, sMax], deterministisch
//  3. WIE STARK — Δv im Band [vMin, vMax], Impuls = Δv × Masse (Δv-Treue)
//  4. Curriculum „Stärke wächst mit Erfolg" (Skala 0,4…1,0)
//  5. Richtungen (fwd/back/left/right yaw-relativ, auto zufällig)
//  6. Verdrahtung: Task liest cfg.schubser je reward()-Aufruf (SOFORT),
//     Live-Gating, Autosave, UI-Regler im Belohnungs-Tab
// ═══════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SchubModel, schubDue, schubApply, SCHUB_STEP_S, SCHUB_DIRS, SCHUB_DIR_LABELS } from '../app/src/main/assets/www/js/feld/schubser.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';
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
sec('VERSION 3.2.0');
ok(APP_NAME === 'Feld', 'App-Name = Feld');
ok(VERSION === '3.2.0' || VERSION === '3.3.0', 'VERSION = 3.2.0/3.3.0');
ok(VERSION_CODE === 102 || VERSION_CODE === 103, 'VERSION_CODE = 102/103');
const gradle = readFileSync(join(ROOT, 'app/build.gradle'), 'utf8');
ok(gradle.includes('versionCode 102') && gradle.includes('versionName "3.2.0"') || (gradle.includes('versionCode 103') && gradle.includes('versionName "3.3.0"')), 'build.gradle 102 / 3.2.0');

// ════════════════ 2 · MODELL ════════════════
sec('SCHUBMODEL (Defaults · Sanitize · Roundtrip)');
const def = new SchubModel(null);
ok(def.on === 0, 'Default: aus (Nutzer schaltet bewusst ein)');
ok(def.sMin === 3 && def.sMax === 8, 'Default-Intervall 3…8 s');
ok(def.vMin === 0.4 && def.vMax === 1.8, 'Default-Stärke Δv 0,4…1,8 m/s');
ok(def.dir === 'auto' && def.grow === 0 && def.live === 0, 'Default: auto · kein Grow · kein Live');
const m1 = new SchubModel({ on: 1, sMin: 10, sMax: 2, vMin: 9, vMax: 0.5, dir: 'quatsch', grow: 5, live: 3 });
ok(m1.sMin === 10 && m1.sMax === 10, 'Sanitize: sMax wird auf sMin geklemmt (Partner-Slider folgt)');
ok(m1.vMin === 8 && m1.vMax === 8, 'Sanitize: vMin geklemmt (≤8), vMax ≥ vMin');
ok(m1.dir === 'auto', 'Sanitize: unbekannte Richtung → auto');
ok(m1.grow === 1 && m1.live === 1, 'Sanitize: Flags zu 0/1 normiert');
const rt = new SchubModel(JSON.parse(JSON.stringify(m1.toJSON())));
ok(JSON.stringify(rt.toJSON()) === JSON.stringify(m1.toJSON()), 'JSON-Roundtrip bit-exakt');
ok(JSON.stringify(SCHUB_DIRS) === JSON.stringify(['auto', 'fwd', 'back', 'left', 'right']), '5 Richtungen');
ok(SCHUB_DIR_LABELS.fwd === 'Nach vorn' && SCHUB_DIR_LABELS.auto === 'Zufällig (auto)', 'Deutsche Labels');
ok(SCHUB_STEP_S === 0.02, 'Regelzyklus = 0,02 s (substeps 10 × timestep 0,002)');

// ════════════════ 3 · WIE OFT (Zeitplan) ════════════════
sec('WIE OFT — Intervall + An/Aus + Determinismus');
// Fake-Task: cfg.schubser trägt das Modell, _schubNext zählt Zyklen
function mkTask(sc) { return { cfg: { schubser: sc }, _schubNext: null, _schubSuc: null }; }
// Aus → nie
const tOff = mkTask(new SchubModel({ on: 0 }));
let fired = 0;
for (let i = 0; i < 5000; i++) if (schubDue(tOff, null) > 0) fired++;
ok(fired === 0, 'AUS → 0 Schubser in 5000 Zyklen');
// An → erste Fälligkeit im Band, dann Abstände im Band
const tOn = mkTask(new SchubModel({ on: 1, sMin: 1, sMax: 2, vMin: 1, vMax: 1 }));
const rng1 = new RNG(42);
const gaps = [];
let lastDue = null, steps = 0, guard = 0;
while (gaps.length < 40 && guard++ < 100000) {
  const dv = schubDue(tOn, rng1);
  steps++;
  if (dv > 0) {
    if (lastDue !== null) gaps.push((steps - lastDue) * SCHUB_STEP_S);
    lastDue = steps;
  }
}
ok(gaps.length === 40, '40 Schubser innerhalb des Guards (' + guard + ' Zyklen)');
ok(gaps.every((g) => g >= 1 - 0.02 && g <= 2 + 0.02), 'Alle Abstände im Intervallband 1…2 s (±Würfelrundung)');
// Determinismus: gleicher Seed → gleiche Schubs-Zeiten
function pushTimes(seed) {
  const t = mkTask(new SchubModel({ on: 1, sMin: 0.5, sMax: 1.5, vMin: 0.5, vMax: 2 }));
  const r = new RNG(seed);
  const times = [];
  for (let i = 0; i < 30000 && times.length < 30; i++) if (schubDue(t, r) > 0) times.push(i);
  return times;
}
ok(JSON.stringify(pushTimes(7)) === JSON.stringify(pushTimes(7)), 'Determinismus: gleicher Seed → identischer Zeitplan');
ok(JSON.stringify(pushTimes(7)) !== JSON.stringify(pushTimes(8)), 'Anderer Seed → anderer Zeitplan');
// Reset je Episode
const tE = mkTask(new SchubModel({ on: 1, sMin: 2, sMax: 2, vMin: 1, vMax: 1 }));
schubDue(tE, null); // initialisiert
tE._schubNext = 3;
tE._schubNext = null; // reset() setzt null (robots.js)
const dvAfterReset = schubDue(tE, null);
ok(dvAfterReset === 0 && tE._schubNext > 0, 'Episode-Reset: frisches Intervall, kein Sofort-Schubs');

// ════════════════ 4 · WIE STARK (Δv + Impuls-Treue) ════════════════
sec('WIE STARK — Δv-Band + Masse-Treue + Curriculum');
const M = 20; // Fake-Gesamtmasse (2 Körper)
function mkSim() {
  return {
    nbody: 2, model: { body_mass: Float64Array.from([5, 15]) },
    _yaw: 0, _bq: Float64Array.from([1, 0, 0, 0]),
    baseQuat(out) { out.set(this._bq); return out; },
    impulses: [],
    pushImpulse(fx, fy, fz) { this.impulses.push([fx, fy, fz]); },
  };
}
const sim = mkSim();
const scA = new SchubModel({ on: 1, sMin: 0.5, sMax: 0.5, vMin: 0.8, vMax: 1.2 });
const tA = mkTask(scA);
const rA = new RNG(9);
const dvs = [];
let guard2 = 0;
while (dvs.length < 30 && guard2++ < 50000) {
  const dv = schubDue(tA, rA);
  if (dv > 0) {
    dvs.push(dv);
    schubApply(tA, sim, dv, rA);
  }
}
ok(dvs.every((v) => v >= 0.8 - 1e-9 && v <= 1.2 + 1e-9), 'Alle Δv im Band 0,8…1,2 m/s');
ok(sim.impulses.length === dvs.length, 'Ein Impuls je Fälligkeit');
const imp = sim.impulses[0];
const dvRec = Math.hypot(imp[0], imp[1]) / M;
ok(Math.abs(dvRec - dvs[0]) < 1e-9, 'Impuls = Δv × Masse (Δv-Treue): ' + dvRec.toFixed(4) + ' ≈ ' + dvs[0].toFixed(4));
ok(imp[2] === 0, 'Horizontal (fz = 0) — keine Teleportation nach oben');
// Curriculum: Erfolg 1 → volle Bandbreite, Erfolg 0 → ×0,4
const scG = new SchubModel({ on: 1, grow: 1, vMin: 1, vMax: 2 });
const dvHi = scG.strength(2.0, 1.0), dvLo = scG.strength(2.0, 0.0), dvMid = scG.strength(2.0, null);
ok(Math.abs(dvHi - 2.0) < 1e-9, 'grow: Erfolg 100 % → volle Stärke');
ok(Math.abs(dvLo - 0.8) < 1e-9, 'grow: Erfolg 0 % → 0,4 × Stärke (leichter)');
ok(Math.abs(dvMid - 1.4) < 1e-9, 'grow: ohne Signal → neutral 0,7 × ');
ok(new SchubModel({ grow: 0 }).strength(2, 0) === 2, 'grow aus → Stärke unangetastet');

// ════════════════ 5 · RICHTUNGEN ════════════════
sec('RICHTUNGEN — yaw-relativ (fwd/back/left/right) + auto');
function pushDir(sc, yaw, rng) {
  const s = mkSim();
  s._bq = Float64Array.from([Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]);
  const t = mkTask(sc);
  const info = schubApply(t, s, 1, rng || null);
  return { ang: info.angle, imp: s.impulses[0] };
}
const f = pushDir(new SchubModel({ dir: 'fwd' }), 0);
ok(Math.abs(f.ang - 0) < 1e-9 && f.imp[0] > 0 && Math.abs(f.imp[1]) < 1e-9, 'fwd bei yaw 0 → Impuls +x (nach vorn)');
const f90 = pushDir(new SchubModel({ dir: 'fwd' }), Math.PI / 2);
ok(Math.abs(f90.ang - Math.PI / 2) < 1e-9 && f90.imp[1] > 0, 'fwd bei yaw 90° → Impuls +y (Blickrichtung folgt)');
const b = pushDir(new SchubModel({ dir: 'back' }), 0);
ok(Math.abs(b.ang - Math.PI) < 1e-9 && b.imp[0] < 0, 'back → Impuls −x (nach hinten)');
const l = pushDir(new SchubModel({ dir: 'left' }), 0);
ok(Math.abs(l.ang - Math.PI / 2) < 1e-9 && l.imp[1] > 0, 'left → Impuls +y (nach links)');
const r = pushDir(new SchubModel({ dir: 'right' }), 0);
ok(Math.abs(r.ang + Math.PI / 2) < 1e-9 && r.imp[1] < 0, 'right → Impuls −y (nach rechts)');
const angles = new Set();
for (let i = 0; i < 24; i++) angles.add(Math.round(pushDir(new SchubModel({ dir: 'auto' }), 0, new RNG(i + 100)).ang * 1e6));
ok(angles.size > 12, 'auto → 24 Schubser liefern >12 verschiedene Winkel (zufällig)');
ok(tA._schubCount === 30 && tA._schubLast.dv > 0, 'Anzeige-Daten: _schubCount/_schubLast gepflegt');

// ════════════════ 6 · VERDRAHTUNG (Task + UI + Autosave) ════════════════
sec('VERDRAHTUNG');
const robotsjs = readFileSync(join(WWW, 'js/robots.js'), 'utf8');
ok(robotsjs.includes("from './feld/schubser.js'"), 'robots.js importiert schubser.js');
ok(robotsjs.includes('const sc = cfg.schubser;') && robotsjs.includes('schubDue(this, null)') && robotsjs.includes('schubApply(this, sim, dvS, null)'),
  'MoE-Task: cfg.schubser je reward()-Aufruf gelesen (SOFORT wirksam)');
ok(robotsjs.includes('this._schubLive !== true || sc.live'), 'Live-Gating im Task (_schubLive + sc.live)');
ok(robotsjs.includes('this._schubNext = null;'), 'Reset: frisches Intervall je Episode');
ok(robotsjs.includes('this._schubSuc = this._schubSuc == null ? _okS : this._schubSuc * 0.85 + _okS * 0.15;'),
  'Erfolgs-EMA (0,85/0,15) am Episoden-Ende für das Curriculum');
const feldjs = readFileSync(join(WWW, 'js/feld/feld.js'), 'utf8');
ok(feldjs.includes("from './schubser.js'") && feldjs.includes('S.schubser = new SchubModel(null)') && feldjs.includes('cfg.schubser = S.schubser;'),
  'feld.js: SchubModel an cfg gebunden (VOR Task-Bau)');
ok(feldjs.includes('schubser: S.schubser ? S.schubser.toJSON() : null'), 'Autosave: schubser im sessionBlob');
ok(feldjs.includes('S.schubser.setFrom(sess.schubser)'), 'Import: in-place Übernahme (Bindung bleibt)');
ok(feldjs.includes('S.task._schubLive = false;') && feldjs.includes('!!(S.schubser && S.schubser.on && S.schubser.live)'),
  'Modi: Training immer · POLICY nur mit „Auch im POLICY-Betrieb"');
ok(feldjs.includes('buildSchubUI()') && feldjs.includes("sw('schOn', 'on')") && feldjs.includes("sw('schGrow', 'grow')") && feldjs.includes("sw('schLive', 'live')"),
  'UI: Schubser-Regler gebunden (an/aus · Grow · Live)');
const html = readFileSync(join(WWW, 'index.html'), 'utf8');
ok(html.includes('id="schOn"') && html.includes('id="schTmin"') && html.includes('id="schTmax"')
  && html.includes('id="schVmin"') && html.includes('id="schVmax"') && html.includes('id="schDir"')
  && html.includes('id="schGrow"') && html.includes('id="schLive"') && html.includes('id="schState"'),
  'Belohnungs-Tab: SCHUBSER-Karte (an/aus · wie oft von/bis · wie stark von/bis · Richtung · Grow · Live)');
ok(html.includes('SCHUBSER') && html.includes('Wie oft: Intervall von (s)') && html.includes('Wie stark: Δv von (m/s)'),
  'UI-Sprache: „Wie oft" / „Wie stark" wie im Nutzerbriefing');
ok(feldjs.includes("SCHUBS ' + S.task._schubCount") || feldjs.includes("SCHUBS "), 'HUD zeigt Schubser-Status');

// ════════════════ Ergebnis ════════════════
console.log('\n════════════════════════════════');
console.log('ERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) { console.log('FEHLER:\n' + FAILS.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('feld_schubser_test: ALLE GRÜN');
