// ═══════════════════════════════════════════════════════════
// src_skeleton_test.mjs — v2.28.7 „der skellet ist falsch" (Nutzer-Report
// mit Referenz-Screenshot aus der ARDY-Browser-Demo, cskel27-T-Pose).
//
// Wurzel: srcPos trug nur die 13 IK-Rollen (GHOST_ROLES) — das grüne
// Lehrer-Skelett war ein Stumpf (keine Hände/Thumb1, keine Zehen, keine
// Schultern, Wirbelsäule nur Hips→Spine→Head, Arme direkt an „spine").
//
// Beweise (ohne Modell/Sim — die ECHTE Kette deckt ardy_skeleton27_diag.mjs):
//   1) SRC_EDGES/SRC_ROLES = exakte cskel27-Hierarchie (Baum, 27/26)
//   2) srcBonePairs: 27 Rollen → 26 Kanten · 13 Legacy-Rollen → EXAKT die
//      alten 12 Paare · Teilmengen → Brücken-Kanten · leer → 0
//   3) resolveSrcJoints: cskel27-Clip → alle 27, kein Node doppelt, links
//      bleibt links (leftArm ≠ LeftShoulder) · Mixamo-GLB-Namen → alle 27
//      · Degenerate-Rigs deduplizieren
//   4) groundSrcPosFrame: ToeBase (tiefster Punkt) wird auf 0 gehoben,
//      Legacy-Signatur unverändert
//   5) Persistenz: pack/unpack erhält 27-Rollen-srcPos
//   6) Verdrahtung: main.js VERSION 2.28.7 · build.gradle 48 · render3d
//      nutzt srcBonePairs (alte PAIRS-Liste weg) · retargetToRobot srcMap
// Usage: node scripts/src_skeleton_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const { SRC_EDGES, SRC_ROLES, GHOST_ROLES, resolveSrcJoints, srcBonePairs, groundSrcPosFrame, groundSrcPosTrack, reproportionSrcPos, fitSrcPosToRobot } =
  await import(path.join(WWW, 'js/retarget.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

// ── 1) Hierarchie-Integrität ───────────────────────────────
console.log('■ 1) SRC_EDGES/SRC_ROLES = cskel27-Baum');
ok(SRC_ROLES.length === 27, 'SRC_ROLES hat 27 Rollen', String(SRC_ROLES.length));
ok(new Set(SRC_ROLES).size === 27, 'SRC_ROLES eindeutig');
ok(SRC_EDGES.length === 26, 'SRC_EDGES hat 26 Kanten (Baum)', String(SRC_EDGES.length));
ok(SRC_ROLES[0] === 'hips', 'Hips ist Wurzel (Index 0)');
const children = new Set(SRC_EDGES.map(e => e[1]));
ok(children.size === 26, 'jedes Kind hat genau eine Eltern-Kante', String(children.size));
for (const [p, c] of SRC_EDGES) {
  if (!SRC_ROLES.includes(p) || !SRC_ROLES.includes(c)) ok(false, 'Kante mit unbekannter Rolle', p + '→' + c);
}
ok([...children].every(c => SRC_ROLES.includes(c)), 'alle Kanten-Kinder in SRC_ROLES');
ok(new Set(SRC_EDGES.map(e => e[0])).has('hips') && !children.has('hips'), 'Hips ist nie Kind (Wurzel)');
// Zyklus-Freiheit: von jedem Kind zur Wurzel laufen
let cycleFree = true;
for (const c of children) {
  const parentOf = {}; for (const [p, cc] of SRC_EDGES) parentOf[cc] = p;
  let cur = c, guard = 0;
  while (cur !== 'hips' && guard++ < 30) cur = parentOf[cur];
  if (cur !== 'hips') cycleFree = false;
}
ok(cycleFree, 'zyklenfrei (jedes Kind erreicht Hips)');
// GHOST_ROLES ⊂ SRC_ROLES (Legacy-Abdeckung)
ok(GHOST_ROLES.every(r => SRC_ROLES.includes(r)), 'alle 13 Legacy-Rollen in SRC_ROLES');
// cskel27-Kette: Spine-Dichte + Hände + Zehen
for (const pair of [['spine', 'spine1'], ['spine1', 'spine2'], ['spine2', 'spine3'], ['spine3', 'neck'], ['neck', 'head'],
  ['rightForeArm', 'rightHand'], ['rightHand', 'rightHandEnd'], ['rightHand', 'rightHandThumb1'],
  ['leftFoot', 'leftToeBase'], ['spine3', 'leftShoulder'], ['leftShoulder', 'leftArm']]) {
  ok(SRC_EDGES.some(([a, b]) => a === pair[0] && b === pair[1]), 'Kante ' + pair[0] + '→' + pair[1]);
}

// ── 2) srcBonePairs ────────────────────────────────────────
console.log('■ 2) srcBonePairs (Ahnen-Walk)');
const fullIdx = {}; SRC_ROLES.forEach((r, i) => { fullIdx[r] = i; });
const fullPairs = srcBonePairs(fullIdx);
ok(fullPairs.length === 26, '27 Rollen → voller 26-Kanten-Baum', String(fullPairs.length));
ok(fullPairs.every(([a, b]) => SRC_EDGES.some(([x, y]) => x === a && y === b)), 'volle Menge nutzt die Hierarchie-Kanten unverändert');

const LEGACY_PAIRS = [
  ['hips', 'spine'], ['spine', 'head'],
  ['hips', 'leftUpLeg'], ['leftUpLeg', 'leftLeg'], ['leftLeg', 'leftFoot'],
  ['hips', 'rightUpLeg'], ['rightUpLeg', 'rightLeg'], ['rightLeg', 'rightFoot'],
  ['spine', 'leftArm'], ['leftArm', 'leftForeArm'],
  ['spine', 'rightArm'], ['rightArm', 'rightForeArm'],
];
const legacyIdx = {}; GHOST_ROLES.forEach((r, i) => { legacyIdx[r] = i; });
const legacyPairs = srcBonePairs(legacyIdx).map(([a, b]) => [a, b]).sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
const expectLegacy = LEGACY_PAIRS.slice().sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
ok(JSON.stringify(legacyPairs) === JSON.stringify(expectLegacy), '13 Legacy-Rollen → EXAKT die alten 12 Paare', legacyPairs.map(p => p.join('→')).join(' '));

// Teilmenge: Hände fehlen → Unterarm-Kante fällt weg, Kopf/Arme brücken zur Wirbelsäule
const partialIdx = {}; for (const r of ['hips', 'spine', 'spine1', 'spine2', 'spine3', 'neck', 'head', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot']) partialIdx[r] = 1;
const partialPairs = srcBonePairs(partialIdx).map(([a, b]) => [a, b]);
ok(partialPairs.some(([a, b]) => a === 'neck' && b === 'head'), 'Teilmenge: Kopf hängt an Neck (vorhanden)');
ok(partialPairs.some(([a, b]) => a === 'spine3' && b === 'leftArm'), 'Teilmenge: Arm hängt an Spine3 (Schulter fehlt)');
ok(!partialPairs.some(([a, b]) => b === 'leftHand'), 'Teilmenge: fehlende Hände erzeugen keine Kanten');
ok(partialPairs.length > 0, 'Teilmenge: Kanten vorhanden', String(partialPairs.length));

ok(srcBonePairs({}).length === 0, 'leeres Mapping → 0 Paare');

// ── 3) resolveSrcJoints ────────────────────────────────────
console.log('■ 3) resolveSrcJoints (cskel27-Clip + Mixamo-GLB + dedupe)');
const { resolveBones } = await import(path.join(WWW, 'js/retarget.js'));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fakeClip(names) {
  const byName = {}; const nodes = names.map((n) => ({ name: n }));
  names.forEach((n, i) => { const k = norm(n); if (byName[k] === undefined) byName[k] = i; });
  return { nodes, byName, rotationTracks: new Map(), bestNodeFor: (a) => byName[norm(a)] };
}
const CSKEL27 = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Head', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandEnd', 'RightHandThumb1', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandEnd', 'LeftHandThumb1', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'];
// Kern-Bones (wie resolveBones sie für cskel27 liefert)
const bonesC = {
  hips: 0, spine: 1, head: 6,
  leftUpLeg: 23, leftLeg: 24, leftFoot: 25,
  rightUpLeg: 19, rightLeg: 20, rightFoot: 21,
  leftArm: 14, leftForeArm: 15, rightArm: 8, rightForeArm: 9,
};
const mapC = resolveSrcJoints(fakeClip(CSKEL27), bonesC);
const resolvedRoles = SRC_ROLES.filter(r => mapC[r] !== undefined);
ok(resolvedRoles.length === 27, 'cskel27-Clip: ALLE 27 Rollen aufgelöst', String(resolvedRoles.length));
{
  const usedVals = Object.values(mapC);
  ok(new Set(usedVals).size === usedVals.length, 'kein Node doppelt vergeben (Dedupe)');
}
ok(mapC.leftArm === 14 && mapC.rightArm === 8, 'leftArm/rightArm = ECHTE Arm-Knoten (14/8), nicht Schultern');
ok(mapC.leftShoulder === 13 && mapC.rightShoulder === 7, 'Schultern separat aufgelöst (13/7)');
ok(mapC.leftHandEnd === 17 && mapC.rightHandThumb1 === 12, 'HandEnd/Thumb1 aufgelöst (17/12)');
ok(mapC.leftToeBase === 26 && mapC.rightToeBase === 22, 'ToeBase aufgelöst (26/22)');
ok(mapC.neck === 5 && mapC.spine3 === 4, 'Neck/Spine3 aufgelöst (5/4)');

// Mixamo-GLB-Namen (Präfix) — gleiche Hierarchie, andere Namen.
// App-Pfad: ERST resolveBones (Kern-13), DANN resolveSrcJoints (27).
const MIX = CSKEL27.map(n => 'mixamorig:' + n);
const mixClip = fakeClip(MIX);
const bonesM = resolveBones(mixClip);
ok(Object.keys(bonesM).length >= 13, 'resolveBones löst Kern-Rollen am Mixamo-Clip', Object.keys(bonesM).join(','));
const mapM = resolveSrcJoints(mixClip, bonesM);
ok(SRC_ROLES.filter(r => mapM[r] !== undefined).length === 27, 'Mixamo-GLB: alle 27 Rollen über Präfix-Aliase', String(SRC_ROLES.filter(r => mapM[r] !== undefined).length));
ok(mapM.leftArm !== undefined && norm(MIX[mapM.leftArm]) === norm('mixamorig:LeftArm'), 'Mixamo leftArm = LeftArm');

// Degenerate Rig: nur ein „Neck"-Node — head-Rolle (Kern-Alias 'neck') und neck-Rolle dürfen nicht doppelt zählen
const mapD = resolveSrcJoints(fakeClip(['Hips', 'Spine', 'Neck', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']), {
  hips: 0, spine: 1, head: 2, leftUpLeg: 3, leftLeg: 4, rightUpLeg: 5, rightLeg: 6,
});
ok(Object.values(mapD).filter((v, i, a) => a.indexOf(v) !== i).length === 0, 'Degenerate Rig: kein Node doppelt');
ok(mapD.head === 2 && mapD.neck === undefined, 'Neck-Node wird NICHT doppelt vergeben (head behält ihn)');

// ── 4) groundSrcPosFrame mit ToeBase ───────────────────────
console.log('■ 4) groundSrcPosFrame: Zehenspitze auf 0');
{
  const roles = SRC_ROLES.slice(); const nR = roles.length;
  const fiL = roles.indexOf('leftFoot'), fiR = roles.indexOf('rightFoot');
  const fiLT = roles.indexOf('leftToeBase'), fiRT = roles.indexOf('rightToeBase');
  const mk = () => { const a = new Float32Array(2 * nR * 3); for (let i = 2; i < a.length; i += 3) a[i] = 0.5; return a; };
  // Fußgelenk bei 0,02 — Zehenspitze bei −0,011 (der Diag-Befund)
  const a = mk();
  a[(0 * nR + fiL) * 3 + 2] = 0.02; a[(0 * nR + fiR) * 3 + 2] = 0.02;
  a[(0 * nR + fiLT) * 3 + 2] = -0.011; a[(0 * nR + fiRT) * 3 + 2] = -0.011;
  const dz = groundSrcPosFrame(a, 0, nR, fiL, fiR, [fiLT, fiRT]);
  ok(Math.abs(dz - 0.011) < 1e-9, 'Lift = Zehen-Tiefe', dz.toFixed(4) + ' m');
  ok(Math.abs(a[(0 * nR + fiLT) * 3 + 2]) < 1e-9, 'Zehenspitze exakt auf 0');
  ok(Math.abs(a[(0 * nR + fiL) * 3 + 2] - 0.031) < 1e-9, 'Fußgelenk entsprechend angehoben', a[(0 * nR + fiL) * 3 + 2].toFixed(4));
  // Legacy-Signatur (ohne extra): Fuß UNTER 0 → Fuß auf 0 (Zehen bleiben
  // unverändert über 0) — ALT-Verhalten exakt erhalten
  const b = mk();
  b[(0 * nR + fiL) * 3 + 2] = -0.02; b[(0 * nR + fiR) * 3 + 2] = -0.02;
  b[(0 * nR + fiLT) * 3 + 2] = -0.031; b[(0 * nR + fiRT) * 3 + 2] = -0.031;
  groundSrcPosFrame(b, 0, nR, fiL, fiR);
  ok(Math.abs(b[(0 * nR + fiL) * 3 + 2]) < 1e-9, 'Legacy-Signatur unverändert (Fuß auf 0)');
  ok(Math.abs(b[(0 * nR + fiLT) * 3 + 2] + 0.011) < 1e-9, 'Legacy-Signatur: Zehen bleiben 1,1 cm darunter (genau der alte Defekt)');
  // Fuß ÜBER 0 → KEIN Lift (Sprung-Schutz), auch mit Zehen
  const b2 = mk();
  b2[(0 * nR + fiL) * 3 + 2] = 0.02; b2[(0 * nR + fiR) * 3 + 2] = 0.02;
  b2[(0 * nR + fiLT) * 3 + 2] = 0.009; b2[(0 * nR + fiRT) * 3 + 2] = 0.009;
  const dz2 = groundSrcPosFrame(b2, 0, nR, fiL, fiR, [fiLT, fiRT]);
  ok(dz2 === 0, 'Fuße über 0 → kein Lift (Sprung bleibt Sprung)');
  // groundSrcPosTrack nutzt die Zehen bei 27 Rollen
  const c = mk();
  c[(0 * nR + fiL) * 3 + 2] = 0.02; c[(0 * nR + fiR) * 3 + 2] = 0.02;
  c[(0 * nR + fiLT) * 3 + 2] = -0.011; c[(0 * nR + fiRT) * 3 + 2] = -0.011;
  c[(1 * nR + fiL) * 3 + 2] = 0.02; c[(1 * nR + fiR) * 3 + 2] = 0.02;
  c[(1 * nR + fiLT) * 3 + 2] = -0.005; c[(1 * nR + fiRT) * 3 + 2] = -0.005;
  const lifted = groundSrcPosTrack(c, 2, roles);
  ok(lifted === 2, 'groundSrcPosTrack hebt beide Frames (Zehen berücksichtigt)', String(lifted));
  ok(Math.abs(c[(0 * nR + fiLT) * 3 + 2]) < 1e-9 && Math.abs(c[(1 * nR + fiRT) * 3 + 2]) < 1e-9, 'Zehen beider Frames auf 0');
  // Legacy-13: Track unverändert (nur Füße) — Fuß UNTER 0 wird auf 0 gehoben
  const legacyRoles = GHOST_ROLES.slice(); const lN = legacyRoles.length;
  const lL = legacyRoles.indexOf('leftFoot'), lR = legacyRoles.indexOf('rightFoot');
  const d = new Float32Array(1 * lN * 3); for (let i = 2; i < d.length; i += 3) d[i] = -0.02;
  groundSrcPosTrack(d, 1, legacyRoles);
  ok(Math.abs(d[(lL) * 3 + 2]) < 1e-9, 'Legacy-13-Track: Fuß exakt auf 0');
}

// ── 5) Persistenz ──────────────────────────────────────────
console.log('■ 5) pack/unpack mit 27 Rollen');
{
  const n = 4, nR = 27, fps = 20;
  const srcPos = new Float32Array(n * nR * 3);
  for (let i = 0; i < srcPos.length; i += 3) { srcPos[i] = 0.01 * (i % 7); srcPos[i + 1] = 0.02 * (i % 5); srcPos[i + 2] = 0.03 * (i % 11); }
  const m = {
    q: new Float32Array(n * 29), h: new Float32Array(n).fill(0.78), root: new Float32Array(2 * n),
    yaw: new Float32Array(n), baseQ: new Float32Array(4 * n), n, nu: 29, fps,
    duration: n / fps, srcPos, srcJoints: SRC_ROLES.slice(),
  };
  const rec = JSON.parse(JSON.stringify(packMotion(m)));
  const back = unpackMotion(rec, 'ardy');
  ok(back.srcJoints && back.srcJoints.length === 27, 'srcJoints 27 nach Roundtrip');
  ok(back.srcPos && back.srcPos.length === srcPos.length && back.srcPos.every((v, i) => Math.abs(v - srcPos[i]) < 1e-6), 'srcPos bitgenau nach Roundtrip');
}

// ── 6) Verdrahtung ─────────────────────────────────────────
console.log('■ 6) Verdrahtungs-Pins');
{
  const main = readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
  ok(/const VERSION = '2\.28\.7'/.test(main) || /const VERSION = '2\.28\.8'/.test(main) || /const VERSION = '2\.28\.9'/.test(main) || /const VERSION = '2\.28\.10'/.test(main) || /const VERSION = '2\.28\.11'/.test(main), "main.js VERSION 2.28.7-2.28.11");
  const grad = readFileSync(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(/versionCode 48/.test(grad) || /versionCode 49/.test(grad) || /versionCode 50/.test(grad) || /versionCode 51/.test(grad) || /versionCode 52/.test(grad), 'build.gradle versionCode 48-52');
  ok(/versionName "2\.28\.7"/.test(grad) || /versionName "2\.28\.8"/.test(grad) || /versionName "2\.28\.9"/.test(grad) || /versionName "2\.28\.10"/.test(grad) || /versionName "2\.28\.11"/.test(grad), 'build.gradle versionName 2.28.7-2.28.11');
  const rt = readFileSync(path.join(WWW, 'js/retarget.js'), 'utf8');
  ok(/export function resolveSrcJoints/.test(rt), 'retarget.js: resolveSrcJoints exportiert');
  ok(/export function srcBonePairs/.test(rt), 'retarget.js: srcBonePairs exportiert');
  ok(/export const SRC_EDGES/.test(rt) && /export const SRC_ROLES/.test(rt), 'retarget.js: SRC_EDGES/SRC_ROLES exportiert');
  ok(/worldPos\.get\(srcMap\[ghostRoles\[gi\]\]\)/.test(rt), 'retargetToRobot: srcPos füllt via srcMap (27 Rollen)');
  ok(/groundSrcPosFrame\(srcPos, f, ghostRoles\.length, fiLFoot, fiRFoot, \[fiLToe, fiRToe\]\)/.test(rt), 'retargetToRobot: ToeBase in Boden-Garantie');
  ok(/const fiLT = srcJoints\.indexOf\('leftToeBase'\)/.test(rt), 'groundSrcPosTrack: ToeBase-Indizes');
  const r3 = readFileSync(path.join(WWW, 'js/render3d.js'), 'utf8');
  ok(/import \{ srcBonePairs \} from '\.\/retarget\.js'/.test(r3), 'render3d.js: srcBonePairs importiert');
  ok(/const PAIRS = srcBonePairs\(this\._srcIdx\)/.test(r3), 'render3d.js: PAIRS dynamisch');
  ok(!/\['spine', 'head'\],\s*\n\s*\['hips', 'leftUpLeg'\]/.test(r3), 'render3d.js: alte Hartkodierung entfernt');
  const ardy = readFileSync(path.join(WWW, 'js/ardy.js'), 'utf8');
  ok(/mirrorArdyOutputX/.test(ardy), 'ardy.js: X-Spiegelung unverändert vorhanden');
  ok(/DECODER_FP32_BYTES = 71642198/.test(ardy), 'ardy.js: fp32-Fingerprint unverändert');
}

// ── 6) reproportionSrcPos — Knochenlängen-Transfer (v2.28.8) ──
console.log('■ 6) reproportionSrcPos (Knochenlängen-Transfer)');
{
  // Kette Hips→Spine→Spine1→Spine2 (vereinfacht): Richtungen aus dem Lehrer,
  // Längen aus lens — die Kette muss AKKUMULIEREN (Eltern aus dem ÜBERTRAGENEN
  // Stand). (head braucht neck/spine2/spine3 — Teilbaum ohne die Kante.)
  const roles = ['hips', 'spine', 'spine1', 'spine2']; // Kette mit 3 Kanten
  const n = 2;
  const src = new Float32Array(n * 4 * 3);
  for (let f = 0; f < n; f++) {
    const b = f * 4 * 3;
    // Lehrer: Hips (0,0,f) → Spine (0,0,0.5) → Spine1 (0,0,1.0) → Spine2 (0,0,1.5) — gerade hoch
    src[b + 2] = f; src[b + 3 * 1 + 2] = 0.5 + f; src[b + 3 * 2 + 2] = 1.0 + f; src[b + 3 * 3 + 2] = 1.5 + f;
  }
  const lens = { spine: 0.2, spine1: 0.2, spine2: 0.2 };
  const work = src.slice();
  ok(reproportionSrcPos(work, roles, n, lens) === true, 'Transfer meldet Änderung');
  const z = (f, r) => work[(f * 4 + roles.indexOf(r)) * 3 + 2];
  ok(Math.abs(z(0, 'hips') - 0) < 1e-9, 'Hips = Anker unverändert');
  ok(Math.abs((z(0, 'spine') - z(0, 'hips')) - 0.2) < 1e-6, 'Kante 1 = lens.spine', (z(0, 'spine') - z(0, 'hips')).toFixed(3));
  ok(Math.abs((z(0, 'spine1') - z(0, 'spine')) - 0.2) < 1e-6, 'Kante 2 akkumuliert auf ÜBERTRAGENEM Elter', (z(0, 'spine1') - z(0, 'spine')).toFixed(3));
  ok(Math.abs((z(0, 'spine2') - z(0, 'spine1')) - 0.2) < 1e-6, 'Kante 3 akkumuliert (Ketten-Bug gefixt)', (z(0, 'spine2') - z(0, 'spine1')).toFixed(3));
  // Richtung erhalten: statt senkrecht schräger Lehrer-Knochen bleibt die Richtung
  const src2 = new Float32Array(1 * 4 * 3);
  src2[2] = 0; src2[3 + 2] = 0.5; src2[6 + 0] = 0.3; src2[6 + 2] = 1.0; src2[9 + 2] = 1.5; // spine1 seitlich versetzt
  const w2 = src2.slice();
  reproportionSrcPos(w2, roles, 1, { spine: 0.2, spine1: 0.2, head: 0.2 });
  const dirBefore = [src2[6] - src2[3], src2[8] - src2[5]];
  const dirAfter = [w2[6] - w2[3], w2[8] - w2[5]];
  const cross = Math.abs(dirBefore[0] * dirAfter[1] - dirBefore[1] * dirAfter[0]);
  ok(cross < 1e-6, 'Richtung des Lehrer-Knochens bleibt erhalten', 'cross=' + cross.toExponential(1));
  // Idempotenz: 2. Transfer mit denselben Längen ändert nichts
  const snap = w2.slice();
  reproportionSrcPos(w2, roles, 1, { spine: 0.2, spine1: 0.2, head: 0.2 });
  ok(w2.every((v, i) => Math.abs(v - snap[i]) < 1e-6), 'idempotent (2. Transfer = identisch)');
  // NaN-Frame bleibt NaN, leeres lens = unverändert
  const src3 = new Float32Array(1 * 4 * 3); src3[6] = NaN;
  const w3 = src3.slice();
  reproportionSrcPos(w3, roles, 1, { spine: 0.2, spine1: 0.2, head: 0.2 });
  ok(Number.isNaN(w3[6]), 'NaN-Elter → Kind NaN (Renderer versteckt)');
  const w4 = src2.slice();
  reproportionSrcPos(w4, roles, 1, {});
  ok(w4.every((v, i) => Math.abs(v - src2[i]) < 1e-6), 'ohne lens-Einträge: Lehrer-Längen bleiben');
  ok(reproportionSrcPos(null, roles, 1, lens) === false, 'Guard: null → false');
}

// ── 7) fitSrcPosToRobot überspringt srcRig-Motion ──────────
console.log('■ 7) srcRig-Marker + Persistenz');
{
  const n = 4, nR = 27;
  const srcPos = new Float32Array(n * nR * 3);
  for (let i = 2; i < srcPos.length; i += 3) srcPos[i] = 0.9;
  const m = { q: new Float32Array(n * 29), h: new Float32Array(n).fill(0.78), root: new Float32Array(2 * n), yaw: new Float32Array(n), baseQ: new Float32Array(4 * n), n, nu: 29, fps: 20, duration: n / 20, srcPos, srcJoints: SRC_ROLES.slice(), srcRig: 1 };
  ok(fitSrcPosToRobot(m) === 0, 'srcRig=1 → uniformer Fit übersprungen (Roboter-Längen schon da)');
  const m2 = Object.assign({}, m, { srcRig: 0 });
  const F = fitSrcPosToRobot(m2);
  ok(F > 0, 'ohne srcRig: Fit wirkt weiterhin (Legacy-Pfad)', 'F=' + F.toFixed(3));
  // Persistenz
  const rec = JSON.parse(JSON.stringify(packMotion(m)));
  ok(rec.srcRig === 1, 'packMotion persistiert srcRig');
  const back = unpackMotion(rec, 'ardy');
  ok(back.srcRig === 1, 'unpackMotion erhält srcRig');
  const rec2 = JSON.parse(JSON.stringify(packMotion(m2)));
  ok((unpackMotion(rec2, 'ardy').srcRig || 0) === 0, 'srcRig=0-Roundtrip (alte Datensätze)');
}

// ── 8) Verdrahtung ─────────────────────────────────────────
console.log('■ 8) Verdrahtungs-Pins');
{
  const main = readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
  ok(/const VERSION = '2\.28\.8'/.test(main) || /const VERSION = '2\.28\.9'/.test(main) || /const VERSION = '2\.28\.10'/.test(main) || /const VERSION = '2\.28\.11'/.test(main), "main.js VERSION '2.28.8'-'2.28.11'");
  const grad = readFileSync(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(/versionCode 49/.test(grad) || /versionCode 50/.test(grad) || /versionCode 51/.test(grad) || /versionCode 52/.test(grad), 'build.gradle versionCode 49-52');
  ok(/versionName "2\.28\.8"/.test(grad) || /versionName "2\.28\.9"/.test(grad) || /versionName "2\.28\.10"/.test(grad) || /versionName "2\.28\.11"/.test(grad), 'build.gradle versionName 2.28.8-2.28.11');
  const rt = readFileSync(path.join(WWW, 'js/retarget.js'), 'utf8');
  ok(/export function reproportionSrcPos/.test(rt), 'retarget.js: reproportionSrcPos exportiert');
  ok(/if \(motion\.srcRig\) return 0;/.test(rt), 'fitSrcPosToRobot: srcRig-Skip');
  ok(/let srcRig = 0;/.test(rt) && /srcRig, \/\/ v2\.28\.8/.test(rt), 'retargetToRobot: srcRig gemessen + zurückgegeben');
  ok(/const shoulderOf = \(elbowBody\)/.test(rt), 'Schulter = höchster Vorfahre des Ellbogens');
  ok(/tMin\[f\] - \(Number\.isFinite\(m\) \? m : tMin\[f\]\)/.test(rt), 'Boden-BEZIEHUNG des Lehrers erhalten (senken UND heben)');
  const gs = readFileSync(path.join(WWW, 'js/glbstore.js'), 'utf8');
  ok(/srcRig: motion\.srcRig \|\| 0/.test(gs) && /srcRig: rec\.srcRig \|\| 0/.test(gs), 'glbstore: srcRig persistiert');
  const ardy = readFileSync(path.join(WWW, 'js/ardy.js'), 'utf8');
  ok(/mirrorArdyOutputX/.test(ardy), 'ardy.js: X-Spiegelung unverändert vorhanden');
}

console.log('\n═══ ERGEBNIS: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen ═══');
process.exit(fail === 0 ? 0 : 1);
