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
// v2.7.0 — SENSORIK: Beobachtungsraum 3·nu + 27 (+9: GYRO 3 aus dem
//   echten IMU, projizierte Gravitation 3, Basis-Höhe 1, FUSSKONTAKTE 2).
//   Der Roboter „fühlt" jetzt seinen Körper wie ein realer: Drehrate,
//   Schwerkraft-Sinn, Höhe und Fußkontakt — die Policy
//   kann dadurch Gleichgewicht/Störungen physikalisch begreifen statt
//   nur Positions-Fehler zu korrigieren. Policies von ≤ v2.6.x werden
//   verworfen (obsDim-Wache).
// v2.5.0 — ANIMATION AN/AUS: animOn=false schaltet das Posen-Tracking ab
//   (Referenz = Keyframe-Stand) — so lernt der Roboter NUR GLEICHGEWICHT,
//   denn die GLB-Animationen besitzen selbst kein physikalisches
//   Gleichgewicht. Erst Animation lernen, dann abschalten und Balance
//   nachziehen — das Netz bleibt dabei erhalten (Curriculum).
// v2.15.0 — REFERENZ-MODI (refMode):
//   'frei'  = Standard: die Referenz-Bahn wandert durchs Feld (Root-Motion),
//             der Roboter folgt dem wandernden Lehrer (DeepMimic-Pfad).
//   'stelle'= AN EINER STELLE: Referenz steht FIX am Startpunkt — der
//             Roboter soll die Bewegung AUF DER STELLE zeigen (Wurzel-Ziel
//             = Startpunkt, lead 0, kein Loop-Rebase).
//   'folgt' = AM ROBOTER GEANKERT: der Lehrer-Geist hängt am LEBENDEN
//             Roboter (spielt die Bewegung relativ zu ihm ab) — es gibt
//             KEINEN Bahn-Zwang mehr (root/yaw-Belohnung neutral), Posen-
//             Ähnlichkeit + Höhe + Aufrecht bleiben. Der Roboter wird nicht
//             von der Bahn "mitgerissen"; Joystick/Buttons führen weiter.
// v2.16.0 — ENTKOPLUNG (Policy nicht an die Animation binden):
//   Bisher war die GLB-Animation an DREI Stellen mit der Policy verknotet:
//   (a) OBS: Posen-Fehler-Kanäle q − Referenz, (b) AKTION: actionToCtrl
//   verankerte die Aktionen um die ANIMIERTE Referenzpose (animOn=false
//   umwarf den Anker auf die Stand-Pose → gelernte Aktionen bedeuteten
//   plötzlich etwas anderes → die Policy „vergaß“ beim Lösen der
//   Animation alles), (c) REWARD: Posen-Tracking. Seit v2.16.0 gilt:
//   1) Aktions-Anker = IMMER die Keyframe-Pose (keyCtrl) — identische
//      Aktions-Semantik MIT und OHNE Animation (wie beim Speed-Task).
//   2) animOn=false = KOMMANDOGANG: das Wurzel-Ziel ist die integrierte
//      Kommando-Strecke (Training: Zufalls-Kommandos, POLICY-Modus: Stick)
//      — der Roboter BEHALT sein Gehen und verbessert es, statt auf einen
//      Stand-Attraktor zurückgezogen zu werden. Posen-Gewicht sinkt auf
//      freePose (schwacher Haltungs-Regulierer).
//   3) ANIM-DROPOUT (dropP): im GLB-Training läuft jeder Episode mit
//      Wahrscheinlichkeit dropP in OHNE-Animation-Semantik (Anker-OBS,
//      Kommandogang, keine Posen-Belohnung) — die Policy lernt BEIDE
//      Welten und das spätere „OHNE ANIM WEITER“ ist kein Bruch mehr.
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
  // v2.16.0: freePose = Posen-Gewichts-Faktor OHNE Animation (schwacher
  //   Haltungs-Regulierer um die Keyframe-Pose — hält die Beine sanft,
  //   bestraft Gehen nicht mehr nennenswert). dropP = Wahrscheinlichkeit,
  //   mit der eine Trainings-Episode OHNE Animation läuft (Anim-Dropout:
  //   die Policy wird von Anfang an animation-unabhängig).
  freePose: 0.1, dropP: 0.2,
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
    // v2.16.0 ANIM-DROPOUT: dropAnimP > 0 schaltet das Dropout SCHARF
    // (nur im Training gesetzt: main.js startTraining + simworker).
    // dropAnim = diese Episode läuft ohne Animation (je Episode neu gewürfelt).
    dropAnimP: 0,
    dropAnim: false,
    // v2.15.0: Referenz-Modus — 'frei' (Bahn wandert), 'stelle' (fix am
    // Startpunkt), 'folgt' (Geist hängt am Roboter, kein Bahn-Zwang)
    refMode: 'frei',
    cmd: { vx: 0, wz: 0 },   // aktuelles Kommando (Training: gewürfelt, Policy: Stick)
    _cmdHold: 0,             // Rest-Haltezeit des Kommandos (s)
    _tx: 0, _ty: 0, _tyaw: 0, // Kommando-integriertes Wurzel-Ziel
    obsDim: 3 * nu + 27, // v2.7.0: +9 Sensorik (Gyro 3, Gravitation 3, Höhe 1, Kontakte 2)
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

    // v2.16.0: läuft diese Episode OHNE Animation? (animOn=false ODER
    // Anim-Dropout einer Trainings-Episode)
    animOff() { return this.animOn === false || this.dropAnim === true; },
    // v2.16.0: wird die Wurzel von KOMMANDOS geführt (statt von der
    // Clip-Bahn)? — joy/btn sowieso, und OHNE Animation immer.
    cmdDriven() { return this.ctrlMode === 'joy' || this.ctrlMode === 'btn' || this.animOff(); },

    reset(rng, sim2) {
      this.phase = 0;
      this.tElapsed = 0;
      this.lastAct.fill(0);
      this.trg.fill(0);
      this._trgHold.fill(0);
      this._loopX = 0; this._loopY = 0; this._loopYaw = 0;
      // v2.16.0 Anim-Dropout: nur im Training scharf (dropAnimP), nur wenn
      // die Animation AN ist (bei animOn=false ist alles schon ohne).
      this.dropAnim = this.dropAnimP > 0 && this.animOn !== false && Math.random() < this.dropAnimP;
      const off = this.animOff();
      // Kommando-Ziel setzen: OHNE Animation auf die ROBOTER-Startposition
      // (Kommandogang ab da), MIT Animation auf den Bahn-Anfang (v2.5.0)
      if (off && sim2) {
        try { sim2.basePos(this._p); this._tx = this._p[0]; this._ty = this._p[1]; this._tyaw = 0; }
        catch (e) { this._tx = 0; this._ty = 0; this._tyaw = 0; }
      } else {
        this._tx = hasRoot ? clip.root[0] : 0;
        this._ty = hasRoot ? clip.root[1] : 0;
        this._tyaw = hasRoot ? (clip.yaw[0] || 0) : 0;
      }
      this._cmdHold = 0; // erzwingt sampleCmd beim ersten Trainingsschritt
      this.cmd.vx = 0; this.cmd.wz = 0;
      this._manualCmd = false;
      // v2.28.0 GEIST LENKEN (joy/btn + 'folgt'): die Referenz startet AM
      // ROBOTER (kein Teleport zur Clip-Bahn) — die gefahrene Route bleibt
      // über Episoden-Grenzen hinweg bestehen, Geist und Roboter bleiben
      // beieinander. Vorher sprang der Geist bei jedem Episoden-Ende zum
      // Clip-Start zurück („sie sind auseinander“).
      const joyDriven = this.ctrlMode === 'joy' || this.ctrlMode === 'btn';
      if (sim2 && hasRoot && !off && this.refMode === 'folgt' && joyDriven) {
        try {
          sim2.basePos(this._p);
          this._tx = this._p[0]; this._ty = this._p[1];
          const bq4 = [0, 0, 0, 0];
          sim2.baseQuat(bq4);
          this._tyaw = Math.atan2(2 * (bq4[0] * bq4[3] + bq4[1] * bq4[2]), 1 - 2 * (bq4[2] * bq4[2] + bq4[3] * bq4[3]));
        } catch (e) { this._tx = hasRoot ? clip.root[0] : 0; this._ty = hasRoot ? clip.root[1] : 0; this._tyaw = 0; }
      }
      // Roboter AUF die Referenz-Bahn setzen (nicht in den Ursprung) —
      // OHNE Animation bleibt die Roboter-eigene Startpose (Keyframe).
      // v2.28.0: im Geist-lenk-Modus NICHT (Roboter bleibt, wo er ist —
      // die Referenz startet ja an IHM, siehe oben).
      if (sim2 && hasRoot && !off && !(this.refMode === 'folgt' && joyDriven)) {
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
      if (this.animOn === false || this.dropAnim === true) {
        for (let j = 0; j < nu; j++) outQ[j] = keyCtrl[j];
        // v2.15.0: Soll-Höhe = Roboter-eigene Grundhöhe (cfg.h0) statt der
        // G1-Festwert 0,79 — sonst würde der MicroDuck (h0=0,12) ständig als
        // „gestürzt" abgebrochen (Schwellen relativ zu dieser Höhe).
        if (outH) outH[0] = this._h0 || (this._h0 = (cfg.h0 || 0.79));
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
      if (this.refMode === 'stelle') return 0; // auf der Stelle: kein Zug
      const c = clip;
      const t = (phase * c.fps) % c.n;
      const i0 = Math.floor(t), i1 = (i0 + 1) % c.n;
      const dx = c.root[2 * i1] - c.root[2 * i0], dy = c.root[2 * i1 + 1] - c.root[2 * i0 + 1];
      return Math.hypot(dx, dy) * c.fps;
    },

    // v2.15.0: WO steht der Lehrer-Geist in diesem Modus?
    // out = [x, y, yaw]. robotPos/robotYaw = LEBENDE Roboter-Basis (nur in
    // 'folgt' relevant — der Geist hängt am Roboter und spielt die Bewegung
    // relativ zu ihm ab, ohne Loop-Offset).
    // v2.28.0 GEIST LENKEN: Führen KOMMANDOS die Wurzel (Stick bei joy/btn,
    // Geist-lenk-Modus), steht der Geist am INTEGRIERTEN Kommando-Ziel
    // (_tx/_ty/_tyaw) — er zeigt die vom Stick GEFAHRENE Referenz, nicht
    // die starre Clip-Bahn und nicht die Roboter-Position. Genau das, was
    // der Roboter per Bahn-Belohnung folgen soll — Geist = Trainingsziel.
    ghostAnchor(phase, robotPos, robotYaw, out) {
      if (this.cmdDriven()) {
        out[0] = this._tx; out[1] = this._ty; out[2] = this._tyaw;
        return out;
      }
      if (this.refMode === 'folgt' && robotPos) {
        if (hasRoot) {
          const c = clip;
          const t = (phase * c.fps) % c.n;
          const i = Math.floor(t);
          out[0] = robotPos[0] + (c.root[2 * i] - c.root[0]);
          out[1] = robotPos[1] + (c.root[2 * i + 1] - c.root[1]);
          out[2] = robotYaw + wrapAngle((c.yaw[i] || 0) - (c.yaw[0] || 0));
        } else { out[0] = robotPos[0]; out[1] = robotPos[1]; out[2] = robotYaw; }
        return out;
      }
      if (this.refMode === 'stelle' || !hasRoot) {
        out[0] = hasRoot ? clip.root[0] : 0;
        out[1] = hasRoot ? clip.root[1] : 0;
        out[2] = hasRoot ? (clip.yaw[0] || 0) : 0;
        return out;
      }
      this.refRoot(phase, out); // 'frei' — Bahn mit Loop-Offset
      return out;
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
      // v2.16.0: OHNE Animation wird auch bei ctrlMode 'none' gewürfelt —
      // der Kommandogang (frei weitertrainieren ohne GLB) braucht im
      // Training Fahrbefehle, sonst würde nur Stehen belohnt.
      if (this.ctrlMode === 'none' && !this.animOff()) { this.cmd.vx = 0; this.cmd.wz = 0; this._cmdHold = Infinity; return; }
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
      // v2.15.0: 'stelle' → Ziel = Startpunkt (lead 0); 'folgt' → Ziel =
      // eigene Position (Fehler ≈ 0 — kein Bahn-Zwang, nur Pose/Höhe).
      // v2.16.0: Kommandos führen die Wurzel bei joy/btn UND immer ohne
      // Animation (Kommandogang) — sonst gelten die Referenz-Modi.
      const driven = this.cmdDriven();
      let tx, ty, tyaw, lead;
      sim.basePos(this._p);
      if (driven) { tx = this._tx; ty = this._ty; tyaw = this._tyaw; lead = this.cmd.vx; }
      else if (this.refMode === 'stelle') { tx = this._tx; ty = this._ty; tyaw = this._tyaw; lead = 0; }
      else if (this.refMode === 'folgt') { tx = this._p[0]; ty = this._p[1]; tyaw = yaw; lead = this.refSpeed(this.phase); }
      else { this.refRoot(this.phase, this._rr); tx = this._rr[0]; ty = this._rr[1]; tyaw = this._rr[2]; lead = this.refSpeed(this.phase); }
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
      // ── v2.7.0 SENSORBLOCK (voller Roboter-Wahrnehmung) ──
      sim.gyroBody(this._gy || (this._gy = new Float64Array(3)));
      out[o++] = this._gy[0]; out[o++] = this._gy[1]; out[o++] = this._gy[2];
      sim.projectedGravity(this._pg || (this._pg = new Float64Array(3)));
      out[o++] = this._pg[0]; out[o++] = this._pg[1]; out[o++] = this._pg[2];
      sim.basePos(this._sp || (this._sp = new Float64Array(3)));
      out[o++] = this._sp[2];
      sim.footContacts(this._fc || (this._fc = new Float64Array(2)));
      out[o++] = this._fc[0] ? 1 : 0;
      out[o++] = this._fc[1] ? 1 : 0;
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
      // Sensorblock (v2.7.0) aus GEISTER-Zustand: Gyro 0 (kinematisch),
      // Gravitation aus der Basis-Orientierung des Lehrers, Höhe = Referenz,
      // Kontakte 0 (Geist ist nur Pose, keine Physik)
      out[o++] = 0; out[o++] = 0; out[o++] = 0;
      out[o++] = -2 * (x * z + w * y);
      out[o++] = -2 * (y * z - w * x);
      out[o++] = -(1 - 2 * (x * x + y * y));
      out[o++] = this._href[0];
      out[o++] = 0; out[o++] = 0;
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
      // v2.15.0: 'stelle' → Startpunkt (bleibt stehen); 'folgt' → KEIN
      // Bahn-Zwang (root/yaw neutral — der Lehrer hängt am Roboter).
      let eRoot = 1, eYaw = 1, dRoot = 0;
      // v2.16.0: Kommando-Verfolgung = joy/btn ODER ohne Animation
      // (Dropout inklusive) — dann zählt die integrierte Kommando-Strecke.
      const trackCmd = this.cmdDriven() || this.refMode === 'stelle';
      const noRootPull = this.refMode === 'folgt' && !this.cmdDriven();
      if (noRootPull) {
        // geankert: Posen-/Höhen-Treue zählt, der Ort zählt nicht
      } else if (trackCmd) {
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
      // v2.16.0: OHNE Animation (auch Dropout-Episode) sinkt das Posen-
      // Gewicht auf freePose — schwacher Haltungs-Regulierer um die
      // Keyframe-Pose, der Gehen auf Kommando nicht mehr bestraft.
      let poseW = this.animOff() ? MOTION_R.pose * (MOTION_R.freePose || 0.1) : MOTION_R.pose;
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
      // v2.15.0: im 'folgt'-Modus gibt es keine Bahn → kein Bahn-Abbruch
      const lostRoot = !noRootPull && hasRoot && (this.tElapsed || 0) > 1.2 && dRoot > MOTION_R.rootDone;
      const done = upz < MOTION_R.upMin || h < MOTION_R.hMin * this._href[0] || h > MOTION_R.hMax || lostRoot;
      return { r, done };
    },

    advance(dt) {
      const old = this.phase;
      const c = clip;
      // Kommando-Führung (v2.5.0/2.6.0): das Wurzel-Ziel integriert (vx, wz).
      // v2.16.0: OHNE Animation wird das Ziel IMMER von Kommandos geführt
      //   (Training: Zufalls-Kommandos = Kommandogang lernen; POLICY-Modus:
      //   der Stick schreibt _manualCmd — dann wird NICHT hineingewürfelt).
      const joy = this.ctrlMode === 'joy' || this.ctrlMode === 'btn';
      if (this.cmdDriven()) {
        this._cmdHold -= dt;
        if (this._cmdHold <= 0 && !this._manualCmd) this.sampleCmd();
        this._tyaw = wrapAngle(this._tyaw + this.cmd.wz * dt);
        this._tx += Math.cos(this._tyaw) * this.cmd.vx * dt;
        this._ty += Math.sin(this._tyaw) * this.cmd.vx * dt;
      }
      this._manualCmd = false;
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
      // v2.21.0 MOTION-KI: GEIST-PAUSE — die Phase friert ein, der Geist hält
      // die Pose (die Policy hält sie nach) — der Roboter „stoppt" im Stil.
      // Cmd-/Trigger-Integration läuft weiter, nur die Referenzzeit steht.
      if (!this.ghostPaused) {
        this.phase += dt * c.fps / c.n * factor;
        this.phase %= 1;
      // Schleifen-Sprung: die Bahn läuft von der ENDPOSITION weiter
      // (Endlosgehen über die Arena statt Teleport zurück zum Start).
      // NUR bei echten Bewegungs-Clips (locomotion) — bei Idles würde der
      // winzige Yaw-/Positions-Unterschied Ende↔Anfang JEDE Schleife
      // akkumulieren: der Geist drehte sich über Minuten komplett um
      // bzw. wanderte davon (v2.4.1-Fix).
      // v2.15.0: auch NUR im 'frei'-Modus — 'stelle'/'folgt' haben keine
      // wandernde Bahn (der Loop-Offset würde den fixen Anker verschieben).
      if (!this.ghostPaused && this.phase < old && hasRoot && clip.n > 1 && clip.locomotion !== false && this.refMode === 'frei' && !joy) {
        const m = clip.n - 1;
        this._loopX += clip.root[2 * m] - clip.root[0];
        this._loopY += clip.root[2 * m + 1] - clip.root[1];
        this._loopYaw = wrapAngle(this._loopYaw + wrapAngle(clip.yaw[m] - clip.yaw[0]));
      }
      }
      this.tElapsed = (this.tElapsed || 0) + dt;
    },

    actionToCtrl(sim, act) {
      // v2.16.0 ENTKOPLUNG: Rest-Aktion IMMER um die Keyframe-Pose
      // (keyCtrl) — dieselbe Aktions-Semantik mit und ohne Animation
      // (wie beim Speed-Task). Vorher war der Anker die animierte
      // Referenzpose: animOn=false warf den Anker um → die gelernte
      // Policy bedeutete plötzlich etwas anderes („alles vergessen“).
      for (let a = 0; a < nu; a++) {
        sim.ctrl[a] = keyCtrl[a] + span * Math.tanh(act[a]);
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
          // v2.16.0: Etikett auf den NEUEN Aktions-Anker (Keyframe-Pose)
          // geeicht — actionToCtrl verankert die Aktion um keyCtrl, also
          // muss BC die Aktion liefern, die q_ref(f+1) aus der Keyframe-
          // Pose trifft (vorher: Delta f → f+1 um die Referenz selbst).
          const diff = clip.q[f1 * actDim + j] - keyCtrl[j];
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
