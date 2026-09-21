// ═══════════════════════════════════════════════════════════
// retarget.js — GLB-Skelett → Unitree-G1-Gelenke.
// Methode (WELT-ORIENTIERUNGS-MATCHING — der Geist nimmt die ABSOLUTE
// Lehrer-Pose an, nicht nur die Bewegungs-Deltas):
//   1. Basis-Orientierung = Brust-Weltrotation des Lehrers (ALIGN-konjugiert,
//      Yaw-Anteil entfernt — die Blickrichtung besitzt der Root-Motion-Yaw).
//      So überträgt sich auch eine in der RUHEPOSE steckende Pose (z. B.
//      Zombie-Beuge): der G1-Geist neigt die Basis, die Hüften kompensieren.
//   2. Je Gelenk: Ziel-Lokalrotation aus den QUELL-Weltrotationen von
//      Eltern-Knochen und Kind-Knochen:  L = A·(W_eltern⁻¹ ⊗ W_kind)·A⁻¹
//      (Eltern für Beine/Arme = Brust, da die G1-Basis die Brust trägt).
//   3. 3-Achsen-Gelenke (Hüfte/Schulter) per numerischem Koordinaten-
//      Abstieg gegen die Zielrotation; 1-Achser (Knie/Knöchel/Ellbogen/
//      Taille) per Achsen-Projektion; 2-Achser (Knöchel) wie 3-Achser.
//   4. Basis-Höhe aus Hüft-Translation (cm/m-Erkennung), dann
//      Boden-Anpassung: tiefsten Fußpunkt über Geister-Vorwärtslauf
//      anheben (offline, einmalig beim Import) — MIT Basis-Nick.
// Ergebnis: Referenz-Timeline q_ref (nu je Frame) + h_ref + baseQ (n×4).
// ═══════════════════════════════════════════════════════════

import { GlbClip, quatMul, quatRot as rotVec, quatRotInv } from './glb.js';

// Versionszähler des Retargeting-ALGORITHMUS. Jede Änderung, die andere
// Gelenk-Timelines erzeugt, MUSS diesen Wert erhöhen: main.js vergleicht ihn
// mit dem in IndexedDB gespeicherten motion.alg und re-retargetet bestehende
// Clips beim Aktivieren automatisch (sonst sähe der Nutzer für immer das
// Ergebnis der import-Zeit — „es ist wie davor", obwohl der Fix im Code war).
// 1 = vor v2.6.0 (X-Beine), 2 = v2.6.0 (Winkelbisektor), 3 = v2.6.1
// (voller Valgus → natürlicher G1-A-Stand bei geradem Bein).
export const RT_ALG = 3;

// Universeller Knochen-Resolver:
//   1) Alias-Tabelle (normalisiert, ohne Sonderzeichen) — Mixamo mit/ohne
//      Präfix, Cartwheel (forge fbx_to_glb), Unity, Unreal, VRM.
//   2) Heuristik-Pass über alle Knotennamen mit Seitenerkennung
//      (left/right bzw. l/r-Suffix) und Rollen-Priorität — erkennt auch
//      exotische Namen wie 'UpperLeg_L.001' oder 'thigh proxy L'.
// Verglichen wird IMMER über normName (nur [a-z0-9]).
const BONE_ALIASES = {
  hips: ['mixamorig:hips', 'hips', 'hip', 'pelvis', 'j_bip_c_hips', 'root', 'bip01_pelvis'],
  spine: ['mixamorig:spine', 'spine', 'j_bip_c_spine', 'chest_lower'],
  leftUpLeg: ['mixamorig:leftupleg', 'leftupleg', 'upper_leg_l', 'upperleg_l', 'thigh_l', 'leftthigh', 'left_upleg', 'j_bip_l_hip', 'bip01_l_thigh', 'upperleg_l1'],
  leftLeg: ['mixamorig:leftleg', 'leftleg', 'lower_leg_l', 'lowerleg_l', 'shin_l', 'leftshin', 'calf_l', 'left_calf', 'j_bip_l_knee', 'bip01_l_calf'],
  leftFoot: ['mixamorig:leftfoot', 'leftfoot', 'foot_l', 'leftankle', 'left_ankle', 'ankle_l', 'j_bip_l_ankle', 'bip01_l_foot'],
  rightUpLeg: ['mixamorig:rightupleg', 'rightupleg', 'upper_leg_r', 'upperleg_r', 'thigh_r', 'rightthigh', 'right_upleg', 'j_bip_r_hip', 'bip01_r_thigh'],
  rightLeg: ['mixamorig:rightleg', 'rightleg', 'lower_leg_r', 'lowerleg_r', 'shin_r', 'rightshin', 'calf_r', 'right_calf', 'j_bip_r_knee', 'bip01_r_calf'],
  rightFoot: ['mixamorig:rightfoot', 'rightfoot', 'foot_r', 'rightankle', 'right_ankle', 'ankle_r', 'j_bip_r_ankle', 'bip01_r_foot'],
  leftArm: ['mixamorig:leftarm', 'leftarm', 'upper_arm_l', 'upperarm_l', 'leftshoulder', 'left_shoulder', 'j_bip_l_shoulder', 'bip01_l_upperarm', 'clavicle_l'],
  leftForeArm: ['mixamorig:leftforearm', 'leftforearm', 'lower_arm_l', 'lowerarm_l', 'leftelbow', 'left_elbow', 'j_bip_l_elbow', 'bip01_l_forearm'],
  rightArm: ['mixamorig:rightarm', 'rightarm', 'upper_arm_r', 'upperarm_r', 'rightshoulder', 'right_shoulder', 'j_bip_r_shoulder', 'bip01_r_upperarm', 'clavicle_r'],
  rightForeArm: ['mixamorig:rightforearm', 'rightforearm', 'lower_arm_r', 'lowerarm_r', 'rightelbow', 'right_elbow', 'j_bip_r_elbow', 'bip01_r_forearm'],
  head: ['mixamorig:head', 'head', 'neck', 'neck_01', 'j_bip_c_head', 'bip01_head'],
};
const ROLE_ORDER = ['hips', 'spine', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm', 'head'];
// Rollen für den Lehrer-Ghost (Original-Figur) — Reihenfolge = srcPos-Layout
// v2.28.7: LEGACY — nur noch Fallback für ALTE gespeicherte Clips (13 Rollen);
// neue Generierungen benutzen SRC_ROLES (vollständige cskel27-Anatomie).
export const GHOST_ROLES = ['hips', 'spine', 'head', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];

// ═══ v2.28.7 — LEHRER-SKELETT IN VOLLER cskel27-ANATOMIE ═══
// Der Nutzer-Report (mit Referenz-Screenshot aus der ARDY-Browser-Demo):
// „das Skelett ist falsch" — die App zeichnete nur einen 13-Gelenk-Stumpf
// (keine Hände, keine HandEnd/Thumb1, keine Zehen, keine Schultern, keine
// Nacken-/Brustwirbel; Arme hingen direkt an „spine"). Das ARDY-Modell
// (manifest.skeleton, num_joints 27) liefert ALLE Gelenke als posedJoints —
// sie wurden nur nie in srcPos übernommen. SRC_EDGES = exakte Eltern-Kind-
// Hierarchie aus model.json (skeleton.parents); SRC_ROLES = feste Rolle für
// jedes Gelenk (Reihenfolge = manifest.joint_names).
export const SRC_EDGES = [
  ['hips', 'spine'], ['spine', 'spine1'], ['spine1', 'spine2'], ['spine2', 'spine3'],
  ['spine3', 'neck'], ['neck', 'head'],
  ['spine3', 'rightShoulder'], ['rightShoulder', 'rightArm'], ['rightArm', 'rightForeArm'],
  ['rightForeArm', 'rightHand'], ['rightHand', 'rightHandEnd'], ['rightHand', 'rightHandThumb1'],
  ['spine3', 'leftShoulder'], ['leftShoulder', 'leftArm'], ['leftArm', 'leftForeArm'],
  ['leftForeArm', 'leftHand'], ['leftHand', 'leftHandEnd'], ['leftHand', 'leftHandThumb1'],
  ['hips', 'rightUpLeg'], ['rightUpLeg', 'rightLeg'], ['rightLeg', 'rightFoot'], ['rightFoot', 'rightToeBase'],
  ['hips', 'leftUpLeg'], ['leftUpLeg', 'leftLeg'], ['leftLeg', 'leftFoot'], ['leftFoot', 'leftToeBase'],
];
export const SRC_ROLES = ['hips', 'spine', 'spine1', 'spine2', 'spine3', 'neck', 'head',
  'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand', 'rightHandEnd', 'rightHandThumb1',
  'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand', 'leftHandEnd', 'leftHandThumb1',
  'rightUpLeg', 'rightLeg', 'rightFoot', 'rightToeBase',
  'leftUpLeg', 'leftLeg', 'leftFoot', 'leftToeBase'];
// Aliase NUR für die 14 Rollen, die nicht schon in BONE_ALIASES/ROLE_ORDER
// stecken (Reihenfolge wie dort: Mixamo-Präfix zuerst für GLBs, dann plain
// für cskel27/ARDY; normName stript alle Nicht-[a-z0-9]).
const SRC_ROLE_ALIASES = {
  spine1: ['mixamorig:spine1', 'spine1', 'spine_1', 'spine01', 'j_bip_c_spine1'],
  spine2: ['mixamorig:spine2', 'spine2', 'spine_2', 'spine02', 'j_bip_c_spine2'],
  spine3: ['mixamorig:spine3', 'spine3', 'spine_3', 'spine03', 'j_bip_c_spine3'],
  neck: ['mixamorig:neck', 'neck', 'neck_01', 'j_bip_c_neck'],
  rightShoulder: ['mixamorig:rightshoulder', 'rightshoulder', 'j_bip_r_shoulder', 'clavicle_r'],
  leftShoulder: ['mixamorig:leftshoulder', 'leftshoulder', 'j_bip_l_shoulder', 'clavicle_l'],
  rightHand: ['mixamorig:righthand', 'righthand', 'j_bip_r_hand', 'hand_r'],
  leftHand: ['mixamorig:lefthand', 'lefthand', 'j_bip_l_hand', 'hand_l'],
  rightHandEnd: ['mixamorig:righthandend', 'righthandend', 'right_hand_end'],
  leftHandEnd: ['mixamorig:lefthandend', 'lefthandend', 'left_hand_end'],
  rightHandThumb1: ['mixamorig:righthandthumb1', 'righthandthumb1', 'right_hand_thumb1'],
  leftHandThumb1: ['mixamorig:lefthandthumb1', 'lefthandthumb1', 'left_hand_thumb1'],
  rightToeBase: ['mixamorig:righttoebase', 'righttoebase', 'toe_r', 'j_bip_r_toe'],
  leftToeBase: ['mixamorig:lefttoebase', 'lefttoebase', 'toe_l', 'j_bip_l_toe'],
};
/**
 * v2.28.7: Löst die VOLLSTÄNDIGE cskel27-Rollenmenge auf einen Clip auf —
 * ausschließlich für die Lehrer-Skelett-ANZEIGE (srcPos). Die IK-Rollen
 * (bones aus resolveBones) bleiben unangetastet: Sie werden als Kern zuerst
 * eingetragen, die 14 Zusatz-Rollen kommen per Alias dazu; ein Node wird
 * NIE doppelt vergeben (Dedupe über used). Rückgabe: role → nodeIdx.
 */
export function resolveSrcJoints(clip, bones) {
  const map = {};
  const used = new Set();
  for (const r of GHOST_ROLES) {
    if (bones[r] !== undefined) { map[r] = bones[r]; used.add(bones[r]); }
  }
  for (const r of SRC_ROLES) {
    if (map[r] !== undefined) continue;
    const als = SRC_ROLE_ALIASES[r] || [];
    for (const a of als) {
      const idx = clip.bestNodeFor(a);
      if (idx !== undefined && !used.has(idx)) { map[r] = idx; used.add(idx); break; }
    }
  }
  return map;
}
/**
 * v2.28.7: Knochen-Paare für die Skelett-Zeichnung aus SRC_EDGES, gefiltert
 * auf vorhandene Rollen. Fehlt ein Zwischengelenk (altes 13-Rollen-Layout,
 * schlankes GLB-Rig), wandert die Kante zum nächsten VORHANDENEN Ahnen —
 * für das Legacy-Layout entsteht damit EXAKT die alte 12-Paare-Struktur
 * (spine→head, spine→Arm …), für cskel27 der volle 26-Kanten-Baum.
 * idxByRole: role → Index in srcJoints (oder nodeIdx — nur Präsenz zählt).
 */
export function srcBonePairs(idxByRole) {
  const parentOf = {};
  for (const [p, c] of SRC_EDGES) parentOf[c] = p;
  const anchor = (role) => {
    let cur = role;
    for (let g = 0; g < 16; g++) {
      const par = parentOf[cur];
      if (par === undefined) return undefined; // Wurzel erreicht
      if (idxByRole[par] !== undefined) return par;
      cur = par;
    }
    return undefined;
  };
  const pairs = [];
  for (const [p, c] of SRC_EDGES) {
    if (idxByRole[c] === undefined) continue;
    const a = idxByRole[p] !== undefined ? p : anchor(c);
    if (a !== undefined && idxByRole[a] !== undefined) pairs.push([a, c]);
  }
  return pairs;
}
/**
 * v2.28.8 — KNOCHENLÄNGEN-TRANSFER: Das grüne Lehrer-Skelett trug Menschen-
 * Proportionen (cskel27 ≈ 1,7-m-Mensch) — selbst nach dem uniformen Höhen-Fit
 * ragten Knochenspitzen über den kompakteren G1 hinaus (Nutzer: „Er ist nicht
 * an den Skelett, sondern etwas innen. Als wäre es nicht Skelett sondern
 * Exoskelett"). Diese Funktion baut srcPos Frame für Frame entlang der
 * cskel27-Hierarchie NEU auf: die RICHTUNG jedes Knochens kommt aus den
 * Lehrer-Daten (Pose/Winkel bleiben exakt erhalten), die LÄNGE kommt aus
 * `lens` (am Roboter gemessene Gliedmaßen-Längen). Ohne Eintrag in lens
 * bleibt die Lehrer-Länge. Hüfte = Anker bleibt unverändert; die Füße muss
 * der Aufrufer danach neu erden (groundSrcPosFrame) — die Hüfte landet dann
 * automatisch auf der Bein-Reichweite des Roboters.
 * NUR für volle cskel27-Layouts (srcJoints.length === 27) — Legacy-13-Clips
 * behalten den uniformen Fit. Idempotent (Längen bereits = lens → s = 1).
 * lens: childRole → Länge (m). Rückgabe: true wenn etwas geändert wurde.
 */
export function reproportionSrcPos(srcPos, srcJoints, n, lens) {
  if (!srcPos || !srcJoints || !n || !lens) return false;
  const nR = srcJoints.length;
  if (srcPos.length !== 3 * n * nR) return false;
  const idx = {};
  for (let i = 0; i < srcJoints.length; i++) idx[srcJoints[i]] = i;
  const edges = [];
  for (const [p, c] of SRC_EDGES) { // Eltern-vor-Kind (Baumreihenfolge)
    if (c !== 'hips' && idx[c] !== undefined && idx[p] !== undefined) edges.push([p, c]);
  }
  const out = new Float32Array(srcPos.length);
  out.set(srcPos); // NaN-Rahmen & Hüfte als Basis
  let touched = 0;
  for (let f = 0; f < n; f++) {
    const P = (r) => (f * nR + idx[r]) * 3;
    for (const [p, c] of edges) {
      const op = P(p), oc = P(c);
      const ox = srcPos[op], oy = srcPos[op + 1], oz = srcPos[op + 2]; // ORIGINAL-Elter (Lehrer-Richtung)
      const cx = srcPos[oc], cy = srcPos[oc + 1], cz = srcPos[oc + 2]; // ORIGINAL-Kind (Lehrer-Richtung)
      const oOut = P(c);
      if (!Number.isFinite(ox) || !Number.isFinite(cx)) { out[oOut] = out[oOut + 1] = out[oOut + 2] = NaN; continue; }
      const dx = cx - ox, dy = cy - oy, dz = cz - oz;
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-9) { out[oOut] = out[op]; out[oOut + 1] = out[op + 1]; out[oOut + 2] = out[op + 2]; continue; }
      const px = out[op], py = out[op + 1], pz = out[op + 2]; // ÜBERTRAGENER Elter (Kette akkumuliert!)
      if (!Number.isFinite(px)) { out[oOut] = out[oOut + 1] = out[oOut + 2] = NaN; continue; }
      const L = Number.isFinite(lens[c]) && lens[c] > 1e-6 ? lens[c] : l;
      const s = L / l;
      out[oOut] = px + dx * s; out[oOut + 1] = py + dy * s; out[oOut + 2] = pz + dz * s;
      touched++;
    }
  }
  if (!touched) return false;
  srcPos.set(out);
  return true;
}
// Hilfsknochen-Namen, die KEIN echter Gelenk-Kandidat sind (assimp-Zerlegung,
// Endblätter, IK-Hilfen) — in der Heuristik übersprungen.
const BAD_NAME = /leaf|twist|roll|proxy|ik$|_ik|target|aim|effector|\$/;

