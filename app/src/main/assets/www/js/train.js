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
   */
  constructor(obsDim, actDim, hyper = {}, seed = 1234) {
    this.obsDim = obsDim; this.actDim = actDim;
    this.h = Object.assign({
      T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2,
      epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5,
    }, hyper);
    this.rng = new RNG(seed);
    this.net = new PolicyNet(obsDim, actDim, this.rng);
    this.norm = new ObsNorm(obsDim);
    this.stepCount = 0;      // Umweltschritte insgesamt
    this.updateCount = 0;    // PPO-Updates
    this._normBuf = new Float32Array(obsDim);
  }

  // Aktion ziehen (stochastisch) + Log-Wahrscheinlichkeit
  act(x, deterministic = false) {
    const normed = this.norm.apply(x, this._normBuf);
    const mu = this.net.forward(normed);
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
    const stds = new Float32Array(A);
    for (let i = 0; i < A; i++) stds[i] = Math.exp(net.logStd[i]);

    let piLossSum = 0, vLossSum = 0, entSum = 0, clipFrac = 0;
    const idx = new Int32Array(T);
    for (let t = 0; t < T; t++) idx[t] = t;

    const x = new Float32Array(D);
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
          net.forward(x);

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
        }
        this._adamStep();
      }
    }

    return {
      piLoss: piLossSum,
      vLoss: vLossSum,
      entropy: entSum,
      clipFrac: clipFrac / (h.epochs * T),
      meanStd: stds.reduce((a, c) => a + c, 0) / A,
    };
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
    let lossSum = 0, batches = 0;
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = this.rng.int(i + 1); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const x = new Float32Array(D);
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
    const mu = this.net.forward(normed);
    for (let i = 0; i < this.actDim; i++) outAct[i] = mu[i];
    return outAct;
  }

  toJSON() {
    const net = this.net;
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
}
