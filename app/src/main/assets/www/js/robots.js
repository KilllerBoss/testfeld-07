// ═══════════════════════════════════════════════════════════
// robots.js — Die Roboter: gleichberechtigt, ungebunden,
// mit einheitlicher Steuerung (Stick = fahren/drehen, Drohne zusätzlich Höhe)
// und Trainingsaufgaben (PPO). Modelle: MuJoCo Menagerie + Microduck
// (Pollen Robotics / Hugging Face, Apache-2.0).
// v2.7.0 — SENSORIK: Alle Laufroboter sehen GYRO (IMU), projizierte
//   Gravitation, Basis-Höhe, FUSSKONTAKTE (Kontaktmonitor) und eine
//   PHASEN-UHR (sin/cos — Zeitgefühl für Rhythmus) in der Beobachtung.
// ═══════════════════════════════════════════════════════════

import { clamp } from './math.js';
import { sanitizeDr, applyDrModel, applyDrStart, drSensor, drPushDue, drDelayedAct } from './dr.js';

// Drohnen-Schweben-Belohnung: KI-anpassbar (KI-Trainer).
export const HOVER_R = {
  alt: 0.3, vel: 0.2, tilt: 0.1, vz: 0.3, base: 0.02, energy: 0.0001,
  zMin: 0.1, upMin: 0.4, xyMax: 12,
};

// ── Gemeinsame Gait-Baugruppen ──────────────────────────────

// Trott-Gang für Vierbeiner (A1 & Spot): Ellipsen-CPG — Oberschenkel sin,
// Knie cos. Geschlossene Fußbahn = konstante Fahrtrichtung (empirisch
// verifiziert: stabil über 6 s, ~0,7 m/s). Rückwärtsziehen wirkt als Bremse;
// echtes Rückwärtsgehen lernt die Policy im Trainingsmodus.
function makeTrot(cfg) {
  return {
    ph: 0,
    step(sim, dt, cmd, out) {
      const c = cfg.trot;
      const vx = cmd.vx, yaw = cmd.yaw;
      const moving = Math.abs(vx) > 0.05 || Math.abs(yaw) > 0.1;
      const f = moving ? (c.f0 + c.fv * Math.min(1, Math.abs(vx) / cfg.speedMax) + c.fy * Math.abs(yaw) / cfg.yawMax) : 0;
      this.ph = moving ? (this.ph + 2 * Math.PI * f * dt) : 0;
      const ph = this.ph;
      const frac = clamp(vx / cfg.speedMax, -1, 1);
      // Amplituden (nur Vorwärtsanteil treibt an; Ziehen nach hinten bremst)
      const A = c.aSwing * Math.max(0, frac) + c.aTurn * 0.5 * Math.min(1, Math.abs(yaw) / cfg.yawMax);
      const B = c.aLift * Math.min(1, Math.max(Math.max(0, frac), Math.abs(yaw) / cfg.yawMax));
      for (let i = 0; i < 4; i++) {
        const leg = cfg.legs[i];
        const phL = ph + leg.phase;
        const turnBias = c.turnBias * yaw * leg.lr;
        const thigh = c.thigh0 + A * Math.sin(phL) - turnBias;
        const calf = c.calf0 + B * Math.cos(phL);
        const hip = c.hip0 - c.aHip * yaw * leg.lr * 0.35;
        out[leg.hip] = hip; out[leg.thigh] = thigh; out[leg.calf] = calf;
      }
    }
  };
}

// Schreit-Gang für G1 (Biped): stabiler Stand + vorsichtiger Shuffle.
// Ehrlich: offene Positions-Regler gehen nur kurze Strecken — echtes
// Laufwerk lernt die Policy im Training (dafür ist Trainrobot da).
function makeMarch(cfg) {
  return {
    ph: 0,
    step(sim, dt, cmd, out) {
      const c = cfg.march;
      const vx = cmd.vx, yaw = cmd.yaw;
      const moving = Math.abs(vx) > 0.05 || Math.abs(yaw) > 0.1;
      const f = moving ? (c.f0 + c.fv * Math.abs(vx)) : 0;
      this.ph = moving ? (this.ph + 2 * Math.PI * f * dt) : 0;
      const ph = this.ph;
      const mov = moving ? 1 : 0;
      const swing = c.aSwing * clamp(vx / cfg.speedMax, -1, 1);
      // Fuß flach: ankle = −(hip + knee)
      const ankle0 = -(c.hipPitch0 + c.knee0);
      const legs = [['left', 0], ['right', Math.PI]];
      for (const [side, p0] of legs) {
        const s = Math.sin(ph + p0);
        out[c.act(side, 'hip_pitch')] = c.hipPitch0 + swing * s;
        out[c.act(side, 'knee')] = c.knee0 + mov * c.aKnee * Math.max(0, Math.sin(ph + p0 + 0.4));
        out[c.act(side, 'ankle_pitch')] = ankle0 - 0.7 * swing * s * 0.5 + mov * c.push * Math.max(0, -s);
        out[c.act(side, 'hip_roll')] = (side === 'left' ? 1 : -1) * c.sway * mov * Math.sin(ph);
        out[c.act(side, 'hip_yaw')] = c.turnYaw * yaw * (side === 'left' ? 1 : -1);
      }
      // Arme bleiben in der Stand-Pose (Keyframe), Oberkörper gerade
    }
  };
}

