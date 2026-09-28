// ═══════════════════════════════════════════════════════════
// feld/rewards.js — Belohnungssystem: ALLE REGLER + PRESETS + TERME
//
// Das Modell TRÄGT die rW-Zahlen direkt (der Task liest cfg.rW.live
// je reward()-Aufruf — Änderungen wirken SOFORT, ohne Neustart).
//
// Presets: stehen/balance · gehen · drehen · aufstehen
// Terme (rWx): goTo · stayNear · heightBand · faceYaw · paceMax ·
//              paceMin · uprightMin · symmetric (rewardx.js-Bridge)
// Konsole-Kopplung: goTo/faceYaw-Terme mit source:'console' lesen
// ihre Ziele LIVE aus der Steuerkonsole (feld.js schreibt sie).
// ═══════════════════════════════════════════════════════════

import { sanitizeRwx } from '../rewardx.js';

/** Feld-Definition: [Schlüssel, Bezeichner, min, max, step, Default (Duck)] */
export const RW_FIELDS = [
  ['vel', 'Tempo-Tracking', 0, 2, 0.01, 0.25],
  ['yaw', 'Dreh-Tracking', 0, 2, 0.01, 0.05],
  ['up', 'Aufrecht', 0, 2, 0.01, 0.12],
  ['height', 'Höhe', 0, 2, 0.01, 0.5],
  ['alive', 'Am-Leben', 0, 1, 0.01, 0.06],
  ['energy', 'Energie-Strafe', 0, 0.005, 0.00001, 0.0002],
  ['smooth', 'Ruhigkeit', 0, 0.2, 0.001, 0.01],
  ['jlimit', 'Gelenk-Rand', 0, 0.5, 0.01, 0.05],
  ['foot', 'Fuß-Ruhe', 0, 0.3, 0.005, 0.02],
  ['route', 'Router-Glättung', 0, 1, 0.01, 0.15],
  ['recover', 'Aufstehen', 0, 2, 0.01, 0.1],
  ['fall', 'Sturz-Malus', 0, 2, 0.01, 0.5],
  ['imit', 'Lehrer-Imitation', 0, 1, 0.01, 0.6],
];

export const PRESETS = {
  stehen: { name: 'Stehen · Balance',
    rW: { vel: 0.08, yaw: 0.02, up: 0.35, height: 0.8, alive: 0.1, energy: 0.0004, smooth: 0.03, jlimit: 0.12, foot: 0.05, route: 0.2, recover: 0.05, fall: 0.5, imit: 0 } },
  gehen: { name: 'Gehen',
    rW: { vel: 0.45, yaw: 0.06, up: 0.12, height: 0.5, alive: 0.06, energy: 0.0002, smooth: 0.012, jlimit: 0.05, foot: 0.02, route: 0.15, recover: 0.1, fall: 0.5, imit: 0.2 } },
  drehen: { name: 'Drehen',
    rW: { vel: 0.1, yaw: 0.3, up: 0.15, height: 0.5, alive: 0.06, energy: 0.0002, smooth: 0.015, jlimit: 0.05, foot: 0.012, route: 0.15, recover: 0.1, fall: 0.5, imit: 0 } },
  aufstehen: { name: 'Aufstehen',
    rW: { vel: 0.05, yaw: 0.02, up: 0.2, height: 0.25, alive: 0.12, energy: 0.0001, smooth: 0.02, jlimit: 0.02, foot: 0.005, route: 0.05, recover: 0.9, fall: 0.05, imit: 0 } },
};

export const RWX_DEFS = {
  goTo: { label: 'Ziel (goTo)', params: ['x', 'y', 'tol'] },
  stayNear: { label: 'Umkreis (stayNear)', params: ['x', 'y', 'r'] },
  heightBand: { label: 'Höhenband', params: ['zMin', 'zMax'] },
  faceYaw: { label: 'Blickrichtung (faceYaw)', params: ['yaw'] },
  paceMax: { label: 'Tempo max', params: ['v'] },
  paceMin: { label: 'Tempo min', params: ['v'] },
  uprightMin: { label: 'Aufrecht min', params: ['up'] },
  symmetric: { label: 'L/R-Symmetrie', params: [] },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class RewModel {
  /**
   * @param base  Start-rW (z. B. Duck-Defaults)
   */
  constructor(base) {
    for (const [k] of RW_FIELDS) this[k] = fin(base ? base[k] : 0, 0);
    this.sanitize();
    this.onPreset = null; // Callback für UI
  }

  sanitize() {
    for (const [k, , lo, hi] of RW_FIELDS) this[k] = clamp(fin(this[k], 0), lo, hi);
  }

  applyPreset(id) {
    const p = PRESETS[id];
    if (!p) return null;
    for (const [k] of RW_FIELDS) this[k] = p.rW[k] !== undefined ? p.rW[k] : this[k];
    this.sanitize();
    return id;
  }

  toJSON() {
    const o = {};
    for (const [k] of RW_FIELDS) o[k] = this[k];
    return o;
  }
  static fromJSON(src, base) {
    const m = new RewModel(base);
    if (src) for (const [k] of RW_FIELDS) if (typeof src[k] === 'number') m[k] = src[k];
    m.sanitize();
    return m;
  }
  snapshot() { return this.toJSON(); }
}

/** rWx-Spec (Terme) umschließen (validiert über rewardx.sanitizeRwx). */
export class RwxModel {
  constructor(raw) {
    const s = sanitizeRwx(raw);
    this.on = s.on;
    this.terms = s.terms;
  }
  add(kind, extra = {}) {
    if (this.terms.length >= 8) return null;
    const t = Object.assign({ kind, w: 0.5, hard: false }, extra);
    const s = sanitizeRwx({ on: 1, terms: [t] });
    if (!s.terms.length) return null;
    this.terms.push(s.terms[0]);
    this.on = 1;
    return s.terms[0];
  }
  remove(i) { this.terms.splice(i, 1); }
  toJSON() { return { on: this.terms.length ? this.on : 0, terms: this.terms.map((t) => Object.assign({}, t)) }; }
  static fromJSON(src) {
    return new RwxModel(src);
  }
}
