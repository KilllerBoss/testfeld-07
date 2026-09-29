// ═══════════════════════════════════════════════════════════
// feld/trainer.js — PPO-Training mit 3 STUFEN + adaptive TRICKS
//
// Rollout-Semantik 1:1 aus simworker.js runSegment (erprobt):
//   observe → norm.update → act → setRouting → actionToCtrl →
//   sim.stepN → reward → store → afterAct → Reset bei done
//
// STUFEN (Feld-Plan):
//   1 „Experten"       — Encoder+Experten+Decoder (Router friert)
//   2 „Router"         — nur Router, Experten EINGEFROREN
//   3 „Feinabstimmung" — alles offen, LR ×0.25, Übergangs-Glättung ×3
//
// TRICKS (selbstanpassend je Erfolg, alle abschaltbar):
//   autoLr      — Lernrate wächst bei steigendem, schrumpft bei
//                 fallendem Episoden-Erfolg (EMA-Trend)
//   autoRollout — Rollout-Länge T wächst bei Erfolg, schrumpft bei
//                 Misserfolg (512 … 4096)
//   autoNoise   — Explorations-σ: mehr Rauschen bei Misserfolg,
//                 weniger bei Erfolg (konservativ, gebremst)
// ═══════════════════════════════════════════════════════════

import { PPO, SoftMoEPolicy, finiteArr } from '../train.js';
import { FeldMoE, STAGE_SMOOTH, STAGE_LR } from './moe.js';
import { RNG } from '../math.js';

const CTRL_DT = 0.02;

export const DEFAULT_HYPER = {
  T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2,
  epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5,
  E: 4, substeps: 10,
};

export const DEFAULT_TRICKS = {
  on: true,
  autoLr: true,
  autoRollout: true,
  autoNoise: true,
  lrMin: 6e-5, lrMax: 1.2e-3,
  TMin: 512, TMax: 4096,
  noiseMin: -1.8, noiseMax: -0.15,
  trendWin: 3,       // Updates für den Trend
  lrGrow: 1.06, lrShrink: 0.7,
  tGrow: 1.5, tShrink: 0.6,
  noiseUp: 0.04, noiseDown: 0.03,
};

export class FeldTrainer {
  /**
   * @param task   Task-Objekt (makeDuckMoeTask)
   * @param sim    RobotSim
   * @param opts   { hyper, tricks, seed, rWBase }
   */
  constructor(task, sim, opts = {}) {
    this.task = task;
    this.sim = sim;
    this.hyper = Object.assign({}, DEFAULT_HYPER, opts.hyper || {});
    this.tricks = Object.assign({}, DEFAULT_TRICKS, opts.tricks || {});
    this.rWBase = opts.rWBase || null; // RewModel (für Stufe-3-Glättung)
    this.stage = 1;
    this.rng = new RNG(opts.seed || 20260929);
    this.ppo = new PPO(task.obsDim, task.actDim, {
      T: this.hyper.T, gamma: this.hyper.gamma, lam: this.hyper.lam,
      clip: this.hyper.clip, epochs: this.hyper.epochs, mb: this.hyper.mb,
      lr: this.hyper.lr, cV: this.hyper.cV, cE: this.hyper.cE,
      maxGrad: this.hyper.maxGrad,
      // v3.6.0: ABS-Kommandomodus des Duck-Tasks (cmdOff = Router-Slice);
      // undefined bei anderen Tasks → Legacy-Trailing-Layout.
      policyOpts: { E: this.hyper.E, cmdOff: task.cmdOff },
    }, opts.seed || 20260929, SoftMoEPolicy);
    this.moe = new FeldMoE(this.ppo.net);
    // STUFEN-FREIHEIT: PPO._update macht Adam-Schritte je Minibatch —
    // wir leiten sie durch die Stufen-Freiheit von FeldMoE (identische
    // Adam-Mathematik, aber nur die aktiven Gruppen der Stufe).
    const self = this;
    this.ppo._adamStep = function () { self.moe.stepGroups(self.hyper.lr, self.stage); };

    // Rollout-Zustand
    this._obs = new Float32Array(task.obsDim);
    this._epR = 0;
    this.episodes = 0;
    this.lastEpReward = 0;
    this.epRewards = [];
    this.updates = 0;
    this.lastMetrics = null;

    // Erfolgsgedächtnis (Trend über Updates)
    this.emaEpR = 0;
    this.trendHist = [];
    this._downStreak = 0;
  }

  setStage(s) {
    s = Math.max(1, Math.min(3, Math.round(s)));
    this.stage = s;
    this.moe.stage = s;
    // Stufe 3: Übergangs-Glättung im Task-Belohnungsmodell hochziehen
    if (this.task && this.task.cfg && this.rWBase) {
      const sm = STAGE_SMOOTH[s] || 1;
      this.task.cfg.rW.route = this.rWBase.route * sm;
      this.task.cfg.rW.smooth = this.rWBase.smooth * sm;
    }
    return s;
  }

  /** Eine Episode hart neu starten (Start-Button / Stufenwechsel). */
  resetAll() {
    this.sim.reset();
    this.task.reset(this.rng, this.sim);
    this._epR = 0;
  }

