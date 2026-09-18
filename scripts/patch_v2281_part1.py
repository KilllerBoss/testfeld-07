#!/usr/bin/env python3
# patch_v2281.py — v2.28.1: Boden-Reparatur alter Clips + ARDY-Geist-lenk-Standard
# + Skeleton-Overlay auf dem Geist. Siehe worklog Task 52.
import io, re, sys

ROOT = '/home/z/my-project/app/src/main/assets/www'

def rw(path, fn):
    with io.open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    out = fn(src)
    if out is None:
        print('SKIP (keine Änderung): ' + path); return
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK: ' + path)

def must_sub(src, needle, ctx=''):
    if needle not in src:
        raise SystemExit('NICHT GEFUNDEN: ' + ctx + ' :: ' + needle[:120])

# ═══════════════════════════════════════════════════════════
# 1) retarget.js — Erdungs-Helfer extrahieren + exportieren
# ═══════════════════════════════════════════════════════════
def patch_retarget(src):
    old_block = '''    // v2.28.0 BODEN-GARANTIE für den Lehrer-Skeleton: ARDY-Höhendrift (oder
    // sloppy GLB-Assets) darf die Figur NICHT unter den Boden hängen. Je
    // Frame: tiefsten Fußpunkt messen (Fallback: alle Rollen) und den
    // Skeleton ANHEBEN, bis der Fuß bei 0 steht. Sprünge bleiben unangetastet
    // (beide Füße über 0 → kein Lift), Gehen bleibt unverändert (ein Fuß
    // ist immer nahe 0 — der Lift ist dort ~0).
    {
      const nR = ghostRoles.length;
      const probe = (gi) => {
        const z = srcPos[(f * nR + gi) * 3 + 2];
        return Number.isFinite(z) ? z : Infinity;
      };
      let minZ = Infinity;
      const fiL = ghostRoles.indexOf('leftFoot'), fiR = ghostRoles.indexOf('rightFoot');
      if (fiL >= 0) minZ = Math.min(minZ, probe(fiL));
      if (fiR >= 0) minZ = Math.min(minZ, probe(fiR));
      if (!Number.isFinite(minZ)) {
        for (let gi = 0; gi < nR; gi++) minZ = Math.min(minZ, probe(gi));
      }
      if (Number.isFinite(minZ) && minZ < 0) {
        const dz = -minZ;
        for (let gi = 0; gi < nR; gi++) srcPos[(f * nR + gi) * 3 + 2] += dz;
      }
    }'''
    new_block = '''    // v2.28.0 BODEN-GARANTIE für den Lehrer-Skeleton: ARDY-Höhendrift (oder
    // sloppy GLB-Assets) darf die Figur NICHT unter den Boden hängen. Je
    // Frame: tiefsten Fußpunkt messen (Fallback: alle Rollen) und den
    // Skeleton ANHEBEN, bis der Fuß bei 0 steht. Sprünge bleiben unangetastet
    // (beide Füße über 0 → kein Lift), Gehen bleibt unverändert (ein Fuß
    // ist immer nahe 0 — der Lift ist dort ~0).
    // v2.28.1: Logik im exportierten groundSrcPosFrame — dieselbe Garantie
    // repariert auch GESPEICHERTE alte Clips beim Aktivieren (Migration).
    groundSrcPosFrame(srcPos, f, ghostRoles.length, fiLFoot, fiRFoot);'''
    must_sub(src, old_block, 'retarget.js Erdungsblock')
    src = src.replace(old_block, new_block)

    # Fuß-Indizes einmalig VOR der Frame-Schleife bestimmen ( Performance)
    anchor = '''  const srcPos = new Float32Array(n * ghostRoles.length * 3);
  const srcJoints = ghostRoles.slice();'''
    anchor_new = '''  const srcPos = new Float32Array(n * ghostRoles.length * 3);
  const srcJoints = ghostRoles.slice();
  const fiLFoot = ghostRoles.indexOf('leftFoot'), fiRFoot = ghostRoles.indexOf('rightFoot'); // v2.28.1'''
    must_sub(src, anchor, 'retarget.js srcPos-Anchor')
    src = src.replace(anchor, anchor_new)

    # Exportierte Helfer ans Dateiende anhängen (vor letzter Zeile? — einfach anhängen)
    helpers = '''

// ═══ v2.28.1 BODEN-REPARATUR (Migration für gespeicherte Clips) ═══
// Hebt in EINEM Frame den tiefsten Fußpunkt exakt auf 0 (Fallback: alle
// Rollen, NaN-sicher). Sprünge (beide Füße über 0) bleiben unangetastet.
// Wird von retargetToG1 je Frame UND von activateClip zur Reparatur alter
// Bestände (vor der v2.28.0-Boden-Garantie generiert) benutzt.
export function groundSrcPosFrame(srcPos, f, nR, fiL = -1, fiR = -1) {
  const probe = (gi) => {
    const z = srcPos[(f * nR + gi) * 3 + 2];
    return Number.isFinite(z) ? z : Infinity;
  };
  let minZ = Infinity;
  if (fiL >= 0) minZ = Math.min(minZ, probe(fiL));
  if (fiR >= 0) minZ = Math.min(minZ, probe(fiR));
  if (!Number.isFinite(minZ)) {
    for (let gi = 0; gi < nR; gi++) minZ = Math.min(minZ, probe(gi));
  }
  if (Number.isFinite(minZ) && minZ < 0) {
    const dz = -minZ;
    for (let gi = 0; gi < nR; gi++) srcPos[(f * nR + gi) * 3 + 2] += dz;
    return dz;
  }
  return 0;
}

/** Ganze Spur reparieren — liefert die Anzahl angehobener Frames. */
export function groundSrcPosTrack(srcPos, n, srcJoints) {
  const nR = srcJoints.length;
  const fiL = srcJoints.indexOf('leftFoot'), fiR = srcJoints.indexOf('rightFoot');
  let lifted = 0;
  for (let f = 0; f < n; f++) {
    if (groundSrcPosFrame(srcPos, f, nR, fiL, fiR) > 0) lifted++;
  }
  return lifted;
}
'''
    src = src.rstrip() + helpers
    return src

