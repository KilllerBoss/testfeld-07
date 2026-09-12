// ═══════════════════════════════════════════════════════════
// retarget.js — GLB-Skelett → Unitree-G1-Gelenke.
// Methode (robust gegen abweichende Ruhelage des Quell-Skeletts):
//   1. Welt-Rotations-Delta je Knochen: ΔQ(t) = Q_welt(t) · Q_ruh⁻¹
//   2. globale Ausrichtung GLB(+Z Blick) → G1(+X Blick) dazwischen
//   3. Projektion auf die G1-Gelenkachsen: Einachser (Knie/Knöchel)
//      direkt über Achsen-Projektion; Hüfte (3 Achsen) per numerischer
//      Koordinaten-Abstiegs-Lösung gegen die Zielrotation.
//   4. Basis-Höhe aus Hüft-Translation (cm/m-Erkennung), dann
//      Boden-Anpassung: tiefsten Fußpunkt über Geister-Vorwärtslauf
//      anheben (offline, einmalig beim Import).
// Ergebnis: Referenz-Timeline q_ref (nu je Frame) + h_ref (Basis-Höhe).
// ═══════════════════════════════════════════════════════════

import { GlbClip, quatMul, quatRotInv } from './glb.js';

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
};
const ROLE_ORDER = ['hips', 'spine', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];

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
function rotVecByQuat(q, v, out) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = w * vx + y * vz - z * vy;
  const ty = w * vy + z * vx - x * vz;
  const tz = w * vz + x * vy - y * vx;
  const tw = -(x * vx + y * vy + z * vz);
  out[0] = tw * x + tx * w + ty * z - tz * y;
  out[1] = tw * y + ty * w + tz * x - tx * z;
  out[2] = tw * z + tz * w + tx * y - ty * x;
  return out;
}

