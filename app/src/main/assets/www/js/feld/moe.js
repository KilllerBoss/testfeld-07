// ═══════════════════════════════════════════════════════════
// feld/moe.js — Soft-MoE-LLN-Policy mit STUFEN-Freiheit
//
// Baut auf train.js SoftMoEPolicy auf (forward/backprop/Adam sind
// dort erprobt) und ergibt die 3 Trainingsstufen des Feld-Plans:
//
//   Stufe 1 „Experten"      : Encoder + Experten + Decoder (+ Wert/σ)
//   Stufe 2 „Router"        : NUR Router (+ Wert/σ), Rest FROST
//   Stufe 3 „Feinabstimmung": alles offen, kleinere LR, sanfte Übergänge
//
// Parametergruppen: encoder · router · experts · decoder · style · value · std
// (value/std laufen in allen Stufen mit — GAE braucht den Wert.)
// ═══════════════════════════════════════════════════════════

export const PARAM_GROUPS = {
  encoder: ['W1', 'b1', 'W2', 'b2'],
  router: ['Wr1', 'br1', 'Wr2', 'br2'],
  experts: ['EW1', 'Eb1', 'EW2', 'Eb2'],
  decoder: ['Wd1', 'bd1', 'Wd2', 'bd2'],
  style: ['SE'],
  value: ['Wv', 'bv'],
  std: ['logStd'],
};

/** Stufe → trainierte Gruppen (value/std immer dabei). */
export const STAGE_GROUPS = {
  1: ['encoder', 'experts', 'decoder'],
  2: ['router'],
  3: ['encoder', 'router', 'experts', 'decoder', 'style'],
};

/** Stufe → Lernraten-Faktor (Stufe 3: sanfte Feinabstimmung). */
export const STAGE_LR = { 1: 1.0, 2: 1.0, 3: 0.25 };

/** Stufe → zusätzliche Übergangs-Glättung (rW.route/rW.smooth Multiplikator). */
export const STAGE_SMOOTH = { 1: 1.0, 2: 1.0, 3: 3.0 };

export class FeldMoE {
  /**
   * Umschließt eine SoftMoEPolicy-Instanz (aus train.js) mit
   * Gruppen-Freiheit. Der Basis-Adam-Zustand wird WIEDERVERWENDET.
   * @param {import('../train.js').SoftMoEPolicy} net
   */
  constructor(net) {
    if (!net || net.kind !== 'moe') throw new Error('FeldMoE erwartet eine SoftMoEPolicy');
    this.net = net;
    this.stage = 1;
    this.groupNames = Object.keys(PARAM_GROUPS);
    this._maxGrad = 0.5;
    // Adressbuch: Gruppenname → [{param, grad, adam}, …]
    this._groups = {};
    for (const g of this.groupNames) {
      this._groups[g] = PARAM_GROUPS[g].map((n) => ({
        p: net[n], g: net['g' + n], st: net.adam[n],
      }));
    }
  }

  get E() { return this.net.E; }
  get obsDim() { return this.net.obsDim; }
  get actDim() { return this.net.actDim; }

  /** Aktive Gruppen der aktuellen Stufe (value/std immer dabei). */
  activeGroups(stage = this.stage) {
    const base = STAGE_GROUPS[stage] || STAGE_GROUPS[1];
    return base.concat(['value', 'std']);
  }

  groupActive(g, stage = this.stage) {
    return this.activeGroups(stage).includes(g);
  }

  /**
   * Adam-Schritt NUR auf den aktiven Gruppen der Stufe.
   * Identische Mathematik wie SoftMoEPolicy.adamStep, aber gruppiert.
   */
  stepGroups(lr, stage = this.stage) {
    const n = this.net;
    const names = this.activeGroups(stage)
      .flatMap((g) => PARAM_GROUPS[g])
      .filter((name) => n.pNames.includes(name));
    n.adamT++;
    const t = n.adamT, b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const eff = lr * (STAGE_LR[stage] || 1);
    let sq = 0;
    for (const name of names) { const g = n['g' + name]; for (let i = 0; i < g.length; i++) sq += g[i] * g[i]; }
    const norm = Math.sqrt(sq);
    const scale = norm > this._maxGrad ? this._maxGrad / (norm + 1e-12) : 1;
    for (const name of names) {
      const P = n[name], G = n['g' + name], st = n.adam[name];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] * scale;
        st.m[i] = b1 * st.m[i] + (1 - b1) * g;
        st.v[i] = b2 * st.v[i] + (1 - b2) * g * g;
        const mh = st.m[i] / (1 - Math.pow(b1, t));
        const vh = st.v[i] / (1 - Math.pow(b2, t));
        P[i] -= eff * mh / (Math.sqrt(vh) + eps);
      }
    }
    // σ-Klemme (wie Basis)
    for (let i = 0; i < n.logStd.length; i++) n.logStd[i] = Math.max(-2.5, Math.min(0.3, n.logStd[i]));
    return { updated: names.length, lr: eff, gradNorm: norm };
  }

  /** Frost-Fingerprint: ändert sich NICHT, solange Gruppen eingefroren sind. */
  groupFingerprint(groupNames) {
    let h = 0;
    for (const g of groupNames) {
      for (const name of PARAM_GROUPS[g]) {
        const P = this.net[name];
        for (let i = 0; i < P.length; i++) h = (Math.imul(h, 31) + ((P[i] * 1e6) | 0)) | 0;
      }
    }
    return h;
  }
}
