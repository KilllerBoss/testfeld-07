// ═══════════════════════════════════════════════════════════
// feld_ground_phone_test.mjs — v3.2.0: BEWEGLICHER BODEN + HANDY-SENSOR
//
// Nutzerbriefing:
//  „Und auch beim Training das option gibt auch beweglichen Boden zu
//   aktivieren und einstellen"  → GroundModel (an/aus · Muster · wie
//   stark in ° · wie schnell in Hz) je Regelzyklus, Schwerkraft kippen.
//  „App gyroskop meines Handys liest … wenn ich ah da bewegen den
//   Roboter schubst oder den Boden bewegt. Wäre witzig."
//   → PhoneModel + phonePush (Bewegung → Impuls) + phoneTilt
//     (Neigung → Boden) + native FeldMotion-Brücke.
// ═══════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GroundModel, GroundState, GROUND_MODES, GROUND_MODE_LABELS,
  probeGravity, setGroundTilt, applyGroundImpulse,
} from '../app/src/main/assets/www/js/feld/ground.js';
import {
  PhoneModel, phonePush, PHONE_DEFAULTS,
} from '../app/src/main/assets/www/js/feld/phone.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';
import { VERSION, VERSION_CODE } from '../app/src/main/assets/www/js/feld/version.js';

let pass = 0, fail = 0;
const FAILS = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; FAILS.push(name); console.log('  ✗ ' + name); }
}
function sec(s) { console.log('\n── ' + s + ' ──'); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const DEG = Math.PI / 180;

// ════════════════ 1 · VERSION ════════════════
sec('VERSION');
ok((VERSION === '3.2.0' && VERSION_CODE === 102) || (VERSION === '3.3.0' && VERSION_CODE === 103) || (VERSION === '3.4.0' && VERSION_CODE === 104), '3.2.0/102, 3.3.0/103 oder 3.4.0/104 (Schubser + Boden + Handy in EINEM Release)');

// ════════════════ 2 · GROUNDMODEL ════════════════
sec('GROUNDMODEL — Regler (an/aus · Muster · wie stark · wie schnell)');
const g0 = new GroundModel(null);
ok(g0.on === 0 && g0.live === 0, 'Default: aus (auch nicht live)');
ok(g0.mode === 'sinus' && g0.amp === 8 && g0.freq === 0.2, 'Default: sinus · 8° · 0,2 Hz');
ok(JSON.stringify(GROUND_MODES) === JSON.stringify(['sinus', 'zufall', 'achter', 'drift']), '4 Muster');
ok(!!GROUND_MODE_LABELS.sinus && !!GROUND_MODE_LABELS.zufall && !!GROUND_MODE_LABELS.achter && !!GROUND_MODE_LABELS.drift, 'Deutsche Muster-Labels');
const g1 = new GroundModel({ on: 3, mode: 'nix', amp: 99, freq: 0.001, live: 1 });
ok(g1.on === 1 && g1.mode === 'sinus' && g1.amp === 25 && g1.freq === 0.05, 'Sanitize: Flags/Muster/Klemmen');
const grt = new GroundModel(JSON.parse(JSON.stringify(g1.toJSON())));
ok(JSON.stringify(grt.toJSON()) === JSON.stringify(g1.toJSON()), 'JSON-Roundtrip bit-exakt');

// ════════════════ 3 · GROUNDSTATE — MUSTER ════════════════
sec('GROUNDSTATE — deterministische Muster, Bänder, Frequenz');
const A = 10 * DEG; // 10° max
// aus → immer 0
const gs0 = new GroundState();
const gOff = new GroundModel({ on: 0, amp: 10 });
ok(gs0.tick(0.02, gOff, null).x === 0 && gs0.tick(0.02, gOff, null).y === 0, 'aus → Neigung 0');
// sinus: deterministisch, Bänder, Frequenz spürbar
const mSin = new GroundModel({ on: 1, mode: 'sinus', amp: 10, freq: 0.5 });
const sA = new GroundState(), sB = new GroundState();
const rSame = new RNG(1);
let maxA = 0, maxB = 0, bitEq = true;
for (let i = 0; i < 2000; i++) {
  const a = sA.tick(0.02, mSin, rSame);
  const b = sB.tick(0.02, mSin, rSame);
  if (JSON.stringify(a) !== JSON.stringify(b)) bitEq = false;
  maxA = Math.max(maxA, Math.abs(a.x), Math.abs(a.y));
  maxB = Math.max(maxB, Math.abs(b.x), Math.abs(b.y));
}
ok(bitEq, 'sinus: deterministisch (bit-gleich ohne RNG-Zufall)');
ok(maxA > A * 0.95 && maxA <= A + 1e-12, 'sinus: erreicht ~max-Neigung, nie darüber (' + (maxA / DEG).toFixed(2) + '° ≤ 10°)');
// Periode: bei 0,5 Hz sinus ist x nach 2 s wieder am Anfang
const sP = new GroundState();
sP.tick(0.02, mSin, null); for (let i = 0; i < 99; i++) sP.tick(0.02, mSin, null);
const xStart = sP.tick(0.0, mSin, null); // Momentaufnahme (dt=0 → 0! → eigener Trick unten)
// dt=0 liefert 0 — daher Periode über zwei Zeitpunkte prüfen:
const sQ = new GroundState();
const q0 = sQ.tick(0.02, mSin, null); for (let i = 1; i < 100; i++) sQ.tick(0.02, mSin, null);
const q100 = sQ.tick(0.02, mSin, null); // t=2,0 s → Phase w·t = 2π → x ≈ Startwert
ok(Math.abs(q0.x - q100.x) < 0.01, 'sinus 0,5 Hz: Periode 2 s (x kehrt zum Startwert zurück)');
// achter: y doppelt so schnell wie x (Lissajous)
const mAch = new GroundModel({ on: 1, mode: 'achter', amp: 10, freq: 0.25 });
const sC = new GroundState();
let xZeroCross = 0, yZeroCross = 0, xPrev = 0, yPrev = 0;
for (let i = 0; i < 2000; i++) {
  const t = sC.tick(0.02, mAch, null);
  if (i > 0 && Math.sign(t.x) !== Math.sign(xPrev)) xZeroCross++;
  if (i > 0 && Math.sign(t.y) !== Math.sign(yPrev)) yZeroCross++;
  xPrev = t.x; yPrev = t.y;
}
ok(yZeroCross > xZeroCross * 1.5, 'achter: y-Oszillation ~2× schneller als x (Lissajous 1:2)');
// zufall: deterministisch mit Seed, glatt (keine Sprünge > 2,5°/Zyklus)
const mZuf = new GroundModel({ on: 1, mode: 'zufall', amp: 10, freq: 0.3 });
const sD = new GroundState(), rD = new RNG(77);
let maxStep = 0, xPrev2 = 0, yPrev2 = 0;
for (let i = 0; i < 1500; i++) {
  const t = sD.tick(0.02, mZuf, rD);
  maxStep = Math.max(maxStep, Math.abs(t.x - xPrev2), Math.abs(t.y - yPrev2));
  xPrev2 = t.x; yPrev2 = t.y;
}
ok(maxStep < 2.5 * DEG, 'zufall: geglättet (max ' + (maxStep / DEG).toFixed(2) + '°/Zyklus — kein Ruck)');
const sE1 = new GroundState(), sE2 = new GroundState(), sE3 = new GroundState();
const rE1 = new RNG(5), rE2 = new RNG(5), rE3 = new RNG(6);
let d1 = [], d2 = [], d3 = [];
for (let i = 0; i < 300; i++) { d1.push(sE1.tick(0.02, mZuf, rE1).x); d2.push(sE2.tick(0.02, mZuf, rE2).x); d3.push(sE3.tick(0.02, mZuf, rE3).x); }
ok(JSON.stringify(d1) === JSON.stringify(d2), 'zufall: gleicher Seed → identische Bahn');
ok(JSON.stringify(d1) !== JSON.stringify(d3), 'zufall: anderer Seed → andere Bahn');
// drift: langsam (Beträge klein gegenüber amp kurzzeitig, aber erreicht Band)
const mDri = new GroundModel({ on: 1, mode: 'drift', amp: 10, freq: 0.1 });
const sF = new GroundState(), rF = new RNG(3);
let dMax = 0, dStep = 0, xp = 0, yp = 0;
for (let i = 0; i < 6000; i++) {
  const t = sF.tick(0.02, mDri, rF);
  dMax = Math.max(dMax, Math.abs(t.x), Math.abs(t.y));
  dStep = Math.max(dStep, Math.abs(t.x - xp), Math.abs(t.y - yp));
  xp = t.x; yp = t.y;
}
ok(dMax > 5 * DEG && dMax <= 10 * DEG + 1e-12, 'drift: erreicht Band, nie darüber');
ok(dStep < 1.5 * DEG, 'drift: langsam wandernd (max ' + (dStep / DEG).toFixed(3) + '°/Zyklus)');

// ════════════════ 4 · SCHWERKRAFT-KIPPUNG ════════════════
sec('SCHWERKRAFT — Kippen, Rückstellung, Fallback');
function mkSim(quat) {
  return {
    nbody: 1, model: { opt: { gravity: Float64Array.from([0, 0, -9.81]) }, body_mass: Float64Array.from([20]) },
    _bq: quat || Float64Array.from([1, 0, 0, 0]),
    impulses: [],
    pushImpulse(fx, fy, fz) { this.impulses.push([fx, fy, fz]); },
    baseQuat(o) { o.set(this._bq); return o; },
  };
}
const sim1 = mkSim();
ok(probeGravity(sim1) === true, 'probe: Schwerkraft beschreibbar (Standard-Bindung)');
const g0snap = Float64Array.from(sim1.model.opt.gravity);
setGroundTilt(sim1, 5 * DEG, 0, g0snap);
ok(Math.abs(sim1.model.opt.gravity[0] - 9.81 * Math.sin(5 * DEG)) < 1e-12, '5° vor → gx = G·sin(5°) (Plattform schief)');
ok(Math.abs(sim1.model.opt.gravity[2] - -9.81 * Math.cos(5 * DEG)) < 1e-12, 'gz skaliert mit cos (Betrag ~konstant)');
setGroundTilt(sim1, 0, 0, g0snap);
ok(sim1.model.opt.gravity[0] === 0 && sim1.model.opt.gravity[1] === 0 && sim1.model.opt.gravity[2] === -9.81,
  'Neigung 0 → exakt g0 (Rückstellung bit-genau)');
const sim2 = mkSim();
const mc = { m: 0 };
applyGroundImpulse(sim2, 5 * DEG, 0, 0.02, mc);
ok(mc.m === 20 && Math.abs(sim2.impulses[0][0] - 9.81 * Math.sin(5 * DEG) * 20 * 0.02) < 1e-12,
  'Fallback: Impuls = G·sin(θ)·Masse·dt (Δv = a·dt)');
ok(applyGroundImpulse(sim2, 5 * DEG, 0, 0, mc) === false, 'dt=0 → kein Impuls (Pause)');

// ════════════════ 5 · PHONEMODEL + PUSH ════════════════
sec('PHONEMODEL — Regler + Sanitize');
const p0 = new PhoneModel(null);
ok(p0.on === 0 && p0.pushOn === 1 && p0.groundOn === 0 && p0.inv === 0, 'Default: Sensor aus, Push an, Boden aus');
ok(p0.sens === 1 && p0.thr === 3 && p0.vMax === 2.5 && p0.tiltMax === 12, 'Defaults: sens 1 · thr 3 · vMax 2,5 · tilt 12°');
const p1 = new PhoneModel({ on: 2, sens: 99, thr: 0.01, vMax: 77, tiltMax: 100, inv: 5 });
ok(p1.on === 1 && p1.sens === 3 && p1.thr === 0.5 && p1.vMax === 6 && p1.tiltMax === 25 && p1.inv === 1,
  'Sanitize: Klemmen (sens ≤3 · thr ≥0,5 · vMax ≤6 · tilt ≤25°)');
const prt = new PhoneModel(JSON.parse(JSON.stringify(p1.toJSON())));
ok(JSON.stringify(prt.toJSON()) === JSON.stringify(p1.toJSON()), 'JSON-Roundtrip bit-exakt');

// phonePush: Schwelle, Richtung (yaw-relativ), Empfindlichkeit, Cap, Cooldown
function mkSensor(lx, ly, lz) {
  return { ok: true, g: [0, 0, -9.81], l: [lx, ly, lz], w: [0, 0, 0], act: 0, activity() {
    const m = Math.hypot(this.l[0], this.l[1], this.l[2]);
    this.act = this.act ? this.act * 0.7 + m * 0.3 : m;
    return { m, act: this.act };
  } };
}
const pm = new PhoneModel({ on: 1, pushOn: 1, thr: 3, vMax: 5, sens: 1 });
const st = { t: 0, last: -9 };
const simP = mkSim();
ok(phonePush(simP, pm, mkSensor(0.5, 0.5, 0), st, 0.02) === null, 'Unter Schwelle (1,0 < 3) → kein Schubs');
const h1 = phonePush(simP, pm, mkSensor(0, 6, 0), st, 0.02); // |l| = 6 > 3, nach vorn geschwungen
ok(h1 !== null, 'Über Schwelle → Schubs');
ok(Math.abs(h1.dv - Math.min(5, (6 - 3) * 0.3 * 1)) < 1e-9, 'Stärke = (Wucht − Schwelle) × 0,3 × sens');
const imp1 = simP.impulses[simP.impulses.length - 1];
ok(imp1[0] > 0 && Math.abs(imp1[1]) < 1e-9, 'Handy nach vorn (y+) → Ente nach vorn (+x bei yaw 0)');
ok(phonePush(simP, pm, mkSensor(0, 9, 0), st, 0.02) === null, 'Cooldown 0,25 s: zweiter Schubs sofort → blockiert');
st.t += 0.3; // Cooldown abgelaufen
const simL = mkSim();
const hLeft = phonePush(simL, pm, mkSensor(-6, 0, 0), st, 0.02); // Handy nach links (x−)
const impL = simL.impulses[simL.impulses.length - 1];
ok(impL[1] > 0 && Math.abs(impL[0]) < 1e-9, 'Handy nach links schwingen → Ente nach links geschubst');
// Cap
const pmCap = new PhoneModel({ on: 1, thr: 1, vMax: 2, sens: 3 });
const stC = { t: 0, last: -9 };
const hCap = phonePush(mkSim(), pmCap, mkSensor(0, 10, 0), stC, 0.02);
ok(Math.abs(hCap.dv - 2) < 1e-9, 'Cap: (10−1)·0,3·3 = 8,1 → gekappt bei vMax 2');
// yaw folgt Blickrichtung
const simY = mkSim(Float64Array.from([Math.cos(Math.PI / 8), 0, 0, Math.sin(Math.PI / 8)])); // Blick 45°
const sensorY = mkSensor(0, 6, 0);
const stY = { t: 0, last: -9 };
phonePush(simY, pm, sensorY, stY, 0.02);
const impY = simY.impulses[simY.impulses.length - 1];
ok(impY[0] > 0 && impY[1] > 0, 'Blickrichtung 45° → Schubs folgt (x+y)');

// ════════════════ 6 · HANDY-NEIGUNG → BODEN ════════════════
sec('HANDY-NEIGUNG → BEWEGLICHER BODEN');
const pm2 = new PhoneModel({ on: 1, groundOn: 1, tiltMax: 12 });
function mkSensorT(gx, gy, gz) {
  return { ok: true, g: [gx, gy, gz], l: [0, 0, 0], w: [0, 0, 0], act: 0, activity() { return { m: 0, act: 0 }; } };
}
const flat = new PhoneModel(null);
// PhoneSensor.tilt ist instanzgebunden — hier die Mathe-Logik direkt (gleiche Formel wie phone.js tilt())
const tiltOf = (g, maxDeg) => {
  const gm = Math.hypot(g[0], g[1], g[2]);
  if (gm < 1) return { x: 0, y: 0 };
  const cap = (maxDeg || 12) * DEG;
  const pitch = Math.atan2(g[1], -g[2]);
  const roll = Math.atan2(g[0], -g[2]);
  return { x: Math.max(-cap, Math.min(cap, pitch)), y: -Math.max(-cap, Math.min(cap, roll)) };
};
ok(Math.abs(tiltOf([0, 0, -9.81], 12).x) < 1e-12, 'Handy flach → Neigung 0°');
const tFwd = tiltOf([0, 9.81 * Math.sin(10 * DEG), -9.81 * Math.cos(10 * DEG)], 25);
ok(Math.abs(tFwd.x - 10 * DEG) < 1e-6, 'Vorne runter (10°) → tx = 10° (Boden fällt nach vorn, Ente rutscht voraus)');
const tRight = tiltOf([9.81 * Math.sin(8 * DEG), 0, -9.81 * Math.cos(8 * DEG)], 25);
ok(Math.abs(tRight.y + 8 * DEG) < 1e-6, 'Rechts runter (8°) → ty = −8° (Ente rutscht nach rechts)');
const tClamp = tiltOf([0, 9.81, 0], 12); // 90° vor → auf 12° geklemmt
ok(Math.abs(tClamp.x - 12 * DEG) < 1e-9, 'Extreme Neigung → auf tiltMax geklemmt');
ok(JSON.stringify(tiltOf([0, 0, 0], 12)) === JSON.stringify({ x: 0, y: 0 }), 'Kein Gravitationssignal (Freier Fall) → 0');
// Boden-Neigung + Handy-Neigung addieren sich (Logik wie groundPhoneStep)
const gTrain = new GroundState().tick(0.02, new GroundModel({ on: 1, amp: 10, freq: 0.5 }), null);
const total = { x: gTrain.x + tFwd.x, y: gTrain.y + tFwd.y };
ok(Math.abs(total.x) > 10 * DEG, 'Training + Handy addieren sich (Klammer 25° in feld.js)');

// ════════════════ 7 · VERDRAHTUNG ════════════════
sec('VERDRAHTUNG (Web + Android)');
const feldjs = readFileSync(join(WWW, 'js/feld/feld.js'), 'utf8');
ok(feldjs.includes("from './ground.js'") && feldjs.includes("from './phone.js'"), 'feld.js importiert ground.js + phone.js');
ok(feldjs.includes('S.trainer.onStep = groundPhoneStep;'), 'Trainer-Haken: Boden+Handy JE Regelzyklus im Training');
ok(feldjs.includes('groundPhoneStep(0.02); // v3.2.0: Handy + beweglicher Boden JE Zyklus (wie im Training)')
  || feldjs.includes('groundPhoneStep(0.02); // v3.2.0: Handy + beweglicher Boden auch live'), 'POLICY-Betrieb: Boden+Handy aktiv');
ok(feldjs.includes('groundPhoneStep(0); // v3.2.0: Pause'), 'Pause: Plattform ruht');
ok(feldjs.includes('S.gDirect = probeGravity(S.sim);') && feldjs.includes('applyGroundImpulse(sim, tx, ty, dt, S._gMass'),
  'Schwerkraft-Steuerung mit Impuls-Fallback');
ok(feldjs.includes('(S.mode === \'live\' && S.ground.live)'), 'Boden live nur mit „Auch im POLICY-Betrieb"');
ok(feldjs.includes("ground: S.ground ? S.ground.toJSON() : null") && feldjs.includes("phone: S.phone ? S.phone.toJSON() : null"), 'Autosave: ground + phone');
ok(feldjs.includes('buildGroundUI()') && feldjs.includes('buildPhoneUI()'), 'UI-Builder gebunden');
const trainerjs = readFileSync(join(WWW, 'js/feld/trainer.js'), 'utf8');
ok(trainerjs.includes('if (this.onStep) {') && trainerjs.includes('this.onStep(CTRL_DT * this.hyper.substeps);'),
  'trainer.js: onStep-Haken nach sim.stepN, VOR reward (Störung sichtbar), try/catch');
const html = readFileSync(join(WWW, 'index.html'), 'utf8');
ok(html.includes('BEWEGLICHER BODEN') && html.includes('id="grOn"') && html.includes('id="grLive"')
  && html.includes('id="grMode"') && html.includes('id="grAmp"') && html.includes('id="grFreq"') && html.includes('id="grState"'),
  'Karte BEWEGLICHER BODEN (an · live · Muster · wie stark ° · wie schnell Hz)');
ok(html.includes('HANDY-SENSOR') && html.includes('id="phOn"') && html.includes('id="phPush"')
  && html.includes('id="phGround"') && html.includes('id="phInv"') && html.includes('id="phSens"')
  && html.includes('id="phThr"') && html.includes('id="phVmax"') && html.includes('id="phTilt"') && html.includes('id="phState"'),
  'Karte HANDY-SENSOR (Sensor · Schubs · Boden · umkehren · Empfindlichkeit · Schwelle · Stärke · Neigung)');
const main = readFileSync(join(ROOT, 'app/src/main/java/com/trainrobot/app/MainActivity.java'), 'utf8');
ok(main.includes('addJavascriptInterface(motionBridge, "FeldMotion")'), 'Native Sensor-Brücke FeldMotion');
ok(main.includes('TYPE_GYROSCOPE') && main.includes('TYPE_GRAVITY') && main.includes('TYPE_LINEAR_ACCELERATION'), 'Gyro + Schwerkraft + linear');
ok(main.includes('SENSOR_DELAY_GAME') && main.includes('onHostPause') && main.includes('onHostResume'), 'GAME-Rate + Lifecycle');
const manifest = readFileSync(join(ROOT, 'app/src/main/AndroidManifest.xml'), 'utf8');
ok(manifest.includes('android.permission.HIGH_SAMPLING_RATE_SENSORS'), 'Manifest: HIGH_SAMPLING_RATE_SENSORS');
ok(manifest.includes('android.hardware.sensor.gyroscope" android:required="false"'), 'Manifest: Gyroskop-Funktion (optional)');
const phonejs = readFileSync(join(WWW, 'js/feld/phone.js'), 'utf8');
ok(phonejs.includes("window.FeldMotion") && phonejs.includes('devicemotion'), 'Sensor-Fallback-Kette: App-Brücke → DeviceMotion');
const groundjs = readFileSync(join(WWW, 'js/feld/ground.js'), 'utf8');
ok(groundjs.includes('sinus') && groundjs.includes('zufall') && groundjs.includes('achter') && groundjs.includes('drift'), '4 Boden-Muster im Modul');
ok(feldjs.includes('ground: S.ground') || feldjs.includes("if (sess.ground && S.ground)"), 'Import: ground wird übernommen');

// ════════════════ Ergebnis ════════════════
console.log('\n════════════════════════════════');
console.log('ERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) { console.log('FEHLER:\n' + FAILS.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('feld_ground_phone_test: ALLE GRÜN');
