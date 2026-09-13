// ═══════════════════════════════════════════════════════════
// motiontask.js — GLB-Bewegungs-Tracking (DeepMimic-lite) für den G1.
// Referenz: retargetete MotionClip-Timeline (q_ref, h_ref, Endlosschleife)
// + ROOT-MOTION: die Referenz-Bahn (x, y, yaw) läuft wirklich durchs Feld —
//   der Roboter folgt dem wandernden Lehrer statt „auf der Stelle" zu gehen.
// Reward = Posen-Ähnlichkeit (RMS) + Höhe + Bahn-Folgen (Abstand + Blick)
//   + Aufrecht, Abbruch bei Sturz oder verlorenem Kontakt zur Bahn.
// Beobachtungsraum: 3·nu + 14 (Pose-Fehler, Geschwindigkeiten, Orientierung,
//   Bahn-Fehler lokal, Führung, Phase, KOMMANDO vx/wz) — Geschwindigkeits-
//   und Motion-Policies sind damit getrennt (obsDim unterscheidet sich).
// v2.5.0 — STEUERUNG: ctrlMode 'none' (rein Referenzbahn, für Idles) oder
//   'joy' (Kommandos vx/wz führen die Wurzel). Im TRAINING werden die
//   Kommandos zufällig gewürfelt (Domain-Randomization — die Policy lernt,
//   dass der Joystick sie steuert), im POLICY-Modus liefert der Stick sie.
// v2.6.0 — ctrlMode 'btn': wie 'joy' (Zufalls-Kommandos im Training,
//   Stick im POLICY-Modus) PLUS 4 TRIGGER-KANÄLE (nutzerdefinierte Buttons,
//   z. B. „Kicken"/„Springen"). Im Training werden die Trigger zufällig
//   feuern (Domain-Randomization) und der Posen-Anteil der Belohnung
//   gedämpft + kleiner Bewegungs-Bonus — die Policy lernt, dass ein
//   Trigger eine EIGENE dynamische Aktion auslöst (Freistil in der Pose-
//   Familie), danach zurück zur Referenz. Beobachtungsraum: 3·nu + 18
//   (+4 Trigger-Kanäle, geglättet 0..1) — Policies von ≤ v2.5.0 werden
//   verworfen (obsDim-Wache in main.js loadPolicy).
// v2.5.0 — ANIMATION AN/AUS: animOn=false schaltet das Posen-Tracking ab
//   (Referenz = Keyframe-Stand) — so lernt der Roboter NUR GLEICHGEWICHT,
//   denn die GLB-Animationen besitzen selbst kein physikalisches
//   Gleichgewicht. Erst Animation lernen, dann abschalten und Balance
//   nachziehen — das Netz bleibt dabei erhalten (Curriculum).
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
    // ── Steuerung (v2.5.0) ─────────────────────────────────
    // 'none': Verhalten folgt rein der Referenzbahn (z. B. Idle-Clips).
    // 'joy':  Kommandos (vx = Vorwärtstempo m/s, wz = Gier-Rate rad/s)
    //   führen das Wurzel-Ziel. Training: Zufalls-Kommandos (Domain-
    //   Randomization). POLICY-Modus: der Joystick liefert sie.
    ctrlMode: 'none',
    // v2.6.0 'btn': wie 'joy' PLUS 4 Trigger-Kanäle (nutzerdefinierte
    // Buttons, z. B. „Kicken"/„Springen"). Training: Zufalls-Trigger +
    // gedämpfter Posen-Anteil + Bewegungs-Bonus → die Policy verbindet den
    // Button mit einer eigenen dynamischen Aktion (Freistil in der Pose-
    // familie), danach zurück zur Referenz. POLICY-Modus: Taste setzt Trigger.
    buttons: [],                   // Button-Labels je Clip (max. 4, UI/Debug)
    trg: new Float64Array(4),      // geglättete Trigger 0..1
    _trgHold: new Float64Array(4), // Rest-Haltezeit je Trigger (s)
    // ── Animation an/aus (v2.5.0) ──────────────────────────
    // false = Posen-Tracking AUS (Referenz = Keyframe-Stand): es wird nur
    //   GLEICHGEWICHT gelernt. Der Posen-Anteil fällt auf 35 % (grobe
    //   Stand-Attraktor), damit Beine beim Joystick-Gehen frei bleiben.
    animOn: true,
    cmd: { vx: 0, wz: 0 },   // aktuelles Kommando (Training: gewürfelt, Policy: Stick)
    _cmdHold: 0,             // Rest-Haltezeit des Kommandos (s)
    _tx: 0, _ty: 0, _tyaw: 0, // Kommando-integriertes Wurzel-Ziel
    obsDim: 3 * nu + 18, // v2.6.0: +4 Trigger-Kanäle (Buttons)
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
      this.trg.fill(0);
      this._trgHold.fill(0);
      this._loopX = 0; this._loopY = 0; this._loopYaw = 0;
      // Kommando-Ziel auf den Bahn-Anfang setzen (v2.5.0)
      this._tx = hasRoot ? clip.root[0] : 0;
      this._ty = hasRoot ? clip.root[1] : 0;
      this._tyaw = hasRoot ? (clip.yaw[0] || 0) : 0;
      this._cmdHold = 0; // erzwingt sampleCmd beim ersten Trainingsschritt
      this.cmd.vx = 0; this.cmd.wz = 0;
      // Roboter AUF die Referenz-Bahn setzen (nicht in den Ursprung)
      if (sim2 && hasRoot) {
        try { sim2.placeBase(clip.root[0], clip.root[1], clip.yaw[0] || 0); } catch (e) { /* Basis ohne freies Gelenk */ }
      }
    },

    // Referenzpose zur Phase (lineare Interpolation, Endlosschleife).
    // Sanfter Einstieg: erste 0,6 s von der Keyframe-Pose hineinblenden,
    // damit der Roboter nicht ruckartig in die Clip-Pose springt.
    // animOn=false (v2.5.0): Referenz = Keyframe-STAND — es wird nur
    // Gleichgewicht gelernt, die GLB-Animation fließt nicht ein.
    sampleRef(phase, outQ, outH) {
      const c = clip;
      if (this.animOn === false) {
        for (let j = 0; j < nu; j++) outQ[j] = keyCtrl[j];
        if (outH) outH[0] = 0.79;
        return;
      }
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

    // Trigger setzen (v2.6.0): POLICY-Modus (Button-Taste) + Tests
    setTrigger(i, sec = 1.2) {
      if (this.ctrlMode !== 'btn' || i < 0 || i > 3) return false;
      this._trgHold[i] = Math.max(this._trgHold[i], sec);
      return true;
    },

    // Zufalls-Kommandos im TRAINING (v2.5.0, Domain-Randomization): der
    // Roboter lernt, dass (vx, wz) ihn steuert — Haltezeit 1,5–4 s,
    // ~25 % Stille (Stehen), sonst Vorwärts/Rückwärts + Gieren.
    // v2.6.0 ('btn'): zusätzlich zufällige TRIGGER (25 % je Kanal,
    // Haltezeit 0,8–2,0 s) — die Policy lernt, Buttons ernst zu nehmen.
    sampleCmd() {
      if (this.ctrlMode === 'none') { this.cmd.vx = 0; this.cmd.wz = 0; this._cmdHold = Infinity; return; }
      const vxMax = Math.max(0.5, Math.min(1.0, (clip.meanSpeed || 0.4) * 1.6));
      if (Math.random() < 0.25) { this.cmd.vx = 0; this.cmd.wz = 0; }
      else {
        this.cmd.vx = Math.random() < 0.15 ? -0.25 * Math.random() : Math.random() * vxMax;
        this.cmd.wz = (Math.random() * 2 - 1) * 0.9;
      }
      this._cmdHold = 1.5 + Math.random() * 2.5;
      if (this.ctrlMode === 'btn') {
        for (let i = 0; i < 4; i++) this._trgHold[i] = Math.random() < 0.25 ? (0.8 + Math.random() * 1.2) : 0;
      }
    },

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
      const cy = Math.cos(yaw), s = Math.sin(yaw);
      out[o++] = cy * this._bv[0] + s * this._bv[1];
      out[o++] = -s * this._bv[0] + cy * this._bv[1];
      // Bahn-Fehler (lokal zur Basis) + Führung — Root-Folgen lernen.
      // v2.5.0: bei ctrlMode 'joy' ist das Ziel die KOMMANDO-INTEGRATION
      // (der Joystick führt!), sonst die Referenzbahn des Clips.
      const joy = this.ctrlMode === 'joy';
      let tx, ty, tyaw, lead;
      if (joy) { tx = this._tx; ty = this._ty; tyaw = this._tyaw; lead = this.cmd.vx; }
      else { this.refRoot(this.phase, this._rr); tx = this._rr[0]; ty = this._rr[1]; tyaw = this._rr[2]; lead = this.refSpeed(this.phase); }
      sim.basePos(this._p);
      const dx = tx - this._p[0], dy = ty - this._p[1];
      out[o++] = cy * dx + s * dy;
      out[o++] = -s * dx + cy * dy;
      out[o++] = wrapAngle(tyaw - yaw);
      out[o++] = lead;
      out[o++] = Math.sin(2 * Math.PI * this.phase);
      out[o++] = Math.cos(2 * Math.PI * this.phase);
      // Kommando-Kanäle (v2.5.0): IMMER im Beobachtungsraum (dim-stabil);
      // bei 'none' dauerhaft 0.
      out[o++] = this.cmd.vx;
      out[o++] = this.cmd.wz;
      // Trigger-Kanäle (v2.6.0): geglättete Button-Aktivierungen 0..1
      out[o++] = this.trg[0];
      out[o++] = this.trg[1];
      out[o++] = this.trg[2];
      out[o++] = this.trg[3];
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
      out[o++] = 0; out[o++] = 0; // Kommando-Kanäle (BC ohne Führung)
      out[o++] = 0; out[o++] = 0; out[o++] = 0; out[o++] = 0; // Trigger (v2.6.0)
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
      // Bahn-Folgen: Abstand zur Wurzel + Blick. v2.5.0: bei Kommando-
      // führung (joy/btn) oder animOn=false ist das Ziel die Integration
      // (_tx/_ty/_tyaw), sonst die wandernde Referenz-Bahn.
      let eRoot = 1, eYaw = 1, dRoot = 0;
      const trackCmd = this.ctrlMode === 'joy' || this.ctrlMode === 'btn' || this.animOn === false;
      if (trackCmd) {
        const dx = this._tx - this._p[0], dy = this._ty - this._p[1];
        dRoot = Math.hypot(dx, dy);
        eRoot = Math.exp(-Math.pow(dRoot / MOTION_R.rootScale, 2));
        const yawBase = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        eYaw = Math.exp(-Math.pow(Math.abs(wrapAngle(this._tyaw - yawBase)) / MOTION_R.yawScale, 2));
      } else if (hasRoot) {
        this.refRoot(this.phase, this._rr);
        const dx = this._rr[0] - this._p[0], dy = this._rr[1] - this._p[1];
        dRoot = Math.hypot(dx, dy);
        eRoot = Math.exp(-Math.pow(dRoot / MOTION_R.rootScale, 2));
        const yawBase = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        eYaw = Math.exp(-Math.pow(Math.abs(wrapAngle(this._rr[2] - yawBase)) / MOTION_R.yawScale, 2));
      }
      let e = 0;
      for (let i = 0; i < nu; i++) e += this.lastAct[i] * this.lastAct[i];
      // animOn=false: Posen-Anteil gedämpft (grobe Stand-Attraktor — die
      // Beine bleiben frei genug, um auf Joystick-Kommandos zu gehen)
      // v2.6.0: AKTIVER TRIGGER dämpft den Posen-Anteil zusätzlich (0,25×)
      // und zahlt einen kleinen Bewegungs-Bonus — der Button „befreit" den
      // Roboter für eine eigene dynamische Aktion (Kicken/Springen-artig);
      // Höhe/Aufrecht/Bahn halten ihn dabei sicher.
      let poseW = this.animOn === false ? MOTION_R.pose * 0.35 : MOTION_R.pose;
      let styleB = 0;
      let trgSum = 0;
      for (let i = 0; i < 4; i++) trgSum += this.trg[i];
      if (trgSum > 0.2) {
        poseW *= 0.25;
        let mAbs = 0;
        for (let i = 0; i < nu; i++) mAbs += Math.abs(this.lastAct[i]);
        styleB = 0.08 * Math.min(1, (mAbs / nu) / 0.35) * Math.min(1, trgSum);
      }
      const r = poseW * eQ + MOTION_R.height * eH
        + MOTION_R.root * eRoot + MOTION_R.yaw * eYaw
        + MOTION_R.up * clamp(upz, 0, 1) + MOTION_R.base + styleB - MOTION_R.energy * e;
      // Abbruch: Sturz ODER dauerhaft verloren von der Bahn (Eingangsphase geschont)
      const lostRoot = hasRoot && (this.tElapsed || 0) > 1.2 && dRoot > MOTION_R.rootDone;
      const done = upz < MOTION_R.upMin || h < MOTION_R.hMin * this._href[0] || h > MOTION_R.hMax || lostRoot;
      return { r, done };
    },

    advance(dt) {
      const old = this.phase;
      const c = clip;
      // Kommando-Führung (v2.5.0/2.6.0): das Wurzel-Ziel integriert (vx, wz).
      // joy/btn + animOn: Kommandos führen (Training: gewürfelt, Policy: Stick).
      // animOn=false: Ziel bleibt an der Startposition stehen (Gleichgewicht
      //   lernen ohne Weglauf-Drang) — außer bei joy/btn (dort führt der Stick).
      const joy = this.ctrlMode === 'joy' || this.ctrlMode === 'btn';
      if (joy) {
        this._cmdHold -= dt;
        if (this._cmdHold <= 0) this.sampleCmd();
        this._tyaw = wrapAngle(this._tyaw + this.cmd.wz * dt);
        this._tx += Math.cos(this._tyaw) * this.cmd.vx * dt;
        this._ty += Math.sin(this._tyaw) * this.cmd.vx * dt;
      } else if (this.animOn === false) {
        // _tx/_ty/_tyaw bleiben fix — Ziel = Startposition (Stehen lernen)
      }
      // Trigger (v2.6.0): Haltezeit runterzählen + rechteckförmig glätten
      // (Anstieg ~0,12 s, Abfall ~0,25 s — die Policy sieht saubere Kanäle)
      for (let i = 0; i < 4; i++) {
        if (this._trgHold[i] > 0) this._trgHold[i] = Math.max(0, this._trgHold[i] - dt);
        const goal = this._trgHold[i] > 0 ? 1 : 0;
        const k = goal > this.trg[i] ? Math.min(1, dt * 8) : Math.min(1, dt * 4);
        this.trg[i] += (goal - this.trg[i]) * k;
      }
      // Phasen-Tempo: bei Joystick-Führung die Schrittfrequenz grob ans
      // Kommandotempo anpassen (Geh-Clip + Stand-Kommando → Zeitlupe,
      // schnelleres Kommando → rasender Takt). Nur bei echter Locomotion.
      let factor = 1;
      if (joy && c.locomotion !== false && this.animOn !== false) {
        const rs = this.refSpeed(this.phase);
        if (rs > 0.15) factor = Math.min(1.7, Math.max(0.4, Math.abs(this.cmd.vx) / rs));
      }
      this.phase += dt * c.fps / c.n * factor;
      this.phase %= 1;
      // Schleifen-Sprung: die Bahn läuft von der ENDPOSITION weiter
      // (Endlosgehen über die Arena statt Teleport zurück zum Start).
      // NUR bei echten Bewegungs-Clips (locomotion) — bei Idles würde der
      // winzige Yaw-/Positions-Unterschied Ende↔Anfang JEDE Schleife
      // akkumulieren: der Geist drehte sich über Minuten komplett um
      // bzw. wanderte davon (v2.4.1-Fix).
      if (this.phase < old && hasRoot && clip.n > 1 && clip.locomotion !== false) {
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
