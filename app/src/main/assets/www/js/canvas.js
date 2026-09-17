// ═══════════════════════════════════════════════════════════
// canvas.js — NETZ-CANVAS (v2.17.0)
// Node-Editor für Roboter-Architekturen: Links alle Sensor-Eingänge
// des Roboters (einzeln), rechts alle Aktuator-Ausgänge (einzeln),
// dazwischen frei baubare Policy-Karten (eigene Eingaben/Ausgaben/
// Hidden-Layer/Neuronen) mit KABELN verbindbar. Jede Karte trainiert
// mit eigenem PPO — entweder auf der GLOBALEN Aufgaben-Belohnung
// oder auf einer KARTEIGENEN Belohnungs-/Bestrafungs-Formel.
// Damit lassen sich z. B. Router über trainierte Policies bauen:
// der Router lernt, die darunterliegenden (eingefrorenen) Policies
// zu steuern. Gemini hat vollen Zugriff (canvasGraph/canvasReward/
// canvasRun/canvasUI — siehe mcp/CANVAS.md) und kann eigene UI-
// Elemente (Buttons/Slider/Joystick/Code) als EINGANG oder AUSGANG
// definieren, die direkt in Policies verdrahtbar sind.
//
// Physik-Regel (Master-Prompt): minimal und konsistent. Kein Worker-
// Paralleltraining im Canvas (Graph läuft im Haupt-Thread), keine GPU,
// tanh-Residuen um die Keyframe-Pose wie im Rest der App.
// ═══════════════════════════════════════════════════════════

import { RNG } from './math.js';
import { ObsNorm, finiteArr } from './train.js';

// ── 1) BEOBACHTUNGS-LAYOUT: Port-Namen je Aufgabenart ──────
// Die Kanäle spiegeln EXAKT die observe()-Reihenfolge der Aufgaben
// (robots.js/motiontask.js) — der Canvas legt sie nur einzeln auf.

/** Gruppen [{name, n}] — Summe n === task.obsDim. */
export function obsGroups(task, cfg) {
  if (!task) return [{ name: 'in', n: 0 }];
  const nu = cfg ? cfg.nu : (task.actDim || 0);
  const nFeet = cfg && Array.isArray(cfg.footBodies) ? cfg.footBodies.length : 0;
  const g = [];
  if (task.kind === 'motion') {
    // motiontask.js observe(): 3·nu + 27 (inkl. v2.7.0-Sensorblock + lastAct)
    g.push({ name: 'Gelenk Δ-Referenz', n: nu });
    g.push({ name: 'Gelenk-Tempo', n: nu });
    g.push({ name: 'Aufwärts (x,y,z)', n: 3 });
    g.push({ name: 'Gier-Rate', n: 1 });
    g.push({ name: 'Fahrt vorwärts', n: 1 });
    g.push({ name: 'Fahrt seitlich', n: 1 });
    g.push({ name: 'Bahn-Fehler X', n: 1 });
    g.push({ name: 'Bahn-Fehler Y', n: 1 });
    g.push({ name: 'Bahn-Yaw-Fehler', n: 1 });
    g.push({ name: 'Bahn-Führung', n: 1 });
    g.push({ name: 'Takt sin', n: 1 });
    g.push({ name: 'Takt cos', n: 1 });
    g.push({ name: 'Befehl vx', n: 1 });
    g.push({ name: 'Befehl wz', n: 1 });
    g.push({ name: 'Trigger', n: 4 });
    g.push({ name: 'Gyro (x,y,z)', n: 3 });
    g.push({ name: 'Gravitation (x,y,z)', n: 3 });
    g.push({ name: 'Höhe', n: 1 });
    g.push({ name: 'Fußkontakt', n: 2 });
    g.push({ name: 'Letzte Aktion', n: nu });
  } else if (task.kind === 'hover') {
    // robots.js Hover-Task: 15 Kanäle
    g.push({ name: 'Aufwärts (x,y,z)', n: 3 });
    g.push({ name: 'Winkel-Tempo (x,y,z)', n: 3 });
    g.push({ name: 'Fahrt vorwärts', n: 1 });
    g.push({ name: 'Sinken (vz)', n: 1 });
    g.push({ name: 'Höhe', n: 1 });
    g.push({ name: 'Befehl Höhe', n: 1 });
    g.push({ name: 'Befehl vx', n: 1 });
    g.push({ name: 'Letzte Aktion', n: 4 });
  } else {
    // speed/recovery (3·nu + 17 + nFeet) + Soft-MoE-Kommandos (13) beim Duck
    g.push({ name: 'Gelenk Δ-Referenz', n: nu });
    g.push({ name: 'Gelenk-Tempo', n: nu });
    g.push({ name: 'Aufwärts (x,y,z)', n: 3 });
    g.push({ name: 'Gier-Rate', n: 1 });
    g.push({ name: 'Fahrt vorwärts', n: 1 });
    g.push({ name: 'Fahrt seitlich', n: 1 });
    g.push({ name: 'Befehl vx', n: 1 });
    g.push({ name: 'Befehl yaw', n: 1 });
    g.push({ name: 'Letzte Aktion', n: nu });
    g.push({ name: 'Gyro (x,y,z)', n: 3 });
    g.push({ name: 'Gravitation (x,y,z)', n: 3 });
    g.push({ name: 'Höhe', n: 1 });
    if (nFeet) g.push({ name: 'Fußkontakt', n: nFeet });
    g.push({ name: 'Takt sin', n: 1 });
    g.push({ name: 'Takt cos', n: 1 });
    if (task.moe) {
      g.push({ name: 'Soft vx', n: 1 });
      g.push({ name: 'Soft vy', n: 1 });
      g.push({ name: 'Soft wz', n: 1 });
      g.push({ name: 'Skill-Balance', n: 1 });
      g.push({ name: 'Skill-Walk', n: 1 });
      g.push({ name: 'Skill-Turn', n: 1 });
      g.push({ name: 'Skill-Recover', n: 1 });
      g.push({ name: 'Style 1–6', n: 6 });
    }
  }
  return g;
}

/** Einzelne Port-Namen (Länge === obsDim). */
export function obsPortNames(task, cfg) {
  const out = [];
  for (const grp of obsGroups(task, cfg)) {
    if (grp.n === 1) out.push(grp.name);
    else for (let i = 0; i < grp.n; i++) out.push(grp.name + '[' + i + ']');
  }
  return out;
}

// ── 2) FLEXNET — MLP mit FREIER Architektur ────────────────
// Schichten: dims = [in, h1…hk, out]. Die LETZTE Schicht ist der
// Aktions-Kopf (mu, linear wie PolicyNet.Wm), der Wert-Kopf sitzt auf
// der letzten Hidden-Schicht. tanh überall — nur mu bleibt linear
// (identische Semantik zur App-Policy; tanh kommt in der Senke).

export class FlexNet {
  constructor(dims, rng) {
    if (!Array.isArray(dims) || dims.length < 3) throw new Error('FlexNet: dims braucht [in, hidden…, out]');
    for (const d of dims) {
      const n = Math.round(d);
      if (!Number.isFinite(n) || n < 1 || n > 4096) throw new Error('FlexNet: ungültige Schichtgröße ' + d);
    }
    this.dims = dims.map(n => Math.round(n));
    this.obsDim = this.dims[0];
    this.actDim = this.dims[this.dims.length - 1];
    this.H = this.dims[this.dims.length - 2]; // letzte Hidden-Größe
    this.L = [];
    for (let l = 1; l < this.dims.length; l++) {
      const i = this.dims[l - 1], o = this.dims[l];
      const scale = l === this.dims.length - 1 ? 0.01 : Math.SQRT2;
      this.L.push({ i, o, W: this._arr(i, o, rng, scale), b: new Float32Array(o), gW: new Float32Array(i * o), gb: new Float32Array(o), am: new Float32Array(i * o), av: new Float32Array(i * o), abm: new Float32Array(o), abv: new Float32Array(o) });
    }
    this.Wv = this._arr(this.H, 1, rng, 1.0);
    this.bv = new Float32Array(1);
    this.gWv = new Float32Array(this.H); this.gbv = new Float32Array(1);
    this.logStd = new Float32Array(this.actDim).fill(-0.5);
    this.gLogStd = new Float32Array(this.actDim);
    this.amWv = new Float32Array(this.H); this.avWv = new Float32Array(this.H);
    this.ambv = new Float32Array(1); this.avbv = new Float32Array(1);
    this.amLS = new Float32Array(this.actDim); this.avLS = new Float32Array(this.actDim);
    this._h = this.dims.map(n => new Float32Array(n)); // Aktivierungen (h[0] = Eingabe)
    this._a = this.dims.map(n => new Float32Array(n)); // Pre-Aktivierung
    this._dh = this.dims.map(n => new Float32Array(n)); // Gradienten w.r.t. Aktivierungen
    this.mu = new Float32Array(this.actDim);
    this.val = 0;
    this.adamT = 0;
  }
  _arr(i, o, rng, scale) {
    const w = new Float32Array(i * o);
    const s = scale / Math.sqrt(i);
    for (let k = 0; k < w.length; k++) w[k] = (rng.next() * 2 - 1) * s;
    return w;
  }
  paramCount() {
    let n = this.Wv.length + 1 + 2 * this.actDim;
    for (const l of this.L) n += l.W.length + l.o;
    return n;
  }
  /** Forward: x (obsDim) → belegt mu/val + Caches für Backward. */
  forward(x) {
    const h = this._h, a = this._a;
    h[0].set(x);
    const nL = this.L.length;
    for (let l = 0; l < nL; l++) {
      const L = this.L[l], src = h[l], pre = a[l + 1], dst = h[l + 1];
      const last = (l === nL - 1);
      for (let j = 0; j < L.o; j++) {
        let s = L.b[j]; const off = j * L.i;
        for (let i = 0; i < L.i; i++) s += L.W[off + i] * src[i];
        pre[j] = s;
        dst[j] = last ? s : Math.tanh(s);
      }
    }
    this.mu.set(h[nL]);
    const src = h[nL - 1]; // letzte Hidden
    let sv = this.bv[0];
    for (let i = 0; i < this.H; i++) sv += this.Wv[i] * src[i];
    this.val = sv;
    return this.mu;
  }
  /** Alle Gradienten nullen (je Mini-Batch). */
  zeroGrads() {
    for (const l of this.L) { l.gW.fill(0); l.gb.fill(0); }
    this.gWv.fill(0); this.gbv.fill(0); this.gLogStd.fill(0);
  }
  /** Adam-Schritt über ALLE Parameter (lr). */
  adamStep(lr) {
    this.adamT++;
    const t = this.adamT;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
    const upd = (P, G, M, V) => {
      for (let k = 0; k < P.length; k++) {
        const g = Math.max(-1, Math.min(1, G[k]));
        M[k] = b1 * M[k] + (1 - b1) * g;
        V[k] = b2 * V[k] + (1 - b2) * g * g;
        P[k] -= lr * (M[k] / c1) / (Math.sqrt(V[k] / c2) + eps);
      }
    };
    for (const l of this.L) { upd(l.W, l.gW, l.am, l.av); upd(l.b, l.gb, l.abm, l.abv); }
    upd(this.Wv, this.gWv, this.amWv, this.avWv);
    upd(this.bv, this.gbv, this.ambv, this.avbv);
    upd(this.logStd, this.gLogStd, this.amLS, this.avLS);
  }
  /** Kompakte Serialisierung (Gewichte auf 5 Nachkommastellen). */
  _w(o) { const a = new Array(o.length); for (let i = 0; i < o.length; i++) a[i] = +o[i].toFixed(5); return a; }
  toJSON() {
    return {
      fmt: 'canvas-flexnet-1',
      dims: this.dims,
      L: this.L.map(l => ({ W: this._w(l.W), b: this._w(l.b) })),
      Wv: this._w(this.Wv), bv: this._w(this.bv),
      logStd: this._w(this.logStd),
    };
  }
  static fromJSON(o, rng) {
    if (!o || o.fmt !== 'canvas-flexnet-1' || !Array.isArray(o.dims)) throw new Error('Unbekanntes FlexNet-Format');
    const net = new FlexNet(o.dims, rng || { next: () => 0 });
    for (let l = 0; l < net.L.length; l++) {
      const src = o.L[l];
      if (!src || src.W.length !== net.L[l].W.length) throw new Error('FlexNet-Gewichte passen nicht');
      net.L[l].W.set(src.W); net.L[l].b.set(src.b);
    }
    net.Wv.set(o.Wv); net.bv.set(o.bv); net.logStd.set(o.logStd);
    return net;
  }
}