// Welt-Achse eines MuJoCo-Gelenks (im Keyframe, d. h. Ruhepose)
function jointWorldAxis(sim, jid, out) {
  const mod = sim.model;
  const bid = mod.jnt_bodyid[jid];
  // jnt_axis ist im Rahmen des Kind-Körpers lokal
  const ax = [mod.jnt_axis[3 * jid], mod.jnt_axis[3 * jid + 1], mod.jnt_axis[3 * jid + 2]];
  const q = [sim._xquat[4 * bid], sim._xquat[4 * bid + 1], sim._xquat[4 * bid + 2], sim._xquat[4 * bid + 3]];
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

  // Ruhewelt-Quaternionen der Quell-Knochen (ohne Animation)
  // Rest-Welt-Rotationen: lokale Rest-Rotationen verketten
  const restQ = new Map();
  const computeRest = (idx) => {
    if (restQ.has(idx)) return restQ.get(idx);
    const n = clip.nodes[idx];
    const local = n.rotation ? n.rotation.slice() : [0, 0, 0, 1];
    const p = clip.parentOf.get(idx);
    const w = p === undefined ? local : quatMul2(computeRest(p), local, [0, 0, 0, 1]);
    restQ.set(idx, w);
    return w;
  };
  for (const role of roleNames) computeRest(bones[role]);

  const fps = Math.min(30, Math.max(15, clip.fpsHint));
  const n = Math.max(2, Math.round(clip.duration * fps));
  const q = new Float32Array(n * nu);
  const h = new Float32Array(n);

  const worldMap = new Map();
  const deltaQ = [0, 0, 0, 1];
  const alignedQ = [0, 0, 0, 1];
  const conjTmp = [0, 0, 0, 1];
  const axisTmp = [0, 0, 0];
  const qTmp = [0, 0, 0, 1];

  // Einzelachs-Gelenke: projizieren
  const project1 = (jointName, dq) => {
    const ang = quatLogAxis(dq, axisTmp);
    const a = axisOf[jointName];
    return clampA(jointName, ang * (axisTmp[0] * a[0] + axisTmp[1] * a[1] + axisTmp[2] * a[2]));
  };

  // 3-Achsen-Hüfte: numerischer Abstieg (yaw/roll/pitch-Jointnamen in Kettenreihenfolge)
  const solveHip = (joints, dq, out3) => {
    // Start: Achsenprojektion je Achse
    const th = out3;
    th[0] = th[1] = th[2] = 0;
    const errOf = () => {
      // q_est = R(a0,th0)·R(a1,th1)·R(a2,th2)  → Fehler gegen dq
      const qa = quatFromAxisAngle(axisOf[joints[0]], th[0], [0, 0, 0, 1]);
      const qb = quatFromAxisAngle(axisOf[joints[1]], th[1], [0, 0, 0, 1]);
      const qc = quatFromAxisAngle(axisOf[joints[2]], th[2], [0, 0, 0, 1]);
      const q1 = quatMul2(qa, qb, [0, 0, 0, 1]);
      const qe = quatMul2(q1, qc, [0, 0, 0, 1]);
      quatConj(qe, conjTmp);
      const d = quatMul2(dq, conjTmp, qTmp);
      // Fehler = |Achs-Winkel| des Restes
      return Math.abs(quatLogAxis(d, axisTmp)) * Math.hypot(axisTmp[0], axisTmp[1], axisTmp[2]);
    };
    let e = errOf();
    for (let it = 0; it < 12; it++) {
      let improved = false;
      for (let j = 0; j < 3; j++) {
        for (const step of [0.2, 0.05, 0.012]) {
          for (const dir of [1, -1]) {
            const old = th[j];
            th[j] = clampA(joints[j], old + dir * step);
            const e2 = errOf();
            if (e2 < e - 1e-5) { e = e2; improved = true; break; }
            th[j] = old;
          }
        }
      }
      if (!improved) break;
    }
    return th;
  };

  const hipCache = { left: [0, 0, 0], right: [0, 0, 0] };
  const hipJoints = (side) => [A[side + '_hip_yaw_joint'], A[side + '_hip_roll_joint'], A[side + '_hip_pitch_joint']];

  let hipsRestH = 0;
  {
    const p = [0, 0, 0];
    // Ruhetranslation des Hips-Knotens
    const n0 = clip.nodes[bones.hips];
    hipsRestH = (n0.translation ? n0.translation[1] : 80);
  }
  const scale = hipsRestH > 3 ? 0.01 : 1.0; // Mixamo cm → m
  const g1StandH = sim._xpos[3 * sim.baseBody + 2];
  const hScale = g1StandH / Math.max(0.2, hipsRestH * scale);

  const rawH = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const t = f / fps;
    clip.sampleWorld(t, wanted, worldMap);
    const off = f * nu;
    // Beine
    for (const side of ['left', 'right']) {
      const bIdx = bones[side + 'UpLeg'];
      const rest = restQ.get(bIdx);
      const wq = worldMap.get(bIdx) || rest;
      quatConj(rest, conjTmp);
      quatMul2(wq, conjTmp, deltaQ);
      quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ); // R·ΔQ·R⁻¹
      // Hüfte (3 Achsen: yaw, roll, pitch)
      const joints = hipJoints(side);
      // Ziel-Gelenknamen prüfen
      const th = solveHip(joints.map(jn => sim.actName[jn]), alignedQ, hipCache[side]);
      q[off + joints[0]] = clampA(sim.actName[joints[0]], th[0]);
      q[off + joints[1]] = clampA(sim.actName[joints[1]], th[1]);
      q[off + joints[2]] = clampA(sim.actName[joints[2]], th[2]);
      // Knie
      const legIdx = bones[side + 'Leg'];
      quatConj(restQ.get(legIdx), conjTmp);
      quatMul2(worldMap.get(legIdx) || restQ.get(legIdx), conjTmp, deltaQ);
      quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
      q[off + A[side + '_knee_joint']] = project1(side + '_knee_joint', alignedQ);
      // Knöchel (pitch/roll als Einachser-Projektionen)
      const footIdx = bones[side + 'Foot'];
      if (footIdx !== undefined) {
        quatConj(restQ.get(footIdx), conjTmp);
        quatMul2(worldMap.get(footIdx) || restQ.get(footIdx), conjTmp, deltaQ);
        quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
        q[off + A[side + '_ankle_pitch_joint']] = project1(side + '_ankle_pitch_joint', alignedQ);
        q[off + A[side + '_ankle_roll_joint']] = project1(side + '_ankle_roll_joint', alignedQ);
      }
    }
    // Oberkörper: Hüft-Delta → Taille (Gegenrotation, gedämpft)
    {
      quatConj(restQ.get(bones.hips), conjTmp);
      quatMul2(worldMap.get(bones.hips) || restQ.get(bones.hips), conjTmp, deltaQ);
      quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
      const ang = quatLogAxis(alignedQ, axisTmp);
      // Taille: nur um die Welt-Hochachse (Yaw-Anteil), gedämpft
      const waistName = 'waist_yaw_joint';
      const a = axisOf[waistName];
      q[off + A[waistName]] = clampA(waistName, 0.6 * ang * (axisTmp[0] * a[0] + axisTmp[1] * a[1] + axisTmp[2] * a[2]));
    }
    // Arme: Schulter-Pitch + Ellbogen (Projektionen, gedämpft)
    for (const side of ['left', 'right']) {
      const armIdx = bones[side + 'Arm'];
      if (armIdx === undefined) continue;
      quatConj(restQ.get(armIdx), conjTmp);
      quatMul2(worldMap.get(armIdx) || restQ.get(armIdx), conjTmp, deltaQ);
      quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
      const sp = side + '_shoulder_pitch_joint';
      q[off + A[sp]] = clampA(sp, 0.5 * project1(sp, alignedQ));
      const el = side + '_elbow_joint';
      const foreIdx = bones[side + 'ForeArm'];
      if (foreIdx !== undefined) {
        quatConj(restQ.get(foreIdx), conjTmp);
        quatMul2(worldMap.get(foreIdx) || restQ.get(foreIdx), conjTmp, deltaQ);
        quatMul2(ALIGN, deltaQ, qTmp); quatMul2(qTmp, ALIGN_INV, alignedQ);
        q[off + A[el]] = clampA(el, 0.6 * project1(el, alignedQ));
      }
    }
    // Basis-Höhe aus Hüft-Translation
    const hp = [0, 0, 0];
    clip._localTrans(bones.hips, t, hp);
    rawH[f] = Math.min(1.15, Math.max(0.4, hp[1] * scale * hScale));
  }

  // ── Boden-Anpassung (Fuß erden): tiefsten Fußpunkt pro Frame via Geist ──
  const ghost = sim.makeGhostData();
  for (let f = 0; f < n; f++) {
    const off = f * nu;
    sim.setGhostPose(ghost, q, off, rawH[f]);
    let lowest = 0;
    // Füße: Körper mit 'ankle' im Namen
    const footBodies = sim.footBodies || (sim.footBodies = findFootBodies(sim));
    for (const b of footBodies) {
      const z = ghost.xpos[3 * b + 2] - footGeomOffset(sim, b);
      if (z < lowest) lowest = z;
    }
    h[f] = Math.min(1.15, Math.max(0.4, rawH[f] - lowest));
  }
  // Höhe glätten (Burgen vermeiden)
  smooth(h, 5);

  return {
    name: clip.name || 'clip',
    fps, n, nu,
    q, h,
    mapped: roleNames,
    duration: clip.duration,
  };
}

function findFootBodies(sim) {
  const out = [];
  const m = sim.model;
  for (let b = 0; b < sim.nbody; b++) {
    const name = mjName(sim, b);
    if (name && /ankle|foot/i.test(name)) out.push(b);
  }
  return out;
}
function mjName(sim, b) {
  try { return sim._mjApi.mj_id2name(sim.model, 1, b); } catch (e) { return null; } // mjOBJ_BODY=1
}
function footGeomOffset(sim, b) {
  // unterster Geom-Punkt des Fuß-Körpers relativ zum Körperursprung (Z)
  const m = sim.model;
  let minZ = 0;
  for (let g = 0; g < sim.ngeom; g++) {
    if (m.geom_bodyid[g] !== b) continue;
    const type = m.geom_type[g];
    if (type === 7) { // mesh: grob über size/pos — Fallback: geom_pos.z
      minZ = Math.min(minZ, m.geom_pos[3 * g + 2]);
    } else {
      const pz = m.geom_pos[3 * g + 2];
      const sz = m.geom_size[3 * g + 2];
      minZ = Math.min(minZ, pz - (type === 6 ? sz : Math.max(sz, 0.01)));
    }
  }
  return minZ;
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