// Flugregler für Skydio X2: Kaskade (Höhe → Neigung → Rotoren-Mix)
function makeFlight(cfg) {
  return {
    init(sim) {
      // Basis-Masse = Nutzmasse (Keyframe-Hover bestätigt: 4×3,2496 N ≈ m·g);
      // statische Deko-Bodies zählen nicht.
      const m = sim.model;
      const mass = m.body_mass[sim.baseBody];
      this.mass = mass;
      this.hoverT = mass * 9.81;
      // Rotor-Positionen (Sites) und Drehsinn (gear[5]); Site-ID steht in trnid-Spalte 0
      this.rotors = [];
      for (let a = 0; a < sim.nu; a++) {
        const sid = m.actuator_trnid[2 * a];
        const px = m.site_pos[3 * sid], py = m.site_pos[3 * sid + 1];
        const spin = m.actuator_gear[6 * a + 5] >= 0 ? 1 : -1;
        this.rotors.push({ fb: px >= 0 ? 1 : -1, lr: py >= 0 ? 1 : -1, spin });
      }
    },
    step(sim, dt, cmd, out) {
      const k = cfg.flight;
      const tmp = this._t || (this._t = new Float64Array(3));
      sim.baseQuat(this._q || (this._q = new Float64Array(4)));
      const q = this._q;
      sim.baseVelWorld(this._vw || (this._vw = new Float64Array(3)));
      sim.baseAngVelBody(this._w || (this._w = new Float64Array(3)));
      // Basis-Höhe und -Neigung
      sim.basePos(this._p || (this._p = new Float64Array(3)));
      const z = this._p[2];
      const w = q[0], x = q[1], y = q[2];
      const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
      const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
      const yawRate = this._w[2];

      // Körperfremde Horizontalgeschwindigkeit in Fahrrichtung (Nase)
      const cy = Math.cos(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)));
      const sy = Math.sin(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)));
      const vxFwd = cy * this._vw[0] + sy * this._vw[1];

      // Außenregelung
      const vzDes = cmd.climb * k.vzMax;
      const zErr = cmd.alt !== undefined ? (cmd.alt - z) : 0;
      const pitchDes = clamp(k.kVx * (cmd.vx - vxFwd), -k.tiltMax, k.tiltMax);
      const rollDes = 0;
      // Höhen-Kompensation: geneigter Schub senkt den Vertikalanteil → dagegen regeln
      const tilt = Math.max(0.45, Math.cos(pitch) * Math.cos(roll));
      const thrust = (this.hoverT * (1 + k.kZ * zErr) + k.kVz * (vzDes - this._vw[2])) / tilt;
      // Innenregelung (Winkel + Drehrate)
      const tqPitch = clamp(k.kPitch * (pitchDes - pitch) - k.kD * this._w[0], -k.tqMax, k.tqMax);
      const tqRoll = clamp(k.kRoll * (rollDes - roll) - k.kD * this._w[1], -k.tqMax, k.tqMax);
      const tqYaw = clamp(k.kYaw * (cmd.yaw - yawRate), -k.tqMax, k.tqMax);

      // Rotoren-Mix (über Aktuator-Namen → einheitliche Map)
      for (let a = 0; a < sim.nu; a++) {
        const r = this.rotors[a];
        out[sim.actName[a]] = thrust / sim.nu
          - r.fb * k.mix * tqPitch   // Nase runter = vorwärts
          + r.lr * k.mix * tqRoll
          + r.spin * k.mixY * tqYaw;
      }
    }
  };
}

