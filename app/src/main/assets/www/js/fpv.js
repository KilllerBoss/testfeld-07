// ═══════════════════════════════════════════════════════════
// fpv.js — FPV-KAMERA (v2.13.0): Zeigt in einem kleinen Rechteck, was der
// Roboter „sieht" — Kamera am Kopf/Torso/Basis, Blick nach vorn (Yaw-only).
// WICHTIG: Reine ANZEIGE für den Nutzer. Die Policy bekommt dieses Bild
// NIEMALS als Eingang (Beobachtungsraum bleibt unverändert). Ein
// Vision-Modell kann später hier anknüpfen (Canvas → ONNX), bis dahin
// bleibt der Kanal bewusst leer.
// Eigener kleiner WebGL-Renderer (240×160) auf derselben Three.js-Szene.
// ═══════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.js';
import { mj, mjOBJ } from './engine.js';

export class Fpv {
  static W = 240; static H = 160;

  constructor(r3d, canvas) {
    this.r3d = r3d;
    this.canvas = canvas;
    this.on = false;
    this.fov = 75;        // Sichtfeld (Grad)
    this.pitch = 12;      // nach unten geneigt (Grad)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.setSize(Fpv.W, Fpv.H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera = new THREE.PerspectiveCamera(this.fov, Fpv.W / Fpv.H, 0.05, 200);
    this._sim = null;
    this._mount = -1; this._lift = 0.2;
    this._p = new Float64Array(3); this._q = new Float64Array(4);
    this._eye = new THREE.Vector3(); this._tgt = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  applySettings(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.on === 'boolean') this.on = s.on;
    if (Number.isFinite(s.fov)) this.fov = Math.min(110, Math.max(40, s.fov));
    if (Number.isFinite(s.pitch)) this.pitch = Math.min(35, Math.max(-20, s.pitch));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  // Kamera-Anker je Roboter: lieber Kopf, sonst Torso/Rumpf, sonst Basis
  _resolveMount(sim) {
    this._sim = sim;
    this._mount = sim.baseBody; this._lift = 0.2;
    try {
      const m = mj();
      let torso = -1;
      for (let b = 1; b < sim.nbody; b++) {
        const nm = (m.mj_id2name(sim.model, mjOBJ.BODY, b) || '').toLowerCase();
        if (/head|kopf/.test(nm)) { this._mount = b; this._lift = 0.06; return; }
        if (torso < 0 && /torso|trunk|rumpf|body_?link|pelvis|trunk_base/.test(nm)) torso = b;
      }
      if (torso >= 0) { this._mount = torso; this._lift = torso === sim.baseBody ? 0.2 : 0.3; }
    } catch (e) { /* Basis bleibt */ }
  }

  render(sim) {
    if (!this.on || !sim) return;
    if (this._sim !== sim) this._resolveMount(sim);
    const o = 3 * this._mount, oq = 4 * this._mount;
    const xp = sim._xpos, xq = sim._xquat;
    // Blickrichtung = +X des mount-Körpers, rotiert mit Quaternion (w,x,y,z):
    // v' = (1 − 2(y²+z²), 2xy, 2xz)  [Rotation von (1,0,0)]
    const oq_x = xq[oq + 1], oq_y = xq[oq + 2], oq_z = xq[oq + 3];
    const fx = 1 - 2 * (oq_y * oq_y + oq_z * oq_z);
    const fy = 2 * (oq_x * oq_y);
    const fz = 2 * (oq_x * oq_z);
    // MuJoCo (x,y,z) → Three.js (x, z, −y); Blick nur um die Hochachse (stabil)
    this._fwd.set(fx, 0, -fy);
    if (this._fwd.lengthSq() < 1e-6) this._fwd.set(1, 0, 0);
    this._fwd.normalize();
    // Auge: Mount-Position + Hub, in Three.js-Koordinaten
    const mx = xp[o], my = xp[o + 1], mz = xp[o + 2] + this._lift;
    this._eye.set(mx, mz, -my);
    const a = this.pitch * Math.PI / 180;
    this._tgt.copy(this._eye)
      .addScaledVector(this._fwd, Math.cos(a));
    this._tgt.y -= Math.sin(a);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this._eye);
    this.camera.lookAt(this._tgt);
    this.renderer.render(this.r3d.scene, this.camera);
  }
}