rw(ROOT + '/js/retarget.js', patch_retarget)

# ═══════════════════════════════════════════════════════════
# 2) render3d.js — Overlay: Skeleton reitet EXAKT auf dem Geist
# ═══════════════════════════════════════════════════════════
def patch_render3d(src):
    # a) buildSourceGhost: Ursprung + Relativ-Flag initialisieren
    a_old = '''    this._upVec = new THREE.Vector3(0, 1, 0);
    this._vA = new THREE.Vector3(); this._vB = new THREE.Vector3();
    this._vD = new THREE.Vector3();
  }'''
    a_new = '''    this._upVec = new THREE.Vector3(0, 1, 0);
    this._vA = new THREE.Vector3(); this._vB = new THREE.Vector3();
    this._vD = new THREE.Vector3();
    // v2.28.1 OVERLAY-Basis: Frame-0-Hüfte (srcJoints[0] = 'hips') als
    // Ursprung der RELATIVEN Darstellung + Flag (Standard: absolut, damit
    // der GLB-Original-Mesh-Pfad unverändert bleibt).
    this._srcOrigin = [motion.srcPos[0], motion.srcPos[1]];
    this._srcRelative = false;
  }

  // v2.28.1: Relative Darstellung (Frame-0-Hüfte = Ursprung) an/aus.
  setSourceGhostRelative(on) {
    this._srcRelative = !!on;
  }

  // v2.28.1 ARDY-OVERLAY: das grüne Skeleton reitet EXAKT auf dem
  // Geist-Anker (x, y) — keine Parallelbahn mehr, kein „auseinander“.
  // Die gerenderte (relative) Hüfte landet per Gruppen-Offset exakt auf
  // dem Anker; die Posen spielen wie gehabt. Ruft setSourceGhostRelative(true).
  placeSourceGhostAt(frame, x, y) {
    const motion = this._srcMotion;
    if (!this.sourceGhost || !motion || !motion.srcPos || !this._srcOrigin) return;
    this._srcRelative = true;
    const J = motion.srcJoints.length;
    const hi = this._srcIdx && this._srcIdx.hips !== undefined ? this._srcIdx.hips : 0;
    const o = frame * J * 3 + hi * 3;
    const hx = motion.srcPos[o] - this._srcOrigin[0];
    const hy = motion.srcPos[o + 1] - this._srcOrigin[1];
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) return;
    this.sourceGhost.position.set(x - hx, y - hy, 0);
  }'''
    must_sub(src, a_old, 'render3d buildSourceGhost-Tail')
    src = src.replace(a_old, a_new, 1)

    # b) updateSourceGhost: relative Darstellung berücksichtigen
    b_old = '''    if (this._srcJointMeshes && this._srcJointMeshes.length) {
    const J = motion.srcJoints.length;
    const P = (idx) => {
      const o = frame * J * 3 + idx * 3;
      return [motion.srcPos[o], motion.srcPos[o + 1], motion.srcPos[o + 2]];
    };'''
    b_new = '''    if (this._srcJointMeshes && this._srcJointMeshes.length) {
    const J = motion.srcJoints.length;
    // v2.28.1: im Overlay-/Relativ-Modus wird die Frame-0-Hüfte als
    // Ursprung abgezogen (x/y) — z (Höhe, geerdet) bleibt absolut.
    const REL = this._srcRelative && this._srcOrigin;
    const OX = REL ? this._srcOrigin[0] : 0, OY = REL ? this._srcOrigin[1] : 0;
    const P = (idx) => {
      const o = frame * J * 3 + idx * 3;
      return [motion.srcPos[o] - OX, motion.srcPos[o + 1] - OY, motion.srcPos[o + 2]];
    };'''
    must_sub(src, b_old, 'render3d updateSourceGhost P()')
    src = src.replace(b_old, b_new, 1)

    # c) removeSourceGhost: Flags zurücksetzen
    c_old = '''    this.sourceGhost = null;
    this._srcMotion = null;
    this._srcScene = null;
  }'''
    c_new = '''    this.sourceGhost = null;
    this._srcMotion = null;
    this._srcScene = null;
    this._srcOrigin = null;
    this._srcRelative = false;
  }'''
    must_sub(src, c_old, 'render3d removeSourceGhost')
    src = src.replace(c_old, c_new, 1)
    return src

rw(ROOT + '/js/render3d.js', patch_render3d)

print('Teil 1 fertig (retarget.js + render3d.js).')
