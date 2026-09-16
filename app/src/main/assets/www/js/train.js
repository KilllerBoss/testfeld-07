// ═══════════════════════════════════════════════════════════
// train.js — PPO-Policy-Training, komplett auf der CPU (kein CUDA, keine GPU).
// Kleines MLP (64×64, tanh) mit handgeschriebenem Forward/Backward,
// Adam-Optimierer, GAE, diagonale Gauß-Politik, Laufende Normalisierung.
// Läuft offline im Browser/WebView — das ist der Kern von Trainrobot.
// ═══════════════════════════════════════════════════════════

import { RNG } from './math.js';

// ── Laufende Normalisierung (Welford) ───────────────────────
export class ObsNorm {
  constructor(n) {
    this.n = n;
    this.count = 1e-4;
    this.mean = new Float32Array(n);
    this.M2 = new Float32Array(n).fill(1.0);
    this._std = new Float32Array(n).fill(1.0);
  }
  update(x) {
    // Nicht-endliche Beobachtungen verwerfen (Physik-Explosionen vergiften sonst alles)
    for (let i = 0; i < this.n; i++) if (!Number.isFinite(x[i])) return;
    this.count += 1;
    for (let i = 0; i < this.n; i++) {
      const d = x[i] - this.mean[i];
      this.mean[i] += d / this.count;
      this.M2[i] += d * (x[i] - this.mean[i]);
    }
  }
  stds() {
    for (let i = 0; i < this.n; i++) {
      const v = Math.max(this.M2[i] / this.count, 1e-6);
      this._std[i] = Math.sqrt(v);
    }
    return this._std;
  }
  apply(x, out) {
    const s = this.stds();
    for (let i = 0; i < this.n; i++) out[i] = (x[i] - this.mean[i]) / s[i];
    return out;
  }

  toJSON() { return { mean: Array.from(this.mean), M2: Array.from(this.M2), count: this.count }; }
  static fromJSON(o) {
    const n = new ObsNorm(o.mean.length);
    n.mean.set(o.mean); n.M2.set(o.M2); n.count = o.count;
    return n;
  }
}

// ── Politik-Netz: geteilter Rumpf + Aktions- und Wertkopf ───
class PolicyNet {
  constructor(obsDim, actDim, rng) {
    this.obsDim = obsDim; this.actDim = actDim;
    const H = 64;
    this.H = H;
    // Schichten: obs→H, H→H, H→act (mu), H→1 (Wert)
    this.W1 = this._init(obsDim, H, rng); this.b1 = new Float32Array(H);
    this.W2 = this._init(H, H, rng);      this.b2 = new Float32Array(H);
    this.Wm = this._init(H, actDim, rng, 0.01); this.bm = new Float32Array(actDim);
    this.Wv = this._init(H, 1, rng, 1.0); this.bv = new Float32Array(1);
    this.logStd = new Float32Array(actDim).fill(-0.5);

    // Gradienten
    this._allocGrads();
    // Adam-Zustand
    this._allocAdam();
    // Aktivierungs-Caches
    this.h1 = new Float32Array(H); this.h2 = new Float32Array(H);
    this.mu = new Float32Array(actDim); this.val = 0;
    this.a1 = new Float32Array(H); this.a2 = new Float32Array(H); // pre-aktivierung
  }
  _init(i, o, rng, scale = Math.SQRT2) {
    const w = new Float32Array(i * o);
    const s = scale / Math.sqrt(i);
    for (let k = 0; k < w.length; k++) w[k] = (rng.next() * 2 - 1) * s;
    return w;
  }
  _allocGrads() {
    const H = this.H;
    this.gW1 = new Float32Array(this.W1.length); this.gb1 = new Float32Array(H);
    this.gW2 = new Float32Array(this.W2.length); this.gb2 = new Float32Array(H);
    this.gWm = new Float32Array(this.Wm.length); this.gbm = new Float32Array(this.actDim);
    this.gWv = new Float32Array(this.Wv.length); this.gbv = new Float32Array(1);
    this.gLogStd = new Float32Array(this.actDim);
  }
  _allocAdam() {
    const keys = ['W1','b1','W2','b2','Wm','bm','Wv','bv','logStd'];
    this.adam = {};
    for (const k of keys) this.adam[k] = { m: new Float32Array(this[k].length), v: new Float32Array(this[k].length) };
    this.adamT = 0;
  }
  params() {
    return ['W1','b1','W2','b2','Wm','bm','Wv','bv','logStd'].map(k => this[k]);
  }
  grads() {
    return ['gW1','gb1','gW2','gb2','gWm','gbm','gWv','gbv','gLogStd'].map(k => this[k]);
  }
  paramNames() { return ['W1','b1','W2','b2','Wm','bm','Wv','bv','logStd']; }

  // Vorwärts: liefert mu, Wert; belegt Caches
  forward(x) {
    const { H, obsDim, actDim } = this;
    const W1 = this.W1, b1 = this.b1, W2 = this.W2, b2 = this.b2;
    for (let j = 0; j < H; j++) {
      let s = b1[j]; const off = j * obsDim;
      for (let i = 0; i < obsDim; i++) s += W1[off + i] * x[i];
      this.a1[j] = s; this.h1[j] = Math.tanh(s);
    }
    for (let j = 0; j < H; j++) {
      let s = b2[j]; const off = j * H;
      for (let i = 0; i < H; i++) s += W2[off + i] * this.h1[i];
      this.a2[j] = s; this.h2[j] = Math.tanh(s);
    }
    for (let j = 0; j < actDim; j++) {
      let s = this.bm[j]; const off = j * H;
      for (let i = 0; i < H; i++) s += this.Wm[off + i] * this.h2[i];
      this.mu[j] = s;
    }
    let sv = this.bv[0];
    for (let i = 0; i < H; i++) sv += this.Wv[i] * this.h2[i];
    this.val = sv;
    return this.mu;
  }
}

const LOG2PI = Math.log(2 * Math.PI);

// Endlichkeits-Check (Physik-Explosionen früh erkennen)
export function finiteArr(x) {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
}

