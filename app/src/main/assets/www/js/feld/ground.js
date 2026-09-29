// ═══════════════════════════════════════════════════════════
// feld/ground.js — BEWEGLICHER BODEN (v3.2.0)
//
// Nutzer wörtlich: „Und auch beim Training das option gibt auch
// beweglichen Boden zu aktivieren und einstellen."
//
// Der Roboter steht auf einer VIRTUELLEN KIPPLATTFORM: Die Welt-
// schwerkraft wird gekippt (model.opt.gravity) — physikalisch gleich-
// wertig dazu, dass der Boden unter den Füßen neigt: Die Ente muss
// sich ausbalancieren, sonst rutscht/fällt sie. Das trainiert
// Störungs-Robustheit auf eine Art, die keine festen Pfade kennt
// (Verstehen statt Auswendiglernen) — und macht Spaß.
//
// MUSTER (einstellbar):
//   sinus  — rhythmisch kippen (x- und y-Achse, versetzt)
//   zufall — geglättete Zufallsziele (neue Plattformlage je Periode)
//   achter — Lissajous-Figur (x 1×, y 2× — Spielfeld wie ein Automat)
//   drift  — langsam wandernde Schiefelage mit Richtungswechseln
//
// Regler (Belohnungs-Tab, Karte BEWEGLICHER BODEN):
//   on   — an/aus (beim Training)
//   live — auch im POLICY-Betrieb (zusehen, wie die Ente reagiert)
//   mode — Muster (oben)
//   amp  — WIE STARK: max. Neigung in Grad (1…25)
//   freq — WIE SCHNELL: Frequenz in Hz (0,05…1,5)
//
// Technik: Der Schwerkraft-Vektor (opt.gravity) wird je REGELZYKLUS
// (0,02 s) gesetzt — der Trainer ruft den onStep-Haken (feld.js) nach
// jedem sim.stepN. Basis-Vector g0 wird beim Boot geschnapshotet;
// Neigung 0 stellt exakt g0 her. Kann opt.gravity nicht geschrieben
// werden (WASM-Bindung), fällt applyGround auf Impulse zurück
// (Plattform-Beschleunigung a = G·sin(θ) als Δv je Zyklus).
// Handy-Neigung (phone.js) und Trainings-Boden addieren sich.
// Deterministisch mit RNG (Node-Tests).
// ═══════════════════════════════════════════════════════════

import { clamp } from '../math.js';

const DEG = Math.PI / 180;

export const GROUND_MODES = ['sinus', 'zufall', 'achter', 'drift'];
export const GROUND_MODE_LABELS = {
  sinus: 'Sinus (rhythmisch)', zufall: 'Zufall (geglättet)',
  achter: 'Achter (Lissajous)', drift: 'Drift (wandernd)',
};

export const GROUND_DEFAULTS = { on: 0, live: 0, mode: 'sinus', amp: 8, freq: 0.2 };

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class GroundModel {
  constructor(src) {
    Object.assign(this, GROUND_DEFAULTS);
    if (src) this.setFrom(src);
    this.sanitize();
  }
  setFrom(src) {
    if (!src) return this;
    this.on = fin(src.on, this.on);
    this.live = fin(src.live, this.live);
    this.mode = GROUND_MODES.includes(src.mode) ? src.mode : this.mode;
    this.amp = fin(src.amp, this.amp);
    this.freq = fin(src.freq, this.freq);
    return this;
  }
  sanitize() {
    this.on = this.on ? 1 : 0;
    this.live = this.live ? 1 : 0;
    if (!GROUND_MODES.includes(this.mode)) this.mode = 'sinus';
    this.amp = clamp(fin(this.amp, 8), 1, 25);
    this.freq = clamp(fin(this.freq, 0.2), 0.05, 1.5);
    return this;
  }
  toJSON() { return { on: this.on, live: this.live, mode: this.mode, amp: this.amp, freq: this.freq }; }
  static fromJSON(src) { return new GroundModel(src); }
}

/**
 * Plattform-Zustand: tickt je Regelzyklus, liefert Neigung {x, y} in
 * RADIANT (kleine Winkel: x = vor/zurück kippen, y = seitlich).
 * Deterministisch bei gegebenem rng.
 */
