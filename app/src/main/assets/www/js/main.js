// ═══════════════════════════════════════════════════════════
// main.js — TRAINROBOT · TESTFELD·07 (v2.2)
// Boot-Sequenz, Master-Loop, Modi (MANUELL / POLICY / TRAINING),
// Roboterwechsel. Kein Fallback: Fehler werden hart angezeigt.
// ═══════════════════════════════════════════════════════════

import { initEngine, fetchModelIntoFS, removeModelFromFS, RobotSim, setModelProgress, mj } from './engine.js';
import { ROBOT_ORDER, getRobot, HOVER_R } from './robots.js';
import { Renderer3D } from './render3d.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { PPO, finiteArr } from './train.js';
import { RNG } from './math.js';
import { GlbClip } from './glb.js';
import { retargetToG1 } from './retarget.js';
import { makeMotionTask, MOTION_R } from './motiontask.js';
import { putClip, listClips, deleteClip, packMotion, unpackMotion } from './glbstore.js';
import { buildGlbScene } from './glbscene.js';
import { initAITransport, ensureModels, askAI, validatePatch, loadHistory, saveHistory, getApiKey, setApiKey, isCustomKey } from './ai.js';

const VERSION = '2.3.1';
const CTRL_DT = 0.02; // 50 Hz Regelrate

const ui = new UI();
ui.init();
const controls = new Controls();
let r3d = null;

const S = {
  robotId: null,
  motionClip: null,   // aktive GLB-Referenz (nur G1)
  srcScene: null,     // Original-3D-Modell des Lehrer-Ghosts (In-Memory)
  clips: [],          // gespeicherte Clips (IndexedDB)
  ghostOn: true,
  sim: null,
  gait: null,        // Gang-/Flugregler-Instanz
  task: null,        // Trainingsaufgaben-Instanz
  trainer: null,     // PPO
  mode: 'manuell',   // 'manuell' | 'policy'
  training: false,
  speedMode: 'max',
  acc: 0,            // Zeitakkumulator für Regelrate
  epReward: 0,       // laufende Episode
  episodes: 0,
  stepsPerSec: 0,
  _stepTimes: [],
  switching: false,
  obsBuf: null,
  actBuf: null,
  aiMode: 'fast',    // KI-Trainer: 'fast' (Flash-Lite) | 'smart' (Flash)
  aiHistory: [],     // Chat-Verlauf für die KI
  aiBusy: false,
};

// PPO-Überschreibungen aus dem KI-Trainer (T wirkt beim nächsten Start)
const PPO_OVERRIDES = {};

// ── Konsolen-Ausgabe ────────────────────────────────────────
const log = (m, c) => ui.log(m, c);

// ── Roboter laden / wechseln ────────────────────────────────
async function loadRobot(id, first = false) {
  if (S.switching) return;
  const cfg = getRobot(id);
  if (!cfg) return;
  S.switching = true;
  try {
    stopTraining(true);
    if (!first) ui.setRobotLoading(id);
    await new Promise(r => setTimeout(r, first ? 0 : 30)); // Frame zum Zeichnen

    log(`Kompiliere ${cfg.dir} (${cfg.longName}) …`);
    const t0 = performance.now();
    await fetchModelIntoFS('models/' + cfg.dir);
    const sim = new RobotSim(cfg, cfg.scene);
    const ms = Math.round(performance.now() - t0);

    // Alte Simulation freigeben
    if (S.sim) {
      const oldDir = S.sim.cfg.dir;
      S.sim.dispose();
      if (oldDir !== cfg.dir) removeModelFromFS(oldDir);
      S.sim = null;
    }
    S.sim = sim;
    S.robotId = id;

    // Gang-/Flugregler
    S.gait = cfg.gait(cfg);
    if (cfg.drone && S.gait.init) { S.gait.init(sim); sim.flightCtl = S.gait; }
    // Trainingsaufgabe: GLB-Motion-Tracking (nur G1 mit aktivem Clip) sonst Geschwindigkeit
    if (id === 'g1' && S.motionClip) {
      S.task = makeMotionTask(cfg, S.motionClip, sim);
    } else {
      S.task = cfg.task(cfg);
    }
    S.task.reset(new RNG(4242), sim);
    S.obsBuf = new Float32Array(S.task.obsDim);
    S.actBuf = new Float32Array(S.task.actDim);
    ui.$('glbSection').classList.toggle('hidden', id !== 'g1');
    // KI-Anpassungen für diese Aufgabe wieder aufschalten (Belohnungen etc.)
    applySavedAICfg(id);

    // Gespeicherte Policy für DIESE Aufgabenart laden (falls vorhanden)
    S.trainer = null;
    const saved = loadPolicy(id);
    if (saved) { S.trainer = saved; }

    // Welt & Optik
    r3d.buildFromModel(sim);
    r3d.camDist = cfg.dist; controls._camDist = cfg.dist;
    sim.reset();
    S.epReward = 0; S.episodes = 0;

    // UI
    ui.setRobotActive(id);
    ui.setRobotTitle(cfg);
    ui.setDroneMode(!!cfg.drone);
    ui.policyAvailable(!!S.trainer);
    ui.setMode(S.mode);
    if (S.mode === 'policy' && !S.trainer) { S.mode = 'manuell'; ui.setMode(S.mode); }

    const meshes = countMeshes(sim);
    log(`MJCF OK: ${sim.nu} Aktuatoren · qpos ${sim.nq} · dof ${sim.nv} · ${meshes} Mesh-Geoms · dt ${sim.timestep}s (${ms} ms)`, 'ok');
    if (S.trainer) log(`Policy geladen: ${S.trainer.stepCount} Schritte trainiert`, 'ok');
  } catch (err) {
    console.error(err);
    log('FEHLER: ' + err.message, 'err');
    ui.fail(`${cfg.longName} konnte nicht geladen werden.\n\n${err.message}\n\nKein Fallback vorgesehen — bitte Neustart versuchen.`);
  } finally {
    S.switching = false;
  }
}

function countMeshes(sim) {
  const mod = sim.model;
  let n = 0;
  for (let g = 0; g < sim.ngeom; g++) if (mod.geom_type[g] === 7) n++;
  return n;
}