// ── PPO-Trainer ─────────────────────────────────────────────
export class PPO {
  /**
   * obsDim, actDim — Raumdimensionen
   * hyper — Hyperparameter (T, gamma, lam, clip, epochs, mb, lr, cV, cE, maxGrad)
   *         + policyOpts: {E} — v2.14.0 Soft-MoE-Expertenanzahl (2–8)
   */
  constructor(obsDim, actDim, hyper = {}, seed = 1234, PolicyClass = PolicyNet) {
    this.obsDim = obsDim; this.actDim = actDim;
    this.h = Object.assign({
      T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2,
      epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5,
    }, hyper);
    this.rng = new RNG(seed);
    this.net = new PolicyClass(obsDim, actDim, this.rng, this.h.policyOpts || null);
    this.norm = new ObsNorm(obsDim);
    this.stepCount = 0;      // Umweltschritte insgesamt
    this.updateCount = 0;    // PPO-Updates
    this._rawBuf = new Float32Array(obsDim); // v2.12.0 Soft-MoE: Router/Style lesen RAW-Kommandos
    this._wBuf = this.net.kind === 'moe' ? new Float32Array(this.net.E) : null;
    this._normBuf = new Float32Array(obsDim);
  }

  /** Routing-Gewichte der letzten act()-Aktion (Soft-MoE) oder null */
  get lastW() { return this._wBuf; }

