// ═══════════════════════════════════════════════════════════
// parallel.js — PARALLELES TRAINING: N MuJoCo-WASM-Instanzen in
// Web Workers (je CPU-Kern eine), Erfahrungen werden pro Runde
// eingesammelt und in EIN gemeinsames PPO-Update gemischt
// (vektorisiertes PPO, synchron — on-policy, kein Staleness).
//
// Der Haupt-Thread behält die AUTORITATIVE PPO-Instanz (S.trainer):
// Gewichte → Worker (Schnappschuss), Segmente zurück → mergeSegments()
// → neue Gewichte. Speichern/Laden/BC/KI-Patches funktionieren
// unverändert, weil alles auf S.trainer läuft.
//
// Robustheit: Startet gestaffelt (WASM-Kompilierung), jeden Worker
// 30 s Zeit, Ausfälle werden aus der Runde genommen; fällt KEIN
// Worker zuständig auf, wirft start() — main.js macht dann weiter
// wie bisher (Inline-Training im Haupt-Thread).
// ═══════════════════════════════════════════════════════════

const WORKER_URL = new URL('./simworker.js', import.meta.url);

export function suggestWorkerCount() {
  let hc = 4;
  try { hc = navigator.hardwareConcurrency || 4; } catch (e) { /* alt */ }
  let mem = 8;
  try { mem = navigator.deviceMemory || 8; } catch (e) { /* egal */ }
  // 1 Kern für UI/Render lassen; kleine Geräte drosseln
  const cap = mem <= 2 ? 2 : 6;
  return Math.max(1, Math.min(cap, hc - 1));
}

export class ParallelTrainer {
  /**
   * @param getPPO () => PPO         — autoritative Instanz (S.trainer)
   * @param onSegment (info) => void — nach JEDEM Merge (Metriken, Episoden)
   * @param log (msg, cls) => void
   */
  constructor({ getPPO, onSegment, log, workerFactory }) {
    this.getPPO = getPPO;
    this.onSegment = onSegment;
    this.log = log || (() => {});
    this._factory = workerFactory || ((url, opts) => new Worker(url, opts)); // test-injizierbar
    this.workers = new Map();   // workerId → {w, ready, rolling}
    this.pending = new Map();   // workerId → segment (laufende Runde)
    this.version = 0;
    this.round = 0;
    this.active = false;
    this.starting = true; // Worker booten — Haupt-Thread hält Inline-Training an
    this.stopped = false;
    this._steps = [];           // {n, t} für Schritte/s
    this.rate = 0;
    this.n = 0;
  }

  /**
   * Worker starten. taskSpec = {kind, …} — für 'motion' mit clip
   * (strukturiert klonbar). hyper = PPO-Hyperparameter (T = Segmentlänge
   * je Worker). Gibt die Zahl einsatzbereiter Worker zurück.
   */
  async start({ robotId, taskSpec, worldXml, hyper, seed, n, wasm }) {
    try {
      const wasmBuf = wasm || await loadWasmBinary();
    const plan = Math.max(1, n | 0);
    const ready = [];
    for (let i = 0; i < plan; i++) {
      if (this.stopped) break;
      try {
        const w = this._factory(WORKER_URL, { type: 'module' });
        const entry = { w, ready: false, rolling: false };
        this.workers.set(i, entry);
        const ok = await this._boot(i, entry, { robotId, taskSpec, worldXml, hyper, seed, wasm: wasmBuf });
        if (ok) ready.push(i);
        else {
          this.workers.delete(i);
          this.log(`Worker ${i} nicht startbar${entry.bootErr ? ': ' + entry.bootErr : ''}`, 'warn');
        }
      } catch (e) {
        this.workers.delete(i);
        this.log(`Worker ${i} nicht startbar: ${e.message}`, 'warn');
      }
      if (i < plan - 1) await new Promise(r => setTimeout(r, 300)); // gestaffelt
    }
    if (!ready.length) throw new Error('Kein Sim-Worker bereit');
    this.n = ready.length;
    this.active = true;
    this.starting = false;
    this.stopped = false;
    for (const i of ready) this._listen(i);
    this.log(`PARALLEL AKTIV: ${this.n} MuJoCo-Worker (Segmente je ${hyper.T} Schritte)`, 'ok');
    this.kick();
    return this.n;
    } finally {
      this.starting = false;
    }
  }

  _boot(i, entry, { robotId, taskSpec, worldXml, hyper, seed, wasm }) {
    return new Promise((resolve) => {
      const t0 = setTimeout(() => { entry.bootErr = 'Timeout 30 s'; try { entry.w.terminate(); } catch (e) { /* egal */ } resolve(false); }, 30000);
      entry.w.onmessage = (e) => {
        const m = e.data;
        if (m.cmd === 'ready' && m.workerId === i) { clearTimeout(t0); entry.ready = true; entry.w.onmessage = null; resolve(true); }
        else if (m.cmd === 'error') { clearTimeout(t0); entry.bootErr = m.message; try { entry.w.terminate(); } catch (err) { /* egal */ } resolve(false); }
      };
      entry.w.onerror = (e) => { clearTimeout(t0); entry.bootErr = 'Worker-Fehler: ' + ((e && e.message) || 'unbekannt'); resolve(false); };
      entry.w.postMessage({ cmd: 'init', workerId: i, robotId, taskSpec, worldXml, hyper, seed: (seed || 1) + i * 131, wasmBinary: wasm });
    });
  }

