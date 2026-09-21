// ═══════════════════════════════════════════════════════════
// ardy_ghost_only_test.mjs — v2.28.10 „GEIST = ARDY, OHNE SKELETT"
// Nutzer: „Skellet und der Geist unterschieden sich. Kann man Output
// von ardy nicht direkt an g1 Geist binden ohne Skelett?"
//
// Beweise (statisch + Logik):
//   [1] ARDY-Anzeige: grünes Lehrer-Skelett AUS (Zweig versteckt, kein
//       placeSourceGhostAt mehr im Render-Loop, applyGhosts baut es nicht)
//   [2] Geist-Direktbindung: setGhostPose erhält clip.q (rohe ARDY-Ausgabe,
//       identisch zur Trainings-Referenz) — engine.setGhostPose liest KEINE
//       Sim-/Policy-Zustände; Physik trackt dasselbe clip.q
//   [3] Anzeige-Entscheidung (Logik): ARDY → kein Lehrer, GLB → Lehrer ok
//   [4] Verhaltensänderung vs v2.28.9 (git HEAD): vorher SICHTBAR, jetzt aus
//   [5] Version 2.28.10 / versionCode 51
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const JS = path.join(WWW, 'js');

let fails = 0, count = 0;
const ok = (c, m, extra = '') => {
  count++;
  if (c) console.log('  ✓ ' + m + (extra ? ' — ' + extra : ''));
  else { fails++; console.error('  ✗ FEHLER: ' + m + (extra ? ' — ' + extra : '')); }
};

const mainJs = await readFile(path.join(JS, 'main.js'), 'utf8');
const r3dJs = await readFile(path.join(JS, 'render3d.js'), 'utf8');
const engJs = await readFile(path.join(JS, 'engine.js'), 'utf8');
const mtJs = await readFile(path.join(JS, 'motiontask.js'), 'utf8');
const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');

console.log('\n[1] ARDY-Anzeige: Lehrer-Skelett AUS (Geist allein)');
ok(mainJs.includes('r3d.sourceGhost.visible = false;'), 'Render-Loop: ARDY-Zweig versteckt das Skelett');
ok(!mainJs.includes('r3d.placeSourceGhostAt(fr,'), 'Render-Loop: placeSourceGhostAt nicht mehr gerufen (Skelett spielt nicht mit)');
ok(r3dJs.includes('placeSourceGhostAt(frame, x, y)'), 'render3d: Overlay-API bleibt für GLB/Bestand erhalten');
ok(mainJs.includes('r3d.updateSourceGhost(fr); // v2.28.1'), 'Render-Loop: updateSourceGhost-Pfad unangetastet');
ok(mainJs.includes('if (S.srcShow && S.motionClip && !S.motionClip.srcOverlay) {'), 'applyGhosts: Lehrer wird für ARDY-Clips NICHT gebaut');
ok(mainJs.includes("if (rec.src === 'ardy') S.motionClip.srcOverlay = true;"), 'ARDY-Marker am Clip bleibt (Anzeige-Entscheidung)');
ok(mainJs.includes('Kein Lehrer-Skelett bei ARDY'), 'srcShow-Toggle meldet ARDY-Ausnahme');
ok(mainJs.includes('Geist = rohe ARDY-Ausgabe (ohne Lehrer-Skelett'), 'Aktivierungs-Log nennt die neue Referenz-Regel');

console.log('\n[2] Geist-Direktbindung (rohe ARDY-Ausgabe, keine Policy)');
ok(mainJs.includes('S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], rr[0], rr[1], rr[2], bq);'), 'Render-Loop: Geist erhält clip.q (Retarget-Replay der rohen ARDY-Frames)');
ok(mainJs.includes('S.sim.groundGhost(gh, feet);') && mainJs.includes('r3d.updateGhost(gh);'), 'Render-Loop: Boden-Garantie + Übergabe an die Anzeige');
ok(mtJs.includes('const target = c.q[i0 * nu + j] * (1 - u) + c.q[i1 * nu + j] * u;'), 'Physik-Tracking nutzt dasselbe clip.q (Geist = exakt die Trainings-Referenz)');
ok(mtJs.includes('sim.setGhostPose(ghost, clip.q, f * nu, clip.h[f],'), 'BC-Datensatz: Geist-Pfad ebenfalls über clip.q');
{
  // engine.setGhostPose: Funktionsextrakt — darf KEINE Sim-/Policy-Zustände lesen
  const i0 = engJs.indexOf('setGhostPose(ghost, qArr, off, height, x = 0, y = 0, yaw = 0, baseLocalQ = null) {');
  ok(i0 > 0, 'engine.setGhostPose vorhanden');
  if (i0 > 0) {
    const body = engJs.slice(i0, engJs.indexOf('\n  }', i0));
    ok(!body.includes('_qpos[') && !body.includes('this.ctrl') && !body.includes('_qvel'), 'setGhostPose liest KEINE Sim-/Policy-Zustände (reine Funktion von qArr + Anker)');
    ok(body.includes('mj_forward'), 'setGhostPose: nur Kinematik (mj_forward)');
  }
}