  // Aktion ziehen (stochastisch) + Log-Wahrscheinlichkeit
  act(x, deterministic = false) {
    const normed = this.norm.apply(x, this._normBuf);
    this._rawBuf.set(x); // v2.12.0 Soft-MoE: unnormalisierte Obs für Router/Style
    const mu = this.net.forward(normed, this._rawBuf);
    if (this._wBuf && this.net.w) this._wBuf.set(this.net.w);
    const act = new Float32Array(this.actDim);
    let logp = 0;
    for (let i = 0; i < this.actDim; i++) {
      const std = Math.exp(this.net.logStd[i]);
      let z;
      if (deterministic) {
        z = 0;
      } else {
        // Box–Muller
        const u1 = Math.max(this.rng.next(), 1e-9), u2 = this.rng.next();
        z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      act[i] = mu[i] + std * z;
      logp += -0.5 * ((act[i] - mu[i]) / std) ** 2 - this.net.logStd[i] - 0.5 * LOG2PI;
    }
    return { act, logp, value: this.net.val };
  }

  // Rollout-Puffer
  _allocBuffer() {
    const T = this.h.T, D = this.obsDim, A = this.actDim;
    this.buf = {
      obs: new Float32Array(T * D),
      act: new Float32Array(T * A),
      logp: new Float32Array(T),
      rew: new Float32Array(T),
      done: new Uint8Array(T),
      val: new Float32Array(T),
      adv: new Float32Array(T),
      ret: new Float32Array(T),
      ptr: 0,
    };
  }

  store(x, act, logp, rew, done, val) {
    if (!this.buf) this._allocBuffer();
    const b = this.buf, T = this.h.T;
    if (b.ptr >= T) return false;
    // v2.7.0 NaN-Wache: nicht-endliche Transitionen NIE in den Puffer
    // schreiben (Physik-Explosion nach Sturz) — ein einziger NaN-Wert
    // würde sonst GAE + Update + Policy komplett vergiften.
    for (let i = 0; i < this.obsDim; i++) if (!Number.isFinite(x[i])) return false;
    for (let i = 0; i < this.actDim; i++) if (!Number.isFinite(act[i])) return false;
    if (!Number.isFinite(logp) || !Number.isFinite(rew) || !Number.isFinite(val)) return false;
    b.obs.set(x, b.ptr * this.obsDim);
    b.act.set(act, b.ptr * this.actDim);
    b.logp[b.ptr] = logp; b.rew[b.ptr] = rew;
    b.done[b.ptr] = done ? 1 : 0; b.val[b.ptr] = val;
    b.ptr++;
    this.stepCount++;
    return b.ptr >= T;
  }

  // GAE(λ) + PPO-Update. Liefert Kennzahlen.
  finishAndUpdate(lastVal) {
    const b = this.buf, T = this.h.T, h = this.h;
    // v2.7.0: nicht-endlicher Endwert (Physik-Explosion beim letzten
    // Schritt) darf den Batch nicht vergiften — neutral bewerten.
    if (!Number.isFinite(lastVal)) lastVal = 0;
    // Advantage: GAE rückwärts
    let gae = 0;
    for (let t = T - 1; t >= 0; t--) {
      const nextNonTerm = b.done[t] ? 0 : 1;
      const nextVal = t === T - 1 ? lastVal : b.val[t + 1];
      const delta = b.rew[t] + h.gamma * nextVal * nextNonTerm - b.val[t];
      gae = delta + h.gamma * h.lam * nextNonTerm * gae;
      b.adv[t] = gae;
      b.ret[t] = gae + b.val[t];
    }
    // v2.7.0: Defensive Wache — sollte GAE trotz allem nicht-endlich sein,
    // wird der Batch verworfen statt die Policy zu töten.
    let gaeOk = true;
    for (let t = 0; t < T; t++) if (!Number.isFinite(b.adv[t])) { gaeOk = false; break; }
    if (!gaeOk) {
      this.buf = null;
      this.updateCount++;
      return { piLoss: 0, vLoss: 0, entropy: 0, clipFrac: 0, meanStd: 0, batchVerworfen: true };
    }
    // Advantages normalisieren
    let mean = 0; for (let t = 0; t < T; t++) mean += b.adv[t]; mean /= T;
    let varr = 0; for (let t = 0; t < T; t++) varr += (b.adv[t] - mean) ** 2; varr = Math.sqrt(varr / T) + 1e-8;
    for (let t = 0; t < T; t++) b.adv[t] = (b.adv[t] - mean) / varr;

    const metrics = this._update(b, this.h.T);
    this.updateCount++;
    this.buf = null;
    return metrics;
  }

  /**
   * v2.10.0 PARALLELES TRAINING: Erfahrungen mehrerer Umgebungen (Sim-Worker)
   * zusammenführen und EIN gemeinsames PPO-Update machen.
   * seg = { obs, act, logp, rew, done, val, lastVal, n } — je Worker-Rollout
   * (on-policy-Schnappschuss der ausgesendeten Gewichtsversion). GAE läuft
   * JEDEM Segment einzeln rückwärts (mit dessen eigenem lastVal), dann
   * global normalisiert und gemischt geupdatet — vektorisiertes PPO.
   */
  mergeSegments(segs) {
    let total = 0;
    for (const s of segs) total += s.n;
    if (!total) return null;
    const D = this.obsDim, A = this.actDim, h = this.h;
    const m = {
      obs: new Float32Array(total * D),
      act: new Float32Array(total * A),
      logp: new Float32Array(total),
      rew: new Float32Array(total),
      done: new Uint8Array(total),
      val: new Float32Array(total),
      adv: new Float32Array(total),
      ret: new Float32Array(total),
    };
    // GAE je Segment (rückwärts), in den gemeinsamen Puffer schreiben
    let off = 0;
    for (const s of segs) {
      const n = s.n;
      const adv = new Float32Array(n);
      let gae = 0;
      for (let t = n - 1; t >= 0; t--) {
        const nextNonTerm = s.done[t] ? 0 : 1;
        const nextVal = t === n - 1 ? s.lastVal : s.val[t + 1];
        const delta = s.rew[t] + h.gamma * nextVal * nextNonTerm - s.val[t];
        gae = delta + h.gamma * h.lam * nextNonTerm * gae;
        adv[t] = gae;
      }
      for (let t = 0; t < n; t++) {
        const k = off + t;
        m.obs.set(s.obs.subarray(t * D, t * D + D), k * D);
        m.act.set(s.act.subarray(t * A, t * A + A), k * A);
        m.logp[k] = s.logp[t]; m.rew[k] = s.rew[t];
        m.done[k] = s.done[t] ? 1 : 0; m.val[k] = s.val[t];
        m.adv[k] = adv[t]; m.ret[k] = adv[t] + s.val[t];
      }
      off += n;
    }
    // Advantages GEMEINSAM normalisieren (über alle Umgebungen)
    let mean = 0; for (let t = 0; t < total; t++) mean += m.adv[t]; mean /= total;
    let varr = 0; for (let t = 0; t < total; t++) varr += (m.adv[t] - mean) ** 2; varr = Math.sqrt(varr / total) + 1e-8;
    for (let t = 0; t < total; t++) m.adv[t] = (m.adv[t] - mean) / varr;

    const metrics = this._update(m, total);
    this.stepCount += total;
    this.updateCount++;
    return metrics;
  }

  _zeroGrads() {
    for (const g of this.net.grads()) g.fill(0);
  }

  _update(b, T) {
    const D = this.obsDim, A = this.actDim;
    const h = this.h, net = this.net;
    const isMoE = net.kind === 'moe';
    const stds = new Float32Array(A);
    for (let i = 0; i < A; i++) stds[i] = Math.exp(net.logStd[i]);

    let piLossSum = 0, vLossSum = 0, entSum = 0, clipFrac = 0;
    // v2.12.0 Soft-MoE: Routing-Statistik (§28/§31)
    const routeSum = isMoE ? new Float64Array(net.E) : null;
    let routeEntSum = 0, routeN = 0;
    const idx = new Int32Array(T);
    for (let t = 0; t < T; t++) idx[t] = t;

    const x = new Float32Array(D);
    const xr = isMoE ? new Float32Array(D) : null;
    const gMuBuf = isMoE ? new Float32Array(A) : null;
    const dH2 = new Float32Array(net.H);
    const dH1 = new Float32Array(net.H);
    const nrmMean = this.norm.mean, nrmStd = this.norm.stds();

    for (let ep = 0; ep < h.epochs; ep++) {
      // Mischen (Fisher–Yates)
      for (let t = T - 1; t > 0; t--) {
        const j = this.rng.int(t + 1);
        const tmp = idx[t]; idx[t] = idx[j]; idx[j] = tmp;
      }
      for (let start = 0; start < T; start += h.mb) {
        const end = Math.min(start + h.mb, T);
        const M = end - start;
        this._zeroGrads();

        for (let mi = start; mi < end; mi++) {
          const t = idx[mi];
          const obsOff = t * D;
          for (let i = 0; i < D; i++) {
            x[i] = (b.obs[obsOff + i] - nrmMean[i]) / nrmStd[i];
          }
          if (isMoE) {
            for (let i = 0; i < D; i++) xr[i] = b.obs[obsOff + i];
            net.forward(x, xr);
          } else {
            net.forward(x);
          }

          // Verhältnis & Clipped-Surrogate — Ratio-Exponent geklemmt,
          // damit extreme Log-Verhältnisse nicht überlaufen (v2.7.0)
          const logpOld = b.logp[t];
          const A_ = b.adv[t];
          let logpNew = 0;
          for (let i = 0; i < A; i++) {
            const a = b.act[t * A + i];
            const d = (a - net.mu[i]) / stds[i];
            logpNew += -0.5 * d * d - Math.log(stds[i]) - 0.5 * LOG2PI;
          }
          const ratio = Math.exp(Math.max(-50, Math.min(50, logpNew - logpOld)));
          const sLoss = -Math.min(ratio * A_, Math.max(1 - h.clip, Math.min(1 + h.clip, ratio)) * A_);
          piLossSum += sLoss / (h.epochs * T);
          const outside = A_ >= 0 ? ratio > 1 + h.clip : ratio < 1 - h.clip;
          if (outside) clipFrac += 1;
          const wPi = outside ? 0 : (-A_ * ratio) / M;   // d(-sur)/dlogp-Kette

          // Wert-Verlust
          const dv = net.val - b.ret[t];
          vLossSum += h.cV * dv * dv / (h.epochs * T);

          // Entropie (diagonal Gauß): H = Σ logσ + 0.5·log2π + 0.5
          for (let i = 0; i < A; i++) entSum += (net.logStd[i] + 0.5 * LOG2PI + 0.5) / (h.epochs * T * A);

          if (isMoE) {
            // v2.12.0 Soft-MoE: Backprop gekapselt im Netz
            for (let i = 0; i < A; i++) {
              const a = b.act[t * A + i];
              gMuBuf[i] = wPi * (a - net.mu[i]) / (stds[i] * stds[i]);
            }
            const wValMoE = h.cV * 2 * dv / M;
            net.accumGrads(gMuBuf, wValMoE);
            for (let i = 0; i < A; i++) {
              const a = b.act[t * A + i];
              const dLogp_dlogStd = ((a - net.mu[i]) ** 2) / (stds[i] * stds[i]) - 1;
              net.glogStd[i] += wPi * dLogp_dlogStd - h.cE / M;
            }
            for (let e = 0; e < net.E; e++) routeSum[e] += net.w[e];
            let rEnt = 0;
            for (let e = 0; e < net.E; e++) if (net.w[e] > 1e-9) rEnt -= net.w[e] * Math.log(net.w[e]);
            routeEntSum += rEnt; routeN++;
          } else {

          dH2.fill(0);
          dH1.fill(0); // v2.7.0 FIX: Rückführungs-Ebene PRO SAMPLE nullen —
                       // davor akkumulierte dH1 über alle Samples/Epochen
                       // (verfälschte W1/b1-Gradientenrichtungen)

          // Kopf: Aktionsmittelwert
          for (let i = 0; i < A; i++) {
            const a = b.act[t * A + i];
            const dLogp_dmu = (a - net.mu[i]) / (stds[i] * stds[i]);
            const gOut = wPi * dLogp_dmu;               // d(-sur)/dmu
            net.gbm[i] += gOut;
            const off = i * net.H;
            for (let j = 0; j < net.H; j++) {
              net.gWm[off + j] += gOut * net.h2[j];
              dH2[j] += gOut * net.Wm[off + j];
            }
          }
          // Kopf: log-Std  (Surrogat + Entropie-Antrieb)
          for (let i = 0; i < A; i++) {
            const a = b.act[t * A + i];
            const dLogp_dlogStd = ((a - net.mu[i]) ** 2) / (stds[i] * stds[i]) - 1;
            net.gLogStd[i] += wPi * dLogp_dlogStd - h.cE / M;
          }
          // Kopf: Wert
          const wVal = h.cV * 2 * dv / M;
          net.gbv[0] += wVal;
          for (let j = 0; j < net.H; j++) {
            net.gWv[j] += wVal * net.h2[j];
            dH2[j] += wVal * net.Wv[j];
          }
          // tanh-Ableitung Ebene 2
          for (let j = 0; j < net.H; j++) dH2[j] *= (1 - net.h2[j] * net.h2[j]);
          // Ebene 2 → 1
          for (let j = 0; j < net.H; j++) {
            const g = dH2[j];
            if (g === 0) continue;
            net.gb2[j] += g;
            const off = j * net.H;
            for (let k = 0; k < net.H; k++) {
              net.gW2[off + k] += g * net.h1[k];
              dH1[k] += g * net.W2[off + k];
            }
          }
          for (let k = 0; k < net.H; k++) dH1[k] *= (1 - net.h1[k] * net.h1[k]);
          // Ebene 1 → Eingang
          for (let j = 0; j < net.H; j++) {
            const g = dH1[j];
            if (g === 0) continue;
            net.gb1[j] += g;
            const off = j * D;
            for (let k = 0; k < D; k++) net.gW1[off + k] += g * x[k];
          }
          } // legacy (PolicyNet)
        }
        this._adamStep();
      }
    }

    const metrics = {
      piLoss: piLossSum,
      vLoss: vLossSum,
      entropy: entSum,
      clipFrac: clipFrac / (h.epochs * T),
      meanStd: stds.reduce((a, c) => a + c, 0) / A,
    };
    if (isMoE) {
      const nAll = h.epochs * T;
      metrics.routeW = Array.from(routeSum, (v) => v / Math.max(1, nAll));
      metrics.routeEnt = routeN ? routeEntSum / routeN : 0;
    }
    return metrics;
  }

  _logpOf(actBuf, t, stds) {
    const net = this.net;
    let lp = 0;
    for (let i = 0; i < this.actDim; i++) {
      const a = actBuf[t * this.actDim + i];
      const d = (a - net.mu[i]) / stds[i];
      lp += -0.5 * d * d - Math.log(stds[i]) - 0.5 * LOG2PI;
    }
    return lp;
  }

  // Adam-Schritt auf einer Teilmenge der Parameter (für BC: ohne Wert-/σ-Köpfe)
  _adamStepPartial(pairs) {
    if (this.net.kind === 'moe') { this.net.adamStep('noStd', this.h.lr, this.h.maxGrad); return; }
    const h = this.h;
    this.net.adamT++;
    const t = this.net.adamT;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    let sq = 0;
    for (const pname of pairs) {
      const G = this.net['g' + pname];
      for (let i = 0; i < G.length; i++) sq += G[i] * G[i];
    }
    const norm = Math.sqrt(sq);
    const scale = norm > h.maxGrad ? h.maxGrad / (norm + 1e-12) : 1;
    for (const pname of pairs) {
      const P = this.net[pname];
      const G = this.net['g' + pname];
      const st = this.net.adam[pname];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] * scale;
        const m = st.m, v = st.v;
        m[i] = b1 * m[i] + (1 - b1) * g;
        v[i] = b2 * v[i] + (1 - b2) * g * g;
        const mh = m[i] / (1 - Math.pow(b1, t));
        const vh = v[i] / (1 - Math.pow(b2, t));
        P[i] -= h.lr * mh / (Math.sqrt(vh) + eps);
      }
    }
  }

  _adamStep() {
    if (this.net.kind === 'moe') { this.net.adamStep('all', this.h.lr, this.h.maxGrad); return; }
    const h = this.h;
    this.net.adamT++;
    const t = this.net.adamT;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    // Paare: [Parameter, Gradient]
    const pairs = [
      ['W1', 'gW1'], ['b1', 'gb1'],
      ['W2', 'gW2'], ['b2', 'gb2'],
      ['Wm', 'gWm'], ['bm', 'gbm'],
      ['Wv', 'gWv'], ['bv', 'gbv'],
      ['logStd', 'gLogStd'],
    ];
    // Gradienten-Clipping (globale Norm)
    let sq = 0;
    for (const [, gName] of pairs) {
      const g = this.net[gName];
      for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
    }
    const norm = Math.sqrt(sq);
    const scale = norm > h.maxGrad ? h.maxGrad / (norm + 1e-12) : 1;
    for (const [pname, gName] of pairs) {
      const P = this.net[pname];
      const G = this.net[gName];
      const st = this.net.adam[pname];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] * scale;
        const m = st.m, v = st.v;
        m[i] = b1 * m[i] + (1 - b1) * g;
        v[i] = b2 * v[i] + (1 - b2) * g * g;
        const mh = m[i] / (1 - Math.pow(b1, t));
        const vh = v[i] / (1 - Math.pow(b2, t));
        P[i] -= h.lr * mh / (Math.sqrt(vh) + eps);
        // logStd in vernünftigen Grenzen halten
        if (pname === 'logStd') P[i] = Math.max(-2.5, Math.min(0.3, P[i]));
      }
    }
  }

  /**
   * Behavior Cloning: überwachtes Mini-Batch-Adam NUR auf dem Aktionskopf
   * (mu) + gemeinsamer Rumpf. X: n×obsDim, Y: n×actDim. Liefert mittleren
   * MSE-Verlust der Epoche.
   */
  bcEpoch(X, Y, n, batchSize = 128) {
    const D = this.obsDim, A = this.actDim, net = this.net;
    const isMoE = net.kind === 'moe';
    let lossSum = 0, batches = 0;
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = this.rng.int(i + 1); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const x = new Float32Array(D);
    const xr = isMoE ? new Float32Array(D) : null;
    const gMuBuf = isMoE ? new Float32Array(A) : null;
    const dH2 = new Float32Array(net.H);
    const dH1 = new Float32Array(net.H);
    const nrmMean = this.norm.mean, nrmStd = this.norm.stds();
    for (let start = 0; start < n; start += batchSize) {
      const end = Math.min(start + batchSize, n);
      const M = end - start;
      this._zeroGrads();
      for (let bi = start; bi < end; bi++) {
        const t = idx[bi];
        for (let i = 0; i < D; i++) x[i] = (X[t * D + i] - nrmMean[i]) / nrmStd[i];
        if (isMoE) {
          // v2.12.0 Soft-MoE: BC über das generische Backprop-Interface
          for (let i = 0; i < D; i++) xr[i] = X[t * D + i];
          net.forward(x, xr);
          let e2 = 0;
          for (let i = 0; i < A; i++) {
            const diff = net.mu[i] - Y[t * A + i];
            e2 += diff * diff;
            gMuBuf[i] = 2 * diff / M;
          }
          lossSum += e2 / A;
          net.accumGrads(gMuBuf, 0);
        } else {
        net.forward(x);
        dH2.fill(0);
        // MSE auf mu: dL/dmu_i = 2(mu_i - y_i)/M
        let e = 0;
        for (let i = 0; i < A; i++) {
          const diff = net.mu[i] - Y[t * A + i];
          e += diff * diff;
          const gOut = 2 * diff / M;
          net.gbm[i] += gOut;
          const off = i * net.H;
          for (let j = 0; j < net.H; j++) {
            net.gWm[off + j] += gOut * net.h2[j];
            dH2[j] += gOut * net.Wm[off + j];
          }
        }
        lossSum += e / A;
        for (let j = 0; j < net.H; j++) dH2[j] *= (1 - net.h2[j] * net.h2[j]);
        for (let j = 0; j < net.H; j++) {
          const g = dH2[j];
          if (g === 0) continue;
          net.gb2[j] += g;
          const off = j * net.H;
          for (let k = 0; k < net.H; k++) {
            net.gW2[off + k] += g * net.h1[k];
            dH1[k] += g * net.W2[off + k];
          }
        }
        for (let k = 0; k < net.H; k++) dH1[k] *= (1 - net.h1[k] * net.h1[k]);
        for (let j = 0; j < net.H; j++) {
          const g = dH1[j];
          if (g === 0) continue;
          net.gb1[j] += g;
          const off = j * D;
          for (let k = 0; k < D; k++) net.gW1[off + k] += g * x[k];
        }
        } // legacy (PolicyNet)
      }
      // Nur Netzparameter (nicht logStd) aktualisieren
      this._adamStepPartial(['W1','b1','W2','b2','Wm','bm']);
      batches++;
    }
    return lossSum / Math.max(1, batches);
  }

  // Deterministische Aktion (für den POLICY-Modus)
  actDeterministic(x, outAct) {
    const normed = this.norm.apply(x, this._normBuf);
    this._rawBuf.set(x); // Soft-MoE: Raw-Kommandos durchreichen
    const mu = this.net.forward(normed, this._rawBuf);
    for (let i = 0; i < this.actDim; i++) outAct[i] = mu[i];
    return outAct;
  }

  toJSON() {
    const net = this.net;
    if (net.kind === 'moe') {
      // v2.12.0 Soft-MoE-Policy
      return {
        fmt: 'trainrobot-ppo-2-moe',
        obsDim: this.obsDim, actDim: this.actDim,
        stepCount: this.stepCount, updateCount: this.updateCount,
        norm: this.norm.toJSON(),
        net: net.toJSON(),
      };
    }
    return {
      fmt: 'trainrobot-ppo-1',
      obsDim: this.obsDim, actDim: this.actDim,
      stepCount: this.stepCount, updateCount: this.updateCount,
      norm: this.norm.toJSON(),
      W1: Array.from(net.W1), b1: Array.from(net.b1),
      W2: Array.from(net.W2), b2: Array.from(net.b2),
      Wm: Array.from(net.Wm), bm: Array.from(net.bm),
      Wv: Array.from(net.Wv), bv: Array.from(net.bv),
      logStd: Array.from(net.logStd),
    };
  }
  static fromJSON(o) {
    const p = new PPO(o.obsDim, o.actDim, {}, 1234);
    const net = p.net;
    net.W1.set(o.W1); net.b1.set(o.b1); net.W2.set(o.W2); net.b2.set(o.b2);
    net.Wm.set(o.Wm); net.bm.set(o.bm); net.Wv.set(o.Wv); net.bv.set(o.bv);
    net.logStd.set(o.logStd);
    p.norm = ObsNorm.fromJSON(o.norm);
    p.stepCount = o.stepCount; p.updateCount = o.updateCount;
    return p;
  }

  /**
   * v2.12.0 Format-agnostisches Laden: 'trainrobot-ppo-1' (MLP 64×64) oder
   * 'trainrobot-ppo-2-moe' (Soft-MoE). Alte Policies bleiben ladbar.
   */
  static fromAny(o) {
    if (!o || typeof o !== 'object') throw new Error('Keine Policy-Daten');
    if (o.fmt === 'trainrobot-ppo-1') return PPO.fromJSON(o);
    if (o.fmt === 'trainrobot-ppo-2-moe') {
      const p = new PPO(o.obsDim, o.actDim, {}, 1234, SoftMoEPolicy);
      p.net = SoftMoEPolicy.fromJSON(o.net);
      p.norm = ObsNorm.fromJSON(o.norm);
      p.stepCount = o.stepCount || 0; p.updateCount = o.updateCount || 0;
      return p;
    }
    throw new Error('Unbekanntes Policy-Format: ' + o.fmt);
  }
}
// Soft-MoE-Politik (MASTER-PROMPT §1/§34)
//   61 Obs → Shared Encoder (128, 128, tanh)
//         → 4 Soft-Experts (Balance · Walk · Turn · Recovery),
//           jedes: h(128) → 64 → 32 (latente Bewegungsrepräsentation)
//         → Soft Router (softmax, mit Kommando-Vorspülung)
//         → Motion Manifold = weiche Mischung (32 D)
//         ⊕ Style-Latent (32 D, Embedding über 6 Styles — v2.7.0: nur
//           'neutral' belegt, weitere sind architektonisch bereit)
//         → Shared Decoder (64, tanh) → 14 Actions
//   + Wertkopf auf dem geteilten Encoder, diagonale Gauß-Politik.
// KEINE harten if/else-Experten — kontinuierliche Mischung (§5).
// ═══════════════════════════════════════════════════════════
export class SoftMoEPolicy {
  constructor(obsDim, actDim, rng, opts = null) {
    this.kind = 'moe';
    this.obsDim = obsDim; this.actDim = actDim;
    if (obsDim < 13) throw new Error('SoftMoE benötigt ≥ 13 Obs (Kommando-Block)');
    this.H = 128; this.RH = 64; this.HL = 64; this.EL = 32; this.SL = 32; this.DH = 64;
    // v2.14.0: Expertenanzahl KI-tunbar (2–8) — 4 = Master-Prompt-Standard
    const Eopt = opts && Number.isFinite(opts.E) ? Math.round(opts.E) : 4;
    this.E = Math.max(2, Math.min(8, Eopt));
    this.NS = 6;
    this.CMD_OFF = obsDim - 13;      // vx,vy,wz, skill×4, style×6
    this.kPrior = 1.2;               // Router-Vorspülung durch Skill-Kommando

    this.pNames = ['W1','b1','W2','b2','Wr1','br1','Wr2','br2',
                   'EW1','Eb1','EW2','Eb2','SE','Wd1','bd1','Wd2','bd2','Wv','bv','logStd'];
    const I = (n, s) => this._init(n, rng, s);
    this.W1 = I(obsDim * this.H, Math.SQRT2 / Math.sqrt(obsDim));
    this.b1 = new Float32Array(this.H);
    this.W2 = I(this.H * this.H, Math.SQRT2 / this.H);
    this.b2 = new Float32Array(this.H);
    this.Wr1 = I(this.RH * (this.H + 4), 0.5 / Math.sqrt(this.H + 4));
    this.br1 = new Float32Array(this.RH);
    this.Wr2 = I(this.E * this.RH, 0.5 / Math.sqrt(this.RH));
    this.br2 = new Float32Array(this.E);
    this.EW1 = I(this.E * this.HL * this.H, Math.SQRT2 / this.H);
    this.Eb1 = new Float32Array(this.E * this.HL);
    this.EW2 = I(this.E * this.EL * this.HL, 0.01 / Math.sqrt(this.HL)); // kleine Ausgänge → mu≈0 am Start
    this.Eb2 = new Float32Array(this.E * this.EL);
    this.SE = I(this.NS * this.SL, 0.05);
    this.Wd1 = I(this.DH * (this.EL + this.SL), Math.SQRT2 / Math.sqrt(this.EL + this.SL));
    this.bd1 = new Float32Array(this.DH);
    this.Wd2 = I(this.actDim * this.DH, 0.01 / Math.sqrt(this.DH));
    this.bd2 = new Float32Array(this.actDim);
    this.Wv = I(this.H, 1.0 / this.H);
    this.bv = new Float32Array(1);
    this.logStd = new Float32Array(actDim).fill(-0.5);

    // Gradienten + Adam
    this.adam = {};
    for (const n of this.pNames) {
      this['g' + n] = new Float32Array(this[n].length);
      this.adam[n] = { m: new Float32Array(this[n].length), v: new Float32Array(this[n].length) };
    }
    this.adamT = 0;

    // Aktivierungs-Caches (für Backprop)
    this.x = new Float32Array(obsDim);
    this.h1 = new Float32Array(this.H); this.h2 = new Float32Array(this.H);
    this.rin = new Float32Array(this.H + 4); this.rh = new Float32Array(this.RH);
    this.logits = new Float32Array(this.E); this.w = new Float32Array(this.E);
    this.eHid = []; this.eLat = [];
    for (let e = 0; e < this.E; e++) { this.eHid.push(new Float32Array(this.HL)); this.eLat.push(new Float32Array(this.EL)); }
    this.mix = new Float32Array(this.EL); this.style = new Float32Array(this.SL);
    this.decIn = new Float32Array(this.EL + this.SL); this.decH = new Float32Array(this.DH);
    this.mu = new Float32Array(actDim); this.val = 0;
    this.cmdSkill = new Float32Array(4); this.sw = new Float32Array(this.NS);

    // Backprop-Scratch
    this._dH2 = new Float32Array(this.H); this._dH1 = new Float32Array(this.H);
    this._dDH = new Float32Array(this.DH); this._dIn = new Float32Array(this.EL + this.SL);
    this._dw = new Float32Array(this.E); this._dE = new Float32Array(this.E * this.EL);
    this._dHL = new Float32Array(this.HL); this._dlog = new Float32Array(this.E);
    this._dRH = new Float32Array(this.RH); this._dRin = new Float32Array(this.H + 4);
  }
  _init(n, rng, s) {
    const w = new Float32Array(n);
    for (let k = 0; k < n; k++) w[k] = (rng.next() * 2 - 1) * s;
    return w;
  }