// ── 3) CARD-PPO — eigener PPO-Trainer je Karte ─────────────
// Gleiche Verlust-Mathematik wie train.js (GAE, gecliptes Surrogat,
// Wert- und Entropie-Term), aber architekturgenerisch über FlexNet.

export class CardPPO {
  /**
   * nIn, nOut — Port-Zahlen der Karte
   * opts: {hidden:[64,64], lr, T, gamma, lam, clip, epochs, mb, cV, cE, seed}
   */
  constructor(nIn, nOut, opts = {}) {
    this.nIn = Math.max(1, Math.round(nIn));
    this.nOut = Math.max(1, Math.round(nOut));
    const h = this.h = {
      hidden: Array.isArray(opts.hidden) && opts.hidden.length ? opts.hidden.slice(0, 3).map(n => Math.max(8, Math.min(256, Math.round(n)))) : [64, 64],
      lr: Number.isFinite(opts.lr) ? opts.lr : 3e-4,
      T: Math.max(128, Math.min(4096, Math.round(opts.T || 512))),
      gamma: 0.99, lam: 0.95, clip: 0.2, epochs: 4, mb: 128, cV: 0.5, cE: 0.005,
    };
    this.rng = new RNG(Number.isFinite(opts.seed) ? opts.seed : 1337);
    this.net = new FlexNet([this.nIn, ...h.hidden, this.nOut], this.rng);
    this.norm = new ObsNorm(this.nIn);
    this.stepCount = 0;
    this.updateCount = 0;
    this.metrics = null;
    this._normBuf = new Float32Array(this.nIn);
    this.buf = null;
  }
  get arch() { return this.h.hidden.join(','); }

  act(x, deterministic = false) {
    const normed = this.norm.apply(x, this._normBuf);
    const mu = this.net.forward(normed);
    const act = new Float32Array(this.nOut);
    let logp = 0;
    const LOG2PI = Math.log(2 * Math.PI);
    for (let i = 0; i < this.nOut; i++) {
      const std = Math.exp(this.net.logStd[i]);
      let z = 0;
      if (!deterministic) {
        const u1 = Math.max(this.rng.next(), 1e-9), u2 = this.rng.next();
        z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      act[i] = mu[i] + std * z;
      logp += -0.5 * ((act[i] - mu[i]) / std) ** 2 - this.net.logStd[i] - 0.5 * LOG2PI;
    }
    return { act, logp, value: this.net.val };
  }
  /** Nur Mittelwert (deterministische Ausführung). */
  actMu(x, out) {
    const normed = this.norm.apply(x, this._normBuf);
    const mu = this.net.forward(normed);
    if (out) { for (let i = 0; i < this.nOut; i++) out[i] = mu[i]; return out; }
    return mu;
  }

  _allocBuffer() {
    const T = this.h.T;
    this.buf = {
      obs: new Float32Array(T * this.nIn),
      act: new Float32Array(T * this.nOut),
      logp: new Float32Array(T), rew: new Float32Array(T),
      done: new Uint8Array(T), val: new Float32Array(T),
      adv: new Float32Array(T), ret: new Float32Array(T),
      ptr: 0,
    };
  }
  store(x, act, logp, rew, done, val) {
    if (!this.buf) this._allocBuffer();
    const b = this.buf, T = this.h.T;
    if (b.ptr >= T) return false;
    for (let i = 0; i < this.nIn; i++) if (!Number.isFinite(x[i])) return false;
    for (let i = 0; i < this.nOut; i++) if (!Number.isFinite(act[i])) return false;
    if (!Number.isFinite(logp) || !Number.isFinite(rew) || !Number.isFinite(val)) return false;
    b.obs.set(x, b.ptr * this.nIn);
    b.act.set(act, b.ptr * this.nOut);
    b.logp[b.ptr] = logp; b.rew[b.ptr] = rew;
    b.done[b.ptr] = done ? 1 : 0; b.val[b.ptr] = val;
    b.ptr++;
    this.stepCount++;
    return b.ptr >= T;
  }

  finishAndUpdate(lastVal) {
    if (!this.buf) return null;
    const b = this.buf, T = b.ptr, h = this.h;
    if (!Number.isFinite(lastVal)) lastVal = 0;
    let gae = 0;
    for (let t = T - 1; t >= 0; t--) {
      const nextNonTerm = b.done[t] ? 0 : 1;
      const nextVal = t === T - 1 ? lastVal : b.val[t + 1];
      const delta = b.rew[t] + h.gamma * nextVal * nextNonTerm - b.val[t];
      gae = delta + h.gamma * h.lam * nextNonTerm * gae;
      b.adv[t] = gae; b.ret[t] = gae + b.val[t];
    }
    for (let t = 0; t < T; t++) if (!Number.isFinite(b.adv[t])) { this.buf = null; this.updateCount++; return { verworfen: true }; }
    let mean = 0; for (let t = 0; t < T; t++) mean += b.adv[t]; mean /= T;
    let varr = 0; for (let t = 0; t < T; t++) varr += (b.adv[t] - mean) ** 2; varr = Math.sqrt(varr / T) + 1e-8;
    for (let t = 0; t < T; t++) b.adv[t] = (b.adv[t] - mean) / varr;
    const m = this._update(b, T);
    this.updateCount++;
    this.buf = null;
    this.metrics = m;
    return m;
  }

  _update(b, T) {
    const h = this.h, net = this.net, D = this.nIn, A = this.nOut;
    const stds = new Float32Array(A);
    for (let i = 0; i < A; i++) stds[i] = Math.exp(net.logStd[i]);
    const LOG2PI = Math.log(2 * Math.PI);
    let piLossSum = 0, vLossSum = 0, entSum = 0, clipFrac = 0;
    const idx = new Int32Array(T);
    for (let t = 0; t < T; t++) idx[t] = t;
    const x = new Float32Array(D);
    const nrmMean = this.norm.mean, nrmStd = this.norm.stds();
    for (let ep = 0; ep < h.epochs; ep++) {
      for (let t = T - 1; t > 0; t--) { const j = this.rng.int(t + 1); const tmp = idx[t]; idx[t] = idx[j]; idx[j] = tmp; }
      for (let start = 0; start < T; start += h.mb) {
        const end = Math.min(start + h.mb, T);
        const M = end - start;
        net.zeroGrads();
        for (let mi = start; mi < end; mi++) {
          const t = idx[mi];
          const obsOff = t * D;
          for (let i = 0; i < D; i++) x[i] = (b.obs[obsOff + i] - nrmMean[i]) / nrmStd[i];
          net.forward(x);
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
          const wPi = outside ? 0 : (-A_ * ratio) / M;
          const dv = net.val - b.ret[t];
          vLossSum += h.cV * dv * dv / (h.epochs * T);
          for (let i = 0; i < A; i++) entSum += (net.logStd[i] + 0.5 * LOG2PI + 0.5) / (h.epochs * T * A);
          // ── Backward ──
          // Indexierung: Schicht l mappt h[l] → h[l+1]; die LETZTE Schicht
          // (nL-1) ist der lineare mu-Kopf, ihr Eingang ist die letzte
          // Hidden-Schicht h[nL-1]. Gradientenvektoren: net._dh.
          const nL = net.L.length, dh = net._dh;
          const dhLast = dh[nL - 1];
          dhLast.fill(0);
          const LAST = net.L[nL - 1];
          const srcLast = net._h[nL - 1];
          for (let i = 0; i < A; i++) {
            const a = b.act[t * A + i];
            const gOut = wPi * (a - net.mu[i]) / (stds[i] * stds[i]);
            LAST.gb[i] += gOut;
            const off = i * LAST.i;
            for (let j = 0; j < LAST.i; j++) { LAST.gW[off + j] += gOut * srcLast[j]; dhLast[j] += gOut * LAST.W[off + j]; }
          }
          for (let i = 0; i < A; i++) {
            const a = b.act[t * A + i];
            const dLogp_dlogStd = ((a - net.mu[i]) ** 2) / (stds[i] * stds[i]) - 1;
            net.gLogStd[i] += wPi * dLogp_dlogStd - h.cE / M;
          }
          // Wert-Kopf (auf der letzten Hidden-Schicht)
          const wVal = h.cV * 2 * dv / M;
          for (let i = 0; i < net.H; i++) { net.gWv[i] += wVal * srcLast[i]; dhLast[i] += wVal * net.Wv[i]; }
          net.gbv[0] += wVal;
          // Hidden-Schichten rückwärts (tanh-Ableitung über h[l+1])
          for (let l = nL - 2; l >= 0; l--) {
            const L = net.L[l], srcL = net._h[l], dstL = net._h[l + 1], dIn = dh[l + 1];
            const dOut = dh[l];
            if (l > 0) dOut.fill(0);
            for (let j = 0; j < L.o; j++) {
              const dtanh = (1 - dstL[j] * dstL[j]) * dIn[j];
              L.gb[j] += dtanh;
              const off = j * L.i;
              for (let i = 0; i < L.i; i++) {
                L.gW[off + i] += dtanh * srcL[i];
                if (l > 0) dOut[i] += dtanh * L.W[off + i];
              }
            }
          }
        }
        net.adamStep(h.lr);
      }
    }
    return { piLoss: piLossSum, vLoss: vLossSum, entropy: entSum, clipFrac: T ? clipFrac / (h.epochs * T) : 0 };
  }

  toJSON() {
    return {
      fmt: 'canvas-cardppo-1',
      nIn: this.nIn, nOut: this.nOut, h: { hidden: this.h.hidden, lr: this.h.lr, T: this.h.T },
      stepCount: this.stepCount, updateCount: this.updateCount,
      norm: this.norm.toJSON(),
      net: this.net.toJSON(),
    };
  }
  static fromJSON(o) {
    if (!o || o.fmt !== 'canvas-cardppo-1') throw new Error('Unbekanntes Karten-Format');
    const p = new CardPPO(o.nIn, o.nOut, { hidden: o.h.hidden, lr: o.h.lr, T: o.h.T, seed: 1337 });
    p.net = FlexNet.fromJSON(o.net, p.rng);
    p.norm = ObsNorm.fromJSON(o.norm);
    p.stepCount = o.stepCount || 0; p.updateCount = o.updateCount || 0;
    return p;
  }
}

/** App-Policy (MLP 64×64, trainrobot-ppo-1) in eine Karte importieren. */
export function cardPPOFromAppPolicy(appJson) {
  if (!appJson || appJson.fmt !== 'trainrobot-ppo-1') throw new Error('Nur MLP-Policies (64×64) importierbar — Soft-MoE nicht');
  const nIn = appJson.obsDim, nOut = appJson.actDim;
  const p = new CardPPO(nIn, nOut, { hidden: [64, 64], seed: 1337 });
  const n = p.net;
  n.L[0].W.set(appJson.W1); n.L[0].b.set(appJson.b1);
  n.L[1].W.set(appJson.W2); n.L[1].b.set(appJson.b2);
  n.L[2].W.set(appJson.Wm); n.L[2].b.set(appJson.bm);
  n.Wv.set(appJson.Wv); n.bv.set(appJson.bv);
  n.logStd.set(appJson.logStd);
  p.norm = ObsNorm.fromJSON(appJson.norm);
  p.stepCount = appJson.stepCount || 0;
  return p;
}

// ── 4) KARTEN-BELohnung: eigene Formel oder global ─────────
// mode 'global': die Karte bekommt die Aufgaben-Belohnung (× scale).
// mode 'custom': kleine eigene Formel mit 6 Gewichten — „Belohnung/
// Bestrafung pro Karten-ID" ohne den Rest des Graphen zu berühren.

export const CARD_R_FIELDS = {
  alive:  [0, 0.5,  0.3],   // Grundbelohnung je Schritt
  up:     [0, 2,    0.5],   // Aufrechtsein (upz)
  vel:    [0, 2,    0],     // tatsächliche Vorwärtsfahrt
  turn:   [0, 2,    0],     // tatsächliche Gier-Rate
  energy: [0, 0.01, 0],     // Bestrafung Aktionsaufwand (Σ act²)
  fall:   [0, 5,    0],     // Bestrafung bei Episode-Ende mit Sturz
};

export function sanitizeCardReward(raw) {
  const out = { mode: 'global', scale: 1, w: {} };
  if (raw && typeof raw === 'object') {
    if (raw.mode === 'custom') out.mode = 'custom';
    if (Number.isFinite(raw.scale)) out.scale = Math.max(0, Math.min(3, raw.scale));
    for (const [k, [lo, hi, dflt]] of Object.entries(CARD_R_FIELDS)) {
      const v = raw.w && Number.isFinite(raw.w[k]) ? raw.w[k] : dflt;
      out.w[k] = Math.max(lo, Math.min(hi, v));
    }
  } else {
    for (const [k, [, , dflt]] of Object.entries(CARD_R_FIELDS)) out.w[k] = dflt;
  }
  return out;
}

/** Karten-Belohnung: ctx = {upz, vFwd, yawRate, actAbs2, done, fallen}. */
export function cardReward(rw, ctx) {
  if (!rw || rw.mode !== 'custom') return 0;
  const w = rw.w;
  let r = w.alive;
  r += w.up * (ctx.upz - 0.7);
  r += w.vel * Math.min(1, Math.abs(ctx.vFwd));
  r += w.turn * Math.min(1, Math.abs(ctx.yawRate));
  r -= w.energy * ctx.actAbs2;
  if (ctx.done && ctx.fallen) r -= w.fall;
  return r;
}

// ── 5) GRAPH-MODELL ────────────────────────────────────────
// Knoten:
//   {id:'io',  type:'io',  x, y}          SENSOREN (obs + Stick) — Ausgänge
//   {id:'out', type:'out', x, y, sink:[…]} AKTUATOREN — Eingänge (sink je Port: 'residual'|'direct')
//   {id, type:'policy', name, nIn, nOut, hidden, trainable, reward, lr, T, x, y}
//   {id, type:'ui',     name, kind, io, nOut, code, state, x, y}
//   {id, type:'const',  name, values, x, y}
// Kabel: {id, from:{n,port}, to:{n,port}} — Werte fließen von → nach.

export const IO_ID = 'io', OUT_ID = 'out';
export const LIMITS = { policies: 16, ui: 12, consts: 8, links: 240, nIn: [1, 64], nOut: [1, 32], hiddenLayers: 3, hiddenNeurons: [8, 256] };

export function newGraph() {
  return {
    v: 2,
    nextId: 3,
    nodes: [
      { id: IO_ID, type: 'io', x: 16, y: 60 },
      { id: OUT_ID, type: 'out', x: 900, y: 60, sink: [] },
    ],
    links: [],
    view: { x: 0, y: 0, z: 0.85 },
  };
}

export function makeNodeId(g) { return 'n' + (g.nextId++); }

export function countType(g, type) { let n = 0; for (const nd of g.nodes) if (nd.type === type) n++; return n; }

export function findNode(g, id) { for (const nd of g.nodes) if (nd.id === id) return nd; return null; }
export function findNodeByName(g, name) {
  if (!name) return null;
  const low = String(name).toLowerCase();
  for (const nd of g.nodes) if ((nd.name || '').toLowerCase() === low || nd.id === low) return nd;
  return null;
}

/** Neue Policy-Karte (rein datenseitig; Netz baut das Board). */
export function addPolicyNode(g, spec = {}) {
  if (countType(g, 'policy') >= LIMITS.policies) throw new Error('Maximal ' + LIMITS.policies + ' Policy-Karten');
  const nIn = Math.round(Math.max(LIMITS.nIn[0], Math.min(LIMITS.nIn[1], spec.nIn || 8)));
  const nOut = Math.round(Math.max(LIMITS.nOut[0], Math.min(LIMITS.nOut[1], spec.nOut || 4)));
  let hidden = Array.isArray(spec.hidden) ? spec.hidden : [64, 64];
  hidden = hidden.slice(0, LIMITS.hiddenLayers).map(n => Math.round(Math.max(LIMITS.hiddenNeurons[0], Math.min(LIMITS.hiddenNeurons[1], n))));
  if (!hidden.length) hidden = [64];
  const nd = {
    id: makeNodeId(g), type: 'policy',
    name: String(spec.name || ('Netz ' + countType(g, 'policy'))).slice(0, 24),
    nIn, nOut, hidden,
    trainable: spec.trainable !== false,
    reward: sanitizeCardReward(spec.reward),
    lr: Number.isFinite(spec.lr) ? Math.max(1e-5, Math.min(3e-3, spec.lr)) : 3e-4,
    T: Math.round(Math.max(128, Math.min(4096, spec.T || 512))),
    x: Math.round(spec.x ?? (260 + 60 * (countType(g, 'policy') % 4))),
    y: Math.round(spec.y ?? (80 + 50 * countType(g, 'policy'))),
    steps: 0, lastR: 0,
  };
  g.nodes.push(nd);
  return nd;
}

export function addUINode(g, spec = {}) {
  if (countType(g, 'ui') >= LIMITS.ui) throw new Error('Maximal ' + LIMITS.ui + ' UI-Elemente');
  const kind = ['button', 'toggle', 'slider', 'joy', 'gauge', 'light', 'code'].includes(spec.kind) ? spec.kind : 'button';
  // 'button'/'toggle'/'slider'/'joy' sind IMMER Eingänge; 'gauge'/'light' IMMER Ausgänge;
  // 'code' kann beides (io-Feld).
  const io = (kind === 'gauge' || kind === 'light') ? 'out' : (kind === 'code' ? (spec.io === 'out' ? 'out' : 'in') : 'in');
  const nOut = kind === 'joy' ? 2 : (kind === 'code' && io === 'in' ? Math.round(Math.max(1, Math.min(4, spec.nOut || 1))) : 1);
  const nd = {
    id: makeNodeId(g), type: 'ui',
    name: String(spec.name || spec.label || ('UI ' + countType(g, 'ui'))).slice(0, 20),
    kind, io, nOut,
    label: String(spec.label || spec.name || kind).slice(0, 16),
    code: typeof spec.code === 'string' ? spec.code.slice(0, 2000) : '',
    state: {},
    x: Math.round(spec.x ?? (420 + 40 * countType(g, 'ui'))),
    y: Math.round(spec.y ?? (260 + 40 * countType(g, 'ui'))),
  };
  g.nodes.push(nd);
  return nd;
}

export function addConstNode(g, spec = {}) {
  if (countType(g, 'const') >= LIMITS.consts) throw new Error('Maximal ' + LIMITS.consts + ' Konstanten');
  let values = (Array.isArray(spec.values) ? spec.values : [spec.value ?? 0]).slice(0, 8).map(v => Number.isFinite(+v) ? Math.max(-10, Math.min(10, +v)) : 0);
  if (!values.length) values = [0];
  const nd = {
    id: makeNodeId(g), type: 'const',
    name: String(spec.name || ('Konst ' + countType(g, 'const'))).slice(0, 20),
    values,
    x: Math.round(spec.x ?? (300 + 40 * countType(g, 'const'))),
    y: Math.round(spec.y ?? (300 + 40 * countType(g, 'const'))),
  };
  g.nodes.push(nd);
  return nd;
}

export function removeNode(g, id) {
  if (id === IO_ID || id === OUT_ID) throw new Error('Roboter-E/A-Knoten können nicht gelöscht werden');
  const i = g.nodes.findIndex(n => n.id === id);
  if (i < 0) return false;
  g.nodes.splice(i, 1);
  g.links = g.links.filter(l => l.from.n !== id && l.to.n !== id);
  return true;
}

/** Zyklus-Prüfung: gibt es in der Kabel-Liste bereits einen Pfad to → from? */
function cycleIn(links, fromN, toN) {
  if (fromN === toN) return true;
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.from.n)) adj.set(l.from.n, []);
    adj.get(l.from.n).push(l.to.n);
  }
  const stack = [toN], seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromN) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const nxt = adj.get(cur);
    if (nxt) for (const n of nxt) stack.push(n);
  }
  return false;
}
export function wouldCycle(g, fromN, toN) { return cycleIn(g.links, fromN, toN); }

