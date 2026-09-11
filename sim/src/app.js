/* Testfeld·07 — App-Kern: Loop, Modi (MANUELL/POLICY/TRAIN), Neuroevolution,
 * Kamera, Konsole, Gemini-Brücke, Android-JS-Bridge, Persistenz. */
(function (global) {
  'use strict';
  var TF = global.TF07 = global.TF07 || {};
  var clamp = TF.clamp;

  var COLOR_CHOICES = [
    { css: '#ff7a2f', rgb: [1.0, 0.478, 0.184] },
    { css: '#ffd23f', rgb: [1.0, 0.82, 0.25] },
    { css: '#3fd2c7', rgb: [0.25, 0.82, 0.78] },
    { css: '#c792ea', rgb: [0.78, 0.57, 0.92] },
    { css: '#e8e4da', rgb: [0.91, 0.89, 0.85] }
  ];

  var TOD = {
    day:    { bg: [0.52, 0.58, 0.66], fog: 0.006, light: [1.0, 0.98, 0.90], sky: [0.50, 0.55, 0.62], gnd: [0.25, 0.23, 0.20], dir: [0.45, 0.8, 0.35] },
    sunset: { bg: [0.72, 0.40, 0.24], fog: 0.009, light: [1.0, 0.62, 0.36], sky: [0.50, 0.30, 0.26], gnd: [0.24, 0.18, 0.15], dir: [0.6, 0.45, 0.3] },
    night:  { bg: [0.02, 0.025, 0.05], fog: 0.012, light: [0.28, 0.33, 0.48], sky: [0.09, 0.11, 0.17], gnd: [0.03, 0.03, 0.05], dir: [-0.3, 0.75, -0.4] }
  };

  var CAM_DEF = {
    duck: { yaw: 2.4, pitch: 0.55, dist: 5.5, ty: 0.4 },
    arm: { yaw: 0.8, pitch: 0.42, dist: 3.6, ty: 0.7 },
    humanoid: { yaw: 2.4, pitch: 0.5, dist: 4.6, ty: 0.9 }
  };

  function app() {
    var S = this.state = {
      robot: 'duck', mode: 'manual', tod: 'day',
      colorIdx: 0, showRays: true, gripClosed: false,
      champions: { duck: null, arm: null, humanoid: null, duckmj: null, armmj: null, op3mj: null }, // {genome, gen, fit, src}
      training: { active: false, robot: 'duck', gens: 0, gen: 0, batchIdx: 0,
        pop: null, fits: null, envs: [], genomes: [], batchFits: null,
        history: [], bestFit: null, avgFit: null, champFit: null, champGenome: null, baseSeed: 1000 },
      // Echtes MuJoCo (WASM) + Werks-ONNX-Policies des HF-Space
      // + Menagerie-Roboter: arm = WidowX 250, hum = ROBOTIS OP3
      mjc: { ready: false, err: null, duck: null, slot: 'walk', ghosts: [], ghostRigs: [], mjRig: null, mjFrame: null,
        arm: null, armRig: null, hum: null, humRig: null, humMode: 'stehen' },
      fps: 0
    };
    this.joystick = { x: 0, y: 0 };
    this.COLOR_CHOICES = COLOR_CHOICES;

    /* ---------- Persistenz ---------- */
    var LS = 'tf07.v1';
    function save() {
      try {
        var pol = {};
        for (var k in S.champions) pol[k] = S.champions[k] ? TF.nn.genomeToPolicy(S.champions[k].genome, k, S.champions[k].gen, S.champions[k].fit, S.champions[k].src) : null;
        global.localStorage.setItem(LS, JSON.stringify({
          champions: pol,
          settings: { robot: S.robot, mode: S.mode, tod: S.tod, colorIdx: S.colorIdx, showRays: S.showRays }
        }));
      } catch (e) { /* Offline-/Privatmodus: ignorieren */ }
    }
    function load() {
      try {
        var raw = global.localStorage.getItem(LS);
        if (!raw) return;
        var d = JSON.parse(raw);
        for (var k in (d.champions || {})) {
          var p = d.champions[k];
          if (!p) continue;
          var v = TF.nn.validatePolicy(p);
          if (v.ok) S.champions[k] = { genome: v.genome, gen: p.gen || 0, fit: p.fit || 0, src: p.src || 'import' };
        }
        var st = d.settings || {};
        if (st.robot) S.robot = st.robot;
        if (st.mode) S.mode = st.mode;
        if (st.tod) S.tod = st.tod;
        if (typeof st.colorIdx === 'number') S.colorIdx = st.colorIdx;
        if (typeof st.showRays === 'boolean') S.showRays = st.showRays;
      } catch (e) { /* korrupte Daten: ignorieren */ }
    }
    this.save = save;

    /* ---------- Renderer & Welten ---------- */
    var canvas = global.document.getElementById('gl');
    var renderer = new TF.render.Renderer(canvas);
    this.renderer = renderer;
    var lib = new TF.views.MeshLib(renderer.gl);

    var envs = {
      duck: new TF.DuckEnv(1),
      arm: new TF.ArmEnv(1),
      humanoid: new TF.HumanoidEnv(1)
    };
    var worlds = {};
    var self = this;
    ['duck', 'arm', 'humanoid'].forEach(function (r) {
      var arena = TF.views.buildArena(lib, r === 'duck' ? envs.duck : null, r);
      var rig = r === 'duck' ? TF.views.DuckRig(lib, {}) : r === 'arm' ? TF.views.ArmRig(lib, {}) : TF.views.HumanoidRig(lib, {});
      arena.add(rig.root);
      var target = TF.views.buildTarget(lib);
      arena.add(target.root);
      worlds[r] = { arena: arena, rig: rig, target: target };
    });
    var ghostRigs = [];
    this.worlds = worlds; this.envs = envs;

    /* ---------- MuJoCo-Frames (MJCF ist Z-up, Renderer Y-up) ---------- */
    var mjFrame = new TF.render.Node();
    mjFrame.quat = [-0.7071067811865476, 0, 0, 0.7071067811865476];
    mjFrame.visible = false;
    worlds.duck.arena.add(mjFrame);
    S.mjc.mjFrame = mjFrame;
    // Eigene Frames für die Menagerie-Roboter (Arm-Tisch = Werkstatt-Bodenniveau)
    var armFrame = new TF.render.Node();
    armFrame.quat = [-0.7071067811865476, 0, 0, 0.7071067811865476];
    armFrame.visible = false;
    worlds.arm.arena.add(armFrame);
    var humFrame = new TF.render.Node();
    humFrame.quat = [-0.7071067811865476, 0, 0, 0.7071067811865476];
    humFrame.visible = false;
    worlds.humanoid.arena.add(humFrame);
    // Physik-Bälle (MJCF-Ball) in den Frames — Position wird pro Frame gesetzt
    var armBallNode = new TF.render.Node(lib.unitSphere, [0.95, 0.5, 0.16, 1]);
    armBallNode.scale = [0.05, 0.05, 0.05];
    armFrame.add(armBallNode);
    var humBallNode = new TF.render.Node(lib.unitSphere, [0.95, 0.5, 0.16, 1]);
    humBallNode.scale = [0.05, 0.05, 0.05];
    humFrame.add(humBallNode);

    /* ---------- Render-Interpolation: Physik fix 30 Hz, Grafik Display-Rate.
     * visFor() mischt prev→currzustand mit alpha = akkumulierte Restzeit/DT.
     * Determinismus bleibt unangetastet — nur die ANZEIGE interpoliert. */
    var visCache = { duck: { rays: null }, arm: {}, humanoid: {} };
    function lp(a, b, t) { a = +a; b = +b; return a + (b - a) * t; }
    function visFor(robot, env, alpha) {
      var v = visCache[robot], p = env.prev || env;
      if (robot === 'duck') {
        v.x = lp(p.x, env.x, alpha); v.z = lp(p.z, env.z, alpha);
        v.heading = lp(p.heading, env.heading, alpha);
        v.rays = env.rays;
      } else if (robot === 'arm') {
        v.q = v.q || [0, 0, 0, 0];
        for (var i = 0; i < 4; i++) v.q[i] = lp(p.q[i], env.q[i], alpha);
        v.ball = v.ball || [0, 0, 0];
        for (i = 0; i < 3; i++) v.ball[i] = lp(p.ball[i], env.ball[i], alpha);
        v.gripOpen = env.gripOpen;
      } else {
        v.px = lp(p.px, env.px, alpha); v.pz = lp(p.pz, env.pz, alpha);
        v.dirX = lp(p.dirX, env.dirX, alpha); v.dirZ = lp(p.dirZ, env.dirZ, alpha);
        v.lean = lp(p.lean, env.lean, alpha);
        v.hipL = lp(p.hipL, env.hipL, alpha); v.kneeL = lp(p.kneeL, env.kneeL, alpha);
        v.hipR = lp(p.hipR, env.hipR, alpha); v.kneeR = lp(p.kneeR, env.kneeR, alpha);
        v.tau = env.tau; v.side = env.side; v.fallen = env.fallen;
      }
      return v;
    }

    /* ---------- Kamera ---------- */
    var cam = this.cam = { yaw: CAM_DEF[S.robot].yaw, pitch: CAM_DEF[S.robot].pitch, dist: CAM_DEF[S.robot].dist };
    var pointers = {}, pinchD0 = 0, dist0 = 0;
    canvas.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      var ids = Object.keys(pointers);
      if (!pointers[e.pointerId]) return;
      if (ids.length === 1) {
        var p = pointers[e.pointerId];
        cam.yaw -= (e.clientX - p[0]) * 0.006;
        cam.pitch = clamp(cam.pitch + (e.clientY - p[1]) * 0.005, 0.12, 1.4);
        pointers[e.pointerId] = [e.clientX, e.clientY];
      } else if (ids.length === 2) {
        var old = pinchDist();
        pointers[e.pointerId] = [e.clientX, e.clientY];
        var neu = pinchDist();
        if (old > 0 && neu > 0) cam.dist = clamp(cam.dist * old / neu, 1.6, 32);
      }
    });
    function pinchDist() {
      var ids = Object.keys(pointers);
      if (ids.length !== 2) return -1;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
    }
    function pUp(e) { delete pointers[e.pointerId]; }
    canvas.addEventListener('pointerup', pUp);
    canvas.addEventListener('pointercancel', pUp);
    canvas.addEventListener('wheel', function (e) {
      cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 1.6, 32);
      e.preventDefault();
    }, { passive: false });

    /* ---------- Audio (Quack/Klick, synthetisch) ---------- */
    var ac = null;
    function beep(f0, f1, t, type) {
      try {
        ac = ac || new (global.AudioContext || global.webkitAudioContext)();
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(f0, ac.currentTime);
        o.frequency.exponentialRampToValueAtTime(f1, ac.currentTime + t);
        g.gain.setValueAtTime(0.06, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t);
        o.connect(g); g.connect(ac.destination);
        o.start(); o.stop(ac.currentTime + t);
      } catch (e) { /* Audio optional */ }
    }
    this.quack = function () { beep(880, 460, 0.09); global.setTimeout(function () { beep(760, 380, 0.11); }, 110); };
    this.click = function () { beep(1400, 1200, 0.03, 'triangle'); };

    /* ---------- manuelle Steuerung ---------- */
    var ik = { px: 0.75, py: 0.7 };
    this.toggleGrip = function () { S.gripClosed = !S.gripClosed; TF.ui.status(S.gripClosed ? 'Greifer: ZU' : 'Greifer: OFFEN'); };

    function manualActions(env) {
      var jx = self.joystick.x, jy = self.joystick.y;
      if (S.robot === 'duck') {
        var fwd = clamp(jy, -1, 1), turn = clamp(jx, -1, 1);
        return [clamp(fwd + turn, -1, 1), clamp(fwd - turn, -1, 1)];
      }
      if (S.robot === 'arm') {
        // IK-Ziel aus Joystick; Basis-Yaw zielt automatisch auf den Ball
        ik.px = clamp(0.75 + jx * 0.45, 0.2, 1.18);
        ik.py = clamp(0.7 + jy * 0.55, 0.12, 1.3);
        var qT = solveIK(env, ik.px, ik.py);
        var a = [];
        for (var i = 0; i < 4; i++) a.push(clamp((qT[i] - env.q[i]) / TF.DT / TF.ARM.VMAX, -1, 1));
        a.push(S.gripClosed ? 1 : -1);
        return a;
      }
      // Humanoid: Prozeduraler Gang + Balance-Heuristik
      var vT = clamp(jy, -1, 1) * 0.8;
      var swing = Math.sin(2 * Math.PI * env.tau);
      var supL = env.side === 1;
      var amp = 0.55 * Math.min(1, Math.abs(vT) / 0.4 + 0.25);
      var a0 = clamp(2.0 * (env.rel - 0.12) + 0.2 * (vT - env.vx), -1, 1);
      function hipA(x) { return clamp(x / 0.8, -1, 1); }
      function kneeA(x) { return clamp(2 * clamp(x / 0.6, 0, 1) - 1, -1, 1); }
      var hipSw = hipA(amp * swing), hipSup = hipA(-0.15);
      var kSw = kneeA(0.3 * (0.5 + 0.5 * swing)), kSup = kneeA(0.12);
      return [a0,
        supL ? hipSup : hipSw, supL ? kSup : kSw,
        supL ? hipSw : hipSup, supL ? kSw : kSup];
    }

    // Numerisches IK (Jacobian-Transpose, nur für den manuellen Modus)
    function solveIK(env, tx, ty) {
      var q = [env.q[1], env.q[2], env.q[3]];
      var L = [TF.ARM.L1, TF.ARM.L2, TF.ARM.L3];
      function fk(qq) {
        var px = 0, py = TF.ARM.HB;
        for (var i = 0; i < 3; i++) {
          var acc = 0; for (var k = 0; k <= i; k++) acc += qq[k];
          px += Math.sin(acc) * L[i]; py += Math.cos(acc) * L[i];
        }
        return [px, py];
      }
      for (var it = 0; it < 28; it++) {
        var p = fk(q), ex = tx - p[0], ey = ty - p[1];
        if (ex * ex + ey * ey < 1e-8) break;
        var J = [];
        for (var ii = 0; ii < 3; ii++) {
          var q2 = q.slice(); q2[ii] += 1e-4;
          var pp = fk(q2);
          J.push([(pp[0] - p[0]) / 1e-4, (pp[1] - p[1]) / 1e-4]);
        }
        for (ii = 0; ii < 3; ii++) {
          var dq = 0.5 * (J[ii][0] * ex + J[ii][1] * ey);
          q[ii] = clamp(q[ii] + dq, [-TF.ARM.Q2, -TF.ARM.Q3, -TF.ARM.Q4][ii], [TF.ARM.Q2, TF.ARM.Q3, TF.ARM.Q4][ii]);
        }
      }
      return [env.q[0], q[0], q[1], q[2]];
    }

    /* ---------- MuJoCo: Boot, Fahrlogik, Training ---------- */
    function mjcBoot() {
      if (!TF.mjc || !TF.mjc.init) { TF.ui.setEngineBadge('fail'); return; }
      TF.ui.setEngineBadge('load');
      var mjOnly = /mjonly/.test(global.location.search); // Headless-Testmodus: kein Rendering
      TF.mjc.init(function (stg) { TF.ui.logLine('MJ › ' + stg, 'sys'); })
        .then(function () {
          S.mjc.ready = true;
          S.mjc.duck = TF.mjc.makeDuck();
          S.mjc.mjRig = TF.mjc.makeSkeletonRig(TF.render, lib, false);
          mjFrame.add(S.mjc.mjRig.root);
          var info = TF.mjc.info();
          TF.ui.setEngineBadge('ok');
          TF.ui.logLine('ECHTES MUJOCO AKTIV — Microduck (nq ' + info.nq + ', nu ' + info.nu + ') mit Original-Policies des HF-Space.', 'sys');
          TF.ui.logLine('Joystick = Lauf-Command · "POLICY"-Knopf wechselt LAUFEN → ROLLER → SIT·STAND · Trainieren: "trainiere den microduck 100 generationen"', 'sys');
          TF.ui.buildTopbar();
          if (mjOnly) {
            document.getElementById('bootVeil').classList.add('gone');
            setInterval(function () {
              var d = S.mjc.duck;
              if (!d.busy) {
                d.busy = true;
                d.controlStepAsync().catch(function () {}).then(function () { d.busy = false; });
              }
            }, 20);
          }
        })
        .catch(function (e) {
          S.mjc.err = (e && e.message) || String(e);
          TF.ui.setEngineBadge('fail');
          TF.ui.logLine('MuJoCo nicht verfügbar (' + S.mjc.err + ') — Werkstatt-Kern bleibt aktiv.', 'warn');
          TF.ui.logLine('Konsole: „version“ zeigt den Engine-Report.', 'warn');
        });
    }
    function mjDrive(dt) {
      var d = S.mjc.duck;
      var lim = d.velLims();
      d.setCmd(self.joystick.y * lim[0], 0, -self.joystick.x * lim[2]);
      if (!d.busy) {
        d.busy = true;
        d.controlStepAsync()
          .catch(function (e) { TF.ui.logLine('MJ-FEHLER: ' + e.message, 'warn'); })
          .then(function () { d.busy = false; });
      }
    }
    this.mjcCycleSlot = function () {
      var order = ['walk', 'drive', 'sitstand'];
      S.mjc.slot = order[(order.indexOf(S.mjc.slot) + 1) % order.length];
      var names = { walk: 'LAUFEN (alpha walking)', drive: 'ROLLER (skating)', sitstand: 'SIT·STAND' };
      TF.ui.logLine('Policy-Slot: ' + names[S.mjc.slot], 'sys');
      TF.ui.status('MICRODUCK·MJ · ' + names[S.mjc.slot]);
    };

    /* ---------- Menagerie-Roboter lazy laden (arm = WidowX, hum = OP3) ---------- */
    function ensureMjRobot(key, cb) {
      if (!TF.mjc || !S.mjc.ready) return;
      if (S.mjc[key]) { if (cb) cb(); return; }
      TF.ui.logLine('Lade MuJoCo-Modell: ' + (key === 'arm' ? 'WidowX 250 6DOF' : 'ROBOTIS OP3') + ' …', 'sys');
      TF.mjc.ensureRobot(key).then(function () {
        var frame = key === 'arm' ? armFrame : humFrame;
        var rig = TF.mjc.makeMeshRig(TF.render, lib, key, false);
        frame.add(rig.root);
        S.mjc[key + 'Rig'] = rig;
        S.mjc[key] = key === 'arm' ? TF.mjc.makeArm() : TF.mjc.makeHum();
        TF.mjc.attachRigVisuals(rig, key).then(function () {
          TF.ui.logLine('Originale STL-Visuals aktiv (' + (key === 'arm' ? 'Interbotix' : 'ROBOTIS') + ').', 'sys');
        }).catch(function () {});
        var info = TF.mjc.robotInfo(key);
        TF.ui.logLine('ECHTES MUJOCO: ' + (key === 'arm' ? 'WIDOWX 250 6DOF' : 'ROBOTIS OP3') + ' (Menagerie, nq ' + info.nq + ', nu ' + info.nu + ').', 'sys');
        if (key === 'arm') TF.ui.logLine('Joystick = Greifziel · GRIP-Taste greift den Ball (Auto-Aim).', 'sys');
        else TF.ui.logLine('Joystick = Command · "POLICY" wechselt STEHEN → GEHEN · Training: "trainiere den humanoiden".', 'sys');
        if (cb) cb();
      }).catch(function (e) {
        TF.ui.logLine('MJ-Modell fehlgeschlagen: ' + e.message + ' — Werkstatt-Kern bleibt aktiv.', 'warn');
      });
    }
    function mjDriveArm() {
      var a = S.mjc.arm;
      if (S.gripClosed) {
        // Auto-Aim: Ziel = Ball, nach Griffversuch hochheben
        var bp = a.ballPos();
        a.target = [bp[0], bp[1], a.grip ? 0.21 : 0.09];
        a.grip = 1;
      } else {
        a.grip = 0;
        a.target = [0.28 + self.joystick.y * 0.11, self.joystick.x * 0.17, 0.07];
      }
      if (!a.busy) {
        a.busy = true;
        a.controlStepAsync(false, null)
          .catch(function (e) { TF.ui.logLine('MJ-FEHLER: ' + e.message, 'warn'); })
          .then(function () { a.busy = false; });
      }
    }
    function mjDriveHum() {
      var h = S.mjc.hum;
      h.cmd[0] = self.joystick.y * 1.0;
      h.cmd[1] = -self.joystick.x * 0.5;
      if (!h.busy) {
        h.busy = true;
        h.controlStepAsync(null)
          .catch(function (e) { TF.ui.logLine('MJ-FEHLER: ' + e.message, 'warn'); })
          .then(function () { h.busy = false; });
      }
    }
    this.mjcCycleHum = function () {
      S.mjc.humMode = S.mjc.humMode === 'stehen' ? 'gehen' : 'stehen';
      if (S.mjc.hum) S.mjc.hum.mode = S.mjc.humMode;
      TF.ui.logLine('ROBOTIS OP3: ' + S.mjc.humMode.toUpperCase() + (S.mjc.humMode === 'gehen' ? ' (quasistatische Firmware-Gait — RL-Training macht es schneller)' : ''), 'sys');
      TF.ui.status('HUMANOID·MJ · ' + S.mjc.humMode.toUpperCase());
    };

    /* ---------- Neuroevolution ---------- */
    function gauss() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    function mutate(src, sigma) {
      var g = new Float64Array(src.length);
      for (var i = 0; i < src.length; i++) {
        g[i] = Math.random() < 0.06 ? (Math.random() - 0.5) : src[i] + gauss() * sigma;
      }
      return g;
    }

    this.startTraining = function (robot, gens) {
      // MuJoCo da? Dann auf den echten Robotern trainieren.
      if (robot === 'duck' && S.mjc.ready) {
        TF.ui.logLine('MuJoCo aktiv — Training läuft auf dem echten Microduck (61→14).', 'sys');
        robot = 'duckmj';
      }
      if (robot === 'arm' && S.mjc.arm) {
        TF.ui.logLine('MuJoCo aktiv — Training läuft auf der echten WidowX 250 (16→7).', 'sys');
        robot = 'armmj';
      }
      if (robot === 'humanoid' && S.mjc.hum) {
        TF.ui.logLine('MuJoCo aktiv — Training läuft auf dem echten ROBOTIS OP3 (46→20).', 'sys');
        robot = 'op3mj';
      }
      if (S.training.active) this.stopTraining();
      var mj = robot === 'duckmj' || robot === 'armmj' || robot === 'op3mj';
      S.training = {
        active: true, robot: robot, gens: gens, gen: 0, batchIdx: 0,
        pop: [], fits: new Float64Array(40), envs: [], genomes: [],
        history: [], bestFit: null, avgFit: null,
        champFit: S.champions[robot] ? S.champions[robot].fit : null,
        champGenome: S.champions[robot] ? new Float64Array(S.champions[robot].genome) : null,
        baseSeed: 1000 + ((Date.now() & 0xff) | 0)
      };
      var ch = S.champions[robot];
      for (var i = 0; i < 40; i++) {
        if (ch) S.training.pop.push(mutate(ch.genome, 0.15));
        else S.training.pop.push(TF.nn.initGenome(1234 + i * 17, TF.nn.ARCHS[robot][0], TF.nn.ARCHS[robot][3]));
      }
      newBatch();
      if (mj) buildMjGhosts(robot); else buildGhosts(robot);
      rigRootFor(robot).visible = false;
      TF.ui.logLine('TRAINING ' + robot.toUpperCase() + ': ' + gens + ' Generationen, Population 40, ' + (mj ? '4 MuJoCo-Geister/Batch (10 Batches)' : '8 Geister/Batch') + '.', 'sys');
      TF.ui.buildTopbar();
    };
    function rigRootFor(robot) {
      if (robot === 'duckmj') return S.mjc.mjRig ? S.mjc.mjRig.root : mjFrame;
      if (robot === 'armmj') return S.mjc.armRig ? S.mjc.armRig.root : armFrame;
      if (robot === 'op3mj') return S.mjc.humRig ? S.mjc.humRig.root : humFrame;
      return worlds[robot] ? worlds[robot].rig.root : mjFrame;
    }
    this.stopTraining = function () {
      if (!S.training.active) return;
      S.training.active = false;
      finishChampion('abgebrochen');
      rigRootFor(S.training.robot).visible = true;
      if (S.training.robot === 'duckmj' || S.training.robot === 'armmj' || S.training.robot === 'op3mj') clearMjGhosts(); else clearGhosts();
      TF.ui.logLine('Training beendet (Generation ' + S.training.gen + ').', 'sys');
      TF.ui.buildTopbar();
      TF.ui.updateTraining(S.training);
      save();
    };
    this.quickTrain = function () {
      this.startTraining(S.robot, 60);
    };
    function newBatch() {
      var T = S.training;
      var mj = T.robot === 'duckmj' || T.robot === 'armmj' || T.robot === 'op3mj';
      var per = mj ? 4 : 8;
      T.envs = [];
      T.genomes = [];
      if (mj) {
        for (var k = 0; k < per; k++) {
          if (T.robot === 'duckmj') T.envs.push(TF.mjc.makeGhost());
          else if (T.robot === 'armmj') T.envs.push(TF.mjc.makeGhostArm(null));
          else T.envs.push(TF.mjc.makeGhostHum(null));
          T.genomes.push(T.pop[T.batchIdx * per + k]);
        }
      } else {
        var seed = T.baseSeed + T.gen;
        for (var k2 = 0; k2 < per; k2++) {
          T.envs.push(TF.makeEnv(T.robot, seed));
          T.genomes.push(T.pop[T.batchIdx * per + k2]);
        }
      }
    }
    function endGeneration() {
      var T = S.training;
      var sum = 0, best = -Infinity, bestI = 0;
      for (var i = 0; i < 40; i++) { sum += T.fits[i]; if (T.fits[i] > best) { best = T.fits[i]; bestI = i; } }
      T.bestFit = best; T.avgFit = sum / 40;
      T.history.push({ best: best, avg: T.avgFit });
      var order = [];
      for (i = 0; i < 40; i++) order.push(i);
      order.sort(function (a, b) { return T.fits[b] - T.fits[a]; });
      var newPop = [];
      for (i = 0; i < 8; i++) newPop.push(new Float64Array(T.pop[order[i]]));
      for (i = 8; i < 40; i++) {
        var pa = T.pop[order[Math.floor(Math.random() * 3)]];
        var pb = T.pop[order[Math.floor(Math.random() * 3)]];
        var child = new Float64Array(pa.length);
        for (var g = 0; g < pa.length; g++) child[g] = Math.random() < 0.5 ? pa[g] : pb[g];
        newPop.push(mutate(child, 0.12));
      }
      T.pop = newPop;
      if (T.champGenome === null || best > T.champFit) {
        // newPop[0] ist der beste Genotyp der alten Population (Elite zuerst)
        T.champGenome = new Float64Array(newPop[0]);
        T.champFit = best;
        TF.ui.logLine('NEUER CHAMPION (' + T.robot + '): fit ' + best.toFixed(1) + ' in Gen ' + T.gen, 'sys');
      }
      T.gen++;
      T.batchIdx = 0;
    }
    function finishChampion(reason) {
      var T = S.training;
      if (T.champGenome === null) return;
      var fit = T.champFit === null ? 0 : T.champFit;
      var isNew = !S.champions[T.robot] || fit > S.champions[T.robot].fit;
      S.champions[T.robot] = { genome: T.champGenome, gen: T.gen, fit: fit, src: 'lokal' };
      TF.ui.logLine('Champion ' + T.robot.toUpperCase() + ': fit ' + fit.toFixed(1) + ' (gen ' + T.gen + ', ' + reason + ')' + (isNew ? ' — NEUER REKORD' : ''), 'sys');
    }

    /* Trainings-Schritt: pro Frame mehrere Env-Substeps (sichtbar im Gerät) */
    function trainStep() {
      var T = S.training;
      if (!T.active) return;
      var mj = T.robot === 'duckmj' || T.robot === 'armmj' || T.robot === 'op3mj';
      var per = mj ? 4 : 8;
      var batches = mj ? 10 : 5;
      var iters = mj ? 1 : 3;
      for (var it = 0; it < iters; it++) {
        var allDone = true;
        for (var k = 0; k < per; k++) {
          var env = T.envs[k];
          if (env._done || env.done) continue;
          allDone = false;
          var acts = TF.nn.forward(T.genomes[k], env.getObs(), TF.nn.ARCHS[T.robot][3]);
          var r;
          if (mj) r = env.step(acts);
          else if (T.robot === 'duck') r = env.step(acts[0], acts[1]).done;
          else if (T.robot === 'arm') r = env.step(acts[0], acts[1], acts[2], acts[3], acts[4]).done;
          else r = env.step(acts).done;
          if (r) env._done = true;
        }
        if (allDone) {
          for (k = 0; k < per; k++) T.fits[T.batchIdx * per + k] = T.envs[k].fit;
          T.batchIdx++;
          if (T.batchIdx >= batches) { endGeneration(); if (T.gen >= T.gens) { T.active = false; finishChampion('abgeschlossen'); rigRootFor(T.robot).visible = true; if (mj) clearMjGhosts(); else clearGhosts(); TF.ui.logLine('TRAINING ABGESCHLOSSEN: ' + T.gens + ' Generationen.', 'sys'); TF.ui.buildTopbar(); save(); TF.ui.updateTraining(T); return; } }
          newBatch();
        }
      }
      if (mj) {
        for (k = 0; k < 4; k++) {
          if (S.mjc.ghostRigs[k] && T.envs[k]) S.mjc.ghostRigs[k].update(T.envs[k].data);
        }
      } else {
        for (k = 0; k < 8; k++) {
          if (ghostRigs[k] && T.envs[k]) ghostRigs[k].update(T.envs[k]);
        }
      }
    }

    /* ---------- Geister ---------- */
    function buildMjGhosts(robot) {
      clearMjGhosts();
      var kind = robot === 'armmj' ? 'arm' : robot === 'op3mj' ? 'hum' : 'duck';
      var frame = kind === 'arm' ? armFrame : kind === 'hum' ? humFrame : mjFrame;
      for (var k = 0; k < 4; k++) {
        if (kind === 'arm') S.mjc.ghosts.push(TF.mjc.makeGhostArm(null));
        else if (kind === 'hum') S.mjc.ghosts.push(TF.mjc.makeGhostHum(null));
        else S.mjc.ghosts.push(TF.mjc.makeGhost());
        var rig;
        if (kind === 'duck') rig = TF.mjc.makeSkeletonRig(TF.render, lib, true);
        else {
          rig = TF.mjc.makeMeshRig(TF.render, lib, kind, true);
          TF.mjc.attachRigVisuals(rig, kind).catch(function () {});
        }
        frame.add(rig.root);
        S.mjc.ghostRigs.push(rig);
      }
    }
    function clearMjGhosts() {
      for (var k = 0; k < S.mjc.ghostRigs.length; k++) {
        S.mjc.ghostRigs[k].root.parent = null;
      }
      S.mjc.ghostRigs = [];
      S.mjc.ghosts = [];
    }
    function buildGhosts(robot) {
      clearGhosts();
      var mk = robot === 'duck' ? TF.views.DuckRig : robot === 'arm' ? TF.views.ArmRig : TF.views.HumanoidRig;
      for (var k = 0; k < 8; k++) {
        var rig = mk(lib, { ghost: true });
        worlds[robot].arena.add(rig.root);
        ghostRigs.push(rig);
      }
      S.training.batchFits = new Float64Array(8);
    }
    function clearGhosts() {
      for (var k = 0; k < ghostRigs.length; k++) {
        ghostRigs[k].root.parent = null; // einfaches Entfernen
      }
      ghostRigs = [];
    }

    /* ---------- Aktionen (Konsole/UI) ---------- */
    this.setRobot = function (id) {
      S.robot = id;
      S.gripClosed = false;
      cam.yaw = CAM_DEF[id].yaw; cam.pitch = CAM_DEF[id].pitch; cam.dist = CAM_DEF[id].dist;
      for (var r in worlds) worlds[r].arena.visible = (r === id) && true;
      if (S.training.active && S.training.robot !== id) this.stopTraining();
      // Menagerie-Roboter: MuJoCo-Modell lazy laden (Werkstatt-Kern läuft bis dahin)
      if (id === 'arm') ensureMjRobot('arm');
      if (id === 'humanoid') ensureMjRobot('hum');
      TF.ui.logLine('Roboter: ' + id.toUpperCase() + (id === 'arm' && S.mjc.arm ? ' · MUJOCO WIDOWX 250' : id === 'humanoid' && S.mjc.hum ? ' · MUJOCO ROBOTIS OP3' : ''), 'sys');
      TF.ui.status('ROBOT ' + id.toUpperCase() + ' / ' + S.mode.toUpperCase());
      save();
    };
    this.setMode = function (m) {
      S.mode = m;
      // Microduck-MJ: POLICY-Knopf zyklisiert die Werks-Policy-Slots
      if (m === 'policy' && S.mjc.ready && S.robot === 'duck') {
        this.mjcCycleSlot();
        TF.ui.buildTopbar();
        return;
      }
      // Humanoid-MJ: POLICY-Knopf wechselt STEHEN ↔ GEHEN
      if (m === 'policy' && S.robot === 'humanoid' && S.mjc.hum) {
        this.mjcCycleHum();
        TF.ui.buildTopbar();
        return;
      }
      // Arm-MJ: POLICY-Knopf = Greifen (Auto-Aim auf den Ball)
      if (m === 'policy' && S.robot === 'arm' && S.mjc.arm) {
        S.gripClosed = !S.gripClosed;
        TF.ui.logLine(S.gripClosed ? 'ARMBOT·MJ: Greifen (Auto-Aim auf den Ball).' : 'ARMBOT·MJ: Griff offen.', 'sys');
        TF.ui.buildTopbar();
        return;
      }
      if (m === 'policy') {
        if (!S.champions[S.robot]) TF.ui.logLine('Noch kein Champion für ' + S.robot.toUpperCase() + ' — erst TRAINING starten oder Policy importieren.', 'warn');
        else TF.ui.logLine('POLICY-MODUS: Champion gen ' + S.champions[S.robot].gen + ', fit ' + S.champions[S.robot].fit.toFixed(1) + '.', 'sys');
      } else TF.ui.logLine('Modus: MANUELL.', 'sys');
      TF.ui.buildTopbar();
      save();
    };
    this.setTod = function (t) {
      S.tod = t;
      TF.ui.logLine('Tageszeit: ' + { day: 'Tag', sunset: 'Abendrot', night: 'Nacht' }[t] + '.', 'sys');
      save();
    };
    this.setColorIdx = function (i) {
      S.colorIdx = i;
      rebuildDuck();
      save();
    };
    function rebuildDuck() {
      var w = worlds.duck;
      var parent = w.arena;
      parent.children = parent.children.filter(function (c) { return c !== w.rig.root; });
      w.rig = TF.views.DuckRig(lib, { color: COLOR_CHOICES[S.colorIdx].rgb });
      parent.add(w.rig.root);
      w.rig.root.visible = !(S.training.active && S.training.robot === 'duck');
    }
    this.toggleRays = function () {
      S.showRays = !S.showRays;
      TF.ui.status('Strahlen: ' + (S.showRays ? 'AN' : 'AUS'));
      save();
    };
    this.haltHumanoid = function () { this.joystick.y = 0; };
    this.resetRobot = function () {
      if (S.robot === 'duck' && S.mjc.ready && S.mjc.duck) {
        S.mjc.duck.reset();
        TF.ui.logLine('MICRODUCK·MJ zurückgesetzt (STAND-Keyframe).', 'sys');
        return;
      }
      if (S.robot === 'arm' && S.mjc.arm) {
        S.mjc.arm.reset();
        TF.ui.logLine('ARMBOT·MJ zurückgesetzt (Home-Keyframe, Ball zurück auf den Tisch).', 'sys');
        return;
      }
      if (S.robot === 'humanoid' && S.mjc.hum) {
        S.mjc.hum.reset();
        TF.ui.logLine('HUMANOID·MJ zurückgesetzt (Home-Keyframe).', 'sys');
        return;
      }
      envs[S.robot].reset(envs[S.robot].rngSeed || 1);
      TF.ui.logLine(S.robot.toUpperCase() + ' zurückgesetzt.', 'sys');
    };
    this.newTarget = function () {
      var e = envs[S.robot];
      if (S.robot === 'duck') { e._newTarget(e.rng); }
      else if (S.robot === 'arm') { e._newBall(e.rng); e.holding = false; e.prevEB = e._d3(e.ee, e.ball); }
      else e._newTarget(e.rng);
      TF.ui.logLine('Neues Ziel für ' + S.robot.toUpperCase() + '.', 'sys');
    };

    /* ---------- Champion-Verwaltung ---------- */
    this.importPolicyText = function (text, fname) {
      try {
        var p = JSON.parse(text);
        this.importPolicyObj(p, fname);
      } catch (e) {
        TF.ui.logLine('Import fehlgeschlagen: ' + e.message, 'warn');
      }
    };
    this.importPolicyObj = function (p, fname) {
      var v = TF.nn.validatePolicy(p);
      if (!v.ok) { TF.ui.logLine('Policy abgelehnt: ' + v.error, 'warn'); return; }
      S.champions[p.robot] = { genome: v.genome, gen: p.gen || 0, fit: p.fit || 0, src: p.src || 'import' };
      TF.ui.logLine('Policy importiert' + (fname ? ' (' + fname + ')' : '') + ': ' + p.robot.toUpperCase() + ', gen ' + p.gen + ', fit ' + (p.fit || 0).toFixed(1) + ', src ' + (p.src || 'import') + '.', 'sys');
      if (S.robot === p.robot && S.mode === 'policy') { /* greift sofort */ }
      save();
    };
    this.championPolicyJson = function () {
      var c = S.champions[S.robot];
      if (!c) return null;
      return JSON.stringify(TF.nn.genomeToPolicy(c.genome, S.robot, c.gen, c.fit, c.src));
    };
    this.exportChampion = function () {
      var j = this.championPolicyJson();
      if (!j) { TF.ui.logLine('Kein Champion für ' + S.robot.toUpperCase() + ' — nichts zu exportieren.', 'warn'); return; }
      var d = new Date();
      var name = 'robofield-' + S.robot + '-gen' + S.champions[S.robot].gen + '-' + d.toISOString().slice(0, 10) + '.json';
      if (global.AndroidBridge && global.AndroidBridge.exportFile) {
        global.AndroidBridge.exportFile(name, j);
        TF.ui.logLine('Exportiert über Android-Bridge: ' + name, 'sys');
      } else {
        try {
          var blob = new Blob([j], { type: 'application/json' });
          var a = global.document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          TF.ui.logLine('Download gestartet: ' + name, 'sys');
        } catch (e) { TF.ui.logLine('Export nicht möglich: ' + e.message, 'warn'); }
      }
    };
    this.saveChampionNamed = function (name) {
      var c = S.champions[S.robot];
      if (!c) { TF.ui.logLine('Kein Champion zum Speichern.', 'warn'); return; }
      var j = JSON.stringify(TF.nn.genomeToPolicy(c.genome, S.robot, c.gen, c.fit, 'lokal'));
      var fname = (name || S.robot + '-champion') + '.json';
      if (global.AndroidBridge && global.AndroidBridge.exportFile) global.AndroidBridge.exportFile(fname, j);
      else this.exportChampion();
      TF.ui.logLine('Gespeichert: ' + fname, 'sys');
    };

    /* ---------- Konsole ---------- */
    this.handleConsole = function (s) {
      // Policy-JSON direkt einfügen?
      if (s[0] === '{') {
        try {
          var o = JSON.parse(s);
          if (o && o.format === 'robofield-policy-v1') { this.importPolicyObj(o); return; }
        } catch (e) { /* weiter zum Normalparser */ }
      }
      var res = TF.console.handle(s, S);
      for (var i = 0; i < res.replies.length; i++) TF.ui.logLine(res.replies[i], res.actions.length ? 'sys' : 'warn');
      this.execActions(res.actions);
    };
    this.execActions = function (acts) {
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        switch (a.op) {
          case 'train': this.startTraining(a.robot, a.gens); break;
          case 'trainStop': this.stopTraining(); break;
          case 'robot': this.setRobot({ duckmj: 'duck', armmj: 'arm', op3mj: 'humanoid' }[a.id] || a.id); TF.ui.buildBtnStack(); TF.ui.buildTopbar(); break;
          case 'mjslot': if (S.mjc.ready) { S.mjc.slot = a.slot; TF.ui.logLine('MuJoCo-Policy-Slot: ' + a.slot.toUpperCase(), 'sys'); } else TF.ui.logLine('MuJoCo nicht aktiv — Slot nicht gesetzt.', 'warn'); break;
          case 'hummode':
            if (S.mjc.hum) { S.mjc.humMode = a.mode; S.mjc.hum.mode = a.mode; TF.ui.logLine('ROBOTIS OP3: ' + a.mode.toUpperCase(), 'sys'); }
            else TF.ui.logLine('Humanoid-MJ noch nicht geladen.', 'warn');
            break;
          case 'grip':
            S.gripClosed = !!a.closed;
            TF.ui.logLine('Greifer: ' + (a.closed ? 'ZU (Auto-Aim)' : 'OFFEN'), 'sys');
            break;
          case 'mode': this.setMode(a.mode); break;
          case 'tod': this.setTod(a.tod); TF.ui.buildTopbar(); break;
          case 'save': this.saveChampionNamed(a.name); break;
          case 'load': TF.ui.logLine('Laden: gespeicherte Champions liegen im Browser-Speicher; Datei über „import" wählen.', 'sys'); TF.ui.openImport(); break;
          case 'reset': this.resetRobot(); break;
          case 'target': this.newTarget(); break;
          case 'export': this.exportChampion(); break;
          case 'status': this.reportStatus(); break;
          case 'engine': this.reportEngine(); break;
          case 'importPolicy': this.importPolicyObj(a.policy); break;
          case 'quack': this.quack(); break;
          case 'fileImport': TF.ui.openImport(); break;
        }
      }
    };
    this.reportStatus = function () {
      var T = S.training;
      var lines = [
        'STATUS — Roboter: ' + S.robot.toUpperCase() + ' | Modus: ' + S.mode.toUpperCase() + ' | TOD: ' + S.tod.toUpperCase(),
        'Champions: ' + ['duck', 'duckmj', 'arm', 'armmj', 'humanoid', 'op3mj'].map(function (r) {
          var c = S.champions[r];
          return r + (c ? '(gen ' + c.gen + ', fit ' + c.fit.toFixed(1) + ', ' + c.src + ')' : '(—)');
        }).join('  '),
        'Training: ' + (T.active ? 'AKTIV gen ' + T.gen + '/' + T.gens + ', best ' + (T.bestFit === null ? '—' : T.bestFit.toFixed(1)) : 'inaktiv'),
        'Env: ' + S.robot + ' fit=' + envs[S.robot].fit.toFixed(1) + ' steps=' + (envs[S.robot].steps || 0)
      ];
      for (var i = 0; i < lines.length; i++) TF.ui.logLine(lines[i], 'sys');
    };
    /* Engine-/Versions-Report — sichtbare Kennung, damit man die richtige APK
     * sofort erkennt (Nutzer-Frage: „Ist das das neuste APK?"), Antwort über
     * Konsole: „version" oder Badge im Topbar. */
    this.reportEngine = function () {
      var B = (global.TF07 && global.TF07.BUILD) || {};
      TF.ui.logLine('ENGINE-REPORT — BUILD v' + (B.version || '?') + ' · ' + (B.id || '?'), 'sys');
      if (S.mjc.ready && TF.mjc && TF.mjc.isReady()) {
        var i = TF.mjc.info();
        var robots = ['duck', 'arm', 'hum'].filter(function (k) { return TF.mjc.hasRobot(k); });
        TF.ui.logLine('ENGINE: ECHTES MUJOCO (WASM) AKTIV — duck nq ' + i.nq + '/nu ' + i.nu +
          ' · MJ-Roboter geladen: ' + (robots.join(', ') || 'duck (Basis)') +
          ' · ONNX-Policies: ' + TF.mjc.policiesLoaded().join(', '), 'sys');
        TF.ui.logLine('Physik: MJCF timestep 5 ms, Regelung 50 Hz (Decimation 4) — Policies vom HF-Space pollen-robotics/microduck-simulator.', 'sys');
      } else {
        TF.ui.logLine('ENGINE: WERKSTATT-FALLBACK (Eigenbau-Kern) — MuJoCo NICHT aktiv.', 'warn');
        TF.ui.logLine('MJ-Fehler: ' + (S.mjc.err || 'lädt noch … (Badge im Topbar zeigt den Status)'), 'warn');
      }
    };

    /* ---------- Gemini-Brücke ---------- */
    var GEMINI_SYS = [
      'Du bist die Fernsteuerung der Robotik-Sandbox "Testfeld·07".',
      'Antworte AUSSCHLIESSLICH mit JSON-Kommandos dieses Protokolls (kein weiterer Text):',
      '{"cmd":"train","robot":"duck|arm|humanoid","gens":N}',
      '{"cmd":"robot","id":"duck|arm|humanoid"}',
      '{"cmd":"mode","mode":"manual|policy"}',
      '{"cmd":"tod","tod":"day|sunset|night"}',
      '{"cmd":"save","name":"..."}  {"cmd":"load","name":"..."}',
      '{"cmd":"reset"}  {"cmd":"status"}  {"cmd":"target"}  {"cmd":"export"}',
      'Mehrere Befehle: als JSON-Array [ {...}, {...} ].',
      'Roboter: duck=Roller (Zielsuche), arm=Greifarm, humanoid=Balance-Läufer.'
    ].join('\n');
    this.askGemini = function (q) {
      var key = null;
      try { key = global.localStorage.getItem('tf07.gk'); } catch (e) {}
      if (!key) {
        key = global.prompt('Gemini-API-Key (wird nur lokal im Gerät gespeichert):');
        if (!key) { TF.ui.logLine('GEMINI: ohne Key abgebrochen.', 'warn'); return; }
        try { global.localStorage.setItem('tf07.gk', key); } catch (e) {}
      }
      TF.ui.logLine('GEMINI › ' + q, 'gmi');
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key);
      global.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: GEMINI_SYS }] },
          contents: [{ role: 'user', parts: [{ text: q }] }]
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 400 ? ' (Key ungültig?)' : ''));
        return r.json();
      }).then(function (data) {
        var txt = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
          data.candidates[0].content.parts && data.candidates[0].content.parts[0].text || '';
        txt = txt.trim().replace(/^```(json)?/m, '').replace(/```$/m, '').trim();
        TF.ui.logLine('GEMINI: ' + txt, 'gmi');
        self.handleConsole(txt);
      }).catch(function (e) {
        TF.ui.logLine('GEMINI-Fehler: ' + e.message + ' (Netzwerk/Key prüfen — App ist sonst offline)', 'warn');
      });
    };

    /* ---------- Hauptschleife ---------- */
    var last = performance.now(), acc = 0, fpsT = 0, fpsN = 0, timeS = 0;
    var mainGenome = null, mainActs = null;
    var resScale = 1, ftAvg = 1 / 60, resCooldown = 60;

    function stepMain(dt) {
      var env = envs[S.robot];
      var arch = TF.nn.ARCHS[S.robot];
      if (S.mode === 'policy' && S.champions[S.robot]) {
        var acts = TF.nn.forward(S.champions[S.robot].genome, env.getObs(), arch[3]);
        if (S.robot === 'duck') { env.step(acts[0], acts[1]); worlds.duck.rig.spin += (acts[0] + acts[1]) / 2 * 4 * TF.DT; }
        else if (S.robot === 'arm') { env.step(acts[0], acts[1], acts[2], acts[3], acts[4]); env.gripOpen = acts[4] > 0; }
        else env.step(acts);
      } else {
        var a = manualActions(env);
        if (S.robot === 'duck') {
          env.step(a[0], a[1]);
          var v = TF.WHEEL_R * (a[0] + a[1]) * 4 / 2;
          worlds.duck.rig.spin += v / TF.WHEEL_R * TF.DT;
        } else if (S.robot === 'arm') {
          env.step(a[0], a[1], a[2], a[3], a[4]);
          env.gripOpen = !S.gripClosed;
        } else env.step(a);
      }
      if (env.steps !== undefined && env.steps >= TF.EP_LEN[S.robot]) env.reset(env.rngSeed || 1);
    }

    function applyTod() {
      var t = TOD[S.tod];
      renderer.bg = t.bg; renderer.fogColor = t.bg; renderer.fogDensity = t.fog;
      renderer.lightColor = t.light; renderer.ambSky = t.sky; renderer.ambGnd = t.gnd;
      renderer.lightDir = t.dir;
    }

    var lastErrMsg = '', lastErrT = 0;
    function frame(now) {
      try {
        frameInner(now);
      } catch (e) {
        if (e.message !== lastErrMsg || now - lastErrT > 1000) {
          lastErrMsg = e.message; lastErrT = now;
          TF.ui.logLine('LOOP-FEHLER: ' + e.message, 'warn');
          try { global.document.cookie = 'tf07mjerr=' + encodeURIComponent('LOOP: ' + e.message).slice(0, 180) + ';path=/'; } catch (_) {}
          try { console.error('TF07 loop error:', e); } catch (_) {}
        }
      }
      requestAnimationFrame(frame);
    }

    function frameInner(now) {
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now; timeS += dt;
      fpsN++; if (now - fpsT > 500) { S.fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsT = now; fpsN = 0; }

      // Dynamische Auflösung: bei dauerhaft langen Frames Rückfahrstufe,
      // bei Luft nach oben zurück — hält auch Software-GL bedienbar.
      ftAvg += (dt - ftAvg) * 0.03;
      if (resCooldown > 0) resCooldown--;
      else if (ftAvg > 0.055 && resScale > 0.4) {
        resScale = Math.max(0.4, resScale - 0.2);
        renderer.resScale = resScale; self.resize(); resCooldown = 150;
        TF.ui.logLine('Auto-Auflösung: ' + Math.round(resScale * 100) + ' %', 'warn');
      } else if (ftAvg < 0.02 && resScale < 1) {
        resScale = Math.min(1, resScale + 0.2);
        renderer.resScale = resScale; self.resize(); resCooldown = 300;
      }

      var alpha = 0;
      if (S.mjc.ready && S.robot === 'duck' && !S.training.active) {
        // Echtes MuJoCo: 50-Hz-Policy-Regelung, Joystick = Velocity-Command
        mjDrive(dt);
      } else if (S.mjc.ready && S.robot === 'arm' && S.mjc.arm && !S.training.active) {
        mjDriveArm();
      } else if (S.mjc.ready && S.robot === 'humanoid' && S.mjc.hum && !S.training.active) {
        mjDriveHum();
      } else if (!S.training.active) {
        acc += dt;
        var n = 0;
        while (acc >= TF.DT && n < 4) { stepMain(TF.DT); acc -= TF.DT; n++; }
        alpha = clamp(acc / TF.DT, 0, 1);
      } else {
        trainStep();
        TF.ui.updateTraining(S.training);
      }

      applyTod();
      var env = envs[S.robot], w = worlds[S.robot];
      // Szenengraph-Transforme aktualisieren (vor dem Zeichnen!)
      w.arena.updateWorld(null);
      if (S.mjc.ready && S.robot === 'duck' && !S.training.active) {
        // Microduck-MJ: Skelett-Rig aus qpos, alter Rig + Zielmarker aus
        var d2 = S.mjc.duck;
        mjFrame.visible = true;
        if (S.mjc.mjRig) S.mjc.mjRig.update(d2.data);
        worlds.duck.rig.root.visible = false;
        w.target.root.visible = false;
        var qx = d2.data.qpos[0], qy = d2.data.qpos[1];
        var focusMj = [qx, 0.35, -qy];
        var cxM = focusMj[0] + 1.6 * Math.cos(cam.pitch) * Math.sin(cam.yaw);
        var cyM = focusMj[1] + 1.6 * Math.sin(cam.pitch);
        var czM = focusMj[2] + 1.6 * Math.cos(cam.pitch) * Math.cos(cam.yaw);
        renderer.camDist = 1.6;
        renderer.setCamera([cxM, cyM, czM], focusMj, [0, 1, 0]);
        renderer.begin();
        renderer.drawNode(w.arena, 1);
        TF.ui.status('MICRODUCK·MJ · ' + S.mjc.slot.toUpperCase() + (d2.fallen ? ' · AUFSTEHEN…' : '') +
          ' · REND ' + S.fps + ' FPS · 50 HZ · x=' + qx.toFixed(2) + ' m');
        requestAnimationFrame(frame);
        return; // eigener Pfad fertig gezeichnet
      }
      // ARMBOT·MJ / HUMANOID·MJ: eigener Physik-Pfad mit Mesh-Rig
      if (S.mjc.ready && !S.training.active &&
          ((S.robot === 'arm' && S.mjc.arm) || (S.robot === 'humanoid' && S.mjc.hum))) {
        var key = S.robot === 'arm' ? 'arm' : 'hum';
        var envM = S.mjc[key], rigM = S.mjc[key + 'Rig'];
        var frameM = key === 'arm' ? armFrame : humFrame;
        frameM.visible = true;
        mjFrame.visible = false;
        var otherFrame = key === 'arm' ? humFrame : armFrame;
        otherFrame.visible = false;
        if (rigM) rigM.update(envM.data);
        worlds[key === 'arm' ? 'arm' : 'humanoid'].rig.root.visible = false;
        var wM = worlds[key === 'arm' ? 'arm' : 'humanoid'];
        wM.target.root.visible = key === 'arm';
        if (key === 'arm') {
          var tM = envM.target;
          wM.target.root.pos = [tM[0], tM[2] + 0.4, -tM[1]];
          wM.target.ring.scale = [0.3, 1, 0.3];
        }
        var bpos = envM.data.qpos;
        var ballN = key === 'arm' ? armBallNode : humBallNode;
        var ba = envM.r.ballAdr;
        ballN.pos = [bpos[ba], bpos[ba + 1], bpos[ba + 2]];
        ballN.visible = true;
        var focusM2 = key === 'arm' ? [0, 0.55, 0] : [bpos[0], 0.45, -bpos[1]];
        var distM = key === 'arm' ? 1.5 : 2.0;
        var cxM2 = focusM2[0] + distM * Math.cos(cam.pitch) * Math.sin(cam.yaw);
        var cyM2 = focusM2[1] + distM * Math.sin(cam.pitch);
        var czM2 = focusM2[2] + distM * Math.cos(cam.pitch) * Math.cos(cam.yaw);
        renderer.camDist = distM;
        renderer.setCamera([cxM2, cyM2, czM2], focusM2, [0, 1, 0]);
        renderer.begin();
        renderer.drawNode(wM.arena, 1);
        var st = key === 'arm'
          ? 'ARMBOT·MJ · IK · GRIP ' + (S.gripClosed ? 'ZU' : 'OFFEN') + ' · REND ' + S.fps + ' FPS · 50 HZ'
          : 'HUMANOID·MJ · ' + S.mjc.humMode.toUpperCase() + ' · REND ' + S.fps + ' FPS · 50 HZ';
        TF.ui.status(st);
        requestAnimationFrame(frame);
        return;
      }
      mjFrame.visible = false;
      // Ghost-Frames während MJ-Training sichtbar schalten
      armFrame.visible = S.training.active && S.training.robot === 'armmj';
      humFrame.visible = S.training.active && S.training.robot === 'op3mj';
      armBallNode.visible = !armFrame.visible;
      humBallNode.visible = !humFrame.visible;
      // Rig-Updates — interpolierte Anzeige-Pose (kein Physik-Zustand!)
      var vis = visFor(S.robot, env, S.training.active ? 1 : alpha);
      if (S.robot === 'duck') {
        w.rig.update(vis);
        w.rig.rayBars.forEach(function (b) { b.visible = S.showRays && !S.training.active; });
      } else if (S.robot === 'arm') w.rig.update(vis);
      else w.rig.update(vis);
      // Zielmarker
      var showT = S.robot !== 'arm';
      w.target.root.visible = showT;
      if (showT) {
        var tx = S.robot === 'duck' ? env.tx : env.tx, tz = env.tz;
        w.target.root.pos = [tx, 0, tz];
        var pulse = 1 + 0.12 * Math.sin(timeS * 4);
        w.target.ring.scale = [pulse, 1, pulse];
      }
      // Kamera (interpolierter Fokus, camDist für Nebel)
      var fx = S.robot === 'arm' ? 0 : (vis.px !== undefined ? vis.px : vis.x);
      var fz = S.robot === 'arm' ? 0 : (vis.pz !== undefined ? vis.pz : vis.z);
      var focus = S.robot === 'arm' ? [0, 0.7, 0] : [fx, CAM_DEF[S.robot].ty, fz];
      var cx = focus[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
      var cy = focus[1] + cam.dist * Math.sin(cam.pitch);
      var cz = focus[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
      renderer.camDist = cam.dist;
      renderer.setCamera([cx, cy, cz], focus, [0, 1, 0]);
      renderer.begin();
      renderer.drawNode(w.arena, 1);

      TF.ui.status(S.mode.toUpperCase() + ' · ' + S.robot.toUpperCase() + ' · REND ' + S.fps + ' FPS · SIM 30 HZ' +
        (S.training.active ? ' · TRAIN GEN ' + S.training.gen + '/' + S.training.gens : '') +
        ' · FIT ' + env.fit.toFixed(1));

      requestAnimationFrame(frame);
    }

    this.resize = function () {
      renderer.setSize(global.innerWidth, global.innerHeight, global.devicePixelRatio || 1);
    };

    /* ---------- Boot ---------- */
    this.boot = function () {
      load();
      // Werks-Champions (z. B. von Kaggle eingebaut), falls nichts Gespeichertes da ist
      if (TF.BUILTIN_POLICIES) {
        for (var r in TF.BUILTIN_POLICIES) {
          if (!S.champions[r]) {
            var v = TF.nn.validatePolicy(TF.BUILTIN_POLICIES[r]);
            if (v.ok) S.champions[r] = { genome: v.genome, gen: TF.BUILTIN_POLICIES[r].gen || 0, fit: TF.BUILTIN_POLICIES[r].fit || 0, src: TF.BUILTIN_POLICIES[r].src || 'import' };
          }
        }
      }
      TF.ui.init(this);
      this.resize();
      for (var r in worlds) worlds[r].arena.visible = (r === S.robot);
      worlds.duck.rig.root.visible = true;
      rebuildDuck();
      var gpu = String(renderer.gpuInfo || 'WebGL');
      var softGL = /swiftshader|llvmpipe|software|basic render|angle \(software/i.test(gpu);
      var lsOk = true;
      try { global.localStorage.setItem('tf07.test', '1'); global.localStorage.removeItem('tf07.test'); } catch (e) { lsOk = false; }
      TF.ui.bootSequence([
        'TESTFELD·07 BIOS v2.1.0 — (c) Werkstatt',
        'BUILD: ' + ((global.TF07 && global.TF07.BUILD) ? 'v' + global.TF07.BUILD.version + ' · ' + global.TF07.BUILD.id : 'unbekannt') + ' — MJCF + ONNX',
        'CPU: WEBVIEW-ARM64 ................ OK',
        'GRAFIK: ' + gpu.slice(0, 34) + (softGL ? ' [SOFTWARE]' : '') + ' ... OK',
        'PHYSIK: MUJOCO 3.11 (WASM) + TF07 ... OK',
        'MODELLGALERIE: MICRODUCK + WIDOWX 250 + OP3 ... OK',
        'RENDER: DISPLAY-RATE + INTERPOLATION ... OK',
        'ROBOTER: MICRODUCK / ARMBOT / HUMANOID ... 3 GEFUNDEN',
        'POLICY-FORMAT: robofield-policy-v1 ....... BEREIT',
        'STORAGE: ' + (lsOk ? 'OK' : 'OFFLINE-MODUS (ohne Speicherung)'),
        (S.champions.duck || S.champions.arm || S.champions.humanoid) ? 'CHAMPIONS: GELADEN' : 'CHAMPIONS: NOCH KEINE — TIPPE „TRAIN" ODER „TRAINIERE DEN DUCK 120 GENERATIONEN"',
        softGL ? 'HINWEIS: SOFTWARE-RENDERING — AUTO-AUFLÖSUNG AKTIV' : 'GPU-BESCHLEUNIGUNG AKTIV',
        'STARTEN DER SANDBOX …'
      ], function () {
        TF.ui.logLine('Willkommen in der Werkstatt. „hilfe" zeigt alle Befehle (Deutsch + JSON).', 'sys');
        if (global.AndroidBridge) TF.ui.logLine('Android-Bridge erkannt: Export/Import in Dokumente möglich.', 'sys');
      });
      mjcBoot();
      if (!/mjonly/.test(global.location.search)) requestAnimationFrame(frame);
    };
  }

  TF.app = app;
  global.addEventListener('DOMContentLoaded', function () {
    var a = new app();
    global.TF07.inst = a;
    a.boot();
  });
})(typeof window !== 'undefined' ? window : globalThis);