  /**
   * Vorwärts. xn = normalisierte Obs, raw = UNnormalisierte Obs
   * (Router/Style lesen die echten Kommando-Gewichte).
   * Liefert mu; belegt alle Caches für accumGrads.
   */
  forward(xn, raw) {
    const D = this.obsDim, A = this.actDim, H = this.H, RH = this.RH, HL = this.HL,
          EL = this.EL, SL = this.SL, DH = this.DH, E = this.E, NS = this.NS;
    this.x.set(xn);
    const co = this.CMD_OFF;
    for (let i = 0; i < 4; i++) this.cmdSkill[i] = raw ? Math.max(0, raw[co + 3 + i]) : Math.max(0, xn[co + 3 + i]);
    for (let s = 0; s < NS; s++) this.sw[s] = raw ? Math.max(0, raw[co + 7 + s]) : Math.max(0, xn[co + 7 + s]);
    // Encoder
    for (let j = 0; j < H; j++) {
      let s2 = this.b1[j]; const off = j * D;
      for (let i = 0; i < D; i++) s2 += this.W1[off + i] * xn[i];
      this.h1[j] = Math.tanh(s2);
    }
    for (let j = 0; j < H; j++) {
      let s2 = this.b2[j]; const off = j * H;
      for (let i = 0; i < H; i++) s2 += this.W2[off + i] * this.h1[i];
      this.h2[j] = Math.tanh(s2);
    }
    // Soft Router: [h2 | Skill-Kommando] → 64 → 4 → softmax
    for (let i = 0; i < H; i++) this.rin[i] = this.h2[i];
    for (let i = 0; i < 4; i++) this.rin[H + i] = this.cmdSkill[i];
    for (let j = 0; j < RH; j++) {
      let s2 = this.br1[j]; const off = j * (H + 4);
      for (let k = 0; k < H + 4; k++) s2 += this.Wr1[off + k] * this.rin[k];
      this.rh[j] = Math.tanh(s2);
    }
    let mx = -1e30;
    for (let e = 0; e < E; e++) {
      let s2 = this.br2[e]; const off = e * RH;
      for (let j = 0; j < RH; j++) s2 += this.Wr2[off + j] * this.rh[j];
      s2 += this.kPrior * Math.log(this.cmdSkill[e] + 0.06); // Vorspülung (§5: kontinuierlich)
      this.logits[e] = s2;
      if (s2 > mx) mx = s2;
    }
    let Z = 0;
    for (let e = 0; e < E; e++) { const v = Math.exp(this.logits[e] - mx); this.w[e] = v; Z += v; }
    for (let e = 0; e < E; e++) this.w[e] /= Z;
    // 4 Soft-Experts: h2 → HL → EL
    for (let e = 0; e < E; e++) {
      const h = this.eHid[e], l = this.eLat[e];
      for (let j = 0; j < HL; j++) {
        let s2 = this.Eb1[e * HL + j]; const off = (e * HL + j) * H;
        for (let i = 0; i < H; i++) s2 += this.EW1[off + i] * this.h2[i];
        h[j] = Math.tanh(s2);
      }
      for (let j = 0; j < EL; j++) {
        let s2 = this.Eb2[e * EL + j]; const off = (e * EL + j) * HL;
        for (let i = 0; i < HL; i++) s2 += this.EW2[off + i] * h[i];
        l[j] = Math.tanh(s2);
      }
    }
    // Motion Manifold = weiche Mischung der Experten-Latenze
    for (let k = 0; k < EL; k++) this.mix[k] = 0;
    for (let e = 0; e < E; e++) {
      const we = this.w[e]; if (we < 1e-9) continue;
      const l = this.eLat[e];
      for (let k = 0; k < EL; k++) this.mix[k] += we * l[k];
    }
    // Style-Latent = Embedding-Mischung (§9/§10: stil-abhängig, skill-UNabhängig)
    for (let k = 0; k < SL; k++) this.style[k] = 0;
    for (let s = 0; s < NS; s++) {
      const sw2 = this.sw[s]; if (sw2 < 1e-9) continue;
      const off = s * SL;
      for (let k = 0; k < SL; k++) this.style[k] += sw2 * this.SE[off + k];
    }
    // Shared Decoder: [mix | style] → DH → 14 mu
    for (let k = 0; k < EL; k++) this.decIn[k] = this.mix[k];
    for (let k = 0; k < SL; k++) this.decIn[EL + k] = this.style[k];
    for (let j = 0; j < DH; j++) {
      let s2 = this.bd1[j]; const off = j * (EL + SL);
      for (let k = 0; k < EL + SL; k++) s2 += this.Wd1[off + k] * this.decIn[k];
      this.decH[j] = Math.tanh(s2);
    }
    for (let i = 0; i < A; i++) {
      let s2 = this.bd2[i]; const off = i * DH;
      for (let j = 0; j < DH; j++) s2 += this.Wd2[off + j] * this.decH[j];
      this.mu[i] = s2;
    }
    // Wertkopf auf dem geteilten Encoder
    let sv = this.bv[0];
    for (let i = 0; i < H; i++) sv += this.Wv[i] * this.h2[i];
    this.val = sv;
    return this.mu;
  }

