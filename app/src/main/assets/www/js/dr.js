// ═══════════════════════════════════════════════════════════
// dr.js — DOMAIN RANDOMIZATION (v2.11.0, MASTER-PROMPT §10 „Pflicht")
//
// Die Policy soll nicht den EINEN perfekten Simulator auswendig lernen,
// sondern gegen die reale Welt generalisieren: Jede Trainings-Episode
// läuft in einer leicht anderen Physik. Randomisiert werden:
//
//   Masse + Trägheit   (Roboter-Teilbaum, homogen skaliert)
//   Motorstärke        (kp der Positions-Servos, gain+bias gemeinsam)
//   Reibung            (Gleitreibung Roboter-Geoms + Boden-Plane — MuJoCo
//                       kombiniert Kontaktreibung per max)
//   Gelenkdämpfung     (dof_damping aller Dofs)
//   Gravitation        (±% — fällt weich, wenn die Bindung sie nicht
//                       beschreibbar macht)
//   Startpose/-Tempo   (Gelenkrauschen um die Keyframe-Pose + Basis-
//                       Blickrichtung + Anfangsgeschwindigkeiten)
//   Sensorrauschen     (Gyro, projizierte Gravitation, Höhe — IMU-Realität)
//   Schübe             (zufällige Stör-Impulse während der Episode)
//   Aktions-Verzögerung(1–2 Regelzyklen ≈ 20–40 ms — echte Steuerkette)
//
// Design: KEINE Zustands-Objekte — drCfg ist ein unveränderliches SPEC.
// Die Anwendung passiert je Episode in task.reset() (gleicher Code in
// Haupt-Thread UND Sim-Workern → Parallel-Training randomisiert pro
// Worker unterschiedlich). Original-Modellwerte werden EINMAL je
// RobotSim geschnapshotet (_drOrig) und je Episode vom Original aus
// neu gewürfelt — Randomisierungen addieren sich nie auf.
// ═══════════════════════════════════════════════════════════

import { clamp } from './math.js';

export const DR_LEVELS = ['aus', 'leicht', 'mittel', 'stark'];

/** Stufen-Presets (MASTER-PROMPT §10/§11: kuratierbar, automatisch fortfahrbar). */
export const DR_PRESETS = {
  aus: {
    mass: 0, motor: 0, friction: 0, damping: 0, gravity: 0,
    pose: 0, vel: 0, sensor: 0,
    pushEvery: [0, 0], pushDv: [0, 0], delay: 0,
  },
  leicht: {
    mass: 0.05, motor: 0.10, friction: 0.12, damping: 0.10, gravity: 0.02,
    pose: 0.06, vel: 0.03, sensor: 0.005,
    pushEvery: [0, 0], pushDv: [0, 0], delay: 0,
  },
  mittel: {
    mass: 0.10, motor: 0.20, friction: 0.25, damping: 0.25, gravity: 0.05,
    pose: 0.12, vel: 0.06, sensor: 0.015,
    pushEvery: [100, 200], pushDv: [0.5, 1.5], delay: 1,
  },
  stark: {
    mass: 0.20, motor: 0.35, friction: 0.50, damping: 0.50, gravity: 0.10,
    pose: 0.22, vel: 0.12, sensor: 0.04,
    pushEvery: [60, 120], pushDv: [0.8, 2.5], delay: 2,
  },
};