// ── Policy persistieren ─────────────────────────────────────
function policyKey(id) {
  const kind = S.task && S.task.kind === 'motion' ? 'motion' : 'speed';
  return 'tr_policy_' + id + '_' + kind;
}
function loadPolicy(id) {
  try {
    const raw = localStorage.getItem(policyKey(id));
    if (!raw) return null;
    const p = PPO.fromJSON(JSON.parse(raw));
    // Format-Wache: Policy muss zur AKTUELLEN Aufgabe passen (Motion hat
    // seit Root-Folgen einen anderen Beobachtungsraum als Speed)
    if (S.task && (p.obsDim !== S.task.obsDim || p.actDim !== S.task.actDim)) return null;
    return p;
  } catch (e) { return null; }
}
function savePolicy(id) {
  if (!S.trainer) { ui.toast('Keine Policy zum Speichern', true); return; }
  try {
    localStorage.setItem(policyKey(id), JSON.stringify(S.trainer.toJSON()));
    ui.toast('Policy gespeichert');
    ui.policyAvailable(true);
    log(`Policy gespeichert (${id}, ${S.trainer.stepCount} Schritte)`, 'ok');
  } catch (e) {
    ui.toast('Speichern fehlgeschlagen: ' + e.message, true);
  }
}

// ── KI-Trainer (Gemini) ─────────────────────────────────────
// Nutzer sagt in natürlicher Sprache, was der Roboter lernen soll;
// die KI liefert einen validierten Patch auf die Trainingskonfiguration.
const DEFAULT_PPO = { T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2, epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5 };

function aiTaskKind() {
  if (S.task && S.task.kind === 'motion') return 'motion';
  if (S.sim && S.sim.cfg && S.sim.cfg.drone) return 'hover';
  return 'speed';
}

function aiCtx() {
  const cfg = S.sim ? S.sim.cfg : null;
  const kind = aiTaskKind();
  const cur = {};
  if (kind === 'speed' && cfg) {
    cur.rW = cfg.rW; cur.cmd = cfg.cmd; cur.done = cfg.done;
    cur.actSpan = cfg.actSpan; cur.speedMax = cfg.speedMax;
  } else if (kind === 'motion') {
    cur.motionR = MOTION_R;
  } else if (kind === 'hover' && cfg) {
    cur.hoverR = HOVER_R; cur.cmd = cfg.cmd;
  }
  cur.ppo = S.trainer
    ? (({ lr, gamma, lam, clip, epochs, mb, T, cV, cE, maxGrad }) => ({ lr, gamma, lam, clip, epochs, mb, T, cV, cE, maxGrad }))(S.trainer.h)
    : Object.assign({}, DEFAULT_PPO, PPO_OVERRIDES);
  return {
    robot: S.robotId,
    robotName: cfg ? cfg.longName : '—',
    taskKind: kind,
    current: cur,
    history: S.aiHistory,
  };
}

function _aiPPOApply(ppo, touched) {
  for (const [k, v] of Object.entries(ppo)) {
    PPO_OVERRIDES[k] = v;
    if (S.trainer && k !== 'T') S.trainer.h[k] = v;
    touched.push('ppo.' + k);
  }
}

// Patch auf die laufende Konfiguration anwenden (cfg-Objekte werden von
// den Aufgaben live gelesen → Wirkung ohne Neustart).
function applyAIPatch(patch, opts = {}) {
  if (!patch || !Object.keys(patch).length) return false;
  const cfg = S.sim ? S.sim.cfg : null;
  const kind = aiTaskKind();
  const touched = [];
  if (cfg) {
    if (kind === 'speed') {
      if (patch.rW) for (const [k, v] of Object.entries(patch.rW)) { cfg.rW[k] = v; touched.push('rW.' + k); }
      if (patch.cmd) {
        if (patch.cmd.vx) { cfg.cmd.vx = patch.cmd.vx.slice(); touched.push('cmd.vx=' + patch.cmd.vx.map(x => x.toFixed(2)).join('..')); }
        if (patch.cmd.yaw) { cfg.cmd.yaw = patch.cmd.yaw.slice(); touched.push('cmd.yaw'); }
      }
      if (patch.done) for (const [k, v] of Object.entries(patch.done)) { cfg.done[k] = v; touched.push('done.' + k); }
      if (patch.actSpan !== undefined) { cfg.actSpan = patch.actSpan; touched.push('actSpan'); }
    } else if (kind === 'hover') {
      if (patch.hoverR) for (const [k, v] of Object.entries(patch.hoverR)) { HOVER_R[k] = v; touched.push('hoverR.' + k); }
      if (patch.cmd && patch.cmd.vx) { cfg.cmd.vx = patch.cmd.vx.slice(); touched.push('cmd.vx'); }
    }
  }
  if (patch.motionR) for (const [k, v] of Object.entries(patch.motionR)) { MOTION_R[k] = v; touched.push('motionR.' + k); }
  if (patch.hoverR && kind !== 'hover') for (const [k, v] of Object.entries(patch.hoverR)) { HOVER_R[k] = v; touched.push('hoverR.' + k); }
  if (patch.ppo) _aiPPOApply(patch.ppo, touched);
  saveAICfg();
  log('KI-Anpassung übernommen: ' + touched.join(', '), 'ok');
  ui.toast('KI-Anpassung übernommen' + (opts.resetTraining ? ' — Training zurückgesetzt' : ''));
  if (opts.resetTraining) {
    stopTraining(true);
    S.trainer = null;
    ui.resetRewards();
    S.episodes = 0;
    if (S.sim) S.sim.reset();
    ui.$('tStart').textContent = 'Training starten';
    ui.$('tStart').classList.remove('btn-stop');
    ui.trainStats({ reward: '–', episodes: 0, steps: 0, rate: 0 });
    ui.drawChart();
    log('Training zurückgesetzt (KI-Anpassung war groß — Netz lernt neu)', 'warn');
  }
  return true;
}