// Watschel-Gang für Microduck (Biped, 14 Servos, kp=0.55): Basis = STAND-
// Keyframe, kleine Oszillationen um Hüfte/Sprunggelenk + Seitwärts-Wippen.
// Ehrlich wie beim G1: offene Positions-Regler watscheln nur kurze Strecken —
// echtes Laufwerk lernt die Policy im Training (dafür ist Trainrobot da).
// Vorzeichen sind je Seite gespiegelt (mirrored frames, wie im STAND-Keyframe:
// links hip_pitch −0,458 / rechts +0,458).
function makeWaddle(cfg) {
  return {
    ph: 0,
    _ref: null,
    step(sim, dt, cmd, out) {
      const c = cfg.waddle;
      const vx = cmd.vx, yaw = cmd.yaw;
      const moving = Math.abs(vx) > 0.02 || Math.abs(yaw) > 0.1;
      const f = moving ? c.f0 : 0;
      this.ph = moving ? (this.ph + 2 * Math.PI * f * dt) : 0;
      const ph = this.ph, mov = moving ? 1 : 0;
      if (!this._ref) { this._ref = new Float64Array(sim.nu); this._ref.set(sim.keyCtrl); }
      const ref = this._ref;
      const ai = (n) => sim.actByName[n];
      // Basis: komplette STAND-Pose (auch Kopf/Hals), dann Oszillationen
      for (let a = 0; a < sim.nu; a++) out[sim.actName[a]] = ref[a];
      const frac = clamp(vx / cfg.speedMax, -1, 1);
      const A = c.aPitch * Math.max(0.35, Math.abs(frac)) * mov;
      for (const [side, p0] of [['left', 0], ['right', Math.PI]]) {
        const s1 = Math.sin(ph + p0);
        const swing = c.swingSign * (side === 'left' ? 1 : -1) * A * s1;
        const kn = c.kneeSign * (side === 'left' ? 1 : -1) * c.aKnee * Math.max(0, Math.sin(ph + p0 + 0.6)) * mov;
        const sway = c.swaySign * (side === 'left' ? 1 : -1) * c.aSway * Math.sin(ph) * mov;
        const yawT = c.turnYaw * yaw * (side === 'left' ? 1 : -1) * mov;
        out[ai(side + '_hip_pitch')] = ref[ai(side + '_hip_pitch')] + swing;
        out[ai(side + '_knee')] = ref[ai(side + '_knee')] + kn;
        out[ai(side + '_ankle')] = ref[ai(side + '_ankle')] - swing * 0.85;
        out[ai(side + '_hip_roll')] = ref[ai(side + '_hip_roll')] + sway;
        out[ai(side + '_hip_yaw')] = ref[ai(side + '_hip_yaw')] + yawT;
      }
    }
  };
}

