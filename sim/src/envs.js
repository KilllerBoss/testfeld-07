/* Testfeld·07 — Umgebungen (deterministische Kernphysik)
 *
 * Diese Datei ist der EINZIGE Wahrheitsquelle für Env-Mathematik.
 * Der Kaggle-Spiegel (kaggle/train_*.py) implementiert exakt dieselben
 * Formeln in derselben Reihenfolge. Gilt:
 *   gleicher Seed + gleiche Gewichte → gleicher Reward (Toleranz 1e-6,
 *   real ~1e-12; Restdifferenz kommt von libm-1-ulp-Unterschieden in sin/cos).
 *
 * Kein DOM, kein Renderer — reine Logik (läuft in Node für Tests).
 */
(function (global) {
  'use strict';
  var TF = global.TF07 = global.TF07 || {};

  var DT = 1 / 30;            // Env-Fixed-Step (30 Hz)
  var ARENA_HALF = 10;        // Arena 20×20 m
  var RAY_LEN = 4.0;          // Duck-Sensorreichweite
  var N_RAYS = 9;
  var RAY_SPREAD = 100 * Math.PI / 180;  // ±100° Gesamtfächer
  var DUCK_R = 0.22;          // Duck-Kollisionsradius
  var WHEEL_R = 0.12, WHEEL_B = 0.14, W_MAX = 4.0;
  var N_OBS = 12;             // Hindernis-Zylinder
  var EP_DUCK = 600;          // 20 s

  var ARM = { L1: 0.55, L2: 0.45, L3: 0.25, HB: 0.5, VMAX: 1.6,
              Q1: 2.9, Q2: 1.4, Q3: 2.2, Q4: 1.6, BALL_R: 0.09,
              EP: 450, GRIP_D: 0.14, DELIVER_D: 0.25 };
  ARM.DZ = [0.75, ARM.BALL_R, -0.75]; // Abgabezone (fix, aus Obs ableitbar)

  var HUM = { H: 0.85, G: 9.81, EP: 600, LEAN: 0.12, STEP_T: 0.7 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  TF.clamp = clamp;

  /* ============================ MICRODUCK ============================
   * Differential-Drive, 9 Strahl-Sensoren, Zielsuche zwischen 12 Zylindern.
   * obs(12): 9×Ray(normalisiert), sin/cos(relWinkel), dist/12
   * act(2):  Radgeschwindigkeiten normalisiert [-1,1] → ±4 rad/s
   * Reward: 5×Fortschritt − 0.1×Kollision + 25×Ziel
   */
  function DuckEnv(seed) { this.reset(seed === undefined ? 1 : seed); }

  DuckEnv.prototype.reset = function (seed) {
    var rng = TF.makeRng(seed >>> 0);
    this.rngSeed = seed >>> 0;
    this.rng = rng;
    // Hindernisse: Rejection-Sampling (x,z ≥ 2.5 m vom Zentrum), dann r,h
    this.obsP = [];
    for (var i = 0; i < N_OBS; i++) {
      var x, z, d;
      do {
        x = rng.uniform(-8.5, 8.5); z = rng.uniform(-8.5, 8.5);
        d = Math.sqrt(x * x + z * z);
      } while (d < 2.5);
      var r = rng.uniform(0.35, 0.85);
      var h = rng.uniform(0.8, 1.4);
      this.obsP.push({ x: x, z: z, r: r, h: h });
    }
    this.x = 0; this.z = 0;
    this.heading = rng.uniform(-Math.PI, Math.PI);
    this.steps = 0; this.fit = 0; this.reached = 0; this.collision = false;
    this.rays = new Float64Array(N_RAYS);
    this._newTarget(rng);
    this._updateDist();
    this.prevDist = this.dist;
    this._snap();
    return this.getObs();
  };

  DuckEnv.prototype._newTarget = function (rng) {
    for (;;) {
      var tx = rng.uniform(-8.5, 8.5), tz = rng.uniform(-8.5, 8.5);
      var dx = tx - this.x, dz = tz - this.z;
      if (Math.sqrt(dx * dx + dz * dz) <= 3.0) continue;
      var ok = true;
      for (var i = 0; i < this.obsP.length; i++) {
        var o = this.obsP[i];
        var ax = tx - o.x, az = tz - o.z;
        if (Math.sqrt(ax * ax + az * az) <= o.r + 0.6) { ok = false; break; }
      }
      if (ok) { this.tx = tx; this.tz = tz; return; }
    }
  };

  DuckEnv.prototype._updateDist = function () {
    var dx = this.tx - this.x, dz = this.tz - this.z;
    this.dist = Math.sqrt(dx * dx + dz * dz);
  };

  DuckEnv.prototype._computeRays = function () {
    var px = this.x, pz = this.z, half = ARENA_HALF;
    for (var i = 0; i < N_RAYS; i++) {
      var a = this.heading + (i - 4) / 4 * RAY_SPREAD;
      var dx = Math.cos(a), dz = Math.sin(a);
      var tMin = RAY_LEN;
      // Wände
      if (dx > 1e-12) { var t = (half - px) / dx; if (t >= 0 && t < tMin) tMin = t; }
      if (dx < -1e-12) { t = (-half - px) / dx; if (t >= 0 && t < tMin) tMin = t; }
      if (dz > 1e-12) { t = (half - pz) / dz; if (t >= 0 && t < tMin) tMin = t; }
      if (dz < -1e-12) { t = (-half - pz) / dz; if (t >= 0 && t < tMin) tMin = t; }
      // Zylinder (aufgebläht um DUCK_R — konsistent zur Kollision)
      for (var k = 0; k < this.obsP.length; k++) {
        var o = this.obsP[k];
        var rx = o.x - px, rz = o.z - pz;
        var to = rx * dx + rz * dz;
        if (to <= 0) continue;
        var c2 = rx * rx + rz * rz - to * to;
        var rr = o.r + DUCK_R;
        if (c2 < rr * rr) {
          var th = to - Math.sqrt(rr * rr - c2);
          if (th >= 0 && th < tMin) tMin = th;
        }
      }
      this.rays[i] = clamp(tMin / RAY_LEN, 0, 1);
    }
  };

  DuckEnv.prototype.getObs = function () {
    this._computeRays();
    var o = new Float64Array(12);
    for (var i = 0; i < N_RAYS; i++) o[i] = this.rays[i];
    var dx = this.tx - this.x, dz = this.tz - this.z;
    var d = Math.max(this.dist, 1e-9);
    var nx = dx / d, nz = dz / d;
    var fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    o[9] = clamp(fx * nz - fz * nx, -1, 1);   // sin(rel)
    o[10] = clamp(fx * nx + fz * nz, -1, 1);  // cos(rel)
    o[11] = clamp(this.dist / 12, 0, 1);
    return o;
  };

  DuckEnv.prototype._snap = function () {
    // Visueller Snapshot für Render-Interpolation (vor jedem step)
    if (!this.prev) this.prev = { x: 0, z: 0, heading: 0 };
    this.prev.x = this.x; this.prev.z = this.z; this.prev.heading = this.heading;
  };

  DuckEnv.prototype.step = function (a0, a1) {
    a0 = clamp(a0, -1, 1); a1 = clamp(a1, -1, 1);
    this._snap();
    var prevDist = this.dist;
    var vl = a0 * W_MAX, vr = a1 * W_MAX;
    var v = WHEEL_R * (vl + vr) / 2;
    var w = WHEEL_R * (vl - vr) / (2 * WHEEL_B);
    this.heading += w * DT;
    this.x += Math.cos(this.heading) * v * DT;
    this.z += Math.sin(this.heading) * v * DT;
    // Kollision: Zylinder
    this.collision = false;
    for (var i = 0; i < this.obsP.length; i++) {
      var ob = this.obsP[i];
      var dx = this.x - ob.x, dz = this.z - ob.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      var minD = ob.r + DUCK_R;
      if (d < minD) {
        if (d < 1e-9) { dx = 1; dz = 0; d = 1; }
        this.x = ob.x + dx / d * minD;
        this.z = ob.z + dz / d * minD;
        this.collision = true;
      }
    }
    // Kollision: Wände
    var lim = ARENA_HALF - 0.3;
    if (this.x > lim) { this.x = lim; this.collision = true; }
    if (this.x < -lim) { this.x = -lim; this.collision = true; }
    if (this.z > lim) { this.z = lim; this.collision = true; }
    if (this.z < -lim) { this.z = -lim; this.collision = true; }

    this._updateDist();
    var r = 5.0 * (prevDist - this.dist) + (this.collision ? -0.1 : 0.0);
    if (this.dist < 0.5) {
      r += 25.0; this.reached++;
      this._newTarget(this.rng);
      this._updateDist();
    }
    this.fit += r;
    this.prevDist = this.dist;
    this.steps++;
    return { reward: r, done: this.steps >= EP_DUCK };
  };

  /* ============================= ARMBOT =============================
   * 4 Achsen (Basis-Gier, Schulter, Ellbogen, Handgelenk) + Greifer.
   * FK kumulativ aus der Vertikalen; Ziel: Ball greifen → zur Zone tragen.
   * obs(15): 4×q/Limit, 4×dq/VMAX, (ball−ee)/2, ee/2, Greifer
   * act(5):  4×dq normalisiert, Greifer (>0 = zu)
   * Reward: 4×Annäherung (+2 Greifen) / 4×Zonen-Annäherung (+25 Abgabe)
   */
  function ArmEnv(seed) { this.reset(seed === undefined ? 1 : seed); }

  ArmEnv.prototype.reset = function (seed) {
    var rng = TF.makeRng(seed >>> 0);
    this.rngSeed = seed >>> 0;
    this.rng = rng;
    this.q = [0, 0.35, -0.7, 0];
    this.dq = [0, 0, 0, 0];
    this.holding = false;
    this.steps = 0; this.fit = 0; this.delivered = 0;
    this._newBall(rng);
    this.fk();
    this.prevEB = this._d3(this.ee, this.ball);
    this.prevBD = 0;
    this._snap();
    return this.getObs();
  };

  ArmEnv.prototype._newBall = function (rng) {
    var ang = rng.uniform(-Math.PI, Math.PI);
    var rad = rng.uniform(0.75, 1.05);
    this.ball = [rad * Math.cos(ang), ARM.BALL_R, rad * Math.sin(ang)];
  };

  ArmEnv.prototype._d3 = function (a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  ArmEnv.prototype.fk = function () {
    var t1 = this.q[1], t2 = this.q[1] + this.q[2], t3 = t2 + this.q[3];
    var px = Math.sin(t1) * ARM.L1 + Math.sin(t2) * ARM.L2 + Math.sin(t3) * ARM.L3;
    var py = ARM.HB + Math.cos(t1) * ARM.L1 + Math.cos(t2) * ARM.L2 + Math.cos(t3) * ARM.L3;
    var cx = Math.cos(this.q[0]), cz = Math.sin(this.q[0]);
    this.ee = [px * cx, py, px * cz];
    this.j1 = [Math.sin(t1) * ARM.L1 * cx, ARM.HB + Math.cos(t1) * ARM.L1, Math.sin(t1) * ARM.L1 * cz];
    var p2 = Math.sin(t1) * ARM.L1 + Math.sin(t2) * ARM.L2;
    var y2 = ARM.HB + Math.cos(t1) * ARM.L1 + Math.cos(t2) * ARM.L2;
    this.j2 = [p2 * cx, y2, p2 * cz];
  };

  ArmEnv.prototype.getObs = function () {
    var o = new Float64Array(15);
    o[0] = this.q[0] / ARM.Q1; o[1] = this.q[1] / ARM.Q2;
    o[2] = this.q[2] / ARM.Q3; o[3] = this.q[3] / ARM.Q4;
    for (var i = 0; i < 4; i++) o[4 + i] = this.dq[i] / ARM.VMAX;
    o[8] = (this.ball[0] - this.ee[0]) / 2;
    o[9] = (this.ball[1] - this.ee[1]) / 2;
    o[10] = (this.ball[2] - this.ee[2]) / 2;
    o[11] = this.ee[0] / 2; o[12] = this.ee[1] / 2; o[13] = this.ee[2] / 2;
    o[14] = this.holding ? 1 : 0;
    return o;
  };

  ArmEnv.prototype._snap = function () {
    if (!this.prev) this.prev = { q: [0, 0, 0, 0], ball: [0, 0, 0] };
    for (var i = 0; i < 4; i++) this.prev.q[i] = this.q[i];
    for (i = 0; i < 3; i++) this.prev.ball[i] = this.ball[i];
  };

  ArmEnv.prototype.step = function (a0, a1, a2, a3, a4) {
    this._snap();
    var acts = [a0, a1, a2, a3];
    var ranges = [ARM.Q1, ARM.Q2, ARM.Q3, ARM.Q4];
    for (var i = 0; i < 4; i++) {
      var a = clamp(acts[i], -1, 1);
      this.dq[i] = a * ARM.VMAX;
      this.q[i] = clamp(this.q[i] + this.dq[i] * DT, -ranges[i], ranges[i]);
    }
    var gripClosed = clamp(a4, -1, 1) > 0;
    this.fk();
    var r = 0.0;
    // Loslassen / Halten prüfen
    if (this.holding && !gripClosed) {
      this.holding = false;
      if (this.ball[1] < ARM.BALL_R) this.ball[1] = ARM.BALL_R;
      this.prevEB = this._d3(this.ee, this.ball);
    } else if (!this.holding && gripClosed && this._d3(this.ee, this.ball) < ARM.GRIP_D) {
      this.holding = true;
      r += 2.0;
      this.prevBD = this._d3(this.ball, ARM.DZ);
    }
    if (this.holding) {
      this.ball = [this.ee[0], this.ee[1] - 0.06, this.ee[2]];
      var dBD = this._d3(this.ball, ARM.DZ);
      r += 4.0 * (this.prevBD - dBD);
      this.prevBD = dBD;
      if (dBD < ARM.DELIVER_D) {
        r += 25.0; this.delivered++;
        this.holding = false;
        this._newBall(this.rng);
        this.prevEB = this._d3(this.ee, this.ball);
      }
    } else {
      var dEB = this._d3(this.ee, this.ball);
      r += 4.0 * (this.prevEB - dEB);
      this.prevEB = dEB;
    }
    this.fit += r;
    this.steps++;
    return { reward: r, done: this.steps >= ARM.EP };
  };

  /* ============================ HUMANOID ============================
   * Pendel-Balance-Läufer: Lineares inverted Pendulum (Höhe 0.85),
   * Schrittwechsel setzt Stützpunkt voraus (Capture-Punkt + Schrittweite).
   * obs(10): rel/0.3, vx/1.5, sin/cos(2πτ), 4×Gelenke, lean/0.12, dist/8
   * act(5):  lean, hipL, kneeL, hipR, kneeR (normalisiert)
   * Reward: 1.4×vx + 0.4 − 0.6×|rel| (+25 Ziel, −40 Sturz)
   */
  function HumanoidEnv(seed) { this.reset(seed === undefined ? 1 : seed); }

  HumanoidEnv.prototype._newTarget = function (rng) {
    var ang = rng.uniform(-Math.PI, Math.PI);
    var d = rng.uniform(4, 8);
    this.tx = this.px + Math.cos(ang) * d;
    this.tz = this.pz + Math.sin(ang) * d;
    this.dirX = Math.cos(ang); this.dirZ = Math.sin(ang);
    this.targetDist = d;
  };

  HumanoidEnv.prototype.reset = function (seed) {
    var rng = TF.makeRng(seed >>> 0);
    this.rngSeed = seed >>> 0;
    this.rng = rng;
    this.px = 0; this.pz = 0;
    this.vx = 0; this.x = 0; this.s = -0.02;
    this.tau = 0; this.side = 1;
    this.lean = 0;
    this.hipL = -0.2; this.kneeL = 0.1; this.hipR = 0.2; this.kneeR = 0.1;
    this.steps = 0; this.fit = 0; this.reached = 0; this.fallen = false;
    this._newTarget(rng);
    this.rel = this.x - (this.s + this.lean * 2.5);
    this._snap();
    return this.getObs();
  };

  HumanoidEnv.prototype.getObs = function () {
    var o = new Float64Array(10);
    var twoPiTau = 2 * Math.PI * this.tau;
    o[0] = clamp(this.rel / 0.3, -1.5, 1.5);
    o[1] = this.vx / 1.5;
    o[2] = Math.sin(twoPiTau); o[3] = Math.cos(twoPiTau);
    o[4] = this.hipL / 0.8; o[5] = this.kneeL / 0.6;
    o[6] = this.hipR / 0.8; o[7] = this.kneeR / 0.6;
    o[8] = this.lean / HUM.LEAN;
    o[9] = clamp(this.targetDist / 8, 0, 1.5);
    return o;
  };

  // a = [lean, hipL, kneeL, hipR, kneeR] je in [-1,1]
  HumanoidEnv.prototype._snap = function () {
    if (!this.prev) this.prev = { px: 0, pz: 0, dirX: 1, dirZ: 0, lean: 0, hipL: 0, kneeL: 0, hipR: 0, kneeR: 0 };
    var p = this.prev;
    p.px = this.px; p.pz = this.pz; p.dirX = this.dirX; p.dirZ = this.dirZ;
    p.lean = this.lean; p.hipL = this.hipL; p.kneeL = this.kneeL;
    p.hipR = this.hipR; p.kneeR = this.kneeR;
  };

  HumanoidEnv.prototype.step = function (a) {
    this._snap();
    var leanT = clamp(a[0], -1, 1) * HUM.LEAN;
    var hipLT = clamp(a[1], -1, 1) * 0.8;
    var kneeLT = 0.6 * clamp((clamp(a[2], -1, 1) + 1) / 2, 0, 1);
    var hipRT = clamp(a[3], -1, 1) * 0.8;
    var kneeRT = 0.6 * clamp((clamp(a[4], -1, 1) + 1) / 2, 0, 1);
    var k1 = Math.min(1, 8 * DT), k2 = Math.min(1, 10 * DT);
    this.lean += (leanT - this.lean) * k1;
    this.hipL += (hipLT - this.hipL) * k2; this.kneeL += (kneeLT - this.kneeL) * k2;
    this.hipR += (hipRT - this.hipR) * k2; this.kneeR += (kneeRT - this.kneeR) * k2;

    this.tau += DT / HUM.STEP_T;
    if (this.tau >= 1) {
      this.tau -= 1;
      this.side = -this.side;
      var swingHipA = (this.side === 1) ? a[3] : a[1];
      var SL = 0.15 + 0.30 * clamp((clamp(swingHipA, -1, 1) + 1) / 2, 0, 1);
      this.s = this.x + 0.29 * this.vx + 0.1 * SL;
    }
    var sEff = this.s + this.lean * 2.5;
    var W2 = HUM.G / HUM.H;
    var ax = W2 * (this.x - sEff);
    this.vx += ax * DT;
    this.x += this.vx * DT;
    this.rel = this.x - sEff;
    this.px += this.dirX * this.vx * DT;
    this.pz += this.dirZ * this.vx * DT;
    this.targetDist -= this.vx * DT;

    var r = 1.4 * this.vx + 0.4 - 0.6 * Math.abs(this.rel);
    var done = false;
    if (Math.abs(this.rel) > 0.42 || Math.abs(this.vx) > 2.2) {
      r -= 40.0; this.fallen = true; done = true;
    } else if (this.targetDist < 0.6) {
      r += 25.0; this.reached++;
      this._newTarget(this.rng);
    }
    this.fit += r;
    this.steps++;
    if (!done && this.steps >= HUM.EP) done = true;
    return { reward: r, done: done };
  };

  TF.DT = DT; TF.ARENA_HALF = ARENA_HALF; TF.RAY_LEN = RAY_LEN;
  TF.N_RAYS = N_RAYS; TF.RAY_SPREAD = RAY_SPREAD; TF.DUCK_R = DUCK_R;
  TF.WHEEL_R = WHEEL_R; TF.WHEEL_B = WHEEL_B; TF.N_OBS = N_OBS;
  TF.ARM = ARM; TF.HUM = HUM;
  TF.DuckEnv = DuckEnv; TF.ArmEnv = ArmEnv; TF.HumanoidEnv = HumanoidEnv;

  TF.makeEnv = function (robot, seed) {
    if (robot === 'duck') return new DuckEnv(seed);
    if (robot === 'arm') return new ArmEnv(seed);
    if (robot === 'humanoid') return new HumanoidEnv(seed);
    throw new Error('Unbekannter Roboter: ' + robot);
  };

  TF.EP_LEN = { duck: EP_DUCK, arm: ARM.EP, humanoid: HUM.EP };
})(typeof window !== 'undefined' ? window : globalThis);