  /**
   * Backprop: dL/dmu (gMu) + dL/dval (wVal) → alle Parameter.
   * Pfad: Decoder → {Experts (gewichtet w_i), Style-Embedding, Router
   * (Softmax-Kette)} → Shared Encoder. Wertkopf direkt auf h2.
   */
  accumGrads(gMu, wVal) {
    const D = this.obsDim, A = this.actDim, H = this.H, RH = this.RH, HL = this.HL,
          EL = this.EL, SL = this.SL, DH = this.DH, E = this.E, NS = this.NS;
    // Decoder-Kopf (mu)
    const dDH = this._dDH; dDH.fill(0);
    for (let i = 0; i < A; i++) {
      const g = gMu[i];
      this.gbd2[i] += g;
      const off = i * DH;
      for (let j = 0; j < DH; j++) { this.gWd2[off + j] += g * this.decH[j]; dDH[j] += g * this.Wd2[off + j]; }
    }
    for (let j = 0; j < DH; j++) dDH[j] *= (1 - this.decH[j] * this.decH[j]);
    // Decoder L1 → decIn (mix | style)
    const dIn = this._dIn; dIn.fill(0);
    for (let j = 0; j < DH; j++) {
      const g = dDH[j]; if (g === 0) continue;
      this.gbd1[j] += g;
      const off = j * (EL + SL);
      for (let k = 0; k < EL + SL; k++) { this.gWd1[off + k] += g * this.decIn[k]; dIn[k] += g * this.Wd1[off + k]; }
    }
    // Style-Embedding: dL/dSE_s = sw_s · dstyle
    for (let s = 0; s < NS; s++) {
      const sw2 = this.sw[s]; if (sw2 === 0) continue;
      const off = s * SL, dOff = EL;
      for (let k = 0; k < SL; k++) this.gSE[off + k] += sw2 * dIn[dOff + k];
    }
    // Routing-Gewichts-Gradienten + Expertengradiente (gewichtet w_i)
    const dMix = this._dIn; // Aliasing: dIn[0..EL) == dMix
    const dw = this._dw; dw.fill(0);
    const dH2 = this._dH2; dH2.fill(0);
    const dE = this._dE;
    for (let e = 0; e < E; e++) {
      let acc = 0;
      const l = this.eLat[e];
      for (let k = 0; k < EL; k++) acc += dMix[k] * l[k];
      dw[e] = acc;
      const we = this.w[e]; if (we === 0) continue;
      // Expert-Backprop: EL → HL → h2
      const dHL = this._dHL; dHL.fill(0);
      for (let j = 0; j < EL; j++) {
        const g0 = we * dMix[j]; if (g0 === 0) continue;
        this.gEb2[e * EL + j] += g0;
        const dt = g0 * (1 - l[j] * l[j]);
        const off = (e * EL + j) * HL, h = this.eHid[e];
        for (let k = 0; k < HL; k++) { this.gEW2[off + k] += dt * h[k]; dHL[k] += dt * this.EW2[off + k]; }
      }
      for (let k = 0; k < HL; k++) {
        const g = dHL[k]; if (g === 0) continue;
        this.gEb1[e * HL + k] += g;
        const dt = g * (1 - this.eHid[e][k] * this.eHid[e][k]);
        if (dt === 0) continue;
        const off = (e * HL + k) * H;
        for (let i = 0; i < H; i++) { this.gEW1[off + i] += dt * this.h2[i]; dH2[i] += dt * this.EW1[off + i]; }
      }
    }
    // Softmax-Rückwärts: dlogit_e = w_e·(dw_e − Σ_j w_j·dw_j)
    let dot = 0;
    for (let e = 0; e < E; e++) dot += this.w[e] * dw[e];
    const dlog = this._dlog;
    for (let e = 0; e < E; e++) dlog[e] = this.w[e] * (dw[e] - dot);
    // Router L2 (E × RH)
    const dRH = this._dRH; dRH.fill(0);
    for (let e = 0; e < E; e++) {
      const g = dlog[e];
      this.gbr2[e] += g;
      const off = e * RH;
      for (let j = 0; j < RH; j++) { this.gWr2[off + j] += g * this.rh[j]; dRH[j] += g * this.Wr2[off + j]; }
    }
    for (let j = 0; j < RH; j++) dRH[j] *= (1 - this.rh[j] * this.rh[j]);
    // Router L1 (RH × (H+4)) → dh2-Anteil
    const dRin = this._dRin; dRin.fill(0);
    for (let j = 0; j < RH; j++) {
      const g = dRH[j]; if (g === 0) continue;
      this.gbr1[j] += g;
      const off = j * (H + 4);
      for (let k = 0; k < H + 4; k++) { this.gWr1[off + k] += g * this.rin[k]; dRin[k] += g * this.Wr1[off + k]; }
    }
    for (let i = 0; i < H; i++) dH2[i] += dRin[i];
    // Wertkopf
    if (wVal !== 0) {
      this.gbv[0] += wVal;
      for (let i = 0; i < H; i++) { this.gWv[i] += wVal * this.h2[i]; dH2[i] += wVal * this.Wv[i]; }
    }
    // Encoder L2 → L1 → Eingang
    const dH1 = this._dH1; dH1.fill(0);
    for (let j = 0; j < H; j++) {
      const g = dH2[j]; if (g === 0) continue;
      this.gb2[j] += g;
      const dt = g * (1 - this.h2[j] * this.h2[j]);
      if (dt === 0) continue;
      const off = j * H;
      for (let k = 0; k < H; k++) { this.gW2[off + k] += dt * this.h1[k]; dH1[k] += dt * this.W2[off + k]; }
    }
    for (let j = 0; j < H; j++) {
      const dt = dH1[j] * (1 - this.h1[j] * this.h1[j]);
      if (dt === 0) continue;
      this.gb1[j] += dt;
      const off = j * D;
      for (let k = 0; k < D; k++) this.gW1[off + k] += dt * this.x[k];
    }
  }