// Heuristik: Rollen-Muster (Prioritätsreihenfolge! längere Spezifität zuerst)
// Je Eintrag: [Rolle, Regex über den ROH-Namen (lowercase), Seite]
const SIDE_L = /(left|\bl([._\- ]|$|\d)|_l([._\- ]|$)|\.l$| l$)/;
const SIDE_R = /(right|\br([._\- ]|$|\d)|_r([._\- ]|$)|\.r$| r$)/;
const HEURISTICS = [
  ['leftForeArm', /(forearm|lowerarm|elbow|frontarm)/, SIDE_L],
  ['rightForeArm', /(forearm|lowerarm|elbow|frontarm)/, SIDE_R],
  ['leftArm', /(arm|shoulder|upperarm|clavicle|collar)/, SIDE_L],
  ['rightArm', /(arm|shoulder|upperarm|clavicle|collar)/, SIDE_R],
  ['leftFoot', /(foot|ankle)/, SIDE_L],
  ['rightFoot', /(foot|ankle)/, SIDE_R],
  ['leftLeg', /(knee|shin|calf|lowerleg)/, SIDE_L],
  ['rightLeg', /(knee|shin|calf|lowerleg)/, SIDE_R],
  ['leftUpLeg', /(upleg|upperleg|thigh|hip)/, SIDE_L],
  ['rightUpLeg', /(upleg|upperleg|thigh|hip)/, SIDE_R],
  ['spine', /(spine|chest|torso|upperbody)/, null],
  ['head', /(head|neck|kopf)/, null],
  ['hips', /(hips|pelvis|root)/, null],
];

export function resolveBones(clip) {
  const found = {};
  // 1) Alias-Tabelle
  for (const role of ROLE_ORDER) {
    for (const a of BONE_ALIASES[role]) {
      const idx = clip.bestNodeFor(a);
      if (idx !== undefined) { found[role] = idx; break; }
    }
  }
  // 2) Heuristik für noch Fehlende — animierte Knoten bevorzugen
  const used = new Set(Object.values(found));
  for (const [role, re, sideRe] of HEURISTICS) {
    if (found[role] !== undefined) continue;
    let best = undefined, bestScore = -1;
    for (let i = 0; i < clip.nodes.length; i++) {
      const n = clip.nodes[i];
      if (!n.name) continue;
      const low = n.name.toLowerCase();
      if (BAD_NAME.test(low)) continue;
      if (!re.test(low)) continue;
      if (sideRe && !sideRe.test(low)) continue;
      if (used.has(i)) continue;
      // 'forearm' darf nicht 'arm' klauen — HEURISTICS-Reihenfolge regelt das
      const animated = clip.rotationTracks.has(i) ? 1 : 0;
      const score = animated * 2 + (n.name.length < 24 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== undefined) { found[role] = best; used.add(best); }
  }
  return found;
}

// --- Quaternion-Werkzeuge (x,y,z,w) ---
function quatFromAxisAngle(axis, ang, out) {
  const s = Math.sin(ang / 2);
  out[0] = axis[0] * s; out[1] = axis[1] * s; out[2] = axis[2] * s; out[3] = Math.cos(ang / 2);
  return out;
}
function quatConj(q, out) { out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3]; return out; }
function quatMul2(a, b, out) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function quatLogAxis(q, out) {
  // Axis-Angle aus Quaternion
  const w = Math.min(1, Math.max(-1, q[3]));
  const ang = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(1e-12, 1 - w * w));
  out[0] = q[0] / s; out[1] = q[1] / s; out[2] = q[2] / s;
  return ang;
}
function quatFromTwoVecs(a, b, out) {
  // Minimale Rotation, die Richtung a → Richtung b dreht (twist-frei).
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  const cl = Math.hypot(cx, cy, cz);
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const s = Math.sqrt(Math.max(0, 0.5 * (1 + d))); // cos(ang/2)
  if (cl < 1e-9 || s < 1e-6) {
    if (d > 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; }
    // 180°: beliebige senkrechte Achse
    let px = 1, py = 0, pz = 0;
    if (Math.abs(a[0]) > 0.9) { px = 0; py = 1; }
    const ax = a[1] * pz - a[2] * py, ay = a[2] * px - a[0] * pz, az = a[0] * py - a[1] * px;
    const l = Math.hypot(ax, ay, az) || 1;
    out[0] = ax / l; out[1] = ay / l; out[2] = az / l; out[3] = 0;
    return out;
  }
  out[0] = cx / (2 * s); out[1] = cy / (2 * s); out[2] = cz / (2 * s); out[3] = s;
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= n; out[1] /= n; out[2] /= n; out[3] /= n;
  return out;
}
function rotVecByQuat(q, v, out) {
  // v' = q ⊗ v ⊗ q* (Standard-Sandwich, KONJUGIERTER zweiter Faktor —
  // die alte Version multiplizierte mit q selbst → gespiegelte Achsen)
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}

// Welt-Achse eines MuJoCo-Gelenks (im Keyframe, d. h. Ruhepose)
function jointWorldAxis(sim, jid, out) {
  const mod = sim.model;
  const bid = mod.jnt_bodyid[jid];
  // jnt_axis ist im Rahmen des Kind-Körpers lokal
  const ax = [mod.jnt_axis[3 * jid], mod.jnt_axis[3 * jid + 1], mod.jnt_axis[3 * jid + 2]];
  // MuJoCo xquat ist (w,x,y,z) → in [x,y,z,w] drehen für rotVecByQuat!
  const q = [sim._xquat[4 * bid + 1], sim._xquat[4 * bid + 2], sim._xquat[4 * bid + 3], sim._xquat[4 * bid]];
  rotVecByQuat(q, ax, out);
  return out;
}

/**
 * Retargetet einen GLB-Clip auf die G1-Gelenke.
 * @param clip GlbClip
 * @param sim  RobotSim des G1 (Keyframe-Pose aktiv)
 * @param log  Fortschritts-Logger
 * @returns MotionClip { name, fps, n, nu, q: Float32Array(n*nu), h: Float32Array(n), mapped: [Namen] }
 */
export function retargetToG1(clip, sim, log = () => {}) {
  return retargetToRobot(clip, sim, log);
}

/**
 * v2.15.0 — RETARGETING FÜR JEDEN ROBOTER.
 * PROFILE beschreiben, welche Gelenkketten ein Roboter hat und wie seine
 * Aktuator-Namen lauten. G1 = vollständiges humanoides Ziel (Beine + Arme
 * + Taille), MicroDuck = Beine (Hüfte/Knie/Sprunggelenk — Kopf/Hals behalten
 * die STAND-Pose), Skydio X2 = NUR Root-Bahn (die Drohne fliegt den Weg
 * der Animation ab, es gibt keine Gelenke zum Nachfahren).
 * Die IK selbst bleibt roboter-agnostisch: sie löst am ECHTEN MuJoCo-FK
 * des aktiven Modells (Richtungs-Ziele, Nullposen-Kalibrierung), deshalb
 * funktionieren Achsenkonventionen/Valgus automatisch je Roboter.
 */
export const PROFILES = {
  g1: {
    id: 'g1', hasLegs: true, hasArms: true, hasWaist: true,
    suffix: '_joint',
    hip: (s) => s + '_hip_pitch_joint', knee: (s) => s + '_knee_joint', elbow: (s) => s + '_elbow_joint',
    anklePitch: (s) => s + '_ankle_pitch_joint', ankleRoll: (s) => s + '_ankle_roll_joint',
    waist: 'waist_yaw_joint',
    hMin: 0.4, hMax: 1.15,
    presetKeyCtrl: false,
  },
  duck: {
    id: 'duck', hasLegs: true, hasArms: false, hasWaist: false,
    suffix: '',
    hip: (s) => s + '_hip_pitch', knee: (s) => s + '_knee',
    anklePitch: (s) => s + '_ankle', ankleRoll: null,
    waist: null,
    hMin: 0.05, hMax: 0.32,
    presetKeyCtrl: true, // Kopf/Hals behalten die STAND-Pose (nicht 0)
  },
  x2: {
    id: 'x2', hasLegs: false, hasArms: false, hasWaist: false,
    suffix: '',
    hip: (s) => s + '_hip_pitch', knee: (s) => s + '_knee',
    anklePitch: (s) => s + '_ankle', ankleRoll: null,
    waist: null,
    hMin: 0.25, hMax: 1.6, // Flughöhe (Hüftbahn auf Drohnenhöhe skaliert)
    presetKeyCtrl: true,   // q = Hover-Schub (Keyframe), keine Gelenk-IK
  },
};