/** Kabel ziehen — mit Port-Kapazität + Zyklus-Schutz. Liefert {ok, error}. */
export function addLink(g, from, to) {
  const fN = findNode(g, from.n), tN = findNode(g, to.n);
  if (!fN || !tN) return { ok: false, error: 'Knoten nicht gefunden' };
  const fOut = nodeOutCount(g, fN), tIn = nodeInCount(g, tN);
  if (fOut <= 0) return { ok: false, error: fN.id + ' hat keine Ausgänge' };
  if (tIn <= 0) return { ok: false, error: tN.id + ' hat keine Eingänge' };
  if (from.port < 0 || from.port >= fOut) return { ok: false, error: 'Ausgangsport ' + from.port + ' existiert nicht (' + fOut + ' verfügbar)' };
  if (to.port < 0 || to.port >= tIn) return { ok: false, error: 'Eingangsport ' + to.port + ' existiert nicht (' + tIn + ' verfügbar)' };
  if (g.links.length >= LIMITS.links) return { ok: false, error: 'Maximal ' + LIMITS.links + ' Kabel' };
  // Zyklus-Check VOR dem Anfassen des Graphen — sonst hätte eine abgelehnte
  // Verbindung die ersetzten Kabel bereits zerstört (v2.17.0-Fix).
  if (fN.type === 'policy' && tN.type === 'policy') {
    const simLinks = g.links.filter(l => !(l.to.n === to.n && l.to.port === to.port) && !(l.from.n === from.n && l.from.port === from.port));
    simLinks.push({ from: { n: from.n, port: from.port }, to: { n: to.n, port: to.port } });
    if (cycleIn(simLinks, fN.id, tN.id)) {
      return { ok: false, error: 'Zyklus — Netze dürfen nicht rückkoppelt sein' };
    }
  }
  // Pro Eingang genau EIN Kabel: vorhandenes ersetzen
  g.links = g.links.filter(l => !(l.to.n === to.n && l.to.port === to.port));
  // Pro Ausgang ebenfalls EIN Kabel (Quelle sauber halten)
  g.links = g.links.filter(l => !(l.from.n === from.n && l.from.port === from.port));
  g.links.push({ id: 'l' + (g.nextId++), from: { n: from.n, port: from.port }, to: { n: to.n, port: to.port } });
  return { ok: true };
}

export function nodeOutCount(g, nd) {
  if (nd.type === 'io') return g._ioCount || 0;   // vom Board gesetzt (obsDim + 2 Stick)
  if (nd.type === 'out') return 0;
  if (nd.type === 'policy') return nd.nOut;
  if (nd.type === 'ui') return nd.io === 'in' ? (nd.kind === 'joy' ? 2 : nd.kind === 'code' ? nd.nOut : 1) : 0;
  if (nd.type === 'const') return nd.values.length;
  return 0;
}
export function nodeInCount(g, nd) {
  if (nd.type === 'out') return g._actCount || 0; // vom Board gesetzt (nu)
  if (nd.type === 'io') return 0;
  if (nd.type === 'policy') return nd.nIn;
  if (nd.type === 'ui') return nd.io === 'out' ? 1 : (nd.kind === 'code' ? 1 : 0);
  return 0;
}

export function removeLink(g, spec) {
  const before = g.links.length;
  if (spec.id) g.links = g.links.filter(l => l.id !== spec.id);
  else if (spec.from && spec.to) g.links = g.links.filter(l => !(l.from.n === spec.from.n && l.from.port === spec.from.port && l.to.n === spec.to.n && l.to.port === spec.to.port));
  return g.links.length < before;
}