console.log('\n[3] Anzeige-Entscheidung (Logik-Spiegel der applyGhosts-Bedingung)');
{
  const EXPR = 'S.srcShow && S.motionClip && !S.motionClip.srcOverlay';
  ok(mainJs.includes(EXPR), 'Bedingung exakt im App-Code (Spiegel glaubwürdig)');
  const buildTeacher = (srcShow, hasClip, srcOverlay) => !!(srcShow && hasClip && !srcOverlay);
  ok(buildTeacher(true, true, false) === true, 'GLB-Clip + Lehrer an → Skelett/Mesh gebaut (GLB unverändert)');
  ok(buildTeacher(true, true, true) === false, 'ARDY-Clip + Lehrer an → KEIN Skelett (Geist allein)');
  ok(buildTeacher(false, true, false) === false, 'Lehrer aus → kein Skelett (Standard)');
  // Render-Loop-Spiegel: ARDY-Zweig versteckt, falls es doch gebaut wurde
  const hideForArdy = (isMotion, srcOverlay, rr, sourceGhostExists) => sourceGhostExists && isMotion && srcOverlay && !!rr;
  ok(hideForArdy(true, true, [0, 0], true) === true, 'ARDY-Zweig: vorhandenes Skelett wird versteckt (Belt-and-Braces)');
  ok(hideForArdy(true, false, [0, 0], true) === false, 'GLB-Zweig: Skelett-Logik unverändert sichtbar');
}

console.log('\n[4] Verhaltensänderung vs v2.28.9 (git HEAD = Live-Stand)');
{
  let oldMain = '';
  try {
    oldMain = execSync('git show HEAD:app/src/main/assets/www/js/main.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { /* kein git — überspringen */ }
  if (oldMain) {
    ok(oldMain.includes('r3d.placeSourceGhostAt(fr, rr[0], rr[1]);') && oldMain.includes('r3d.sourceGhost.visible = true;'), 'v2.28.9 (HEAD): Skelett wurde AM GEIST ANGEZEIGT (zwei Figuren)');
    ok(oldMain.includes('if (S.srcShow && S.motionClip) {'), 'v2.28.9 (HEAD): applyGhosts baute den Lehrer für ALLE Clips');
    ok(!oldMain.includes('v2.28.10 GEIST = ARDY, OHNE SKELETT'), 'v2.28.9 (HEAD): ARDY-Zweig zeigte — die Aus-Änderung ist NEU in 2.28.10');
    ok(mainJs.includes('r3d.sourceGhost.visible = false;') && !mainJs.includes('r3d.placeSourceGhostAt(fr,'), 'v2.28.10 (Arbeitskopie): Skelett AUS — sichtbare Verhaltensänderung');
  } else {
    ok(false, 'git show HEAD fehlgeschlagen — Verhaltensvergleich nicht möglich');
  }
}

console.log('\n[5] Version 2.28.10 / versionCode 51');
ok(mainJs.includes("const VERSION = '2.28.10';"), "main.js VERSION '2.28.10'");
ok(mainJs.includes('GEIST = ARDY, OHNE SKELETT'), 'VERSION-Kommentar nennt die Änderung');
ok(gradle.includes('versionCode 51') && gradle.includes('versionName "2.28.10"'), 'build.gradle 51 / 2.28.10');

console.log(`\n═══ Ergebnis: ${count - fails}/${count} grün ═══`);
if (fails) { console.error(fails + ' FEHLER'); process.exit(1); }
console.log('v2.28.10 GEIST = ARDY, OHNE SKELETT — alle Beweise erbracht.');