export function retargetToRobot(clip, sim, log = () => {}) {
  const prof = (sim.cfg && PROFILES[sim.cfg.id]) || PROFILES.g1;
  const SUFF = prof.suffix;
  const bones = resolveBones(clip);
  const need = ['hips', 'leftUpLeg', 'leftLeg', 'rightUpLeg', 'rightLeg'];
  const missing = need.filter(k => bones[k] === undefined);
  if (missing.length) {
    const names = clip.nodes.map(n => n.name).filter(Boolean).slice(0, 12).join(', ');
    throw new Error('Skelett nicht erkannt (' + missing.join(', ') + ' fehlt). Gefundene Knoten: ' + names + ' …');
  }
  const roleNames = ROLE_ORDER.filter(r => bones[r] !== undefined);
  log(`Knochen erkannt: ${roleNames.length}/${ROLE_ORDER.length} (${roleNames.map(r => clip.nodes[bones[r]].name).join(', ')})`);

  // v2.28.7: Lehrer-Skelett in voller cskel27-Anatomie — resolveSrcJoints
  // löst ALLE 27 Gelenke (NUR für die Anzeige; IK-Rollen unangetastet).
  const srcMap = resolveSrcJoints(clip, bones);
  let ghostRoles = SRC_ROLES.filter(r => srcMap[r] !== undefined);
  if (ghostRoles.length < 8) {
    // Absicherung (sollte kaum eintreten): Kern-Rollen erzwingen
    for (const r of GHOST_ROLES) if (bones[r] !== undefined && srcMap[r] === undefined) srcMap[r] = bones[r];
    ghostRoles = SRC_ROLES.filter(r => srcMap[r] !== undefined);
  }
  log(`Lehrer-Skelett: ${ghostRoles.length} Gelenke (${ghostRoles.length >= 20 ? 'volle cskel27-Anatomie' : 'reduziert — Rig liefert nicht alle Gelenke'})`);

  // Namen der gelösten Knochen für sampleWorld (normalisiert kompatibel)
  const wanted = roleNames.map(r => clip.nodes[bones[r]].name);
  for (const r of ghostRoles) {
    const nm = clip.nodes[srcMap[r]].name;
    if (!wanted.includes(nm)) wanted.push(nm);
  }

  const nu = sim.nu;
  const A = sim.actByName;

  // Achsen-Mapping GLB (Y-hoch, +Z-Blick) → MuJoCo (Z-hoch, +X-Blick):
  // X_glb→Y_mjc (lateral), Y_glb→Z_mjc (hoch), Z_glb→X_mjc (vorwärts)
  // = Rotation 120° um die Raumdiagonale (1,1,1): Quaternion [0.5,0.5,0.5,0.5]
  const ALIGN = [0.5, 0.5, 0.5, 0.5];
  const ALIGN_INV = [-0.5, -0.5, -0.5, 0.5];

  // „Brust“ = oberste WIRBELSÄULEN-Node zwischen Hüfte und Armen.
  // v2.5.0-Fix („Rücken schief“): Der direkte Eltern-Knochen des Arms ist
  // bei Mixamo (LeftShoulder) und UE-Manny (clavicle_l) das SEITLICH
  // versetzte Schlüsselbein. Als „Brust“ kippte die Basis-Triade seitlich
  // (up = Hüfte→Schlüsselbein = Dauer-Schräglauf, der mit der Schulter-
  // Animation wackelt). Jetzt laufen wir die Vorfahren aufwärts und nehmen
  // die oberste SPINE-Node (Mixamo: Spine2, UE: spine_03) — zentriert und
  // in voller Oberkörperhöhe.
  const armNode = bones.leftArm !== undefined ? bones.leftArm
    : (bones.rightArm !== undefined ? bones.rightArm : undefined);
  let chestIdx = undefined;
  if (armNode !== undefined) {
    const SPINE_RE = /(spine|chest|torso|upperbody)/;
    const OFF_RE = /(clavicle|shoulder|collar)/;
    let cur = clip.parentOf.get(armNode);
    for (let guard = 0; cur !== undefined && cur !== bones.hips && guard < 24; guard++) {
      const nm = (clip.nodes[cur].name || '').toLowerCase();
      if (SPINE_RE.test(nm) && !OFF_RE.test(nm) && !BAD_NAME.test(nm)) { chestIdx = cur; break; }
      cur = clip.parentOf.get(cur);
    }
  }
  if (chestIdx === undefined) chestIdx = bones.spine;
  if (chestIdx === undefined) chestIdx = bones.hips;

  const fps = Math.min(30, Math.max(15, clip.fpsHint));
  const n = Math.max(2, Math.round(clip.duration * fps));

  // v2.15.0: q-Zeilen optional mit dem Keyframe-Steuerstand vorbesetzen —
  // Roboter mit NICHT-IK-getriebenen Aktuatoren (MicroDuck: Kopf/Hals)
  // behalten so ihre natürliche Pose, statt auf 0 zu fallen.
  const q = new Float32Array(n * nu);
  const h = new Float32Array(n);
  if (prof.presetKeyCtrl && sim.keyCtrl) {
    for (let f = 0; f < n; f++) q.set(sim.keyCtrl, f * nu);
  }

  // Gelenk-Weltachsen im Keyframe sammeln (nach q/n — Reihenfolge egal)
  const axisOf = {};
  for (const name of sim.actName) {
    const aid = A[name];
    const jid = sim.actJoint[aid];
    axisOf[name] = jointWorldAxis(sim, jid, [0, 0, 0]);
  }
  const clampA = (name, v) => {
    const a = A[name];
    let lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
    // v2.15.0: echte Gelenk-Limits respektieren (MicroDuck-Positionsatüe
    // haben ctrlrange ±10 — ohne Limit-Klemme liefe die IK gegen die
    // physischen Anschläge und die Pose wäre Unsinn).
    // HINWEIS: jnt_limited ist im WASM-Binding defekt (BindingError) —
    // Heuristik: nicht-triviales jnt_range (hi > lo) = limitiert.
    const jid = sim.actJoint[a];
    if (sim.model.jnt_range) {
      const jlo = sim.model.jnt_range[2 * jid], jhi = sim.model.jnt_range[2 * jid + 1];
      if (jhi > jlo) { lo = Math.max(lo, jlo); hi = Math.min(hi, jhi); }
    }
    return Math.min(hi, Math.max(lo, v));
  };

  const worldMap = new Map();
  const conjTmp = [0, 0, 0, 1];
  const axisTmp = [0, 0, 0];
  const qTmp = [0, 0, 0, 1];
  const qTmp2 = [0, 0, 0, 1];
  const qId = [0, 0, 0, 1];
  const tA = [0, 0, 0, 1], tB = [0, 0, 0, 1];

  // ── Ruhewelt-Rotationen der Quell-Knochen (Kalibrierungs-Referenz) ──
  // WICHTIG: auch matrix-basierte Nodes (assimp _$AssimpFbx$_ PreRotation!)
  // einbeziehen, sonst ist die Ruhelage falsch.
  const localRestRot = (idx) => {
    const n = clip.nodes[idx];
    if (n.rotation) return n.rotation.slice();
    if (n.matrix) return clip._decompMatrix(idx).q.slice();
    return [0, 0, 0, 1];
  };
  const restQ = new Map();
  const computeRest = (idx) => {
    if (restQ.has(idx)) return restQ.get(idx);
    const local = localRestRot(idx);
    const p = clip.parentOf.get(idx);
    const w = p === undefined ? local : quatMul2(computeRest(p), local, [0, 0, 0, 1]);
    restQ.set(idx, w);
    return w;
  };
  const calRoles = ['hips', 'spine', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];
  for (const r of calRoles) if (bones[r] !== undefined) computeRest(bones[r]);
  computeRest(chestIdx);

  // ── G1-KALIBRIERUNG: Körper-Orientierungen in der NULL-Pose ──
  // Knochen-Frames verschiedener Rigs sind beliebig konventioniert — direkt
  // verglichen werden dürfen nur die jeweiligen RUHELAGEN. CAL[seite][glied]
  // = (alignierte Quell-Ruhe-Weltrotation)⁻¹ ⊗ G1-Körper-Nullpose-Quat.
  // Damit gilt: Quell-Ruhepose ↔ G1-Nullpose EXAKT, Animation relativ dazu.
  const bodyOfAct = (name) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[name]]];
  const ghost0 = sim.makeGhostData();
  sim._mjApi.mj_resetData(sim.model, ghost0);
  sim._mjApi.mj_forward(sim.model, ghost0);
  // MuJoCo xquat ist (w,x,y,z) → in [x,y,z,w] drehen (Projekt-Konvention)
  const zeroQuat = (b) => [ghost0.xquat[4 * b + 1], ghost0.xquat[4 * b + 2], ghost0.xquat[4 * b + 3], ghost0.xquat[4 * b]];
  const makeCal = (srcIdx, robotBody) => {
    const ar = quatMul2(ALIGN, computeRest(srcIdx), [0, 0, 0, 1]);
    const aligned = quatMul2(ar, ALIGN_INV, [0, 0, 0, 1]);
    return quatMul2(quatConj(aligned, [0, 0, 0, 1]), zeroQuat(robotBody), [0, 0, 0, 1]);
  };
  const CAL = {};
  for (const side of ['left', 'right']) {
    CAL[side] = prof.hasLegs ? {
      thigh: makeCal(bones[side + 'UpLeg'], bodyOfAct(prof.hip(side))),
      shin: makeCal(bones[side + 'Leg'], bodyOfAct(prof.knee(side))),
      foot: bones[side + 'Foot'] !== undefined ? makeCal(bones[side + 'Foot'], bodyOfAct(prof.anklePitch(side))) : qId,
      arm: qId, fore: qId,
    } : { thigh: qId, shin: qId, foot: qId, arm: qId, fore: qId };
    if (prof.hasArms && bones[side + 'Arm'] !== undefined) {
      CAL[side].arm = makeCal(bones[side + 'Arm'], sim.model.body_parentid[bodyOfAct(prof.elbow(side))]);
      CAL[side].fore = bones[side + 'ForeArm'] !== undefined ? makeCal(bones[side + 'ForeArm'], bodyOfAct(prof.elbow(side))) : qId;
    }
  }

  // Alignierte Ziel-Weltrotation eines Quell-Knochens (animiert): A·W·A⁻¹
  const alignedOf = (idx, out) => {
    const w = worldMap.get(idx);
    if (!w) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; }
    quatMul2(ALIGN, w, qTmp); quatMul2(qTmp, ALIGN_INV, out);
    return out;
  };

  // ── NEU (v2.3.4): Gelenke per IK am GEIST-FK lösen ────────────────
  // Die alte Algebra (Triaden-/CAL-Konjugation + Achsen-Projektion) konjugierte
  // die Lehrer-Ziele mit der RUHEPOSE-Differenz (T-Pose ↔ G1-Nullpose) — der
  // Ruheoffset floss DOPPELT ein: Arme bekamen den „eingebauten“ Knick (+50…75°
  // Richtungsmessung), Beine blieben streckbar gerade, obwohl der Lehrer die
  // Oberschenkel anhebt. Jetzt: Ziele sind KNOCHENRICHTUNGEN des Lehrers
  // (konventionsfrei aus Weltpositionen, ALIGN-Rahmen) bzw. Fuß-Quats; die
  // Gelenkwinkel löst ein Jacobian-Transposed-IK direkt am ECHTEN MuJoCo-FK.
  // Damit sind Nullpose-/Achsenkonventionen des G1 per Konstruktion korrekt.
  //
  // Zero-Pose-Referenzen (qpos0-FK): Körperrichtungen + Körper-Quats
  const pos0Of = (b) => [ghost0.xpos[3 * b], ghost0.xpos[3 * b + 1], ghost0.xpos[3 * b + 2]];
  const childBodyOf = (b) => {
    for (let x = 1; x < sim.nbody; x++) if (sim.model.body_parentid[x] === b) return x;
    return -1;
  };
  const dirBetween0 = (b1, b2) => {
    const p = pos0Of(b1), c = pos0Of(b2);
    const d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const bidOfAct = (name) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[name]]];
  const G1B = {}; // Geist-Körper je Seite
  const G1D0 = {}; // Nullposen-Richtungen je Seite
  const G1X0 = {}; // Nullposen-Körperquats je Seite [x,y,z,w]
  const VALGUS = {}; // Frontalwinkel OS→SB der Nullpose (rad, signed) je Seite
  for (const side of ['left', 'right']) {
    if (!prof.hasLegs) { G1D0[side] = { thigh: null, shin: null, arm: null, fore: null }; G1B[side] = { hip: -1, knee: -1, ankle: -1, elbow: -1, upperArm: -1, wrist: -1 }; continue; }
    const elbow = prof.hasArms ? bidOfAct(prof.elbow(side)) : -1;
    const ankle = bidOfAct(prof.anklePitch(side));
    const hip = bidOfAct(prof.hip(side));
    const knee = bidOfAct(prof.knee(side));
    const upperArm = prof.hasArms ? sim.model.body_parentid[elbow] : -1;
    G1B[side] = { hip, knee, ankle, elbow, upperArm, wrist: prof.hasArms ? childBodyOf(elbow) : -1 };
    G1D0[side] = {
      thigh: dirBetween0(hip, knee),
      shin: dirBetween0(knee, ankle),
      arm: prof.hasArms ? dirBetween0(upperArm, elbow) : null,
      fore: (prof.hasArms && G1B[side].wrist > 0) ? dirBetween0(elbow, G1B[side].wrist) : null,
    };
    G1X0[side] = { thigh: zeroQuat(hip), arm: prof.hasArms ? zeroQuat(upperArm) : null, foot: zeroQuat(ankle) };
    // Eingebauter VALGUS (Frontalwinkel OS→SB in der G1-Nullpose, um die
    // Vorwärtsachse): das Modell-Bein ist nicht gerade — der OS steht ±9°
    // außen, die SB ~vertikal. Ein STRAIGHTER Lehrer-Bein ist am G1 daher
    // NICHT exakt darstellbar (roll stellt nur den OS, nie beide); mkGoals
    // rotiert das Hüftziel bei geradem Bein um −valgus/2 → symmetrischer
    // A-Stand (je ~4,5° außen/innen) statt X-Bein (0°/10° innen).
    const latAng = (v) => Math.atan2(v[1], -v[2]);
    VALGUS[side] = prof.hasLegs ? (latAng(G1D0[side].shin) - latAng(G1D0[side].thigh)) : 0;
  }

  // Distale Partner für Lehrer-Richtungen: Hand (Unterarm) bzw. Fuß-Ende
  const localT = (idx) => {
    const nd = clip.nodes[idx];
    if (nd.translation) return nd.translation;
    if (nd.matrix) return clip._decompMatrix(idx).t;
    return [0, 0, 0];
  };
  const distalOf = (idx) => {
    let best, bestLen = -1;
    for (const [c, p] of clip.parentOf.entries()) {
      if (p !== idx) continue;
      const t = localT(c);
      const l = Math.hypot(t[0], t[1], t[2]);
      if (l > bestLen) { bestLen = l; best = c; }
    }
    return best;
  };
  const limbEnd = {}; // je Seite: { fore, shin }
  for (const side of ['left', 'right']) {
    limbEnd[side] = {
      fore: bones[side + 'ForeArm'] !== undefined ? distalOf(bones[side + 'ForeArm']) : undefined,
      shin: bones[side + 'Foot'] !== undefined ? bones[side + 'Foot'] : (bones[side + 'Leg'] !== undefined ? distalOf(bones[side + 'Leg']) : undefined),
    };
  }
  // distale Richtungs-Partner mit sampeln
  for (const side of ['left', 'right']) {
    for (const k of ['fore', 'shin']) {
      const e = limbEnd[side][k];
      if (e !== undefined && !wanted.includes(clip.nodes[e].name)) wanted.push(clip.nodes[e].name);
    }
  }
  // IK-Ziele je Frame: Lehrer-KNOCHENRICHTUNGEN (MJC-Rahmen, Einheitsvektoren)
  // Slots: 0 OS-L, 1 SB-L, 2 OA-L, 3 UA-L, 4 OS-R, 5 SB-R, 6 OA-R, 7 UA-R
  const dSrc = new Float32Array(n * 8 * 3).fill(NaN);
  // alignierte Lehrer-Fuß-Weltquats (L/R) für die Knöchel-Orientierung
  const footW = new Float32Array(n * 2 * 4).fill(NaN);

  const triadQ = [0, 0, 0, 1]; // wird je Frame aus KnochenPOSITIONEN gebaut
  // Einachser (nur noch Taille): Projektion des Ziel-Achsenwinkels auf die Gelenkachse
  const project1 = (jointName, dq) => {
    const ang = quatLogAxis(dq, axisTmp);
    const a = axisOf[jointName];
    return clampA(jointName, ang * (axisTmp[0] * a[0] + axisTmp[1] * a[1] + axisTmp[2] * a[2]));
  };

  let hipsRestH = 0;
  // Hüft-WELTHöhe bei Frame 0 (volle FK — erfasst auch assimp-Zwischenknoten;
  // dort sitzt die echte Höhe am animierten Sub-Knoten, die lokale
  // Ruhetranslation des Knochens ist oft 0)
  const hipsP0 = (() => {
    const q0 = new Map(), p0 = new Map();
    clip.sampleWorldFull(0, wanted, q0, p0);
    return p0.get(bones.hips) || [0, 0, 90];
  })();
  hipsRestH = Math.max(0.1, hipsP0[1]);
  const scale = hipsRestH > 3 ? 0.01 : 1.0; // Mixamo cm → m
  // Referenz-Höhe = KEYFRAME-Höhe des Roboters (nicht die Nullpose!):
  // die Drohne steht in qpos0 am Boden (z≈0,05) — ihr Hover-Flugniveau
  // (Keyframe) ist die richtige Skalierungsbasis für die Flugbahn.
  const g1StandH = (() => {
    try {
      const kd = sim.makeGhostData();
      sim._mjApi.mj_resetDataKeyframe(sim.model, kd, sim.cfg.keyIndex || 0);
      sim._mjApi.mj_forward(sim.model, kd);
      return kd.xpos[3 * sim.baseBody + 2];
    } catch (e) {
      return sim._xpos[3 * sim.baseBody + 2];
    }
  })();
  const hScale = g1StandH / Math.max(0.2, hipsRestH * scale);

  const rawH = new Float32Array(n);
  // Triaden-Yaw je Frame (dieselbe Größe, die baseQ herausdreht — die
  // IK-Ziele werden damit KONJUGIERT, sodass Lehrer-Ziele und Geist-Basis
  // garantiert im selben ent-yawten Rahmen liegen)
  const triadYaw = new Float32Array(n);
  // Basis-Orientierung je Frame (Brust-Weltrotation, ALIGN-konjugiert,
  // Yaw-Anteil entfernt — die Blickrichtung besitzt der Root-Motion-Yaw).
  // Trägt die ABSOLUTE Oberkörper-Pose (auch Ruhepose-Beugung wie beim
  // Zombie) — die Hüften kompensieren, damit die Füße unten bleiben.
  const baseQ = new Float32Array(n * 4);
  // Root-Motion: Bahn des Hüftpunkts (MuJoCo-Rahmen, relativ zu Frame 0)
  // + Blickrichtung (Yaw) — der Referenz-Geist läuft damit WIRKLICH durchs Feld.
  const root = new Float32Array(n * 2);
  const yaw = new Float32Array(n);
  const rawYaw = new Float32Array(n);
  // Lehrer-Ghost: Weltpositionen aller Rollenknochen je Frame (MuJoCo-Rahmen, m)
  const srcPos = new Float32Array(n * ghostRoles.length * 3);
  const srcJoints = ghostRoles.slice();
  const fiLFoot = ghostRoles.indexOf('leftFoot'), fiRFoot = ghostRoles.indexOf('rightFoot'); // v2.28.1
  const fiLToe = ghostRoles.indexOf('leftToeBase'), fiRToe = ghostRoles.indexOf('rightToeBase'); // v2.28.7
  const worldPos = new Map();
  const FWD_GLB = [0, 0, 1]; // GLB: +Z ist Blickrichtung (Annahme wie Achsen-Mapping)
  const fwdTmp = [0, 0, 0];
  const alignedQ = [0, 0, 0, 1];
  let sx0 = 0, sy0 = 0;
  for (let f = 0; f < n; f++) {
    const t = f / fps;
    clip.sampleWorldFull(t, wanted, worldMap, worldPos);
    const off = f * nu;
    // ── Basis-Triade aus KnochenPOSITIONEN (konventionsfrei) ──
    // up  = Richtung Hüfte→Brust — die VISUELLE Torso-Achse (erfasst die
    //       komplette Beugung, auch eine in der Ruhepose steckende)
    // fwd = Blick der Hüfte (GLB +Z rotiert mit W_hips), orthogonal auf up
    {
      const hp3 = worldPos.get(bones.hips), cp3 = worldPos.get(chestIdx) || hp3;
      let ux = 0, uy = 0, uz = 1; // MJC hoch (Fallback aufrecht)
      if (hp3 && cp3) {
        const g = rotVec(ALIGN, [cp3[0] - hp3[0], cp3[1] - hp3[1], cp3[2] - hp3[2]], [0, 0, 0]);
        const len = Math.hypot(g[0], g[1], g[2]);
        if (len > 1e-9) { ux = g[0] / len; uy = g[1] / len; uz = g[2] / len; }
      }
      const wHipsQ = worldMap.get(bones.hips) || qId;
      const fG = rotVec(ALIGN, rotVec(wHipsQ, FWD_GLB, [0, 0, 0]), [0, 0, 0]);
      const dd = fG[0] * ux + fG[1] * uy + fG[2] * uz;
      let fx = fG[0] - dd * ux, fy = fG[1] - dd * uy, fz = fG[2] - dd * uz;
      let fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-6) { fx = 1 - ux * ux; fy = -ux * uy; fz = -ux * uz; fl = Math.hypot(fx, fy, fz) || 1; }
      fx /= fl; fy /= fl; fz /= fl;
      const lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx; // Y = Z×X
      mat3ToQuat(fx, fy, fz, lx, ly, lz, ux, uy, uz, triadQ);
    }
    // Taille: Verdrehung Becken↔Brust (Yaw-Anteil) — die BEUGUNG selbst
    // trägt die Basis-Orientierung, nicht die Taille (G1 hat nur waist_yaw)
    // v2.15.0: nur wenn der Roboter ein Taille ngelenk hat (MicroDuck/X2: nein)
    if (prof.hasWaist && prof.waist && A[prof.waist] !== undefined) {
      quatConj(worldMap.get(bones.hips) || qId, conjTmp);
      quatMul2(conjTmp, worldMap.get(chestIdx) || qId, alignedQ);
      quatMul2(ALIGN, alignedQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
      q[off + A[prof.waist]] = project1(prof.waist, alignedQ);
    }
    // ── IK-Ziele sammeln: Lehrer-Richtungen (Positions-Differenzen sind
    // konventionsfrei!) + Fuß-Quats; die Gelenke selbst löst Pass 2 ──
    const storeDir = (aIdx, bIdx, slot) => {
      const a = worldPos.get(aIdx), b = worldPos.get(bIdx);
      if (!a || !b) return;
      const g = rotVec(ALIGN, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 0]);
      const l = Math.hypot(g[0], g[1], g[2]);
      if (l < 1e-9) return;
      const o = (f * 8 + slot) * 3;
      dSrc[o] = g[0] / l; dSrc[o + 1] = g[1] / l; dSrc[o + 2] = g[2] / l;
    };
    for (const side of ['left', 'right']) {
      const li = side === 'left' ? 0 : 4;
      // Oberschenkel = upLeg→KNIE (NICHT →Fuß! Mit gebeugtem Knie zeigt die
      // Ganze-Bein-Richtung nach hinten, obwohl der Oberschenkel nach vorn
      // zeigt — der 27-42°-„Restfehler" war genau dieser Messfehler)
      storeDir(bones[side + 'UpLeg'], bones[side + 'Leg'], li);
      storeDir(bones[side + 'Leg'], limbEnd[side].shin, li + 1);
      if (bones[side + 'Arm'] !== undefined && bones[side + 'ForeArm'] !== undefined) {
        storeDir(bones[side + 'Arm'], bones[side + 'ForeArm'], li + 2);
        if (limbEnd[side].fore !== undefined) storeDir(bones[side + 'ForeArm'], limbEnd[side].fore, li + 3);
      }
      if (bones[side + 'Foot'] !== undefined) {
        alignedOf(bones[side + 'Foot'], tA);
        const o4 = (f * 2 + (side === 'left' ? 0 : 1)) * 4;
        footW[o4] = tA[0]; footW[o4 + 1] = tA[1]; footW[o4 + 2] = tA[2]; footW[o4 + 3] = tA[3];
      }
    }
    // Basis-Orientierung für die ANZEIGE: Triade mit herausgedrehtem Yaw
    // (base = yawQ⁻¹ ⊗ q) — es bleibt Nick+Roll, die Blickrichtung kommt
    // aus dem Root-Motion-Yaw (kein Doppel-Yaw beim Loop-Rebase).
    {
      const qx = triadQ[0], qy = triadQ[1], qz = triadQ[2], qw = triadQ[3];
      const yawC = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
      triadYaw[f] = yawC;
      const cy2 = Math.cos(-yawC / 2), sy2 = Math.sin(-yawC / 2);
      baseQ[4 * f]     = cy2 * qx + sy2 * qy;
      baseQ[4 * f + 1] = cy2 * qy - sy2 * qx;
      baseQ[4 * f + 2] = cy2 * qz - sy2 * qw;
      baseQ[4 * f + 3] = cy2 * qw + sy2 * qz;
    }
    // Basis-Höhe, Root-Bahn + Yaw aus der Hüft-WELTposition (volle FK)
    const hp = worldPos.get(bones.hips) || hipsP0;
    rawH[f] = Math.min(prof.hMax, Math.max(prof.hMin, hp[1] * scale * hScale));
    const wx = hp[2] * scale, wy = hp[0] * scale; // GLB(Z,X) → MuJoCo(X,Y)
    if (f === 0) { sx0 = wx; sy0 = wy; }
    root[2 * f] = wx - sx0;
    root[2 * f + 1] = wy - sy0;
    // BUGFIX v2.4.1: der Blick-Vektor muss WIRKLICH in den MuJoCo-Rahmen
    // rotiert werden (ALIGN-Sandwich) — die alte Zeile ließ ihn im GLB-Frame
    // und atan2(sway_x, 0) sprang bei jedem Hüft-Sway-Nulldurchgang zwischen
    // +90° und −90° → der Geist drehte sich komplette 180°-Runden!
    rotVec(ALIGN, rotVec(worldMap.get(bones.hips) || qId, FWD_GLB, fwdTmp), fwdTmp);
    rawYaw[f] = Math.atan2(fwdTmp[0], fwdTmp[1]); // MuJoCo: atan2(x, y) — Blick der Hüfte
    if (typeof process !== 'undefined' && process.env.RETARGET_SERIES && (f === 20 || f === 21)) {
      const wq = worldMap.get(bones.hips);
      console.log(`[RT f=${f}] hips=[${wq ? wq.map(v => v.toFixed(4)).join(',') : 'FEHLT'}] fwd=[${fwdTmp.map(v => v.toFixed(4)).join(',')}] rawYaw=${(rawYaw[f] * 180 / Math.PI).toFixed(2)}° scale=${scale} hipsIdx=${bones.hips}`);
    }
    // Lehrer-Ghost-Positionen (GLB Y-up → MuJoCo Z-up, skaliert auf m)
    // v2.28.7: volle cskel27-Rollen via srcMap (IK-Rollen bleiben in bones)
    for (let gi = 0; gi < ghostRoles.length; gi++) {
      const p = worldPos.get(srcMap[ghostRoles[gi]]);
      const o3 = (f * ghostRoles.length + gi) * 3;
      if (!p) { srcPos[o3] = srcPos[o3 + 1] = srcPos[o3 + 2] = NaN; continue; }
      srcPos[o3] = p[2] * scale; srcPos[o3 + 1] = p[0] * scale; srcPos[o3 + 2] = p[1] * scale;
    }
    // v2.28.0 BODEN-GARANTIE für den Lehrer-Skeleton: ARDY-Höhendrift (oder
    // sloppy GLB-Assets) darf die Figur NICHT unter den Boden hängen. Je
    // Frame: tiefsten Fußpunkt messen (Fallback: alle Rollen) und den
    // Skeleton ANHEBEN, bis der Fuß bei 0 steht. Sprünge bleiben unangetastet
    // (beide Füße über 0 → kein Lift), Gehen bleibt unverändert (ein Fuß
    // ist immer nahe 0 — der Lift ist dort ~0).
    // v2.28.1: Logik im exportierten groundSrcPosFrame — dieselbe Garantie
    // repariert auch GESPEICHERTE alte Clips beim Aktivieren (Migration).
    groundSrcPosFrame(srcPos, f, ghostRoles.length, fiLFoot, fiRFoot, [fiLToe, fiRToe]);
  }

  // Lücken-Füllung (v2.5.0): Fehlt ein Zielrichtungs- oder Fußquat-Sample
  // (Track-Lücke/NaN im Export), hält der Slot den LETZTEN gültigen Wert —
  // sonst lief die IK dieses Frame ohne Ziel (Warm-Start friert) und sprang
  // beim Wiederkommen der sampled Lücke zurück = sichtbarer Ruck (z. B.
  // linker Arm beim Zombie-Idle). Führende Lücken ← erster gültiger Wert.
  {
    const fillGaps = (arr, perFrame) => {
      for (let s = 0; s < perFrame; s++) {
        let last = NaN;
        for (let f = 0; f < n; f++) {
          const i = f * perFrame + s;
          if (Number.isFinite(arr[i])) last = arr[i];
          else if (!Number.isNaN(last)) arr[i] = last;
        }
        let first = NaN;
        for (let f = 0; f < n && Number.isNaN(first); f++) first = arr[f * perFrame + s];
        if (Number.isFinite(first)) {
          for (let f = 0; f < n && Number.isNaN(arr[f * perFrame + s]); f++) arr[f * perFrame + s] = first;
        }
      }
    };
    fillGaps(dSrc, 24); // 8 Slots × 3 Komponenten je Frame
    fillGaps(footW, 8); // 2 Füße × 4 Komponenten je Frame
  }

  // Yaw: Bei Locomotion (Bahn bewegt sich) ist die BEWEGUNGSRICHTUNG der
  // stabile Blick — die Hüft-Vorwärtsachse kippt beim Laufen stark mit
  // (Beckenrotation/Neigung). Bei Stillstand (Idle) liefert die Hüft-
  // Rotation die Blickrichtung. Danach unwrap + glätten + relativ zu Frame 0.
  // HYSTERESE (v2.4.1): die Quellen werden erst WECHSELND benutzt, wenn die
  // Geschwindigkeit eine Schwelle klar über-/unterschreitet — sonst flattert
  // die Blickrichtung an der Grenze; während Pausen wird die letzte
  // Bewegungsrichtung GEHALTEN (Gehpause ≠ Drehung).
  {
    const SPEED_MIN = 0.15; // m/s — darüber gilt „Bewegung"
    const dirYaw = new Float32Array(n);
    let lastY = null;
    let moving = false;
    for (let f = 0; f < n; f++) {
      const p0 = Math.max(0, f - 1), p1 = Math.min(n - 1, f + 1);
      const dx = root[2 * p1] - root[2 * p0], dy = root[2 * p1 + 1] - root[2 * p0 + 1];
      const dt = Math.max(1e-6, (p1 - p0) / fps);
      const sp = Math.hypot(dx, dy) / dt;
      if (!moving && sp > SPEED_MIN) moving = true;
      else if (moving && sp < SPEED_MIN * 0.55) moving = false;
      if (moving) { lastY = Math.atan2(dy, dx); dirYaw[f] = lastY; }
      else dirYaw[f] = lastY !== null ? lastY : rawYaw[f];
    }
    for (let f = 1; f < n; f++) {
      let d = dirYaw[f] - dirYaw[f - 1];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      dirYaw[f] = dirYaw[f - 1] + d;
    }
    smooth(dirYaw, 5);
    const y0 = dirYaw[0];
    for (let f = 0; f < n; f++) {
      let d = dirYaw[f] - y0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      yaw[f] = d;
    }
    // Sicherheitsnetz: einzelne Rest-Sprünge (> 1,2 rad/Frame — echtes
    // Drehen schafft max. ~3 rad/s) linear überbrücken
    bridgeAngles(yaw, n, 1.2);
  }

  // ── PASS 2: Gelenk-IK am Geist-FK (Hüfte/Knie/Knöchel/Schulter/Ellbogen) ──
  // v2.15.0: nur wenn das Ziel-Profil Gelenkketten hat (X2 = nur Root-Bahn).
  // Ziele pro Kette: Oberschenkel/Oberarm = ORIENTIERUNG
  //   y0⁻¹ ⊗ minMap(Nullpose-Richtung → Lehrer-Richtung) ⊗ Nullpose-Quat,
  // Unterschenkel/Unterarm = RICHTUNG, Knöchel = Fuß-Orientierung (y0⁻¹⊗W'⊗CAL).
  // y0 = Frame-0-Blick der Triade (gleiche Konstante wie in baseQ) — so passen
  // absolute Lehrer-Ziele und Geist-Basis zusammen; der Pfad-Yaw kommt im
  // Display via setGhostPose hinzu, hier wird konsistent mit Yaw 0 gerechnet.
  // GELÖST wird per KOORDINATEN-ABSTIEG mit FK-Messung (das J-T-Verfahren
  // lief bei ~100°-Startfehlern in Verdreh-Täler: Hüften liefen ins Yaw/Roll-
  // Limit). Abstieg ist monoton und warm-startet aus dem Vorgängerframe.
  {
    // Je-Frame-Konjugation: exakt derselbe Yaw, den baseQ herausdreht —
    // so liegen Lehrer-Limb-Ziele und Geist-Basis garantiert im selben Rahmen.
    const ghost = sim.makeGhostData();
    const gqOf = (b, out) => { // Körper-Weltquat (w,x,y,z) → [x,y,z,w]
      out[0] = ghost.xquat[4 * b + 1]; out[1] = ghost.xquat[4 * b + 2];
      out[2] = ghost.xquat[4 * b + 3]; out[3] = ghost.xquat[4 * b];
      return out;
    };
    const gposOf = (b, out) => {
      out[0] = ghost.xpos[3 * b]; out[1] = ghost.xpos[3 * b + 1]; out[2] = ghost.xpos[3 * b + 2];
      return out;
    };
    const dirFromTo = (a, b, out) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-9) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
      out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
      return out;
    };
    const angBetween = (u, v) => {
      const d = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
      return Math.acos(d);
    };
    // Orientierungs-Fehlerwinkel Ziel-Quat vs. Körper-Quat (rad)
    const oriErrOf = (goal, dispBody) => {
      gqOf(dispBody, qTmp);
      quatConj(qTmp, conjTmp);
      quatMul2(goal, conjTmp, qTmp2);
      return Math.abs(quatLogAxis(qTmp2, axisTmp)) * Math.hypot(axisTmp[0], axisTmp[1], axisTmp[2]);
    };

    // Ziele pro Frame + Seite vorbereiten (unabhängig von den Gelenken).
    // Oberschenkel/Oberarm = reine RICHTUNGEN (die Twist um die Knochenachse
    // ist visuell irrelevant und erzeugte sonst Hüft-/Schulter-Verdrehungen
    // bis ins Gelenklimit — der Twist bleibt naturbelassen beim Warm-Start).
    // v2.6.0 — GERADES-BEIN-FIX („Bein etwas falsch / X-Beine"): Das G1
    // steht in der Nullpose im A-Stand (Oberschenkel ±9° nach außen). Richtete
    // die IK den OS exakt auf den Lehrer aus (roll ∓0,16), kippte die SCHIEN
    // ~10° nach INNEN — das Knie (Scharnier um die Querachse) kann laterale
    // Fehler nicht korrigieren →Knöchel-Rollworkaround + sichtbares X-Bein.
    // Bei nahezu gestrecktem Bein (OS↔SB < 20°) zielt die Hüfte jetzt auf den
    // WINKELBISSEKTOR aus OS+SB: der unvermeidliche Restfehler verteilt sich
    // symmetrisch (je ~5° statt 0°/10°), das Knie bleibt natürlich. Gebogene
    // Beine (Kniebeuge > 20°) zielen weiter rein auf den OS — da kommt der
    // Seitwärts-Anteil eh aus der Hüfte und das Knie löst den Rest.
    const mkGoals = (f, side) => {
      const li = side === 'left' ? 0 : 4;
      const g = { hasThigh: false, hasShin: false, hasFoot: false, hasArm: false, hasFore: false, straightLeg: false,
        dThigh: [0, 0, 0], dShin: [0, 0, 0], dHip: [0, 0, 0], dArm: [0, 0, 0], dFore: [0, 0, 0] };
      const oT = (f * 8 + li) * 3, oS = (f * 8 + li + 1) * 3;
      const oA = (f * 8 + li + 2) * 3, oF = (f * 8 + li + 3) * 3;
      const t1 = [0, 0, 0, 1], t2 = [0, 0, 0, 1];
      const yq = [0, 0, Math.sin(-triadYaw[f] / 2), Math.cos(-triadYaw[f] / 2)]; // rotZ(-triadYaw)
      if (Number.isFinite(dSrc[oT])) {
        rotVec(yq, [dSrc[oT], dSrc[oT + 1], dSrc[oT + 2]], g.dThigh);
        g.hasThigh = true;
      }
      if (Number.isFinite(dSrc[oS])) {
        rotVec(yq, [dSrc[oS], dSrc[oS + 1], dSrc[oS + 2]], g.dShin);
        g.hasShin = true;
      }
      if (g.hasThigh && g.hasShin) {
        const dot = Math.max(-1, Math.min(1, g.dThigh[0] * g.dShin[0] + g.dThigh[1] * g.dShin[1] + g.dThigh[2] * g.dShin[2]));
        // Gewicht: 1 bei nahezu gestrecktem Bein, 0 ab ~20° Kniebeuge —
        // smoothstep über dot 0,80…0,97 (statt der harten 0,94-Schwelle von
        // v2.6.0: dort sprang das Hüftziel beim Übergang um mehrere Grad).
        const sLin = Math.max(0, Math.min(1, (dot - 0.80) / 0.17));
        const w = sLin * sLin * (3 - 2 * sLin);
        if (w > 0.001) {
          // v2.6.1 — VOLLER Valgus statt Winkelbisektor: Ein GERADES
          // Lehrer-Bein soll am G1 als natürlicher A-STAND erscheinen
          // (Oberschenkel ~±9° nach außen, Schienbein senkrecht = Nullpose,
          // Füße unter den Hüften). Der v2.6.0-Bisektor teilte den unver-
          // meidlichen Restfehler 50/50 — die SCHIENEN knickten dabei
          // weiterhin ~4,5° nach INNEN („linkes Bein zeigt nach innen,
          // muss aber nach außen"). Mit Ziel = um den vollen Valgus
          // nach außen rotierter OS-Richtung landet die Hüfte bei
          // hip_roll ≈ 0: das Bein liest sich durchgängig nach AUßEN.
          // Gebogene Beine (w → 0) zielen weiter exakt auf den OS.
          const a = -(VALGUS[side] || 0) * w;
          const cy = Math.cos(a), sy = Math.sin(a);
          const bx = g.dThigh[0], by0 = g.dThigh[1], bz0 = g.dThigh[2];
          const by = by0 * cy - bz0 * sy, bz = by0 * sy + bz0 * cy;
          const l = Math.hypot(bx, by, bz) || 1;
          g.dHip = [bx / l, by / l, bz / l];
          g.straightLeg = true;
        }
      }
      if (!g.straightLeg) { g.dHip[0] = g.dThigh[0]; g.dHip[1] = g.dThigh[1]; g.dHip[2] = g.dThigh[2]; }
      const o4 = (f * 2 + (side === 'left' ? 0 : 1)) * 4;
      if (Number.isFinite(footW[o4])) {
        t1[0] = footW[o4]; t1[1] = footW[o4 + 1]; t1[2] = footW[o4 + 2]; t1[3] = footW[o4 + 3];
        quatMul2(yq, t1, t2); quatMul2(t2, CAL[side].foot, t1);
        g.qFoot = t1.slice(); g.hasFoot = true;
      }
      if (Number.isFinite(dSrc[oA])) {
        rotVec(yq, [dSrc[oA], dSrc[oA + 1], dSrc[oA + 2]], g.dArm);
        g.hasArm = true;
      }
      if (Number.isFinite(dSrc[oF]) && G1D0[side].fore) {
        rotVec(yq, [dSrc[oF], dSrc[oF + 1], dSrc[oF + 2]], g.dFore);
        g.hasFore = true;
      }
      return g;
    };

    const bq4 = [0, 0, 0, 1];
    const dDisp = [0, 0, 0];
    const pA = [0, 0, 0], pB = [0, 0, 0];
    const dBase = [0, 0, 0], tInv = [0, 0, 0, 1];
    // Analytischer Seed (Minimal-Twist): Zielrichtung in den BASIS-Rahmen
    // drehen, die minimale Rotation von der Nullpose-Richtung dorthin als
    // Rotationsvektor auf die Nullpose-Achsen (yaw≈Z, roll≈X, pitch≈Y)
    // projizieren. Ohne Seed wandert der gierige Abstieg bei großen Winkeln
    // (Zombie: ~105° Hüftbeugung) in verdrehte Äquivalentlösungen (90°-Yaw,
    // Roll am Limit) — der Seed hält den Twist naturbelassen.
    // v2.5.0: maxStep begrenzt die Korrektur je Frame (Sanftanker) — bei
    // Infinity (Frame 0) wird der Seed voll angetragen.
    const seedChain = (off2, d0, dGoalW, jNames, maxStep = Infinity) => {
      quatConj(bq4, tInv);
      rotVec(tInv, dGoalW, dBase);
      quatFromTwoVecs(d0, dBase, qTmp);
      const ang = quatLogAxis(qTmp, axisTmp);
      const rv = [axisTmp[0] * ang, axisTmp[1] * ang, axisTmp[2] * ang];
      // jNames = [yaw, roll, pitch] — Achsen Z, X, Y (Nullpose, ≈Rumpfframe)
      const seed = [rv[2], rv[0], rv[1]];
      if (typeof process !== 'undefined' && process.env.RETARGET_DEBUG) {
        console.log(`[SEED] d0=(${d0.map(v => v.toFixed(2))}) dGoalW=(${dGoalW.map(v => v.toFixed(2))}) dBase=(${dBase.map(v => v.toFixed(2))}) ` +
          `seed(yaw/roll/pitch)=${seed.map(v => v.toFixed(2)).join('/')} baseQ=(${[bq4[0], bq4[1], bq4[2], bq4[3]].map(v => v.toFixed(2)).join(',')})`);
      }
      for (let j = 0; j < 3; j++) {
        const goal = clampA(jNames[j], seed[j]);
        const cur = q[off2 + A[jNames[j]]];
        const d = goal - cur;
        q[off2 + A[jNames[j]]] = Math.abs(d) <= maxStep ? goal : cur + Math.sign(d) * maxStep;
      }
    };
    // Koordinaten-Abstieg: entries = [{name, aid, anti?}]. „anti“ ist ein
    // gekoppelter Folgegelenk-Zug, der die NEGATIVE Deltasumme erhält:
    // Hüfte +Δ mit Knie −Δ dreht den OBERSCHENKEL bei raumfester SCHIENE —
 // so kann der Abstieg die Hüftrichtung verbessern, ohne die Schiene zu
    // verlieren, und der Gelenk-Twist bleibt naturbelassen (Yaw-Züge mit
    // Anti sind richtungsneutral und wandern nicht weg).
    const descend = (off2, errFn, entries, sweeps) => {
      let e = errFn();
      if (e < 0.02) return e; // < 1,2° — nichts zu tun (FK-Budget sparen)
      for (let sw = 0; sw < sweeps; sw++) {
        let improved = false;
        for (const en of entries) {
          for (const step of [0.3, 0.1, 0.03]) {
            let hit = false;
            for (const s of [1, -1]) {
              const old = q[off2 + en.aid];
              q[off2 + en.aid] = clampA(en.name, old + s * step);
              let oldAnti = null, antiMoved = true;
              if (en.anti !== undefined) {
                oldAnti = q[off2 + en.anti];
                q[off2 + en.anti] = clampA(en.antiName, oldAnti - s * step);
                // Klemmt das Folgegelenk (bewegt sich nicht voll), verwirf den
                // Zug KOMPLETT: Sonst entartet der Anti-Zug zum nackten
                // proximale Zug (Twist-Drift + unbemerkter Schienenschaden).
                antiMoved = Math.abs(q[off2 + en.anti] - oldAnti) > 0.499 * step;
              }
              const e2 = errFn();
              if (antiMoved && e2 < e - 1e-5) { e = e2; improved = hit = true; break; }
              q[off2 + en.aid] = old;
              if (oldAnti !== null) q[off2 + en.anti] = oldAnti;
            }
            if (hit) break;
          }
          if (e < 0.02) return e; // früh genug — Restspiel fractioniert nicht
        }
        if (!improved) break;
      }
      return e;
    };

    // WARM-START (v2.4.1-Fix für „Zucken/Kicken“): Der GANZE Gelenk-Row des
    // Frames startet aus der LÖSUNG des Vorgängerframes (statt Knie/Ellbogen/
    // Knöchel aus NULLEN) — genau die Null-Starts ließen den Abstieg bei
    // nahezu statischen Zielen (Idle!) in wechselnde Basin springen (Ellbogen-
    // Zuckung 0,49 rad/Frame). Hüfte/Schulter werden JEDE Frame analytisch
    // geseedet (Minimal-Twist — als Funktion der Zielrichtung selbst STETIG,
    // reanchored den Twist, damit er nicht in Limits wandert); alle übrigen
    // Gelenke erben die Vorgängerlösung und verfeinern sie nur noch.
    for (let f = 0; f < n; f++) {
      const off2 = f * nu;
      if (!prof.hasLegs) continue; // v2.15.0: X2 — q bleibt Hover-Schub
      // Frame 0 ZWEIMAL lösen: der zweite Durchlauf startet aus der eigenen
      // Lösung (= stationärer Zustand, den auch f=1 sieht) → keine f=0→1-Nadel
      const reps = f === 0 ? 2 : 1;
      for (let rep = 0; rep < reps; rep++) {
      if (f > 0) q.copyWithin(off2, off2 - nu, off2); // Warm-Start aus Vorgängerframe
      bq4[0] = baseQ[4 * f]; bq4[1] = baseQ[4 * f + 1]; bq4[2] = baseQ[4 * f + 2]; bq4[3] = baseQ[4 * f + 3];
      for (const side of ['left', 'right']) {
        const bb = G1B[side];
        const G = mkGoals(f, side);
        bq4[0] = baseQ[4 * f]; bq4[1] = baseQ[4 * f + 1]; bq4[2] = baseQ[4 * f + 2]; bq4[3] = baseQ[4 * f + 3];
        // ENTKOPPELT lösen (ein Ziel je Kette — gekoppelte Mischfehler erzeugen
        // raue Local Minima, in denen der Abstieg stecken bleibt):
        // 1) Hüfte: Oberschenkel-Richtung   2) Knie: Schien-Richtung
        // 3) Knöchel: Fuß-Orientierung      4) Schulter: Oberarm-Richtung
        // 5) Ellbogen: Unterarm-Richtung
        // Hüfte/Schulter erhalten je einen Minimal-Twist-Seed (s. o.).
        {
          const hipNames = [side + '_hip_yaw' + SUFF, side + '_hip_roll' + SUFF, prof.hip(side)];
          // ALTERNIEREND: Hüfte (nur Oberschenkel-Ziel) ↔ Knie (nur Schien-Ziel),
          // 2 Runden. Ein kombinierter Fehler funktioniert NICHT: Mit festem
          // Knie dreht eine Hüftbewegung Oberschenkel UND Schiene gleichmäßig →
          // 1,0·Δ − 0,8·Δ > 0 → die Hüfte friert ein. Getrennte Teilprobleme
          // sind je wohlkonditioniert und konvergieren im Wechsel zum Optimum.
          const hipEntries = [
            { name: side + '_hip_yaw' + SUFF, aid: A[side + '_hip_yaw' + SUFF], anti: A[prof.knee(side)], antiName: prof.knee(side) },
            { name: side + '_hip_roll' + SUFF, aid: A[side + '_hip_roll' + SUFF], anti: A[prof.knee(side)], antiName: prof.knee(side) },
            { name: prof.hip(side), aid: A[prof.hip(side)], anti: A[prof.knee(side)], antiName: prof.knee(side) },
          ];
          const kneeEntries = [prof.knee(side)].map(nm => ({ name: nm, aid: A[nm] }));
          // REINER Hüft-Fehler (v2.6.0: Ziel = dHip — OS bzw. dessen
          // Bissector bei geradem Bein, s. mkGoals): Die Anti-Züge (mit
          // Clamp-Rejekt) halten die Schiene raumfix, sodass die Hüfte die
          // Richtung optimal anfahren kann, ohne die Schiene zubeeinflussen.
          const thighErr = G.hasThigh ? () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            gposOf(bb.hip, pA); gposOf(bb.knee, pB);
            dirFromTo(pA, pB, dDisp);
            return angBetween(dDisp, G.dHip);
          } : () => 0;
          const shinErr = G.hasShin ? () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            gposOf(bb.knee, pA); gposOf(bb.ankle, pB);
            dirFromTo(pA, pB, dDisp);
            return angBetween(dDisp, G.dShin);
          } : () => 0;
          // Kombiniert (Rettungsrunde + Warm-Gate-Bewertung)
          const legErr = (G.hasThigh || G.hasShin) ? () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            let e = 0;
            if (G.hasThigh) {
              gposOf(bb.hip, pA); gposOf(bb.knee, pB);
              dirFromTo(pA, pB, dDisp);
              e += angBetween(dDisp, G.dThigh);
            }
            if (G.hasShin) {
              gposOf(bb.knee, pA); gposOf(bb.ankle, pB);
              dirFromTo(pA, pB, dDisp);
              e += 0.8 * angBetween(dDisp, G.dShin);
            }
            return e;
          } : () => 0;
          // Hüft-Seed (v2.5.0): Wie v2.4.1 JEDES Frame voll antragen — bei
          // den Beinen ist das bewährt (Knie hat riesige Range, keine
          // Klemm-Konflikte; der kontinuierliche Anker hielt die Yaw-Spikes
          // klein). Die WARM-GATE-Behandlung bleibt der Schulter (Arm-
          // Ellbogen kann klemmen — dort ist der Sanftanker nötig).
          if (G.hasThigh) seedChain(off2, G1D0[side].thigh, G.dHip, hipNames);
          for (let round = 0; round < 2; round++) {
            descend(off2, thighErr, hipEntries, 6);
            descend(off2, shinErr, kneeEntries, 6);
          }
          // Rettungsrunde: kombinierter Fehler — wenn das Knie freie Range hat,
          // halten die Anti-Züge die Schiene fix (kein Trade-off); klemmt es,
          // balanciert der kombinierte Fehler Oberschenkel gegen Schiene.
          descend(off2, legErr, hipEntries, 5);
          descend(off2, shinErr, kneeEntries, 6);
        }
        if (G.hasFoot) {
          const ankleNm = prof.anklePitch(side);
          const entries = (prof.ankleRoll ? [ankleNm, prof.ankleRoll(side)] : [ankleNm])
            .map(nm => ({ name: nm, aid: A[nm] }));
          const errFn = () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            return oriErrOf(G.qFoot, bb.ankle);
          };
          descend(off2, errFn, entries, 8);
        }
        if (prof.hasArms && bones[side + 'Arm'] !== undefined) {
          {
            const shNames = [side + '_shoulder_pitch' + SUFF, side + '_shoulder_roll' + SUFF, side + '_shoulder_yaw' + SUFF];
            // Arm ALTERNIEREND: Schulter (nur Oberarm-Ziel) ↔ Ellbogen
            // (nur Unterarm-Ziel), 2 Runden — gleiche Begründung wie beim Bein
            // (kombinierter Fehler = Barriere für die proximale Kette).
            const shEntries = [
              { name: shNames[0], aid: A[shNames[0]], anti: A[prof.elbow(side)], antiName: prof.elbow(side) },
              { name: shNames[1], aid: A[shNames[1]], anti: A[prof.elbow(side)], antiName: prof.elbow(side) },
              { name: shNames[2], aid: A[shNames[2]], anti: A[prof.elbow(side)], antiName: prof.elbow(side) },
            ];
            const elEntries = [prof.elbow(side)].map(nm => ({ name: nm, aid: A[nm] }));
            // Reiner Oberarm-Fehler für die Schulter-Züge (Anti + Clamp-Rejekt
            // schützen den Unterarm — gleiche Logik wie beim Bein)
            const armDirErr = G.hasArm ? () => {
              sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
              gposOf(bb.upperArm, pA); gposOf(bb.elbow, pB);
              dirFromTo(pA, pB, dDisp);
              return angBetween(dDisp, G.dArm);
            } : () => 0;
            const foreDirErr = G.hasFore ? () => {
              sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
              gposOf(bb.elbow, pA); gposOf(bb.wrist, pB);
              dirFromTo(pA, pB, dDisp);
              return angBetween(dDisp, G.dFore);
            } : () => 0;
            // Kombiniert (Rettungsrunde + Warm-Gate-Bewertung)
            const armErr = (G.hasArm || G.hasFore) ? () => {
              sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
              let e = 0;
              if (G.hasArm) {
                gposOf(bb.upperArm, pA); gposOf(bb.elbow, pB);
                dirFromTo(pA, pB, dDisp);
                e += angBetween(dDisp, G.dArm);
              }
              if (G.hasFore) {
                gposOf(bb.elbow, pA); gposOf(bb.wrist, pB);
                dirFromTo(pA, pB, dDisp);
                e += 0.8 * angBetween(dDisp, G.dFore);
              }
              return e;
            } : () => 0;
            if (G.hasArm) {
              // Seed: [pitch, roll, yaw]. v2.5.0-Fix („linker Arm zuckt“):
              // a) Die G1-Schulter hat DIESELBE Achsenkonvention wie die Hüfte
              //    (g1.xml: pitch axis=0 1 0 LATERAL, roll axis=1 0 0 VORWÄRTS,
              //    yaw axis=0 0 1). Der alte Seed vertauschte pitch/roll
              //    (pitch←X, roll←Y): Beim Zombie-Arm (−90° horizontal) landete
              //    der ganze Winkel im ROLL (Range ±1,59!) statt im PITCH
              //    (±3,09) → klemmender Seed am Limit.
              // b) SANFTANKER mit LOOK-AHEAD statt Zwangs-Seed: Der alte Code
              //    trug den Seed JEDES Frame gewaltsam ein und warf die
              //    konvergierte Warm-Start-Lösung weg → Frame-Rucke. Jetzt:
              //    Frame 0 voll verankern; danach den VOLL-Seed nur MESSEN —
              //    bringt er > 0,05 rad, wird er ratenlimitiert (0,25 rad/
              //    Frame) hinzitiert. Idles bleiben still, Re-Ankerungen
              //    gleiten, der Gang wird nicht mehr oszilliert.
              const oldS = [q[off2 + A[shNames[0]]], q[off2 + A[shNames[1]]], q[off2 + A[shNames[2]]]];
              quatConj(bq4, tInv);
              rotVec(tInv, G.dArm, dBase);
              quatFromTwoVecs(G1D0[side].arm, dBase, qTmp);
              const ang = quatLogAxis(qTmp, axisTmp);
              const rvS = [axisTmp[0] * ang, axisTmp[1] * ang, axisTmp[2] * ang];
              const seedS = [rvS[1], rvS[0], rvS[2]]; // pitch←Y, roll←X, yaw←Z
              if (f === 0) {
                for (let j = 0; j < 3; j++) q[off2 + A[shNames[j]]] = clampA(shNames[j], seedS[j]);
              } else {
                // Look-Ahead: vollen Seed temporär antragen + messen
                for (let j = 0; j < 3; j++) q[off2 + A[shNames[j]]] = clampA(shNames[j], seedS[j]);
                const goals = [q[off2 + A[shNames[0]]], q[off2 + A[shNames[1]]], q[off2 + A[shNames[2]]]];
                const eFull = armErr();
                for (let j = 0; j < 3; j++) q[off2 + A[shNames[j]]] = oldS[j]; // Warm-Start zurück
                const eWarm = armErr();
                if (eWarm - eFull > 0.05) {
                  // Re-Ankerung lohnt sich → sanft hinzitieren
                  for (let j = 0; j < 3; j++) {
                    const d = goals[j] - oldS[j];
                    q[off2 + A[shNames[j]]] = Math.abs(d) <= 0.25 ? goals[j] : oldS[j] + Math.sign(d) * 0.25;
                  }
                }
              }
            }
            for (let round = 0; round < 2; round++) {
              descend(off2, armDirErr, shEntries, 6);
              descend(off2, foreDirErr, elEntries, 6);
            }
            // Rettungsrunde (klemmt der Ellbogen, darf die Schulter auffangen)
            descend(off2, armErr, shEntries, 5);
            descend(off2, foreDirErr, elEntries, 6);
          }
        }
        if (f === 0 && typeof process !== 'undefined' && process.env.RETARGET_DEBUG) {
          sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
          const dbg = (a, b, goalDir) => {
            gposOf(a, pA); gposOf(b, pB);
            dirFromTo(pA, pB, dDisp);
            return (angBetween(dDisp, goalDir) * 180 / Math.PI).toFixed(1);
          };
          const hj = [side + '_hip_yaw_joint', side + '_hip_roll_joint', side + '_hip_pitch_joint'];
          console.log(`[IK-DEBUG f0 ${side}] OS=${G.hasThigh ? dbg(bb.hip, bb.knee, G.dThigh) : '-'}° ` +
            `SB=${G.hasShin ? dbg(bb.knee, bb.ankle, G.dShin) : '-'}° ` +
            `OA=${G.hasArm ? dbg(bb.upperArm, bb.elbow, G.dArm) : '-'}° ` +
            `UA=${G.hasFore ? dbg(bb.elbow, bb.wrist, G.dFore) : '-'}° ` +
            `q=${hj.map(nm => q[off2 + A[nm]].toFixed(2)).join('/')} ` +
            `knee=${q[off2 + A[side + '_knee_joint']].toFixed(2)} ` +
            `dThigh=${G.hasThigh ? G.dThigh.map(v => v.toFixed(2)).join(',') : '-'} ` +
            `triadYaw=${(triadYaw[f] * 180 / Math.PI).toFixed(0)}°`);
        }
      }
      } // rep (Frame 0 doppelt)
    }
  }

  // ── Timeline-Pflege (v2.4.1): Rest-Glitches aus der Gelenk-Zeile filtern ──
  // a) Vereinzelte Spike-Frames (IK-Sonderfälle, Export-Artefakte) überbrücken
  denoiseTimeline(q, n, nu);
  // b) Loop-Naht: springt das Clip-Ende zum Anfang, das Ende sanft hinbiegen
  seamBlend(q, n, nu);

  // ── Boden-Anpassung (Fuß erden): tiefsten Fußpunkt pro Frame via Geist ──
  // WICHTIG: MIT Basis-Orientierung (baseQ) — bei gebeugtem Lehrer (Zombie)
  // hängen die Füße sonst falsch und die Höhe würde verkalkt. Die Tiefe je
  // Fuß-Geom wird ECHT aus den Mesh-Vertices/Kugel-Radien bestimmt (einmalig).
  const ghost = sim.makeGhostData();
  const bq4 = [0, 0, 0, 1];
  const footGeoms = sim.footGeoms || (sim.footGeoms = findFootGeoms(sim));
  for (let f = 0; f < n; f++) {
    const off = f * nu;
    bq4[0] = baseQ[4 * f]; bq4[1] = baseQ[4 * f + 1]; bq4[2] = baseQ[4 * f + 2]; bq4[3] = baseQ[4 * f + 3];
    sim.setGhostPose(ghost, q, off, rawH[f], 0, 0, 0, bq4);
    let lowest = 0;
    // Füße: unterster Punkt aller Fuß-Geoms (Welt-z = Körper-hoch + Tiefen-Offset)
    for (const fg of footGeoms) {
      const z = ghost.xpos[3 * fg.body + 2] + fg.lowZ;
      if (z < lowest) lowest = z;
    }
    h[f] = Math.min(prof.hMax, Math.max(prof.hMin, rawH[f] - lowest));
  }
  // Höhe glätten (Burgen vermeiden)…
  smooth(h, 5);
  // …und DANACH exakt erden: mit der GEGLÄTTETEN Höhe erneut messen und den
  // Rest-Auftrieb abziehen (das Glätten hebt den tiefsten Fuß sonst cm-weise an).
  // Echtes Minimum (auch positiv!) — sonst bleibt ein cm-Hover stehen.
  for (let f = 0; f < n; f++) {
    const off = f * nu;
    bq4[0] = baseQ[4 * f]; bq4[1] = baseQ[4 * f + 1]; bq4[2] = baseQ[4 * f + 2]; bq4[3] = baseQ[4 * f + 3];
    sim.setGhostPose(ghost, q, off, h[f], 0, 0, 0, bq4);
    let lowest = Infinity;
    for (const fg of footGeoms) {
      const z = ghost.xpos[3 * fg.body + 2] + fg.lowZ;
      if (z < lowest) lowest = z;
    }
    if (!Number.isFinite(lowest)) lowest = 0;
    h[f] = Math.min(prof.hMax, Math.max(prof.hMin, h[f] - lowest));
  }

  // ── v2.28.8: KNOCHENLÄNGEN-TRANSFER — Skelett auf die ROBOTER-Gliedmaßen ──
  // Menschen-Proportionen (cskel27) um den kompakteren G1 wirken als „Exo-
  // skelett" (Nutzer-Screenshot: Wirbelsäule über dem Kopf, Arme/Beine außer-
  // halb der Roboter-Gliedmaßen). Fix: RICHTUNGEN aus den Lehrer-Daten,
  // LÄNGEN vom Roboter (Nullpose-Distanzen der Körper-Ursprünge — Segmente
  // sind starr, also posensunabhängig messbar). Nur bei vollem cskel27-
  // Layout; Legacy-13-Clips bleiben beim uniformen Höhen-Fit.
  let srcRig = 0;
  try {
    if (prof.hasLegs && srcJoints.length === SRC_ROLES.length) {
      const dist0 = (b1, b2) => { const a = pos0Of(b1), c = pos0Of(b2); return Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]); };
      // Lehrer-Knochenlängen (Median je Kante — stabil gegen Pose-Ausreißer)
      const tLen = {};
      for (const [p, c] of SRC_EDGES) {
        const ip = srcJoints.indexOf(p), ic = srcJoints.indexOf(c);
        if (ip < 0 || ic < 0) continue;
        const Ls = [];
        for (let f = 0; f < n; f++) {
          const op = (f * srcJoints.length + ip) * 3, oc = (f * srcJoints.length + ic) * 3;
          const l = Math.hypot(srcPos[oc] - srcPos[op], srcPos[oc + 1] - srcPos[op + 1], srcPos[oc + 2] - srcPos[op + 2]);
          if (Number.isFinite(l) && l > 1e-6) Ls.push(l);
        }
        if (Ls.length) { Ls.sort((a, b) => a - b); tLen[c] = Ls[Math.floor(Ls.length / 2)]; }
      }
      const pelvis = sim.baseBody;
      const lens = {};
      let ok = true;
      // Beine: Hüft-Gelenkbreite + OS + SB (beide Seiten, echte Körper)
      const legF = {};
      for (const side of ['left', 'right']) {
        const B = G1B[side];
        if (!B || B.hip < 0 || B.knee < 0 || B.ankle < 0) { ok = false; break; }
        lens[side + 'UpLeg'] = dist0(pelvis, B.hip);
        lens[side + 'Leg'] = dist0(B.hip, B.knee);
        lens[side + 'Foot'] = dist0(B.knee, B.ankle);
        const tLeg = (tLen[side + 'UpLeg'] || 0) + (tLen[side + 'Leg'] || 0);
        legF[side] = tLeg > 1e-6 ? (lens[side + 'UpLeg'] + lens[side + 'Leg']) / tLeg : 1;
      }
      // Zehen: proportional zum Bein-Faktor (kein eigener Toe-Körper messbar)
      if (ok) for (const side of ['left', 'right']) {
        lens[side + 'ToeBase'] = (tLen[side + 'ToeBase'] || 0.1) * (legF[side] || 1);
      }
      // Wirbelsäule + Schulterkette: der G1 hat KEINEN Kopf-/Torso-Anker-Body
      // (waist_yaw_link liegt AUF dem Becken) und body_parentid[elbow] ist ein
      // MITTLERES Oberarm-Glied (shoulder_yaw) — die Schulter selbst ist der
      // HÖCHSTE Vorfahre des Ellbogens (argmax z auf der Elternkette).
      //   Wirbelkette (Hüfte→Spine3) = senkrechte Distanz Becken→Schulter-Niveau
      //   Schlüsselbein-Kette (Spine3→Schulter→Arm) = laterale Distanz
      //   Oberarm = Schulter→Ellbogen · Unterarm = Ellbogen→Handgelenk
      //   Nacken+Kopf = Lehrer × Wirbelsäulen-Faktor (kein Kopf-Körper messbar)
      if (ok && prof.hasArms) {
        const BL = G1B.left, BR = G1B.right;
        const shoulderOf = (elbowBody) => { // höchster Vorfahre = Schultergelenk
          let best = elbowBody, bestZ = pos0Of(elbowBody)[2], cur = elbowBody;
          for (let g = 0; g < 6; g++) {
            const par = sim.model.body_parentid[cur];
            if (par === undefined || par <= 0) break;
            const z = pos0Of(par)[2];
            if (z <= bestZ + 1e-9) break; // nicht mehr steigend → Schulter erreicht
            best = par; bestZ = z; cur = par;
          }
          return best;
        };
        if (BL && BL.elbow > 0 && BR && BR.elbow > 0) {
          const shL = shoulderOf(BL.elbow), shR = shoulderOf(BR.elbow);
          const p0 = pos0Of(pelvis);
          const shZ = 0.5 * (pos0Of(shL)[2] + pos0Of(shR)[2]);
          const center = [p0[0], p0[1], shZ]; // Schulter-Niveau auf der Mittelachse
          const spineLen = Math.hypot(center[0] - p0[0], center[1] - p0[1], center[2] - p0[2]);
          const clavL = Math.hypot(pos0Of(shL)[0] - center[0], pos0Of(shL)[1] - center[1], pos0Of(shL)[2] - center[2]);
          const clavR = Math.hypot(pos0Of(shR)[0] - center[0], pos0Of(shR)[1] - center[1], pos0Of(shR)[2] - center[2]);
          const tSpine = (tLen.spine || 0) + (tLen.spine1 || 0) + (tLen.spine2 || 0) + (tLen.spine3 || 0);
          if (spineLen > 0.05 && tSpine > 1e-6) {
            for (const c of ['spine', 'spine1', 'spine2', 'spine3']) {
              if (tLen[c] !== undefined) lens[c] = spineLen * (tLen[c] / tSpine);
            }
            // Nacken+Kopf: proportional zur Wirbelsäulen-Kompression
            const spineF = spineLen / tSpine;
            const tNH = (tLen.neck || 0) + (tLen.head || 0);
            if (tNH > 1e-6) {
              if (tLen.neck !== undefined) lens.neck = tLen.neck * spineF;
              if (tLen.head !== undefined) lens.head = tLen.head * spineF;
            }
            // Schlüsselbein-Ketten + Arme je Seite
            for (const [side, shB, clav] of [['left', shL, clavL], ['right', shR, clavR]]) {
              const B = G1B[side];
              const tSh = (tLen[side + 'Shoulder'] || 0) + (tLen[side + 'Arm'] || 0);
              if (clav > 0.02 && tSh > 1e-6) {
                if (tLen[side + 'Shoulder'] !== undefined) lens[side + 'Shoulder'] = clav * (tLen[side + 'Shoulder'] / tSh);
                if (tLen[side + 'Arm'] !== undefined) lens[side + 'Arm'] = clav * (tLen[side + 'Arm'] / tSh);
              }
              const upperArmLen = dist0(shB, B.elbow); // Schulter→Ellbogen
              if (upperArmLen > 0.01) {
                lens[side + 'ForeArm'] = upperArmLen;
                const tFA = tLen[side + 'ForeArm'] || 0;
                const armF = tFA > 1e-6 ? upperArmLen / tFA : 1;
                if (B.wrist > 0 && dist0(B.elbow, B.wrist) > 0.01) {
                  lens[side + 'Hand'] = dist0(B.elbow, B.wrist);
                } else if (tLen[side + 'Hand'] !== undefined) {
                  lens[side + 'Hand'] = tLen[side + 'Hand'] * armF;
                }
                const handF = (tLen[side + 'Hand'] > 1e-6 && lens[side + 'Hand'] !== undefined) ? lens[side + 'Hand'] / tLen[side + 'Hand'] : armF;
                if (tLen[side + 'HandEnd'] !== undefined) lens[side + 'HandEnd'] = tLen[side + 'HandEnd'] * handF;
                if (tLen[side + 'HandThumb1'] !== undefined) lens[side + 'HandThumb1'] = tLen[side + 'HandThumb1'] * handF;
              }
            }
          }
        }
      }
      // Anwenden (nur wenn die Kernsegmente sinnvoll sind)
      let lensOk = ok && Object.keys(lens).length >= 12;
      if (lensOk) for (const k in lens) if (!Number.isFinite(lens[k]) || lens[k] <= 0.005) { lensOk = false; break; }
      if (lensOk) {
        const fiLF = srcJoints.indexOf('leftFoot'), fiRF = srcJoints.indexOf('rightFoot');
        const fiLT = srcJoints.indexOf('leftToeBase'), fiRT = srcJoints.indexOf('rightToeBase');
        const groundIdx = [fiLF, fiRF, fiLT, fiRT].filter(i => i >= 0);
        // Boden-BEZIEHUNG des Lehrers je Frame sichern (vorher messen): Stand-
        // Frames haben min-Fuß = 0, Sprünge > 0 — nach dem Transfer wird die
        // GLEICHE Min-Fußhöhe wiederhergestellt (das Skelett hat kürzere
        // Roboter-Beine und würde sonst in der Lehrer-Hüfthöhe SCHWEBEN;
        // groundSrcPosFrame hebt nur an und könnte das nicht senken).
        const nR = srcJoints.length;
        const tMin = new Float32Array(n);
        for (let f = 0; f < n; f++) {
          let m = Infinity;
          for (const gi of groundIdx) { const z = srcPos[(f * nR + gi) * 3 + 2]; if (Number.isFinite(z)) m = Math.min(m, z); }
          tMin[f] = Number.isFinite(m) ? m : 0;
        }
        if (reproportionSrcPos(srcPos, srcJoints, n, lens)) {
          srcRig = 1;
          for (let f = 0; f < n; f++) {
            let m = Infinity;
            for (const gi of groundIdx) { const z = srcPos[(f * nR + gi) * 3 + 2]; if (Number.isFinite(z)) m = Math.min(m, z); }
            const dz = tMin[f] - (Number.isFinite(m) ? m : tMin[f]);
            if (dz) for (let gi = 0; gi < nR; gi++) srcPos[(f * nR + gi) * 3 + 2] += dz;
          }
          log(`Skelett auf Roboter-Gliedmaßen übertragen (OS ${((lens.leftLeg || 0) * 100).toFixed(0)} cm, SB ${((lens.leftFoot || 0) * 100).toFixed(0)} cm, Oberarm ${((lens.leftForeArm || 0) * 100).toFixed(0)} cm, Unterarm ${((lens.leftHand || 0) * 100).toFixed(0)} cm)`);
        }
      }
    }
  } catch (e) {
    log('Knochenlängen-Transfer übersprungen (' + (e && e.message ? e.message : e) + ') — uniformer Fit bleibt');
  }

  // ── Locomotion-Bewertung: wandert die Bahn wirklich? ──
  // motiontask nutzt das, um den Loop-Rebase (Endlos-Laufen) nur bei echten
  // Bewegungs-Clips anzuwenden — bei Idles würde sonst der winzige
  // Yaw-/Positions-Unterschied Clip-Ende↔Anfang JEDE Schleife akkumulieren
  // (der Geist drehte sich über Minuten komplett um / wanderte davon).
  let travel = 0;
  for (let f = 1; f < n; f++) {
    travel += Math.hypot(root[2 * f] - root[2 * f - 2], root[2 * f + 1] - root[2 * f - 1]);
  }
  const meanSpeed = travel / Math.max(1e-6, (n - 1) / fps);
  const locomotion = meanSpeed > 0.10; // m/s — Idles/Sways bleiben unterhalb

  return {
    name: clip.name || 'clip',
    robotId: (sim.cfg && sim.cfg.id) || 'g1', // v2.15.0: Ziel-Roboter
    fps, n, nu,
    q, h,
    root, yaw, srcPos, srcJoints,
    baseQ, // Basis-Orientierung je Frame (n×4, xyzw) — Lehrer-Nick/Roll für den Geist
    rawYaw, triadYaw, // Diagnose: Blick-Rohwert + Triaden-Yaw vor Unwrap
    locomotion, meanSpeed, // true = echte Fortbewegung (Loop-Rebase erlaubt)
    alg: RT_ALG, // Algorithmus-Version (glbstore/main: Auto-Re-Retarget alter Bestände)
    srcRig, // v2.28.8: 1 = srcPos trägt Roboter-Knochenlängen (kein uniformer Fit nötig)
    scale, // Datei-Einheit → Meter (für den Original-Mesh-Wrap in render3d)
    mergedFrom: clip.mergedFrom || 0,
    mapped: roleNames,
    duration: clip.duration,
  };
}