  zeroGrads() { for (const n of this.pNames) this['g' + n].fill(0); }

  /** PPO-Kompatibilität (PPO._zeroGrads nutzt net.grads()) */
  grads() { return this.pNames.map(n => this['g' + n]); }
  params() { return this.pNames.map(n => this[n]); }

  /** Adam-Schritt. mode: 'all' | 'noStd' (BC). Globale Norm-Clipping wie PolicyNet. */
  adamStep(mode = 'all', lr = 3e-4, maxGrad = 0.5) {
    const names = mode === 'noStd' ? this.pNames.filter(n => n !== 'logStd') : this.pNames;
    this.adamT++;
    const t = this.adamT, b1 = 0.9, b2 = 0.999, eps = 1e-8;
    let sq = 0;
    for (const n of names) { const g = this['g' + n]; for (let i = 0; i < g.length; i++) sq += g[i] * g[i]; }
    const norm = Math.sqrt(sq);
    const scale = norm > maxGrad ? maxGrad / (norm + 1e-12) : 1;
    for (const n of names) {
      const P = this[n], G = this['g' + n], st = this.adam[n];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] * scale;
        st.m[i] = b1 * st.m[i] + (1 - b1) * g;
        st.v[i] = b2 * st.v[i] + (1 - b2) * g * g;
        const mh = st.m[i] / (1 - Math.pow(b1, t));
        const vh = st.v[i] / (1 - Math.pow(b2, t));
        P[i] -= lr * mh / (Math.sqrt(vh) + eps);
      }
    }
    for (let i = 0; i < this.logStd.length; i++) this.logStd[i] = Math.max(-2.5, Math.min(0.3, this.logStd[i]));
  }

  /** Stochastische Aktion (Worker-Seite, norm extern angewendet) */
  sample(xn, raw, rng, deterministic = false) {
    this.forward(xn, raw);
    const A = this.actDim;
    const act = new Float32Array(A); let logp = 0;
    for (let i = 0; i < A; i++) {
      const std = Math.exp(this.logStd[i]);
      let z = 0;
      if (!deterministic) {
        const u1 = Math.max(rng.next(), 1e-9), u2 = rng.next();
        z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      act[i] = this.mu[i] + std * z;
      logp += -0.5 * ((act[i] - this.mu[i]) / std) ** 2 - this.logStd[i] - 0.5 * LOG2PI;
    }
    return { act, logp, value: this.val, w: this.w };
  }

  paramCount() {
    let s = 0;
    for (const n of this.pNames) s += this[n].length;
    return s;
  }

  toJSON() {
    const o = {
      fmt: 'softmoe-1',
      obsDim: this.obsDim, actDim: this.actDim,
      H: this.H, RH: this.RH, HL: this.HL, EL: this.EL, SL: this.SL, DH: this.DH,
      E: this.E, NS: this.NS, kPrior: this.kPrior,
    };
    for (const n of this.pNames) o[n] = Array.from(this[n]);
    return o;
  }
  static fromJSON(src) {
    const p = new SoftMoEPolicy(src.obsDim, src.actDim, new RNG(1), { E: src.E });
    for (const n of p.pNames) {
      if (!src[n]) throw new Error('SoftMoE-Feld fehlt: ' + n);
      p[n].set(src[n]);
    }
    return p;
  }

  /** Parameter IN PLACE aus dem seriellen Format übernehmen (Sim-Worker) */
  applyFromJSON(src) {
    for (const n of this.pNames) {
      if (!src[n]) throw new Error('SoftMoE-Feld fehlt: ' + n);
      this[n].set(src[n]);
    }
  }
}
