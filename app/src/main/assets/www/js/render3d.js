// ═══════════════════════════════════════════════════════════
// render3d.js — Three.js-Renderer: baut Welt & Roboter direkt
// aus dem MuJoCo-Modell (echte Menagerie-Meshes), Vollbild,
// Nachschicht-Optik mit Gitterboden, Nebel und Schatten.
// ═══════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.js';

// mjGEOM-Typen
const G_PLANE = 0, G_HFIELD = 1, G_SPHERE = 2, G_CAPSULE = 3, G_ELLIPSOID = 4,
      G_CYLINDER = 5, G_BOX = 6, G_MESH = 7, G_SDF = 8;

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0e14, 26, 110);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
    this._buildSky();
    this._buildLights();
    this._buildFloor();

    // Kamera-Fahrt (Orbit-Follow)
    this.camYaw = 0.6; this.camPitch = 0.42; this.camDist = 2.6;
    this._anchor = new THREE.Vector3(0, 0, 0.3);
    this._anchorSm = new THREE.Vector3(0, 0, 0.3);

    this.bodyGroups = null;   // THREE.Group je Körper
    this._tmpQ = new THREE.Quaternion();
    this._marker = this._buildMarker();
    this.scene.add(this._marker);
  }

  // ── Himmel (Verlaufskuppel) ───────────────────────────────
  _buildSky() {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vP;
        void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec3 vP;
        void main() {
          float h = normalize(vP).y;
          vec3 zenith = vec3(0.030, 0.043, 0.066);
          vec3 horizon = vec3(0.115, 0.090, 0.060);
          vec3 ground  = vec3(0.016, 0.020, 0.028);
          vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.6));
          // Bernsteinschimmer am Horizont
          col += vec3(0.30, 0.14, 0.03) * pow(max(0.0, 1.0 - abs(h) * 3.2), 3.0) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x8fb4dd, 0x1a1410, 0.55);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffe3c0, 1.5);
    dir.position.set(6, 9, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 40;
    const S = 9;
    dir.shadow.camera.left = -S; dir.shadow.camera.right = S;
    dir.shadow.camera.top = S; dir.shadow.camera.bottom = -S;
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.02;
    this.scene.add(dir);
    this.scene.add(dir.target);
    this.sun = dir;
  }

  // ── Boden: Gitter-Shader (Testfeld-Look) ──────────────────
  _buildFloor() {
    const geo = new THREE.PlaneGeometry(400, 400, 1, 1);
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: {
        fogColor: { value: new THREE.Color(0x0a0e14) },
        fogNear: { value: 26 }, fogFar: { value: 110 },
      },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        varying vec3 vW;
        uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
        float gridLine(vec2 p, float scale, float width) {
          vec2 g = abs(fract(p / scale - 0.5) - 0.5) / fwidth(p / scale);
          float l = min(g.x, g.y);
          return 1.0 - min(l * width, 1.0);
        }
        void main() {
          vec3 base = vec3(0.043, 0.055, 0.075);
          float g1 = gridLine(vW.xz, 1.0, 1.0) * 0.22;
          float g5 = gridLine(vW.xz, 5.0, 1.2) * 0.38;
          // Arena-Rand in Amber
          float ring = smoothstep(13.4, 13.9, max(abs(vW.x), abs(vW.z))) * 0.9;
          vec3 col = base + vec3(0.10, 0.16, 0.22) * g1 + vec3(0.16, 0.22, 0.30) * g5;
          col += vec3(1.0, 0.55, 0.12) * ring * 0.35;
          float dist = length(vW.xz - vec2(0.0));
          float fogF = smoothstep(fogNear, fogFar, dist);
          col = mix(col, fogColor, fogF);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.005;
    this.scene.add(mesh);
  }

  _buildMarker() {
    // Bodenring unter dem Roboter
    const geo = new THREE.RingGeometry(0.34, 0.40, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff9d21, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    return m;
  }

  // ── Aus dem MuJoCo-Modell bauen ───────────────────────────
  buildFromModel(sim) {
    // Alte Gruppen entsorgen (Sparse-Array: Löcher überspringen)
    if (this.bodyGroups) {
      for (const g of this.bodyGroups) {
        if (!g) continue;
        g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.scene.remove(g);
      }
    }
    this.bodyGroups = [];
    const mod = sim.model;
    const rgba = new Float32Array(4);

    for (let gI = 0; gI < sim.ngeom; gI++) {
      const type = mod.geom_type[gI];
      const body = mod.geom_bodyid[gI];
      if (type === G_PLANE || type === G_HFIELD) continue; // Boden kommt aus dem Shader
      const geo = this._geometryFor(sim, gI, type);
      if (!geo) continue;
      const c4 = 4 * gI; rgba[0]=mod.geom_rgba[c4]; rgba[1]=mod.geom_rgba[c4+1]; rgba[2]=mod.geom_rgba[c4+2]; rgba[3]=mod.geom_rgba[c4+3];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
        metalness: 0.22, roughness: 0.62,
        transparent: rgba[3] < 0.99, opacity: rgba[3],
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      // Lokale Geom-Lage im Körper
      const gp = new Float64Array(3), gq = new Float64Array(4);
      for (let i = 0; i < 3; i++) gp[i] = mod.geom_pos[3 * gI + i];
      for (let i = 0; i < 4; i++) gq[i] = mod.geom_quat[4 * gI + i];
      mesh.position.set(gp[0], gp[1], gp[2]);
      mesh.quaternion.set(gq[1], gq[2], gq[3], gq[0]);
      let grp = this.bodyGroups[body];
      if (!grp) { grp = new THREE.Group(); this.bodyGroups[body] = grp; this.scene.add(grp); }
      grp.add(mesh);
    }
    this.sim = sim;
  }

  _geometryFor(sim, gI, type) {
    const mod = sim.model;
    const s0 = mod.geom_size[3 * gI], s1 = mod.geom_size[3 * gI + 1], s2 = mod.geom_size[3 * gI + 2];
    switch (type) {
      case G_SPHERE: return new THREE.SphereGeometry(s0, 20, 14);
      case G_CYLINDER: return new THREE.CylinderGeometry(s0, s0, 2 * s1, 20);
      case G_BOX: return new THREE.BoxGeometry(2 * s0, 2 * s1, 2 * s2);
      case G_CAPSULE: return new THREE.CapsuleGeometry(s0, 2 * s1, 6, 14);
      case G_ELLIPSOID: return new THREE.SphereGeometry(1, 18, 12).scale(s0, s1, s2);
      case G_MESH: {
        const dataId = mod.geom_dataid[gI];
        const vAdr = mod.mesh_vertadr[dataId], vNum = mod.mesh_vertnum[dataId];
        const fAdr = mod.mesh_faceadr[dataId], fNum = mod.mesh_facenum[dataId];
        const pos = new Float32Array(vNum * 3);
        for (let i = 0; i < vNum * 3; i++) pos[i] = mod.mesh_vert[3 * vAdr + i];
        const idx = new Uint32Array(fNum * 3);
        for (let i = 0; i < fNum * 3; i++) idx[i] = mod.mesh_face[3 * fAdr + i];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        return geo;
      }
      default: return null;
    }
  }

  // ── Geist: halbtransparente Referenz-Pose ─────────────────
  buildGhost(sim) {
    this.removeGhost();
    this.ghostGroups = [];
    this.ghostSim = null;
    const mod = sim.model;
    const rgba = new Float32Array(4);
    for (let gI = 0; gI < sim.ngeom; gI++) {
      const type = mod.geom_type[gI];
      const body = mod.geom_bodyid[gI];
      if (type === G_PLANE || type === G_HFIELD || body === 0) continue;
      const geo = this._geometryFor(sim, gI, type);
      if (!geo) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38d6e0, metalness: 0, roughness: 0.8,
        transparent: true, opacity: 0.22, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      const gp = new Float64Array(3), gq = new Float64Array(4);
      for (let i = 0; i < 3; i++) gp[i] = mod.geom_pos[3 * gI + i];
      for (let i = 0; i < 4; i++) gq[i] = mod.geom_quat[4 * gI + i];
      mesh.position.set(gp[0], gp[1], gp[2]);
      mesh.quaternion.set(gq[1], gq[2], gq[3], gq[0]);
      let grp = this.ghostGroups[body];
      if (!grp) { grp = new THREE.Group(); this.ghostGroups[body] = grp; this.scene.add(grp); }
      grp.add(mesh);
    }
  }

  removeGhost() {
    if (!this.ghostGroups) return;
    for (const g of this.ghostGroups) {
      if (!g) continue;
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.scene.remove(g);
    }
    this.ghostGroups = null;
  }

  updateGhost(sim2) {
    if (!this.ghostGroups) return;
    this.ghostSim = sim2;
    const p = new Float64Array(3), q = new Float64Array(4);
    for (let b = 1; b < this.ghostGroups.length; b++) {
      const grp = this.ghostGroups[b];
      if (!grp) continue;
      for (let i = 0; i < 3; i++) p[i] = sim2.xpos[3 * b + i];
      for (let i = 0; i < 4; i++) q[i] = sim2.xquat[4 * b + i];
      grp.position.set(p[0], p[1], p[2]);
      grp.quaternion.set(q[1], q[2], q[3], q[0]);
    }
  }

  // Pro Frame: Körper-Transformationen + Kamera
  updateFrame(sim, dt) {
    if (this.bodyGroups) {
      const p = new Float64Array(3), q = new Float64Array(4);
      for (let b = 1; b < this.bodyGroups.length; b++) {
        const grp = this.bodyGroups[b];
        if (!grp) continue;
        for (let i = 0; i < 3; i++) p[i] = sim._xpos[3 * b + i];
        for (let i = 0; i < 4; i++) q[i] = sim._xquat[4 * b + i];
        grp.position.set(p[0], p[1], p[2]);
        grp.quaternion.set(q[1], q[2], q[3], q[0]);
      }
      // Marker unter den Roboter
      sim.basePos(p);
      this._marker.position.set(p[0], 0.012, p[1]);
      const hex = this.sim && this.sim.cfg && this.sim.cfg.color ? this.sim.cfg.color : '#ff9d21';
      if (this._markerHex !== hex) { this._markerHex = hex; this._marker.material.color.set(hex); }
      this._anchor.set(p[0], p[1], Math.max(p[2] * 0.8, this.sim.cfg.zTarget * 0.55));
    }
    // Weiche Kamera
    const k = 1 - Math.exp(-8 * dt);
    this._anchorSm.lerp(this._anchor, k);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    this.camera.position.set(
      this._anchorSm.x + this.camDist * cp * Math.sin(this.camYaw),
      this._anchorSm.y + this.camDist * sp,
      this._anchorSm.z + this.camDist * cp * Math.cos(this.camYaw),
    );
    this.camera.lookAt(this._anchorSm);
    // Sonne folgt (Schattenfenster)
    this.sun.position.set(this._anchorSm.x + 6, 9, this._anchorSm.z + 4);
    this.sun.target.position.copy(this._anchorSm);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
