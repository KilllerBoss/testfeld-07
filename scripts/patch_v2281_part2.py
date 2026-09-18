#!/usr/bin/env python3
# patch_v2281_part2.py — main.js: Overlay im Render-Loop, activateClip-
# Reparatur alter Clips, ARDY-Geist-lenk-Standard, Kollaps-Warnung, Version.
import io

ROOT = '/home/z/my-project/app/src/main/assets/www'

def rw(path, fn):
    with io.open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    out = fn(src)
    if out is None:
        print('SKIP: ' + path); return
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK: ' + path)

def must_sub(src, needle, ctx=''):
    if needle not in src:
        raise SystemExit('NICHT GEFUNDEN: ' + ctx + ' :: ' + needle[:160])

def patch_main(src):

    # ── 0) Import von groundSrcPosTrack ─────────────────────────
    o = "import { retargetToG1, retargetToRobot, RT_ALG, findFootGeoms } from './retarget.js';"
    n = "import { retargetToG1, retargetToRobot, RT_ALG, findFootGeoms, groundSrcPosTrack } from './retarget.js'; // v2.28.1: Boden-Reparatur für gespeicherte Clips"
    must_sub(src, o, 'retarget-Import')
    src = src.replace(o, n, 1)

    # ── 1) VERSION ─────────────────────────────────────────────
    import re
    m = re.search(r"const VERSION = '2\.28\.0'; // [^\n]*", src)
    if not m:
        raise SystemExit('VERSION-Zeile 2.28.0 nicht gefunden')
    old_line = m.group(0)
    new_line = ("const VERSION = '2.28.1'; // v2.28.1: BODEN-REPARATUR (alte ARDY/GLB-Clips werden beim Aktivieren geerdet) + ARDY-OVERLAY "
                "(grünes Skeleton reitet exakt auf dem Geist — nichts ist mehr auseinander) + Geist-lenk-Standard für ARDY (Stick fährt sofort die Referenz) "
                "+ Kollaps-Warnung bei kollabierter Generierung. v2.28.0: GEIST LENKEN (Stick führt die Referenz in JEDEM Modus) + BODEN-GARANTIE "
                "(groundGhost + Skeleton-Erdung). v2.27.1: Session-Key-Fix (textEncoder). v2.27.0: Geist-Fix + Modell-Import + Geist lenken.")
    src = src.replace(old_line, new_line, 1)

    # ── 2) Render-Loop: Overlay-Branch + updateSourceGhost ans Ende ──
    rl_old = '''      if (r3d.sourceGhost) {
        r3d.updateSourceGhost(fr);
        const mode = isMotion ? S.task.refMode : S.task.refMode;
        if (mode === 'frei' && isMotion && rr && clip.root) {
          r3d.setSourceGhostLoop(rr[0] - clip.root[2 * fr], rr[1] - clip.root[2 * fr + 1]);
          r3d.sourceGhost.visible = true;
        } else if (rr && mode !== 'stelle') {
          // 'folgt' (Roboter/Drohne): Geist hängt am Roboter (srcPos = relativ)
          r3d.setSourceGhostLoop(0, 0);
          r3d.sourceGhost.position.set(rr[0], rr[1], 0);
          r3d.sourceGhost.visible = true;
        } else if (mode === 'stelle') {
          // Auf der Stelle: Original-Mesh aus — seine srcPos laufen sonst die
          // Wegroute ab. Der Roboter-Geist (setGhostPose) zeigt die Pose korrekt.
          r3d.sourceGhost.visible = false;
        }
      }'''
    rl_new = '''      if (r3d.sourceGhost) {
        const mode = isMotion ? S.task.refMode : S.task.refMode;
        if (isMotion && clip.srcOverlay && rr) {
          // v2.28.1 ARDY-OVERLAY: das grüne Skeleton reitet EXAKT auf dem
          // Geist-Anker (Demo-Avatar-Prinzip: EINE Figur spielt die Motion).
          // Relative Darstellung + Gruppen-Offset je Frame → die Hüfte des
          // Skeletons sitzt Millimeter-genau auf der Geist-Basis. Der Weg,
          // den die ARDY-Hüfte im Clip nimmt, kürzt sich heraus — nichts
          // wandert mehr auseinander, auch nicht bei Geist-lenk (Stick).
          r3d.placeSourceGhostAt(fr, rr[0], rr[1]);
          r3d.sourceGhost.visible = true;
        } else {
          // GLB-Pfade: absolute Darstellung (konsistent mit dem Original-Mesh)
          r3d.setSourceGhostRelative(false);
          if (mode === 'frei' && isMotion && rr && clip.root) {
            r3d.setSourceGhostLoop(rr[0] - clip.root[2 * fr], rr[1] - clip.root[2 * fr + 1]);
            r3d.sourceGhost.visible = true;
          } else if (rr && mode !== 'stelle') {
            // 'folgt' (Roboter/Drohne): Geist hängt am Roboter (srcPos = relativ)
            r3d.setSourceGhostLoop(0, 0);
            r3d.sourceGhost.position.set(rr[0], rr[1], 0);
            r3d.sourceGhost.visible = true;
          } else if (mode === 'stelle') {
            // Auf der Stelle: Original-Mesh aus — seine srcPos laufen sonst die
            // Wegroute ab. Der Roboter-Geist (setGhostPose) zeigt die Pose korrekt.
            r3d.sourceGhost.visible = false;
          }
        }
        r3d.updateSourceGhost(fr); // v2.28.1: NACH der Anker-Wahl (Relativ-Flag!)
      }'''
    must_sub(src, rl_old, 'Render-Loop sourceGhost-Block')
    src = src.replace(rl_old, rl_new, 1)

    # ── 3) activateClip: Reparatur + srcOverlay + ARDY-Standards ──
    ac_old = '''  // Lehrer-Ghost: v2.24.0 — der GEIST zeigt die trainierte Referenz;
  // das Original-Mesh wird nur gebaut, wenn der Nutzer „Original" einschaltet
  // (Standard AUS: „Mesh weg, nur den Geist" — spart RAM & Upload).
  // Drohne: nur Lehrer — der Dronen-Geist wäre statisch/irreführend.
  S.srcScene = null;
  applyGhosts();'''
    ac_new = '''  // ── v2.28.1 BODEN-REPARATUR (Migration): vor der v2.28.0-Boden-Garantie
  // generierte Clips tragen ungeerdete srcPos (Skeleton hängt im Boden).
  // Beim Aktivieren je Frame erden und SOFORT PERSISTIEREN — der alte
  // Bestand ist danach dauerhaft repariert (ohne Re-Generierung).
  if (S.motionClip.srcPos && S.motionClip.srcJoints && S.motionClip.n) {
    try {
      const lifted = groundSrcPosTrack(S.motionClip.srcPos, S.motionClip.n, S.motionClip.srcJoints);
      if (lifted > 0) {
        const packedFix = packMotion(S.motionClip);
        rec.motionByRobot = rec.motionByRobot || {};
        rec.motionByRobot[S.robotId] = packedFix;
        if (S.robotId === 'g1') rec.motion = packedFix;
        await putClip(rec);
        log('Boden-Reparatur: ' + lifted + ' Frames des Lehrer-Skeletons auf den Boden gehoben (alter Bestand vor der Boden-Garantie)' + (rec.src === 'ardy' ? ' — für beste Posen-Qualität den Clip neu generieren' : ''));
      }
    } catch (e) { /* Reparatur ist rein visuell — kein Grund abzubrechen */ }
  }
  // v2.28.1 ARDY-OVERLAY: das grüne Skeleton gehört ZUM Geist (eine Figur).
  if (rec.src === 'ardy') S.motionClip.srcOverlay = true;
  // v2.28.1 GEIST-LENK-STANDARD für ARDY: der Nutzer erwartet, dass der
  // Stick SOFORT die ARDY-Referenz fährt („der Geist, was ARDY steuert").
  // Ohne gespeicherte Steuerungswahl gilt: ctrl 'joy' + refMode 'folgt'.
  // Explizite Chip-Wahlen (joy/btn/none) bleiben erhalten.
  if (rec.src === 'ardy') {
    if (rec.ctrl !== 'joy' && rec.ctrl !== 'btn' && rec.ctrl !== 'none') {
      rec.ctrl = 'joy';
      await putClip(rec).catch(() => {});
      log('Steuerung: JOYSTICK (Standard für ARDY) — der Stick fährt jetzt die Referenz; über die Steuer-Chips änderbar');
    }
    S.refMode = 'folgt';
    try { localStorage.setItem('tr_refmode_v1', 'folgt'); } catch (e) { /* voll */ }
  }
  // Lehrer-Ghost: v2.24.0 — der GEIST zeigt die trainierte Referenz;
  // das Original-Mesh wird nur gebaut, wenn der Nutzer „Original" einschaltet
  // (Standard AUS: „Mesh weg, nur den Geist" — spart RAM & Upload).
  // Drohne: nur Lehrer — der Dronen-Geist wäre statisch/irreführend.
  S.srcScene = null;
  applyGhosts();'''
    must_sub(src, ac_old, 'activateClip applyGhosts-Block')
    src = src.replace(ac_old, ac_new, 1)

    # ── 4) runArdy: rec.ctrl = 'joy' + Kollaps-Warnung ──
    ra_old = '''      const rec = {
        id: 'ardy_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name,
        size: out.frameCount * 27 * 3 * 4,
        glb: null,               // keine Mesh-Datei → nie Re-Retarget
        animIndex: 0,
        src: 'ardy',             // auf dem Gerät generiert
        prompt: out.promptsLive || prompt,
        seed: out.seed,
        motion: packed,
        motionByRobot: { g1: packed }, // v2.15.0-Konvention
      };'''
    ra_new = '''      // v2.28.1 KOLLAPS-WARNUNG: driftet die Generierung (ARDY Mini ist
      // autoregressiv — lange/unübliche Prompts können kollabieren), sage
      // es KLAR — der Nutzer soll App-Fehler von Modell-Ausreißern trennen.
      let hMin = Infinity, hMax = -Infinity;
      for (let i = 0; i < motion.h.length; i++) { hMin = Math.min(hMin, motion.h[i]); hMax = Math.max(hMax, motion.h[i]); }
      if (hMax < 0.55 || hMin < 0.32) {
        log('ARDY-Warnung: die generierte Bewegung kollabiert (Hüftenhöhe ' + hMin.toFixed(2) + '–' + hMax.toFixed(2) + ' m) — bitte anderen Prompt oder anderen Seed probieren', 'warn');
        ui.toast('Bewegung kollabiert — anderen Prompt/Seed probieren', true, 4500);
      }
      const rec = {
        id: 'ardy_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name,
        size: out.frameCount * 27 * 3 * 4,
        glb: null,               // keine Mesh-Datei → nie Re-Retarget
        animIndex: 0,
        src: 'ardy',             // auf dem Gerät generiert
        ctrl: 'joy',             // v2.28.1: Geist-lenk-Standard (Stick fährt die Referenz)
        prompt: out.promptsLive || prompt,
        seed: out.seed,
        motion: packed,
        motionByRobot: { g1: packed }, // v2.15.0-Konvention
      };'''
    must_sub(src, ra_old, 'runArdy rec-Erzeugung')
    src = src.replace(ra_old, ra_new, 1)

    return src

rw(ROOT + '/js/main.js', patch_main)

# ═══════════════════════════════════════════════════════════
# build.gradle: versionCode 42 / 2.28.1
# ═══════════════════════════════════════════════════════════
def patch_gradle(src):
    import re
    src2 = re.sub(r'versionCode \d+', 'versionCode 42', src)
    src2 = re.sub(r'versionName "[^"]+"', 'versionName "2.28.1"', src2)
    return src2

rw('/home/z/my-project/app/build.gradle', patch_gradle)
print('Teil 2 fertig (main.js + build.gradle).')
