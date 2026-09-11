/* Testfeld·07 — ECHTES MuJoCo (WASM) + fertige ONNX-Policies des HF-Space
 * pollen-robotics/microduck-simulator. Physik & Regler exakt wie im Original:
 *   obs(61) = gyro(3) + projGravity(3) + (qpos−DEFAULT_POSE)(14) + qvel(14)
 *           + lastAction(14) + cmd(13)
 *   ctrl    = DEFAULT_POSE + act × actionScale
 *   50 Hz Regelung: DECIMATION=4 Substeps à 5 ms (TIMESTEP 0.005)
 * Policy-Slots: walk (BEST_alpha_walking), drive (BEST_roller),
 *               sitstand, stand (Aufstehen), rollers-Reset via Keyframe.
 *assets liegen neben index.html: mjc/… (offline in der APK, Bridge-Loader). */
(function (global) {
  'use strict';
  var TF = global.TF07 = global.TF07 || {};

  var MJC_DIR = 'mjc/';
  var JOINT_NAMES = [
    'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
    'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll',
    'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle'
  ];
  var DEFAULT_POSE = new Float32Array([
    0, -0.08726646259971647, -0.457924, -0.00494, 0.452984,
    0.3490658503988659, 0.3490658503988659, 0, 0,
    0, 0.08726646259971647, 0.457924, 0.00494, -0.452984
  ]);
  var OBS_SIZE = 61, NUM_JOINTS = 14, CMD_SIZE = 13;
  var TIMESTEP = 0.005, DECIMATION = 4;
  var VEL = { legs: [0.25, -0.2, 1.0], rollers: [0.6, -0.5, 0.3] };
  var POLICY_FILES = {
    walk: 'BEST_alpha_walking.onnx',
    sitstand: 'BEST_alpha_sitstand.onnx',
    stand: 'BEST_alpha_stand.onnx',
    drive: 'BEST_roller.onnx',
    crouch: 'BEST_roller_crouch.onnx',
    roll: 'roulade.onnx',
    groundpick: 'alpha_ground_pick.onnx',
    kickL: 'ball_kick_left.onnx',
    kickR: 'ball_kick_right.onnx'
  };
  var EAGER = ['walk', 'drive', 'sitstand', 'stand'];

  /* ---------- Asset-Lader: AndroidBridge (file://) oder fetch (http) ----------
   * WICHTIG (v1.1-Fix): Die Java-Bridge (MainActivity) öffnet getAssets().open(
   * "mjc/" + pfad). JS darf daher NUR den relativen Pfad OHNE "mjc/"-Präfix
   * übergeben — vorher wurde doppelt präfixiert ("mjc/mjc/…") → Bridge lieferte
   * null → atob("null") erzeugte Müll-Bytes → WASM-Boot scheiterte still →
   * unsichtbarer Werkstatt-Fallback (sah aus wie die alte Version!). */
  function b64ToBytes(b64) {
    if (!b64) throw new Error('Bridge: leere Base64-Antwort (Asset fehlt?)');
    var bin = global.atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bridgePath(rel) {
    var p = String(rel == null ? '' : rel);
    while (p.charAt(0) === '/') p = p.slice(1);
    if (p.slice(0, 4) === 'mjc/') p = p.slice(4); // Java-Brücke Präfixiert selbst
    return p;
  }
  function readAsset(rel) {
    if (global.AndroidBridge && global.AndroidBridge.readAssetBase64) {
      /* v1.2-Fix: GROSSE Dateien (mujoco.wasm 10 MB, ort-wasm 13,5 MB) vorher
       * in EINEM Bridge-Call = ein einziger langer Main-Thread-Block + ein
       * ~18-MB-Base64-String (Geräte: rAF/Input starvation, IPC-Risiko).
       * Jetzt: 1-MB-Chunks, zwischen den Calls yield → UI bleibt flüssig,
       * Fortschritt im Konsole-Log sichtbar. Kleine Dateien: 1 Call. */
      var br = global.AndroidBridge;
      var CHUNK = 1048576, USE_CHUNKS = typeof br.readAssetChunkBase64 === 'function';
      function whole() {
        var b64;
        try { b64 = br.readAssetBase64(bridgePath(rel)); }
        catch (e) { return Promise.reject(new Error('Bridge-Fehler bei mjc/' + rel + ': ' + e)); }
        if (!b64) return Promise.reject(new Error('Bridge: Asset fehlt (mjc/' + rel + ')'));
        return Promise.resolve(b64ToBytes(b64));
      }
      function yieldNow() { return new Promise(function (r) { setTimeout(r, 0); }); }
      function chunked() {
        var parts = [], off = 0, lastLog = 0;
        function step() {
          var b64;
          try { b64 = br.readAssetChunkBase64(bridgePath(rel), off, CHUNK); }
          catch (e) { return Promise.reject(new Error('Bridge-Fehler bei mjc/' + rel + ': ' + e)); }
          if (b64 == null) return Promise.reject(new Error('Bridge: Asset fehlt (mjc/' + rel + ')'));
          var bytes = b64ToBytes(b64);
          if (!bytes.length) return Promise.reject(new Error('Bridge: Chunk leer (mjc/' + rel + ' @ ' + off + ')'));
          parts.push(bytes); off += bytes.length;
          if (off - lastLog >= 4194304) { // Progress alle ~4 MB
            TF.ui.logLine && TF.ui.logLine('Lade ' + rel + ' … ' + (off / 1048576).toFixed(1) + ' MB', 'sys');
            lastLog = off;
          }
          if (bytes.length < CHUNK) return Promise.resolve(concatParts(parts));
          return yieldNow().then(step);
        }
        return step();
      }
      function concatParts(parts) {
        var n = 0, i;
        for (i = 0; i < parts.length; i++) n += parts[i].length;
        var out = new Uint8Array(n), o = 0;
        for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
        return out;
      }
      if (!USE_CHUNKS) return whole();
      /* Chunked wenn möglich (1. Chunk < CHUNK → fertig, wie 1 Call) */
      return chunked();
    }
    return global.fetch(MJC_DIR + rel).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' für ' + rel);
      return r.arrayBuffer();
    }).then(function (b) { return new Uint8Array(b); });
  }
  function readAssetText(rel) {
    if (global.AndroidBridge && global.AndroidBridge.readAssetText) {
      var t;
      try { t = global.AndroidBridge.readAssetText(bridgePath(rel)); }
      catch (e) { return Promise.reject(new Error('Bridge-Fehler bei mjc/' + rel + ': ' + e)); }
      if (t == null) return Promise.reject(new Error('Bridge: Asset fehlt (mjc/' + rel + ')'));
      return Promise.resolve(t);
    }
    return global.fetch(MJC_DIR + rel).then(function (r) { return r.text(); });
  }
  function loadScript(rel) {
    return new Promise(function (res, rej) {
      var s = global.document.createElement('script');
      s.src = MJC_DIR + rel;
      s.onload = res; s.onerror = function () { rej(new Error('Skript fehlt: ' + rel)); };
      global.document.head.appendChild(s);
    });
  }

  /* ---------- Zustand ---------- */
  var mjc = null;          // { mujoco, ort, model, data, sessions, adr… }
  var sessions = {};       // slot → InferenceSession (lazy)
  var loadingSessions = {};

  var SESSION_TIMEOUT = 20000; // ms — Gerätetreiber-Hänger sichtbar machen
  function withTimeout(p, what) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('ONNX-Timeout (' + what + ' nach ' + (SESSION_TIMEOUT / 1000) + ' s)')); }, SESSION_TIMEOUT);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function getSession(slot) {
    if (sessions[slot]) return Promise.resolve(sessions[slot]);
    if (loadingSessions[slot]) return loadingSessions[slot];
    loadingSessions[slot] = readAsset('policies/' + POLICY_FILES[slot]).then(function (bytes) {
      return withTimeout(mjc.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), 'Session ' + slot);
    }).then(function (s) {
      sessions[slot] = s; delete loadingSessions[slot];
      TF.ui && TF.ui.logLine && TF.ui.logLine('Policy geladen: ' + slot.toUpperCase() + ' (' + POLICY_FILES[slot] + ')', 'sys');
      return s;
    }).catch(function (e) {
      delete loadingSessions[slot];
      throw e;
    });
    return loadingSessions[slot];
  }

  /* ---------- Quaternion-Helfer (MJCF wxyz → Renderer xyzw, Z-up→Y-up) ---------- */
  function quatFlipMj(qwxyz) {
    // q_gl = qRotX(-90°) * q_mj ; Renderer-Order [x,y,z,w]
    var w = qwxyz[0], x = qwxyz[1], y = qwxyz[2], z = qwxyz[3];
    var fx = -0.7071067811865476, fy = 0, fz = 0, fw = 0.7071067811865476;
    // Quaternion-Multiplikation f*q (Hamilton)
    return [
      fw * x + fx * w + fy * z - fz * y,
      fw * y + fy * w + fz * x - fx * z,
      fw * z + fz * w + fx * y - fy * x,
      fw * w - fx * x - fy * y - fz * z
    ];
  }
  function quatMul(a, b) { // [x,y,z,w]
    var ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by + ay * bw + az * bx - ax * bz,
      aw * bz + az * bw + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }

  /* ---------- Projekt-Gravitation (Welt −Z in Trunk-Frame) ---------- */
  function projGrav(xq) {
    var w = xq[0], x = xq[1], y = xq[2], z = xq[3];
    // R^T · (0,0,−1)
    return [-(2 * (x * z - w * y)), -(2 * (w * x + y * z)), -(1 - 2 * (x * x + y * y))];
  }

  /* ---------- init(): wasm + ort + MJCF + eager policies ---------- */
  function stageMark(s) {
    try { global.document.cookie = 'tf07mj=' + encodeURIComponent(s) + ';path=/'; } catch (e) {}
  }
  function stageErr(e) {
    try { global.document.cookie = 'tf07mjerr=' + encodeURIComponent(String(e && e.message || e).slice(0, 200)) + ';path=/'; } catch (err) {}
  }
  function init(onStage) {
    if (mjc) return Promise.resolve(mjc);
    onStage = onStage || function () {};
    onStage = (function (cb) { return function (s) { stageMark(s); cb(s); }; })(onStage);
    var p = loadScript('mujoco.wrapped.js')
      .then(function () { return loadScript('ort.glue.js'); })
      .then(function () { return loadScript('ort.global.js'); })
      .then(function () {
        if (!global.TF07_loadMujoco || !global.ort) throw new Error('WASM-Glue fehlt');
        onStage('MUJOCO WASM …');
        return readAsset('mujoco.wasm');
      })
      .then(function (wasmBytes) {
        return global.TF07_loadMujoco({ wasmBinary: wasmBytes });
      })
      .then(function (module) {
        var ort = global.ort;
        /* v1.2-Härtung: pthread-Pool NIEMALS spawnen (Worker von file:// aus
         * nicht ladbar, Pool-Warten würde session.create() endlos blockieren),
         * Proxy-Worker explizit aus. Gültige Werte überschreiben den
         * hardwareConcurrency-Autowert von ort.global.js zuverlässig. */
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        onStage('ORT WASM …');
        return readAsset('ort-wasm-simd-threaded.wasm').then(function (b) {
          ort.env.wasm.wasmBinary = b;
          return { mujoco: module, ort: ort };
        });
      })
      .then(function (core) {
        onStage('MJCF …');
        return readAssetText('duck_legs.xml').then(function (xml) {
          core.xml = xml;
          return core;
        });
      })
      .then(function (core) {
        var mujoco = core.mujoco;
        var vfs = new mujoco.MjVFS();
        core.vfs = vfs;
        var names = ['bottom_head_shell.stl', 'hip_l.stl', 'jaw.stl', 'leg.stl', 'np_f970.stl',
          'power_support.stl', 'sole_left.stl', 'sole_right.stl', 'top_head_shell.stl', 'tire.stl'];
        return Promise.all(names.map(function (f) {
          return readAsset('meshes/' + f).then(function (b) { vfs.addBuffer('assets/' + f, b); });
        })).then(function () {
          core.model = mujoco.MjModel.from_xml_string(core.xml, vfs);
          core.data = new mujoco.MjData(core.model);
          return core;
        });
      })
      .then(function (core) {
        var mujoco = core.mujoco, model = core.model, data = core.data;
        core.qposAdr = JOINT_NAMES.map(function (n) { return model.jnt(n).qposadr; });
        core.dofAdr = JOINT_NAMES.map(function (n) { return model.jnt(n).dofadr; });
        var sen = model.sensor('imu_ang_vel');
        core.gyroAdr = typeof sen.adr === 'number' ? sen.adr : sen.adr[0];
        core.trunkId = model.body('trunk_base').id;
        core.ballAdr = model.jnt('ball_freejoint').qposadr;
        mujoco.mj_resetDataKeyframe(model, data, 0);
        mujoco.mj_forward(model, data);
        mjc = core;
        onStage('BEREIT');
        /* v1.2-Fix: Werkspolicies NICHT mehr im Boot-Pfad kompilieren —
         * auf Geräten kann InferenceSession.create je Policy Sekunden
         * dauern; Promise.all(4×) blockierte „BEREIT“ endlos („lädt nicht
         * zu Ende“). Jetzt: Modell sofort aktiv, Policies sequential im
         * Hintergrund — getSession(slot) liefert sie lazy ohnehin. */
        warmEager(onStage);
        return mjc;
      });
    p.catch(stageErr);
    return p;
  }

  /* Werkspolicies nacheinander im Hintergrund kompilieren — zwischen den
   * Sessions yield (setTimeout 0), damit rAF/Input weiterlaufen. */
  function warmEager(onStage) {
    var i = 0;
    function next() {
      if (i >= EAGER.length) {
        if (onStage) onStage('POLICIES ' + EAGER.length + '/' + EAGER.length);
        return;
      }
      var slot = EAGER[i++];
      getSession(slot).then(function () {
        setTimeout(next, 0);
      }).catch(function (e) {
        TF.ui.logLine && TF.ui.logLine('Policy ' + slot + ' nicht ladbar: ' + (e && e.message || e) + ' — Slot wird bei Bedarf erneut versucht.', 'warn');
        setTimeout(next, 250);
      });
    }
    setTimeout(next, 0);
  }

  var isReady = function () { return !!mjc; };

  /* ---------- Microduck-Env auf echtem MuJoCo ---------- */
  function DuckMj() {
    this.model = mjc.model;
    this.data = mjc.data;          // Haupt-Instanz teilt die aktive Daten
    this.obs = new Float32Array(OBS_SIZE);
    this.cmd = new Float32Array(CMD_SIZE); // [vx, vy, wz, head4, body6]
    this.lastAction = new Float32Array(NUM_JOINTS);
    this.mode = 'walk';            // walk | drive | sitstand
    this.busy = false;
    this.steps = 0; this.fit = 0; this.fallen = false;
    this.ctrlHz = 0;
    this.velLims = function () { return this.mode === 'drive' ? VEL.rollers : VEL.legs; };
    this.x0 = 0; this.y0 = 0;
  }

  DuckMj.prototype.getObs = function () {
    var core = mjc, data = this.data, i = 0, obs = this.obs;
    for (var a = 0; a < 3; a++) obs[i++] = data.sensordata[core.gyroAdr + a];
    var xq = data.body(core.trunkId).xquat;
    var g = projGrav(xq);
    obs[i++] = g[0]; obs[i++] = g[1]; obs[i++] = g[2];
    for (var j = 0; j < NUM_JOINTS; j++) obs[i++] = data.qpos[core.qposAdr[j]] - DEFAULT_POSE[j];
    for (j = 0; j < NUM_JOINTS; j++) obs[i++] = data.qvel[core.dofAdr[j]];
    for (j = 0; j < NUM_JOINTS; j++) obs[i++] = this.lastAction[j];
    for (j = 0; j < CMD_SIZE; j++) obs[i++] = this.cmd[j];
    return obs;
  };

  DuckMj.prototype.reset = function () {
    mjc.mujoco.mj_resetDataKeyframe(this.model, this.data, 0);
    mjc.mujoco.mj_forward(this.model, this.data);
    this.steps = 0; this.fit = 0; this.fallen = false;
    this.lastAction.fill(0);
    this.x0 = this.data.qpos[0]; this.y0 = this.data.qpos[1];
  };

  DuckMj.prototype.setCmd = function (vx, vy, wz) {
    var lim = this.velLims();
    this.cmd[0] = Math.max(lim[1], Math.min(lim[0], vx));
    this.cmd[1] = Math.max(-0.3, Math.min(0.3, vy));
    this.cmd[2] = Math.max(-lim[2], Math.min(lim[2], wz));
  };

  DuckMj.prototype.applyAction = function (act) {
    var data = this.data;
    for (var j = 0; j < NUM_JOINTS; j++) {
      var a = +act[j];
      if (!isFinite(a)) return false;
      this.lastAction[j] = a;
      data.ctrl[j] = DEFAULT_POSE[j] + a * 1.0;
    }
    return true;
  };

  DuckMj.prototype.substep = function () {
    mjc.mujoco.mj_step(this.model, this.data);
    this.steps++;
    var g = projGrav(this.data.body(mjc.trunkId).xquat);
    this.fallen = (g[2] > -0.5 || this.data.qpos[2] < 0.02);
    // Fitness: Fortschritt entlang +x (Trainingsrichtung), Strafe bei Sturz
    this.fit = (this.data.qpos[0] - this.x0) + (this.fallen ? -1.0 : 0);
    return this.fallen;
  };

  /* Asynchroner 50-Hz-Regel-Schritt: obs → ONNX → ctrl → 4 Substeps.
   * Gefallen? → Stand-Policy (Aufstehen) mit genulltem Command. */
  DuckMj.prototype.controlStepAsync = function (slot) {
    var self = this;
    var s = this.fallen ? 'stand' : (slot || this.mode);
    return getSession(s).then(function (session) {
      if (self.fallen) { self.cmd[0] = 0; self.cmd[1] = 0; self.cmd[2] = 0; }
      var feeds = {};
      feeds[session.inputNames[0]] = new mjc.ort.Tensor('float32', self.getObs(), [1, OBS_SIZE]);
      return session.run(feeds).then(function (out) {
        var act = out[session.outputNames[0]].data;
        if (!self.applyAction(act)) { self.reset(); return; }
        for (var k = 0; k < DECIMATION; k++) self.substep();
      });
    });
  };

  /* Trainings-Env: eigenes MjData (Geist), MLP-Genome steuern Aktionen. */
  function GhostDuck() {
    this.data = new mjc.mujoco.MjData(mjc.model);
    this.obs = new Float32Array(OBS_SIZE);
    this.lastAction = new Float32Array(NUM_JOINTS);
    this.steps = 0; this.fit = 0; this.done = false; this.fallen = false;
    this.reset();
  }
  GhostDuck.prototype.reset = function () {
    var core = mjc;
    core.mujoco.mj_resetDataKeyframe(core.model, this.data, 0);
    core.mujoco.mj_forward(core.model, this.data);
    this.steps = 0; this.fit = 0; this.done = false; this.fallen = false;
    this.lastAction.fill(0);
  };
  GhostDuck.prototype.getObs = function () {
    var core = mjc, data = this.data, i = 0, obs = this.obs;
    for (var a = 0; a < 3; a++) obs[i++] = data.sensordata[core.gyroAdr + a];
    var g = projGrav(data.body(core.trunkId).xquat);
    obs[i++] = g[0]; obs[i++] = g[1]; obs[i++] = g[2];
    for (var j = 0; j < NUM_JOINTS; j++) obs[i++] = data.qpos[core.qposAdr[j]] - DEFAULT_POSE[j];
    for (j = 0; j < NUM_JOINTS; j++) obs[i++] = data.qvel[core.dofAdr[j]];
    for (j = 0; j < NUM_JOINTS; j++) obs[i++] = this.lastAction[j];
    for (j = 0; j < CMD_SIZE; j++) obs[i++] = 0; // Trainings-Command: neutral
    return obs;
  };
  GhostDuck.prototype.step = function (acts) {
    var data = this.data;
    for (var j = 0; j < NUM_JOINTS; j++) {
      var a = clampNum(acts[j]);
      this.lastAction[j] = a;
      data.ctrl[j] = DEFAULT_POSE[j] + a;
    }
    for (var k = 0; k < DECIMATION; k++) {
      mjc.mujoco.mj_step(mjc.model, data);
      this.steps++;
    }
    var g = projGrav(data.body(mjc.trunkId).xquat);
    this.fallen = (g[2] > -0.5 || data.qpos[2] < 0.02);
    this.fit = data.qpos[0] - (-0.6) - (this.fallen ? 1.0 : 0);
    if (this.fallen || this.steps >= 300) this.done = true;
    return this.done;
  };
  function clampNum(v) {
    v = +v;
    if (!isFinite(v)) return 0;
    return Math.max(-1, Math.min(1, v));
  }

  /* ---------- Skelett-Rig direkt aus dem Modell (qpos-getrieben) ---------- */
  function SkeletonRig(R, lib, ghost) {
    var core = mjc, model = core.model;
    var nbody = model.nbody, njnt = model.njnt;
    var alpha = ghost ? 0.25 : 1;
    var bp = model.body_pos, bq = model.body_quat;
    var jt = model.jnt_type, jb = model.jnt_bodyid, ja = model.jnt_axis, jp = model.jnt_pos;
    var qadr = model.jnt_qposadr;
    var COL = { body: [0.95, 0.87, 0.72, alpha], dark: [0.08, 0.08, 0.1, alpha], orange: [1, 0.48, 0.18, alpha] };
    // MJCF-Frame-Parent (Z-up → Y-up via Root-Quaternion)
    this.root = new R.Node();
    this.root.quat = [-0.7071067811865476, 0, 0, 0.7071067811865476];
    var nodes = {};
    var jointNodes = []; // {node, bodyId, axis, qadr}
    for (var b = 0; b < nbody; b++) {
      if (b === 0) continue; // world
      var n = new R.Node();
      n.pos = [bp[b * 3], bp[b * 3 + 1], bp[b * 3 + 2]];
      // wxyz → xyzw
      n.quat = [bq[b * 4 + 1], bq[b * 4 + 2], bq[b * 4 + 3], bq[b * 4]];
      nodes[b] = n;
      // Größe aus Trägheit/Body-Masse ableiten (grobes Skelett)
      var mass = model.body_mass[b];
      var s = Math.max(0.03, Math.min(0.09, 0.035 + mass * 0.16));
      var box = new R.Node(lib.unitBox, mass > 0.15 ? COL.body : COL.dark);
      box.scale = [s, s * 1.4, s * 0.8];
      n.add(box);
      if (b === 1) { // trunk: Kopf + Schnabel als unverwechselbares Duck-Merkmal
        var head = new R.Node(lib.unitSphere, COL.body);
        head.scale = [0.06, 0.06, 0.06]; head.pos = [0.03, 0.055, 0];
        n.add(head);
        var beak = new R.Node(lib.unitBox, COL.orange);
        beak.scale = [0.05, 0.02, 0.02]; beak.pos = [0.075, 0.045, 0];
        n.add(beak);
      }
    }
    // Eltern-Verkettung
    var parentId = model.body_parentid;
    for (b = 1; b < nbody; b++) {
      var p = parentId[b];
      (p === 0 ? this.root : nodes[p]).add(nodes[b]);
    }
    // Gelenke: Body-Node rotiert um seine Gelenkachse (Basis-Quat × Drehung)
    for (var j = 0; j < njnt; j++) {
      if (jt[j] === 0) continue; // free
      var bid = jb[j];
      var target = nodes[bid];
      if (target) {
        jointNodes.push({ node: target, axis: [ja[j * 3], ja[j * 3 + 1], ja[j * 3 + 2]], qadr: qadr[j], base: null });
      }
    }
    this.update = function (data) {
      var q = data.qpos;
      // Freejoint (trunk_base) → Position im MJCF-Frame; Root trägt den Flip
      nodes[1].pos = [q[0], q[1], q[2]];
      nodes[1].quat = [q[4], q[5], q[6], q[3]]; // wxyz → xyzw
      for (var i = 0; i < jointNodes.length; i++) {
        var jn = jointNodes[i];
        if (jn.node === nodes[1]) continue;
        var ang = q[jn.qadr];
        if (jn.base === null) jn.base = jn.node.quat.slice();
        jn.node.quat = quatMul(jn.base, quatAxisSafe(jn.axis, ang));
      }
    };
    function quatAxisSafe(axis, ang) {
      var l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
      var s = Math.sin(ang / 2);
      return [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(ang / 2)];
    }
    this.ghost = !!ghost;
  }

  /* ================================================================
   * MENAGERIE-ROBOTER (fertige Modelle der MuJoCo Model Gallery):
   *   arm  = WidowX 250 6DOF  (trossen_wx250s, 7 Positions-Aktuatoren)
   *   hum  = ROBOTIS OP3      (robotis_op3, 20 Positions-Aktuatoren)
   * Beide laufen im selben MuJoCo-WASM wie die Ente; die MJCFs liegen
   * vorbereitet (Werkstatt-Arena, offline) in mjc/.
   * ================================================================ */
  var sharedVfs = null;      // ein MjVFS für alle Modelle
  var robots = {};           // name → {model, data, ...} (arm | hum)

  var ARM_JOINTS = ['waist', 'shoulder', 'elbow', 'forearm_roll', 'wrist_angle', 'wrist_rotate'];
  var ARM_HOME = [0, -0.96, 1.16, 0, -0.3, 0];
  var ARM_RANGE = [[-3.14, 3.14], [-1.885, 1.99], [-2.147, 1.606], [-3.14, 3.14], [-1.745, 2.147], [-3.14, 3.14]];
  var GRIP_OPEN = 0.015, GRIP_CLOSED = 0.036;
  var ARM_BALL = [0.28, 0.12, 0.05];       // Ball auf dem Tisch (Tischkante z=0)
  var ARM_DT = 0.02, ARM_SUB = 4;          // 50 Hz Regelung

  var HUM_JOINTS = ['head_pan', 'head_tilt', 'l_sho_pitch', 'l_sho_roll', 'l_el',
    'r_sho_pitch', 'r_sho_roll', 'r_el',
    'l_hip_yaw', 'l_hip_roll', 'l_hip_pitch', 'l_knee', 'l_ank_pitch', 'l_ank_roll',
    'r_hip_yaw', 'r_hip_roll', 'r_hip_pitch', 'r_knee', 'r_ank_pitch', 'r_ank_roll'];
  var HUM_HOME = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, 0.9, 0.52, 0, 0, 0, -0.5, 0.9, 0.52, 0];
  var HUM_BALL = [0.5, 0.3, 0.05];
  var HUM_DT = 0.02, HUM_SUB = 4;          // 50 Hz Regelung (4 × 5 ms Substeps)

  function loadRobot(name) {
    if (robots[name]) return Promise.resolve(robots[name]);
    if (!mjc) return Promise.reject(new Error('mjc nicht initialisiert'));
    var core = mjc, mujoco = core.mujoco;
    if (!sharedVfs) sharedVfs = core.vfs || new mujoco.MjVFS();
    var file, meshPrefixes;
    if (name === 'arm') { file = 'wx250s.xml'; meshPrefixes = ['wx250s_']; }
    else if (name === 'hum') { file = 'op3.xml'; meshPrefixes = ['op3c_']; }
    else return Promise.reject(new Error('unbekannter MJ-Roboter: ' + name));
    return ensureAssetsIndex().then(function (index) {
      var jobs = [];
      for (var p = 0; p < meshPrefixes.length; p++) {
        for (var i = 0; i < index.length; i++) {
          var f = index[i];
          if (f.indexOf(meshPrefixes[p]) !== 0) continue;
          if (sharedVfs._tf07 && sharedVfs._tf07[f]) continue;
          (function (fn) {
            jobs.push(readAsset(fn).then(function (b) { return { n: fn, b: b }; }));
          })(f);
        }
      }
      return Promise.all(jobs);
    }).then(function (bufs) {
      for (var i = 0; i < bufs.length; i++) {
        sharedVfs.addBuffer('assets/' + bufs[i].n, bufs[i].b);
        if (!sharedVfs._tf07) sharedVfs._tf07 = {};
        sharedVfs._tf07[bufs[i].n] = true;
      }
      return readAssetText(file);
    }).then(function (xml) {
      var model = mujoco.MjModel.from_xml_string(xml, sharedVfs);
      var data = new mujoco.MjData(model);
      var r = { name: name, model: model, data: data, xml: xml };
      if (name === 'arm') {
        r.qadr = ARM_JOINTS.map(function (n) { return model.jnt(n).qposadr; });
        r.dofadr = ARM_JOINTS.map(function (n) { return model.jnt(n).dofadr; });
        r.eeId = model.body('wx250s/gripper_link').id;
        r.ballAdr = model.jnt('ball_freejoint').qposadr;
        r.freeBodyId = undefined;                 // Basis fest auf dem Tisch
        mujoco.mj_resetDataKeyframe(model, data, 0);
        armResetBall(r);
        mujoco.mj_forward(model, data);
      } else {
        r.qadr = HUM_JOINTS.map(function (n) { return model.jnt(n).qposadr; });
        r.dofadr = HUM_JOINTS.map(function (n) { return model.jnt(n).dofadr; });
        r.ballAdr = model.jnt('ball_freejoint').qposadr;
        r.trunkId = model.body('body_link').id;
        r.freeBodyId = r.trunkId;                 // Freejoint-Body (qpos 0..6)
        mujoco.mj_resetDataKeyframe(model, data, 0);
        humResetBall(r);
        mujoco.mj_forward(model, data);
      }
      robots[name] = r;
      TF.ui && TF.ui.logLine && TF.ui.logLine('MJCF geladen: ' + (name === 'arm' ? 'WidowX 250 6DOF' : 'ROBOTIS OP3') + ' (MuJoCo Menagerie)', 'sys');
      return r;
    });
  }
  // Asset-Index: was liegt in mjc/? (für VFS-Fütterung; wird lazy gefüllt)
  var assetsIndex = null;
  function ensureAssetsIndex() {
    if (assetsIndex) return Promise.resolve(assetsIndex);
    if (global.AndroidBridge && global.AndroidBridge.listAssets) {
      try { assetsIndex = JSON.parse(global.AndroidBridge.listAssets(MJC_DIR)); return Promise.resolve(assetsIndex); } catch (e) {}
    }
    return readAssetText('__index.json').then(function (t) {
      assetsIndex = JSON.parse(t);
      return assetsIndex;
    }).catch(function () {
      // Fallback: bekannte Präfixe durchprobieren ist teuer — stattdessen
      // feste Dateilisten (stimmen mit prepare_menagerie.py überein).
      assetsIndex = ['wx250s_1_base.stl', 'wx250s_2_shoulder.stl', 'wx250s_3_upper_arm.stl',
        'wx250s_4_upper_forearm.stl', 'wx250s_5_lower_forearm.stl', 'wx250s_6_wrist.stl',
        'wx250s_7_gripper.stl', 'wx250s_8_gripper_prop.stl', 'wx250s_9_gripper_bar.stl',
        'wx250s_10_gripper_finger.stl', 'wx250s_11_ar_tag.stl',
        'op3c_body.stl', 'op3c_body_sub1.stl', 'op3c_body_sub2.stl', 'op3c_body_sub3.stl',
        'op3c_body_sub4.stl', 'op3c_h1.stl', 'op3c_h2.stl', 'op3c_h2_sub1.stl', 'op3c_h2_sub2.stl',
        'op3c_ll1.stl', 'op3c_ll2.stl', 'op3c_ll3.stl', 'op3c_ll4.stl', 'op3c_ll5.stl', 'op3c_ll6.stl',
        'op3c_rl1.stl', 'op3c_rl2.stl', 'op3c_rl3.stl', 'op3c_rl4.stl', 'op3c_rl5.stl', 'op3c_rl6.stl',
        'op3c_la1.stl', 'op3c_la2.stl', 'op3c_la3.stl',
        'op3c_ra1.stl', 'op3c_ra2.stl', 'op3c_ra3.stl'];
      return assetsIndex;
    });
  }
  function armResetBall(r) {
    var a = r.ballAdr;
    r.data.qpos[a] = ARM_BALL[0]; r.data.qpos[a + 1] = ARM_BALL[1]; r.data.qpos[a + 2] = ARM_BALL[2];
    r.data.qpos[a + 3] = 1; r.data.qpos[a + 4] = 0; r.data.qpos[a + 5] = 0; r.data.qpos[a + 6] = 0;
  }
  function humResetBall(r) {
    var a = r.ballAdr;
    r.data.qpos[a] = HUM_BALL[0]; r.data.qpos[a + 1] = HUM_BALL[1]; r.data.qpos[a + 2] = HUM_BALL[2];
    r.data.qpos[a + 3] = 1; r.data.qpos[a + 4] = 0; r.data.qpos[a + 5] = 0; r.data.qpos[a + 6] = 0;
  }

  /* ---------- ARMBOT: WidowX 250 auf echtem MuJoCo ---------- */
  function ArmMj() {
    var r = robots.arm;
    this.r = r;
    this.data = r.data;
    this.obs = new Float32Array(16);      // qerr6 + qvel6 + ballDir3 + grip1
    this.ref = ARM_HOME.slice();          // IK-/Policy-Referenz (6)
    this.grip = 0;                        // 0 offen, 1 zu
    this.target = [0.26, 0.06, 0.06];     // Kartesisches Ziel (Joystick)
    this.steps = 0; this.fit = 0;
    this.x0 = 0;
  }
  ArmMj.prototype.eePos = function () {
    var p = this.data.body(this.r.eeId).xpos;
    return [p[0], p[1], p[2]];
  };
  ArmMj.prototype.ballPos = function () {
    var a = this.r.ballAdr, q = this.data.qpos;
    return [q[a], q[a + 1], q[a + 2]];
  };
  ArmMj.prototype.getObs = function () {
    var r = this.r, d = this.data, i = 0, obs = this.obs;
    for (var j = 0; j < 6; j++) obs[i++] = d.qpos[r.qadr[j]] - this.ref[j];
    for (j = 0; j < 6; j++) obs[i++] = d.qvel[r.dofadr[j]];
    var bp = this.ballPos(), ep = this.eePos();
    obs[i++] = bp[0] - ep[0]; obs[i++] = bp[1] - ep[1]; obs[i++] = bp[2] - ep[2];
    obs[i++] = this.grip;
    return obs;
  };
  ArmMj.prototype.reset = function () {
    var r = this.r;
    mjc.mujoco.mj_resetDataKeyframe(r.model, r.data, 0);
    armResetBall(r);
    mjc.mujoco.mj_forward(r.model, r.data);
    this.ref = ARM_HOME.slice(); this.grip = 0;
    this.steps = 0; this.fit = 0;
  };
  /* Numerische DLS-IK: Ziel → Gelenkreferenzen (6 Iterationen, deterministisch) */
  ArmMj.prototype.solveIK = function (target) {
    var r = this.r, d = r.data, mujoco = mjc.mujoco, k, j;
    var q0 = [];
    for (j = 0; j < 6; j++) q0.push(d.qpos[r.qadr[j]]);
    for (k = 0; k < 6; k++) {
      mujoco.mj_forward(r.model, d);
      var p = this.eePos();
      var ex = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
      var en = Math.sqrt(ex[0] * ex[0] + ex[1] * ex[1] + ex[2] * ex[2]);
      if (en < 0.004) break;
      var J = [], it;
      for (j = 0; j < 6; j++) {
        var save = d.qpos[r.qadr[j]];
        d.qpos[r.qadr[j]] = save + 1e-4;
        mujoco.mj_kinematics(r.model, d);
        var p2 = this.eePos();
        d.qpos[r.qadr[j]] = save;
        J.push([(p2[0] - p[0]) / 1e-4, (p2[1] - p[1]) / 1e-4, (p2[2] - p[2]) / 1e-4]);
      }
      // dq = Jᵀ(JJᵀ + λI)⁻¹ e  (3×3-System, λ=0.02)
      var JTJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (it = 0; it < 3; it++) for (var iu = 0; iu < 3; iu++) {
        var s = 0;
        for (j = 0; j < 6; j++) s += J[j][it] * J[j][iu];
        JTJ[it][iu] = s + (it === iu ? 0.02 : 0);
      }
      function inv3(m) {
        var a = m[0][0], b = m[0][1], c = m[0][2], d2 = m[1][0], e = m[1][1], f = m[1][2], g = m[2][0], h = m[2][1], i2 = m[2][2];
        var A = e * i2 - f * h, B = -(d2 * i2 - f * g), C = d2 * h - e * g;
        var det = a * A + b * B + c * C || 1e-9;
        return [[A / det, -(b * i2 - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i2 - c * g) / det, -(a * f - c * d2) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d2) / det]];
      }
      var inv = inv3(JTJ);
      var dq = [];
      for (j = 0; j < 6; j++) {
        // (JJᵀ+λI)⁻¹e zuerst, dann Jᵀ·y
        var yv = [0, 0, 0];
        for (iu = 0; iu < 3; iu++) yv[iu] = inv[iu][0] * ex[0] + inv[iu][1] * ex[1] + inv[iu][2] * ex[2];
        dq.push(J[j][0] * yv[0] + J[j][1] * yv[1] + J[j][2] * yv[2]);
      }
      for (j = 0; j < 6; j++) {
        var qn = d.qpos[r.qadr[j]] + Math.max(-0.25, Math.min(0.25, dq[j]));
        d.qpos[r.qadr[j]] = Math.max(ARM_RANGE[j][0], Math.min(ARM_RANGE[j][1], qn));
      }
    }
    var out = [];
    for (j = 0; j < 6; j++) out.push(d.qpos[r.qadr[j]]);
    for (j = 0; j < 6; j++) d.qpos[r.qadr[j]] = q0[j]; // qpos zurücksetzen (ctrl steuert)
    mujoco.mj_forward(r.model, d);
    return out;
  };
  ArmMj.prototype.applyRef = function () {
    var d = this.data;
    for (var j = 0; j < 6; j++) {
      if (!isFinite(this.ref[j])) { this.reset(); return false; }
      d.ctrl[j] = this.ref[j];
    }
    d.ctrl[6] = this.grip ? GRIP_CLOSED : GRIP_OPEN;
    return true;
  };
  /* Ein Regelschritt: 50 Hz — IK/Policy setzt ref, dann Substeps */
  ArmMj.prototype.substep = function () {
    mjc.mujoco.mj_step(this.r.model, this.data);
    this.steps++;
    var bp = this.ballPos(), ep = this.eePos();
    var dx = bp[0] - ep[0], dy = bp[1] - ep[1], dz = bp[2] - ep[2];
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var holding = this.grip && dist < 0.045 && bp[2] > 0.03;
    // Fit: Ball berühren/greifen/hochheben
    var touch = Math.max(0, 1 - dist / 0.3);
    this.fit = touch * 3 + (holding ? 4 + (bp[2] - 0.05) * 30 : 0);
  };
  ArmMj.prototype.controlStepAsync = function (usePolicy, genome) {
    var self = this;
    if (usePolicy && genome) {
      var acts = TF.nn.forward(genome, this.getObs(), 7);
      for (var j = 0; j < 6; j++) {
        this.ref[j] = Math.max(ARM_RANGE[j][0], Math.min(ARM_RANGE[j][1], this.ref[j] + acts[j] * 0.3));
      }
      this.grip = acts[6] > 0 ? 1 : 0;
      if (!this.applyRef()) return Promise.resolve();
      for (var k = 0; k < ARM_SUB; k++) this.substep();
      return Promise.resolve();
    }
    // Manuell: IK zum Joystick-Ziel (in 50-Hz-Takten nachziehen)
    this.ref = this.solveIK(this.target);
    if (!this.applyRef()) return Promise.resolve();
    for (k = 0; k < ARM_SUB; k++) this.substep();
    return Promise.resolve();
  };

  /* Trainings-Geist für den Arm: eigenes MjData */
  function GhostArm(genome) {
    var r = robots.arm;
    this.r = r;
    this.data = new mjc.mujoco.MjData(r.model);
    this.genome = genome;
    this.obs = new Float32Array(16);
    this.ref = ARM_HOME.slice();
    this.grip = 0;
    this.steps = 0; this.fit = 0; this.done = false;
    mjc.mujoco.mj_resetDataKeyframe(r.model, this.data, 0);
    armResetBall(r);
    mjc.mujoco.mj_forward(r.model, this.data);
  }
  GhostArm.prototype.getObs = function () {
    var r = this.r, d = this.data, i = 0, obs = this.obs;
    for (var j = 0; j < 6; j++) obs[i++] = d.qpos[r.qadr[j]] - this.ref[j];
    for (j = 0; j < 6; j++) obs[i++] = d.qvel[r.dofadr[j]];
    var a = r.ballAdr, q = d.qpos;
    var ee = d.body(r.eeId).xpos;
    obs[i++] = q[a] - ee[0]; obs[i++] = q[a + 1] - ee[1]; obs[i++] = q[a + 2] - ee[2];
    obs[i++] = this.grip;
    return obs;
  };
  GhostArm.prototype.step = function (acts) {
    var r = this.r, d = this.data;
    for (var j = 0; j < 6; j++) {
      var a = clampNum(acts[j]);
      this.ref[j] = Math.max(ARM_RANGE[j][0], Math.min(ARM_RANGE[j][1], this.ref[j] + a * 0.3));
      d.ctrl[j] = this.ref[j];
    }
    this.grip = acts[6] > 0 ? 1 : 0;
    d.ctrl[6] = this.grip ? GRIP_CLOSED : GRIP_OPEN;
    for (var k = 0; k < ARM_SUB; k++) {
      mjc.mujoco.mj_step(r.model, d);
      this.steps++;
    }
    var a2 = r.ballAdr, q = d.qpos, ee = d.body(r.eeId).xpos;
    var dx = q[a2] - ee[0], dy = q[a2 + 1] - ee[1], dz = q[a2 + 2] - ee[2];
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var holding = this.grip && dist < 0.045 && q[a2 + 2] > 0.03;
    this.fit = Math.max(0, 1 - dist / 0.3) * 3 + (holding ? 4 + (q[a2 + 2] - 0.05) * 30 : 0);
    if (this.steps >= 400) this.done = true;
    return this.done;
  };

  /* ---------- HUMANOID: ROBOTIS OP3 auf echtem MuJoCo ---------- */
  function HumanoidMj() {
    var r = robots.hum;
    this.r = r;
    this.data = r.data;
    this.obs = new Float32Array(46);      // projGrav3 + qerr20 + qvel20 + cmd3
    this.cmd = new Float32Array(3);       // [vx, wz, balance] von Joystick
    this.mode = 'stehen';                 // stehen | gehen
    this.steps = 0; this.fit = 0; this.fallen = false;
    this.phase = 0;
    this._cur = HUM_HOME.slice();
    this.x0 = 0; this.y0 = 0;
  }
  HumanoidMj.prototype.getObs = function () {
    var r = this.r, d = this.data, i = 0, obs = this.obs;
    var g = projGrav(d.body(r.trunkId).xquat);
    obs[i++] = g[0]; obs[i++] = g[1]; obs[i++] = g[2];
    for (var j = 0; j < 20; j++) obs[i++] = d.qpos[r.qadr[j]] - HUM_HOME[j];
    for (j = 0; j < 20; j++) obs[i++] = d.qvel[r.dofadr[j]];
    obs[i++] = this.cmd[0]; obs[i++] = this.cmd[1]; obs[i++] = this.cmd[2];
    return obs;
  };
  HumanoidMj.prototype.reset = function () {
    var r = this.r;
    mjc.mujoco.mj_resetDataKeyframe(r.model, r.data, 0);
    humResetBall(r);
    mjc.mujoco.mj_forward(r.model, r.data);
    this.steps = 0; this.fit = 0; this.fallen = false; this.phase = 0;
    this._cur = HUM_HOME.slice();
    this.x0 = r.data.qpos[0]; this.y0 = r.data.qpos[1];
  };
  /* Werks-Gait (Firmware): quasistatischer Schüttel-Schrittzyklus.
   * 4 Phasen à PH_T Regeltakte (50 Hz): Gewichtsverlagerung + Beinschwung.
   * Schwache Aktuatoren (±5 Nm) → kleine Amplituden, Interpolation. */
  HumanoidMj.prototype.gait = function () {
    var PH_T = 30;                       // 0,6 s pro Phase
    var CYC = PH_T * 4;
    var ph = Math.floor(this.phase) % CYC;
    var u = (this.phase % PH_T) / PH_T;  // 0..1 in der Phase
    this.phase += 1;
    // Ziel-Pose der aktuellen Phase
    var tgt = HUM_HOME.slice();
    var sw = Math.max(-0.3, Math.min(0.3, this.cmd[1]));   // Lenken → Hüft-Yaw
    var A = 0.20;                        // Hüftpitch-Schwung
    var K = 0.45;                        // Knie-Anhebung
    var R = 0.06;                        // Roll-Gewichtsverlagerung
    var f = ph < PH_T ? 0 : (ph < 2 * PH_T ? 1 : (ph < 3 * PH_T ? 2 : 3));
    // l_hip_roll=9, r_hip_roll=15, l_hip_yaw=8, r_hip_yaw=14
    // l_hip_pitch=10, l_knee=11, l_ank_pitch=12, r_…=16,17,18
    if (f === 0) {                       // Gewicht nach links, rechtes Bein entlasten
      tgt[9] = HUM_HOME[9] + R; tgt[15] = HUM_HOME[15] + R;
      tgt[11] = HUM_HOME[11] - 0.06;     // linkes Knie streckt leicht (Hub)
      tgt[17] = HUM_HOME[17] + K * 0.35; // rechtes Knie entlasten
    } else if (f === 1) {                // rechtes Bein schwingt vor
      tgt[9] = HUM_HOME[9] + R; tgt[15] = HUM_HOME[15] + R;
      tgt[16] = HUM_HOME[16] + A;        // r_hip_pitch vor
      tgt[17] = HUM_HOME[17] + K;        // r_knee an
      tgt[18] = HUM_HOME[18] - A * 0.6;
      tgt[14] = HUM_HOME[14] - sw;       // Lenken
    } else if (f === 2) {                // Gewicht in die Mitte/rechts
      tgt[9] = HUM_HOME[9] - R * 0.4; tgt[15] = HUM_HOME[15] - R * 0.4;
      tgt[16] = HUM_HOME[16] + A * 0.6;
    } else {                             // linkes Bein schwingt vor
      tgt[9] = HUM_HOME[9] - R * 0.4; tgt[15] = HUM_HOME[15] - R * 0.4;
      tgt[10] = HUM_HOME[10] + A;        // l_hip_pitch vor
      tgt[11] = HUM_HOME[11] + K;        // l_knee an
      tgt[12] = HUM_HOME[12] - A * 0.6;
      tgt[8] = HUM_HOME[8] - sw;
    }
    // Sanfte Interpolation (quasistatisch)
    var a = Math.min(1, 0.10);
    for (var j = 0; j < 20; j++) {
      this._cur[j] = this._cur[j] === undefined ? tgt[j] : this._cur[j] + (tgt[j] - this._cur[j]) * a;
    }
    return this._cur;
  };
  HumanoidMj.prototype.applyPose = function (pose) {
    var d = this.data;
    for (var j = 0; j < 20; j++) {
      if (!isFinite(pose[j])) { this.reset(); return false; }
      d.ctrl[j] = pose[j];
    }
    return true;
  };
  HumanoidMj.prototype.substep = function () {
    mjc.mujoco.mj_step(this.r.model, this.data);
    this.steps++;
    var g = projGrav(this.data.body(this.r.trunkId).xquat);
    this.fallen = (g[2] > -0.5 || this.data.qpos[2] < 0.18);
    this.fit = (this.data.qpos[0] - this.x0) * 10 - (this.fallen ? 3 : 0);
  };
  HumanoidMj.prototype.controlStepAsync = function (genome) {
    var pose;
    if (genome) {
      var acts = TF.nn.forward(genome, this.getObs(), 20);
      pose = new Float32Array(20);
      for (var j = 0; j < 20; j++) pose[j] = HUM_HOME[j] + clampNum(acts[j]) * 0.5;
    } else if (this.fallen) {
      this.reset();
      pose = HUM_HOME;
    } else if (this.mode === 'gehen') {
      pose = this.gait();
    } else {
      pose = HUM_HOME;
    }
    if (!this.applyPose(pose)) return Promise.resolve();
    for (var k = 0; k < HUM_SUB; k++) this.substep();
    if (this.fallen && !genome) this.reset();
    return Promise.resolve();
  };

  /* Trainings-Geist für den Humanoiden */
  function GhostHumanoid(genome) {
    var r = robots.hum;
    this.r = r;
    this.data = new mjc.mujoco.MjData(r.model);
    this.genome = genome;
    this.obs = new Float32Array(46);
    this.steps = 0; this.fit = 0; this.done = false; this.fallen = false;
    mjc.mujoco.mj_resetDataKeyframe(r.model, this.data, 0);
    humResetBall(r);
    mjc.mujoco.mj_forward(r.model, this.data);
    this.x0 = this.data.qpos[0];
  }
  GhostHumanoid.prototype.getObs = function () {
    var r = this.r, d = this.data, i = 0, obs = this.obs;
    var g = projGrav(d.body(r.trunkId).xquat);
    obs[i++] = g[0]; obs[i++] = g[1]; obs[i++] = g[2];
    for (var j = 0; j < 20; j++) obs[i++] = d.qpos[r.qadr[j]] - HUM_HOME[j];
    for (j = 0; j < 20; j++) obs[i++] = d.qvel[r.dofadr[j]];
    obs[i++] = 0; obs[i++] = 0; obs[i++] = 0;   // Trainings-Command neutral
    return obs;
  };
  GhostHumanoid.prototype.step = function (acts) {
    var d = this.data;
    for (var j = 0; j < 20; j++) d.ctrl[j] = HUM_HOME[j] + clampNum(acts[j]) * 0.5;
    for (var k = 0; k < HUM_SUB; k++) {
      mjc.mujoco.mj_step(this.r.model, d);
      this.steps++;
    }
    var g = projGrav(d.body(this.r.trunkId).xquat);
    this.fallen = (g[2] > -0.5 || d.qpos[2] < 0.18);
    this.fit = (d.qpos[0] - this.x0) * 10 - (this.fallen ? 3 : 0);
    if (this.fallen || this.steps >= 600) this.done = true;
    return this.done;
  };

  /* ---------- Mesh-Rig: echte STL-Visuals aus dem Manifest ---------- */
  /* Manifest: [{m: 'op3vis_body.stl', b: 'body_link', p: [..], q: [wxyz]}]  */
  function MeshRig(R, lib, manifestFile, opts) {
    opts = opts || {};
    var name = opts.robot;                 // 'arm' | 'hum'
    var robot = robots[name];
    var model = robot.model;
    var alpha = opts.ghost ? 0.22 : 1;
    var COL = opts.colors || (name === 'arm'
      ? { body: [0.30, 0.32, 0.38, alpha], accent: [1, 0.48, 0.18, alpha] }
      : { body: [0.93, 0.93, 0.95, alpha], accent: [0.15, 0.15, 0.18, alpha] });
    var ACCENT = { 'wx250s_10_gripper_finger.stl': 1, 'wx250s_9_gripper_bar.stl': 1 };
    var bp = model.body_pos, bq = model.body_quat;
    var jt = model.jnt_type, jb = model.jnt_bodyid, ja = model.jnt_axis;
    var qadr = model.jnt_qposadr;
    this.root = new R.Node();
    this.root.quat = [-0.7071067811865476, 0, 0, 0.7071067811865476];
    var nodes = {}, bodyIds = {};
    var nbody = model.nbody;
    for (var b = 1; b < nbody; b++) {
      var n = new R.Node();
      n.pos = [bp[b * 3], bp[b * 3 + 1], bp[b * 3 + 2]];
      n.quat = [bq[b * 4 + 1], bq[b * 4 + 2], bq[b * 4 + 3], bq[b * 4]];
      nodes[b] = n;
      bodyIds[model.body_id2name ? model.body_id2name(b) : b] = b;
    }
    var parentId = model.body_parentid;
    for (b = 1; b < nbody; b++) {
      var p = parentId[b];
      (p === 0 ? this.root : nodes[p]).add(nodes[b]);
    }
    // Gelenk-Updates wie SkeletonRig
    var jointNodes = [];
    for (var j = 0; j < model.njnt; j++) {
      if (jt[j] === 0) continue;
      var tgt = nodes[jb[j]];
      if (tgt) jointNodes.push({ node: tgt, axis: [ja[j * 3], ja[j * 3 + 1], ja[j * 3 + 2]], qadr: qadr[j], base: null });
    }
    var self = this;
    this._meshes = {};
    this.update = function (data) {
      var q = data.qpos;
      var fb = robot.freeBodyId;
      if (fb !== undefined) {
        nodes[fb].pos = [q[0], q[1], q[2]];
        nodes[fb].quat = [q[4], q[5], q[6], q[3]];
      }
      for (var i = 0; i < jointNodes.length; i++) {
        var jn = jointNodes[i];
        if (data.qpos.length <= jn.qadr) continue;
        if (jn.node === nodes[fb]) continue;
        var ang = q[jn.qadr];
        if (jn.base === null) jn.base = jn.node.quat.slice();
        jn.node.quat = quatMulR(jn.base, jn.axis, ang);
      }
    };
    function quatMulR(base, axis, ang) {
      var l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
      var s = Math.sin(ang / 2);
      var b2 = [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(ang / 2)];
      var ax = base[0], ay = base[1], az = base[2], aw = base[3];
      return [
        aw * b2[0] + ax * b2[3] + ay * b2[2] - az * b2[1],
        aw * b2[1] + ay * b2[3] + az * b2[0] - ax * b2[2],
        aw * b2[2] + az * b2[3] + ax * b2[1] - ay * b2[0],
        aw * b2[3] - ax * b2[0] - ay * b2[1] - az * b2[2]
      ];
    }
    /* Visuals anhängen (asynchron: STLs laden → Mesh-Nodes) */
    this.attachVisuals = function (manifest, loadBytes) {
      return Promise.all(manifest.map(function (e) {
        var bid = null;
        try { bid = model.body(e.b).id; } catch (err) { bid = null; }
        if (bid === null || bid === undefined) return null;
        return loadBytes(e.m).then(function (bytes) {
          var mesh = self._meshes[e.m];
          if (!mesh) { mesh = lib.fromSTL(bytes); self._meshes[e.m] = mesh; }
          var node = new R.Node(mesh, ACCENT[e.m] ? COL.accent : COL.body);
          node.pos = e.p; node.quat = [e.q[1], e.q[2], e.q[3], e.q[0]];
          node.scale = [0.001, 0.001, 0.001];   // STLs liegen in mm
          nodes[bid].add(node);
        });
      })).then(function () { return self; });
    };
    this.ghost = !!opts.ghost;
  }

  var ROBOT_XML = { arm: 'wx250s', hum: 'op3' };   // Präfixe der Manifeste

  /* ---------- Öffentliche API ---------- */
  TF.mjc = {
    init: init,
    isReady: isReady,
    JOINT_NAMES: JOINT_NAMES,
    DEFAULT_POSE: DEFAULT_POSE,
    OBS_SIZE: OBS_SIZE,
    NUM_JOINTS: NUM_JOINTS,
    CMD_SIZE: CMD_SIZE,
    VEL: VEL,
    POLICY_FILES: POLICY_FILES,
    EAGER: EAGER,
    getSession: function (slot) { return mjc ? getSession(slot) : Promise.reject(new Error('mjc nicht initialisiert')); },
    makeDuck: function () { return mjc ? new DuckMj() : null; },
    makeGhost: function () { return mjc ? new GhostDuck() : null; },
    makeSkeletonRig: function (R, lib, ghost) { return mjc ? new SkeletonRig(R, lib, ghost) : null; },
    /* --- Menagerie-Roboter (arm = WidowX 250, hum = OP3) --- */
    ensureRobot: function (name) {
      if (!mjc) return Promise.reject(new Error('mjc nicht initialisiert'));
      return loadRobot(name);
    },
    hasRobot: function (name) { return !!robots[name]; },
    makeArm: function () { return robots.arm ? new ArmMj() : null; },
    makeHum: function () { return robots.hum ? new HumanoidMj() : null; },
    makeGhostArm: function (genome) { return robots.arm ? new GhostArm(genome) : null; },
    makeGhostHum: function (genome) { return robots.hum ? new GhostHumanoid(genome) : null; },
    makeMeshRig: function (R, lib, robot, ghost) {
      if (!robots[robot]) return null;
      return new MeshRig(R, lib, (ROBOT_XML[robot] || robot) + '_visual.json', { robot: robot, ghost: ghost });
    },
    attachRigVisuals: function (rig, robot) {
      if (!robots[robot] || !rig.attachVisuals) return Promise.resolve(rig);
      return readAssetText((ROBOT_XML[robot] || robot) + '_visual.json').then(function (t) {
        return rig.attachVisuals(JSON.parse(t), readAsset);
      });
    },
    ARM: { HOME: ARM_HOME, RANGE: ARM_RANGE, BALL: ARM_BALL, GRIP_OPEN: GRIP_OPEN, GRIP_CLOSED: GRIP_CLOSED },
    HUM: { HOME: HUM_HOME, BALL: HUM_BALL },
    robotInfo: function (name) {
      var r = robots[name];
      if (!r) return null;
      return { nq: r.model.nq, nv: r.model.nv, nu: r.model.nu, nbody: r.model.nbody };
    },
    // Nur für Tests: Kern von außen setzen (Node-Smoke ohne Browser)
    __setCore: function (c) { mjc = c; },
    __setRobot: function (name, r) { robots[name] = r; },
    bridgePath: bridgePath,
    _readAsset: readAsset,
    _readAssetText: readAssetText,
    __readAsset: readAsset,
    __readAssetText: readAssetText,
    policiesLoaded: function () {
      return Object.keys(sessions);
    },
    info: function () {
      if (!mjc) return null;
      return { nq: mjc.model.nq, nv: mjc.model.nv, nu: mjc.model.nu, nsensor: mjc.model.nsensor };
    },
    core: function () { return mjc; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