// ── 5b) EIN-SCHRITT-BAUPLAN (v2.19.0, für canvasBuild) ─────
// Baut eine ganze Architektur ATOMAR in einen Graphen: Karten (anlegen ODER
// bestehende gleichnamige umkonfigurieren), Belohnungen, Kabel, Senken-Modus.
// Reine Graph-Funktion (kein DOM/Board) → unit-testbar. Fehler pro Kabel
// werden gesammelt statt abzubrechen (ein falscher Port killt nicht den Plan).
// plan = { cards:[{name?, nIn, nOut, hidden?, trainable?, lr?, T?, reward?}],
//          links:[{from:{node,port}, to:{node,port}}], sink?:"residual"|"direct" }
// Report = { cards:[{id, name, isNew, archReset}], linksOk, linksFail:[{i, error}], errors:[…] }
export function buildPlanGraph(g, plan) {
  const rep = { cards: [], linksOk: 0, linksFail: [], errors: [] };
  if (!plan || typeof plan !== 'object') { rep.errors.push('Plan fehlt'); return rep; }
  const specs = Array.isArray(plan.cards) ? plan.cards.slice(0, LIMITS.policies) : [];
  const links = Array.isArray(plan.links) ? plan.links.slice(0, LIMITS.links) : [];
  if (Array.isArray(plan.cards) && plan.cards.length > LIMITS.policies) rep.errors.push('Nur die ersten ' + LIMITS.policies + ' Karten wurden angelegt (Limit)');
  if (Array.isArray(plan.links) && plan.links.length > LIMITS.links) rep.errors.push('Nur die ersten ' + LIMITS.links + ' Kabel wurden gesetzt (Limit)');
  // 1) Karten: neu ODER bestehende (gleicher Name) umkonfigurieren
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object') { rep.errors.push('Karten-Spezifikation ungültig'); continue; }
    const name = String(spec.name || '').trim().slice(0, 24);
    let nd = name ? findNodeByName(g, name) : null;
    if (nd && nd.type !== 'policy') nd = null;
    let isNew = false, archReset = false;
    if (!nd) {
      try { nd = addPolicyNode(g, spec); isNew = true; }
      catch (e) { rep.errors.push('Karte „' + (name || '?') + '": ' + e.message); continue; }
    } else {
      // Bestehende Karte: Architektur/Daten übernehmen (wie cmd=config)
      let archChanged = false;
      if (Array.isArray(spec.hidden) && spec.hidden.length) {
        const h = spec.hidden.slice(0, LIMITS.hiddenLayers).map(n => Math.round(Math.max(LIMITS.hiddenNeurons[0], Math.min(LIMITS.hiddenNeurons[1], +n || 0)))).filter(n => n >= LIMITS.hiddenNeurons[0] && n <= LIMITS.hiddenNeurons[1]);
        if (h.length && h.join(',') !== nd.hidden.join(',')) { archChanged = true; nd.hidden = h; }
      }
      if (spec.nIn !== undefined) { const v = Math.round(+spec.nIn); if (v >= LIMITS.nIn[0] && v <= LIMITS.nIn[1] && v !== nd.nIn) { archChanged = true; nd.nIn = v; } }
      if (spec.nOut !== undefined) { const v = Math.round(+spec.nOut); if (v >= LIMITS.nOut[0] && v <= LIMITS.nOut[1] && v !== nd.nOut) { archChanged = true; nd.nOut = v; } }
      if (spec.trainable !== undefined) nd.trainable = !!spec.trainable;
      if (Number.isFinite(+spec.lr)) nd.lr = Math.max(1e-5, Math.min(3e-3, +spec.lr));
      if (Number.isFinite(+spec.T)) nd.T = Math.round(Math.max(128, Math.min(4096, +spec.T)));
      if (archChanged) { archReset = true; nd.ppo = null; }
      // Kabel auf tote Ports der neuen Architektur entfernen (wie cmd=config)
      g.links = g.links.filter(l => {
        const tN = findNode(g, l.to.n), fN = findNode(g, l.from.n);
        if (tN && tN.id === nd.id && l.to.port >= nd.nIn) return false;
        if (fN && fN.id === nd.id && l.from.port >= nd.nOut) return false;
        return true;
      });
    }
    if (spec.reward !== undefined) nd.reward = sanitizeCardReward(spec.reward);
    rep.cards.push({ id: nd.id, name: nd.name, isNew, archReset });
  }
  // 2) Kabel: Namen/IDs auflösen, addLink (Kapazität + Zyklus-Check), Fehler sammeln
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (!l || typeof l !== 'object' || !l.from || !l.to) { rep.linksFail.push({ i, error: 'from/to fehlen' }); continue; }
    const fN = findNode(g, l.from.node) || findNodeByName(g, l.from.node);
    const tN = findNode(g, l.to.node) || findNodeByName(g, l.to.node);
    if (!fN) { rep.linksFail.push({ i, error: 'Quelle „' + l.from.node + '" nicht gefunden' }); continue; }
    if (!tN) { rep.linksFail.push({ i, error: 'Ziel „' + l.to.node + '" nicht gefunden' }); continue; }
    const res = addLink(g, { n: fN.id, port: Math.round(+l.from.port || 0) }, { n: tN.id, port: Math.round(+l.to.port || 0) });
    if (res.ok) rep.linksOk++;
    else rep.linksFail.push({ i, error: res.error });
  }
  // 3) Senken-Modus der Aktuatoren (residual = App-Semantik, direct = Rohwert)
  if (plan.sink === 'residual' || plan.sink === 'direct') {
    const outN = findNode(g, OUT_ID);
    if (outN) for (let a = 0; a < (g._actCount || outN.sink.length || 0); a++) outN.sink[a] = plan.sink;
  }
  return rep;
}

/** Topologische Reihenfolge der Policy-Karten (nur die mit Ausgängen). */
export function policyOrder(g) {
  const pol = g.nodes.filter(n => n.type === 'policy');
  const deps = new Map(pol.map(p => [p.id, new Set()]));
  for (const l of g.links) {
    if (deps.has(l.to.n) && (l.from.n === IO_ID || l.from.n === OUT_ID || g.nodes.some(n => n.id === l.from.n && n.type !== 'policy'))) continue;
    if (deps.has(l.to.n) && deps.has(l.from.n)) deps.get(l.to.n).add(l.from.n);
  }
  const order = [], done = new Set();
  let guard = pol.length * pol.length + 4;
  while (order.length < pol.length && guard-- > 0) {
    for (const p of pol) {
      if (done.has(p.id)) continue;
      let ok = true;
      for (const d of deps.get(p.id)) if (!done.has(d)) { ok = false; break; }
      if (ok) { order.push(p); done.add(p.id); }
    }
  }
  return order.length === pol.length ? order : pol; // Fallback (sollte nie passieren)
}

/** Graph robust machen (Laden aus localStorage / Gemini). Liefert {g, errors}. */
export function sanitizeGraph(raw) {
  const errors = [];
  const g = newGraph();
  // Port-Kapazität während des Sanitizings großzügig (das Board stutzt beim
  // attach() auf die echte obsDim/nu — Kabel auf tote Ports fallen dort weg).
  g._ioCount = 4096;
  g._actCount = 4096;
  if (!raw || typeof raw !== 'object') return { g, errors: ['leer'] };
  g.view = { x: +raw.view?.x || 0, y: +raw.view?.y || 0, z: Math.max(0.35, Math.min(1.6, +raw.view?.z || 0.85)) };
  const ids = new Set([IO_ID, OUT_ID]);
  const clean = [];
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const rn of rawNodes) {
    try {
      if (!rn || typeof rn !== 'object') continue;
      let nd = null;
      if (rn.id === IO_ID) { g.nodes[0].x = +rn.x || 16; g.nodes[0].y = +rn.y || 60; continue; }
      else if (rn.id === OUT_ID) {
        g.nodes[1].x = +rn.x || 900; g.nodes[1].y = +rn.y || 60;
        g.nodes[1].sink = Array.isArray(rn.sink) ? rn.sink.map(s => s === 'direct' ? 'direct' : 'residual').slice(0, 64) : [];
        continue;
      }
      else if (rn.type === 'policy') {
        nd = addPolicyNode(g, { ...rn, x: +rn.x || undefined, y: +rn.y || undefined });
        nd.steps = Number.isFinite(rn.steps) ? rn.steps : 0;
        nd.lastR = Number.isFinite(rn.lastR) ? rn.lastR : 0;
        nd.ppo = rn.ppo ? rn.ppo : null; // roh — Board lädt CardPPO daraus
      } else if (rn.type === 'ui') {
        nd = addUINode(g, { ...rn, x: +rn.x || undefined, y: +rn.y || undefined });
        nd.state = (rn.state && typeof rn.state === 'object') ? rn.state : {};
      } else if (rn.type === 'const') {
        nd = addConstNode(g, { ...rn, x: +rn.x || undefined, y: +rn.y || undefined });
      } else continue;
      if (nd && ids.has(nd.id)) continue; // doppelte ID verwerfen
      ids.add(nd.id);
      clean.push(nd);
    } catch (e) { errors.push('Knoten verworfen: ' + (e.message || e)); }
  }
  g.nodes = [g.nodes[0], g.nodes[1], ...clean]; // io/out zuerst
  let linked = 0;
  for (const l of (Array.isArray(raw.links) ? raw.links.slice(0, LIMITS.links) : [])) {
    if (!l || !l.from || !l.to || !ids.has(l.from.n) || !ids.has(l.to.n)) continue;
    const r = addLink(g, { n: l.from.n, port: l.from.port | 0 }, { n: l.to.n, port: l.to.port | 0 });
    if (r.ok) linked++; else errors.push('Kabel verworfen: ' + r.error);
  }
  return { g, errors };
}

// ── 6) BOARD — Laufzeit (Ausführung + Training) + Editor ───
// Das Board hält den Graphen, die CardPPO-Instanzen je Karte und die
// Ausführungslogik: Quellen lesen (Sensoren/Stick/UI/Konstanten) →
// Policy-Karten in topologischer Reihenfolge → Aktuator-Senken
// (tanh-Residuum um die Keyframe-Pose wie in der App, oder direct).

export class CanvasBoard {
  constructor(hooks) {
    this.hooks = hooks; // {log, toast, buzz, getSim, getTask, getRobotId, getStick, setMode, getMode, stopMainTraining, fireAct, fireReset, fireReward, pushEpisodeReward, getMainPolicyJSON, getSpeedSteps}
    this.graph = newGraph();
    this.ppo = new Map();       // nodeId → CardPPO
    this.training = false;
    this.rng = new RNG(20260917);
    this._obs = null;
    this._obsNames = [];
    this._actNames = [];
    this._vals = new Map();     // Quellwerte: 'node:port' → Zahl (io/ui/const)
    this._outVals = new Map();  // Policy-Ausgänge: nodeId → Float32Array
    this._inLink = new Map();   // 'node:port' → link (Cache je Render)
    this._pendingTrans = [];
    this._refBuf = null;
    this._epReward = 0;
    this._fallLogT = 0;
    this.stats = { episodes: 0, steps: 0, rate: 0, _times: [] };
    this.dom = null;
    this._pending = null;       // Kabel ziehen
    this._saveT = 0;
    this._warn = {};
  }

  get sim() { return this.hooks.getSim(); }
  get task() { return this.hooks.getTask(); }

  /** Nach Roboter-/Aufgabenwechsel: Ports neu aufsetzen, Kabel stutzen, Netze laden. */
  attach() {
    const sim = this.sim, task = this.task;
    if (!sim || !task) return;
    this.graph._ioCount = task.obsDim + 2; // + Stick X / Stick Y
    this.graph._actCount = sim.nu;
    this._obs = new Float32Array(task.obsDim);
    this._obsNames = obsPortNames(task, sim.cfg);
    this._actNames = sim.actName.slice();
    this._refBuf = new Float64Array(sim.nu);
    // Vorschlag: io links, out rechts (nur beim ersten Mal)
    if (this.graph.nodes[1].x < 400) this.graph.nodes[1].x = Math.max(620, 360 + this._obsNames.length * 0.4);
    // Kabel mit ungültigen Ports verwerfen
    this.graph.links = this.graph.links.filter(l => {
      const f = findNode(this.graph, l.from.n), t = findNode(this.graph, l.to.n);
      if (!f || !t) return false;
      if (l.from.n === IO_ID && l.from.port >= this.graph._ioCount) return false;
      if (l.to.n === OUT_ID && l.to.port >= sim.nu) return false;
      return true;
    });
    for (const nd of this.graph.nodes) {
      if (nd.type === 'policy') this._ensurePPO(nd);
    }
    this._cacheLinks();
    if (this.dom) this.render();
  }

  /** CardPPO je Karte — Architekturwechsel = frisches Netz (bewusst). */
  _ensurePPO(nd) {
    let p = this.ppo.get(nd.id);
    if (p && p.nIn === nd.nIn && p.nOut === nd.nOut && p.arch === nd.hidden.join(',')) { p.h.lr = nd.lr; return p; }
    if (nd.ppo) {
      try {
        const cand = CardPPO.fromJSON(nd.ppo);
        if (cand.nIn === nd.nIn && cand.nOut === nd.nOut && cand.arch === nd.hidden.join(',')) {
          this.ppo.set(nd.id, cand);
          cand.h.lr = nd.lr;
          return cand;
        }
      } catch (e) { this.hooks.log('Canvas: gespeichertes Netz von „' + nd.name + '" unlesbar (' + e.message + ') — neu', 'warn'); }
      nd.ppo = null;
    }
    p = new CardPPO(nd.nIn, nd.nOut, { hidden: nd.hidden, lr: nd.lr, T: nd.T, seed: 1000 + (parseInt(nd.id.slice(1), 10) || 0) });
    this.ppo.set(nd.id, p);
    return p;
  }

  _cacheLinks() {
    this._inLink.clear();
    for (const l of this.graph.links) this._inLink.set(l.to.n + ':' + l.to.port, l);
  }