function saveAICfg() {
  try {
    const cfg = S.sim ? S.sim.cfg : null;
    const kind = aiTaskKind();
    if (cfg && kind === 'speed') {
      localStorage.setItem('tr_ai_speed_' + S.robotId, JSON.stringify({ rW: cfg.rW, cmd: cfg.cmd, done: cfg.done, actSpan: cfg.actSpan }));
    }
    localStorage.setItem('tr_ai_motion', JSON.stringify(MOTION_R));
    localStorage.setItem('tr_ai_hover', JSON.stringify(HOVER_R));
    localStorage.setItem('tr_ai_ppo', JSON.stringify(PPO_OVERRIDES));
  } catch (e) { /* Speicher voll — Anpassung bleibt für diese Session */ }
}

function loadGlobalAICfg() {
  try {
    const m = JSON.parse(localStorage.getItem('tr_ai_motion') || 'null');
    if (m) { const v = validatePatch({ motionR: m }); Object.assign(MOTION_R, v.motionR || {}); }
    const h = JSON.parse(localStorage.getItem('tr_ai_hover') || 'null');
    if (h) { const v = validatePatch({ hoverR: h }); Object.assign(HOVER_R, v.hoverR || {}); }
    const p = JSON.parse(localStorage.getItem('tr_ai_ppo') || 'null');
    if (p) { const v = validatePatch({ ppo: p }); Object.assign(PPO_OVERRIDES, v.ppo || {}); }
  } catch (e) { /* defekt → Standardwerte */ }
}

// In loadRobot: KI-Tuning je Roboter wieder aufschalten
function applySavedAICfg(id) {
  const cfg = getRobot(id);
  if (!cfg || cfg.drone) return;
  try {
    const raw = JSON.parse(localStorage.getItem('tr_ai_speed_' + id) || 'null');
    if (!raw) return;
    const v = validatePatch({ rW: raw.rW, cmd: raw.cmd, done: raw.done, actSpan: raw.actSpan });
    if (v.rW) Object.assign(cfg.rW, v.rW);
    if (v.cmd) { if (v.cmd.vx) cfg.cmd.vx = v.cmd.vx; if (v.cmd.yaw) cfg.cmd.yaw = v.cmd.yaw; }
    if (v.done) Object.assign(cfg.done, v.done);
    if (v.actSpan !== undefined) cfg.actSpan = v.actSpan;
  } catch (e) { /* defekt → Standardwerte */ }
}