// ── Trainingsaufgabe: Geschwindigkeits-Tracking (Laufroboter) ──
// export: auch im Sim-Worker (parallel.js) im Einsatz — derselbe Code.
export function makeTrackTask(cfg) {
  const J = cfg.jointResidual;
  // v2.7.0 Sensorblock: gyro(3) + projizierte Gravitation(3) + Höhe(1)
  // + Fußkontakte(F) + Phasen-Uhr(2) — „voller Roboter“-Wahrnehmung
  const nFeet = Array.isArray(cfg.footBodies) ? cfg.footBodies.length : 0;
  const sensDim = 9 + nFeet;
  return {
    kind: 'speed', // v2.9.0: explizit (war undefined — „speed" wurde nur implizit angenommen)
    obsDim: 3 * cfg.nu + 8 + sensDim,
    actDim: cfg.nu,
    reset(rng, sim) {
      this.cmd = { vx: 0, yaw: 0 };
      this.stepsLeft = 0;
      this.lastAct = new Float64Array(cfg.nu);
      this.rpy = new Float64Array(3);
      this.up = new Float64Array(3);
      this.vb = new Float64Array(3);
      this._ref = new Float64Array(cfg.nu);
      this._tick = 0; // Phasen-Uhr
      this._curAct = new Float32Array(cfg.nu);
      this._nextPush = null; this._dlyBuf = null; // v2.11.0 DR-Zustand neu
      this._rng = (rng && typeof rng.next === 'function') ? rng : null; // Rausch-Quelle
      // Referenzpose = Keyframe-Reglerwerte (home/stand)
      for (let a = 0; a < cfg.nu; a++) this._ref[a] = sim.actCenter[a] * 0 + (sim.keyCtrl ? sim.keyCtrl[a] : 0);
      // ── v2.11.0 DOMAIN RANDOMIZATION — jede Episode andere Physik ──
      this._dr = cfg.dr ? sanitizeDr(cfg.dr) : null;
      if (this._dr && sim) {
        if (this._dr.mass + this._dr.motor + this._dr.friction + this._dr.damping + this._dr.gravity > 0) {
          applyDrModel(sim, this._dr, rng);
          // Masse-Basis für Schubs-Impulse: dieselbe Summe, die engine.pushImpulse
          // als Divisor nutzt (alle Bodies) — sonst stimmt Δv nicht exakt.
          this._drMass = 0;
          for (let b = 0; b < sim.nbody; b++) this._drMass += sim.model.body_mass[b];
        }
        if (this._dr.pose + this._dr.vel > 0) applyDrStart(sim, this._dr, rng);
      }
    },
    sampleCmd(rng) {
      const R = cfg.cmd;
      this.cmd.vx = rng.range(R.vx[0], R.vx[1]);
      this.cmd.yaw = rng.range(R.yaw[0], R.yaw[1]);
      if (rng.next() < 0.25) { this.cmd.vx = 0; this.cmd.yaw = 0; } // Pausen lernen stehen
      this.stepsLeft = rng.int(150) + 100;
    },
    observe(sim, out) {
      let o = 0;
      const q = this._q || (this._q = new Float64Array(cfg.nu));
      const dq = this._dq || (this._dq = new Float64Array(cfg.nu));
      sim.jointPositions(q); sim.jointVelocities(dq);
      for (let i = 0; i < cfg.nu; i++) out[o++] = q[i] - this._ref[i];
      for (let i = 0; i < cfg.nu; i++) out[o++] = dq[i];
      sim.baseQuat(this._bq || (this._bq = new Float64Array(4)));
      // Aufwärtsvektor statt vollem Quaternion → einfacher zu lernen
      const bq = this._bq, w = bq[0], x = bq[1], y = bq[2], z = bq[3];
      out[o++] = 2 * (x * z + w * y);
      out[o++] = 2 * (y * z - w * x);
      out[o++] = 1 - 2 * (x * x + y * y);
      // Yaw-Rate (Körper)
      out[o++] = sim._qvel[5];
      // Horizontale Geschwindigkeit in Fahrtrichtung (Nase)
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      sim.baseVelWorld(this._bv || (this._bv = new Float64Array(3)));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      out[o++] = c * this._bv[0] + s * this._bv[1];
      out[o++] = -s * this._bv[0] + c * this._bv[1];
      // Befehl
      out[o++] = this.cmd.vx; out[o++] = this.cmd.yaw;
      // letzte Aktion
      for (let i = 0; i < cfg.nu; i++) out[o++] = this.lastAct[i];
      // ── v2.7.0 SENSORBLOCK ──
      sim.gyroBody(this._gy || (this._gy = new Float64Array(3)));
      out[o++] = this._gy[0]; out[o++] = this._gy[1]; out[o++] = this._gy[2];
      sim.projectedGravity(this._pg || (this._pg = new Float64Array(3)));
      out[o++] = this._pg[0]; out[o++] = this._pg[1]; out[o++] = this._pg[2];
      sim.basePos(this._hp || (this._hp = new Float64Array(3)));
      out[o++] = this._hp[2];
      if (nFeet) {
        sim.footContacts(this._fc || (this._fc = new Float64Array(nFeet)));
        for (let f = 0; f < nFeet; f++) out[o++] = this._fc[f] ? 1 : 0;
      }
      // ── v2.11.0 SENSORRAUSCHEN (DR): IMU-Realität in die Kanäle ──
      if (this._dr && this._dr.sensor > 0) {
        const nR = this._rng || { next: Math.random };
        for (let k = o - 7; k < o; k++) out[k] += drSensor(nR, this._dr.sensor);
      }
      // Phasen-Uhr (Zeitgefühl): Takt der eigenen Gangart, sin/cos kodiert
      this._tick = (this._tick || 0) + 1;
      const ph = (this._tick * 0.02 * (cfg.gaitFreq || 1.2)) % 1;
      out[o++] = Math.sin(2 * Math.PI * ph);
      out[o++] = Math.cos(2 * Math.PI * ph);
      return o;
    },
    reward(sim) {
      const q = this._bq || (this._bq = new Float64Array(4));
      sim.baseQuat(q);
      const w = q[0], x = q[1], y = q[2], z = q[3];
      const upz = 1 - 2 * (x * x + y * y);
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      sim.baseVelWorld(this._bv || (this._bv = new Float64Array(3)));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const vFwd = c * this._bv[0] + s * this._bv[1];
      const yawRate = sim._qvel[5];
      let r = 0;
      r += -cfg.rW.vel * Math.abs(vFwd - this.cmd.vx);
      r += -cfg.rW.yaw * Math.abs(yawRate - this.cmd.yaw);
      r += cfg.rW.up * (upz - 0.7);
      r += cfg.rW.alive;
      // Aktionsaufwand & Rauigkeit
      let e = 0, d = 0;
      for (let i = 0; i < cfg.nu; i++) { e += this.lastAct[i] * this.lastAct[i]; d += this.lastAct[i]; }
      r += -cfg.rW.energy * e;
      // ── v2.11.0 Reward-Erweiterungen (MASTER-PROMPT §9, konfigurierbar) ──
      // action_smoothness_penalty: Ruckeln zwischen aufeinanderfolgenden
      // Aktionen bestrafen — ruhigere, physikalisch ausführbare Gaits.
      if (cfg.rW.smooth > 0 && this._curAct) {
        let sm = 0;
        for (let i = 0; i < cfg.nu; i++) { const dd = this._curAct[i] - this.lastAct[i]; sm += dd * dd; }
        r += -cfg.rW.smooth * sm;
      }
      // joint_limit_penalty: Überdehnung nahe der Anschlagsgrenzen (5 % Rand)
      if (cfg.rW.jlimit > 0) {
        const jq = this._jq || (this._jq = new Float64Array(cfg.nu));
        sim.jointPositions(jq);
        let jl = 0;
        for (let a = 0; a < cfg.nu; a++) {
          const lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
          const mrg = 0.05 * (hi - lo);
          if (jq[a] < lo + mrg) { const ex = lo + mrg - jq[a]; jl += ex * ex; }
          else if (jq[a] > hi - mrg) { const ex = jq[a] - (hi - mrg); jl += ex * ex; }
        }
        r += -cfg.rW.jlimit * jl;
      }
      // ── v2.11.0 DR-SCHÜBE: zufällige Stör-Impulse während der Episode ──
      if (this._dr && this._drMass > 0) {
        const dv = drPushDue(this, null);
        if (dv > 0) {
          const ang = Math.random() * 2 * Math.PI;
          const J = dv * this._drMass; // Impuls = Δv × Masse(divisor des Engine) → genau Δv m/s
          sim.pushImpulse(Math.cos(ang) * J, Math.sin(ang) * J, 0);
        }
      }
      sim.basePos(this._bp || (this._bp = new Float64Array(3)));
      // Abbruch bei Sturz
      const done = upz < cfg.done.upMin || this._bp[2] < cfg.done.zMin || this._bp[2] > cfg.done.zMax;
      // fall_penalty: einmaliger Malus NUR beim echten Sturz (nicht bei
      // Höhen-Maximum) — hilft der Wertfunktion, Stürze vorherzusehen.
      if (done && cfg.rW.fall > 0 && (upz < cfg.done.upMin || this._bp[2] < cfg.done.zMin)) r -= cfg.rW.fall;
      return { r, done };
    },
    actionToCtrl(sim, act) {
      // v2.11.0 DR-Aktionsverzögerung (Steuerketten-Realität, §15): bei
      // delay > 0 wird die um delay Zyklen ALTE Aktion ausgeführt.
      const a2 = drDelayedAct(this, act);
      if (this._curAct) this._curAct.set(a2);
      // Rest-Aktion auf Keyframe-Pose (tanh-begrenzt)
      for (let a = 0; a < cfg.nu; a++) {
        sim.ctrl[a] = this._ref[a] + cfg.actSpan * Math.tanh(a2[a] * J);
      }
    }
  };
}

