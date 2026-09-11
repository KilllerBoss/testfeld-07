/* Testfeld·07 — 3D-Views: Arena, Props (Homage an den microduck-Space),
 * Roboter-Rigs, Zielmarkierungen. Mappt Env-Zustand → Node-Transforme.
 * Welt: X/Z Bodenebene, Y hoch. Roboter-Front = lokal +X.
 */
(function (global) {
  'use strict';
  var TF = global.TF07 = global.TF07 || {};
  var R = TF.render;

  function MeshLib(gl) {
    TF.render.Meshes.call(this, gl);
    // Kegel entlang +X (Entenschnabel): Spitze bei +h/2, Basisring bei -h/2
    var verts = [], idx = [];
    (function () {
      var seg = 12, r = 0.35, h = 1;
      for (var k = 0; k <= seg; k++) {
        var a = k / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        verts.push(-h / 2, c * r, s * r, 0, c, s);
        verts.push(h / 2, 0, 0, c * 0.55, 0.45, s * 0.55);
      }
      for (k = 0; k < seg; k++) {
        var b = k * 2;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      var cap = verts.length / 6;
      verts.push(-h / 2, 0, 0, -1, 0, 0);
      for (k = 0; k <= seg; k++) {
        a = k / seg * Math.PI * 2; c = Math.cos(a); s = Math.sin(a);
        verts.push(-h / 2, c * r, s * r, -1, 0, 0);
      }
      for (k = 0; k < seg; k++) idx.push(cap, cap + 1 + k, cap + 2 + k);
    })();
    this.cone = new TF.render.Mesh(gl, verts, idx, gl.TRIANGLES);
  }

  /* Farb-Palette (vom microduck-Space: INK + Robot-Orange) */
  var COL = {
    orange: [1.0, 0.478, 0.184, 1],
    orangeDim: [0.75, 0.35, 0.14, 1],
    ink: [0.09, 0.09, 0.11, 1],
    metal: [0.62, 0.66, 0.72, 1],
    metalDark: [0.3, 0.32, 0.36, 1],
    wheel: [0.14, 0.14, 0.16, 1],
    white: [0.92, 0.9, 0.86, 1],
    eye: [0.05, 0.05, 0.06, 1],
    glow: [1.0, 0.55, 0.2, 0.9],
    grid: [0.22, 0.24, 0.3, 0.5],
    floor: [0.13, 0.135, 0.16, 1],
    wall: [0.17, 0.18, 0.22, 1],
    pillar: [0.35, 0.36, 0.42, 1],
    shadow: [0, 0, 0, 0.35],
    ball: [0.85, 0.3, 0.25, 1]
  };
  TF.COLORS = COL;

  /* ---------------- Arena ---------------- */
  function buildArena(lib, env, robot) {
    var root = new R.Node();
    var floor = new R.Node(lib.plane, COL.floor);
    floor.scale = [TF.ARENA_HALF * 2, 1, TF.ARENA_HALF * 2];
    root.add(floor);
    var grid = new R.Node(lib.grid, COL.grid, { lit: false });
    root.add(grid);

    // Wände
    var wallDefs = [[0, TF.ARENA_HALF + 0.15], [0, -TF.ARENA_HALF - 0.15]];
    var i;
    for (i = 0; i < 2; i++) {
      var wA = new R.Node(lib.unitBox, COL.wall);
      wA.scale = [TF.ARENA_HALF * 2 + 0.6, 0.5, 0.3];
      wA.pos = [0, 0.25, wallDefs[i][1]];
      root.add(wA);
      var wB = new R.Node(lib.unitBox, COL.wall);
      wB.scale = [0.3, 0.5, TF.ARENA_HALF * 2 + 0.6];
      wB.pos = [wallDefs[i][1], 0.25, 0];
      root.add(wB);
    }
    // Eckpfosten
    var cs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (i = 0; i < 4; i++) {
      var post = new R.Node(lib.unitCyl, COL.orangeDim);
      post.scale = [0.12, 0.9, 0.12];
      post.pos = [cs[i][0] * (TF.ARENA_HALF + 0.15), 0.45, cs[i][1] * (TF.ARENA_HALF + 0.15)];
      root.add(post);
    }
    // Hindernis-Zylinder (nur Duck)
    var pillars = [];
    if (env && env.obsP) {
      for (i = 0; i < env.obsP.length; i++) {
        var o = env.obsP[i];
        var p = new R.Node(lib.unitCyl, COL.pillar);
        p.scale = [o.r, o.h, o.r];
        p.pos = [o.x, o.h / 2, o.z];
        root.add(p);
        var cap = new R.Node(lib.unitCyl, COL.orangeDim);
        cap.scale = [o.r * 1.04, 0.03, o.r * 1.04];
        cap.pos = [o.x, o.h + 0.015, o.z];
        root.add(cap);
        pillars.push(p);
      }
    }
    // Arcade-Props (Homage an den Space; aus Primitiven, offline)
    root.add(buildArcade(lib, -8.6, -9.0, 0.35));
    root.add(buildCrt(lib, 8.4, -8.8, -0.5));
    root.add(buildLavaLamp(lib, 8.9, 8.4));
    root.add(buildBoombox(lib, -8.8, 8.6, 0.8));
    return root;
  }

  function buildArcade(lib, x, z, ry) {
    var g = new R.Node();
    g.pos = [x, 0, z]; g.quat = R.quatAxis([0, 1, 0], ry);
    var body = new R.Node(lib.unitBox, COL.ink);
    body.scale = [0.75, 1.65, 0.7]; body.pos = [0, 0.825, 0];
    g.add(body);
    var screen = new R.Node(lib.unitBox, [0.15, 0.8, 0.9, 0.95], { lit: false });
    screen.scale = [0.04, 0.5, 0.42]; screen.pos = [0.38, 1.05, 0];
    g.add(screen);
    var deckel = new R.Node(lib.unitBox, COL.orangeDim);
    deckel.scale = [0.8, 0.1, 0.75]; deckel.pos = [-0.02, 1.7, 0];
    g.add(deckel);
    return g;
  }
  function buildCrt(lib, x, z, ry) {
    var g = new R.Node();
    g.pos = [x, 0, z]; g.quat = R.quatAxis([0, 1, 0], ry);
    var crate = new R.Node(lib.unitBox, COL.metalDark);
    crate.scale = [0.6, 0.4, 0.6]; crate.pos = [0, 0.2, 0];
    g.add(crate);
    var tv = new R.Node(lib.unitBox, COL.ink);
    tv.scale = [0.55, 0.45, 0.5]; tv.pos = [0, 0.62, 0];
    g.add(tv);
    var face = new R.Node(lib.unitBox, [0.9, 0.5, 0.2, 0.95], { lit: false });
    face.scale = [0.03, 0.3, 0.36]; face.pos = [0.28, 0.64, 0];
    g.add(face);
    return g;
  }
  function buildLavaLamp(lib, x, z) {
    var g = new R.Node();
    g.pos = [x, 0, z];
    var foot = new R.Node(lib.unitCyl, COL.metalDark);
    foot.scale = [0.14, 0.1, 0.14]; foot.pos = [0, 0.05, 0];
    g.add(foot);
    var glass = new R.Node(lib.unitCyl, [0.9, 0.4, 0.25, 0.25]);
    glass.scale = [0.1, 0.55, 0.1]; glass.pos = [0, 0.38, 0];
    g.add(glass);
    var core = new R.Node(lib.unitCyl, [1.0, 0.45, 0.15, 0.9], { lit: false });
    core.scale = [0.055, 0.4, 0.055]; core.pos = [0, 0.36, 0];
    g.add(core);
    var cap = new R.Node(lib.unitCyl, COL.metalDark);
    cap.scale = [0.09, 0.06, 0.09]; cap.pos = [0, 0.69, 0];
    g.add(cap);
    return g;
  }
  function buildBoombox(lib, x, z, ry) {
    var g = new R.Node();
    g.pos = [x, 0, z]; g.quat = R.quatAxis([0, 1, 0], ry);
    var b = new R.Node(lib.unitBox, COL.ink);
    b.scale = [0.5, 0.26, 0.2]; b.pos = [0, 0.13, 0];
    g.add(b);
    var s1 = new R.Node(lib.unitCyl, COL.metalDark);
    s1.quat = R.quatAxis([0, 0, 1], Math.PI / 2);
    s1.scale = [0.09, 0.06, 0.09]; s1.pos = [-0.14, 0.13, 0.1];
    g.add(s1);
    var s2 = new R.Node(lib.unitCyl, COL.metalDark);
    s2.quat = R.quatAxis([0, 0, 1], Math.PI / 2);
    s2.scale = [0.09, 0.06, 0.09]; s2.pos = [0.14, 0.13, 0.1];
    g.add(s2);
    var led = new R.Node(lib.unitBox, COL.glow, { lit: false });
    led.scale = [0.03, 0.03, 0.02]; led.pos = [0, 0.2, 0.1];
    g.add(led);
    return g;
  }

  /* ---------------- Zielmarker ---------------- */
  function buildTarget(lib) {
    var g = new R.Node();
    var ring = new R.Node(lib.ring, COL.glow, { lit: false });
    ring.pos = [0, 0.02, 0];
    g.add(ring);
    var pillar = new R.Node(lib.unitCyl, [1.0, 0.5, 0.2, 0.13], { lit: false });
    pillar.scale = [0.3, 2.2, 0.3]; pillar.pos = [0, 1.1, 0];
    g.add(pillar);
    return { root: g, ring: ring, pillar: pillar };
  }

  /* ---------------- MICRODUCK-Rig ---------------- */
  function DuckRig(lib, opts) {
    opts = opts || {};
    var ghost = !!opts.ghost;
    var a = ghost ? 0.22 : 1;
    function c(rgb) { return [rgb[0], rgb[1], rgb[2], a]; }
    var root = new R.Node();
    var bodyC = c(opts.color || COL.orange);

    var shadow = new R.Node(lib.disc, COL.shadow, { lit: false });
    shadow.scale = [0.55, 1, 0.45]; shadow.pos = [0, 0.012, 0];
    root.add(shadow);

    var body = new R.Node(lib.unitBox, bodyC);
    body.scale = [0.46, 0.2, 0.3]; body.pos = [0, 0.24, 0];
    root.add(body);
    var tail = new R.Node(lib.unitBox, bodyC);
    tail.scale = [0.16, 0.12, 0.2]; tail.pos = [-0.26, 0.3, 0];
    tail.quat = R.quatAxis([0, 0, 1], 0.5);
    root.add(tail);
    var head = new R.Node(lib.unitBox, c(COL.white));
    head.scale = [0.2, 0.18, 0.18]; head.pos = [0.18, 0.42, 0];
    root.add(head);
    var beak = new R.Node(lib.cone, c([1, 0.69, 0.18]));
    beak.scale = [0.55, 0.55, 0.55];
    beak.pos = [0.34, 0.4, 0]; // Kegel zeigt nativ entlang +X — keine Drehung nötig
    root.add(beak);
    var eyeL = new R.Node(lib.unitSphere, c(COL.eye));
    eyeL.scale = [0.03, 0.03, 0.03]; eyeL.pos = [0.24, 0.47, 0.09];
    root.add(eyeL);
    var eyeR = new R.Node(lib.unitSphere, c(COL.eye));
    eyeR.scale = [0.03, 0.03, 0.03]; eyeR.pos = [0.24, 0.47, -0.09];
    root.add(eyeR);

    var wheels = [];
    for (var s = -1; s <= 1; s += 2) {
      var w = new R.Node(lib.unitCyl, c(COL.wheel));
      w.scale = [0.12, 0.07, 0.12];
      w.quat = R.quatAxis([1, 0, 0], Math.PI / 2);
      w.pos = [0, 0.12, s * 0.16];
      root.add(w);
      var hub = new R.Node(lib.unitCyl, c(COL.orangeDim));
      hub.scale = [0.05, 0.078, 0.05];
      hub.quat = R.quatAxis([1, 0, 0], Math.PI / 2);
      hub.pos = [0, 0.12, s * 0.16];
      root.add(hub);
      wheels.push(w);
    }
    // Strahl-Sensoren (9 dünne Balken)
    var rayBars = [];
    if (!ghost) {
      for (var i = 0; i < TF.N_RAYS; i++) {
        var bar = new R.Node(lib.unitBox, [0.3, 0.9, 0.4, 0.4], { lit: false });
        bar.scale = [1, 0.012, 0.012];
        root.add(bar);
        rayBars.push(bar);
      }
    }
    return {
      root: root, wheels: wheels, rayBars: rayBars, body: body,
      spin: 0,
      update: function (env, dt) {
        root.pos[0] = env.x; root.pos[1] = 0; root.pos[2] = env.z;
        root.quat = R.quatAxis([0, 1, 0], -env.heading);
        // Rad-Drehung: Spin wird pro Physik-Step in app.js akkumuliert
        var ang = this.spin;
        for (var i = 0; i < wheels.length; i++) {
          var q = R.quatAxis([1, 0, 0], Math.PI / 2);
          wheels[i].quat = R.quatMul(q, R.quatAxis([0, 0, 1], ang));
        }
        if (this.rayBars.length) {
          for (i = 0; i < TF.N_RAYS; i++) {
            var aAbs = env.heading + (i - 4) / 4 * TF.RAY_SPREAD;
            var len = Math.max(0.05, env.rays[i] * TF.RAY_LEN);
            var bar = this.rayBars[i];
            bar.pos = [env.x + Math.cos(aAbs) * len / 2, 0.16, env.z + Math.sin(aAbs) * len / 2];
            bar.quat = R.quatAxis([0, 1, 0], -aAbs);
            bar.scale = [len, 0.012, 0.012];
            var heat = 1 - env.rays[i];
            bar.color = [0.2 + heat * 0.8, 0.9 - heat * 0.7, 0.3, 0.35];
          }
        }
      }
    };
  }

  /* ---------------- ARMBOT-Rig ---------------- */
  function ArmRig(lib, opts) {
    opts = opts || {};
    var ghost = !!opts.ghost;
    var a = ghost ? 0.22 : 1;
    function c(rgb) { return [rgb[0], rgb[1], rgb[2], a]; }
    var ARM = TF.ARM;
    var root = new R.Node();

    var shadow = new R.Node(lib.disc, COL.shadow, { lit: false });
    shadow.scale = [1.0, 1, 1.0]; shadow.pos = [0, 0.012, 0];
    root.add(shadow);

    var pedestal = new R.Node(lib.unitCyl, c(COL.metalDark));
    pedestal.scale = [0.26, ARM.HB, 0.26]; pedestal.pos = [0, ARM.HB / 2, 0];
    root.add(pedestal);

    var yaw = new R.Node();
    yaw.pos = [0, ARM.HB, 0];
    root.add(yaw);

    var baseRing = new R.Node(lib.unitCyl, c(COL.orangeDim));
    baseRing.scale = [0.22, 0.08, 0.22]; baseRing.pos = [0, 0.04, 0];
    yaw.add(baseRing);

    var shoulder = new R.Node();
    yaw.add(shoulder);
    var upper = new R.Node(lib.unitBox, c(COL.metal));
    upper.scale = [0.09, ARM.L1, 0.09]; upper.pos = [0, ARM.L1 / 2, 0];
    shoulder.add(upper);
    var jShoulder = new R.Node(lib.unitCyl, c(COL.orangeDim));
    jShoulder.quat = R.quatAxis([0, 0, 1], Math.PI / 2);
    jShoulder.scale = [0.075, 0.12, 0.075]; jShoulder.pos = [0, 0, 0];
    shoulder.add(jShoulder);

    var elbow = new R.Node();
    elbow.pos = [0, ARM.L1, 0];
    shoulder.add(elbow);
    var fore = new R.Node(lib.unitBox, c(COL.metal));
    fore.scale = [0.075, ARM.L2, 0.075]; fore.pos = [0, ARM.L2 / 2, 0];
    elbow.add(fore);
    var jElbow = new R.Node(lib.unitCyl, c(COL.orangeDim));
    jElbow.quat = R.quatAxis([0, 0, 1], Math.PI / 2);
    jElbow.scale = [0.06, 0.1, 0.06];
    elbow.add(jElbow);

    var wrist = new R.Node();
    wrist.pos = [0, ARM.L2, 0];
    elbow.add(wrist);
    var tool = new R.Node(lib.unitBox, c(COL.metalDark));
    tool.scale = [0.06, ARM.L3, 0.06]; tool.pos = [0, ARM.L3 / 2, 0];
    wrist.add(tool);
    var fingerL = new R.Node(lib.unitBox, c(COL.orange));
    fingerL.scale = [0.03, 0.09, 0.02];
    wrist.add(fingerL);
    var fingerR = new R.Node(lib.unitBox, c(COL.orange));
    fingerR.scale = [0.03, 0.09, 0.02];
    wrist.add(fingerR);

    var ball = new R.Node(lib.unitSphere, c(COL.ball));
    ball.scale = [ARM.BALL_R, ARM.BALL_R, ARM.BALL_R];
    root.add(ball);

    var drop = new R.Node(lib.ring, [0.3, 0.75, 1.0, 0.8], { lit: false });
    drop.pos = [ARM.DZ[0], 0.02, ARM.DZ[2]];
    root.add(drop);

    return {
      root: root, ball: ball,
      update: function (env) {
        yaw.quat = R.quatAxis([0, 1, 0], -env.q[0]);
        shoulder.quat = R.quatAxis([0, 0, 1], -env.q[1]);
        elbow.quat = R.quatAxis([0, 0, 1], -env.q[2]);
        wrist.quat = R.quatAxis([0, 0, 1], -env.q[3]);
        var open = env.gripOpen !== undefined ? env.gripOpen : true;
        var off = open ? 0.045 : 0.016;
        fingerL.pos = [0.04, ARM.L3 + 0.03, off];
        fingerR.pos = [0.04, ARM.L3 + 0.03, -off];
        ball.pos[0] = env.ball[0]; ball.pos[1] = env.ball[1]; ball.pos[2] = env.ball[2];
        ball.visible = true;
      }
    };
  }

  /* ---------------- HUMANOID-Rig ---------------- */
  function HumanoidRig(lib, opts) {
    opts = opts || {};
    var ghost = !!opts.ghost;
    var a = ghost ? 0.22 : 1;
    function c(rgb) { return [rgb[0], rgb[1], rgb[2], a]; }
    var root = new R.Node();

    var shadow = new R.Node(lib.disc, COL.shadow, { lit: false });
    shadow.scale = [0.6, 1, 0.4]; shadow.pos = [0, 0.012, 0];
    root.add(shadow);

    var torso = new R.Node();
    torso.pos = [0, 0.85, 0];
    root.add(torso);
    var chest = new R.Node(lib.unitBox, c(COL.white));
    chest.scale = [0.2, 0.34, 0.14]; chest.pos = [0, 0.17, 0];
    torso.add(chest);
    var badge = new R.Node(lib.unitBox, c(COL.orange));
    badge.scale = [0.02, 0.1, 0.07]; badge.pos = [0.105, 0.22, 0];
    torso.add(badge);
    var head = new R.Node(lib.unitSphere, c(COL.white));
    head.scale = [0.085, 0.085, 0.085]; head.pos = [0.01, 0.42, 0];
    torso.add(head);
    var visor = new R.Node(lib.unitBox, [0.2, 0.9, 1.0, 0.95], { lit: false });
    visor.scale = [0.05, 0.03, 0.1]; visor.pos = [0.08, 0.43, 0];
    torso.add(visor);

    var armL = new R.Node(lib.unitBox, c(COL.metalDark));
    armL.scale = [0.26, 0.05, 0.05]; armL.pos = [-0.05, 0.28, 0.11];
    torso.add(armL);
    var armR = new R.Node(lib.unitBox, c(COL.metalDark));
    armR.scale = [0.26, 0.05, 0.05]; armR.pos = [-0.05, 0.28, -0.11];
    torso.add(armR);

    function leg(side) {
      var hip = new R.Node();
      hip.pos = [0, 0, side * 0.055];
      torso.add(hip);
      var thigh = new R.Node(lib.unitBox, c(COL.metal));
      thigh.scale = [0.4, 0.09, 0.09]; thigh.pos = [-0.2, 0, 0];
      hip.add(thigh);
      var knee = new R.Node();
      knee.pos = [-0.4, 0, 0];
      hip.add(knee);
      var shin = new R.Node(lib.unitBox, c(COL.metalDark));
      shin.scale = [0.38, 0.08, 0.08]; shin.pos = [-0.19, 0, 0];
      knee.add(shin);
      var foot = new R.Node(lib.unitBox, c(COL.orange));
      foot.scale = [0.1, 0.04, 0.09]; foot.pos = [0.03, -0.38, 0];
      knee.add(foot);
      return { hip: hip, knee: knee };
    }
    var legL = leg(1), legR = leg(-1);

    return {
      root: root, torso: torso,
      update: function (env) {
        var yaw = Math.atan2(env.dirZ, env.dirX);
        root.pos[0] = env.px; root.pos[1] = 0; root.pos[2] = env.pz;
        root.quat = R.quatAxis([0, 1, 0], -yaw);
        torso.quat = R.quatAxis([0, 0, 1], -env.lean * 2.0);
        // Beine: Hüfte rotiert um Z (Vor/Zurück), Knie gegengleich
        legL.hip.quat = R.quatAxis([0, 0, 1], env.hipL);
        legL.knee.quat = R.quatAxis([0, 0, 1], -env.kneeL);
        legR.hip.quat = R.quatAxis([0, 0, 1], env.hipR);
        legR.knee.quat = R.quatAxis([0, 0, 1], -env.kneeR);
        // Arme gegensinnig
        var sw = Math.sin(2 * Math.PI * env.tau);
        armL.quat = R.quatAxis([0, 0, 1], 0.6 * sw * (env.side === 1 ? 1 : -1));
        armR.quat = R.quatAxis([0, 0, 1], -0.6 * sw * (env.side === 1 ? 1 : -1));
        if (env.fallen) torso.quat = R.quatAxis([0, 0, 1], -1.2);
      }
    };
  }

  TF.views = {
    MeshLib: MeshLib,
    buildArena: buildArena,
    buildTarget: buildTarget,
    DuckRig: DuckRig,
    ArmRig: ArmRig,
    HumanoidRig: HumanoidRig
  };
})(typeof window !== 'undefined' ? window : globalThis);
