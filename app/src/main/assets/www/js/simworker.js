// ═══════════════════════════════════════════════════════════
// simworker.js (v2.10.0) — EINE MuJoCo-WASM-Umgebung pro CPU-Kern.
// Lädt denselben Engine-/Aufgaben-/PPO-Code wie der Haupt-Thread
// (echte ES-Module über WebViewAssetLoader-HTTPS-Origin) und rollt
// mit einem Gewichts-Schnappschuss Erfahrungen, die parallel.js
// für das gemeinsame PPO-Update einsammelt (vektorisiertes PPO).
//
// Die Rollout-Semantik ist eine 1:1-Kopie von main.js trainCtrlStep
// (v2.9.0): fireAct/fireReward-Hooks laufen über einen LEEREN
// PluginHost (Paralleltraining ist deaktiviert, solange ein Plugin
// aktiv ist — der Haupt-Thread prüft das vor dem Start).
//
// Protokoll:
//   main → worker {cmd:'init', wasmBinary, worldXml, robotId, taskSpec, hyper, seed}
//   worker → main  {cmd:'ready', obsDim, actDim, nu, timestep}
//   main → worker {cmd:'weights', version, T, net:{…}, norm:{…}, env:{…}}
//   worker → main  {cmd:'segment', version, workerId, obs, act, logp,
//                   rew, done, val, lastVal, n, episodes, epRewards[]}
//                   (TypedArrays werden TRANSFERIERT — null Kopie)
//   main → worker {cmd:'stop'}
// ═══════════════════════════════════════════════════════════

// Shim: plugins.js liest localStorage beim PluginHost-Start — Workers
// haben kein localStorage. Leerer Speicher = keine Plugins im Worker
// (Hooks sind dann bewusstlos: fireAct/fireReward reichen unverändert durch).
if (typeof localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

import { initEngine, fetchModelIntoFS, RobotSim, writeWorldFile } from './engine.js';
import { getRobot, makeTrackTask } from './robots.js';
import { makeMotionTask, MOTION_R } from './motiontask.js';
import { makeRecoveryTask, RECOVERY_R } from './recoverytask.js';
import { PluginHost } from './plugins.js';
import { PPO, finiteArr } from './train.js';

const CTRL_DT = 0.02;
const _noop = () => {};

let sim = null, task = null, ppo = null, pluginHost = null;
let workerId = 0, version = 0, segLen = 512;
let substeps = 10, rolling = false;
let envState = { fallMode: 'reset' };

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

function buildTask(spec, cfg, simRef) {
  if (spec.kind === 'motion') return makeMotionTask(cfg, spec.clip, simRef);
  if (spec.kind === 'recovery') return makeRecoveryTask(cfg, spec.mode || 'getup');
  return makeTrackTask(cfg); // 'speed' (Tempo-Tracking / Laufen lernen)
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.cmd === 'init') {
      workerId = m.workerId | 0;
      await initEngine(_noop, { wasmBinary: m.wasmBinary });
      const cfg = getRobot(m.robotId);
      if (!cfg) throw new Error('Unbekannter Roboter: ' + m.robotId);
      // WICHTIG: relative fetches lösen im Worker gegen die SKRIPT-URL auf
      // (js/…) — Modellpfad daher explizit gegen die Seitenwurzel auflösen.
      const modelBase = new URL('../models/' + cfg.dir, location.href).pathname;
      await fetchModelIntoFS(modelBase);
      // Dieselbe prozedurale Welt wie im Haupt-Thread (v2.7.0)
      writeWorldFile(cfg.dir, 'welt_live.xml', m.worldXml);
      sim = new RobotSim(cfg, 'welt_live.xml');
      task = buildTask(m.taskSpec, cfg, sim);
      pluginHost = new PluginHost(); // leer: keine Plugins im Worker
      if (m.env) applyEnv(m.env);
      task.reset({ range: (a, b) => a + Math.random() * (b - a), int: (n) => Math.floor(Math.random() * n), next: Math.random }, sim);
      pluginHost.fireReset();
      segLen = Math.max(64, Math.min(4096, (m.hyper && m.hyper.T) || 512));
      ppo = new PPO(task.obsDim, task.actDim, { T: segLen }, (m.seed || 1) + workerId * 7919);
      substeps = Math.max(1, Math.round(CTRL_DT / sim.timestep));
      post({
        cmd: 'ready', workerId, obsDim: task.obsDim, actDim: task.actDim,
        nu: sim.nu, timestep: sim.timestep, segLen,
      });
    } else if (m.cmd === 'weights') {
      if (!sim || rolling) return; // Rollout läuft — Version übersprungen
      version = m.version | 0;
      segLen = Math.max(64, Math.min(4096, m.T || segLen));
      applyWeights(m);
      if (m.env) applyEnv(m.env);
      rolling = true;
      runSegment();
      rolling = false;
    } else if (m.cmd === 'stop') {
      try { if (sim) sim.dispose(); } catch (err) { /* egal */ }
      self.close();
    }
  } catch (err) {
    post({ cmd: 'error', workerId, message: (err && err.message) || String(err) });
  }
};