// Trainingsaufgabe Drohne: Schweben + Höhe + Vorwärts
function makeHoverTask(cfg) {
  return {
    obsDim: 15, actDim: 4,
    reset(rng) {
      this.cmd = { vx: 0, alt: 0.6, climb: 0 };
      this.stepsLeft = 0;
      this.lastAct = new Float64Array(4);
      this._q = new Float64Array(4); this._p = new Float64Array(3); this._v = new Float64Array(3); this._w = new Float64Array(3);
    },
    sampleCmd(rng) {
      const R = cfg.cmd;
      this.cmd.alt = rng.range(R.alt[0], R.alt[1]);
      this.cmd.vx = rng.range(R.vx[0], R.vx[1]);
      this.stepsLeft = rng.int(120) + 80;
    },
    observe(sim, out) {
      let o = 0;
      sim.baseQuat(this._q); sim.basePos(this._p); sim.baseVelWorld(this._v); sim.baseAngVelBody(this._w);
      const q = this._q, w = q[0], x = q[1], y = q[2], z = q[3];
      out[o++] = 2 * (x * z + w * y); // up x
      out[o++] = 2 * (y * z - w * x); // up y
      out[o++] = 1 - 2 * (x * x + y * y); // up z
      for (let i = 0; i < 3; i++) out[o++] = this._w[i];
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      out[o++] = c * this._v[0] + s * this._v[1]; // vorwärts
      out[o++] = this._v[2];                       // vertikal
      out[o++] = this._p[2];                       // Höhe
      out[o++] = this.cmd.alt; out[o++] = this.cmd.vx;
      for (let i = 0; i < 4; i++) out[o++] = this.lastAct[i];
      return o;
    },
    reward(sim) {
      sim.baseQuat(this._q); sim.basePos(this._p); sim.baseVelWorld(this._v);
      const q = this._q, w = q[0], x = q[1], y = q[2], z = q[3];
      const upz = 1 - 2 * (x * x + y * y);
      const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
      const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const vFwd = c * this._v[0] + s * this._v[1];
      let r = 0;
      r += -HOVER_R.alt * Math.abs(this._p[2] - this.cmd.alt);
      r += -HOVER_R.vel * Math.abs(vFwd - this.cmd.vx);
      r += -HOVER_R.tilt * (Math.abs(pitch) + Math.abs(roll));
      r += -HOVER_R.vz * Math.abs(this._v[2]);
      r += HOVER_R.base;
      let e = 0; for (let i = 0; i < 4; i++) e += this.lastAct[i] * this.lastAct[i];
      r += -HOVER_R.energy * e;
      const done = this._p[2] < HOVER_R.zMin || upz < HOVER_R.upMin || Math.abs(this._p[0]) > HOVER_R.xyMax || Math.abs(this._p[1]) > HOVER_R.xyMax;
      return { r, done };
    },
    actionToCtrl(sim, act) {
      // Rest-Aktion um die Hover-Schubleistung
      const ref = sim.flightCtl ? sim.flightCtl.hoverT / sim.nu : 3.25;
      for (let a = 0; a < 4; a++) sim.ctrl[a] = ref + cfg.actSpan * Math.tanh(act[a] * cfg.jointResidual);
    }
  };
}

