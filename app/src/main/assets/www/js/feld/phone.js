// ═══════════════════════════════════════════════════════════
// feld/phone.js — HANDY-SENSOR ALS SPIELFELD (v3.2.0)
//
// Nutzer wörtlich: „kannst du noch machen das man anschalten kann
// das App gyroskop meines Handys liest und dann je nach dem was man
// einstellt wenn ich ah da bewegen den Roboter schubst oder den
// Boden bewegt. Wäre witzig."
//
// ZWEI SPÄßE (kombinierbar, im Training UND im POLICY-Betrieb):
//   1. BEWEGUNG SCHUBST DEN ROBOTER — Handy schwingen (wie ein
//      Joystick, flach in der Hand): die lineare Beschleunigung der
//      Schebenebene wird zur Stoßrichtung (y = vor, x = seitlich,
//      relativ zur Blickrichtung der Ente). Schubs-Stärke wächst mit
//      der Wucht (|a| − Schwelle) × Empfindlichkeit, gekappt bei vMax,
//      mit 0,25-s-Abklingzeit (kein Maschinengewehr).
//   2. NEIGUNG BEWEGT DEN BODEN — Handy neigen kippt die Welt:
//      Pitch/Roll der Schwerkraft → Schwerkraft-Vektor der Simulation
//      (gleiche Mechanik wie beweglicher Boden, ground.js). Vorne
//      runter = Ente rutscht nach vorn, rechts runter = nach rechts.
//
// QUELLEN (Fallback-Kette):
//   'app' — native Sensor-Brücke FeldMotion (MainActivity: TYPE_GYROSCOPE,
//           TYPE_GRAVITY, TYPE_LINEAR_ACCELERATION, GAME-Rate) — zuver-
//           lässigster Weg im WebView
//   'web' — DeviceMotion-Events des WebViews (Fallback)
//
// Regler (Belohnungs-Tab, Karte HANDY-SENSOR):
//   on · pushOn · groundOn · inv (Richtung umkehren) ·
//   sens (Empfindlichkeit 0,2–3) · thr (Schwelle m/s² 0,5–12) ·
//   vMax (Schubs-Stärke max, Δv m/s 0,2–6) · tiltMax (Boden-Neigung max ° 2–25)
//
// phonePush/phoneTilt sind rein (Sensor = Datenobjekt) → Node-Tests.
// ═══════════════════════════════════════════════════════════

import { clamp } from '../math.js';

const DEG = Math.PI / 180;
const PUSH_COOLDOWN_S = 0.25; // min. Abstand zwischen Handy-Schubsereien

export const PHONE_DEFAULTS = {
  on: 0, pushOn: 1, groundOn: 0, inv: 0,
  sens: 1, thr: 3, vMax: 2.5, tiltMax: 12,
};

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class PhoneModel {
  constructor(src) {
    Object.assign(this, PHONE_DEFAULTS);
    if (src) this.setFrom(src);
    this.sanitize();
  }
  setFrom(src) {
    if (!src) return this;
    this.on = fin(src.on, this.on);
    this.pushOn = fin(src.pushOn, this.pushOn);
    this.groundOn = fin(src.groundOn, this.groundOn);
    this.inv = fin(src.inv, this.inv);
    this.sens = fin(src.sens, this.sens);
    this.thr = fin(src.thr, this.thr);
    this.vMax = fin(src.vMax, this.vMax);
    this.tiltMax = fin(src.tiltMax, this.tiltMax);
    return this;
  }
  sanitize() {
    this.on = this.on ? 1 : 0;
    this.pushOn = this.pushOn ? 1 : 0;
    this.groundOn = this.groundOn ? 1 : 0;
    this.inv = this.inv ? 1 : 0;
    this.sens = clamp(fin(this.sens, 1), 0.2, 3);
    this.thr = clamp(fin(this.thr, 3), 0.5, 12);
    this.vMax = clamp(fin(this.vMax, 2.5), 0.2, 6);
    this.tiltMax = clamp(fin(this.tiltMax, 12), 2, 25);
    return this;
  }
  toJSON() {
    return { on: this.on, pushOn: this.pushOn, groundOn: this.groundOn, inv: this.inv, sens: this.sens, thr: this.thr, vMax: this.vMax, tiltMax: this.tiltMax };
  }
  static fromJSON(src) { return new PhoneModel(src); }
}

/**
 * Sensor-Quelle im Browser (nur dort instanziert — Tests nutzen
 * reine Datenobjekte). start()/stop() je UI-Schalter; poll() einmal
 * je Animations-Frame; Werte landen in this.l (linear), this.g
 * (Schwerkraft), this.w (Gyro rad/s), this.act (geglättete Wucht).
 */