/** Hart geklemmte Kopie (UI/KI/Worker-Eingaben können defekt sein). */
export function sanitizeDr(o) {
  const d = o && typeof o === 'object' ? o : {};
  const num = (v, lo, hi, dflt) => {
    const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
    return Number.isFinite(x) ? clamp(x, lo, hi) : dflt;
  };
  const out = {
    level: DR_LEVELS.includes(d.level) ? d.level : 'aus',
    mass: num(d.mass, 0, 0.5, 0),
    motor: num(d.motor, 0, 0.7, 0),
    friction: num(d.friction, 0, 1, 0),
    damping: num(d.damping, 0, 1, 0),
    gravity: num(d.gravity, 0, 0.25, 0),
    pose: num(d.pose, 0, 0.5, 0),
    vel: num(d.vel, 0, 0.3, 0),
    sensor: num(d.sensor, 0, 0.1, 0),
    delay: Math.round(num(d.delay, 0, 3, 0)),
  };
  const pe0 = num(Array.isArray(d.pushEvery) ? d.pushEvery[0] : 0, 0, 100000, 0);
  const pe1 = num(Array.isArray(d.pushEvery) ? d.pushEvery[1] : 0, 0, 100000, 0);
  out.pushEvery = [Math.min(pe0, pe1), Math.max(pe0, pe1)];
  const pd0 = num(Array.isArray(d.pushDv) ? d.pushDv[0] : 0, 0, 5, 0);
  const pd1 = num(Array.isArray(d.pushDv) ? d.pushDv[1] : 0, 0, 5, 0);
  out.pushDv = [Math.min(pd0, pd1), Math.max(pd0, pd1)];
  return out;
}

/** Spec einer Stufe frisch erzeugen (jeder Aufrufer bekommt sein Objekt). */
export function drFromLevel(level) {
  const l = DR_LEVELS.includes(level) ? level : 'aus';
  return sanitizeDr(Object.assign({ level: l }, DR_PRESETS[l]));
}

/** Dreiecksrauschen ∈ [−1, 1] (Summe zweier Uniformer — glockig genug). */
function tri(rng) {
  // WICHTIG: rng.next() als METHODE rufen (this.s!) — nicht entbunden.
  if (rng && typeof rng.next === 'function') return rng.next() + rng.next() - 1;
  return Math.random() + Math.random() - 1;
}

/**
 * Modell-Randomisierung: vom ERSTEN Aufruf geschnapshotete Originalwerte
 * je Episode neu überwürfeln. Nur Roboter-Bodies (sim._robotBody-Maske,
 * v2.9.0) — die Welt-Deko bleibt unberührt. Boden-Plane (type 0) zählt
 * als Kontaktpartner zur Reibung.
 */
export function applyDrModel(sim, dr, rng) {
  if (!sim || !sim.model || !dr) return false;
  const mod = sim.model;
  // ── Snapshot (einmal) ──
  if (!sim._drOrig) {
    const gm = sim.ngeom || mod.ngeom;
    const fr = new Float64Array(gm * 3);
    for (let g = 0; g < gm; g++) {
      fr[3 * g] = mod.geom_friction[3 * g];
      fr[3 * g + 1] = mod.geom_friction[3 * g + 1];
      fr[3 * g + 2] = mod.geom_friction[3 * g + 2];
    }
    sim._drOrig = {
      body_mass: Float64Array.from(mod.body_mass),
      body_inertia: Float64Array.from(mod.body_inertia),
      geom_friction: fr,
      dof_damping: Float64Array.from(mod.dof_damping),
      gainprm: Float64Array.from(mod.actuator_gainprm),
      biasprm: Float64Array.from(mod.actuator_biasprm),
      gravity: (() => { try { return Float64Array.from(mod.opt.gravity); } catch (e) { return null; } })(),
    };
  }
  const O = sim._drOrig;
  const robotBody = sim._robotBody;
  const nbody = sim.nbody || mod.nbody;
  // ── Masse + Trägheit (homogen je Body) ──
  if (dr.mass > 0) {
    for (let b = 0; b < nbody; b++) {
      if (robotBody && !robotBody[b]) continue;
      const f = 1 + dr.mass * tri(rng);
      mod.body_mass[b] = O.body_mass[b] * f;
      for (let i = 0; i < 3; i++) mod.body_inertia[3 * b + i] = O.body_inertia[3 * b + i] * f;
    }
    sim._totalMass = null; // Cache im Engine (pushRandom) verwerfen
  }
  // ── Reibung (Roboter-Geoms + Boden) ──
  if (dr.friction > 0) {
    const gm = sim.ngeom || mod.ngeom;
    for (let g = 0; g < gm; g++) {
      const body = mod.geom_bodyid[g];
      const isFloor = body === 0 && mod.geom_type[g] === 0; // Plane = Boden
      if (!isFloor && robotBody && !robotBody[body]) continue;
      mod.geom_friction[3 * g] = O.geom_friction[3 * g] * (1 + dr.friction * tri(rng));
    }
  }
  // ── Gelenkdämpfung ──
  if (dr.damping > 0) {
    const nv = sim.nv || mod.nv;
    for (let d = 0; d < nv; d++) {
      if (O.dof_damping[d] === 0) continue;
      mod.dof_damping[d] = O.dof_damping[d] * (1 + dr.damping * tri(rng));
    }
  }
  // ── Motorstärke (kp UND kv gemeinsam — Servo-Charakteristik bleibt) ──
  if (dr.motor > 0) {
    const nu = sim.nu || mod.nu;
    for (let a = 0; a < nu; a++) {
      const f = 1 + dr.motor * tri(rng);
      mod.actuator_gainprm[3 * a] = O.gainprm[3 * a] * f;
      mod.actuator_biasprm[3 * a + 1] = O.biasprm[3 * a + 1] * f;
      mod.actuator_biasprm[3 * a + 2] = O.biasprm[3 * a + 2] * f;
    }
  }
  // ── Gravitation (optional hart, wenn die Bindung schreibbar ist) ──
  if (dr.gravity > 0 && O.gravity) {
    try { mod.opt.gravity[2] = O.gravity[2] * (1 + dr.gravity * tri(rng)); } catch (e) { /* nicht schreibbar */ }
  }
  return true;
}

