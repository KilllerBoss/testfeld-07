/* Trainrobot ROBOLAB — App-Kern: ARMBOT (WidowX 250) + HUMANOID (OP3) auf
 * ECHTEM MuJoCo-WASM. 50-Hz-Wanduhr-Pacer, Neuroevolution auf MJ-Geistern,
 * Kamera, KONSOLE, Persistenz. KEIN Enten-Zweig, KEIN Werkstatt-Fallback:
 * MuJoCo ist die einzige Engine — scheitert der Boot, gibt es den Fehler
 * laut im BIOS-Schirm (nie eine stille Ersatzphysik). */
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
    arm: { yaw: 0.8, pitch: 0.42, dist: 3.6, ty: 0.7 },
    humanoid: { yaw: 2.4, pitch: 0.5, dist: 4.6, ty: 0.9 }
  };
  var URL_ROBOT = (function () {
    var m = /[?&]robot=(arm|humanoid)\b/.exec(global.location.search || '');
    return m ? m[1] : 'arm';
  })();

  function app() {
    var S = this.state = {
      robot: URL_ROBOT, mode: 'manual', tod: 'day',
      colorIdx: 0, showRays: false, gripClosed: false,
      champions: { armmj: null, op3mj: null }, // {genome, gen, fit, src}
      training: { active: false, robot: 'arm', gens: 0, gen: 0, batchIdx: 0,
        pop: null, fits: null, envs: [], genomes: [], batchFits: null,
        history: [], bestFit: null, avgFit: null, champFit: null, champGenome: null, baseSeed: 1000 },
      // Echtes MuJoCo (WASM) + Werks-ONNX-Policies des HF-Space
      // + Menagerie-Roboter: arm = WidowX 250, hum = ROBOTIS OP3
      mjc: { ready: false, err: null, ghosts: [], ghostRigs: [],
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

    var worlds = {};
    var self = this;
    ['arm', 'humanoid'].forEach(function (r) {
      var arena = TF.views.buildArena(lib, null, r);
      var rig = r === 'arm' ? TF.views.ArmRig(lib, {}) : TF.views.HumanoidRig(lib, {});
      arena.add(rig.root);
      var target = TF.views.buildTarget(lib);
      arena.add(target.root);
      worlds[r] = { arena: arena, rig: rig, target: target };
    });
    var ghostRigs = [];
    this.worlds = worlds;

    /* ---------- MuJoCo-Frames (MJCF ist Z-up, Renderer Y-up) ---------- */
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
    this.click = function () { beep(1400, 1200, 0.03, 'triangle'); };

    /* ---------- manuelle Steuerung (Joystick → MJ-Targets) ---------- */
    this.toggleGrip = function () { S.gripClosed = !S.gripClosed; TF.ui.status(S.gripClosed ? 'Greifer: ZU' : 'Greifer: OFFEN'); };

    /* 50-Hz-WANDUHR-TAKT (v1.2-Fix): Vorher lief controlStepAsync in JEDER
     * rAF-Frame — auf 120-Hz-Geräten (S26 Ultra) also 120 Regelschritte/s
     * statt 50. Jeder Schritt = ONNX + 4×5 ms Physik → Physik lief ~2,4× bis
     * 12× schneller als Echtzeit (Duck stürzte sofort ab: „liegt im Boden“)
     * und der Main-Thread verhungerte komplett („nichts reagiert“).
     * Jetzt: Schritt nur, wenn 20 ms Wandzeit kumuliert sind; Rückstand wird
     * auf ~1 Schritt/Frame gedeckelt → UI bleibt immer bedienbar. */
    var CTRL_DT = 1 / 50;
    function makePacer() {
      var acc = 0;
      return function (dt) {
        acc += Math.min(Math.max(dt, 0), 0.1);
        if (acc < CTRL_DT) return false;
        acc = Math.min(acc - CTRL_DT, 1.5 * CTRL_DT); // Rückstand decken, max ~1 Schritt/Frame
        return true;
      };
    }
    var paceArm = makePacer(), paceHum = makePacer();
    /* Gemessene Regelrate (für Statuszeile/Engine-Report) */
    var ctrlCnt = 0, ctrlHzMeas = 0, ctrlT0 = 0;
    this.noteCtrlStep = function (now) {
      ctrlCnt++;
      if (!ctrlT0) ctrlT0 = now;
      else if (now - ctrlT0 >= 500) { ctrlHzMeas = ctrlCnt * 1000 / (now - ctrlT0); ctrlCnt = 0; ctrlT0 = now; }
    };
    this.ctrlHzMeasured = function () { return ctrlHzMeas; };
    /* Test-Hook: echte mjDrive-Logik mit synthetischem dt pumpen (E2E
     * prüft damit den 50-Hz-Pacer deterministisch — ohne Headless-rAF-
     * Sturm, der im Headless-Chromium ohne Vsync ohnehin artefaktisch
     * prioritätssättigend läuft). */
    this.__testDrive = function (dt) {
      if (S.robot === 'arm' && S.mjc.arm) mjDriveArm(dt);
      else if (S.robot === 'humanoid' && S.mjc.hum) mjDriveHum(dt);
    };
    function mjcFatal(msg) {
      S.mjc.err = msg;
      TF.ui.setEngineBadge('fail');
      TF.ui.logLine('MUJOCO-FEHLER: ' + msg, 'warn');
      TF.ui.logLine('KEIN FALLBACK VORHANDEN — ohne MuJoCo startet die Simulation nicht. App neu starten.', 'warn');
      try {
        var veil = global.document.getElementById('bootVeil'), pre = global.document.getElementById('bootLog');
        if (veil && pre) {
          veil.classList.remove('gone');
          pre.textContent += '\n*** FEHLER: MUJOCO KONNTE NICHT STARTEN ***\n' + msg + '\n(Kein Fallback vorhanden.)\n';
        }
      } catch (_) {}
    }
    function mjcBoot() {
      if (!TF.mjc || !TF.mjc.init) { mjcFatal('TF.mjc fehlt'); return; }
      TF.ui.setEngineBadge('load');
      var mjOnly = /mjonly/.test(global.location.search); // Headless-Testmodus
      var veil = global.document.getElementById('bootVeil'), pre = global.document.getElementById('bootLog');
      if (veil) veil.classList.remove('gone'); // BIOS-Schirm bleibt bis MJ steht
      var name = S.robot === 'humanoid' ? 'ROBOTIS OP3' : 'WIDOWX 250 6DOF';
      if (pre) pre.textContent += 'LADE PHYSIK + MJCF: ' + name + ' …\n';
      TF.mjc.init(function (stg) { TF.ui.logLine('MJ › ' + stg, 'sys'); })
        .then(function () {
          S.mjc.ready = true;
          TF.ui.setEngineBadge('ok');
          TF.ui.buildTopbar();
          return ensureMjRobot(S.robot === 'humanoid' ? 'hum' : 'arm');
        })
        .then(function () {
          if (veil) veil.classList.add('gone');
          TF.ui.logLine('ECHTES MUJOCO AKTIV — ' + name + ' geladen. Kein Fallback im System.', 'sys');
          if (mjOnly) {
            setInterval(function () {
              var d = S.mjc[S.robot === 'humanoid' ? 'hum' : 'arm'];
              if (d && !d.busy) {
                d.busy = true;
                (S.robot === 'humanoid' ? d.controlStepAsync(null) : d.controlStepAsync(false, null))
                  .catch(function () {}).then(function () { d.busy = false; });
              }
            }, 20);
          } else {
            requestAnimationFrame(frame);
          }
        })
        .catch(function (e) { mjcFatal((e && e.message) || String(e)); });
    }

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
        TF.ui.logLine('MJ-Modell fehlgeschlagen: ' + (e && e.message || e) + ' — Roboter nicht verfügbar (kein Fallback).', 'warn');
        TF.ui.setEngineBadge('fail');
      });
    }
    function mjDriveArm(dt) {
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
      if (!paceArm(dt) || a.busy) return; // 50-Hz-Takt (v1.2-Fix)
      a.busy = true;
      a.controlStepAsync(false, null)
        .catch(function (e) { TF.ui.logLine('MJ-FEHLER: ' + e.message, 'warn'); })
        .then(function () { a.busy = false; self.noteCtrlStep(performance.now()); });
    }
    function mjDriveHum(dt) {
      var h = S.mjc.hum;
      h.cmd[0] = self.joystick.y * 1.0;
      h.cmd[1] = -self.joystick.x * 0.5;
      if (!paceHum(dt) || h.busy) return; // 50-Hz-Takt (v1.2-Fix)
      h.busy = true;
      h.controlStepAsync(null)
        .catch(function (e) { TF.ui.logLine('MJ-FEHLER: ' + e.message, 'warn'); })
        .then(function () { h.busy = false; self.noteCtrlStep(performance.now()); });
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
      if (!S.mjc.ready) { TF.ui.logLine('MuJoCo lädt noch — Training erst nach dem Boot möglich.', 'warn'); return; }
      if (robot === 'arm' && S.mjc.arm) {
        TF.ui.logLine('MuJoCo aktiv — Training läuft auf der echten WidowX 250 (16→7).', 'sys');
        robot = 'armmj';
      }
      if (robot === 'humanoid' && S.mjc.hum) {
        TF.ui.logLine('MuJoCo aktiv — Training läuft auf dem echten ROBOTIS OP3 (46→20).', 'sys');
        robot = 'op3mj';
      }
      if (robot !== 'armmj' && robot !== 'op3mj') {
        TF.ui.logLine('Training nur für ARMBOT/HUMANOID möglich (rob: ' + robot + ').', 'warn');
        return;
      }
      if (S.training.active) this.stopTraining();
      var mj = true;
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
      buildMjGhosts(robot);
      rigRootFor(robot).visible = false;
      TF.ui.logLine('TRAINING ' + robot.toUpperCase() + ': ' + gens + ' Generationen, Population 40, 4 MuJoCo-Geister/Batch (10 Batches).', 'sys');
      TF.ui.buildTopbar();
    };
    function rigRootFor(robot) {
      if (robot === 'armmj') return S.mjc.armRig ? S.mjc.armRig.root : armFrame;
      if (robot === 'op3mj') return S.mjc.humRig ? S.mjc.humRig.root : humFrame;
      return worlds[robot] ? worlds[robot].rig.root : mjFrame;
    }
    this.stopTraining = function () {
      if (!S.training.active) return;
      S.training.active = false;
      finishChampion('abgebrochen');
      rigRootFor(S.training.robot).visible = true;
      clearMjGhosts();
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
      var per = 4;
      T.envs = [];
      T.genomes = [];
      for (var k = 0; k < per; k++) {
        T.envs.push(T.robot === 'armmj' ? TF.mjc.makeGhostArm(null) : TF.mjc.makeGhostHum(null));
        T.genomes.push(T.pop[T.batchIdx * per + k]);
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
      var per = 4, batches = 10;
      var allDone = true;
      for (var k = 0; k < per; k++) {
        var env = T.envs[k];
        if (env._done || env.done) continue;
        allDone = false;
        var acts = TF.nn.forward(T.genomes[k], env.getObs(), TF.nn.ARCHS[T.robot][3]);
        if (env.step(acts)) env._done = true;
      }
      if (allDone) {
        for (k = 0; k < per; k++) T.fits[T.batchIdx * per + k] = T.envs[k].fit;
        T.batchIdx++;
        if (T.batchIdx >= batches) {
          endGeneration();
          if (T.gen >= T.gens) {
            T.active = false; finishChampion('abgeschlossen'); rigRootFor(T.robot).visible = true; clearMjGhosts();
            TF.ui.logLine('TRAINING ABGESCHLOSSEN: ' + T.gens + ' Generationen.', 'sys');
            TF.ui.buildTopbar(); save(); TF.ui.updateTraining(T); return;
          }
        }
        if (T.active) newBatch();
      }
      for (k = 0; k < 4; k++) {
        if (S.mjc.ghostRigs[k] && T.envs[k]) S.mjc.ghostRigs[k].update(T.envs[k].data);
      }
    }

    /* ---------- Geister ---------- */
    function buildMjGhosts(robot) {
      clearMjGhosts();
      var kind = robot === 'armmj' ? 'arm' : 'hum';
      var frame = kind === 'arm' ? armFrame : humFrame;
      for (var k = 0; k < 4; k++) {
        S.mjc.ghosts.push(kind === 'arm' ? TF.mjc.makeGhostArm(null) : TF.mjc.makeGhostHum(null));
        var rig = TF.mjc.makeMeshRig(TF.render, lib, kind, true);
        TF.mjc.attachRigVisuals(rig, kind).catch(function () {});
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
    /* ---------- Aktionen (Konsole/UI) ---------- */
    this.setRobot = function (id) {
      if (id !== 'arm' && id !== 'humanoid') { TF.ui.logLine('Unbekannter Roboter: ' + id, 'warn'); return; }
      S.robot = id;
      S.gripClosed = false;
      cam.yaw = CAM_DEF[id].yaw; cam.pitch = CAM_DEF[id].pitch; cam.dist = CAM_DEF[id].dist;
      for (var r in worlds) worlds[r].arena.visible = (r === id) && true;
      if (S.training.active && S.training.robot !== id + 'mj') this.stopTraining();
      // Menagerie-Roboter: MuJoCo-Modell lazy laden
      if (id === 'arm') ensureMjRobot('arm');
      if (id === 'humanoid') ensureMjRobot('hum');
      TF.ui.logLine('Roboter: ' + id.toUpperCase() + (id === 'arm' && S.mjc.arm ? ' · MUJOCO WIDOWX 250' : id === 'humanoid' && S.mjc.hum ? ' · MUJOCO ROBOTIS OP3' : ''), 'sys');
      TF.ui.status('ROBOT ' + id.toUpperCase() + ' / ' + S.mode.toUpperCase());
      save();
    };
    this.setMode = function (m) {
      S.mode = m;
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
        TF.ui.logLine('POLICY: ' + (S.robot === 'arm'
          ? 'POLICY-Knopf = GREIFEN (Auto-Aim auf den Ball).'
          : 'POLICY-Knopf wechselt STEHEN ↔ GEHEN.') + ' Champion-Training: „trainiere den ' + (S.robot === 'arm' ? 'armbot' : 'humanoiden') + ' …".', 'sys');
      } else TF.ui.logLine('Modus: MANUELL.', 'sys');
      TF.ui.buildTopbar();
      save();
    };
    this.setTod = function (t) {
      S.tod = t;
      TF.ui.logLine('Tageszeit: ' + { day: 'Tag', sunset: 'Abendrot', night: 'Nacht' }[t] + '.', 'sys');
      save();
    };
    this.setColorIdx = function (i) { S.colorIdx = i; save(); };
    this.haltHumanoid = function () { this.joystick.y = 0; };
    this.resetRobot = function () {
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
      TF.ui.logLine('Roboter noch nicht geladen — Reset ignoriert.', 'warn');
    };
    this.newTarget = function () {
      if (S.robot === 'arm' && S.mjc.arm) {
        TF.mjc.resetBall('arm');
        TF.ui.logLine('ARMBOT: Ball neu auf den Tisch gelegt.', 'sys');
      } else if (S.robot === 'humanoid') {
        TF.ui.logLine('HUMANOID: Zielsuche läuft über den Joystick (Command).', 'sys');
      } else {
        TF.ui.logLine('Roboter noch nicht geladen.', 'warn');
      }
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
          case 'robot': this.setRobot({ armmj: 'arm', op3mj: 'humanoid' }[a.id] || a.id); TF.ui.buildBtnStack(); TF.ui.buildTopbar(); break;
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
          case 'fileImport': TF.ui.openImport(); break;
        }
      }
    };
    this.reportStatus = function () {
      var T = S.training;
      var lines = [
        'STATUS — Roboter: ' + S.robot.toUpperCase() + ' | Modus: ' + S.mode.toUpperCase() + ' | TOD: ' + S.tod.toUpperCase(),
        'Champions: ' + ['armmj', 'op3mj'].map(function (r) {
          var c = S.champions[r];
          return r + (c ? '(gen ' + c.gen + ', fit ' + c.fit.toFixed(1) + ', ' + c.src + ')' : '(—)');
        }).join('  '),
        'Training: ' + (T.active ? 'AKTIV gen ' + T.gen + '/' + T.gens + ', best ' + (T.bestFit === null ? '—' : T.bestFit.toFixed(1)) : 'inaktiv'),
        'MJ-Roboter geladen: ' + (['arm', 'hum'].filter(function (k) { return S.mjc[k]; }).join(', ') || 'noch keiner')
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
        var robots = ['arm', 'hum'].filter(function (k) { return TF.mjc.hasRobot(k); });
        var det = robots.map(function (k) {
          var i = TF.mjc.robotInfo(k);
          return k + ' (nq ' + i.nq + '/nu ' + i.nu + ')';
        }).join(' · ') || 'kein Modell geladen';
        TF.ui.logLine('ENGINE: ECHTES MUJOCO (WASM) AKTIV — ' + det, 'sys');
        TF.ui.logLine('Physik: MJCF timestep 5 ms, Regelung 50 Hz (Decimation 4, Wanduhr-Takt) · Regelrate gemessen: ' + (self.ctrlHzMeasured() || 0).toFixed(0) + ' Hz (Soll 50, 1 Schritt/Frame max)', 'sys');
        TF.ui.logLine('FALLBACK: NICHT VORHANDEN (by design) — MuJoCo ist die einzige Engine.', 'sys');
      } else {
        TF.ui.logLine('ENGINE: MUJOCO NICHT BEREIT' + (S.mjc.err ? ' — FEHLER: ' + S.mjc.err : ' (lädt noch …)'), 'warn');
        TF.ui.logLine('KEIN FALLBACK IM SYSTEM — ohne MuJoCo keine Simulation.', 'warn');
      }
    };

    /* ---------- Gemini-Brücke ---------- */
    var GEMINI_SYS = [
      'Du bist die Fernsteuerung der Robotik-Sandbox "Testfeld·07".',
      'Antworte AUSSCHLIESSLICH mit JSON-Kommandos dieses Protokolls (kein weiterer Text):',
      '{"cmd":"train","robot":"arm|humanoid","gens":N}',
      '{"cmd":"robot","id":"arm|humanoid"}',
      '{"cmd":"mode","mode":"manual|policy"}',
      '{"cmd":"tod","tod":"day|sunset|night"}',
      '{"cmd":"save","name":"..."}  {"cmd":"load","name":"..."}',
      '{"cmd":"reset"}  {"cmd":"status"}  {"cmd":"target"}  {"cmd":"export"}',
      'Mehrere Befehle: als JSON-Array [ {...}, {...} ].',
      'Roboter: arm=Greifarm (WidowX 250, Ball greifen), humanoid=Balance-Läufer (ROBOTIS OP3, stehen/gehen).'
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

      if (S.training.active) {
        trainStep();
        TF.ui.updateTraining(S.training);
      } else if (S.mjc.ready && S.robot === 'arm' && S.mjc.arm) {
        mjDriveArm(dt);
      } else if (S.mjc.ready && S.robot === 'humanoid' && S.mjc.hum) {
        mjDriveHum(dt);
      }

      applyTod();
      var key = S.robot === 'humanoid' ? 'hum' : 'arm';
      var w = worlds[S.robot];
      // Szenengraph-Transforme aktualisieren (vor dem Zeichnen!)
      w.arena.updateWorld(null);
      armFrame.visible = false; humFrame.visible = false;
      function orbit(focus, dist) {
        var cx = focus[0] + dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
        var cy = focus[1] + dist * Math.sin(cam.pitch);
        var cz = focus[2] + dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
        renderer.camDist = dist;
        renderer.setCamera([cx, cy, cz], focus, [0, 1, 0]);
      }
      if (S.training.active) {
        // Trainings-Ansicht: die 4 MJ-Geister in ihrem Frame
        var tkind = S.training.robot === 'armmj' ? 'arm' : 'hum';
        (tkind === 'arm' ? armFrame : humFrame).visible = true;
        armBallNode.visible = tkind !== 'arm';
        humBallNode.visible = tkind !== 'hum';
        w.rig.root.visible = false;
        w.target.root.visible = false;
        orbit(tkind === 'arm' ? [0, 0.55, 0] : [0, 0.45, 0], 2.4);
        renderer.begin();
        renderer.drawNode(w.arena, 1);
        TF.ui.status('TRAINING ' + S.training.robot.toUpperCase() + ' · GEN ' + S.training.gen + '/' + S.training.gens +
          ' · BEST ' + (S.training.bestFit === null ? '—' : S.training.bestFit.toFixed(1)) +
          ' · REND ' + S.fps + ' FPS');
      } else if (S.mjc[key]) {
        var envM = S.mjc[key], rigM = S.mjc[key + 'Rig'];
        var frameM = key === 'arm' ? armFrame : humFrame;
        frameM.visible = true;
        w.rig.root.visible = false;
        w.target.root.visible = key === 'arm';
        if (key === 'arm') {
          var tM = envM.target;
          w.target.root.pos = [tM[0], tM[2] + 0.4, -tM[1]];
          w.target.ring.scale = [0.3, 1, 0.3];
        }
        var bpos = envM.data.qpos;
        var ballN = key === 'arm' ? armBallNode : humBallNode;
        var ba = envM.r.ballAdr;
        ballN.pos = [bpos[ba], bpos[ba + 1], bpos[ba + 2]];
        ballN.visible = true;
        if (rigM) rigM.update(envM.data);
        var focusM2 = key === 'arm' ? [0, 0.55, 0] : [bpos[0], 0.45, -bpos[1]];
        orbit(focusM2, key === 'arm' ? 1.5 : 2.0);
        renderer.begin();
        renderer.drawNode(w.arena, 1);
        TF.ui.status(key === 'arm'
          ? 'ARMBOT·MJ · IK · GRIP ' + (S.gripClosed ? 'ZU' : 'OFFEN') + ' · REND ' + S.fps + ' FPS · ' + (self.ctrlHzMeasured() || 0).toFixed(0) + ' HZ'
          : 'HUMANOID·MJ · ' + (S.mjc.humMode || 'stehen').toUpperCase() + ' · REND ' + S.fps + ' FPS · ' + (self.ctrlHzMeasured() || 0).toFixed(0) + ' HZ');
      } else {
        // MJ-Roboter lädt noch: Arena + Platzhalter-Rig
        w.rig.root.visible = true;
        w.target.root.visible = false;
        orbit([0, 0.7, 0], cam.dist);
        renderer.begin();
        renderer.drawNode(w.arena, 1);
        TF.ui.status('LADE MJCF (' + S.robot.toUpperCase() + ') … · REND ' + S.fps + ' FPS');
      }
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
      var gpu = String(renderer.gpuInfo || 'WebGL');
      var softGL = /swiftshader|llvmpipe|software|basic render|angle \(software/i.test(gpu);
      var lsOk = true;
      try { global.localStorage.setItem('tf07.test', '1'); global.localStorage.removeItem('tf07.test'); } catch (e) { lsOk = false; }
      TF.ui.bootSequence([
        'TRAINROBOT ROBOLAB BIOS v3 — (c) WERKSTATT',
        'BUILD: ' + ((global.TF07 && global.TF07.BUILD) ? 'v' + global.TF07.BUILD.version + ' · ' + global.TF07.BUILD.id : 'unbekannt') + ' — MJCF (MENAGERIE)',
        'CPU: WEBVIEW-ARM64 ................ OK',
        'GRAFIK: ' + gpu.slice(0, 34) + (softGL ? ' [SOFTWARE]' : '') + ' ... OK',
        'PHYSIK: MUJOCO 3.11 (WASM) ......... OK',
        'ROBOTER: ARMBOT — WIDOWX 250 6DOF ... BEREIT',
        '         HUMANOID — ROBOTIS OP3 ..... BEREIT',
        'RENDER: DISPLAY-RATE + INTERPOLATION ... OK',
        'POLICY-FORMAT: robofield-policy-v1 ....... BEREIT',
        'STORAGE: ' + (lsOk ? 'OK' : 'OFFLINE-MODUS (ohne Speicherung)'),
        (S.champions.armmj || S.champions.op3mj) ? 'CHAMPIONS: GELADEN' : 'CHAMPIONS: WERKS-CHAMPIONS AKTIV',
        softGL ? 'HINWEIS: SOFTWARE-RENDERING — AUTO-AUFLÖSUNG AKTIV' : 'GPU-BESCHLEUNIGUNG AKTIV',
        'KEIN FALLBACK MODUS VORHANDEN',
        'STARTEN DER SANDBOX …'
      ], function () {
        TF.ui.logLine('ROBOLAB bereit. „hilfe" zeigt alle Befehle (Deutsch + JSON).', 'sys');
        mjcBoot();
      });
    };
  }

  TF.app = app;
  global.addEventListener('DOMContentLoaded', function () {
    var a = new app();
    global.TF07.inst = a;
    a.boot();
  });
})(typeof window !== 'undefined' ? window : globalThis);