export class PhoneSensor {
  constructor() {
    this.ok = false; this.src = null;
    this.w = [0, 0, 0]; this.g = [0, 0, -9.81]; this.l = [0, 0, 0];
    this.act = 0;
    this._nat = null; this._dm = null;
  }
  start() {
    if (typeof window === 'undefined') return;
    // 1) Native Brücke (MainActivity MotionBridge) — zuverlässig im WebView
    try {
      if (window.FeldMotion && typeof window.FeldMotion.start === 'function' && window.FeldMotion.available()) {
        window.FeldMotion.start();
        this._nat = window.FeldMotion;
        this.src = 'app';
        this.ok = true;
        return;
      }
    } catch (e) { /* weiter zum Fallback */ }
    // 2) DeviceMotion-Events (WebView-Fallback)
    if (typeof window.DeviceMotionEvent !== 'undefined') {
      this._dm = (e) => {
        try {
          const r = e.rotationRate;
          if (r) this.w = [(r.alpha || 0) * DEG, (r.beta || 0) * DEG, (r.gamma || 0) * DEG];
          const gg = e.accelerationIncludingGravity;
          if (gg && gg.x != null) this.g = [gg.x, gg.y, gg.z];
          const la = e.acceleration;
          if (la && la.x != null) this.l = [la.x, la.y, la.z];
          this.ok = true;
        } catch (err) { /* Einzelereignis ignorieren */ }
      };
      window.addEventListener('devicemotion', this._dm);
      this.src = 'web';
      this.ok = true;
    }
  }
  stop() {
    try { if (this._nat) this._nat.stop(); } catch (e) { /* ok */ }
    if (this._dm) { window.removeEventListener('devicemotion', this._dm); this._dm = null; }
    this._nat = null;
    this.ok = false; this.src = null;
  }
  /** Einmal je Frame: neueste Werte holen (nativ JSON, web = Ereignisse). */
  poll() {
    if (!this._nat) return;
    try {
      const d = JSON.parse(this._nat.read());
      if (!d.ok) { this.ok = false; return; }
      this.ok = true;
      this.w = [d.wx, d.wy, d.wz];
      this.g = [d.gx, d.gy, d.gz];
      this.l = [d.lx, d.ly, d.lz];
    } catch (e) { /* Frame ohne neue Daten ok */ }
  }
  /** Geglättete Bewegungs-Wucht (m/s²) — für Schwellen. */
  activity() {
    const m = Math.hypot(this.l[0], this.l[1], this.l[2]);
    this.act = this.act ? this.act * 0.7 + m * 0.3 : m;
    return { m, act: this.act };
  }
  /** Neigung der Schwerkraft (Pitch vor+, Roll rechts+), geklemmt, in rad. */
  tilt(maxDeg) {
    const gm = Math.hypot(this.g[0], this.g[1], this.g[2]);
    if (gm < 1) return { x: 0, y: 0 }; // Freier Fall / kein Gravitationssignal
    const cap = (maxDeg || 12) * DEG;
    const pitch = Math.atan2(this.g[1], -this.g[2]); // vorne runter → +
    const roll = Math.atan2(this.g[0], -this.g[2]);  // rechts runter → +
    return { x: clamp(pitch, -cap, cap), y: -clamp(roll, -cap, cap) };
  }
}

/**
 * Handy-Schubser: prüft die Bewegungs-Wucht gegen die Schwelle und
 * stößt die Ente in Scheibenrichtung (yaw-relativ). st = gemeinsamer
 * Zustand { t, last } (Simzeit); dt in Simzeit-Sekunden.
 * @returns {dv, rel} oder null (kein Schubs)
 */
export function phonePush(sim, model, sensor, st, dt) {
  if (!sim || typeof sim.pushImpulse !== 'function') return null;
  st.t = (st.t || 0) + (dt || 0);
  const { m } = sensor.activity();
  if (m < model.thr) return null;
  if (st.t - (st.last || -9) < PUSH_COOLDOWN_S) return null;
  st.last = st.t;
  const dv = Math.min(model.vMax, (m - model.thr) * 0.3 * model.sens);
  // Blickrichtung der Basis (w,x,y,z → yaw)
  const bq = sensor._bq || (sensor._bq = new Float64Array(4));
  sim.baseQuat(bq);
  const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  // Schebenebene → Roboter: +y (Handy vorn) = vor, +x (Handy rechts) = rechts
  let rel = -Math.atan2(sensor.l[0], sensor.l[1]);
  if (model.inv) rel = -rel;
  const a = yaw + rel;
  let mass = 0;
  for (let b = 0; b < sim.nbody; b++) mass += sim.model.body_mass[b];
  mass = Math.max(1, mass);
  const J = dv * mass;
  sim.pushImpulse(Math.cos(a) * J, Math.sin(a) * J, 0);
  return { dv, rel };
}
