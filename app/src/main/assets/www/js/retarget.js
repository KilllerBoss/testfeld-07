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
export const GHOST_ROLES = ['hips', 'spine', 'head', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];
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
  const bones = resolveBones(clip);
  const need = ['hips', 'leftUpLeg', 'leftLeg', 'rightUpLeg', 'rightLeg'];
  const missing = need.filter(k => bones[k] === undefined);
  if (missing.length) {
    const names = clip.nodes.map(n => n.name).filter(Boolean).slice(0, 12).join(', ');
    throw new Error('Skelett nicht erkannt (' + missing.join(', ') + ' fehlt). Gefundene Knoten: ' + names + ' …');
  }
  const roleNames = ROLE_ORDER.filter(r => bones[r] !== undefined);
  log(`Knochen erkannt: ${roleNames.length}/${ROLE_ORDER.length} (${roleNames.map(r => clip.nodes[bones[r]].name).join(', ')})`);

  // Namen der gelösten Knochen für sampleWorld (normalisiert kompatibel)
  const wanted = roleNames.map(r => clip.nodes[bones[r]].name);
  // Lehrer-Ghost: Rollen in fester Reihenfolge (nur vorhandene)
  const ghostRoles = GHOST_ROLES.filter(r => bones[r] !== undefined);

  const nu = sim.nu;
  const A = sim.actByName;
  // Gelenk-Weltachsen im Keyframe sammeln
  const axisOf = {};
  for (const name of sim.actName) {
    const aid = A[name];
    const jid = sim.actJoint[aid];
    axisOf[name] = jointWorldAxis(sim, jid, [0, 0, 0]);
  }
  const clampA = (name, v) => {
    const a = A[name];
    return Math.min(sim.actRange[2 * a + 1], Math.max(sim.actRange[2 * a], v));
  };

  // Achsen-Mapping GLB (Y-hoch, +Z-Blick) → MuJoCo (Z-hoch, +X-Blick):
  // X_glb→Y_mjc (lateral), Y_glb→Z_mjc (hoch), Z_glb→X_mjc (vorwärts)
  // = Rotation 120° um die Raumdiagonale (1,1,1): Quaternion [0.5,0.5,0.5,0.5]
  const ALIGN = [0.5, 0.5, 0.5, 0.5];
  const ALIGN_INV = [-0.5, -0.5, -0.5, 0.5];

  // „Brust“ = nächster Vorfahre der Arme — deren WELTrotation enthält die
  // komplette Oberkörperbeugung (Wirbelsäulen-Kette akkumuliert). Die G1-
  // Basis trägt diese Orientierung (inkl. Ruhepose-Beugung wie beim Zombie).
  const armNode = bones.leftArm !== undefined ? bones.leftArm
    : (bones.rightArm !== undefined ? bones.rightArm : undefined);
  let chestIdx = armNode !== undefined ? clip.parentOf.get(armNode) : undefined;
  if (chestIdx === undefined || chestIdx === bones.hips) chestIdx = bones.spine;
  if (chestIdx === undefined) chestIdx = bones.hips;

  const fps = Math.min(30, Math.max(15, clip.fpsHint));
  const n = Math.max(2, Math.round(clip.duration * fps));
  const q = new Float32Array(n * nu);
  const h = new Float32Array(n);

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
  const makeCal = (srcIdx, g1Body) => {
    const ar = quatMul2(ALIGN, computeRest(srcIdx), [0, 0, 0, 1]);
    const aligned = quatMul2(ar, ALIGN_INV, [0, 0, 0, 1]);
    return quatMul2(quatConj(aligned, [0, 0, 0, 1]), zeroQuat(g1Body), [0, 0, 0, 1]);
  };
  const CAL = {};
  for (const side of ['left', 'right']) {
    CAL[side] = {
      thigh: makeCal(bones[side + 'UpLeg'], bodyOfAct(side + '_hip_pitch_joint')),
      shin: makeCal(bones[side + 'Leg'], bodyOfAct(side + '_knee_joint')),
      foot: bones[side + 'Foot'] !== undefined ? makeCal(bones[side + 'Foot'], bodyOfAct(side + '_ankle_pitch_joint')) : qId,
      arm: bones[side + 'Arm'] !== undefined ? makeCal(bones[side + 'Arm'], sim.model.body_parentid[bodyOfAct(side + '_elbow_joint')]) : qId,
      fore: bones[side + 'ForeArm'] !== undefined ? makeCal(bones[side + 'ForeArm'], bodyOfAct(side + '_elbow_joint')) : qId,
    };
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
  for (const side of ['left', 'right']) {
    const elbow = bidOfAct(side + '_elbow_joint');
    const ankle = bidOfAct(side + '_ankle_pitch_joint');
    const hip = bidOfAct(side + '_hip_pitch_joint');
    const knee = bidOfAct(side + '_knee_joint');
    const upperArm = sim.model.body_parentid[elbow];
    G1B[side] = { hip, knee, ankle, elbow, upperArm, wrist: childBodyOf(elbow) };
    G1D0[side] = {
      thigh: dirBetween0(hip, knee),
      shin: dirBetween0(knee, ankle),
      arm: dirBetween0(upperArm, elbow),
      fore: G1B[side].wrist > 0 ? dirBetween0(elbow, G1B[side].wrist) : null,
    };
    G1X0[side] = { thigh: zeroQuat(hip), arm: zeroQuat(upperArm), foot: zeroQuat(ankle) };
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
  const g1StandH = sim._xpos[3 * sim.baseBody + 2];
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
    quatConj(worldMap.get(bones.hips) || qId, conjTmp);
    quatMul2(conjTmp, worldMap.get(chestIdx) || qId, alignedQ);
    quatMul2(ALIGN, alignedQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
    const waistName = 'waist_yaw_joint';
    q[off + A[waistName]] = project1(waistName, alignedQ);
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
    rawH[f] = Math.min(1.15, Math.max(0.4, hp[1] * scale * hScale));
    const wx = hp[2] * scale, wy = hp[0] * scale; // GLB(Z,X) → MuJoCo(X,Y)
    if (f === 0) { sx0 = wx; sy0 = wy; }
    root[2 * f] = wx - sx0;
    root[2 * f + 1] = wy - sy0;
    rotVec(worldMap.get(bones.hips) || qId, FWD_GLB, fwdTmp);
    rawYaw[f] = Math.atan2(fwdTmp[0], fwdTmp[1]); // MuJoCo: x=Z_glb, y=X_glb
    // Lehrer-Ghost-Positionen (GLB Y-up → MuJoCo Z-up, skaliert auf m)
    for (let gi = 0; gi < ghostRoles.length; gi++) {
      const p = worldPos.get(bones[ghostRoles[gi]]);
      const o3 = (f * ghostRoles.length + gi) * 3;
      if (!p) { srcPos[o3] = srcPos[o3 + 1] = srcPos[o3 + 2] = NaN; continue; }
      srcPos[o3] = p[2] * scale; srcPos[o3 + 1] = p[0] * scale; srcPos[o3 + 2] = p[1] * scale;
    }
  }

  // Yaw: Bei Locomotion (Bahn bewegt sich) ist die BEWEGUNGSRICHTUNG der
  // stabile Blick — die Hüft-Vorwärtsachse kippt beim Laufen stark mit
  // (Beckenrotation/Neigung). Bei Stillstand (Idle) liefert die Hüft-
  // Rotation die Blickrichtung. Danach unwrap + glätten + relativ zu Frame 0.
  {
    const SPEED_MIN = 0.15; // m/s — darunter gilt „keine Bewegung"
    const dirYaw = new Float32Array(n);
    let lastY = null;
    for (let f = 0; f < n; f++) {
      const p0 = Math.max(0, f - 1), p1 = Math.min(n - 1, f + 1);
      const dx = root[2 * p1] - root[2 * p0], dy = root[2 * p1 + 1] - root[2 * p0 + 1];
      const dt = Math.max(1e-6, (p1 - p0) / fps);
      if (Math.hypot(dx, dy) / dt > SPEED_MIN) { lastY = Math.atan2(dy, dx); dirYaw[f] = lastY; }
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
  }

  // ── PASS 2: Gelenk-IK am Geist-FK (Hüfte/Knie/Knöchel/Schulter/Ellbogen) ──
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
    const mkGoals = (f, side) => {
      const li = side === 'left' ? 0 : 4;
      const g = { hasThigh: false, hasShin: false, hasFoot: false, hasArm: false, hasFore: false,
        dThigh: [0, 0, 0], dShin: [0, 0, 0], dArm: [0, 0, 0], dFore: [0, 0, 0] };
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
    const seedChain = (off2, d0, dGoalW, jNames) => {
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
      for (let j = 0; j < 3; j++) q[off2 + A[jNames[j]]] = clampA(jNames[j], seed[j]);
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

    for (let f = 0; f < n; f++) {
      const off2 = f * nu;
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
          const hipNames = [side + '_hip_yaw_joint', side + '_hip_roll_joint', side + '_hip_pitch_joint'];
          if (G.hasThigh) seedChain(off2, G1D0[side].thigh, G.dThigh, hipNames);
          // ALTERNIEREND: Hüfte (nur Oberschenkel-Ziel) ↔ Knie (nur Schien-Ziel),
          // 2 Runden. Ein kombinierter Fehler funktioniert NICHT: Mit festem
          // Knie dreht eine Hüftbewegung Oberschenkel UND Schiene gleichmäßig →
          // 1,0·Δ − 0,8·Δ > 0 → die Hüfte friert ein. Getrennte Teilprobleme
          // sind je wohlkonditioniert und konvergieren im Wechsel zum Optimum.
          const hipEntries = [
            { name: side + '_hip_yaw_joint', aid: A[side + '_hip_yaw_joint'], anti: A[side + '_knee_joint'], antiName: side + '_knee_joint' },
            { name: side + '_hip_roll_joint', aid: A[side + '_hip_roll_joint'], anti: A[side + '_knee_joint'], antiName: side + '_knee_joint' },
            { name: side + '_hip_pitch_joint', aid: A[side + '_hip_pitch_joint'], anti: A[side + '_knee_joint'], antiName: side + '_knee_joint' },
          ];
          const kneeEntries = [side + '_knee_joint'].map(nm => ({ name: nm, aid: A[nm] }));
          // REINER Oberschenkel-Fehler für die Hüft-Züge: Die Anti-Züge (mit
          // Clamp-Rejekt) halten die Schiene raumfix, sodass die Hüfte die
          // Richtung optimal anfahren kann, ohne die Schiene zubeeinflussen.
          const thighErr = G.hasThigh ? () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            gposOf(bb.hip, pA); gposOf(bb.knee, pB);
            dirFromTo(pA, pB, dDisp);
            return angBetween(dDisp, G.dThigh);
          } : () => 0;
          const shinErr = G.hasShin ? () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            gposOf(bb.knee, pA); gposOf(bb.ankle, pB);
            dirFromTo(pA, pB, dDisp);
            return angBetween(dDisp, G.dShin);
          } : () => 0;
          // Kombiniert (nur für die Rettungsrunde)
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
          const entries = [side + '_ankle_pitch_joint', side + '_ankle_roll_joint']
            .map(nm => ({ name: nm, aid: A[nm] }));
          const errFn = () => {
            sim.setGhostPose(ghost, q, off2, rawH[f], 0, 0, 0, bq4);
            return oriErrOf(G.qFoot, bb.ankle);
          };
          descend(off2, errFn, entries, 8);
        }
        if (bones[side + 'Arm'] !== undefined) {
          {
            const shNames = [side + '_shoulder_pitch_joint', side + '_shoulder_roll_joint', side + '_shoulder_yaw_joint'];
            if (G.hasArm) {
              // Seed: [pitch, roll, yaw] — Rotvektor (X, Y, Z) → pitch=X, roll=Y, yaw=Z
              quatConj(bq4, tInv);
              rotVec(tInv, G.dArm, dBase);
              quatFromTwoVecs(G1D0[side].arm, dBase, qTmp);
              const ang = quatLogAxis(qTmp, axisTmp);
              const rvS = [axisTmp[0] * ang, axisTmp[1] * ang, axisTmp[2] * ang];
              const seedS = [rvS[0], rvS[1], rvS[2]]; // pitch←X, roll←Y, yaw←Z
              for (let j = 0; j < 3; j++) q[off2 + A[shNames[j]]] = clampA(shNames[j], seedS[j]);
            }
            // Arm ALTERNIEREND: Schulter (nur Oberarm-Ziel) ↔ Ellbogen
            // (nur Unterarm-Ziel), 2 Runden — gleiche Begründung wie beim Bein
            // (kombinierter Fehler = Barriere für die proximale Kette).
            const shEntries = [
              { name: side + '_shoulder_pitch_joint', aid: A[side + '_shoulder_pitch_joint'], anti: A[side + '_elbow_joint'], antiName: side + '_elbow_joint' },
              { name: side + '_shoulder_roll_joint', aid: A[side + '_shoulder_roll_joint'], anti: A[side + '_elbow_joint'], antiName: side + '_elbow_joint' },
              { name: side + '_shoulder_yaw_joint', aid: A[side + '_shoulder_yaw_joint'], anti: A[side + '_elbow_joint'], antiName: side + '_elbow_joint' },
            ];
            const elEntries = [side + '_elbow_joint'].map(nm => ({ name: nm, aid: A[nm] }));
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
            // Kombiniert (nur für die Rettungsrunde)
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
    }
  }

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
    h[f] = Math.min(1.15, Math.max(0.4, rawH[f] - lowest));
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
    h[f] = Math.min(1.15, Math.max(0.4, h[f] - lowest));
  }

  return {
    name: clip.name || 'clip',
    fps, n, nu,
    q, h,
    root, yaw, srcPos, srcJoints,
    baseQ, // Basis-Orientierung je Frame (n×4, xyzw) — Lehrer-Nick/Roll für den Geist
    scale, // Datei-Einheit → Meter (für den Original-Mesh-Wrap in render3d)
    mergedFrom: clip.mergedFrom || 0,
    mapped: roleNames,
    duration: clip.duration,
  };
}

// Fuß-Geoms mit ECHTER Tiefe: unterster Punkt je Geom im KÖRPER-Frame
// (Meshes: unterste Vertebra inkl. geom_quat; Kugel/Kapsel/Zylinder/Box: Formel)
function findFootGeoms(sim) {
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