// ── Timeline-Pflege (v2.4.1) ────────────────────────────────────────────
// a) Spike-Brücke: isolierte Ausreißer-Frames (beidseitig steile Kanten)
//    gegen die adaptive Bewegungsskala des Gelenks ersetzen. Echte schnelle
//    Bewegungen (Rampen) bleiben unangetastet — nur NADELN werden gebrochen.
function denoiseTimeline(q, n, nu) {
  if (n < 5) return;
  for (let j = 0; j < nu; j++) {
    // Aktivität des Gelenks über die GANZE Timeline (v2.5.0): Ruhteile
    // (Zombie-Arme!) bekommen eine viel feinere Nadel-Schwelle — ein 8°-
    // Ruck in einem fast stillen Gelenk ist ein Glitch, in einer schnellen
    // Bewegung Normalität. Die alte Pauschal-Schwelle 0,3 rad (17°) ließ
    // genau diese Idles-Rucke durch.
    let aMin = Infinity, aMax = -Infinity;
    for (let f = 0; f < n; f++) { const v = q[f * nu + j]; if (v < aMin) aMin = v; if (v > aMax) aMax = v; }
    const quiet = (aMax - aMin) < 0.45; // rad — kaum Bewegung über den Clip
    const edgeMin = quiet ? 0.045 : 0.3;
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (let f = 1; f < n - 1; f++) {
        const v0 = q[(f - 1) * nu + j], v1 = q[f * nu + j], v2 = q[(f + 1) * nu + j];
        const d0 = Math.abs(v1 - v0), d1 = Math.abs(v2 - v1);
        const edge = Math.max(d0, d1);
        if (edge < edgeMin) continue; // unter der Nadel-Schwelle
        // lokale Bewegungsskala (Median der Nachbar-Deltas ohne f)
        const nb = [];
        for (let g = Math.max(1, f - 3); g <= Math.min(n - 1, f + 4); g++) {
          if (g === f || g === f + 1) continue;
          nb.push(Math.abs(q[g * nu + j] - q[(g - 1) * nu + j]));
        }
        nb.sort((a, b) => a - b);
        const med = nb.length ? nb[nb.length >> 1] : 0;
        const thr = Math.max(edgeMin, 6 * med);
        if (d0 > thr && d1 > thr) {
          q[f * nu + j] = 0.5 * (v0 + v2); // Nadel → Brücke
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Ruhige Gelenke: 3-Tap-Median glättet 1-Frame-Ausreißer UNTER der
    // Nadel-Schwelle (erhält Stufen & Rampen, killt Blips)
    if (quiet && n >= 3) {
      const col = new Float32Array(n);
      for (let f = 0; f < n; f++) col[f] = q[f * nu + j];
      for (let f = 1; f < n - 1; f++) {
        const a = col[f - 1], b = col[f], c = col[f + 1];
        q[f * nu + j] = (a <= b ? b <= c ? b : a <= c ? c : a : a <= c ? a : b <= c ? c : b);
      }
    }
    // Stufen-Brücke (v2.5.0): ein EINMALiger Sprung > 0,45 rad, dem sofort
    // wieder Ruhe folgt (< 25 % des Sprungs), ist eine IK-Re-Ankerungs-
    // Kante — echte schnelle Bewegungen sind RAMPELN (mehrere große Deltas
    // hintereinander) und bleiben unangetastet. Die Stufe wird über 2
    // Frames verteilt.
    for (let pass = 0; pass < 2; pass++) {
      let bridged = false;
      for (let f = 1; f < n - 2; f++) {
        const a = q[(f - 1) * nu + j], b = q[f * nu + j], c = q[(f + 1) * nu + j];
        const step = b - a;
        if (Math.abs(step) < 0.45) continue;
        if (Math.abs(c - b) > 0.25 * Math.abs(step)) continue; // Rampe →echt
        const d = q[(f + 2) * nu + j];
        if (Math.abs(d - c) > 0.35 * Math.abs(step)) continue; // Folge-Rampe → echt
        q[f * nu + j] = a + 0.5 * step;       // halber Schritt auf f
        q[(f + 1) * nu + j] = c;              // f+1 endet wie gehabt → Rest automatisch
        bridged = true;
      }
      if (!bridged) break;
    }
  }
}

// b) Loop-Naht: endet der Clip in einer deutlich anderen Pose als er startet,
//    werden die letzten K Frames zum Start-Pose hin geblendet (Smoothstep) —
//    das Endlosschleifen-Wrap zuckt nicht mehr.
function seamBlend(q, n, nu) {
  if (n < 10) return;
  let seam = 0;
  for (let j = 0; j < nu; j++) seam = Math.max(seam, Math.abs(q[j] - q[(n - 1) * nu + j]));
  if (seam < 0.15) return; // Naht ohnehin stetig
  const K = Math.min(8, n >> 2);
  for (let k = 0; k < K; k++) {
    const f = n - K + k;
    const u = (k + 1) / (K + 1);
    const s = u * u * (3 - 2 * u); // Smoothstep
    for (let j = 0; j < nu; j++) {
      q[f * nu + j] = q[f * nu + j] * (1 - s) + q[j] * s;
    }
  }
}

// c) Winkel-Brücke: einzelne Sprünge > maxStep (bereits ent-wrapped, relativ)
//    linear über die betroffenen Frames verteilen.
function bridgeAngles(arr, n, maxStep) {
  for (let f = 1; f < n; f++) {
    if (Math.abs(arr[f] - arr[f - 1]) <= maxStep) continue;
    let g = f;
    while (g < Math.min(n - 1, f + 6) && Math.abs(arr[g + 1] - arr[g]) > maxStep * 0.5) g++;
    const a0 = arr[f - 1], a1 = arr[g];
    const steps = g - f + 1;
    for (let k = 0; k < steps; k++) {
      arr[f + k] = a0 + (a1 - a0) * ((k + 1) / (steps + 1));
    }
    f = g;
  }
}

// Fuß-Geoms mit ECHTER Tiefe: unterster Punkt je Geom im KÖRPER-Frame
// (Meshes: unterste Vertebra inkl. geom_quat; Kugel/Kapsel/Zylinder/Box: Formel)
// v2.28.0: exportiert — auch die Geist-ANZEIGE (main.js Render-Loop) erdet
// damit die Referenz-Pose (Boden-Garantie für ARDY-Höhendrift).
export function findFootGeoms(sim) {
  const out = [];
  const m = sim.model;
  for (let g = 0; g < sim.ngeom; g++) {
    const b = m.geom_bodyid[g];
    const name = mjName(sim, b);
    if (!name || !/ankle|foot/i.test(name)) continue;
    const type = m.geom_type[g];
    const pz = m.geom_pos[3 * g + 2];
    let lowZ = pz;
    if (type === 7) { // Mesh: unterste Vertebra (geom_quat einrechnen)
      const qx = m.geom_quat[4 * g + 1], qy = m.geom_quat[4 * g + 2], qz = m.geom_quat[4 * g + 3], qw = m.geom_quat[4 * g];
      const dId = m.geom_dataid[g], vAdr = m.mesh_vertadr[dId], vNum = m.mesh_vertnum[dId];
      let minVz = 0;
      for (let i = 0; i < vNum; i++) {
        const vx = m.mesh_vert[3 * (vAdr + i)], vy = m.mesh_vert[3 * (vAdr + i) + 1], vz = m.mesh_vert[3 * (vAdr + i) + 2];
        const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
        const z = vz + qw * tz + (qx * ty - qy * tx); // z von q⊗v⊗q*
        if (z < minVz) minVz = z;
      }
      lowZ = pz + minVz;
    } else if (type === 2) lowZ = pz - m.geom_size[3 * g];                          // Kugel
    else if (type === 3) lowZ = pz - (m.geom_size[3 * g] + m.geom_size[3 * g + 1]); // Kapsel (Z-Achse)
    else if (type === 5) lowZ = pz - m.geom_size[3 * g + 1];                        // Zylinder
    else if (type === 6) lowZ = pz - m.geom_size[3 * g + 2];                        // Box
    out.push({ body: b, lowZ });
  }
  return out;
}

// Rotationsmatrix (Spalten X=fwd, Y=left, Z=up) → Quaternion [x,y,z,w]
// (Shepperd-Methode — für die konventionsfreie Basis-Triade)
function mat3ToQuat(xx, xy, xz, yx, yy, yz, zx, zy, zz, out) {
  const m00 = xx, m01 = yx, m02 = zx;
  const m10 = xy, m11 = yy, m12 = zy;
  const m20 = xz, m21 = yz, m22 = zz;
  const tr = m00 + m11 + m22;
  let qx = 0, qy = 0, qz = 0, qw = 1, S;
  if (tr > 0) {
    S = Math.sqrt(tr + 1) * 2; qw = 0.25 * S;
    qx = (m21 - m12) / S; qy = (m02 - m20) / S; qz = (m10 - m01) / S;
  } else if (m00 > m11 && m00 > m22) {
    S = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / S; qx = 0.25 * S;
    qy = (m01 + m10) / S; qz = (m02 + m20) / S;
  } else if (m11 > m22) {
    S = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / S; qy = 0.25 * S;
    qx = (m01 + m10) / S; qz = (m12 + m21) / S;
  } else {
    S = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / S; qz = 0.25 * S;
    qx = (m02 + m20) / S; qy = (m12 + m21) / S;
  }
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  out[0] = qx / n; out[1] = qy / n; out[2] = qz / n; out[3] = qw / n;
  return out;
}
function mjName(sim, b) {
  try { return sim._mjApi.mj_id2name(sim.model, 1, b); } catch (e) { return null; } // mjOBJ_BODY=1
}

function smooth(arr, win) {
  const n = arr.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j >= 0 && j < n) { s += arr[j]; c++; }
    }
    out[i] = s / c;
  }
  arr.set(out);
}