export class GroundState {
  constructor() { this.t = 0; this.reset(); }
  reset() {
    this.px = 0; this.py = 0;            // aktuelle Neigung (normiert −1…1)
    this._tgt = null; this._tgtT = 0;    // zufall: Ziel + Fälligkeit
    this._dirA = 0; this._dirT = 0;      // drift: Richtung + Fälligkeit
  }
  tick(dt, m, rng) {
    if (!m || !m.on || !(dt > 0)) return { x: 0, y: 0 };
    this.t += dt;
    const w = 2 * Math.PI * m.freq;
    const nxt = () => (rng && rng.next ? rng.next() : Math.random());
    let nx = 0, ny = 0;
    if (m.mode === 'sinus') {
      nx = Math.sin(w * this.t);
      ny = Math.sin(w * this.t * 0.83 + 1.3);
    } else if (m.mode === 'achter') {
      nx = Math.sin(w * this.t);
      ny = Math.sin(2 * w * this.t + Math.PI / 2) * 0.8;
    } else if (m.mode === 'zufall') {
      // Neues Ziel je Periode (1/freq s), exponentiell angeglättet —
      // chaotisch, aber ohne Rucke (Plattform, nicht Erdbeben)
      if (this._tgt === null || this.t >= this._tgtT) {
        this._tgt = { x: nxt() * 2 - 1, y: nxt() * 2 - 1 };
        this._tgtT = this.t + 1 / Math.max(0.05, m.freq);
      }
      const k = Math.min(1, dt * Math.max(2, w));
      this.px += (this._tgt.x - this.px) * k;
      this.py += (this._tgt.y - this.py) * k;
      nx = this.px; ny = this.py;
    } else { // drift — langsam wandernde Schiefelage: alle 4–8 Perioden
      // ein neues Ziel, SEHR langsam angeglättet (wirkt wie schmelzendes
      // Eis — Richtungswechsel sind kontinuierlich, nie ein Ruck)
      if (this._tgt === null || this.t >= this._tgtT) {
        this._tgt = { x: nxt() * 2 - 1, y: nxt() * 2 - 1 };
        this._tgtT = this.t + (4 + nxt() * 4) / Math.max(0.05, m.freq);
      }
      const k = Math.min(1, dt * Math.max(0.5, w * 0.25));
      this.px += (this._tgt.x - this.px) * k;
      this.py += (this._tgt.y - this.py) * k;
      nx = this.px; ny = this.py;
    }
    nx = clamp(nx, -1, 1); ny = clamp(ny, -1, 1);
    return { x: nx * m.amp * DEG, y: ny * m.amp * DEG };
  }
}

/** Prüft EINMALIG, ob opt.gravity beschreibbar ist (WASM-Heap-View). */
export function probeGravity(sim) {
  try {
    const g = sim.model.opt.gravity;
    if (!g || g.length < 3) return false;
    const old = g[0];
    g[0] = old + 0.001;
    const back = g[0];
    g[0] = old;
    return Math.abs(back - old - 0.001) < 1e-9;
  } catch (e) { return false; }
}

/**
 * Schwerkraft kippen: g = g0 um tx (vor/zurück) und ty (seitlich)
 * rotiert — physikalisch die geneigte Plattform. Neigung 0 stellt
 * exakt den Snapshot g0 her. tx/ty in Radiant.
 */
export function setGroundTilt(sim, tx, ty, g0) {
  try {
    const g = sim.model.opt.gravity;
    if (!g || g.length < 3) return false;
    const G = Math.hypot(g0[0], g0[1], g0[2]) || 9.81;
    g[0] = g0[0] + G * Math.sin(tx);
    g[1] = g0[1] + G * Math.sin(ty);
    g[2] = g0[2] * Math.cos(tx) * Math.cos(ty);
    return true;
  } catch (e) { return false; }
}

/**
 * Fallback, falls opt.gravity nicht schreibbar ist: Plattform-
 * Beschleunigung als Impuls auf die Basis (Δv = G·sin(θ)·dt) —
 * die Ente fühlt denselben Schiebe-Effekt.
 */
export function applyGroundImpulse(sim, tx, ty, dt, massCache) {
  if (!(dt > 0)) return false;
  try {
    let mass = massCache.m;
    if (!mass) {
      mass = 0;
      for (let b = 0; b < sim.nbody; b++) mass += sim.model.body_mass[b];
      mass = Math.max(1, mass);
      massCache.m = mass;
    }
    const G = 9.81;
    sim.pushImpulse(G * Math.sin(tx) * mass * dt, G * Math.sin(ty) * mass * dt, 0);
    return true;
  } catch (e) { return false; }
}