  /** ∙ Tricks: einmal JE PPO-Update aufrufen. Liefert Statuszeile. */
  _applyTricks(metrics) {
    const t = this.tricks;
    if (!t.on) return { lr: this.hyper.lr, T: this.hyper.T, std: this._meanStd() };
    // Erfolgstrend: normierte Änderung des Episoden-EMA je Update
    let trend = 0;
    if (this.emaEpR > 1e-6) {
      this.trendHist.push(this.emaEpR);
      if (this.trendHist.length > t.trendWin + 1) this.trendHist.shift();
      if (this.trendHist.length === t.trendWin + 1) {
        const a = this.trendHist[0], b = this.trendHist[this.trendHist.length - 1];
        trend = (b - a) / Math.max(1e-6, Math.abs(a));
      }
    }
    // — autoLr —
    if (t.autoLr) {
      if (trend > 0.005) this.hyper.lr = Math.min(t.lrMax, this.hyper.lr * t.lrGrow);
      else if (trend < 0) {
        this._downStreak++;
        if (this._downStreak >= 2) { this.hyper.lr = Math.max(t.lrMin, this.hyper.lr * t.lrShrink); this._downStreak = 0; }
      } else this._downStreak = 0;
    }
    // — autoRollout —
    if (t.autoRollout) {
      if (trend > 0.01) {
        const nt = Math.min(t.TMax, Math.round(this.hyper.T * t.tGrow));
        if (nt !== this.hyper.T) { this.hyper.T = nt; this.ppo.h.T = nt; this.ppo.buf = null; }
      } else if (trend < 0) {
        const nt = Math.max(t.TMin, Math.round(this.hyper.T * t.tShrink));
        if (nt !== this.hyper.T) { this.hyper.T = nt; this.ppo.h.T = nt; this.ppo.buf = null; }
      }
    }
    // — autoNoise —
    const n = this.ppo.net;
    if (t.autoNoise && metrics) {
      if (metrics.clipFrac > 0.35) {
        // Update war zu groß: Rauschen leicht senken (stabilisieren)
        for (let i = 0; i < n.logStd.length; i++) n.logStd[i] -= t.noiseDown * 0.5;
      } else if (trend < 0) {
        for (let i = 0; i < n.logStd.length; i++) n.logStd[i] += t.noiseUp;   // mehr Exploration
      } else if (trend > 0.01) {
        for (let i = 0; i < n.logStd.length; i++) n.logStd[i] -= t.noiseDown; // Erfolg: ruhiger
      }
      for (let i = 0; i < n.logStd.length; i++) n.logStd[i] = Math.max(t.noiseMin, Math.min(t.noiseMax, n.logStd[i]));
    }
    return { lr: this.hyper.lr, T: this.hyper.T, std: this._meanStd(), trend };
  }

  _meanStd() {
    const s = this.ppo.net.logStd;
    let a = 0; for (let i = 0; i < s.length; i++) a += Math.exp(s[i]);
    return a / s.length;
  }

  /**
   * Genau EIN Umgebungsschritt (Referenz: simworker runSegment).
   * @returns {boolean} true, wenn ein PPO-Update fällig war und lief
   */
  stepOnce() {
    const task = this.task, sim = this.sim, ppo = this.ppo;
    const A = task.actDim;
    if (task.stepsLeft <= 0 && task.sampleCmd) task.sampleCmd(ppo.rng);
    task.observe(sim, this._obs);
    if (!finiteArr(this._obs)) {
      sim.reset(); task.reset(ppo.rng, sim);
      this._epR = 0;
      return false;
    }
    ppo.norm.update(this._obs);
    const a = ppo.act(this._obs, false);
    if (task.setRouting && ppo.lastW) task.setRouting(ppo.lastW);
    task.actionToCtrl(sim, a.act);
    sim.stepN(this.hyper.substeps);
    // v3.2.0: PER-ZYKLUS-HAKEN — Handy-Schubser + beweglicher Boden
    // (feld.js setzt onStep; läuft je Regelzyklus, VOR dem Reward, damit
    // die Belohnung die Störung schon sieht — wie bei den DR-Schüben).
    if (this.onStep) {
      try { this.onStep(CTRL_DT * this.hyper.substeps); } catch (e) { /* bricht nie das Training */ }
    }
    let { r, done: dn } = task.reward(sim);
    for (let i = 0; i < A; i++) task.lastAct[i] = a.act[i];
    if (task.afterAct) task.afterAct(sim, a.act);
    this._epR += r;
    const full = ppo.store(this._obs, a.act, a.logp, r, dn, a.value);
    if (dn) {
      this.episodes++;
      this.lastEpReward = this._epR;
      this.epRewards.push(this._epR);
      if (this.epRewards.length > 64) this.epRewards.shift();
      this._epR = 0;
      sim.reset();
      task.reset(ppo.rng, sim);
    }
    if (!full) return false;
    // ── PPO-Update (GAE + gepolstertes Update, Stufen-Freiheit) ──
    task.observe(sim, this._obs);
    let lastVal = ppo.act(this._obs, true).value;
    if (!Number.isFinite(lastVal)) lastVal = 0;
    const metrics = ppo.finishAndUpdate(lastVal);
    this.updates++;
    this.lastMetrics = metrics;
    // Erfolgsgedächtnis (EMA über Episoden-Rewards)
    const er = this.epRewards.length ? this.epRewards[this.epRewards.length - 1] : this.lastEpReward;
    this.emaEpR = this.emaEpR ? this.emaEpR * 0.9 + er * 0.1 : er;
    metrics.trickInfo = this._applyTricks(metrics);
    return true;
  }

  /** Budgetierter Trainingsschub (rAF-freundlich). */
  pump(budgetSteps = 60) {
    let didUpdate = false;
    for (let i = 0; i < budgetSteps; i++) {
      if (this.stepOnce()) didUpdate = true;
    }
    return didUpdate;
  }

  /** Stochastische Aktion im Live-Modus (ohne Speichern). */
  actLive(obsBuf, deterministic = false) {
    this.ppo.norm.update(obsBuf);
    return this.ppo.act(obsBuf, deterministic);
  }

  /** Parameterzähler für die UI. */
  paramCount() { return this.ppo.net.paramCount(); }
}