// ═══ v2.28.1 BODEN-REPARATUR (Migration für gespeicherte Clips) ═══
// Hebt in EINEM Frame den tiefsten Fußpunkt exakt auf 0 (Fallback: alle
// Rollen, NaN-sicher). Sprünge (beide Füße über 0) bleiben unangetastet.
// Wird von retargetToG1 je Frame UND von activateClip zur Reparatur alter
// Bestände (vor der v2.28.0-Boden-Garantie generiert) benutzt.
export function groundSrcPosFrame(srcPos, f, nR, fiL = -1, fiR = -1, extra = []) {
  const probe = (gi) => {
    const z = srcPos[(f * nR + gi) * 3 + 2];
    return Number.isFinite(z) ? z : Infinity;
  };
  let minZ = Infinity;
  if (fiL >= 0) minZ = Math.min(minZ, probe(fiL));
  if (fiR >= 0) minZ = Math.min(minZ, probe(fiR));
  // v2.28.7: ToeBase-Gelenke sind der TATSÄCHLICH tiefste Punkt (Zehen
  // liegen unter dem Fußgelenk) — ohne sie blieb die Zehenspitze ~1 cm
  // im Boden hängen, sobald srcPos die volle cskel27-Anatomie trägt.
  for (const ei of extra) if (ei >= 0) minZ = Math.min(minZ, probe(ei));
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
  const fiLT = srcJoints.indexOf('leftToeBase'), fiRT = srcJoints.indexOf('rightToeBase'); // v2.28.7
  let lifted = 0;
  for (let f = 0; f < n; f++) {
    if (groundSrcPosFrame(srcPos, f, nR, fiL, fiR, [fiLT, fiRT]) > 0) lifted++;
  }
  return lifted;
}

