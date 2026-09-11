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

  /* ---------- Asset-Lader: AndroidBridge (file://) oder fetch (http) ---------- */
  function b64ToBytes(b64) {
    var bin = global.atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function readAsset(rel) {
    if (global.AndroidBridge && global.AndroidBridge.readAssetBase64) {
      return Promise.resolve(b64ToBytes(global.AndroidBridge.readAssetBase64(MJC_DIR + rel)));
    }
    return global.fetch(MJC_DIR + rel).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' für ' + rel);
      return r.arrayBuffer();
    }).then(function (b) { return new Uint8Array(b); });
  }
  function readAssetText(rel) {
    if (global.AndroidBridge && global.AndroidBridge.readAssetText) {
      return Promise.resolve(global.AndroidBridge.readAssetText(MJC_DIR + rel));
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

  function getSession(slot) {
    if (sessions[slot]) return Promise.resolve(sessions[slot]);
    if (loadingSessions[slot]) return loadingSessions[slot];
    loadingSessions[slot] = readAsset('policies/' + POLICY_FILES[slot]).then(function (bytes) {
      return mjc.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
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
        ort.env.wasm.numThreads = 1;
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
        onStage('POLICIES …');
        // Eager: walk + drive + sitstand + stand parallel
        return Promise.all(EAGER.map(function (s) { return getSession(s); }));
      })
      .then(function () {
        onStage('BEREIT');
        return mjc;
      });
    p.catch(stageErr);
    return p;
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
    // Nur für Tests: Kern von außen setzen (Node-Smoke ohne Browser)
    __setCore: function (c) { mjc = c; },
    info: function () {
      if (!mjc) return null;
      return { nq: mjc.model.nq, nv: mjc.model.nv, nu: mjc.model.nu, nsensor: mjc.model.nsensor };
    },
    core: function () { return mjc; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
