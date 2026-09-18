// ═══════════════════════════════════════════════════════════
// render3d.js — Three.js-Renderer: baut Welt & Roboter direkt
// aus dem MuJoCo-Modell (echte Menagerie-Meshes), Vollbild,
// Nachschicht-Optik mit Gitterboden, Nebel und Schatten.
// ═══════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.js';
import { resolveAppearance } from './appearance.js'; // v2.14.0: Aussehen-Editor

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

    // Achsen-Konvention: MuJoCo ist Z-up (Boden = XY-Ebene), Three.js ist
    // Y-up (Boden = XZ-Ebene). Die Weltgruppe dreht einmalig -90° um X,
    // sodass MuJoCo (x,y,z) → Three.js (x, z, -y) abgebildet wird.
    // Alle Roboter-/Geist-Gruppen leben in world und bekommen MUJOCO-
    // Koordinaten direkt (xpos/xquat sind wxyz → set(x,y,z,w)).
    this.world = new THREE.Group();
    this.world.rotation.x = -Math.PI / 2;
    this.scene.add(this.world);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
    this._buildSky();
    this._buildLights();
    this._buildFloor();

    // Kamera-Fahrt (Orbit-Follow)
    this.camYaw = 0.6; this.camPitch = 0.42; this.camDist = 2.6;
    this._anchor = new THREE.Vector3(0, 0, 0.3);
    this._anchorSm = new THREE.Vector3(0, 0, 0.3);

    this.bodyGroups = null;   // THREE.Group je Körper
    this._texCache = null;    // v2.14.1: Modell-Texturen (texId → THREE.DataTexture)
    this._lookMap = null;     // v2.14.0: Aussehen-Overrides
    this._tmpQ = new THREE.Quaternion();
    this._marker = this._buildMarker();
    this.scene.add(this._marker);
  }

  // ── v2.14.1: Modus-Textur aus MuJoCo → THREE.DataTexture ──
  // Menagerie-Modelle (z. B. Skydio X2) tragen ihre echte Optik in
  // Material-Texturen (tex_data). Ohne diese Stütze bliebe die Drohne
  // einfarbig grau/weiß. Die Daten liegen im WASM-Heap als Bytes.
  _textureFor(mod, texId) {
    if (!mod || !mod.tex_data || texId < 0) return null;
    if (!this._texCache) this._texCache = new Map();
    const hit = this._texCache.get(texId);
    if (hit !== undefined) return hit;
    let tex = null;
    try {
      const w = mod.tex_width[texId] | 0, h = mod.tex_height[texId] | 0;
      const nc = mod.tex_nchannel ? (mod.tex_nchannel[texId] | 0) : 3;
      const adr = Number(mod.tex_adr[texId]); // BigInt64 → Number (Einheit: Texel)
      const nTex = w * h;
      const src = mod.tex_data;
      if (w > 0 && h > 0 && (adr * nc + nTex * nc) <= src.length) {
        const data = new Uint8Array(nTex * 4); // immer RGBA (THREE: kein RGBFormat mehr)
        for (let p = 0; p < nTex; p++) {
          const s = adr * nc + p * nc, d = 4 * p;
          data[d] = src[s];
          data[d + 1] = nc > 1 ? src[s + 1] : src[s];
          data[d + 2] = nc > 2 ? src[s + 2] : src[s];
          data[d + 3] = nc > 3 ? src[s + 3] : 255;
        }
        tex = new THREE.DataTexture(data, w, h);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        tex.needsUpdate = true;
      }
    } catch (e) { tex = null; }
    this._texCache.set(texId, tex);
    return tex;
  }

  _disposeTexCache() {
    if (!this._texCache) return;
    for (const t of this._texCache.values()) { if (t) t.dispose(); }
    this._texCache = null;
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
  // v2.13.1: Kollisions-Geoms (Menagerie-Konvention: group 3) NICHT rendern.
  // Sie existieren bei allen Robotern IMMER zusätzlich zu den Visual-Geoms
  // und würden sonst als graue Primitiven sichtbar werden — z. B. der
  // graue Würfel im MicroDuck-Kopf (head_collision-Box aus v2.9.0).
  // Physik bleibt unangetastet (nur Rendering); Bonus: weniger Dreiecke.
  // Fallback: Hat ein Body AUSSCHLIESSLICH group-3-Geoms, wird eines
  // trotzdem gerendert, damit der Body nicht unsichtbar ist.
  _visualCounts(sim) {
    const mod = sim.model;
    const nB = Math.max(mod.nbody || 1, 1);
    const visCnt = new Uint16Array(nB);
    for (let gI = 0; gI < sim.ngeom; gI++) {
      const t = mod.geom_type[gI];
      if (t === G_PLANE || t === G_HFIELD) continue;
      const b = mod.geom_bodyid[gI];
      if (b > 0 && b < nB && mod.geom_group[gI] !== 3) visCnt[b]++;
    }
    return visCnt;
  }

  _skipCollision(sim, gI, visCnt) {
    const mod = sim.model;
    if (mod.geom_group[gI] !== 3) return false;
    const b = mod.geom_bodyid[gI];
    return b > 0 && b < visCnt.length && visCnt[b] > 0;
  }

  buildFromModel(sim) {
    // Alte Gruppen entsorgen (Sparse-Array: Löcher überspringen)
    if (this.bodyGroups) {
      for (const g of this.bodyGroups) {
        if (!g) continue;
        g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.world.remove(g);
      }
    }
    this._disposeTexCache(); // v2.14.1: Modell-Texturen sind je Modell anders
    this.bodyGroups = [];
    const mod = sim.model;
    const rgba = new Float32Array(4);
    const visCnt = this._visualCounts(sim);

    for (let gI = 0; gI < sim.ngeom; gI++) {
      const type = mod.geom_type[gI];
      const body = mod.geom_bodyid[gI];
      if (type === G_PLANE || type === G_HFIELD) continue; // Boden kommt aus dem Shader
      if (this._skipCollision(sim, gI, visCnt)) continue;   // Kollisions-Geoms unsichtbar (v2.13.1)
      const geo = this._geometryFor(sim, gI, type);
      if (!geo) continue;
      const c4 = 4 * gI; rgba[0]=mod.geom_rgba[c4]; rgba[1]=mod.geom_rgba[c4+1]; rgba[2]=mod.geom_rgba[c4+2]; rgba[3]=mod.geom_rgba[c4+3];
      // v2.14.1 GRAU-FIX: Menagerie-Modelle färben über MATERIALIEN
      // (geom_matid → mat_rgba), nicht über geom_rgba — das steht auf dem
      // MuJoCo-Default 0,5-Grau, wenn keine Farbe direkt am Geom steht.
      // G1: schwarz/metal · MicroDuck: beige/dunkle Schalen · X2: Textur.
      let cr = rgba[0], cg = rgba[1], cb = rgba[2], ca = rgba[3];
      let met = 0.22, rgh = 0.62, tex = null;
      const mId = mod.geom_matid ? mod.geom_matid[gI] : -1;
      if (mId >= 0 && mod.mat_rgba) {
        const m4 = 4 * mId;
        cr = mod.mat_rgba[m4]; cg = mod.mat_rgba[m4 + 1]; cb = mod.mat_rgba[m4 + 2]; ca = mod.mat_rgba[m4 + 3];
        if (mod.mat_metallic) met = Math.min(1, Math.max(0, mod.mat_metallic[mId]));
        if (mod.mat_roughness) rgh = Math.min(1, Math.max(0.25, mod.mat_roughness[mId])); // Floor: kein Spiegel-Schwarz ohne Env-Map
        const tId = mod.mat_texid ? Number(mod.mat_texid[10 * mId + 1]) : -1; // mjTEXROLE_RGB = 1
        if (tId >= 0) tex = this._textureFor(mod, tId);
      }
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cr, cg, cb),
        metalness: met,
        roughness: rgh,
        map: tex || null,
        transparent: ca < 0.99, opacity: ca,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.geomIndex = gI; // v2.14.0: Look-Live-Updates je Geom
      mesh.userData.base = { color: [cr, cg, cb], rough: rgh, metal: met, map: tex || null }; // v2.14.1: Basis für Look-Restore
      mesh.castShadow = true; mesh.receiveShadow = true;
      // Lokale Geom-Lage im Körper
      const gp = new Float64Array(3), gq = new Float64Array(4);
      for (let i = 0; i < 3; i++) gp[i] = mod.geom_pos[3 * gI + i];
      for (let i = 0; i < 4; i++) gq[i] = mod.geom_quat[4 * gI + i];
      mesh.position.set(gp[0], gp[1], gp[2]);
      mesh.quaternion.set(gq[1], gq[2], gq[3], gq[0]);
      let grp = this.bodyGroups[body];
      if (!grp) { grp = new THREE.Group(); this.bodyGroups[body] = grp; this.world.add(grp); }
      grp.add(mesh);
    }
    this.sim = sim;
    if (this._lookMap) this._applyLook(); // v2.14.1: Overrides nach dem Build auftragen
  }

  // v2.14.0: Aussehen-Overrides live anwenden (nach setAppearance-Änderung)
  // v2.14.1: Meshes OHNE Override kehren zur Modell-Basis zurück (auch Textur),
  // damit „Reset" und Roboterwechsel sauber sind. Explizite Farbe ersetzt die
  // Textur (pure Farbe), Rough/Metal-Overrides lassen die Textur an.
  setAppearance(sim, spec) {
    this._lookMap = spec ? resolveAppearance(sim, spec) : null;
    this._applyLook();
    return this._lookMap;
  }

  _applyLook() {
    if (!this.bodyGroups) return;
    for (const grp of this.bodyGroups) {
      if (!grp) continue;
      for (const mesh of grp.children) {
        const gi = mesh.userData.geomIndex;
        if (gi === undefined) continue;
        const base = mesh.userData.base;
        if (!base) continue;
        const st = this._lookMap ? this._lookMap.get(gi) : null;
        const m = mesh.material;
        if (!st) {
          m.color.setRGB(base.color[0], base.color[1], base.color[2]);
          m.roughness = base.rough;
          m.metalness = base.metal;
          if (m.map !== base.map) { m.map = base.map; m.needsUpdate = true; }
          continue;
        }
        if (st.color) {
          m.color.setRGB(st.color[0], st.color[1], st.color[2]);
          if (m.map) { m.map = null; m.needsUpdate = true; } // Farbe statt Textur
        }
        if (st.rough !== undefined) m.roughness = st.rough;
        if (st.metal !== undefined) m.metalness = st.metal;
      }
    }
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
        // v2.14.1: UVs — Voraussetzung für Material-Texturen (Skydio X2).
        // MuJoCo hält Texcoords SEPARAT von Vertices (Seams): pro Face-Ecke
        // zeigt mesh_facetexcoord auf den Texcoord-Index.
        const tcNum = mod.mesh_texcoordnum ? mod.mesh_texcoordnum[dataId] : 0;
        if (tcNum > 0 && mod.mesh_texcoord) {
          const tcAdr = mod.mesh_texcoordadr[dataId];
          const uv = new Float32Array(vNum * 2);
          const ftcAdr = mod.mesh_facetexcoordadr ? mod.mesh_facetexcoordadr[dataId] : -1;
          if (ftcAdr >= 0 && mod.mesh_facetexcoord) {
            for (let f = 0; f < fNum; f++) {
              for (let c = 0; c < 3; c++) {
                const vi = idx[3 * f + c];
                const ti = mod.mesh_facetexcoord[ftcAdr + 3 * f + c];
                if (vi * 2 + 1 < vNum * 2 && ti >= 0) {
                  uv[2 * vi] = mod.mesh_texcoord[2 * tcAdr + 2 * ti];
                  uv[2 * vi + 1] = mod.mesh_texcoord[2 * tcAdr + 2 * ti + 1];
                }
              }
            }
          } else {
            for (let i = 0; i < vNum; i++) {
              uv[2 * i] = mod.mesh_texcoord[2 * tcAdr + 2 * i];
              uv[2 * i + 1] = mod.mesh_texcoord[2 * tcAdr + 2 * i + 1];
            }
          }
          geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
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
    const visCnt = this._visualCounts(sim); // v2.13.1: auch im Geist keine Kollisions-Geoms
    for (let gI = 0; gI < sim.ngeom; gI++) {
      const type = mod.geom_type[gI];
      const body = mod.geom_bodyid[gI];
      if (type === G_PLANE || type === G_HFIELD || body === 0) continue;
      if (this._skipCollision(sim, gI, visCnt)) continue;
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
      if (!grp) { grp = new THREE.Group(); this.ghostGroups[body] = grp; this.world.add(grp); }
      grp.add(mesh);
    }
    // v2.27.0: Geist SOFORT in die echte Roboter-Pose setzen — ohne diesen
    // Aufruf klebten alle Körpergruppen am Ursprung im Lokal-Ruhesatz
    // (halb im Boden, Teile verstreut = „plötzlich blaue Objekte“).
    if (sim && sim._xpos && sim._xquat) this.updateGhost({ xpos: sim._xpos, xquat: sim._xquat });
  }

  // v2.27.0: Geist OHNE aktive Referenz live an den echten Roboter heften —
  // er steht dann normal daneben (gleiche Pose, cyan), statt im Boden zu
  // stecken. sim = Engine-Wrapper (_xpos/_xquat je Körper, MuJoCo-Welt).
  mirrorGhost(sim) {
    if (!this.ghostGroups || !sim || !sim._xpos || !sim._xquat) return;
    this.updateGhost({ xpos: sim._xpos, xquat: sim._xquat });
  }

  removeGhost() {
    if (!this.ghostGroups) return;
    for (const g of this.ghostGroups) {
      if (!g) continue;
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.world.remove(g);
    }
    this.ghostGroups = null;
  }

  // ── Lehrer-Ghost: ORIGINAL-Animation auf Original-Figur ──
  // a) Original-3D-Modell (skinned Mesh aus der GLB) wenn vorhanden —
  //    im ALIGN-Wrap (GLB Y-up → MuJoCo Z-up), sonst wäre es liegend/flach
  //    (genau der „z und y vertauscht“-Bug).
  // b) nur OHNE Mesh: grüne Skelett-Figur aus srcPos (Debug-Optik).
  // Der Lehrer läuft MIT Root-Motion wirklich durchs Feld — seitlich
  // versetzt, damit er nicht im Roboter steht.
  buildSourceGhost(motion, scenePkg) {
    this.removeSourceGhost();
    if (!motion || !motion.srcPos || !motion.srcJoints) return;
    this._srcJointMeshes = [];   // Stale-Flags des vorherigen Builds löschen
    this._srcLimbs = [];
    this._srcIdx = {};
    this.sourceGhost = new THREE.Group();
    this.sourceGhost.name = 'Lehrer';
    this._srcBase = new THREE.Vector3(0, 1.1, 0); // parallele Bahn, links vom Roboter
    this.sourceGhost.position.copy(this._srcBase);
    this.world.add(this.sourceGhost);
    this._srcMotion = motion;
    this._srcScene = scenePkg || null;
    const hasMesh = !!(scenePkg && scenePkg.group);
    if (hasMesh) {
      scenePkg.group.traverse((o) => {
        if (o.material) {
          o.material.transparent = true;
          o.material.opacity = Math.min(o.material.opacity === undefined ? 1 : o.material.opacity, 0.92);
          o.material.depthWrite = true;
        }
      });
      // GLB-Rahmen (Y-up, Datei-Einheiten) → MuJoCo-Welt (Z-up, m):
      // X_glb→Y_mjc, Y_glb→Z_mjc, Z_glb→X_mjc = Rotation 120° um (1,1,1)
      // = Quaternion [0.5,0.5,0.5,0.5] — identisch zur srcPos-Konvertierung.
      const wrap = new THREE.Group();
      wrap.name = 'GlbAlign';
      wrap.quaternion.set(0.5, 0.5, 0.5, 0.5);
      wrap.scale.setScalar(motion.srcScale || 1);
      wrap.add(scenePkg.group);
      this.sourceGhost.add(wrap);
    }
    if (!hasMesh) {
    // Skelett-Figur: Gelenk-Kugeln + Glieder-Zylinder (unit-hoch, skaliert)
    // — NUR ohne Original-Mesh, sonst wäre es Störopfer unnötiger Linien.
    const J = motion.srcJoints;
    this._srcIdx = {}; for (let i = 0; i < J.length; i++) this._srcIdx[J[i]] = i;
    this._srcJointMeshes = [];
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x59e0a8, roughness: 0.5, transparent: true, opacity: 0.85 });
    for (const role of J) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), jointMat);
      this.sourceGhost.add(m);
      this._srcJointMeshes.push({ role, mesh: m });
    }
    const PAIRS = [
      ['hips', 'spine'], ['spine', 'head'],
      ['hips', 'leftUpLeg'], ['leftUpLeg', 'leftLeg'], ['leftLeg', 'leftFoot'],
      ['hips', 'rightUpLeg'], ['rightUpLeg', 'rightLeg'], ['rightLeg', 'rightFoot'],
      ['spine', 'leftArm'], ['leftArm', 'leftForeArm'],
      ['spine', 'rightArm'], ['rightArm', 'rightForeArm'],
    ];
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x3fcf92, roughness: 0.6, transparent: true, opacity: 0.7 });
    this._srcLimbs = [];
    for (const [a, b] of PAIRS) {
      if (this._srcIdx[a] === undefined || this._srcIdx[b] === undefined) continue;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), limbMat);
      this.sourceGhost.add(m);
      this._srcLimbs.push({ a, b, mesh: m });
    }
    }
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._vA = new THREE.Vector3(); this._vB = new THREE.Vector3();
    this._vD = new THREE.Vector3();
    // v2.28.1 OVERLAY-Basis: Frame-0-Hüfte (srcJoints[0] = 'hips') als
    // Ursprung der RELATIVEN Darstellung + Flag (Standard: absolut, damit
    // der GLB-Original-Mesh-Pfad unverändert bleibt).
    this._srcOrigin = [motion.srcPos[0], motion.srcPos[1]];
    this._srcRelative = false;
  }

  // v2.28.1: Relative Darstellung (Frame-0-Hüfte = Ursprung) an/aus.
  setSourceGhostRelative(on) {
    this._srcRelative = !!on;
  }

  // v2.28.1 ARDY-OVERLAY: das grüne Skeleton reitet EXAKT auf dem
  // Geist-Anker (x, y) — keine Parallelbahn mehr, kein „auseinander“.
  // Die gerenderte (relative) Hüfte landet per Gruppen-Offset exakt auf
  // dem Anker; die Posen spielen wie gehabt. Ruft setSourceGhostRelative(true).
  placeSourceGhostAt(frame, x, y) {
    const motion = this._srcMotion;
    if (!this.sourceGhost || !motion || !motion.srcPos || !this._srcOrigin) return;
    this._srcRelative = true;
    const J = motion.srcJoints.length;
    const hi = this._srcIdx && this._srcIdx.hips !== undefined ? this._srcIdx.hips : 0;
    const o = frame * J * 3 + hi * 3;
    const hx = motion.srcPos[o] - this._srcOrigin[0];
    const hy = motion.srcPos[o + 1] - this._srcOrigin[1];
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) return;
    this.sourceGhost.position.set(x - hx, y - hy, 0);
  }

  // Schleifen-Rebase: lässt den Lehrer (Skelett UND Original-Mesh) nach
  // jedem Clip-Durchlauf WEITERLAUFEN statt zum Start zurückzuteleportieren.
  // dx/dy = Bahnlänge seit Aktivierung (Loop-Offset des Motion-Tasks).
  setSourceGhostLoop(dx, dy) {
    if (!this.sourceGhost || !this._srcBase) return;
    this.sourceGhost.position.set(this._srcBase.x + (dx || 0), this._srcBase.y + (dy || 0), this._srcBase.z);
  }

  updateSourceGhost(frame) {
    const motion = this._srcMotion;
    if (!this.sourceGhost || !motion || !motion.srcPos) return;
    if (this._srcJointMeshes && this._srcJointMeshes.length) {
    const J = motion.srcJoints.length;
    // v2.28.1: im Overlay-/Relativ-Modus wird die Frame-0-Hüfte als
    // Ursprung abgezogen (x/y) — z (Höhe, geerdet) bleibt absolut.
    const REL = this._srcRelative && this._srcOrigin;
    const OX = REL ? this._srcOrigin[0] : 0, OY = REL ? this._srcOrigin[1] : 0;
    const P = (idx) => {
      const o = frame * J * 3 + idx * 3;
      return [motion.srcPos[o] - OX, motion.srcPos[o + 1] - OY, motion.srcPos[o + 2]];
    };
    for (const { role, mesh } of this._srcJointMeshes) {
      const i = this._srcIdx[role];
      const p = P(i);
      if (Number.isFinite(p[0])) mesh.position.set(p[0], p[1], p[2]);
      else mesh.visible = false;
    }
    for (const { a, b, mesh } of this._srcLimbs) {
      const pa = P(this._srcIdx[a]), pb = P(this._srcIdx[b]);
      if (!Number.isFinite(pa[0]) || !Number.isFinite(pb[0])) { mesh.visible = false; continue; }
      mesh.visible = true;
      this._vA.set(pa[0], pa[1], pa[2]);
      this._vB.set(pb[0], pb[1], pb[2]);
      this._vD.subVectors(this._vB, this._vA);
      const len = this._vD.length();
      if (len < 1e-5) { mesh.visible = false; continue; }
      mesh.position.copy(this._vA).addScaledVector(this._vD, 0.5);
      mesh.quaternion.setFromUnitVectors(this._upVec, this._vD.normalize());
      mesh.scale.set(1, len, 1);
    }
    }
    // Original-Mesh antreiben (immer, auch neben Skelett-Fallback)
    if (this._srcScene && this._srcScene.setTime) this._srcScene.setTime(frame / (motion.fps || 30));
  }

  removeSourceGhost() {
    // v2.24.0: IMMER null schreiben (auch beim Early-Return) — sonst bleibt
    // sourceGhost „undefined" und die UI kann den Zustand nicht sauber lesen.
    if (!this.sourceGhost) { this.sourceGhost = null; this._srcMotion = null; this._srcScene = null; return; }
    this.sourceGhost.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.world.remove(this.sourceGhost);
    this.sourceGhost = null;
    this._srcMotion = null;
    this._srcScene = null;
    this._srcOrigin = null;
    this._srcRelative = false;
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
      // Marker unter dem Roboter (Marker lebt in Szenen-Koordinaten:
      // MuJoCo (x,y) → Szene (x, Höhe, -y))
      sim.basePos(p);
      this._marker.position.set(p[0], 0.012, -p[1]);
      const hex = this.sim && this.sim.cfg && this.sim.cfg.color ? this.sim.cfg.color : '#ff9d21';
      if (this._markerHex !== hex) { this._markerHex = hex; this._marker.material.color.set(hex); }
      this._anchor.set(p[0], Math.max(p[2] * 0.8, this.sim.cfg.zTarget * 0.55), -p[1]);
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