// ═══ v2.28.3 — ARDY-VERSUCHS-QUALITÄT (für Auto-Retry) ═══
// Bewertet EINEN Generierungsversuch rein funktional (testbar in Node):
//   ▸ collapsed: die Hüftenhöhe (motion.h) sinkt unter die G1-Stehhöhe —
//     der Geist würde als Haufen am Boden liegen (Nutzer-Screenshot 2026-09-21)
//   ▸ sanityBad: der Sanitizer musste eingreifen (NaN-Frames gehalten oder
//     > 15 % der Frames bone-repariert) — der Versuch ist verdächtig
//   ▸ score: höher = besser; saubere Versuche schlagen immer kollabierte,
//     unter Gleichen zählt höchste hMax, dann hMin (am wenigsten eingefallen)
// Schwellen UNVERÄNDERT von der v2.28.1-Kollaps-Warnung übernommen
// (minimale Parameter für maximale Konsistenz).
export function ardyMotionQuality(motion, sanity, frameCount) {
  let hMin = Infinity, hMax = -Infinity;
  const h = motion && motion.h;
  if (h && h.length) {
    for (let i = 0; i < h.length; i++) {
      const v = h[i];
      if (Number.isFinite(v)) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
    }
  }
  if (!Number.isFinite(hMin) || !Number.isFinite(hMax)) { hMin = 0; hMax = 0; } // leer/NaN-Track = Kollaps
  const collapsed = hMax < 0.55 || hMin < 0.32;
  const fc = frameCount || 0;
  const sanityBad = !!sanity && fc > 0 &&
    (sanity.nanFrames > 0 || sanity.fixedFrames > fc * 0.15);
  const bad = collapsed || sanityBad;
  const score = (bad ? 0 : 1e9) + hMax * 1e3 + hMin;
  return { hMin, hMax, collapsed, sanityBad, bad, score };
}