  // ── Ausführung ────────────────────────────────────────────
  _evalSources() {
    const v = this._vals;
    v.clear();
    const sim = this.sim, task = this.task;
    task.observe(sim, this._obs);
    for (let i = 0; i < this._obs.length; i++) v.set(IO_ID + ':' + i, this._obs[i]);
    const stick = this.hooks.getStick ? this.hooks.getStick() : { x: 0, y: 0 };
    v.set(IO_ID + ':' + this._obs.length, stick.x || 0);
    v.set(IO_ID + ':' + (this._obs.length + 1), stick.y || 0);
    for (const nd of this.graph.nodes) {
      if (nd.type === 'ui' && nd.io === 'in') {
        let vals;
        if (nd.kind === 'button') vals = [nd.state.pressed ? 1 : 0];
        else if (nd.kind === 'toggle') vals = [nd.state.on ? 1 : 0];
        else if (nd.kind === 'slider') vals = [Number.isFinite(nd.state.value) ? nd.state.value : 0];
        else if (nd.kind === 'joy') vals = [nd.state.x || 0, nd.state.y || 0];
        else vals = this._runUICode(nd);
        const n = nodeOutCount(this.graph, nd);
        for (let p = 0; p < n; p++) {
          const x = vals ? +vals[p] : 0;
          v.set(nd.id + ':' + p, Number.isFinite(x) ? x : 0);
        }
      } else if (nd.type === 'const') {
        for (let p = 0; p < nd.values.length; p++) v.set(nd.id + ':' + p, nd.values[p]);
      }
    }
  }

  /** UI-Code (Art 'code', io 'in'): ctx → Zahlenliste. Fehler → Nullen + einmalige Meldung. */
  _runUICode(nd) {
    if (!nd.code || !nd.code.trim()) return new Array(nd.nOut).fill(0);
    let fn = this._codeFn && this._codeFn[nd.id + ':' + (nd._codeRev || 0)];
    if (!fn) {
      try { fn = new Function('ctx', '"use strict";' + nd.code); } catch (e) { this._warnCode(nd, 'Syntax: ' + e.message); return new Array(nd.nOut).fill(0); }
      this._codeFn = this._codeFn || {};
      this._codeFn[nd.id + ':' + (nd._codeRev || 0)] = fn;
    }
    try {
      const out = fn({ t: performance.now() / 1000, dt: 0.02, state: nd.state });
      if (Array.isArray(out)) return out;
      if (Number.isFinite(+out)) return [+out];
      return new Array(nd.nOut).fill(0);
    } catch (e) { this._warnCode(nd, e.message); return new Array(nd.nOut).fill(0); }
  }
  _warnCode(nd, msg) {
    const now = performance.now();
    if (now - (this._warn[nd.id] || 0) > 8000) {
      this._warn[nd.id] = now;
      this.hooks.log('Canvas-UI „' + nd.name + '" Code-Fehler: ' + msg, 'warn');
    }
  }

  _evalPolicies(stochastic) {
    this._outVals.clear();
    this._pendingTrans = [];
    const order = policyOrder(this.graph);
    for (const nd of order) {
      const p = this._ensurePPO(nd);
      const inBuf = this._inBufFor(nd);
      for (let i = 0; i < nd.nIn; i++) {
        const link = this._inLink.get(nd.id + ':' + i);
        inBuf[i] = link ? this._sourceValue(link.from) : 0;
      }
      if (!finiteArr(inBuf)) {
        if (!this._warn['obs' + nd.id]) { this._warn['obs' + nd.id] = true; this.hooks.log('Canvas: nicht-endliche Eingaben bei „' + nd.name + '" — Eingänge auf 0', 'warn'); }
        inBuf.fill(0);
      }
      if (stochastic && nd.trainable && this.training) {
        p.norm.update(inBuf);
        const r = p.act(inBuf, false);
        const x = new Float32Array(inBuf);
        this._pendingTrans.push({ nd, p, x, act: r.act, logp: r.logp, value: r.value });
        let o = this._outVals.get(nd.id);
        if (!o || o.length !== nd.nOut) { o = new Float32Array(nd.nOut); this._outVals.set(nd.id, o); }
        o.set(r.act);
      } else {
        let o = this._outVals.get(nd.id);
        if (!o || o.length !== nd.nOut) { o = new Float32Array(nd.nOut); this._outVals.set(nd.id, o); }
        p.actMu(inBuf, o);
      }
    }
  }

  _inBufFor(nd) {
    let b = this._inBufs && this._inBufs.get(nd.id);
    if (!b || b.length !== nd.nIn) {
      this._inBufs = this._inBufs || new Map();
      b = new Float32Array(nd.nIn);
      this._inBufs.set(nd.id, b);
    }
    return b;
  }

  _sourceValue(from) {
    const nd = findNode(this.graph, from.n);
    if (!nd) return 0;
    if (nd.type === 'policy') {
      const o = this._outVals.get(nd.id);
      return o && from.port < o.length ? o[from.port] : 0;
    }
    const v = this._vals.get(nd.id + ':' + from.port);
    return v === undefined ? 0 : v;
  }

  _sinkRef() {
    const sim = this.sim;
    if (sim.cfg.drone && sim.flightCtl && Number.isFinite(sim.flightCtl.hoverT)) {
      const t = sim.flightCtl.hoverT / sim.nu;
      for (let a = 0; a < sim.nu; a++) this._refBuf[a] = t;
    } else {
      for (let a = 0; a < sim.nu; a++) this._refBuf[a] = sim.keyCtrl[a];
    }
    return this._refBuf;
  }

  _applySinks() {
    const sim = this.sim, cfg = sim.cfg;
    const outNode = findNode(this.graph, OUT_ID);
    const ref = this._sinkRef();
    for (let a = 0; a < sim.nu; a++) {
      const link = this._inLink.get(OUT_ID + ':' + a);
      if (!link) { sim.ctrl[a] = ref[a]; continue; }
      const v = this._sourceValue(link.from);
      if (!Number.isFinite(v)) { sim.ctrl[a] = ref[a]; continue; }
      if (outNode && outNode.sink[a] === 'direct') {
        const lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
        sim.ctrl[a] = Math.max(lo, Math.min(hi, v));
      } else {
        sim.ctrl[a] = ref[a] + (cfg.actSpan || 0.4) * Math.tanh(v * (cfg.jointResidual || 1));
      }
    }
  }

  _setTaskLastAct() {
    const sim = this.sim, task = this.task;
    if (!task || !task.lastAct) return;
    for (let a = 0; a < sim.nu; a++) {
      const link = this._inLink.get(OUT_ID + ':' + a);
      task.lastAct[a] = link ? this._sourceValue(link.from) : 0;
    }
  }

  _liveCtx() {
    const sim = this.sim;
    const q = this._lq || (this._lq = new Float64Array(4));
    sim.baseQuat(q);
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const upz = 1 - 2 * (x * x + y * y);
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const bv = this._lbv || (this._lbv = new Float64Array(3));
    sim.baseVelWorld(bv);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { upz, yawRate: sim._qvel[5], vFwd: c * bv[0] + s * bv[1] };
  }

  /** EIN Canvas-Schritt im AUSFÜHREN-Modus (Echtzeit, deterministisch). */
  execCtrlStep() {
    const sim = this.sim, task = this.task;
    if (!sim || !task) return;
    const substeps = Math.max(1, Math.round((sim.cfg.ctrlDt || 0.02) / sim.timestep));
    if (task.pathOn) task.updateCmd(sim.cfg.ctrlDt || 0.02, sim);
    this._evalSources();
    this._evalPolicies(false);
    this._applySinks();
    this._setTaskLastAct();
    if (this.hooks.fireAct) this.hooks.fireAct(sim, sim.ctrl);
    sim.stepN(substeps);
    if (task.kind === 'motion') task.advance(0.02);
    if (task.afterAct) task.afterAct(sim, task.lastAct);
  }

  /** EIN Trainingsschritt (Rollout + ggf. PPO-Update JE Karte). */
  trainCtrlStep() {
    const sim = this.sim, task = this.task;
    if (!sim || !task) return;
    const substeps = Math.max(1, Math.round(0.02 / sim.timestep));
    if (task.stepsLeft <= 0 && task.sampleCmd) task.sampleCmd(this.rng);
    this._evalSources();
    this._evalPolicies(true);
    this._applySinks();
    this._setTaskLastAct();
    if (this.hooks.fireAct) this.hooks.fireAct(sim, sim.ctrl);
    sim.stepN(substeps);
    if (task.kind === 'motion') task.advance(0.02);
    let r = 0, done = false;
    const rr = task.reward(sim);
    r = rr.r; done = !!rr.done;
    const o4 = 4 * sim.baseBody;
    const bx = sim._xquat[o4 + 1], by = sim._xquat[o4 + 2];
    if (this.hooks.fireReward) {
      const rw = this.hooks.fireReward(sim, { r, done, task, upz: 1 - 2 * (bx * bx + by * by), height: sim._xpos[3 * sim.baseBody + 2] });
      r = rw.r; done = rw.done;
    }
    const ctx = this._liveCtx();
    ctx.done = done;
    ctx.fallen = (1 - 2 * (bx * bx + by * by)) < (sim.cfg.done ? sim.cfg.done.upMin : 0.32);
    let actAbs2 = 0;
    for (let a = 0; a < sim.nu; a++) actAbs2 += task.lastAct[a] * task.lastAct[a];
    ctx.actAbs2 = actAbs2;
    this._epReward += r;
    let trained = 0;
    for (const t of this._pendingTrans) {
      const rCard = t.nd.reward.mode === 'custom' ? cardReward(t.nd.reward, ctx) : r * (t.nd.reward.scale != null ? t.nd.reward.scale : 1);
      t.nd.lastR = rCard;
      t.nd.steps++;
      const full = t.p.store(t.x, t.act, t.logp, rCard, done, t.value);
      if (full) {
        const lv = t.p.act(t.x, true).value;
        t.p.finishAndUpdate(lv);
        trained++;
      }
    }
    this.stats.steps++;
    if (done) {
      this.stats.episodes++;
      if (this.hooks.pushEpisodeReward) this.hooks.pushEpisodeReward(this._epReward);
      this._epReward = 0;
      sim.reset();
      task.reset(this.rng, sim);
      if (this.hooks.fireReset) this.hooks.fireReset();
      this._pendingTrans = [];
    }
    return trained;
  }

  startTraining() {
    if (this.training) return;
    if (this.hooks.stopMainTraining) this.hooks.stopMainTraining();
    this.training = true;
    this.stats.episodes = 0; this._epReward = 0;
    if (this.hooks.setMode) this.hooks.setMode('canvas');
    if (this.sim) { this.sim.reset(); if (this.task) this.task.reset(this.rng, this.sim); if (this.hooks.fireReset) this.hooks.fireReset(); }
    this.hooks.log('Canvas-TRAINING läuft — jede trainierbare Karte hat ihr eigenes PPO (global Aufgaben-Belohnung oder eigene Formel)', 'ok');
    this.hooks.toast('Canvas-Training an');
    this.syncButtons();
  }
  stopTraining(silent) {
    if (!this.training) return;
    this.training = false;
    if (!silent) { this.hooks.log('Canvas-Training pausiert'); this.hooks.toast('Canvas-Training aus'); }
    this.saveNow();
    this.syncButtons();
  }

