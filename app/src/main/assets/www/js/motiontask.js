// ═══════════════════════════════════════════════════════════
// motiontask.js — GLB-Bewegungs-Tracking (DeepMimic-lite) für den G1.
// Referenz: retargetete MotionClip-Timeline (q_ref, h_ref, Endlosschleife).
// Ziel: Policy hält die Animation PHYSIKALISCH aufrecht — Reward =
// Posen-Ähnlichkeit (RMS) + Basis-Höhe + Aufrecht, Abbruch bei Sturz.
// Beobachtungsraum identisch zur Geschwindigkeitsaufgabe (3·nu + 8),
// daher passen Netzgröße und Speicherformat unverändert.
// ═══════════════════════════════════════════════════════════

import { clamp } from './math.js';

export function makeMotionTask(cfg, clip, sim) {
  const nu = cfg.nu;
  const span = cfg.actSpan;
  const keyCtrl = sim ? sim.keyCtrl : new Float64Array(nu);
  return {
    kind: 'motion',
    clip,
    obsDim: 3 * nu + 8,
    actDim: nu,
    phase: 0,
    lastAct: new Float64Array(nu),
    _q: new Float64Array(nu),
    _dq: new Float64Array(nu),
    _bq: new Float64Array(4),
    _bv: new Float64Array(3),
    _ref: new Float64Array(nu),
    _refNext: new Float64Array(nu),

    reset(rng) {
      this.phase = 0;
      this.tElapsed = 0;
      this.lastAct.fill(0);
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
      for (let i = 0; i < nu; i++) { const d = (this._q[i] - this._ref[i]) / 0.35; sq += d * d; }
      const eQ = Math.exp(-Math.sqrt(sq / nu));
      sim.basePos(this._p || (this._p = new Float64Array(3)));
      const h = this._p[2];
      const eH = Math.exp(-Math.pow((h - this._href[0]) / 0.09, 2));
      let e = 0;
      for (let i = 0; i < nu; i++) e += this.lastAct[i] * this.lastAct[i];
      const r = 0.72 * eQ + 0.2 * eH + 0.08 * clamp(upz, 0, 1) + 0.03 - 0.00005 * e;
      const done = upz < 0.5 || h < 0.55 * this._href[0] || h > 1.4;
      return { r, done };
    },

    advance(dt) {
      this.phase += dt * this.clip.fps / this.clip.n;
      this.phase %= 1;
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
        sim.setGhostPose(ghost, clip.q, f * nu, clip.h[f]);
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