// ═══ v2.28.5 — PHYSIK-GLÄTTUNG DER ARDY-REFERENZ ═══
// Messbefund (scripts/ardy/ardy_robot_diag.mjs, echtes fp32-Modell → echte
// G1-Sim): ARDY-Timelines enthalten Gelenkwinkel-Raten bis 63 rad/s
// (GLB-Referenz: 5 rad/s) und Blick-Ruckler von ±178° (Hüft-Sway-Nulldurch-
// gang im Yaw-Messvektor). Eine Positionregelung kann das physikalisch NICHT
// nachfahren — die Policy kämpft gegen unerreichbare Ziele = „steht sich,
// schlägt um sich, springt, fällt". Der Filter macht die Referenz FAHRBAR,
// ohne die Bewegung sichtbar zu verändern:
//   1) q: Rate-Klemme (2 Pässe vor+rück, richtungssymmetrisch) + Zero-Phase-EMA
//      → keine Phasenverschiebung, keine Sprünge > rateMax rad/s
//   2) yaw: Unwrap → EMA → STRENGE Rate-Klemme (letzte Operation gewinnt)
//   3) h/root: Zero-Phase-EMA (Höhen-/Bahn-Zittern weg)
// Idempotent über motion.pf (Version-Marker, wird mitgepackt).
export const PHYS_FILTER_VERSION = 1;