/** Original-Modellwerte zurücksetzen (Reset-Button, Policy-Modus „sauber"). */
export function restoreDrModel(sim) {
  if (!sim || !sim.model || !sim._drOrig) return false;
  const mod = sim.model, O = sim._drOrig;
  mod.body_mass.set(O.body_mass);
  mod.body_inertia.set(O.body_inertia);
  mod.geom_friction.set(O.geom_friction);
  mod.dof_damping.set(O.dof_damping);
  mod.actuator_gainprm.set(O.gainprm);
  mod.actuator_biasprm.set(O.biasprm);
  if (O.gravity) { try { mod.opt.gravity.set(O.gravity); } catch (e) { /* egal */ } }
  sim._totalMass = null;
  return true;
}

/**
 * Startzustand-Randomisierung (NACH dem Keyframe-Reset rufen):
 * Gelenkrauschen (in qpos UND ctrl — sonst schlagen die Servos beim
 * ersten Schritt zu), zufällige Blickrichtung, Anfangstempo.
 */
export function applyDrStart(sim, dr, rng) {
  if (!sim || !dr) return false;
  const nu = sim.nu;
  if (dr.pose > 0) {
    for (let a = 0; a < nu; a++) {
      const lo = sim.actRange ? sim.actRange[2 * a] : -2, hi = sim.actRange ? sim.actRange[2 * a + 1] : 2;
      const v = clamp(sim.keyCtrl[a] + dr.pose * tri(rng), lo, hi);
      sim._qpos[sim.actQposAdr[a]] = v;
      sim.ctrl[a] = v;
    }
  }
  const adr = sim._baseQposAdrOf ? sim._baseQposAdrOf() : null;
  if (adr != null && dr.pose > 0) {
    // ZUSÄTZLICHE Gier-Rotation um Welt-Z: q_neu = q_yaw ⊗ q_alt.
    // WICHTIG (v2.11.0-Regression aus ui_v290): die aktuelle LAGE bleibt
    // erhalten — liegend bleibt liegend („Liegen lassen"-Flows starten
    // Episoden aus der Bodenlage), aufrecht bekommt nur eine neue
    // Blickrichtung. (Erste Version ERSATZTE das Quaternion durch reines
    // Yaw und richtete liegende Roboter stumm wieder auf.)
    const qw0 = sim._qpos[adr + 3], qx0 = sim._qpos[adr + 4], qy0 = sim._qpos[adr + 5], qz0 = sim._qpos[adr + 6];
    if (Number.isFinite(qw0 + qx0 + qy0 + qz0)) {
      const yaw = (rng && rng.next ? rng.next() : Math.random()) * 2 * Math.PI;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
      // q_yaw = (cy, 0, 0, sy); Hamilton-Produkt q_yaw ⊗ q0:
      const nw = cy * qw0 - sy * qz0;
      const nx = cy * qx0 + sy * qy0;
      const ny = cy * qy0 - sy * qx0;
      const nz = cy * qz0 + sy * qw0;
      const n = Math.hypot(nw, nx, ny, nz) || 1;
      sim._qpos[adr + 3] = nw / n; sim._qpos[adr + 4] = nx / n;
      sim._qpos[adr + 5] = ny / n; sim._qpos[adr + 6] = nz / n;
    }
  }
  if (dr.vel > 0) {
    const dadr = sim._baseDofAdrOf ? sim._baseDofAdrOf() : 0;
    for (let i = 0; i < 3; i++) sim._qvel[dadr + i] = dr.vel * tri(rng);
    for (let i = 3; i < 6; i++) sim._qvel[dadr + i] = dr.vel * 0.5 * tri(rng);
  }
  try { sim._mjApi.mj_forward(sim.model, sim.data); } catch (e) { /* egal */ }
  // Gelenkrauschen kann beim Liegenden ein paar mm in den Boden reichen —
  // settleAboveGround hebt NUR an (Abwurf/Liegend-Starts bleiben sicher).
  try { if (sim.settleAboveGround) sim.settleAboveGround(); } catch (e) { /* egal */ }
  return true;
}