// ── KI-Chat-UI ──────────────────────────────────────────────
function aiPush(cls, text) {
  const logEl = document.getElementById('aiLog');
  const div = document.createElement('div');
  div.className = 'ai-msg ' + cls;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function _fmtVal(v) {
  if (Array.isArray(v)) return '[' + v.map(x => (+x).toFixed(2).replace('.', ',')).join(', ') + ']';
  if (typeof v === 'number') return Math.abs(v) < 0.001 ? v.toExponential(1) : (+v).toFixed(v < 0.1 ? 4 : 2).replace('.', ',');
  return String(v);
}

function renderAIAnswer(res, oldCur) {
  const logEl = document.getElementById('aiLog');
  const div = document.createElement('div');
  div.className = 'ai-msg bot';
  div.textContent = res.antwort;

  const patch = res.patch || {};
  const groups = Object.keys(patch);
  if (groups.length) {
    const box = document.createElement('div');
    box.className = 'ai-changes';
    const line = (k, o, n) => {
      const row = document.createElement('div');
      const b = document.createElement('b'); b.textContent = k + ': ';
      const old = document.createElement('span'); old.className = 'old'; old.textContent = _fmtVal(o);
      row.appendChild(b); row.appendChild(old);
      row.appendChild(document.createTextNode('  →  ' + _fmtVal(n)));
      box.appendChild(row);
    };
    const kind = aiTaskKind();
    for (const g of groups) {
      for (const [k, v] of Object.entries(patch[g])) {
        if (g === 'cmd') {
          if (k === 'vx' && oldCur.cmd) line('cmd.vx', oldCur.cmd.vx, v);
          if (k === 'yaw' && oldCur.cmd) line('cmd.yaw', oldCur.cmd.yaw, v);
          if (k === 'alt' && oldCur.cmd) line('cmd.alt', oldCur.cmd.alt, v);
        } else if (g === 'ppo') {
          line('ppo.' + k, (S.trainer ? S.trainer.h[k] : Object.assign({}, DEFAULT_PPO, PPO_OVERRIDES)[k]), v);
        } else {
          const oldObj = g === 'rW' ? oldCur.rW : g === 'done' ? oldCur.done : g === 'motionR' ? MOTION_R : g === 'hoverR' ? HOVER_R : oldCur;
          line(g + '.' + k, oldObj ? oldObj[k] : '?', v);
        }
      }
    }
    const btn = document.createElement('button');
    btn.className = 'ai-apply';
    btn.textContent = 'ÄNDERUNGEN ÜBERNEHMEN';
    btn.addEventListener('click', () => {
      controls.buzz();
      const ok = applyAIPatch(patch, { resetTraining: res.resetTraining });
      if (ok) { btn.textContent = 'ÜBERNOMMEN ✓'; btn.classList.add('done'); btn.disabled = true; }
    });
    div.appendChild(box);
    div.appendChild(btn);
  }
  const st = document.createElement('span');
  st.className = 'ai-status';
  st.textContent = res.model + (res.resetTraining ? ' · Training wird empfohlen neu zu starten' : '');
  div.appendChild(st);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

async function updateAIModelLabel() {
  const el = document.getElementById('aiModel');
  try {
    const models = await ensureModels();
    const cur = S.aiMode === 'smart' ? models.smart : models.fast;
    el.textContent = (S.sim ? S.sim.cfg.longName : '—') + ' · ' + cur + (models.src === 'default' ? ' (Standardkette)' : '');
  } catch (e) {
    el.textContent = 'Gemini nicht erreichbar';
  }
}

async function sendAIMessage(text) {
  if (S.aiBusy || !text || !text.trim()) return;
  if (!S.sim) { ui.toast('Roboter lädt noch', true); return; }
  S.aiBusy = true;
  const sendBtn = document.getElementById('aiSend');
  sendBtn.disabled = true;
  aiPush('user', text.trim());
  const wait = aiPush('bot', 'Denkt nach …');
  try {
    const ctx = aiCtx();
    const res = await askAI({ text: text.trim(), mode: S.aiMode, ctx });
    wait.remove();
    renderAIAnswer(res, ctx.current);
    S.aiHistory.push({ role: 'user', text: text.trim() }, { role: 'model', text: res.antwort });
    if (S.aiHistory.length > 40) S.aiHistory = S.aiHistory.slice(-40);
    saveHistory(S.aiHistory);
    updateAIModelLabel();
  } catch (err) {
    wait.remove();
    aiPush('err', err.message);
    log('KI-Fehler: ' + err.message, 'err');
  } finally {
    S.aiBusy = false;
    sendBtn.disabled = false;
  }
}

async function aiOnOpen() {
  // Verlauf anzeigen (ohne Apply-Buttons)
  const logEl = document.getElementById('aiLog');
  logEl.innerHTML = '';
  for (const m of S.aiHistory.slice(-10)) aiPush(m.role === 'model' ? 'bot' : 'user', m.text);
  if (!S.aiHistory.length) aiPush('bot', 'Sag mir, was dein Roboter lernen soll — ich stelle Belohnungen, Zieltempo und Training dafür ein. (z. B. „schneller laufen, aber stabil bleiben")');
  updateAIKeyStatus();
  await updateAIModelLabel();
}

// ── API-Schlüssel wechseln ──────────────────────────────────
function updateAIKeyStatus() {
  const st = document.getElementById('aiKeyStatus');
  if (!st) return;
  const custom = isCustomKey();
  const k = getApiKey();
  const mask = k.length > 10 ? k.slice(0, 5) + '…' + k.slice(-4) : '***';
  st.textContent = custom ? 'Eigener Schlüssel aktiv (' + mask + ') — „Standard" stellt den eingebauten wieder her.'
    : 'Eingebauter Schlüssel aktiv (' + mask + ').';
}

function wireAIKey() {
  const inp = document.getElementById('aiKeyInput');
  const save = document.getElementById('aiKeySave');
  const reset = document.getElementById('aiKeyReset');
  if (!inp || !save || !reset) return;
  save.addEventListener('click', () => {
    const v = inp.value.trim();
    if (!v) { ui.toast('Erst einen Schlüssel einfügen', true); return; }
    const used = setApiKey(v);
    inp.value = '';
    updateAIKeyStatus();
    ui.toast('KI-Schlüssel gesetzt (' + used.slice(0, 5) + '…)' );
    log('KI: eigener API-Schlüssel aktiv — Modell-Erkennung neu', 'ok');
    updateAIModelLabel().catch(() => {});
  });
  reset.addEventListener('click', () => {
    setApiKey('');
    updateAIKeyStatus();
    ui.toast('Eingebauter Schlüssel aktiv');
    log('KI: eingebauter API-Schlüssel wieder aktiv', 'ok');
    updateAIModelLabel().catch(() => {});
  });
}

// ── Training ────────────────────────────────────────────────
function startTraining() {
  if (!S.sim || !S.task) return;
  if (!S.trainer) {
    S.trainer = new PPO(S.task.obsDim, S.task.actDim, { ...PPO_OVERRIDES }, 1337 + ROBOT_ORDER.indexOf(S.robotId));
    log(`PPO initialisiert: obs ${S.task.obsDim} → 64×64 → act ${S.task.actDim} · CPU`, 'warn');
  }
  S.task.reset(S.trainer.rng, S.sim);
  S.training = true;
  S.epReward = 0;
  ui.$('tStart').textContent = 'Training pausieren';
  ui.$('tStart').classList.add('btn-stop');
  log('Training läuft — rollout + update auf der CPU', 'ok');
}

function stopTraining(silent = false) {
  if (!S.training) return;
  S.training = false;
  const b = ui.$('tStart');
  b.textContent = 'Training starten';
  b.classList.remove('btn-stop');
  if (!silent) log('Training pausiert');
}

// Ein Trainingsschritt (auf Regelrate CTRL_DT)
function trainCtrlStep() {
  const sim = S.sim, task = S.task, trainer = S.trainer;
  const substeps = Math.max(1, Math.round(CTRL_DT / sim.timestep));
  if (task.stepsLeft <= 0) task.sampleCmd(trainer.rng);

  const o = task.observe(sim, S.obsBuf);
  if (!finiteArr(S.obsBuf)) { sim.reset(); task.reset(trainer.rng, sim); return; }
  trainer.norm.update(S.obsBuf);
  const { act, logp, value } = trainer.act(S.obsBuf, false);
  task.actionToCtrl(sim, act);
  sim.stepN(substeps);
  if (task.kind === 'motion') task.advance(CTRL_DT);
  const { r, done } = task.reward(sim);
  for (let i = 0; i < act.length; i++) task.lastAct[i] = act[i];
  S.epReward += r;

  const full = trainer.store(S.obsBuf, act, logp, r, done, value);
  if (done) {
    S.episodes++;
    ui.pushEpisodeReward(S.epReward);
    S.epReward = 0;
    sim.reset();
    task.reset(trainer.rng, sim);
  }
  if (full) {
    const lastObs = task.observe(sim, S.obsBuf);
    const lastVal = trainer.act(S.obsBuf, true).value;
    const m = trainer.finishAndUpdate(lastVal);
    m._lastMetrics = m;
  }
}

// ── Modi / manueller Betrieb ────────────────────────────────
function applyGait(dtCtrl) {
  const sim = S.sim, cfg = S.sim.cfg;
  dtCtrl = cfg.ctrlDt || dtCtrl;
  const cmd = controls.command(cfg);
  const map = {};
  S.gait.step(sim, dtCtrl, cmd, map);
  for (const name in map) {
    const a = sim.actByName[name];
    if (a !== undefined) sim.ctrl[a] = map[name];
  }
  // Physik wirklich weiterschalten (Unterschritte je Regelrate)
  const substeps = Math.max(1, Math.round(CTRL_DT / sim.timestep));
  sim.stepN(substeps);
}

function policyCtrlStep() {
  const sim = S.sim, task = S.task, trainer = S.trainer;
  if (!trainer) return;
  const substeps = Math.max(1, Math.round((S.sim.cfg.ctrlDt || CTRL_DT) / sim.timestep));
  task.observe(sim, S.obsBuf);
  if (!finiteArr(S.obsBuf)) { sim.reset(); if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0; return; }
  trainer.actDeterministic(S.obsBuf, S.actBuf);
  task.actionToCtrl(sim, S.actBuf);
  for (let i = 0; i < S.actBuf.length; i++) task.lastAct[i] = S.actBuf[i];
  sim.stepN(substeps);
  if (task.kind === 'motion') task.advance(CTRL_DT);
}

function resetRobot() {
  if (!S.sim) return;
  S.sim.reset();
  if (S.task && S.task.kind === 'motion') S.task.reset(new RNG(4242), S.sim); // zurück auf den Bahn-Anfang
  if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0;
  S.epReward = 0;
  log('Roboter zurückgesetzt auf Keyframe „' + S.sim.cfg.keyName + '"');
}

// Sturz-Erkennung im Echtzeitbetrieb (sanfter Auto-Reset)
let lastFallLog = 0;
function checkFall() {
  const sim = S.sim;
  if (!sim) return;
  const o = 4 * sim.baseBody;
  const x = sim._xquat[o + 1], y = sim._xquat[o + 2]; // (x,y) der Quaternion [w,x,y,z]
  const upz = 1 - 2 * (x * x + y * y);
  const height = sim._xpos[3 * sim.baseBody + 2];
  const limit = sim.cfg.drone ? 0.35 : 0.32;
  const zMin = sim.cfg.drone ? 0.05 : sim.cfg.done.zMin * 0.8;
  if (upz < limit || height < zMin) {
    const now = performance.now();
    if (now - lastFallLog > 2500) {
      log('Sturz erkannt — Auto-Reset', 'warn');
      lastFallLog = now;
    }
    sim.reset();
    if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0;
    S.epReward = 0;
  }
}

// ── Boot ────────────────────────────────────────────────────
async function boot() {
  try {
    log(`TRAINROBOT v${VERSION} · Testfeld·07 · ${new Date().toLocaleString('de-DE')}`);
    log('BIOS: Offline-Betrieb, kein Netzwerk nötig');
    log('KI-Trainer: Gemini (nur auf Anfrage online)');
    initAITransport();
    loadGlobalAICfg();
    S.aiHistory = loadHistory();
    ui.splash('Prüfe WebAssembly …', 0.08);
    ui.splash('Lade MuJoCo-Kern (WASM) …', 0.18);
    await initEngine(log);
    ui.splash('Initialisiere 3D-Welt …', 0.45);
    r3d = new Renderer3D(document.getElementById('gl'));
    r3d.resize();
    // Orientierungs-/Größenwechsel: Canvas-Buffer + Kamera-Aspekt nachziehen
    // (Landscape-Bug: bisher wurde resize nur einmal beim Boot aufgerufen)
    const onResize = () => { if (r3d) r3d.resize(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
    if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
      window.screen.orientation.addEventListener('change', onResize);
    }
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(document.documentElement);
    const glInfo = (() => {
      try {
        const gl = r3d.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL';
      } catch (e) { return 'WebGL'; }
    })();
    log(`WebGL: ${glInfo}`, 'ok');

    controls.attach(ui, document.getElementById('gl'), r3d);
    setModelProgress((done, total, rel) => {
      const sp = document.getElementById('splash');
      if (sp) ui.splash(`Lade Modelldateien (${done}/${total}) …`, 0.45 + 0.5 * (done / total));
    });

    ui.splash('Kompiliere Unitree A1 …', 0.6);
    await loadRobot('a1', true);

    ui.splash('Bereit.', 1);
    setTimeout(() => { ui.splashDone(); }, 250);
    log('Bereit. Vier Roboter, ungebunden, gleiche Steuerung.', 'ok');
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    log('BOOT-FEHLER: ' + err.message, 'err');
    ui.splash('Fehler', 1);
    ui.fail(`Systemstart fehlgeschlagen.\n\n${err.message}\n\nKein Fallback vorgesehen.`);
  }
}

// ── Master-Loop ─────────────────────────────────────────────
let lastT = 0, statusT = 0, chartT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dtRaw = (now - lastT) / 1000;
  lastT = now;
  const dt = Math.min(Math.max(dtRaw, 0.0001), 0.05);
  const fps = 1 / dtRaw;

  if (!S.sim) return;
  controls.tick(dt, r3d);
  if (controls.consumeReset()) resetRobot();

  if (S.training) {
    // Trainingsbetrieb: Zeitbudget pro Frame
    const budget = S.speedMode === 'max' ? 12e3 : 0; // µs
    const t0 = performance.now();
    const nSteps = S.speedMode === 'max' ? 1e9 : (S.speedMode === '16' ? 16 : S.speedMode === '4' ? 4 : 1);
    let done = 0;
    while (done < nSteps) {
      trainCtrlStep();
      done++;
      if (budget && performance.now() - t0 > budget) break;
    }
    const el = performance.now() - t0;
    S._stepTimes.push({ n: done, ms: el });
    if (S._stepTimes.length > 30) S._stepTimes.shift();
    let sn = 0, sm = 0;
    for (const s of S._stepTimes) { sn += s.n; sm += s.ms; }
    S.stepsPerSec = sm > 0 ? (sn / sm) * 1000 : 0;
  } else {
    // Echtzeit: MANUELL oder POLICY
    const cdt = S.sim.cfg.ctrlDt || CTRL_DT;
    S.acc += dt;
    let guard = 0;
    while (S.acc >= cdt && guard < 10) {
      S.acc -= cdt;
      guard++;
      if (S.mode === 'policy' && S.trainer) policyCtrlStep();
      else {
        applyGait(cdt);
        // Lehrer läuft auch im MANUELL-Modus weiter (Vorschau der Referenz)
        if (S.task && S.task.kind === 'motion') S.task.advance(cdt);
      }
      checkFall();
    }
    S.stepsPerSec = Math.max(1, Math.round(CTRL_DT)) * 0 + fps * Math.max(1, Math.round(CTRL_DT / S.sim.timestep));
  }

  r3d.updateFrame(S.sim, dt);
  // Geist: Referenzpose mitlaufen lassen — Lehrer (Original) + G1-Geist
  // folgen BEIDE der Root-Bahn (der Lehrer läuft wirklich durchs Feld,
  // der Roboter lernt, ihm zu folgen — nicht „auf der Stelle" zu gehen)
  if (S.ghostOn && S.task && S.task.kind === 'motion' && (r3d.ghostGroups || r3d.sourceGhost)) {
    const clip = S.task.clip;
    const fr = Math.floor(S.task.phase * clip.n) % clip.n;
    if (r3d.sourceGhost) r3d.updateSourceGhost(fr);
    if (r3d.ghostGroups) {
      const gh = S.sim.makeGhostData();
      if (clip.root && clip.yaw) {
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], clip.root[2 * fr], clip.root[2 * fr + 1], clip.yaw[fr]);
      } else {
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr]);
      }
      r3d.updateGhost(gh);
    }
  }
  r3d.render();

  // Statuszeile (5 Hz)
  statusT += dt;
  if (statusT > 0.2) {
    statusT = 0;
    ui.status(S.sim.baseSpeed(), S.sim.baseHeight(), fps);
    if (ui.$('trainSheet') && !ui.$('trainSheet').classList.contains('hidden')) {
      const m = S.trainer ? S.trainer : null;
      ui.trainStats({
        reward: S.trainer ? (lastEma().toFixed(2).replace('.', ',')) : '–',
        episodes: S.episodes,
        steps: S.trainer ? S.trainer.stepCount : 0,
        rate: S.training ? S.stepsPerSec : 0,
      });
    }
  }
  chartT += dt;
  if (chartT > 0.35) {
    chartT = 0;
    if (!ui.$('trainSheet').classList.contains('hidden')) ui.drawChart();
  }
}