function _zeroPhaseEMA(arr, perFrame, alpha) {
  const n = arr.length / perFrame;
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      for (let j = 0; j < perFrame; j++) {
        const a = arr[f * perFrame + j], b = arr[(f + 1) * perFrame + j];
        arr[(f + 1) * perFrame + j] = a + (b - a) * alpha;
      }
    }
  }
}

function _rateClamp(arr, perFrame, maxStep) {
  const n = arr.length / perFrame;
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      for (let j = 0; j < perFrame; j++) {
        const a = arr[f * perFrame + j], b = arr[(f + 1) * perFrame + j];
        const d = b - a;
        if (d > maxStep) arr[(f + 1) * perFrame + j] = a + maxStep;
        else if (d < -maxStep) arr[(f + 1) * perFrame + j] = a - maxStep;
      }
    }
  }
}

function _rateStats(arr, perFrame, dt) {
  const n = arr.length / perFrame;
  const rates = [];
  for (let f = 0; f < n - 1; f++) {
    let mx = 0;
    for (let j = 0; j < perFrame; j++) {
      const d = Math.abs(arr[(f + 1) * perFrame + j] - arr[f * perFrame + j]) / dt;
      if (d > mx) mx = d;
    }
    rates.push(mx);
  }
  rates.sort((a, b) => a - b);
  const pick = (p) => (rates.length ? rates[Math.min(rates.length - 1, Math.floor(p * rates.length))] : 0);
  return { p50: pick(0.5), p95: pick(0.95), max: rates.length ? rates[rates.length - 1] : 0 };
}

export function smoothMotionPhysics(motion, opts = {}) {
  const res = { changed: false, before: null, after: null, yawBefore: 0, yawAfter: 0 };
  if (!motion || !motion.q || !motion.n) return res;
  if ((motion.pf || 0) >= PHYS_FILTER_VERSION) return res; // schon gefiltert
  const n = motion.n;
  const nu = motion.nu || (motion.q.length / n);
  if (nu < 1 || n < 4 || motion.q.length !== n * nu) return res;
  const dt = 1 / (motion.fps || 20);
  const rateMax = opts.rateMax ?? 8;       // rad/s — oberhalb des GLB-niveaus
  const yawRateMax = opts.yawRateMax ?? 3; // rad/s — komfortable Gier-Tempo
  const ema = opts.ema ?? 0.7;             // MILDE Glättung — die Rate-Klemme
  // trägt die Sprünge; das EMA dämpft nur Mikro-Zittern (Periode < 0.3 s)
  // und lässt normale Gehen-Périoden (≥ 1 s) zu ≥ 90 % durch (gemessen).

  // ── q ──
  res.before = _rateStats(motion.q, nu, dt);
  _rateClamp(motion.q, nu, rateMax * dt);
  _zeroPhaseEMA(motion.q, nu, ema);
  _rateClamp(motion.q, nu, rateMax * dt); // EMA-Rest-Raten wieder an die Klemme
  res.after = _rateStats(motion.q, nu, dt);

  // ── yaw: Unwrap (±π-Sprünge), EMA, dann STRENGE Rate-Klemme ──
  if (motion.yaw && motion.yaw.length === n) {
    let jump = 0;
    for (let f = 1; f < n; f++) jump = Math.max(jump, Math.abs(motion.yaw[f] - motion.yaw[f - 1]));
    res.yawBefore = jump;
    const unw = new Float32Array(n);
    unw[0] = motion.yaw[0];
    for (let f = 1; f < n; f++) {
      let d = motion.yaw[f] - motion.yaw[f - 1];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      unw[f] = unw[f - 1] + d;
    }
    _zeroPhaseEMA(unw, 1, 0.5);
    _rateClamp(unw, 1, yawRateMax * dt);
    motion.yaw.set(unw);
    jump = 0;
    for (let f = 1; f < n; f++) jump = Math.max(jump, Math.abs(motion.yaw[f] - motion.yaw[f - 1]));
    res.yawAfter = jump;
  }

  // ── h + root ──
  if (motion.h && motion.h.length === n) _zeroPhaseEMA(motion.h, 1, 0.4);
  if (motion.root && motion.root.length === 2 * n) _zeroPhaseEMA(motion.root, 2, 0.5);

  motion.pf = PHYS_FILTER_VERSION;
  res.changed = true;
  return res;
}

// ═══ v2.28.5 — SKELETT-GRÖSSE AUF DEN ROBOTER FITTEN ═══
// Das grüne ARDY-Lehrer-Skelett (srcPos) läuft in MENSCHEN-Maßstab
// (~1,6 m Hüfthöhe-Plus), der G1-Geist ist kleiner — der Nutzer sieht
// „ein zu großes Skelett am Roboter". Diese Funktion skaliert srcPos
// UNIFORM so, dass die Frame-0-Hüfthöhe exakt auf die Ziel-Basishöhe
// (motion.h[0] = G1-Geist-Hüfte im ersten Frame) landet. Füße stehen
// durch die Boden-Garantie bei 0 — Skalierung bleibt geerdet (0·F = 0).
// Uniform = KnochenVERHÄLTNISSE bleiben, keine Verzerrung.
// Rückgabe: angewendeter Faktor (0 = nichts zu tun — schon passend/unsinnig).
export function fitSrcPosToRobot(motion, opts = {}) {
  if (!motion || !motion.srcPos || !motion.srcJoints || !motion.n || !motion.h || !motion.h.length) return 0;
  if (motion.srcRig) return 0; // v2.28.8: trägt bereits Roboter-Knochenlängen
  const n = motion.n, nR = motion.srcJoints.length;
  if (motion.srcPos.length !== 3 * n * nR) return 0;
  const target = motion.h[0];
  if (!Number.isFinite(target) || target < 0.1) return 0;
  // Hüfthöhe der srcPos: erster ENDLICHER Frame (Frame 0 kann NaN haben)
  let hi = motion.srcJoints.indexOf('hips');
  if (hi < 0) hi = 0;
  let srcH = 0;
  for (let f = 0; f < n; f++) {
    const z = motion.srcPos[(f * nR + hi) * 3 + 2];
    if (Number.isFinite(z) && z > 0.05) { srcH = z; break; }
  }
  if (!srcH) return 0;
  let F = target / srcH;
  if (opts.maxFactor) F = Math.min(opts.maxFactor, Math.max(1 / opts.maxFactor, F));
  if (Math.abs(F - 1) < 0.03) return 0; // passt schon (Idempotenz)
  for (let i = 0; i < motion.srcPos.length; i++) motion.srcPos[i] *= F;
  return F;
}