  _listen(i) {
    const entry = this.workers.get(i);
    if (!entry) return;
    entry.w.onmessage = (e) => this._onMessage(i, e.data);
    entry.w.onerror = (e) => {
      this.log(`Sim-Worker ${i} abgestürzt — nimmt an der Runde nicht mehr teil`, 'warn');
      this.workers.delete(i);
      this._maybeMerge();
    };
  }

  _onMessage(i, m) {
    if (m.cmd === 'segment') {
      const entry = this.workers.get(i);
      if (entry) entry.rolling = false;
      this.pending.set(i, { obs: m.obs, act: m.act, logp: m.logp, rew: m.rew, done: m.done, val: m.val, lastVal: m.lastVal, n: m.n, episodes: m.episodes || 0, epRewards: m.epRewards || [] });
      this._bumpRate(m.n);
      this._maybeMerge();
    } else if (m.cmd === 'error') {
      this.log(`Sim-Worker ${m.workerId}: ${m.message}`, 'err');
      this.workers.delete(m.workerId);
      this._maybeMerge();
    }
  }

  _bumpRate(n) {
    const now = performance.now();
    this._steps.push({ n, t: now });
    while (this._steps.length && now - this._steps[0].t > 4000) this._steps.shift();
    let sn = 0;
    if (this._steps.length >= 2) {
      const span = (now - this._steps[0].t) / 1000;
      for (const s of this._steps) sn += s.n;
      this.rate = span > 0.2 ? sn / span : 0;
    }
  }

  /** Runde abschließen, sobald ALLE lebenden Worker geliefert haben. */
  _maybeMerge() {
    if (!this.active) return;
    const alive = [...this.workers.keys()];
    if (!alive.length) { this.active = false; this.log('Kein Sim-Worker mehr übrig — Paralleltraining endet', 'err'); return; }
    let missing = false;
    for (const i of alive) if (!this.pending.has(i)) { missing = true; break; }
    if (missing) return;
    // Alle Segmente da → EIN gemeinsames PPO-Update
    const ppo = this.getPPO();
    const segs = [];
    let episodes = 0;
    const epRewards = [];
    for (const i of alive) {
      const s = this.pending.get(i);
      this.pending.delete(i);
      segs.push({ obs: s.obs, act: s.act, logp: s.logp, rew: s.rew, done: s.done, val: s.val, lastVal: s.lastVal, n: s.n });
      episodes += s.episodes;
      for (const r of s.epRewards) if (epRewards.length < 48) epRewards.push(r);
    }
    this.round++;
    const metrics = ppo.mergeSegments(segs);
    this.version++;
    this.onSegment({
      round: this.round, version: this.version, steps: segs.reduce((a, s) => a + s.n, 0),
      episodes, epRewards, metrics, rate: this.rate,
    });
    this.kick();
  }

  /** Neue Gewichte + Umgebungseinstellungen an alle Worker. */
  kick() {
    if (!this.active || this.stopped) return;
    const ppo = this.getPPO();
    if (!ppo) return;
    const net = ppo.net, norm = ppo.norm;
    this.version++;
    for (const [i, entry] of this.workers) {
      if (!entry.ready) continue;
      entry.rolling = true;
      entry.w.postMessage({
        cmd: 'weights', version: this.version, T: ppo.h.T,
        net: {
          W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2,
          Wm: net.Wm, bm: net.bm, Wv: net.Wv, bv: net.bv, logStd: net.logStd,
        },
        norm: { mean: norm.mean, M2: norm.M2, count: norm.count },
        env: this.envCfg || null,
      });
    }
  }

  stop() {
    this.stopped = true;
    this.active = false;
    for (const [, entry] of this.workers) { try { entry.w.postMessage({ cmd: 'stop' }); entry.w.terminate(); } catch (e) { /* egal */ } }
    this.workers.clear();
    this.pending.clear();
    this.rate = 0;
  }
}

/** MuJoCo-WASM einmal laden und als ArrayBuffer an alle Worker reichen. */
let _wasmPromise = null;
function loadWasmBinary() {
  if (!_wasmPromise) {
    _wasmPromise = (async () => {
      const resp = await fetch(new URL('../vendor/mujoco.wasm', import.meta.url));
      if (!resp.ok) throw new Error('mujoco.wasm nicht ladbar (' + resp.status + ')');
      const buf = await resp.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 4));
      if (!(head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d)) {
        throw new Error('mujoco.wasm ist keine WebAssembly-Datei');
      }
      return buf;
    })();
  }
  return _wasmPromise;
}