function lastEma() {
  const e = ui.episodeEma;
  return e.length ? e[e.length - 1] : 0;
}

// ── UI-Verdrahtung ──────────────────────────────────────────
function wireUI() {
  document.getElementById('btnConsole').addEventListener('click', () => { ui.toggleConsole(); controls.buzz(); });
  document.getElementById('consoleClose').addEventListener('click', () => ui.toggleConsole());
  // ── KI-Trainer ─────────────────────────────────────────
  document.getElementById('btnAI').addEventListener('click', async () => {
    controls.buzz();
    ui.toggleAI();
    if (!document.getElementById('aiSheet').classList.contains('hidden')) await aiOnOpen();
  });
  document.getElementById('aiClose').addEventListener('click', () => ui.toggleAI(false));
  for (const b of document.querySelectorAll('.aimode')) {
    b.addEventListener('click', () => {
      S.aiMode = b.dataset.aimode;
      for (const x of document.querySelectorAll('.aimode')) x.classList.toggle('active', x === b);
      controls.buzz();
      updateAIModelLabel();
    });
  }
  const _aiSubmit = () => {
    const inp = document.getElementById('aiInput');
    const v = inp.value.trim();
    if (v) { inp.value = ''; sendAIMessage(v); }
  };
  document.getElementById('aiSend').addEventListener('click', () => { controls.buzz(); _aiSubmit(); });
  document.getElementById('aiInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _aiSubmit(); } });
  wireAIKey();
  for (const b of document.querySelectorAll('.ai-sug')) {
    b.addEventListener('click', () => { controls.buzz(); sendAIMessage(b.dataset.q); });
  }
  document.getElementById('btnFull').addEventListener('click', async () => {
    controls.buzz();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) { /* WebView ohne Vollbild */ }
  });
  document.getElementById('btnTrainTop').addEventListener('click', () => { ui.toggleTrain(); controls.buzz(); });
  document.getElementById('trainClose').addEventListener('click', () => ui.toggleTrain(false));

  for (const chip of document.querySelectorAll('.robot-chip')) {
    chip.addEventListener('click', () => {
      const id = chip.dataset.robot;
      if (id === S.robotId || S.switching) return;
      controls.buzz(10);
      loadRobot(id);
    });
  }

  document.getElementById('modeManuell').addEventListener('click', () => {
    S.mode = 'manuell';
    ui.setMode(S.mode);
    controls.buzz();
    if (S.sim) S.sim.reset();
  });
  document.getElementById('modePolicy').addEventListener('click', () => {
    if (!S.trainer) { ui.toast('Keine Policy vorhanden — erst Training starten', true); return; }
    S.mode = 'policy';
    ui.setMode(S.mode);
    controls.buzz();
    if (S.sim) S.sim.reset();
    log('POLICY-Modus: deterministische Politik steuert den Roboter');
  });

  document.getElementById('tStart').addEventListener('click', () => {
    controls.buzz();
    if (S.training) stopTraining(); else startTraining();
  });
  document.getElementById('tReset').addEventListener('click', () => {
    controls.buzz();
    stopTraining(true);
    S.trainer = null;
    ui.resetRewards();
    S.episodes = 0;
    if (S.sim) S.sim.reset();
    ui.$('tStart').textContent = 'Training starten';
    ui.$('tStart').classList.remove('btn-stop');
    ui.trainStats({ reward: '–', episodes: 0, steps: 0, rate: 0 });
    ui.drawChart();
    log('Training zurückgesetzt (Netz neu, Norm neu)', 'warn');
  });
  for (const b of document.querySelectorAll('.speed-chip')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('.speed-chip')) x.classList.remove('active');
      b.classList.add('active');
      S.speedMode = b.dataset.speed;
      controls.buzz();
    });
  }
  document.getElementById('tSave').addEventListener('click', () => { controls.buzz(); savePolicy(S.robotId); });
  document.getElementById('tLoad').addEventListener('click', () => {
    controls.buzz();
    const p = loadPolicy(S.robotId);
    if (p) {
      S.trainer = p;
      ui.policyAvailable(true);
      ui.toast('Policy geladen (' + p.stepCount + ' Schritte)');
    } else ui.toast('Kein Speicherstand gefunden', true);
  });
  document.getElementById('tExport').addEventListener('click', () => {
    if (!S.trainer) { ui.toast('Keine Policy vorhanden', true); return; }
    const json = JSON.stringify(S.trainer.toJSON());
    const name = 'trainrobot_policy_' + S.robotId + '.json';
    // APK: über Java-Bridge in den Download-Ordner schreiben
    // (blob-Anchor-Downloads sind in WebViews unzuverlässig)
    if (window.TrainrobotBridge && window.TrainrobotBridge.saveFile) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(json)));
        const ok = window.TrainrobotBridge.saveFile(name, b64, 'application/json');
        if (ok) { ui.toast('Policy exportiert → Download-Ordner'); log('Policy exportiert: ' + name, 'ok'); }
        else ui.toast('Export fehlgeschlagen', true);
      } catch (e) { ui.toast('Export fehlgeschlagen: ' + e.message, true); }
      return;
    }
    // Browser (Test): Standard-Anchor-Download
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast('Policy exportiert');
  });
  document.getElementById('tImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.fmt !== 'trainrobot-ppo-1') throw new Error('Unbekanntes Format');
      const p = PPO.fromJSON(data);
      if (p.obsDim !== S.task.obsDim || p.actDim !== S.task.actDim) throw new Error('Policy passt nicht zu diesem Roboter');
      S.trainer = p;
      ui.policyAvailable(true);
      ui.toast('Import ok (' + p.stepCount + ' Schritte)');
      log('Policy importiert: ' + f.name, 'ok');
    } catch (err) {
      ui.toast('Import fehlgeschlagen: ' + err.message, true);
    }
    e.target.value = '';
  });
  document.getElementById('failReload').addEventListener('click', () => location.reload());

  // ── GLB-Bewegung (G1) ──────────────────────────────────
  document.getElementById('glbImportBtn').addEventListener('click', () => document.getElementById('glbFile').click());
  document.getElementById('glbFile').addEventListener('change', onGlbFiles);
  document.getElementById('bcBtn').addEventListener('click', () => runBC());
  document.getElementById('ghostToggle').addEventListener('change', (e) => {
    S.ghostOn = e.target.checked;
    if (!S.ghostOn) { r3d.removeGhost(); r3d.removeSourceGhost(); }
    else if (S.task && S.task.kind === 'motion' && S.motionClip) {
      if (S.sim) r3d.buildGhost(S.sim);
      r3d.buildSourceGhost(S.motionClip, S.srcScene || null);
    }
  });

  refreshClipList().catch(() => { /* IDB evtl. gesperrt */ });
}