/** Ein Sensorrauschen-Wert (σ skaliert auf den Kanaltyp). */
export function drSensor(rng, sigma) { return sigma * tri(rng); }

/**
 * Schubs-Zeitplan: liefert Δv (m/s) wenn JETZT geschubst werden soll, sonst 0.
 * _nextPush ist ein Schritt-Zähler der Aufgabe (je Regelzyklus −1).
 */
export function drPushDue(task, rng) {
  const dr = task._dr;
  if (!dr || dr.pushEvery[1] <= 0) return 0;
  if (task._nextPush === undefined || task._nextPush === null) {
    task._nextPush = _randInt(rng, dr.pushEvery[0], dr.pushEvery[1]);
    return 0;
  }
  if (--task._nextPush > 0) return 0;
  task._nextPush = _randInt(rng, dr.pushEvery[0], dr.pushEvery[1]);
  return dr.pushDv[0] + (dr.pushDv[1] - dr.pushDv[0]) * (rng && rng.next ? rng.next() : Math.random());
}

function _randInt(rng, lo, hi) {
  if (hi <= lo) return Math.max(0, lo | 0);
  const r = rng && typeof rng.next === 'function' ? rng.next() : Math.random();
  return (lo + Math.floor(r * (hi - lo + 1))) | 0;
}

/**
 * Aktions-Verzögerung: Ring der letzten (delay+1) Aktionen — geliefert
 * wird die um `delay` Zyklen alte Aktion (Steuerketten-Realität).
 */
export function drDelayedAct(task, act) {
  const d = task._dr ? (task._dr.delay | 0) : 0;
  if (!d) return act;
  if (!task._dlyBuf) task._dlyBuf = [];
  task._dlyBuf.push(Float32Array.from(act));
  if (task._dlyBuf.length > d + 1) task._dlyBuf.shift();
  return task._dlyBuf[0];
}

/** Aufgabe-Rückbau: DR-Felder entfernen (Aufgabenwechsel). */
export function drDetach(task) {
  if (!task) return;
  task._dr = null;
  task._nextPush = null;
  task._dlyBuf = null;
}
