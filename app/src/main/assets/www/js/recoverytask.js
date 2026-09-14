// ═══════════════════════════════════════════════════════════
// recoverytask.js — v2.7.0 RECOVERY-SZENARIEN („vollständiger Roboter"):
//
//   'getup' — AUFSTEHEN: Der Roboter startet LIEGEND (Rücken, Bauch oder
//     Seite — zufällig, mit Gelenkrauschen) und lernt, selbstständig
//     aufzustehen und stabil zu stehen. Kein Teleport als „Lösung":
//     Die Episode endet erst mit ERFOLG (aufrecht + hoch, gehalten) oder
//     nach dem Zeitlimit — der Sturz ist hier Startzustand, nicht Fehler.
//
//   'drop' — ABWURF: Der Roboter startet 0,9–2,0 m ÜBER dem Boden mit
//     zufälliger Neigung und lernt, richtig zu LANDEN und danach zu
//     stehen. Erfolg zählt erst NACH dem ersten Bodenkontakt — in der
//     Luft „aufrecht" zu sein ist kein Erfolg.
//
// Belohnung (kuratiert, RECOVERY_R): Aufstehen zahlt in Stufen —
//   upz linear (−0,5 liegend … +0,5 stehend) + Quadrat-Bonus für echt
//   aufrecht + Höhen-Treue zur gemessenen Standhöhe h0 + Leben −
//   Gelenkunruhe − Aktionsaufwand. Erfolg: upz > 0,9 UND h > 0,72·h0,
//   0,8 s gehalten → Bonus + Episodenende. Zeitlimit: 12 s.
//
// Beobachtungsraum: 3·nu + 8 + Sensoren (v2.8.0, konsistent mit dem
// Track-Task aus v2.7.0): Basisblock (Gelenkfehler zur Standpose,
// Gelenktempo, Aufwärtsvektor, normalisierte Höhe, Gier-Rate, Körper-Tempo,
// letzte Aktion) + SENSORBLOCK (Gyro 3 = IMU, projizierte Gravitation 3,
// absolute Höhe 1, Fußkontakte nFeet, Phasen-Uhr sin/cos = Zeitgefühl).
// „Ein vollständiger Roboter spürt seinen Körper" — auch beim Aufstehen.
// Policies je Szenario getrennt (Policy-Schlüssel recovery_getup /
// recovery_drop in main.js).
// v2.7.0 — Antwort auf: „Warum wird der Roboter beim Sturz immer zurück
// teleportiert?" — weil Sturz bisher Episoden-Abbruch war. Jetzt lernt
// der Roboter, WAS DANACH KOMMT: landen, aufstehen, weitermachen.
// ═══════════════════════════════════════════════════════════

export const RECOVERY_R = {
  up: 0.5,        // linearer Aufwärts-Anteil: upz ∈ [−1, 1] → [−0,5, +0,5]
  upSq: 1.0,      // Quadrat-Bonus für echt aufrecht (max +1)
  height: 0.9,    // Höhen-Treue zur Standhöhe h0
  hScale: 0.2,    // Höhen-Toleranz (m)
  alive: 0.03,    // Grundbetrag pro Schritt
  energy: 0.0002, // Aktionsaufwand
  calm: 0.00005,  // Gelenktempo (kein Zappeln beim Aufstehen)
  successUp: 0.9,   // aufrecht genug
  successH: 0.72,   // hoch genug (relativ zur Standhöhe h0)
  successHold: 0.8, // …so lange gehalten (s)
  successBonus: 4.0,
  timeout: 12.0,  // Episoden-Limit (s)
  dropMin: 0.9,   // Abwurfhöhe min (über der Standhöhe)
  dropMax: 2.0,   // Abwurfhöhe max
};

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Recovery-Task: mode 'getup' (liegend starten) oder 'drop' (in der Luft
 * starten). Beide teilen Beobachtung + Belohnung — nur der Startzustand
 * und die Erfolgsvoraussetzung unterscheiden sich.
 */