// ── GLB: Import, Liste, Aktivierung, BC ────────────────────
// Universell: GLB von beliebiger Quelle (Mixamo, Cartwheel, Unity,
// Unreal, VRM …) — das Retargeting erkennt das Skelett automatisch
// (Alias-Tabelle + Heuristik). Import aus JEDEM Roboter-View möglich:
// nötigenfalls wechselt die App zum G1 (humanoides Ziel). ALLE
// Animationen einer Datei werden importiert (Hart-Limit 8).
async function onGlbFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  if (S.robotId !== 'g1' || !S.sim) {
    ui.toast('Wechsle zum G1 — humanoides Retargeting', false, 2600);
    log('GLB-Import: automatischer Wechsel zum G1 (humanoides Ziel)', 'warn');
    await loadRobot('g1');
    if (S.robotId !== 'g1' || !S.sim) { ui.toast('G1 konnte nicht geladen werden', true); return; }
  }
  for (const f of files) {
    ui.$('glbStatus').textContent = 'Importiere ' + f.name + ' …';
    try {
      const buf = await f.arrayBuffer();
      const clip = new GlbClip(buf);
      const anims = clip.animations;
      log('GLB „' + f.name + '": ' + anims.length + ' Animation(en) — ' + anims.map(a => a.name + ' (' + a.duration.toFixed(1) + 's)').join(', '));
      const list = anims.slice(0, 8);
      let last = null;
      for (const an of list) {
        if (an.index > 0) clip.useAnimation(an.index);
        const motion = retargetToG1(clip, S.sim, (m) => log('  ' + m));
        const rec = {
          id: 'glb_' + Date.now() + '_' + an.index + '_' + Math.floor(Math.random() * 1e4),
          name: f.name.replace(/\.glb$/i, '') + (anims.length > 1 ? ' · ' + an.name : ''),
          size: buf.byteLength,
          glb: an.index === 0 ? buf : null,
          animIndex: an.index,
          motion: packMotion(motion),
        };
        await putClip(rec);
        log('Retargeting „' + rec.name + '": ' + motion.n + ' Frames × ' + motion.nu + ' Gelenke, ' + motion.duration.toFixed(1) + 's — Boden angepasst', 'ok');
        last = rec;
        await new Promise(r => setTimeout(r, 0)); // UI-Frame
      }
      await refreshClipList();
      ui.$('glbStatus').textContent = (list.length > 1 ? list.length + ' Animationen importiert — letzte: ' : '') + (last ? last.name + ': ' + last.motion.duration.toFixed(1) + 's @ ' + last.motion.fps + ' fps bereit' : 'bereit');
      ui.toast('GLB importiert: ' + (last ? last.name : f.name));
    } catch (err) {
      console.error(err);
      log('GLB-Fehler: ' + err.message, 'err');
      ui.$('glbStatus').textContent = 'Fehler: ' + err.message;
      ui.toast('GLB-Import fehlgeschlagen: ' + err.message, true, 4000);
    }
  }
}