  // ── Persistenz ────────────────────────────────────────────
  saveNow() {
    try {
      const nodes = [];
      for (const nd of this.graph.nodes) {
        const c = Object.assign({}, nd);
        if (nd.type === 'policy') {
          const p = this.ppo.get(nd.id);
          c.ppo = (p && p.stepCount > 0) ? p.toJSON() : (nd.ppo || null);
        }
        delete c._live;
        nodes.push(c);
      }
      const raw = { v: 2, view: this.graph.view, nodes, links: this.graph.links, nextId: this.graph.nextId };
      localStorage.setItem('tr_canvas_v2_' + (this.hooks.getRobotId ? this.hooks.getRobotId() : 'x'), JSON.stringify(raw));
    } catch (e) { /* Speicher voll — Canvas bleibt in der Session */ }
  }
  scheduleSave() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 800);
  }
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem('tr_canvas_v2_' + (this.hooks.getRobotId ? this.hooks.getRobotId() : 'x')) || 'null');
      const { g, errors } = sanitizeGraph(raw);
      this.graph = g;
      this.ppo.clear();
      for (const e of errors.slice(0, 4)) this.hooks.log('Canvas: ' + e, 'warn');
      this.attach();
    } catch (e) {
      this.graph = newGraph();
      this.ppo.clear();
      this.attach();
    }
  }
  clearAll() {
    this.graph = newGraph();
    this.ppo.clear();
    this.training = false;
    try { localStorage.removeItem('tr_canvas_v2_' + (this.hooks.getRobotId ? this.hooks.getRobotId() : 'x')); } catch (e) { /* egal */ }
    this.attach();
    this.hooks.log('Canvas geleert', 'warn');
  }

  /** JSON-Übersicht (für Gemini + Tests). */
  describe() {
    const nodes = this.graph.nodes.map(nd => {
      const base = { id: nd.id, type: nd.type, name: nd.name || nd.id, x: nd.x, y: nd.y };
      if (nd.type === 'io') { base.ports = this.graph._ioCount; base.portNamen = this._obsNames.length ? ['obs 0…' + (this._obsNames.length - 1), 'Stick X', 'Stick Y'] : []; }
      if (nd.type === 'out') { base.ports = this.graph._actCount; base.sink = nd.sink[0] || 'residual'; base.portNamen = this._actNames; }
      if (nd.type === 'policy') {
        base.nIn = nd.nIn; base.nOut = nd.nOut; base.hidden = nd.hidden;
        base.trainable = !!nd.trainable; base.reward = nd.reward; base.lr = nd.lr; base.T = nd.T;
        const p = this.ppo.get(nd.id);
        base.steps = p ? p.stepCount : (nd.steps || 0);
        base.lastReward = +(nd.lastR || 0).toFixed(3);
      }
      if (nd.type === 'ui') { base.kind = nd.kind; base.io = nd.io; base.label = nd.label; base.nOut = nd.nOut; base.hasCode = !!(nd.code && nd.code.trim()); }
      if (nd.type === 'const') base.values = nd.values;
      return base;
    });
    return {
      robot: this.hooks.getRobotId ? this.hooks.getRobotId() : null,
      task: this.task ? this.task.kind : null,
      obsPorts: this.graph._ioCount || 0,
      actPorts: this.graph._actCount || 0,
      training: this.training,
      mode: this.hooks.getMode ? this.hooks.getMode() : null,
      nodes, links: this.graph.links.map(l => ({ id: l.id, from: l.from, to: l.to })),
    };
  }

  // ── DOM: Editor + Kabel + Interaktion ─────────────────────
  /** Sheet-Elemente übernehmen (einmal beim Boot). els = {viewport, world, wires, uiBar, stat, info, edit, runBtn, trainBtn, sheet}. */
  mount(els) {
    this.dom = els;
    this._codeFn = {};
    this._zoom(els);
    // Pan/Pinch auf dem Hintergrund (v2.18.0: Zwei-Finger-Zoom + -Verschieben)
    els.world.addEventListener('pointerdown', (e) => this._worldDown(e));
    // v2.18.0: Mausrad-Zoom um die Cursor-Position (Desktop/Tests)
    if (els.viewport) {
      els.viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
      }, { passive: false });
    }
    // Buttons
    if (els.runBtn) els.runBtn.addEventListener('click', () => { this.hooks.buzz(); this.hooks.toggleRun(); });
    if (els.trainBtn) els.trainBtn.addEventListener('click', () => { this.hooks.buzz(); if (this.training) this.stopTraining(); else this.startTraining(); });
    this.render();
  }

  _zoom(els) {
    this._vz = this.graph.view.z || 0.85;
    this._zmin = 0.22;  // v2.18.0: Vollbild → weiter rauszoomen (IO-Karten sind hoch)
    this._zmax = 2.4;
    const apply = () => {
      els.world.style.transform = 'translate(' + this.graph.view.x + 'px,' + this.graph.view.y + 'px) scale(' + this._vz + ')';
      this.graph.view.z = this._vz;
    };
    this._applyView = apply;
    apply();
  }
  _viewApply() { if (this._applyView) this._applyView(); }

  /** Hintergrund: 1 Finger = verschieben · 2 Finger = Pinch-ZOOM um Finger-Mitte + Verschieben (v2.18.0). */
  _worldDown(e) {
    if (e.target.closest('.cv-node') || e.target.closest('button') || e.target.closest('input')) return;
    const el = this.dom.world;
    const pointers = this._pan = this._pan || new Map();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetische Events (Tests) ohne echte Pointer-Id */ }
    this._pinch = null; // Baseline bei jedem Finger-Wechsel neu aufbauen
    this._vpRect = null; // Anker-Rect frisch messen
    const move = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const prev = pointers.get(ev.pointerId); // v2.18.0 FIX: alte Position VOR dem Überschreiben lesen (v2.17.0-Bug: Delta war immer 0 — Pan ging nicht)
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        this.graph.view.x += ev.clientX - prev.x;
        this.graph.view.y += ev.clientY - prev.y;
        this._viewApply();
      } else if (pointers.size >= 2) {
        // Pinch: Zoom um den MITTELPUNKT der beiden Finger + Verschieben mit der Mitte
        // v2.18.0: Mitte von CLIENT-Koordinaten in viewport-relative umrechnen
        // (view.x/y ist relativ zum Viewport — ohne Abzug springt der Anker um den Rand-Offset)
        if (!this._vpRect) this._vpRect = this.dom.viewport.getBoundingClientRect();
        const pts = [...pointers.values()].slice(0, 2);
        const cx = (pts[0].x + pts[1].x) / 2 - this._vpRect.left;
        const cy = (pts[0].y + pts[1].y) / 2 - this._vpRect.top;
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (!this._pinch || this._pinch.n !== pointers.size) {
          this._pinch = { d: dist || 1, cx, cy, n: pointers.size, z: this._vz, vx: this.graph.view.x, vy: this.graph.view.y };
          return;
        }
        const target = this._pinch.z * Math.max(0.2, Math.min(8, dist / this._pinch.d));
        const z1 = Math.max(this._zmin, Math.min(this._zmax, target));
        const wx = (this._pinch.cx - this._pinch.vx) / this._pinch.z;
        const wy = (this._pinch.cy - this._pinch.vy) / this._pinch.z;
        this._vz = z1;
        this.graph.view.x = cx - wx * z1;
        this.graph.view.y = cy - wy * z1;
        this._viewApply();
      }
    };
    const up = (ev) => {
      pointers.delete(ev.pointerId);
      this._pinch = null; // Rest-Finger pannt weiter OHNE Sprung (Delta-basiert)
      if (!pointers.size) {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (this._pending && !this._pending.moved) { this._pending = null; this._drawTemp(null); }
        this.scheduleSave();
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Zoom um einen Bildschirmpunkt (px/py = clientX/clientY; ohne Angabe = Viewport-Mitte). */
  zoomBy(f, px, py) {
    const vp = this.dom.viewport;
    if (!vp) { this._vz = Math.max(this._zmin, Math.min(this._zmax, this._vz * f)); this._viewApply(); this.scheduleSave(); return; }
    const r = vp.getBoundingClientRect();
    const cx = px != null ? px - r.left : r.width / 2;
    const cy = py != null ? py - r.top : r.height / 2;
    const z0 = this._vz;
    const z1 = Math.max(this._zmin, Math.min(this._zmax, z0 * f));
    if (z1 === z0) return;
    // Weltpunkt unter dem Anker halten → geometrisch sauberer Zoom
    const wx = (cx - this.graph.view.x) / z0;
    const wy = (cy - this.graph.view.y) / z0;
    this._vz = z1;
    this.graph.view.x = cx - wx * z1;
    this.graph.view.y = cy - wy * z1;
    this._viewApply();
    this.scheduleSave();
  }
  fitView() {
    const vp = this.dom.viewport;
    if (!vp) return;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const nd of this.graph.nodes) {
      minX = Math.min(minX, nd.x); minY = Math.min(minY, nd.y);
      maxX = Math.max(maxX, nd.x + 200); maxY = Math.max(maxY, nd.y + 160);
    }
    if (minX > maxX) return;
    const z = Math.min(1.2, Math.max(this._zmin, Math.min(vp.clientWidth / (maxX - minX + 80), vp.clientHeight / (maxY - minY + 80))));
    this._vz = z;
    this.graph.view.x = 20 - minX * z;
    this.graph.view.y = 20 - minY * z;
    this._viewApply();
  }

  _nodeEl(nd) {
    const el = document.createElement('div');
    el.className = 'cv-node cv-' + nd.type + (nd.type === 'policy' && !nd.trainable ? ' cv-frozen' : '');
    el.dataset.id = nd.id;
    el.style.left = nd.x + 'px';
    el.style.top = nd.y + 'px';

    const head = document.createElement('div');
    head.className = 'cv-nhead';
    const nm = document.createElement('span');
    nm.className = 'cv-nname';
    nm.textContent = nd.type === 'io' ? 'SENSOREN · EINGÄNGE' : nd.type === 'out' ? 'AKTUATOREN · AUSGÄNGE' : nd.name;
    const sub = document.createElement('span');
    sub.className = 'cv-nsub';
    sub.textContent = nd.type === 'policy'
      ? nd.nIn + '→' + nd.hidden.join('/') + '→' + nd.nOut + (nd.trainable ? '' : ' · FROZEN')
      : nd.type === 'ui' ? (nd.label + ' · ' + (nd.io === 'in' ? 'Eingang' : 'Ausgang'))
      : nd.type === 'const' ? nd.values.join(', ')
      : nd.type === 'io' ? (this.graph._ioCount || 0) + ' Ports'
      : (this.graph._actCount || 0) + ' Ports';
    head.append(nm, sub);
    if (nd.type !== 'io' && nd.type !== 'out') {
      const gear = document.createElement('button');
      gear.className = 'cv-nbtn';
      gear.textContent = '⚙';
      gear.title = 'Einstellungen';
      gear.addEventListener('pointerdown', (e) => e.stopPropagation());
      gear.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.buzz(); this.openEdit(nd.id); });
      const del = document.createElement('button');
      del.className = 'cv-nbtn cv-del';
      del.textContent = '×';
      del.title = 'Löschen';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.buzz(); this.removeNodeUI(nd.id); });
      head.append(gear, del);
    } else if (nd.type === 'out') {
      const gear = document.createElement('button');
      gear.className = 'cv-nbtn';
      gear.textContent = '⚙';
      gear.title = 'Senke: Residuum/Direkt';
      gear.addEventListener('pointerdown', (e) => e.stopPropagation());
      gear.addEventListener('click', (e) => { e.stopPropagation(); this.openEdit(OUT_ID); });
      head.append(gear);
    }
    el.append(head);

    const body = document.createElement('div');
    body.className = 'cv-nbody';
    const nIn = nodeInCount(this.graph, nd), nOut = nodeOutCount(this.graph, nd);
    if (nIn > 0) {
      const col = document.createElement('div');
      col.className = 'cv-col';
      for (let p = 0; p < nIn; p++) {
        const row = document.createElement('div');
        row.className = 'cv-port cv-in';
        row.dataset.port = p;
        row.dataset.side = 'in';
        const dot = document.createElement('i');
        dot.className = 'dot';
        const lb = document.createElement('span');
        lb.className = 'cv-plabel';
        lb.textContent = this._portLabel(nd, p, 'in');
        row.append(dot, lb);
        row.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._portDown(nd, p, 'in', e); });
        col.append(row);
      }
      body.append(col);
    }
    if (nOut > 0) {
      const col = document.createElement('div');
      col.className = 'cv-col cv-colOut';
      for (let p = 0; p < nOut; p++) {
        const row = document.createElement('div');
        row.className = 'cv-port cv-out';
        row.dataset.port = p;
        row.dataset.side = 'out';
        const dot = document.createElement('i');
        dot.className = 'dot';
        const lb = document.createElement('span');
        lb.className = 'cv-plabel';
        lb.textContent = this._portLabel(nd, p, 'out');
        row.append(lb, dot);
        row.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._portDown(nd, p, 'out', e); });
        col.append(row);
      }
      body.append(col);
    }
    if (nIn === 0 && nOut === 0) {
      const empty = document.createElement('div');
      empty.className = 'cv-empty';
      empty.textContent = nd.type === 'ui' ? 'ohne Ports (Kind: ' + nd.kind + ')' : '—';
      body.append(empty);
    }
    el.append(body);

    if (nd.type === 'policy') {
      const foot = document.createElement('div');
      foot.className = 'cv-nfoot';
      foot.dataset.foot = nd.id;
      foot.textContent = 'R – · 0 Schritte';
      el.append(foot);
    }
    // Ziehen am Kopf (v2.18.0: Drag-Lock — ein Zeiger pro Karte, zweiter Finger startet keinen Zweitzug)
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cv-nbtn')) return;
      if (this._dragPtr != null) return;
      e.stopPropagation();
      this._dragPtr = e.pointerId;
      const startX = e.clientX, startY = e.clientY, ox = nd.x, oy = nd.y;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetische Events */ }
      const move = (ev) => {
        if (this._dragPtr !== ev.pointerId) return;
        nd.x = Math.round(ox + (ev.clientX - startX) / this._vz);
        nd.y = Math.round(oy + (ev.clientY - startY) / this._vz);
        el.style.left = nd.x + 'px'; el.style.top = nd.y + 'px';
        this._drawWires();
      };
      const up = (ev) => {
        if (ev && ev.pointerId !== undefined && this._dragPtr !== ev.pointerId) return;
        this._dragPtr = null;
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        this.scheduleSave();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    return el;
  }

  _portLabel(nd, p, side) {
    if (nd.type === 'io') {
      if (p >= this._obsNames.length) return p === this._obsNames.length ? 'Stick X' : 'Stick Y';
      return this._obsNames[p] || ('obs ' + p);
    }
    if (nd.type === 'out') return this._actNames[p] || ('akt ' + p);
    if (nd.type === 'policy') return side === 'in' ? 'in ' + p : 'out ' + p;
    if (nd.type === 'const') return String(nd.values[p]);
    if (nd.type === 'ui') {
      if (nd.kind === 'joy') return p === 0 ? nd.label + ' X' : nd.label + ' Y';
      return nd.label + (nd.kind === 'code' && side === 'out' ? '[' + p + ']' : '');
    }
    return String(p);
  }

  _portDown(nd, port, side, e) {
    const pend = this._pending;
    if (pend && !(pend.n === nd.id && pend.port === port && pend.side === side)) {
      // Tap-Tap: verbinden
      const a = pend.side === 'out' ? { n: pend.n, port: pend.port } : { n: nd.id, port };
      const b = pend.side === 'out' ? { n: nd.id, port } : { n: pend.n, port: pend.port };
      this._pending = null;
      this._drawTemp(null);
      this._tryLink(a, b);
      return;
    }
    if (pend) { this._pending = null; this._drawTemp(null); return; }
    this._pending = { n: nd.id, port, side, x0: e.clientX, y0: e.clientY, moved: false };
    this._drawTemp([e.clientX, e.clientY]);
    const move = (ev) => {
      if (!this._pending) { cleanup(); return; }
      if (Math.hypot(ev.clientX - this._pending.x0, ev.clientY - this._pending.y0) > 10) this._pending.moved = true;
      this._drawTemp([ev.clientX, ev.clientY]);
    };
    const up = (ev) => {
      cleanup();
      const pend2 = this._pending;
      this._pending = null;
      this._drawTemp(null);
      if (pend2 && pend2.moved) {
        const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = tgt && tgt.closest ? tgt.closest('.cv-port') : null;
        if (row) {
          const nodeEl = row.closest('.cv-node');
          if (nodeEl) {
            const p2 = +row.dataset.port, s2 = row.dataset.side;
            const a = pend2.side === 'out' ? { n: pend2.n, port: pend2.port } : { n: nodeEl.dataset.id, port: p2 };
            const b = pend2.side === 'out' ? { n: nodeEl.dataset.id, port: p2 } : { n: pend2.n, port: pend2.port };
            this._tryLink(a, b);
          }
        }
      }
      // ohne Bewegung: Kabel bleibt „hängend" (Tap-Tap)
      else if (pend2) { this._pending = pend2; this._drawTemp(null); }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _tryLink(a, b) {
    const res = addLink(this.graph, a, b);
    if (res.ok) {
      this._cacheLinks();
      this.hooks.buzz(8);
      const fN = findNode(this.graph, a.n), tN = findNode(this.graph, b.n);
      this.hooks.log('Canvas: ' + (fN.name || fN.id) + '[' + a.port + '] → ' + (tN.name || tN.id) + '[' + b.port + ']');
    } else {
      this.hooks.toast('Kabel: ' + res.error, true);
    }
    this.render();
    this.scheduleSave();
  }

  _portPos(nid, port, side) {
    const sel = '.cv-node[data-id="' + nid + '"] .cv-port[data-port="' + port + '"][data-side="' + side + '"] .dot';
    const dot = this.dom.world.querySelector(sel);
    const wr = this.dom.world.getBoundingClientRect();
    if (!dot) return null;
    const r = dot.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - wr.left) / this._vz, y: (r.top + r.height / 2 - wr.top) / this._vz };
  }

  _wirePath(a, b) {
    const dx = Math.max(36, Math.min(130, Math.abs(b.x - a.x) * 0.5));
    return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
  }

  _drawWires() {
    if (!this.dom) return;
    const svg = this.dom.wires;
    let html = '';
    for (const l of this.graph.links) {
      const p1 = this._portPos(l.from.n, l.from.port, 'out');
      const p2 = this._portPos(l.to.n, l.to.port, 'in');
      if (!p1 || !p2) continue;
      html += '<path class="cv-wire' + (l.to.n === OUT_ID ? ' cv-wsink' : '') + '" d="' + this._wirePath(p1, p2) + '" data-link="' + l.id + '"/>';
      html += '<circle class="cv-wdot" cx="' + p2.x + '" cy="' + p2.y + '" r="2.6" data-link="' + l.id + '"/>';
    }
    svg.innerHTML = html;
  }

  _drawTemp(screenPt) {
    const svg = this.dom.wires;
    let t = svg.querySelector('.cv-wtemp');
    if (!screenPt) { if (t) t.remove(); return; }
    const wr = this.dom.world.getBoundingClientRect();
    const x = (screenPt[0] - wr.left) / this._vz, y = (screenPt[1] - wr.top) / this._vz;
    const p0 = this._portPos(this._pending.n, this._pending.port, this._pending.side);
    if (!p0) return;
    const d = this._wirePath(p0, { x, y });
    if (!t) {
      t = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      t.setAttribute('class', 'cv-wtemp');
      svg.appendChild(t);
    }
    t.setAttribute('d', d);
  }

  // ── Render ────────────────────────────────────────────────
  render() {
    if (!this.dom) return;
    const w = this.dom.world;
    w.querySelectorAll('.cv-node').forEach(el => el.remove());
    for (const nd of this.graph.nodes) w.append(this._nodeEl(nd));
    this._drawWires();
    this._viewApply();
    this.renderUIBar();
    this.syncButtons();
  }

  /** Karten-Fußzeilen + UI-Anzeigen aktualisieren (je Frame, billig). */
  renderLive() {
    if (!this.dom) return;
    for (const nd of this.graph.nodes) {
      if (nd.type !== 'policy') continue;
      const el = this.dom.world.querySelector('[data-foot="' + nd.id + '"]');
      if (!el) continue;
      const p = this.ppo.get(nd.id);
      const steps = p ? p.stepCount : (nd.steps || 0);
      const m = p && p.metrics ? p.metrics : null;
      el.textContent = 'R ' + (nd.lastR || 0).toFixed(2) + ' · ' + (steps >= 1000 ? (steps / 1000).toFixed(1) + 'k' : steps) + ' Schritte' + (m && m.piLoss !== undefined ? ' · L ' + (m.piLoss || 0).toFixed(3) : '');
    }
    // Ausgangs-UI (gauge/light) füttern
    for (const nd of this.graph.nodes) {
      if (nd.type !== 'ui' || nd.io !== 'out') continue;
      const link = this._inLink.get(nd.id + ':0');
      const v = link ? this._sourceValue(link.from) : 0;
      const el = this._uiEls && this._uiEls.get(nd.id);
      if (!el) continue;
      if (nd.kind === 'gauge') {
        el.fill.style.width = Math.max(0, Math.min(100, (v + 1) * 50)) + '%';
        el.val.textContent = (+v).toFixed(2);
      } else if (nd.kind === 'light') {
        el.dot.classList.toggle('lit', v > 0.5);
      }
    }
  }

  /** Laufzeit-Leiste (Buttons/Slider/Joystick/Gauge) unterhalb des Sheets. */
  renderUIBar() {
    const bar = this.dom.uiBar;
    if (!bar) return;
    bar.innerHTML = '';
    this._uiEls = new Map();
    const uis = this.graph.nodes.filter(n => n.type === 'ui');
    if (!uis.length) { bar.classList.add('hidden'); return; }
    const title = document.createElement('span');
    title.className = 'cv-uibar-title';
    title.textContent = 'CANVAS-UI';
    bar.append(title);
    for (const nd of uis) {
      const wrap = document.createElement('span');
      wrap.className = 'cv-uiel cv-uik-' + nd.kind;
      wrap.dataset.uid = nd.id;
      if (nd.kind === 'button') {
        const b = document.createElement('button');
        b.className = 'ai-btn';
        b.textContent = nd.label;
        b.addEventListener('pointerdown', () => { nd.state.pressed = true; b.classList.add('on'); });
        const rel = () => { nd.state.pressed = false; b.classList.remove('on'); this.scheduleSave(); };
        b.addEventListener('pointerup', rel);
        b.addEventListener('pointerleave', rel);
        b.addEventListener('pointercancel', rel);
        wrap.append(b);
      } else if (nd.kind === 'toggle') {
        const b = document.createElement('button');
        b.className = 'ai-btn' + (nd.state.on ? ' on' : '');
        b.textContent = nd.label + ': ' + (nd.state.on ? 'AN' : 'aus');
        b.addEventListener('click', () => { nd.state.on = !nd.state.on; b.classList.toggle('on', nd.state.on); b.textContent = nd.label + ': ' + (nd.state.on ? 'AN' : 'aus'); this.hooks.buzz(8); this.scheduleSave(); });
        wrap.append(b);
      } else if (nd.kind === 'slider') {
        const lb = document.createElement('span');
        lb.className = 'cv-ui-lbl';
        lb.textContent = nd.label;
        const s = document.createElement('input');
        s.type = 'range'; s.min = '0'; s.max = '1'; s.step = '0.01';
        s.value = String(Number.isFinite(nd.state.value) ? nd.state.value : 0);
        s.addEventListener('input', () => { nd.state.value = +s.value; this.scheduleSave(); });
        wrap.append(lb, s);
      } else if (nd.kind === 'joy') {
        const pad = document.createElement('div');
        pad.className = 'cv-joy';
        const stick = document.createElement('i');
        stick.className = 'cv-joystick';
        pad.append(stick);
        const set = (e) => {
          const r = pad.getBoundingClientRect();
          nd.state.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
          nd.state.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
          stick.style.left = (50 + nd.state.x * 40) + '%';
          stick.style.top = (50 + nd.state.y * 40) + '%';
        };
        pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); set(e); });
        pad.addEventListener('pointermove', (e) => { if (e.buttons || (e.pointerType === 'touch' && e.pressure > 0)) set(e); });
        const rel = () => { nd.state.x = 0; nd.state.y = 0; stick.style.left = '50%'; stick.style.top = '50%'; this.scheduleSave(); };
        pad.addEventListener('pointerup', rel);
        pad.addEventListener('pointercancel', rel);
        pad.addEventListener('pointerleave', rel);
        wrap.append(pad);
      } else if (nd.kind === 'gauge') {
        const lb = document.createElement('span');
        lb.className = 'cv-ui-lbl';
        lb.textContent = nd.label;
        const gauge = document.createElement('span');
        gauge.className = 'cv-gauge';
        const fill = document.createElement('i');
        gauge.append(fill);
        const val = document.createElement('span');
        val.className = 'cv-ui-val';
        val.textContent = '0,00';
        wrap.append(lb, gauge, val);
        this._uiEls.set(nd.id, { fill, val });
      } else if (nd.kind === 'light') {
        const lb = document.createElement('span');
        lb.className = 'cv-ui-lbl';
        lb.textContent = nd.label;
        const dot = document.createElement('i');
        dot.className = 'cv-light';
        wrap.append(lb, dot);
        this._uiEls.set(nd.id, { dot });
      } else { // code
        const b = document.createElement('span');
        b.className = 'cv-uicode';
        b.textContent = '⌘ ' + nd.name + (nd.io === 'in' ? ' →' + nd.nOut : ' ←');
        b.title = nd.code || '';
        wrap.append(b);
      }
      bar.append(wrap);
    }
    bar.classList.remove('hidden');
  }

  syncButtons() {
    if (!this.dom || !this.dom.runBtn) return;
    const run = this.hooks.getMode ? this.hooks.getMode() === 'canvas' : false;
    this.dom.runBtn.textContent = run ? 'STOPP (zurück zu MANUELL)' : 'AUSFÜHREN';
    this.dom.runBtn.classList.toggle('btn-stop', run);
    this.dom.trainBtn.textContent = this.training ? 'TRAINING PAUSIEREN' : 'TRAINIEREN';
    this.dom.trainBtn.classList.toggle('btn-stop', this.training);
  }

  removeNodeUI(id) {
    try { removeNode(this.graph, id); } catch (e) { this.hooks.toast(e.message, true); return; }
    this.ppo.delete(id);
    this._cacheLinks();
    const ed = this.dom.edit;
    if (ed && !ed.classList.contains('hidden') && ed.dataset.id === id) ed.classList.add('hidden');
    this.render();
    this.scheduleSave();
  }

  // ── Edit-Panel (Karteneinstellungen) ──────────────────────
  openEdit(id) {
    const nd = findNode(this.graph, id);
    const ed = this.dom.edit;
    if (!nd) return;
    ed.innerHTML = '';
    ed.dataset.id = id;
    ed.classList.remove('hidden');
    const close = document.createElement('button');
    close.className = 'cv-nbtn cv-edit-close';
    close.textContent = '×';
    close.addEventListener('click', () => { ed.classList.add('hidden'); this.scheduleSave(); });
    const title = document.createElement('div');
    title.className = 'cv-edit-title';
    title.textContent = nd.type === 'policy' ? 'NETZ: ' + nd.name : nd.type === 'out' ? 'AKTUATOR-SENKEN' : nd.type === 'ui' ? 'UI: ' + nd.name : 'KONSTANTE';
    title.append(close);
    ed.append(title);

    const row = (labelText, input) => {
      const r = document.createElement('label');
      r.className = 'cv-edit-row';
      const s = document.createElement('span');
      s.textContent = labelText;
      r.append(s, input);
      return r;
    };
    const num = (val, min, max, step) => {
      const i = document.createElement('input');
      i.type = 'number'; i.value = String(val); i.min = String(min); i.max = String(max);
      if (step) i.step = String(step);
      return i;
    };

    if (nd.type === 'policy') {
      const name = document.createElement('input');
      name.type = 'text'; name.value = nd.name; name.maxLength = 24;
      ed.append(row('Name', name));
      const nIn = num(nd.nIn, 1, 64);
      const nOut = num(nd.nOut, 1, 32);
      const hid = document.createElement('input');
      hid.type = 'text'; hid.value = nd.hidden.join(','); hid.placeholder = 'z. B. 64,64';
      ed.append(row('Eingänge', nIn), row('Ausgänge', nOut), row('Hidden (Größen)', hid));
      const lr = num(nd.lr, 0.00001, 0.003, 0.00005);
      const T = num(nd.T, 128, 4096, 128);
      ed.append(row('Lernrate', lr), row('PPO-Puffer T', T));
      const tr = document.createElement('input');
      tr.type = 'checkbox'; tr.checked = !!nd.trainable;
      ed.append(row('Trainierbar', tr));
      // Belohnung
      const rmode = document.createElement('div');
      rmode.className = 'cv-chips';
      for (const m of ['global', 'custom']) {
        const c = document.createElement('button');
        c.className = 'cv-chip' + (nd.reward.mode === m ? ' active' : '');
        c.textContent = m === 'global' ? 'GLOBALE Belohnung' : 'EIGENE Formel';
        c.addEventListener('click', () => { nd.reward.mode = m; for (const x of rmode.children) x.classList.toggle('active', x === c); });
        rmode.append(c);
      }
      ed.append(row('Belohnung', rmode));
      const sc = num(nd.reward.scale, 0, 3, 0.1);
      ed.append(row('Skala (global)', sc));
      const wIns = {};
      for (const [k, [lo, hi, dflt]] of Object.entries(CARD_R_FIELDS)) {
        const wi = num(nd.reward.w[k] != null ? nd.reward.w[k] : dflt, lo, hi, 0.01);
        wIns[k] = wi;
        const lab = { alive: 'Leben (+)', up: 'Aufrecht (+)', vel: 'Vorwärts (+)', turn: 'Drehen (+)', energy: 'Energie (−)', fall: 'Sturz (−)' }[k];
        ed.append(row(lab, wi));
      }
      const info = document.createElement('div');
      info.className = 'cv-edit-note';
      const p = this.ppo.get(nd.id);
      info.textContent = 'Netz: ' + (p ? p.net.paramCount() : '?') + ' Parameter · ' + (p ? p.stepCount : 0) + ' Schritte gelernt. Architekturwechsel setzt das Netz zurück.';
      ed.append(info);
      const rowBtns = document.createElement('div');
      rowBtns.className = 'cv-edit-btns';
      const apply = document.createElement('button');
      apply.className = 'btn small btn-solid';
      apply.textContent = 'Übernehmen';
      apply.addEventListener('click', () => {
        const archChanged = nd.hidden.join(',') !== hid.value.split(',').map(x => x.trim()).filter(Boolean).join(',') || nd.nIn !== Math.round(+nIn.value) || nd.nOut !== Math.round(+nOut.value);
        nd.name = (name.value || nd.name).slice(0, 24);
        nd.nIn = Math.max(1, Math.min(64, Math.round(+nIn.value) || nd.nIn));
        nd.nOut = Math.max(1, Math.min(32, Math.round(+nOut.value) || nd.nOut));
        const hidArr = hid.value.split(',').map(x => Math.round(+x.trim())).filter(x => Number.isFinite(x) && x >= 8 && x <= 256).slice(0, 3);
        if (hidArr.length) nd.hidden = hidArr;
        nd.lr = Math.max(0.00001, Math.min(0.003, +lr.value || nd.lr));
        nd.T = Math.max(128, Math.min(4096, Math.round(+T.value) || nd.T));
        nd.trainable = tr.checked;
        nd.reward.scale = Math.max(0, Math.min(3, +sc.value || 0));
        for (const k of Object.keys(CARD_R_FIELDS)) nd.reward.w[k] = Math.max(CARD_R_FIELDS[k][0], Math.min(CARD_R_FIELDS[k][1], +wIns[k].value || 0));
        if (archChanged) { nd.ppo = null; this.ppo.delete(nd.id); this._ensurePPO(nd); this.hooks.log('Canvas: „' + nd.name + '" neue Architektur — Netz frisch', 'warn'); }
        else { const pp = this.ppo.get(nd.id); if (pp) pp.h.lr = nd.lr; }
        // Kabel über neue Portgrenzen stutzen
        this.graph.links = this.graph.links.filter(l => {
          const tN = findNode(this.graph, l.to.n), fN = findNode(this.graph, l.from.n);
          if (tN && tN.id === nd.id && l.to.port >= nd.nIn) return false;
          if (fN && fN.id === nd.id && l.from.port >= nd.nOut) return false;
          return true;
        });
        this._cacheLinks();
        this.render();
        this.scheduleSave();
        this.hooks.toast('Karte gespeichert');
        ed.classList.add('hidden');
      });
      const imp = document.createElement('button');
      imp.className = 'btn small';
      imp.textContent = 'App-Policy laden';
      imp.title = 'Trainierte Policy des normalen Trainings in diese Karte laden (64×64, Maße müssen passen)';
      imp.addEventListener('click', () => {
        try {
          const json = this.hooks.getMainPolicyJSON ? this.hooks.getMainPolicyJSON() : null;
          if (!json) { this.hooks.toast('Keine App-Policy im Speicher', true); return; }
          if (json.obsDim !== nd.nIn || json.actDim !== nd.nOut) { this.hooks.toast('Maße passen nicht (' + json.obsDim + '→' + json.actDim + ' vs. ' + nd.nIn + '→' + nd.nOut + ')', true); return; }
          const p = cardPPOFromAppPolicy(json);
          this.ppo.set(nd.id, p);
          nd.ppo = p.toJSON();
          this.render();
          this.scheduleSave();
          this.hooks.log('Canvas: App-Policy in „' + nd.name + '" geladen (' + p.stepCount + ' Schritte)', 'ok');
          this.hooks.toast('App-Policy geladen');
          ed.classList.add('hidden');
        } catch (e) { this.hooks.toast('Import: ' + e.message, true); }
      });
      const del = document.createElement('button');
      del.className = 'btn small';
      del.textContent = 'Löschen';
      del.addEventListener('click', () => { this.removeNodeUI(nd.id); });
      rowBtns.append(apply, imp, del);
      ed.append(rowBtns);
    } else if (nd.type === 'ui') {
      const name = document.createElement('input');
      name.type = 'text'; name.value = nd.name; name.maxLength = 20;
      ed.append(row('Name', name));
      const lbl = document.createElement('input');
      lbl.type = 'text'; lbl.value = nd.label; lbl.maxLength = 16;
      ed.append(row('Beschriftung', lbl));
      if (nd.kind === 'code') {
        const ioSel = document.createElement('select');
        for (const [v, t] of [['in', 'Eingang (liefert Werte)'], ['out', 'Ausgang (empfängt Wert)']]) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          if (nd.io === v) o.selected = true;
          ioSel.append(o);
        }
        ed.append(row('Richtung', ioSel));
        if (nd.io === 'in') {
          const nOut = num(nd.nOut, 1, 4);
          ed.append(row('Anzahl Ausgänge', nOut));
          nd._editNOut = nOut;
        }
        nd._editIo = ioSel;
        const code = document.createElement('textarea');
        code.className = 'cv-code';
        code.rows = 6;
        code.value = nd.code || '';
        code.placeholder = 'return [Math.sin(ctx.t)];   // ctx = {t, dt, state}';
        ed.append(row('Code', code));
        nd._editCode = code;
      }
      const rowBtns = document.createElement('div');
      rowBtns.className = 'cv-edit-btns';
      const apply = document.createElement('button');
      apply.className = 'btn small btn-solid';
      apply.textContent = 'Übernehmen';
      apply.addEventListener('click', () => {
        nd.name = (name.value || nd.name).slice(0, 20);
        nd.label = (lbl.value || nd.label).slice(0, 16);
        if (nd.kind === 'code') {
          const newIo = nd._editIo.value;
          if (newIo !== nd.io) { nd.io = newIo; this.graph.links = this.graph.links.filter(l => l.from.n !== nd.id && l.to.n !== nd.id); }
          if (nd.io === 'in') nd.nOut = Math.max(1, Math.min(4, Math.round(+nd._editNOut.value) || 1));
          nd._codeRev = (nd._codeRev || 0) + 1;
          if (this._codeFn) delete this._codeFn[nd.id + ':' + (nd._codeRev - 1)];
          nd.code = nd._editCode.value.slice(0, 2000);
          try { new Function('ctx', '"use strict";' + nd.code); } catch (e) { this.hooks.toast('Syntax-Fehler: ' + e.message, true); }
        }
        this._cacheLinks();
        this.render();
        this.scheduleSave();
        ed.classList.add('hidden');
      });
      const del = document.createElement('button');
      del.className = 'btn small';
      del.textContent = 'Löschen';
      del.addEventListener('click', () => this.removeNodeUI(nd.id));
      rowBtns.append(apply, del);
      ed.append(rowBtns);
    } else if (nd.type === 'const') {
      const vals = document.createElement('input');
      vals.type = 'text';
      vals.value = nd.values.join(',');
      ed.append(row('Werte (Komma)', vals));
      const apply = document.createElement('button');
      apply.className = 'btn small btn-solid';
      apply.textContent = 'Übernehmen';
      apply.addEventListener('click', () => {
        const arr = vals.value.split(',').map(x => +x.trim()).filter(Number.isFinite).slice(0, 8);
        if (arr.length) { nd.values = arr; this.graph.links = this.graph.links.filter(l => !(l.from.n === nd.id && l.from.port >= arr.length)); }
        this._cacheLinks();
        this.render();
        this.scheduleSave();
        ed.classList.add('hidden');
      });
      ed.append(apply);
    } else if (nd.type === 'out') {
      const note = document.createElement('div');
      note.className = 'cv-edit-note';
      note.textContent = 'RESIDUUM: Wert −1…1 → tanh × Aktionsamplitude um die Ruhe-/Keyframe-Pose (wie App-Policies). DIREKT: Rohwert als Reglersoll (auf ctrlrange geklemmt) — z. B. Rotoren.';
      ed.append(note);
      const sel = document.createElement('select');
      for (const [v, t] of [['residual', 'RESIDUUM (empfohlen)'], ['direct', 'DIREKT (Rohwert)']]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if ((nd.sink[0] || 'residual') === v) o.selected = true;
        sel.append(o);
      }
      ed.append(row('Senke (alle Ports)', sel));
      const apply = document.createElement('button');
      apply.className = 'btn small btn-solid';
      apply.textContent = 'Übernehmen';
      apply.addEventListener('click', () => {
        for (let a = 0; a < (this.graph._actCount || 0); a++) nd.sink[a] = sel.value;
        this.scheduleSave();
        ed.classList.add('hidden');
        this.hooks.toast('Senke: ' + sel.value.toUpperCase());
      });
      ed.append(apply);
    }
  }
}