export function makeRecoveryTask(cfg, mode = 'getup') {
  const nu = cfg.nu;
  const span = cfg.actSpan;
  const R = RECOVERY_R;
  // v2.8.0 Sensorblock — identische Konvention wie makeTrackTask (v2.7.0)
  const nFeet = Array.isArray(cfg.footBodies) ? cfg.footBodies.length : 0;
  const sensDim = 9 + nFeet;
  return {
    kind: 'recovery',
    mode: mode === 'drop' ? 'drop' : 'getup',
    obsDim: 3 * nu + 8 + sensDim,
    actDim: nu,
    stepsLeft: Infinity, // trainCtrlStep ruft sonst sampleCmd — hier: keine Kommandos
    _tick: 0, // Phasen-Uhr (Zeitgefühl)
    lastAct: new Float64Array(nu),
    tElapsed: 0,
    _h0: 0.8,      // Standhöhe (aus dem Keyframe gemessen)
    _landed: false, // 'drop': erster Bodenkontakt passiert
    _okT: 0,       // Erfolg-Dauer (s)
    _prevT: 0,
    _q: new Float64Array(nu),
    _dq: new Float64Array(nu),
    _bq: new Float64Array(4),
    _bv: new Float64Array(3),
    _p: new Float64Array(3),
    _ref: new Float64Array(nu),

    sampleCmd() { /* keine Kommandos im Recovery */ },

    // Startzustand setzen: Keyframe → Gelenkrauschen → Basis umlegen
    // ('getup') bzw. in die Luft heben ('drop'). sim.data.time startet bei 0.
    reset(rng, sim) {
      if (!sim) return;
      sim.reset(); // Keyframe-Pose, alle Geschwindigkeiten 0
      sim.basePos(this._p);
      this._h0 = Math.max(0.2, this._p[2]);
      this.tElapsed = 0;
      this._landed = false;
      this._okT = 0;
      this._prevT = 0;
      this.lastAct.fill(0);
      for (let a = 0; a < nu; a++) this._ref[a] = sim.keyCtrl ? sim.keyCtrl[a] : 0;
      const rand = (a, b) => a + Math.random() * (b - a);
      // Gelenkrauschen um die Standpose (geklemt auf Aktuatorbereich) —
      // in qpos UND ctrl (sonst schlagen die Aktuatoren beim ersten Schritt zu)
      for (let a = 0; a < nu; a++) {
        const lo = sim.actRange ? sim.actRange[2 * a] : -2, hi = sim.actRange ? sim.actRange[2 * a + 1] : 2;
        const val = Math.min(hi, Math.max(lo, this._ref[a] + rand(-0.3, 0.3)));
        sim._qpos[sim.actQposAdr[a]] = val;
        sim.ctrl[a] = val;
      }
      const yaw = rand(-Math.PI, Math.PI);
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
      if (this.mode === 'drop') {
        // Abwurf: 0,9–2,0 m über der Standhöhe, leichte zufällige Neigung
        // (±0,45 rad) um eine lokale Achse — q = yawQuat ⊗ tiltQuat
        const h = this._h0 + rand(R.dropMin, R.dropMax);
        const tilt = rand(-0.45, 0.45);
        const ax = Math.random() < 0.5; // Neigung um lokale X oder Y
        const ct = Math.cos(tilt / 2), st = Math.sin(tilt / 2);
        // q = qyaw ⊗ qtilt (X-Achse: (cy·ct, cy·st, sy·st, sy·ct);
        //  Y-Achse: (cy·ct, −sy·st, cy·st, sy·ct)) — placeBaseFull normiert
        const qw = cy * ct;
        const qx = ax ? cy * st : -sy * st;
        const qy = ax ? sy * st : cy * st;
        const qz = sy * ct;
        sim.placeBaseFull(0, 0, h, qw, qx, qy, qz);
      } else {
        // Liegend: Rücken (tx≈π), Bauch (tx≈−π) oder Seite (ty≈±π/2)
        const v = Math.random();
        let tx = 0, ty = 0;
        if (v < 0.4) tx = Math.PI + rand(-0.25, 0.25);
        else if (v < 0.8) tx = -Math.PI + rand(-0.25, 0.25);
        else ty = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + rand(-0.2, 0.2));
        const cx = Math.cos(tx / 2), sx = Math.sin(tx / 2);
        const cyy = Math.cos(ty / 2), syy = Math.sin(ty / 2);
        // q = qyaw ⊗ (qx-Neigung ⊗ qy-Neigung); nur eine der beiden ist aktiv
        const tiltW = cx * cyy, tiltX = sx * cyy, tiltY = cx * syy, tiltZ = sx * syy;
        const qw = cy * tiltW - sy * tiltZ;
        const qx = cy * tiltX + sy * tiltY;
        const qy = cy * tiltY - sy * tiltX;
        const qz = cy * tiltZ + sy * tiltW;
        sim.placeBaseFull(0, 0, 0.3 * this._h0, qw, qx, qy, qz);
      }
      this._prevT = sim.data ? sim.data.time : 0;
    },

    observe(sim, out) {
      let o = 0;
      sim.jointPositions(this._q);
      sim.jointVelocities(this._dq);
      for (let i = 0; i < nu; i++) out[o++] = this._q[i] - this._ref[i];
      for (let i = 0; i < nu; i++) out[o++] = this._dq[i];
      sim.baseQuat(this._bq);
      const bq = this._bq, w = bq[0], x = bq[1], y = bq[2], z = bq[3];
      out[o++] = 2 * (x * z + w * y);       // Aufwärtsvektor (x, y, z)
      out[o++] = 2 * (y * z - w * x);
      out[o++] = 1 - 2 * (x * x + y * y);
      sim.basePos(this._p);
      out[o++] = this._p[2] / this._h0;     // normalisierte Höhe
      out[o++] = sim._qvel[5];              // Gier-Rate
      sim.baseVelWorld(this._bv);
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const c = Math.cos(yaw), s = Math.sin(yaw);
      out[o++] = c * this._bv[0] + s * this._bv[1];  // Körper-Tempo (vorwärts)
      out[o++] = -s * this._bv[0] + c * this._bv[1]; // (seitlich)
      out[o++] = this._bv[2];               // vertikal (Landung!)
      for (let i = 0; i < nu; i++) out[o++] = this.lastAct[i];
      // ── v2.8.0 SENSORBLOCK (wie Track-Task v2.7.0) ──
      sim.gyroBody(this._gy || (this._gy = new Float64Array(3)));
      out[o++] = this._gy[0]; out[o++] = this._gy[1]; out[o++] = this._gy[2];
      sim.projectedGravity(this._pg || (this._pg = new Float64Array(3)));
      out[o++] = this._pg[0]; out[o++] = this._pg[1]; out[o++] = this._pg[2];
      out[o++] = this._p[2];                // absolute Höhe (IMU-Baro-Proxy)
      if (nFeet) {
        sim.footContacts(this._fc || (this._fc = new Float64Array(nFeet)));
        for (let f = 0; f < nFeet; f++) out[o++] = this._fc[f] ? 1 : 0;
      }
      // Phasen-Uhr (Zeitgefühl): Takt der eigenen Gangart, sin/cos kodiert
      this._tick = (this._tick || 0) + 1;
      const ph = (this._tick * 0.02 * (cfg.gaitFreq || 1.2)) % 1;
      out[o++] = Math.sin(2 * Math.PI * ph);
      out[o++] = Math.cos(2 * Math.PI * ph);
      return o;
    },

    reward(sim) {
      // NaN-Wache: Physik-Explosion → Episode sauber beenden
      sim.jointPositions(this._q);
      let s = 0;
      for (let i = 0; i < nu; i++) s += Math.abs(this._q[i]);
      if (!Number.isFinite(s)) return { r: 0, done: true };
      sim.baseQuat(this._bq);
      sim.basePos(this._p);
      const bq = this._bq, x = bq[1], y = bq[2];
      const upz = 1 - 2 * (x * x + y * y);
      const h = this._p[2];
      const t = sim.data ? sim.data.time : 0;
      const dt = Math.max(0, Math.min(0.1, t - this._prevT));
      this._prevT = t;
      this.tElapsed = t;
      // 'drop': Bodenkontakt markieren — Erfolg zählt erst danach
      if (this.mode === 'drop' && !this._landed && h < 0.55 * this._h0) this._landed = true;
      const eligible = this.mode === 'drop' ? this._landed : true;
      // Belohnung: aufstehen zahlt (liegend −0,5 … stehend +1,5)
      let r = R.up * upz + R.upSq * Math.max(0, upz) * Math.max(0, upz);
      r += R.height * Math.exp(-Math.pow((h - this._h0) / R.hScale, 2));
      r += R.alive;
      let dq2 = 0;
      for (let i = 0; i < nu; i++) dq2 += this._dq[i] * this._dq[i];
      r -= R.calm * dq2;
      let e = 0;
      for (let i = 0; i < nu; i++) e += this.lastAct[i] * this.lastAct[i];
      r -= R.energy * e;
      // Erfolg: aufrecht + hoch, GEHALTEN (dt-summiert, kein Ein-Frames-Zufall)
      let done = false;
      if (eligible && upz > R.successUp && h > R.successH * this._h0) {
        this._okT += dt;
        if (this._okT > R.successHold) { r += R.successBonus; done = true; }
      } else this._okT = 0;
      if (t > R.timeout) done = true;
      return { r, done };
    },

    actionToCtrl(sim, act) {
      // Rest-Aktion um die STAND-Pose (Keyframe) — wie beim Lauftraining
      for (let a = 0; a < nu; a++) {
        sim.ctrl[a] = this._ref[a] + span * Math.tanh(act[a]);
      }
    },
  };
}
