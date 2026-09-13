// ═══════════════════════════════════════════════════════════
// motiontask.js — GLB-Bewegungs-Tracking (DeepMimic-lite) für den G1.
// Referenz: retargetete MotionClip-Timeline (q_ref, h_ref, Endlosschleife)
// + ROOT-MOTION: die Referenz-Bahn (x, y, yaw) läuft wirklich durchs Feld —
//   der Roboter folgt dem wandernden Lehrer statt „auf der Stelle" zu gehen.
// Reward = Posen-Ähnlichkeit (RMS) + Höhe + Bahn-Folgen (Abstand + Blick)
//   + Aufrecht, Abbruch bei Sturz oder verlorenem Kontakt zur Bahn.
// Beobachtungsraum: 3·nu + 12 (Pose-Fehler, Geschwindigkeiten, Orientierung,
//   Bahn-Fehler lokal, Referenz-Tempo, Phase) — Geschwindigkeits- und
//   Motion-Policies sind damit getrennt (obsDim unterscheidet sich).
// ═══════════════════════════════════════════════════════════

import { clamp } from './math.js';

// Motion-Tracking-Belohnung: von der KI (KI-Trainer) live anpassbar.
// pose: Posen-Ähnlichkeit, height: Höhen-Treue, root: Bahn-Folgen (Abstand
// zur Referenz-Wurzel), yaw: Blick-Treue, up: Aufrecht, base: Grundbetrag,
// energy: Aktionsaufwand; rootScale/yawScale: Toleranzen; upMin/hMin/hMax:
// Abbruch; rootDone: Abbruch-Abstand zur Bahn.
export const MOTION_R = {
  pose: 0.72, height: 0.2, root: 0.22, yaw: 0.06, up: 0.08, base: 0.03, energy: 0.00005,
  poseScale: 0.35, hScale: 0.09, rootScale: 0.35, yawScale: 0.8,
  upMin: 0.5, hMin: 0.55, hMax: 1.4, rootDone: 1.6,
};

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function makeMotionTask(cfg, clip, sim) {
  const nu = cfg.nu;
  const span = cfg.actSpan;
  const keyCtrl = sim ? sim.keyCtrl : new Float64Array(nu);
  const hasRoot = !!(clip.root && clip.yaw && clip.root.length >= 2 * clip.n && clip.yaw.length >= clip.n);
  return {
    kind: 'motion',
    clip,
    hasRoot,
    obsDim: 3 * nu + 12,
    actDim: nu,
    phase: 0,
    lastAct: new Float64Array(nu),
    _q: new Float64Array(nu),
    _dq: new Float64Array(nu),
    _bq: new Float64Array(4),
    _bv: new Float64Array(3),
    _ref: new Float64Array(nu),
    _refNext: new Float64Array(nu),
    _rr: [0, 0, 0],
    _p: new Float64Array(3),
    _loopX: 0, _loopY: 0, _loopYaw: 0,

    reset(rng, sim2) {
      this.phase = 0;
      this.tElapsed = 0;
      this.lastAct.fill(0);
      this._loopX = 0; this._loopY = 0; this._loopYaw = 0;
      // Roboter AUF die Referenz-Bahn setzen (nicht in den Ursprung)
      if (sim2 && hasRoot) {
        try { sim2.placeBase(clip.root[0], clip.root[1], clip.yaw[0] || 0); } catch (e) { /* Basis ohne freies Gelenk */ }
      }
    },

    // Referenzpose zur Phase (lineare Interpolation, Endlosschleife).
    // Sanfter Einstieg: erste 0,6 s von der Keyframe-Pose hineinblenden,
    // damit der Roboter nicht ruckartig in die Clip-Pose springt.
    sampleRef(phase, outQ, outH) {
      const c = clip;
      const t = (phase * c.fps) % c.n;
      const i0 = Math.floor(t), i1 = (i0 + 1) % c.n;
      const u = t - i0;
      const blend = Math.min(1, (this.tElapsed || 0) / 0.6);
      for (let j = 0; j < nu; j++) {
        const target = c.q[i0 * nu + j] * (1 - u) + c.q[i1 * nu + j] * u;
        outQ[j] = keyCtrl[j] * (1 - blend) + target * blend;
      }
      if (outH) {
        const ht = c.h[i0] * (1 - u) + c.h[i1] * u;
        outH[0] = 0.79 * (1 - blend) + ht * blend;
      }
    },

    // Referenz-Wurzel [x, y, yaw] zur Phase — inkl. Schleifen-Offset
    // (nach jedem Durchlauf läuft die Bahn von der Endposition weiter)
    refRoot(phase, out) {
      if (!hasRoot) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      const c = clip;
      const t = (phase * c.fps) % c.n;
      const i0 = Math.floor(t), i1 = (i0 + 1) % c.n;
      const u = t - i0;
      out[0] = c.root[2 * i0] * (1 - u) + c.root[2 * i1] * u + this._loopX;
      out[1] = c.root[2 * i0 + 1] * (1 - u) + c.root[2 * i1 + 1] * u + this._loopY;
      out[2] = wrapAngle(c.yaw[i0] + wrapAngle(c.yaw[i1] - c.yaw[i0]) * u + this._loopYaw);
      return out;
    },

    // Momentanes Referenz-Tempo (m/s, horizontal)
    refSpeed(phase) {
      if (!hasRoot) return 0;
      const c = clip;
      const t = (phase * c.fps) % c.n;
      const i0 = Math.floor(t), i1 = (i0 + 1) % c.n;
      const dx = c.root[2 * i1] - c.root[2 * i0], dy = c.root[2 * i1 + 1] - c.root[2 * i0 + 1];
      return Math.hypot(dx, dy) * c.fps;
    },

    sampleCmd(rng) { /* Phase läuft autonom */ },

    observe(sim, out) {
      let o = 0;
      this.sampleRef(this.phase, this._ref, this._href || (this._href = [0.8]));
      sim.jointPositions(this._q);
      sim.jointVelocities(this._dq);
      for (let i = 0; i < nu; i++) out[o++] = this._q[i] - this._ref[i];
      for (let i = 0; i < nu; i++) out[o++] = this._dq[i];
      sim.baseQuat(this._bq);
      const bq = this._bq, w = bq[0], x = bq[1], y = bq[2], z = bq[3];
      out[o++] = 2 * (x * z + w * y);
      out[o++] = 2 * (y * z - w * x);
      out[o++] = 1 - 2 * (x * x + y * y);
      out[o++] = sim._qvel[5];
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      sim.baseVelWorld(this._bv);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      out[o++] = c * this._bv[0] + s * this._bv[1];
      out[o++] = -s * this._bv[0] + c * this._bv[1];
      // Bahn-Fehler (lokal zur Basis) + Referenz-Tempo — Root-Folgen lernen
      this.refRoot(this.phase, this._rr);
      sim.basePos(this._p);
      const dx = this._rr[0] - this._p[0], dy = this._rr[1] - this._p[1];
      out[o++] = c * dx + s * dy;
      out[o++] = -s * dx + c * dy;
      out[o++] = wrapAngle(this._rr[2] - yaw);
      out[o++] = this.refSpeed(this.phase);
      out[o++] = Math.sin(2 * Math.PI * this.phase);
      out[o++] = Math.cos(2 * Math.PI * this.phase);
      for (let i = 0; i < nu; i++) out[o++] = this.lastAct[i];
      return o;
    },

    // Beobachtung aus GEISTER-Daten (Kinematik, für Behavior Cloning)
    observeGhost(sim, ghost, out, phase) {
      let o = 0;
      const gq = ghost.qpos, gxq = ghost.xquat;
      this.sampleRef(phase, this._ref, this._href || (this._href = [0.8]));
      for (let i = 0; i < nu; i++) out[o++] = gq[sim.actQposAdr[i]] - this._ref[i];
      for (let i = 0; i < nu; i++) out[o++] = 0; // Geist hat keine Geschwindigkeit → 0
      const bb = 4 * sim.baseBody;
      const w = gxq[bb], x = gxq[bb + 1], y = gxq[bb + 2], z = gxq[bb + 3];
      out[o++] = 2 * (x * z + w * y);
      out[o++] = 2 * (y * z - w * x);
      out[o++] = 1 - 2 * (x * x + y * y);
      out[o++] = 0;
      out[o++] = 0; out[o++] = 0;
      out[o++] = 0; out[o++] = 0; out[o++] = 0; // Geist ist AUF der Bahn
      out[o++] = this.refSpeed(phase);
      out[o++] = Math.sin(2 * Math.PI * phase);
      out[o++] = Math.cos(2 * Math.PI * phase);
      for (let i = 0; i < nu; i++) out[o++] = 0;
      return o;
    },

    reward(sim) {
      // NaN-Wache: Physik-Explosion → Episode sauber beenden statt vergiften
      sim.jointPositions(this._q);
      let s = 0;
      for (let i = 0; i < nu; i++) s += Math.abs(this._q[i]);
      if (!Number.isFinite(s)) return { r: 0, done: true };
      const bq = this._bq;
      sim.baseQuat(bq);
      const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
      const upz = 1 - 2 * (x * x + y * y);
      this.sampleRef(this.phase, this._ref, this._href || (this._href = [0.8]));
      let sq = 0;
      for (let i = 0; i < nu; i++) { const d = (this._q[i] - this._ref[i]) / MOTION_R.poseScale; sq += d * d; }
      const eQ = Math.exp(-Math.sqrt(sq / nu));
      sim.basePos(this._p);
      const h = this._p[2];
      const eH = Math.exp(-Math.pow((h - this._href[0]) / MOTION_R.hScale, 2));
      // Bahn-Folgen: Abstand zur wandernden Referenz-Wurzel + Blick
      let eRoot = 1, eYaw = 1, dRoot = 0;
      if (hasRoot) {
        this.refRoot(this.phase, this._rr);
        const dx = this._rr[0] - this._p[0], dy = this._rr[1] - this._p[1];
        dRoot = Math.hypot(dx, dy);
        eRoot = Math.exp(-Math.pow(dRoot / MOTION_R.rootScale, 2));
        const yawBase = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        eYaw = Math.exp(-Math.pow(Math.abs(wrapAngle(this._rr[2] - yawBase)) / MOTION_R.yawScale, 2));
      }
      let e = 0;
      for (let i = 0; i < nu; i++) e += this.lastAct[i] * this.lastAct[i];
      const r = MOTION_R.pose * eQ + MOTION_R.height * eH
        + MOTION_R.root * eRoot + MOTION_R.yaw * eYaw
        + MOTION_R.up * clamp(upz, 0, 1) + MOTION_R.base - MOTION_R.energy * e;
      // Abbruch: Sturz ODER dauerhaft verloren von der Bahn (Eingangsphase geschont)
      const lostRoot = hasRoot && (this.tElapsed || 0) > 1.2 && dRoot > MOTION_R.rootDone;
      const done = upz < MOTION_R.upMin || h < MOTION_R.hMin * this._href[0] || h > MOTION_R.hMax || lostRoot;
      return { r, done };
    },

    advance(dt) {
      const old = this.phase;
      this.phase += dt * this.clip.fps / this.clip.n;
      this.phase %= 1;
      // Schleifen-Sprung: die Bahn läuft von der ENDPOSITION weiter
      // (Endlosgehen über die Arena statt Teleport zurück zum Start)
      if (this.phase < old && hasRoot && clip.n > 1) {
        const m = clip.n - 1;
        this._loopX += clip.root[2 * m] - clip.root[0];
        this._loopY += clip.root[2 * m + 1] - clip.root[1];
        this._loopYaw = wrapAngle(this._loopYaw + wrapAngle(clip.yaw[m] - clip.yaw[0]));
      }
      this.tElapsed = (this.tElapsed || 0) + dt;
    },

    actionToCtrl(sim, act) {
      // Rest-Aktion um die REFERENZ-Pose (nicht um das Keyframe)
      this.sampleRef(this.phase, this._ref, null);
      for (let a = 0; a < nu; a++) {
        sim.ctrl[a] = this._ref[a] + span * Math.tanh(act[a]);
      }
    },

    /**
     * BC-Datensatz aus dem kinematischen Geist erzeugen:
     * Zustand = Referenz-Selbst (mit Rauschen), Etikett = Aktion, die
     * q_ref(t+lead) trifft. Rein überwacht — keine Exploration nötig.
     */
    buildBCDataset(sim, noiseStd = 0.02) {
      const obsDim = this.obsDim, actDim = this.actDim;
      const nFrames = clip.n;
      const X = new Float32Array(nFrames * obsDim);
      const Y = new Float32Array(nFrames * actDim);
      const ghost = sim.makeGhostData();
      const tmpO = new Float64Array(obsDim);
      for (let f = 0; f < nFrames; f++) {
        if (hasRoot) {
          const bq = clip.baseQ ? clip.baseQ.subarray(4 * f, 4 * f + 4) : null;
          sim.setGhostPose(ghost, clip.q, f * nu, clip.h[f], clip.root[2 * f], clip.root[2 * f + 1], clip.yaw[f], bq);
        }
        else sim.setGhostPose(ghost, clip.q, f * nu, clip.h[f], 0, 0, 0, clip.baseQ ? clip.baseQ.subarray(4 * f, 4 * f + 4) : null);
        const phase = f / nFrames;
        this.observeGhost(sim, ghost, tmpO, phase);
        for (let i = 0; i < obsDim; i++) {
          X[f * obsDim + i] = tmpO[i] + (gauss() * noiseStd);
        }
        const f1 = (f + 1) % nFrames;
        for (let j = 0; j < actDim; j++) {
          const diff = clip.q[f1 * actDim + j] - clip.q[f * actDim + j];
          Y[f * actDim + j] = Math.atanh(clamp(diff / span, -0.95, 0.95));
        }
      }
      return { X, Y, n: nFrames };
    },
  };
}

// kleine Helfer
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