let _bcRunning = false;
async function runBC() {
  if (_bcRunning) return;
  if (!S.task || S.task.kind !== 'motion') { ui.toast('Zuerst eine GLB-Referenz wählen', true); return; }
  _bcRunning = true;
  try {
    const task = S.task;
    ui.$('glbStatus').textContent = 'BC: Datensatz aus Referenz erzeugen …';
    await new Promise((r) => setTimeout(r, 30));
    const ds = task.buildBCDataset(S.sim);
    log('BC-Datensatz: ' + ds.n + ' Frames (Geist + Rauschen) — Etikett = nächste Referenzpose');
    if (!S.trainer) {
      S.trainer = new PPO(task.obsDim, task.actDim, { ...PPO_OVERRIDES }, 1337 + ROBOT_ORDER.indexOf(S.robotId));
    }
    const trainer = S.trainer;
    for (let f = 0; f < ds.n; f++) {
      const o = new Float32Array(task.obsDim);
      for (let i = 0; i < task.obsDim; i++) o[i] = ds.X[f * task.obsDim + i];
      trainer.norm.update(o);
    }
    const EPOCHS = 60;
    for (let ep = 0; ep < EPOCHS; ep++) {
      const loss = trainer.bcEpoch(ds.X, ds.Y, ds.n, 128);
      if (ep % 10 === 0 || ep === EPOCHS - 1) {
        log('BC Epoche ' + (ep + 1) + '/' + EPOCHS + ' — MSE ' + loss.toFixed(4));
        ui.$('glbStatus').textContent = 'BC Epoche ' + (ep + 1) + '/' + EPOCHS + ' · MSE ' + loss.toFixed(4);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    ui.toast('BC fertig — jetzt PPO verfeinern');
    log('BC abgeschlossen. Empfehlung: Training starten (PPO-Residual auf der CPU).', 'ok');
    ui.$('glbStatus').textContent = 'BC fertig. PPO verfeinern mit „Training starten".';
  } catch (err) {
    console.error(err);
    log('BC-Fehler: ' + err.message, 'err');
    ui.toast('BC fehlgeschlagen: ' + err.message, true);
  } finally {
    _bcRunning = false;
  }
}

async function refreshClipList() {
  S.clips = await listClips();
  const list = document.getElementById('glbList');
  if (!list) return;
  list.innerHTML = '';
  for (const rec of S.clips) {
    const row = document.createElement('div');
    const active = S.motionClip && S.motionClip.name === rec.name;
    row.className = 'glb-clip' + (active ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'glb-clip-name';
    name.textContent = rec.name;
    const meta = document.createElement('span');
    meta.className = 'glb-clip-meta';
    const m = rec.motion;
    meta.textContent = (m.duration || 0).toFixed(1) + 's · ' + m.n + 'F';
    const use = document.createElement('button');
    use.className = 'btn small';
    use.textContent = active ? 'Aktiv' : 'Referenz';
    use.addEventListener('click', () => activateClip(rec));
    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      await deleteClip(rec.id);
      if (active) deactivateClip();
      await refreshClipList();
    });
    row.append(name, meta, use, del);
    list.appendChild(row);
  }
}

function activateClip(rec) {
  if (S.robotId !== 'g1' || !S.sim) { ui.toast('Nur mit dem G1 möglich', true); return; }
  stopTraining(true);
  S.motionClip = unpackMotion(rec.motion);
  S.task = makeMotionTask(S.sim.cfg, S.motionClip, S.sim);
  S.task.reset(new RNG(4242), S.sim); // platziert die Basis AUF der Bahn
  S.obsBuf = new Float32Array(S.task.obsDim);
  S.actBuf = new Float32Array(S.task.actDim);
  S.trainer = loadPolicy(S.robotId);
  ui.policyAvailable(!!S.trainer);
  ui.$('stMode').textContent = 'GLB';
  // Lehrer-Ghost: Skelett-Figur sofort, Original-Mesh sobald gebaut
  S.srcScene = null;
  if (S.ghostOn) {
    r3d.buildGhost(S.sim);
    r3d.buildSourceGhost(S.motionClip, null);
  }
  if (rec.glb) {
    try {
      const c2 = new GlbClip(rec.glb);
      c2.useAnimation(rec.animIndex || 0);
      const pkg = buildGlbScene(c2);
      if (pkg) {
        S.srcScene = pkg;
        if (S.ghostOn) r3d.buildSourceGhost(S.motionClip, pkg);
        log('Lehrer: Original-Modell (' + pkg.meshCount + ' Meshes, ' + pkg.bones + ' Knochen) zeigt die Animation');
      }
    } catch (e) { log('Original-Modell nicht darstellbar — Skelett-Lehrer aktiv (' + e.message + ')'); }
  }
  const rootInfo = S.motionClip.root ? ' · Root-Bahn aktiv (Roboter folgt dem wandernden Lehrer)' : '';
  const mergeInfo = S.motionClip.mergedFrom ? ' [assimp: ' + S.motionClip.mergedFrom + ' Fragmente zusammengeführt]' : '';
  log('GLB-Referenz aktiv: ' + rec.name + ' (' + S.motionClip.duration.toFixed(1) + 's, Endlosschleife)' + mergeInfo + rootInfo + ' — Aufgabe: Motion-Tracking', 'ok');
  ui.toast('Referenz aktiv: ' + rec.name);
  refreshClipList().catch(() => {});
}

function deactivateClip() {
  stopTraining(true);
  S.motionClip = null;
  S.srcScene = null;
  r3d.removeGhost();
  r3d.removeSourceGhost();
  if (S.sim) {
    const cfg = S.sim.cfg;
    S.task = cfg.task(cfg);
    S.task.reset(new RNG(4242), S.sim);
    S.obsBuf = new Float32Array(S.task.obsDim);
    S.actBuf = new Float32Array(S.task.actDim);
    S.trainer = loadPolicy(S.robotId);
    ui.policyAvailable(!!S.trainer);
    ui.$('stMode').textContent = 'MANUELL';
    log('GLB-Referenz deaktiviert — zurück auf Geschwindigkeitsaufgabe');
  }
  refreshClipList().catch(() => {});
}

// Test-/Debug-Handle (schadlos in Produktion)
Object.defineProperty(window, '__trainrobot', {
  get: () => ({
    sim: S.sim,
    controls,
    get trainer() { return S.trainer; },
    get episodes() { return S.episodes; },
    get mode() { return S.mode; },
    get task() { return S.task; },
    get motionClip() { return S.motionClip; },
    get renderer() { return r3d; },
    get cfg() { return S.sim ? S.sim.cfg : null; },
    get motionR() { return MOTION_R; },
    get hoverR() { return HOVER_R; },
    get ppoOverrides() { return PPO_OVERRIDES; },
    get aiBusy() { return S.aiBusy; },
    applyAIPatch: (patch, opts) => applyAIPatch(patch, opts),
    ui,
  }),
});

wireUI();
boot();
