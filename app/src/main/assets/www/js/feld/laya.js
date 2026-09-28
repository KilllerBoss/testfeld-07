// ═══════════════════════════════════════════════════════════
// feld/laya.js — LAYA-ROUTER (System 1) für Stufe 3
//
// Laya (Convai Innovations, Apache 2.0) ist das offene, nicht-
// autoregressive „System 1"-Entscheidungsmodell als Alternative
// zu TypeSafes geschlossenem Jev: Es generiert KEINEN Text,
// sondern liefert in EINEM parallelen Pass eine GETYPTE
// Entscheidung mit kalibrierter Wahrscheinlichkeit.
//
// Genau das macht der Router in Stufe 3: aus dem Zustand wird in
// EINEM Pass die Skill-Entscheidung {balance | walk | turn |
// recover} + kalibrierte Wahrscheinlichkeit gewählt — ohne
// Sprachmodell, ohne Sequenz, ohne Latenz.
//
// Zwei Modi:
//   'builtin' — eingebettetes System-1-Scoring (immer verfügbar,
//               deterministisch, kalibriert über eine Temperatur)
//   'onnx'    — Import-Hook für ein echtes Laya-/Jev-kompatibles
//               Entscheidungs-ONNX (Eingabe 7 Zustandswerte,
//               Ausgabe 4 Logits — siehe feld-spec in der App)
// ═══════════════════════════════════════════════════════════

import { RNG } from '../math.js';

export const LAYA_SKILLS = ['balance', 'walk', 'turn', 'recover'];

/** Zustand → 7 Laya-Eingabewerte (deterministische Skala). */
export function layaInput(s) {
  return [
    s.upz,                                   // Aufrecht
    Math.max(-1, Math.min(1, s.vFwd / 0.3)), // Vorwärts-Tempo (normiert)
    Math.max(-1, Math.min(1, s.yawRate / 1.0)),
    Math.max(0, Math.min(1, s.cmdVx / 0.3)),
    Math.max(-1, Math.min(1, s.cmdWz / 1.0)),
    s.fallen ? 1 : 0,
    Math.max(0, Math.min(1, s.hGTol / 0.2)), // Höhe unter Soll (Fortschritt-Druck)
  ];
}

export class LayaRouter {
  constructor(opts = {}) {
    this.mode = opts.mode || 'builtin'; // 'builtin' | 'onnx'
    this.temp = fin(opts.temp, 1.6);    // Kalibrierung (höher = entschiedener)
    this.hyst = fin(opts.hyst, 0.08);   // Entscheidungstraegheit
    this._lastIdx = 0;
    this._rng = new RNG(opts.seed || 777);
    this.session = null;                // ORT-Session (onnx-Modus)
    this.decisions = 0;
  }

  /**
   * EIN paralleler Pass: Zustand → getypte Entscheidung.
   * @param s {upz, vFwd, yawRate, cmdVx, cmdWz, fallen, hGTol}
   * @returns {skill, p, w[4]} — w = Skill-Hinweis (0…1, kalibriert)
   */
  decide(s) {
    this.decisions++;
    if (this.mode === 'onnx' && this.session) {
      return this._decideOnnx(s);
    }
    return this._decideBuiltin(s);
  }

  _decideBuiltin(s) {
    // Scoring (ein Pass, keine Sequenz): je Skill ein logistischer Score
    const logits = [
      2.2 * (s.upz - 0.72) - 1.6 * Math.min(1, Math.abs(s.cmdVx) / 0.2),
      2.6 * Math.min(1, Math.abs(s.cmdVx) / 0.12) + 0.4 * Math.min(1, Math.max(0, s.vFwd) / 0.15),
      2.4 * Math.min(1, Math.abs(s.cmdWz) / 0.45) + 0.3 * Math.min(1, Math.abs(s.yawRate) / 0.9),
      -7.0 * (s.upz - 0.55),
    ];
    return this._softmaxTyped(logits);
  }

  _softmaxTyped(logits) {
    const mx = Math.max(...logits);
    const ex = logits.map((l) => Math.exp((l - mx) * this.temp));
    const Z = ex.reduce((a, b) => a + b, 0);
    const w = ex.map((v) => v / Z);
    // Hysterese: ein geführter Skill bleibt, solange er nicht klar fällt
    let di = 0;
    for (let i = 1; i < 4; i++) if (w[i] > w[di]) di = i;
    if (di !== this._lastIdx && w[this._lastIdx] > w[di] - this.hyst) di = this._lastIdx;
    this._lastIdx = di;
    return { skill: LAYA_SKILLS[di], p: w[di], w };
  }

  /** ONNX-Hook: Session übergeben (feld/onnxexport liefert ORT). */
  async attachSession(session) {
    this.session = session || null;
    this.mode = session ? 'onnx' : 'builtin';
  }

  _decideOnnx(s) {
    // Der synchrone Pfad nutzt immer 'builtin'; ein ONNX-Router läuft
    // ausschließlich über decideAsync() (Session-Run ist asynchron).
    return this._decideBuiltin(s);
  }

  /** Asynchrone Variante für ONNX (Session-Run). */
  async decideAsync(s, ort) {
    if (this.mode === 'onnx' && this.session && ort) {
      const x = layaInput(s);
      const t = new ort.Tensor('float32', Float32Array.from(x), [1, 7]);
      const out = await this.session.run({ x: t });
      const l = out.logits || out[Object.keys(out)[0]];
      const logits = Array.from(l.data);
      return this._softmaxTyped(logits);
    }
    return this._decideBuiltin(s);
  }

  /** Skill-Hinweis → 4er-Kommandogewichte (Task-HINT-Skala). */
  hintW(w) {
    // Richtung zu setUserCmd/_setCmd-Konvention [balance, walk, turn, recover]
    return [w[0], w[1], w[2], w[3]];
  }

  toJSON() { return { mode: this.mode, temp: this.temp, hyst: this.hyst }; }
  static fromJSON(src) {
    return new LayaRouter(src || {});
  }
}

function fin(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