function applyWeights(m) {
  const net = ppo.net, norm = ppo.norm;
  net.W1.set(m.net.W1); net.b1.set(m.net.b1);
  net.W2.set(m.net.W2); net.b2.set(m.net.b2);
  net.Wm.set(m.net.Wm); net.bm.set(m.net.bm);
  net.Wv.set(m.net.Wv); net.bv.set(m.net.bv);
  net.logStd.set(m.net.logStd);
  norm.mean.set(m.norm.mean); norm.M2.set(m.norm.M2); norm.count = m.norm.count;
}

/** KI-/Nutzer-Anpassungen an die Worker-Umgebung durchreichen. */
function applyEnv(env) {
  if (!env) return;
  if (env.rW && sim.cfg.rW) Object.assign(sim.cfg.rW, env.rW);
  if (env.done && sim.cfg.done) Object.assign(sim.cfg.done, env.done);
  if (env.cmd && sim.cfg.cmd) Object.assign(sim.cfg.cmd, env.cmd);
  if (env.actSpan !== undefined) sim.cfg.actSpan = env.actSpan;
  if (env.motionR) Object.assign(MOTION_R, env.motionR);
  if (env.recoveryR) Object.assign(RECOVERY_R, env.recoveryR);
  if (env.fallMode) envState.fallMode = env.fallMode;
}

/**
 * Rollout: 1:1-Semantik von main.js trainCtrlStep (v2.9.0) —
 * inkl. Plugin-Hook-Punkten (hier ohne Wirkung) und „Liegen lassen“.
 */
function runSegment() {
  const T = segLen, D = task.obsDim, A = task.actDim;
  const obs = new Float32Array(T * D);
  const act = new Float32Array(T * A);
  const logp = new Float32Array(T);
  const rew = new Float32Array(T);
  const done = new Uint8Array(T);
  const val = new Float32Array(T);
  const obsBuf = new Float32Array(D);
  let epReward = 0, episodes = 0;
  const epRewards = [];
  let t = 0;
  while (t < T) {
    if (task.stepsLeft <= 0 && task.sampleCmd) task.sampleCmd(ppo.rng);
    task.observe(sim, obsBuf);
    if (!finiteArr(obsBuf)) {
      sim.reset(); task.reset(ppo.rng, sim); pluginHost.fireReset();
      continue; // Schritt wiederholen
    }
    const a = ppo.act(obsBuf, false);
    task.actionToCtrl(sim, a.act);
    pluginHost.fireAct(sim, sim.ctrl); // Plugins dürfen ctrl umschreiben (hier: leer)
    sim.stepN(substeps);
    if (task.kind === 'motion') task.advance(CTRL_DT);
    let { r, done: dn } = task.reward(sim);
    const _o4 = 4 * sim.baseBody;
    const _bx = sim._xquat[_o4 + 1], _by = sim._xquat[_o4 + 2];
    const rw = pluginHost.fireReward(sim, {
      r, done: dn, task,
      upz: 1 - 2 * (_bx * _bx + _by * _by),
      height: sim._xpos[3 * sim.baseBody + 2],
    });
    r = rw.r; dn = rw.done;
    for (let i = 0; i < A; i++) task.lastAct[i] = a.act[i];
    epReward += r;
    obs.set(obsBuf, t * D);
    act.set(a.act, t * A);
    logp[t] = a.logp; rew[t] = r; done[t] = dn ? 1 : 0; val[t] = a.value;
    t++;
    if (dn) {
      episodes++;
      if (epRewards.length < 64) epRewards.push(epReward);
      epReward = 0;
      // v2.9.0 „Liegen lassen“ konsequent (wie main.js):
      const fx = sim._xquat[_o4 + 1], fy = sim._xquat[_o4 + 2];
      const fallen = (1 - 2 * (fx * fx + fy * fy)) < sim.cfg.done.upMin;
      const stayDown = (task.kind === 'speed' || task.kind === undefined)
        && envState.fallMode === 'stay' && fallen && Number.isFinite(fx + fy);
      if (stayDown) {
        task.reset(ppo.rng, sim); // neue Kommandos — POSE bleibt (liegt weiter)
        pluginHost.fireReset();
      } else {
        sim.reset();
        task.reset(ppo.rng, sim);
        pluginHost.fireReset();
      }
    }
  }
  // Wert des Zustands NACH dem Segment (GAE-Ende, wie im Haupt-Thread)
  task.observe(sim, obsBuf);
  let lastVal = ppo.act(obsBuf, true).value;
  if (!Number.isFinite(lastVal)) lastVal = 0;
  post({
    cmd: 'segment', workerId, version, n: T, lastVal, episodes, epRewards,
    obs, act, logp, rew, done, val,
  }, [obs.buffer, act.buffer, logp.buffer, rew.buffer, done.buffer, val.buffer]);
}