// ── Die vier Roboter ────────────────────────────────────────
// Alle gleichberechtigt (ungebunden) — dieselbe Stick-Steuerung.

const ROBOTS = {
  a1: {
    id: 'a1', dir: 'unitree_a1', scene: 'testfeld.xml', modelXml: 'a1.xml', keyName: 'home', keyIndex: 0,
    name: 'UNITREE A1', sub: 'Quadruped · 12 Akt.', longName: 'Unitree A1 (Menagerie)',
    color: '#ff9d21', dist: 2.4, zTarget: 0.30,
    speedMax: 1.2, yawMax: 1.6, timestep: 0.002,
    nActuators: 12,
    footBodies: ['FR_calf', 'FL_calf', 'RR_calf', 'RL_calf'],
    gaitFreq: 1.3,
    legs: [
      { hip: 'FR_hip', thigh: 'FR_thigh', calf: 'FR_calf', phase: Math.PI, lr: +1, side: +1 },
      { hip: 'FL_hip', thigh: 'FL_thigh', calf: 'FL_calf', phase: 0, lr: -1, side: -1 },
      { hip: 'RR_hip', thigh: 'RR_thigh', calf: 'RR_calf', phase: 0, lr: +1, side: +1 },
      { hip: 'RL_hip', thigh: 'RL_thigh', calf: 'RL_calf', phase: Math.PI, lr: -1, side: -1 },
    ],
    trot: { thigh0: 0.9, calf0: -1.8, hip0: 0, f0: 1.1, fv: 1.3, fy: 0.8, aSwing: 0.35, aLift: 0.42, aTurn: 0.2, aHip: 0.1, turnBias: 0.12 },
    gait: makeTrot,
    task: makeTrackTask,
    nu: 12, actSpan: 0.55, jointResidual: 1.0,
    cmd: { vx: [-0.6, 1.0], yaw: [-1.2, 1.2] },
    rW: { vel: 0.25, yaw: 0.06, up: 0.1, alive: 0.05, energy: 0.00015, smooth: 0.01, jlimit: 0.05, fall: 0 },
    dr: null, // Domain Randomization-Spec (main.js setzt je Stufe — v2.11.0)
    done: { upMin: 0.45, zMin: 0.12, zMax: 1.5 },
  },
  spot: {
    id: 'spot', dir: 'boston_dynamics_spot', scene: 'testfeld.xml', modelXml: 'spot.xml', keyName: 'home', keyIndex: 0,
    name: 'SPOT', sub: 'Quadruped · 12 Akt.', longName: 'Boston Dynamics Spot (Menagerie)',
    color: '#ffd21e', dist: 2.8, zTarget: 0.46,
    speedMax: 1.0, yawMax: 1.4, timestep: 0.002,
    nActuators: 12,
    footBodies: ['fr_lleg', 'fl_lleg', 'hr_lleg', 'hl_lleg'],
    gaitFreq: 1.3,
    legs: [
      { hip: 'fr_hx', thigh: 'fr_hy', calf: 'fr_kn', phase: Math.PI, lr: +1, side: +1 },
      { hip: 'fl_hx', thigh: 'fl_hy', calf: 'fl_kn', phase: 0, lr: -1, side: -1 },
      { hip: 'hr_hx', thigh: 'hr_hy', calf: 'hr_kn', phase: 0, lr: +1, side: +1 },
      { hip: 'hl_hx', thigh: 'hl_hy', calf: 'hl_kn', phase: Math.PI, lr: -1, side: -1 },
    ],
    trot: { thigh0: 1.04, calf0: -1.8, hip0: 0, f0: 1.1, fv: 1.3, fy: 0.8, aSwing: 0.33, aLift: 0.4, aTurn: 0.18, aHip: 0.08, turnBias: 0.1 },
    gait: makeTrot,
    task: makeTrackTask,
    nu: 12, actSpan: 0.5, jointResidual: 1.0,
    cmd: { vx: [-0.5, 0.9], yaw: [-1.0, 1.0] },
    rW: { vel: 0.25, yaw: 0.06, up: 0.1, alive: 0.05, energy: 0.00015, smooth: 0.01, jlimit: 0.05, fall: 0 },
    dr: null, // Domain Randomization-Spec (main.js setzt je Stufe — v2.11.0)
    done: { upMin: 0.45, zMin: 0.2, zMax: 1.8 },
  },
  g1: {
    id: 'g1', dir: 'unitree_g1', scene: 'testfeld.xml', modelXml: 'g1.xml', keyName: 'stand', keyIndex: 0,
    name: 'UNITREE G1', sub: 'Humanoid · 29 Akt.', longName: 'Unitree G1 (Menagerie)',
    color: '#38d6e0', dist: 3.4, zTarget: 0.75,
    speedMax: 0.5, yawMax: 1.0, timestep: 0.002,
    nActuators: 29,
    footBodies: ['left_ankle_roll_link', 'right_ankle_roll_link'],
    gaitFreq: 1.0,
    march: {
      hipPitch0: -0.15, knee0: 0.30, aKnee: 0.35, aSwing: 0.18,
      f0: 0.9, fv: 0.4, sway: 0.02, turnYaw: 0.18, push: 0.15,
      act(side, part) {
        if (side === 'waist_act') return 'waist_' + part + '_joint';
        return side + '_' + part + '_joint';
      },
    },
    gait: makeMarch,
    task: makeTrackTask,
    nu: 29, actSpan: 0.4, jointResidual: 1.0,
    cmd: { vx: [-0.3, 0.5], yaw: [-0.8, 0.8] },
    rW: { vel: 0.2, yaw: 0.05, up: 0.15, alive: 0.05, energy: 0.00012, smooth: 0.01, jlimit: 0.05, fall: 0 },
    dr: null,
    done: { upMin: 0.6, zMin: 0.35, zMax: 1.6 },
  },
  x2: {
    id: 'x2', dir: 'skydio_x2', scene: 'testfeld.xml', modelXml: 'x2.xml', keyName: 'hover', keyIndex: 0,
    name: 'SKYDIO X2', sub: 'Quadrocopter · 4 Rotoren', longName: 'Skydio X2 (Menagerie)',
    color: '#b6f09c', dist: 3.2, zTarget: 0.6,
    speedMax: 2.5, yawMax: 2.0, timestep: 0.01, ctrlDt: 0.01,
    nActuators: 4, drone: true,
    flight: { vzMax: 1.4, kZ: 1.2, kVz: 1.8, kVx: 0.22, tiltMax: 0.24, kPitch: 0.05, kRoll: 0.05, kYaw: 0.15, kD: 0.012, tqMax: 0.012, mix: 1.0, mixY: 0.6 },
    gait: makeFlight,
    task: makeHoverTask,
    nu: 4, actSpan: 4.0, jointResidual: 1.0,
    cmd: { vx: [-1.0, 1.5], alt: [0.4, 2.2] },
  },
  go2: {
    id: 'go2', dir: 'unitree_go2', scene: 'testfeld.xml', modelXml: 'go2.xml', keyName: 'home', keyIndex: 0,
    name: 'UNITREE GO2', sub: 'Quadruped · 12 Akt.', longName: 'Unitree Go2 (Menagerie)',
    color: '#7bd3ff', dist: 2.6, zTarget: 0.32,
    speedMax: 1.4, yawMax: 1.6, timestep: 0.002,
    nActuators: 12,
    footBodies: ['FR_calf', 'FL_calf', 'RR_calf', 'RL_calf'],
    gaitFreq: 1.3,
    legs: [
      { hip: 'FR_hip', thigh: 'FR_thigh', calf: 'FR_calf', phase: Math.PI, lr: +1, side: +1 },
      { hip: 'FL_hip', thigh: 'FL_thigh', calf: 'FL_calf', phase: 0, lr: -1, side: -1 },
      { hip: 'RR_hip', thigh: 'RR_thigh', calf: 'RR_calf', phase: 0, lr: +1, side: +1 },
      { hip: 'RL_hip', thigh: 'RL_thigh', calf: 'RL_calf', phase: Math.PI, lr: -1, side: -1 },
    ],
    trot: { thigh0: 0.9, calf0: -1.8, hip0: 0, f0: 1.2, fv: 1.3, fy: 0.8, aSwing: 0.35, aLift: 0.42, aTurn: 0.2, aHip: 0.1, turnBias: 0.12 },
    gait: makeTrot,
    task: makeTrackTask,
    nu: 12, actSpan: 0.55, jointResidual: 1.0,
    cmd: { vx: [-0.6, 1.1], yaw: [-1.2, 1.2] },
    rW: { vel: 0.25, yaw: 0.06, up: 0.1, alive: 0.05, energy: 0.00015, smooth: 0.01, jlimit: 0.05, fall: 0 },
    dr: null, // Domain Randomization-Spec (main.js setzt je Stufe — v2.11.0)
    done: { upMin: 0.45, zMin: 0.12, zMax: 1.5 },
  },
  duck: {
    id: 'duck', dir: 'pollen_microduck', scene: 'testfeld.xml', modelXml: 'microduck.xml', keyName: 'STAND', keyIndex: 1,
    name: 'MICRODUCK', sub: 'Biped · 14 Akt.', longName: 'Microduck (Pollen Robotics · Hugging Face)',
    color: '#ffe066', dist: 1.3, zTarget: 0.12,
    speedMax: 0.25, yawMax: 1.0, timestep: 0.002,
    nActuators: 14,
    footBodies: ['ankle_left', 'ankle_right'],
    gaitFreq: 2.2,
    waddle: {
      f0: 2.2, aPitch: 0.22, aKnee: 0.18, aSway: 0.10, turnYaw: 0.25,
      swingSign: -1, kneeSign: -1, swaySign: 1,
      act(side, part) { return side + '_' + part; },
    },
    gait: makeWaddle,
    task: makeTrackTask,
    nu: 14, actSpan: 0.35, jointResidual: 1.0,
    cmd: { vx: [-0.15, 0.3], yaw: [-0.8, 0.8] },
    rW: { vel: 0.25, yaw: 0.05, up: 0.12, alive: 0.06, energy: 0.0002, smooth: 0.01, jlimit: 0.05, fall: 0 },
    dr: null,
    done: { upMin: 0.45, zMin: 0.045, zMax: 0.45 },
  },
};

export const ROBOT_ORDER = ['a1', 'spot', 'g1', 'go2', 'duck', 'x2'];
export function getRobot(id) { return ROBOTS[id]; }
