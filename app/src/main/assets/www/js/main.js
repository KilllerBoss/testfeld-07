// ═══════════════════════════════════════════════════════════
// main.js — TRAINROBOT · TESTFELD·07 (v2.2)
// Boot-Sequenz, Master-Loop, Modi (MANUELL / POLICY / TRAINING),
// Roboterwechsel. Kein Fallback: Fehler werden hart angezeigt.
// ═══════════════════════════════════════════════════════════

import { initEngine, fetchModelIntoFS, removeModelFromFS, hasModelInFS, RobotSim, setModelProgress, mj, writeWorldFile } from './engine.js';
import { ROBOT_ORDER, getRobot, HOVER_R } from './robots.js';
import { buildWorldXML, WORLDS, getWorld } from './worlds.js';
import { Renderer3D } from './render3d.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { PPO, finiteArr } from './train.js';
import { RNG } from './math.js';
import { GlbClip } from './glb.js';
import { retargetToG1, RT_ALG } from './retarget.js';
import { makeMotionTask, MOTION_R } from './motiontask.js';
import { makeRecoveryTask, RECOVERY_R } from './recoverytask.js';
import { PluginHost, BUILTIN_PLUGINS, compilePlugin } from './plugins.js';
import { ParallelTrainer, suggestWorkerCount } from './parallel.js';
import { putClip, listClips, deleteClip, packMotion, unpackMotion } from './glbstore.js';
import { buildGlbScene } from './glbscene.js';
import { initAITransport, ensureModels, askAI, validatePatch, loadHistory, saveHistory, getApiKey, setApiKey, isCustomKey } from './ai.js';
import { loadButtons, addButton, removeButton, loadJoyMap, saveJoyMap, validateJoyMap, loadPushStrength, savePushStrength } from './agent.js';

const VERSION = '2.10.0';
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
  pushStrength: 3.0, // Schubs-Stärke (Δv in m/s — v2.5.0, KI-tunbar, persistiert)
  animTraining: true, // GLB-Animation im Training an/aus (aus = nur Gleichgewicht)
  cruise: null,      // KI-Autofahrt {vx, yaw, until} — endet bei Stick-Bewegung
  aiButtons: [],     // KI-eingerichtete Buttons (agent.js)
  world: loadWorldState(), // v2.7.0: aktuelle Welt {id, seed} — prozedural generiert
  // v2.8.0 — VOLLSTÄNDIGER ROBOTER: Szenarien (Aufstehen/Abwurf/Gehen),
  // Sturz-Verhalten (Auto-Reset vs. Liegen lassen) und Plugin-Werkstatt.
  scenario: {},      // je Roboter: 'gehen' | 'getup' | 'drop' (GLB-Clip zählt als eigene Aufgabe)
  fallMode: 'reset', // 'reset' = Auto-Teleport bei Sturz, 'stay' = Roboter bleibt liegen
};

// Persistierte Szenario-/Sturz-Wahl laden (v2.8.0)
try {
  const sc = JSON.parse(localStorage.getItem('tr_scenario_v1') || '{}');
  if (sc && typeof sc === 'object') S.scenario = sc;
} catch (e) { /* defekt → Standard */ }
S.fallMode = localStorage.getItem('tr_fallMode') === 'stay' ? 'stay' : 'reset';

// v2.7.0 — Welt-Auswahl (persistiert): Preset-Welten + Zufallsgenerator
function loadWorldState() {
  try {
    const w = JSON.parse(localStorage.getItem('tr_world_v1') || 'null');
    if (w && typeof w.id === 'string') return { id: w.id, seed: (w.seed | 0) || 1 };
  } catch (e) { /* defekt → Standard */ }
  return { id: 'testfeld', seed: 1 };
}

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
    // v2.7.0: Dateien nur EINMAL laden — bei Roboter-/Weltwechseln sind sie
    // noch im Emscripten-FS (Re-Fetch kostete RAM und konnte den Heap
    // wachsen lassen → Freezes).
    if (hasModelInFS(cfg.dir)) log(`Modelldateien ${cfg.dir} bereits geladen — wiederverwendet`);
    else await fetchModelIntoFS('models/' + cfg.dir);
    // v2.7.0 — WELT GENERIEREN: prozedurale MJCF (skaliert auf die
    // Robotergröße), in den Modellordner schreiben und kompilieren.
    const worldXml = buildWorldXML(cfg, S.world.id, S.world.seed);
    writeWorldFile(cfg.dir, 'welt_live.xml', worldXml);
    const sim = new RobotSim(cfg, 'welt_live.xml');
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
    // Trainingsaufgabe (v2.8.0): GLB-Tracking → Recovery-Szenario → Standard
    S.task = makeTaskFor(id, cfg, sim);
    if (S.task.kind === 'motion') {
      S.task = makeMotionTask(cfg, S.motionClip, sim);
      S.task.animOn = S.animTraining;
      // Steuerungs-Wahl des aktiven Clips restaurieren (v2.5.0, 'btn' v2.6.0)
      const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
      if (rec && (rec.ctrl === 'joy' || rec.ctrl === 'btn')) S.task.ctrlMode = rec.ctrl;
      if (rec && Array.isArray(rec.buttons)) S.task.buttons = rec.buttons.slice(0, 4);
      syncCtrlChips();
      syncBtnRow();
      renderClipButtons();
    }
    S.task.reset(new RNG(4242), sim);
    pluginHost.fireReset(); // v2.9.0: Plugins (z. B. Kopfstand) dürfen die Startpose formen
    S.obsBuf = new Float32Array(S.task.obsDim);
    S.actBuf = new Float32Array(S.task.actDim);
    ui.$('glbSection').classList.toggle('hidden', id !== 'g1');
    // KI-Anpassungen für diese Aufgabe wieder aufschalten (Belohnungen etc.)
    applySavedAICfg(id);

    // Gespeicherte Policy für DIESE Aufgabenart laden (falls vorhanden).
    // v2.7.0: Bei Weltwechsel (gleicher Roboter) bleibt das TRAINING im
    // Speicher erhalten (obsDim passt weiter) — nur Roboterwechsel lädt neu.
    const keepTrainer = (S.robotId === id) ? S.trainer : null;
    S.trainer = null;
    if (keepTrainer && S.task && keepTrainer.obsDim === S.task.obsDim && keepTrainer.actDim === S.task.actDim) {
      S.trainer = keepTrainer;
      log('Training fortgeführt (Weltwechsel — Netz bleibt erhalten)', 'ok');
    } else {
      const saved = loadPolicy(id);
      if (saved) { S.trainer = saved; }
    }

    // Welt & Optik
    r3d.buildFromModel(sim);
    r3d.camDist = cfg.dist; controls._camDist = cfg.dist;
    sim.reset();
    S.epReward = 0; S.episodes = 0;

    // UI
    ui.setRobotActive(id);
    ui.setRobotTitle(cfg);
    ui.setDroneMode(!!cfg.drone);
    syncScenarioChips();
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
// v2.7.0 — PRO-CLIP-KEYS: Motion-Policies werden pro GLB-Clip gespeichert
// (tr_policy_<robot>_motion_<clipId>) statt in EINEM geteilten Key. Vorher
// übernahm der nächste Clip die Policy des vorherigen (Überschreiben) und
// beim Deaktivieren „verschwand“ das Gelernte — jetzt behält JEDER Clip
// seine eigene Policy. Der Legacy-Key wird beim Laden als Fallback gelesen.
function policyKey(id) {
  if (S.task && S.task.kind === 'motion') {
    return 'tr_policy_' + id + '_motion_' + (S.activeRecId || 'none');
  }
  // v2.8.0: Recovery-Szenarien (Aufstehen/Abwurf) haben EIGENE Policy-Slots.
  if (S.task && S.task.kind === 'recovery') {
    return 'tr_policy_' + id + '_recovery_' + S.task.mode;
  }
  return 'tr_policy_' + id + '_speed';
}
function legacyPolicyKey(id) {
  const kind = S.task && S.task.kind === 'motion' ? 'motion' : 'speed';
  return 'tr_policy_' + id + '_' + kind;
}
function policyExistsForClip(recId) {
  try { return !!localStorage.getItem('tr_policy_g1_motion_' + recId); } catch (e) { return false; }
}
function loadPolicy(id) {
  try {
    let raw = localStorage.getItem(policyKey(id));
    if (!raw && S.task && S.task.kind === 'motion') raw = localStorage.getItem(legacyPolicyKey(id));
    if (!raw) return null;
    const p = PPO.fromJSON(JSON.parse(raw));
    // Format-Wache: Policy muss zur AKTUELLEN Aufgabe passen (Motion hat
    // seit Root-Folgen einen anderen Beobachtungsraum als Speed; v2.7.0
    // kam +9 Sensorik-Kanäle hinzu)
    if (S.task && (p.obsDim !== S.task.obsDim || p.actDim !== S.task.actDim)) {
      log(`Alte Policy verworfen: Beobachtungsraum ${p.obsDim} ≠ ${S.task.obsDim} (v2.7.0: +9 Sensorik — Gyro, Gravitation, Höhe, Fußkontakte, Takt) — neu trainieren`, 'warn');
      return null;
    }
    return p;
  } catch (e) { return null; }
}
function savePolicy(id, opts = {}) {
  if (!S.trainer) { ui.toast('Keine Policy zum Speichern', true); return; }
  try {
    localStorage.setItem(policyKey(id), JSON.stringify(S.trainer.toJSON()));
    if (!opts.silent) ui.toast('Policy gespeichert');
    ui.policyAvailable(true);
    log(`Policy gespeichert (${id}${S.activeRecId ? ' · Clip ' + S.activeRecId.slice(0, 18) : ''}, ${S.trainer.stepCount} Schritte)`, 'ok');
  } catch (e) {
    ui.toast('Speichern fehlgeschlagen: ' + e.message, true);
  }
}

// ── KI-Trainer (Gemini) ─────────────────────────────────────
// Nutzer sagt in natürlicher Sprache, was der Roboter lernen soll;
// die KI liefert einen validierten Patch auf die Trainingskonfiguration.
const DEFAULT_PPO = { T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2, epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5 };

// ── Szenarien (v2.8.0): Gehen / Aufstehen / Abwurf ──────────
function scenarioOf(id) { return S.scenario[id] || 'gehen'; }

/** Aufgabenauswahl: GLB-Tracking (G1+Clip) → Recovery-Szenario → Standard. */
function makeTaskFor(id, cfg, sim) {
  if (id === 'g1' && S.motionClip) return makeMotionTask(cfg, S.motionClip, sim);
  const scn = scenarioOf(id);
  if (!cfg.drone && (scn === 'getup' || scn === 'drop')) return makeRecoveryTask(cfg, scn);
  return cfg.task(cfg);
}

/** Szenario wechseln (Chips „Aufgabe" im Trainings-Panel). */
function switchScenario(scn) {
  if (!['gehen', 'getup', 'drop'].includes(scn)) return;
  if (!S.sim || S.switching) return;
  if (S.sim.cfg.drone) { ui.toast('Für die Drohne nicht verfügbar', true); return; }
  stopTraining(true);
  if (scn !== 'gehen' && S.motionClip) {
    deactivateClip();
    log('GLB-Referenz deaktiviert — Aufgabe wechselt zu „' + scn + '"');
  }
  S.scenario[S.robotId] = scn;
  try { localStorage.setItem('tr_scenario_v1', JSON.stringify(S.scenario)); } catch (e) { /* voll */ }
  const cfg = S.sim.cfg;
  S.task = makeTaskFor(S.robotId, cfg, S.sim);
  S.task.reset(new RNG(4242), S.sim);
  pluginHost.fireReset(); // v2.9.0
  S.obsBuf = new Float32Array(S.task.obsDim);
  S.actBuf = new Float32Array(S.task.actDim);
  S.trainer = loadPolicy(S.robotId);
  ui.policyAvailable(!!S.trainer);
  if (S.mode === 'policy' && !S.trainer) { S.mode = 'manuell'; ui.setMode(S.mode); }
  syncScenarioChips();
  const label = scn === 'getup'
    ? 'AUFSTEHEN — der Roboter startet liegend (Rücken/Bauch/Seite) und lernt, selbst aufzustehen'
    : scn === 'drop'
      ? 'ABWURF — der Roboter startet 0,9–2 m über dem Boden und lernt, richtig zu landen und zu stehen'
      : 'GEHEN — Tempo-Tracking (Laufen lernen)';
  log('Aufgabe: ' + label, 'ok');
  ui.toast('Aufgabe: ' + (scn === 'getup' ? 'Aufstehen' : scn === 'drop' ? 'Abwurf' : 'Gehen'));
}

/** Sturz-Verhalten: 'reset' = Teleport (alt), 'stay' = Roboter bleibt liegen. */
function setFallMode(mode) {
  if (mode !== 'reset' && mode !== 'stay') return;
  S.fallMode = mode;
  try { localStorage.setItem('tr_fallMode', mode); } catch (e) { /* voll */ }
  syncScenarioChips();
  log(mode === 'stay'
    ? 'Sturz-Verhalten: LIEGEN LASSEN — kein Auto-Teleport mehr; der Roboter bleibt liegen (Aufstehen üben; Reset-Button setzt trotzdem zurück)'
    : 'Sturz-Verhalten: AUTO-RESET — bei Sturz zurück zum Start (bisheriges Verhalten)', 'warn');
  ui.toast(mode === 'stay' ? 'Sturz: liegen lassen' : 'Sturz: Auto-Reset');
}

function syncScenarioChips() {
  const drone = S.sim && S.sim.cfg.drone;
  const row = document.getElementById('scnRow');
  if (row) row.classList.toggle('hidden', !!drone);
  const scn = scenarioOf(S.robotId);
  for (const x of document.querySelectorAll('.scn-chip')) x.classList.toggle('active', x.dataset.scn === scn);
  for (const x of document.querySelectorAll('.fall-chip')) x.classList.toggle('active', x.dataset.fall === S.fallMode);
}

function aiTaskKind() {
  if (S.task && S.task.kind === 'motion') return 'motion';
  if (S.task && S.task.kind === 'recovery') return 'recovery:' + S.task.mode;
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
  if (patch.push && patch.push.impulse !== undefined) {
    S.pushStrength = savePushStrength(patch.push.impulse);
    touched.push('push.impulse=' + S.pushStrength.toFixed(1));
  }
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

// ── KI-AGENT: Werkzeuge, Buttons, Schubsen ───────────────
function doPush(dir = 'auto', strength = null) {
  if (!S.sim) return 'Kein Roboter geladen';
  const st = strength != null ? Math.min(10, Math.max(0.5, strength)) : S.pushStrength;
  S.sim.pushRandom(dir, st);
  controls.buzz(30);
  ui.toast('SCHUBS! (' + dir + ', Stärke ' + st.toFixed(1) + ')');
  log('Schubs: dir=' + dir + ' Stärke=' + st.toFixed(1) + ' (Δv≈' + st.toFixed(1) + ' m/s)', 'warn');
  return 'Schubs ausgeführt (dir=' + dir + ', strength=' + st.toFixed(1) + ')';
}

// ── v2.7.0: Roboterleiste + Weltleiste ──────────────────────
// Roboter dynamisch aus ROBOT_ORDER (neue Modelle erscheinen automatisch)
function renderRobotBar() {
  const bar = document.getElementById('robotBar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const id of ROBOT_ORDER) {
    const cfg = getRobot(id);
    const chip = document.createElement('button');
    chip.className = 'robot-chip';
    chip.dataset.robot = id;
    const dot = document.createElement('span');
    dot.className = 'rc-dot';
    dot.style.background = cfg.color;
    const nm = document.createElement('span');
    nm.className = 'rc-name';
    nm.textContent = cfg.name.replace('UNITREE ', '').replace('SKYDIO ', '');
    const sub = document.createElement('span');
    sub.className = 'rc-sub';
    sub.textContent = cfg.sub.split(' · ')[0];
    chip.append(dot, nm, sub);
    chip.addEventListener('click', () => {
      if (id === S.robotId || S.switching) return;
      controls.buzz(10);
      loadRobot(id);
    });
    bar.appendChild(chip);
  }
  ui.setRobotActive(S.robotId);
}

// Weltleiste: Preset-Welten + Zufall + Neu-Würfeln-Button
function renderWorldBar() {
  const bar = document.getElementById('worldBar');
  if (!bar) return;
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'world-label';
  label.textContent = 'WELT';
  bar.appendChild(label);
  for (const w of WORLDS) {
    const chip = document.createElement('button');
    chip.className = 'world-chip' + (S.world.id === w.id ? ' active' : '');
    chip.dataset.world = w.id;
    chip.textContent = w.name.toUpperCase();
    chip.title = w.desc;
    chip.addEventListener('click', () => {
      if (S.world.id === w.id || S.switching) return;
      controls.buzz();
      setWorld(w.id, S.world.seed);
    });
    bar.appendChild(chip);
  }
  const dice = document.createElement('button');
  dice.className = 'world-dice' + (S.world.id === 'zufall' ? '' : ' hidden');
  dice.id = 'worldDice';
  dice.title = 'Neue Zufallswelt (neuer Seed)';
  dice.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7" cy="7" r="1.1" fill="currentColor"/><circle cx="17" cy="17" r="1.1" fill="currentColor"/></svg>NEU';
  dice.addEventListener('click', () => {
    if (S.world.id !== 'zufall' || S.switching) return;
    controls.buzz();
    setWorld('zufall', (Math.random() * 2147483647) | 0);
  });
  bar.appendChild(dice);
}

// Welt wechseln / neu würfeln: Roboter in der neuen Welt neu kompilieren.
// Das Training bleibt im Speicher erhalten (obsDim unverändert) —
// Policies bleiben gespeichert.
async function setWorld(id, seed) {
  S.world = { id, seed: seed || 1 };
  try { localStorage.setItem('tr_world_v1', JSON.stringify(S.world)); } catch (e) { /* voll */ }
  const w = getWorld(id);
  log('Welt: ' + w.name + (id === 'zufall' ? ' (Seed ' + S.world.seed + ')' : '') + ' — ' + w.desc);
  renderWorldBar();
  await loadRobot(S.robotId);
  ui.toast('Welt: ' + w.name + (id === 'zufall' ? ' · Seed ' + S.world.seed : ''));
}

// ── WERKSTATT (v2.8.0): Plugin-Host — roher KI-Zugriff ──────
// Plugins = JS-Code von Gemini (writePlugin) oder Beispiele (★). Sie
// laufen mit dem api-Objekt unten: volle Sim-Zugriffe, Teleport, Hooks,
// eigene Chips, eigener Speicher. Fehler → Plugin aus + Meldung.
const pluginHost = new PluginHost();
pluginHost.onError = (id, name, err) => {
  log('Plugin-Fehler — „' + name + '” deaktiviert: ' + (err && err.message ? err.message : err), 'err');
  ui.toast('Plugin-Fehler: ' + name, true);
  renderPluginList();
};

/** API-Objekt je Plugin (roher Zugriff, gekapselte Speicher-Namensräume). */
function pluginApiFor(rec) {
  const _safe = (fn, dflt) => { try { return fn(); } catch (e) { log('[Plugin ' + rec.name + '] ' + (e && e.message ? e.message : e), 'err'); return dflt; } };
  return {
    log: (m) => log('[Plugin ' + rec.name + '] ' + String(m).slice(0, 200)),
    toast: (m, isErr) => ui.toast(String(m).slice(0, 80), !!isErr),
    state: () => _safe(() => JSON.parse(observeState()), null),
    sim: () => S.sim,
    task: () => S.task,
    robot: () => S.robotId,
    mode: () => S.mode,
    training: () => S.training,
    teleport: (x, y, z, qw = 1, qx = 0, qy = 0, qz = 0) => {
      if (!S.sim) return false;
      S.sim.placeBaseFull(+x, +y, +z, +qw, +qx, +qy, +qz);
      return true;
    },
    push: (strength) => doPush('auto', strength != null ? +strength : null),
    reset: () => { resetRobot(); return true; },
    executeAction: (a) => executeAction(a),
    setConfig: (patch, resetTraining) => {
      const v = validatePatch(patch);
      return applyAIPatch(v, { resetTraining: !!resetTraining }) ? 'ok' : 'patch war leer';
    },
    onStep: (f) => { if (typeof f === 'function') { pluginHost.hooks(rec.id).step.push(f); return () => { const a = pluginHost.hooks(rec.id).step; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; } return () => {}; },
    onFrame: (f) => { if (typeof f === 'function') { pluginHost.hooks(rec.id).frame.push(f); return () => { const a = pluginHost.hooks(rec.id).frame; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; } return () => {}; },
    onReset: (f) => { if (typeof f === 'function') { pluginHost.hooks(rec.id).reset.push(f); return () => { const a = pluginHost.hooks(rec.id).reset; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; } return () => {}; },
    onAct: (f) => { if (typeof f === 'function') { pluginHost.hooks(rec.id).act.push(f); return () => { const a = pluginHost.hooks(rec.id).act; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; } return () => {}; },
    onReward: (f) => { if (typeof f === 'function') { pluginHost.hooks(rec.id).reward.push(f); return () => { const a = pluginHost.hooks(rec.id).reward; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; } return () => {}; },
    ui: {
      addChip: ({ label, onClick }) => {
        const bar = document.getElementById('pluginChips');
        if (!bar || typeof onClick !== 'function') return { remove: () => {} };
        const btn = document.createElement('button');
        btn.className = 'ai-btn';
        btn.textContent = String(label || 'Plugin').slice(0, 16);
        btn.addEventListener('click', () => { controls.buzz(); _safe(() => onClick(), null); });
        bar.appendChild(btn);
        bar.classList.remove('hidden');
        return {
          remove: () => {
            btn.remove();
            if (!bar.childElementCount) bar.classList.add('hidden');
          },
        };
      },
    },
    storage: {
      get: (k, dflt) => {
        try { const v = localStorage.getItem('tr_plg_' + rec.id + '_' + k); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
      },
      set: (k, v) => {
        try { localStorage.setItem('tr_plg_' + rec.id + '_' + k, JSON.stringify(v)); return true; } catch (e) { return false; }
      },
    },
  };
}

function renderPluginList() {
  const list = document.getElementById('plgList');
  if (!list) return;
  list.innerHTML = '';
  for (const p of pluginHost.list) {
    const row = document.createElement('div');
    // EIGENE Klasse (nicht .glb-clip!) — GLB-Selektoren dürfen Plugin-Zeilen
    // nie matchen (Regression: v260-Test klickte sonst den Plugin-Toggle)
    row.className = 'plugin-row' + (p.enabled ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'glb-clip-name';
    name.textContent = p.name + (p.builtin ? ' ★' : '');
    const desc = document.createElement('span');
    desc.className = 'plg-desc';
    desc.textContent = p.desc || '';
    const tog = document.createElement('button');
    tog.className = 'btn small';
    tog.textContent = p.enabled ? 'An' : 'Aus';
    tog.addEventListener('click', () => {
      controls.buzz();
      const r = pluginHost.enable(p.id, !p.enabled);
      if (!r.ok) { ui.toast('Plugin-Fehler: ' + r.error, true, 4000); log('Plugin „' + p.name + '” Fehler: ' + r.error, 'err'); }
      else ui.toast('Plugin „' + p.name + '” ' + (p.enabled ? 'aktiv' : 'aus'));
      renderPluginList();
    });
    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = '×';
    del.title = 'Plugin löschen';
    del.addEventListener('click', () => {
      pluginHost.remove(p.id);
      renderPluginList();
      ui.toast('Plugin „' + p.name + '” entfernt');
      controls.buzz(24);
    });
    row.append(name, desc, tog, del);
    list.appendChild(row);
  }
}

function observeState() {
  const sim = S.sim;
  let up = null;
  if (sim) {
    const o = 4 * sim.baseBody;
    const x = sim._xquat[o + 1], y = sim._xquat[o + 2];
    up = 1 - 2 * (x * x + y * y);
  }
  return JSON.stringify({
    robot: S.robotId,
    mode: S.mode,
    training: S.training,
    speed: sim ? +sim.baseSpeed().toFixed(2) : null,
    height: sim ? +sim.baseHeight().toFixed(2) : null,
    upright: up !== null ? +up.toFixed(2) : null,
    episodes: S.episodes,
    policySaved: !!S.trainer,
    motionClips: S.clips.map((c, i) => ({ index: i, name: c.name })),
    activeClip: S.motionClip ? S.motionClip.name : null,
    motionCtrl: S.task && S.task.kind === 'motion'
      ? { ctrlMode: S.task.ctrlMode, animOn: S.task.animOn, cmd: { vx: +S.task.cmd.vx.toFixed(2), wz: +S.task.cmd.wz.toFixed(2) }, triggers: Array.from(S.task.trg).map(v => +v.toFixed(2)) }
      : null,
    clipButtons: (S.activeRecId && S.clips.find(r => r.id === S.activeRecId)?.buttons) || [],
    pushStrength: S.pushStrength,
    world: S.world,
    sensors: 'Gyro, projizierte Gravitation, Basis-Höhe, Fußkontakte, Phasen-Takt in der Beobachtung (v2.7.0)',
    scenario: scenarioOf(S.robotId),
    taskKind: aiTaskKind(),
    fallMode: S.fallMode,
    plugins: pluginHost.list.filter(p => p.enabled).map(p => p.name),
    joystick: controls.joyMap,
    buttons: S.aiButtons.map(b => ({ id: b.id, label: b.label, action: b.action })),
  });
}

function executeAction(action, depth = 0) {
  const act = action;
  if (!act || typeof act !== 'object') return 'Ungültige Aktion';
  switch (act.type) {
    case 'reset':
      resetRobot();
      return 'Roboter zurückgesetzt';
    case 'push':
      return doPush(act.dir || 'auto', act.strength != null ? act.strength : null);
    case 'cmd': {
      if (!S.sim) return 'Kein Roboter geladen';
      S.cruise = { vx: act.vx, yaw: act.yaw, until: performance.now() + act.ms };
      return 'Autofahrt gestartet: vx=' + act.vx.toFixed(2) + ' m/s, yaw=' + act.yaw.toFixed(2) + ' rad/s für ' + Math.round(act.ms / 1000) + ' s (endet früher bei Stick-Bewegung)';
    }
    case 'mode': {
      if (act.mode === 'policy' && !S.trainer) return 'Keine Policy vorhanden — erst Training starten';
      S.mode = act.mode;
      ui.setMode(S.mode);
      if (S.sim) S.sim.reset();
      return 'Modus: ' + act.mode.toUpperCase();
    }
    case 'clip': {
      const rec = S.clips[act.index];
      if (!rec) return 'Kein Clip an Index ' + act.index + ' (vorhanden: ' + S.clips.length + ')';
      activateClip(rec).catch(err => log('Clip-Aktivierung fehlgeschlagen: ' + err.message, 'err'));
      return 'Clip-Aktivierung gestartet: ' + (rec.name || act.index);
    }
    case 'macro': {
      if (depth > 2) return 'Makro-Verschachtelung zu tief';
      let t = 0;
      const results = [];
      for (const step of act.steps.slice(0, 6)) {
        if (step.waitMs !== undefined) { t += step.waitMs; continue; }
        const wait = t;
        const sub = step;
        setTimeout(() => executeAction(sub, depth + 1), wait);
        results.push(sub.type + '@' + wait + 'ms');
      }
      return 'Makro geplant: ' + (results.join(', ') || 'nur Wartezeiten') + ' (Gesamt ' + t + ' ms)';
    }
    default:
      return 'Unbekannter Aktionstyp: ' + (act.type || '?');
  }
}

/** Führt einen validierten Agent-Tool-Aufruf aus → Ergebnis-Text. */
function execTool(tool, args) {
  try {
    if (tool === 'observe') return observeState();
    if (tool === 'applyConfig') {
      const ok = applyAIPatch(args.patch, { resetTraining: args.resetTraining });
      return ok ? 'Konfiguration angewendet: ' + JSON.stringify(args.patch) : 'Patch war leer — nichts geändert';
    }
    if (tool === 'addButton') {
      const r = addButton({ label: args.label, action: args.action });
      if (!r.ok) return 'Fehler: ' + r.reason;
      S.aiButtons = r.list;
      renderAIButtons();
      return 'Button erstellt: id=' + r.button.id + ' label="' + r.button.label + '" action=' + JSON.stringify(r.button.action);
    }
    if (tool === 'removeButton') {
      const r = removeButton(args.id);
      if (!r.ok) return 'Fehler: ' + r.reason;
      S.aiButtons = r.list;
      renderAIButtons();
      return 'Button entfernt: ' + args.id;
    }
    if (tool === 'mapJoystick') {
      controls.joyMap = validateJoyMap(args);
      saveJoyMap(controls.joyMap);
      return 'Joystick-Map gesetzt: ' + JSON.stringify(controls.joyMap);
    }
    if (tool === 'setScenario') {
      if (!args.scenario) return 'Ungültiges Szenario — erlaubt: "gehen", "getup", "drop"';
      if (S.sim && S.sim.cfg.drone) return 'Für die Drohne nicht verfügbar (nur Laufroboter)';
      switchScenario(args.scenario);
      return 'Aufgabe: ' + args.scenario + (S.task ? ' (aktiv: ' + S.task.kind + (S.task.mode ? '/' + S.task.mode : '') + ', obsDim ' + S.task.obsDim + ')' : '') + ' — alte Policies dieser Art bleiben erhalten, ggf. neu trainieren.';
    }
    if (tool === 'setFallMode') {
      if (!args.mode) return 'Ungültiger Modus — erlaubt: "reset", "stay"';
      setFallMode(args.mode);
      return 'Sturz-Verhalten: ' + args.mode + (args.mode === 'stay' ? ' (Roboter bleibt liegen, kein Teleport)' : ' (Auto-Reset zum Start)');
    }
    if (tool === 'runCode') {
      if (!args.code || !args.code.trim()) return 'Fehler: code ist leer';
      let fn;
      try { fn = compilePlugin(args.code); } catch (e) { return 'SYNTAX-FEHLER: ' + e.message; }
      try {
        const out = fn(pluginApiFor({ id: 'run', name: 'runCode' }));
        return 'OK' + (out === undefined ? '' : ': ' + (typeof out === 'object' ? JSON.stringify(out) : String(out)).slice(0, 300));
      } catch (e) { return 'LAUFZEIT-FEHLER: ' + (e && e.message ? e.message : String(e)); }
    }
    if (tool === 'writePlugin') {
      if (!args.name) return 'Fehler: Name fehlt (args.name)';
      if (!args.code || !args.code.trim()) return 'Fehler: code ist leer';
      try { compilePlugin(args.code); } catch (e) { return 'SYNTAX-FEHLER im Plugin-Code: ' + e.message + ' — korrigiere den Code und rufe writePlugin erneut auf.'; }
      const rec = pluginHost.add({ name: args.name, desc: args.desc, code: args.code, enabled: false });
      const en = pluginHost.enable(rec.id, true);
      renderPluginList();
      if (!en.ok) return 'Plugin „' + rec.name + '” gespeichert, aber LAUFZEIT-FEHLER: ' + en.error + ' — korrigiere den Code und rufe writePlugin erneut auf (das defekte Plugin ist deaktiviert).';
      log('KI-Plugin installiert + aktiv: ' + rec.name, 'ok');
      ui.toast('Plugin installiert: ' + rec.name);
      return 'Plugin „' + rec.name + '” (id=' + rec.id + ') installiert und AKTIV. Verfügbar: onStep/onFrame/onReset/onAct/onReward, ui.addChip, teleport, push, storage, sim(). Es läuft ab jetzt bei jedem App-Start mit.';
    }
    return 'Unbekanntes Werkzeug: ' + tool;
  } catch (e) {
    return 'Werkzeug-Fehler: ' + e.message;
  }
}

function renderAIButtons() {
  const bar = document.getElementById('aiButtons');
  if (!bar) return;
  bar.innerHTML = '';
  bar.classList.toggle('hidden', !S.aiButtons.length);
  for (const b of S.aiButtons) {
    const btn = document.createElement('button');
    btn.className = 'ai-btn';
    btn.dataset.bid = b.id;
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      controls.buzz();
      const res = executeAction(b.action);
      log('KI-Button "' + b.label + '": ' + res);
    });
    // Lang drücken (600 ms) = löschen
    let pressT = 0;
    btn.addEventListener('pointerdown', () => { pressT = setTimeout(() => {
      const r = removeButton(b.id);
      if (r.ok) { S.aiButtons = r.list; renderAIButtons(); ui.toast('KI-Button "' + b.label + '" entfernt'); controls.buzz(24); }
    }, 600); });
    const clear = () => clearTimeout(pressT);
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('pointerleave', clear);
    bar.appendChild(btn);
  }
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
  let wait = aiPush('bot', 'Denkt nach …');
  try {
    let toolMsg = text.trim();
    let toolTurns = 0;
    while (toolTurns < 5) {
      const ctx = aiCtx();
      const res = await askAI({ text: toolMsg, mode: S.aiMode, ctx });
      wait.remove();
      if (!res.tool || toolTurns >= 4) {
        renderAIAnswer(res, ctx.current);
        S.aiHistory.push({ role: 'user', text: text.trim() }, { role: 'model', text: res.antwort });
        break;
      }
      // ── Werkzeug ausführen und als Ergebnis zurück an die KI ──
      aiPush('tool', '⚙ ' + res.tool + ' ' + JSON.stringify(res.args).slice(0, 160));
      const result = execTool(res.tool, res.args);
      aiPush('toolres', String(result).slice(0, 400));
      log('KI-Agent: ' + res.tool + ' → ' + String(result).slice(0, 80), 'ok');
      S.aiHistory.push({ role: 'user', text: toolMsg }, { role: 'model', text: res.antwort || ('[' + res.tool + ']') });
      toolMsg = 'TOOL-ERGEBNIS (' + res.tool + '): ' + result + '\nAntworte jetzt kurz auf Deutsch — oder rufe das nächste Werkzeug auf.';
      toolTurns++;
      wait = aiPush('bot', 'Denkt nach …');
    }
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
  if (!S.aiHistory.length) aiPush('bot', 'Sag mir, was dein Roboter lernen soll — ich stelle Belohnungen, Zieltempo und Training dafür ein. Ich kann auch EIGENE MODS/PLUGINS für die App schreiben (Werkstatt unten) und den Roboter direkt steuern. (z. B. „schreibe ein Plugin, das ihn alle 10 s schubst“)');
  renderPluginList(); // Werkstatt-Stand auffrischen (v2.8.0)
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
/** Ist mindestens ein Plugin aktiv? (Paralleltraining ausgeschlossen) */
function pluginsActive() {
  try { return pluginHost.list.some(p => p.enabled); } catch (e) { return true; }
}

/** Aufgaben-Beschreibung für die Sim-Worker (v2.10.0). */
function workerTaskSpec() {
  const kind = S.task && S.task.kind;
  if (kind === 'motion') return { kind: 'motion', clip: S.motionClip };
  if (kind === 'recovery') return { kind: 'recovery', mode: S.task.mode || scenarioOf(S.robotId) };
  return { kind: 'speed' };
}

/** Umgebungseinstellungen (KI-Patches etc.) an die Worker durchreichen. */
function parallelEnvCfg() {
  const cfg = S.sim ? S.sim.cfg : null;
  if (!cfg) return null;
  const env = {};
  if (cfg.rW) env.rW = { ...cfg.rW };
  if (cfg.done) env.done = { ...cfg.done };
  if (cfg.cmd) env.cmd = JSON.parse(JSON.stringify(cfg.cmd));
  if (cfg.actSpan !== undefined) env.actSpan = cfg.actSpan;
  if (S.task && S.task.kind === 'motion') env.motionR = { ...MOTION_R };
  if (S.task && S.task.kind === 'recovery') env.recoveryR = { ...RECOVERY_R };
  env.fallMode = S.fallMode;
  return env;
}

/** Merge-Ergebnis einer Worker-Runde → UI/Statistik. */
function onParallelSegment(info) {
  S.episodes += info.episodes;
  for (const r of info.epRewards) ui.pushEpisodeReward(r);
  if (info.round <= 3 || info.round % 10 === 0) {
    const mm = info.metrics || {};
    log(`PPO-Runde ${info.round}: ${info.steps} Schritte aus ${S.parallel ? S.parallel.n : '?'} Workern gemischt · clipFrac ${(100 * (mm.clipFrac || 0)).toFixed(0)}% · ${Math.round(info.rate)} Schritte/s`, 'ok');
  }
  // Plugin wurde während des Paralleltrainings aktiviert? → sauber zurück
  // auf Inline (Plugins greifen nur im Haupt-Thread-Rollout).
  if (S.parallel && pluginsActive()) {
    log('Plugin aktiviert — Paralleltraining endet, Training läuft inline weiter (Plugins wirken nur dort)', 'warn');
    ui.toast('Plugin aktiv — Training läuft inline');
    S.parallel.stop();
    S.parallel = null;
    return;
  }
  if (S.parallel) S.parallel.envCfg = parallelEnvCfg(); // KI-Patches live durchreichen
}

function startTraining() {
  if (!S.sim || !S.task) return;
  if (!S.trainer) {
    S.trainer = new PPO(S.task.obsDim, S.task.actDim, { ...PPO_OVERRIDES }, 1337 + ROBOT_ORDER.indexOf(S.robotId));
    log(`PPO initialisiert: obs ${S.task.obsDim} → 64×64 → act ${S.task.actDim} · CPU`, 'warn');
  }
  // v2.10.0: Tempo „MAX“ = PARALLELES TRAINING — mehrere MuJoCo-WASM-
  // Instanzen in Web Workern (je CPU-Kern eine), Erfahrungen werden pro
  // Runde für das gemeinsame PPO-Update gemischt. Voraussetzungen: kein
  // Plugin aktiv (Plugins wirken nur im Haupt-Thread-Rollout) und
  // Worker-Support. Sonst: Inline-Training wie bisher.
  if (S.speedMode === 'max' && !S.parallel && !pluginsActive()) {
    try {
      const par = new ParallelTrainer({
        getPPO: () => S.trainer,
        onSegment: onParallelSegment,
        log,
      });
      par.envCfg = parallelEnvCfg();
      S.parallel = par;
      const n = suggestWorkerCount();
      par.start({
        robotId: S.robotId,
        taskSpec: workerTaskSpec(),
        worldXml: buildWorldXML(S.sim.cfg, S.world.id, S.world.seed),
        hyper: { T: Math.round(Math.min(2048, Math.max(128, S.trainer.h.T || 512))) },
        seed: 1337 + ROBOT_ORDER.indexOf(S.robotId),
        n,
      }).then((ready) => {
        if (!S.training || S.parallel !== par) { par.stop(); return; }
        log(`Training läuft PARALLEL auf ${ready} MuJoCo-Workern + PPO-Merge im Haupt-Thread`, 'ok');
      }).catch((err) => {
        log('Paralleltraining nicht verfügbar (' + err.message + ') — Inline-Training im Haupt-Thread', 'warn');
        if (S.parallel === par) S.parallel = null;
      });
    } catch (e) {
      log('Paralleltraining nicht verfügbar (' + e.message + ') — Inline-Training', 'warn');
      S.parallel = null;
    }
  } else if (S.speedMode === 'max' && pluginsActive()) {
    log('Tempo MAX mit aktivem Plugin: Training läuft inline (Plugins wirken nur im Haupt-Thread-Rollout)', 'warn');
  }
  S.task.reset(S.trainer.rng, S.sim);
  pluginHost.fireReset();
  S.training = true;
  S.epReward = 0;
  ui.$('tStart').textContent = 'Training pausieren';
  ui.$('tStart').classList.add('btn-stop');
  const tInfo = S.task.kind === 'recovery'
    ? (S.task.mode === 'getup' ? 'Aufstehen — Start liegend' : 'Abwurf — Start in der Luft')
    : S.task.kind === 'motion' ? 'GLB-Motion-Tracking' : 'Tempo-Tracking';
  log('Training läuft (' + tInfo + ') — rollout + update auf der CPU', 'ok');
}

function stopTraining(silent = false) {
  if (!S.training) return;
  S.training = false;
  if (S.parallel) { S.parallel.stop(); S.parallel = null; }
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
  if (!finiteArr(S.obsBuf)) { sim.reset(); task.reset(trainer.rng, sim); pluginHost.fireReset(); return; }
  trainer.norm.update(S.obsBuf);
  const { act, logp, value } = trainer.act(S.obsBuf, false);
  task.actionToCtrl(sim, act);
  pluginHost.fireAct(sim, sim.ctrl); // Plugins dürfen ctrl umschreiben (v2.8.0)
  sim.stepN(substeps);
  if (task.kind === 'motion') task.advance(CTRL_DT);
  let { r, done } = task.reward(sim);
  // Reward-Hook (v2.8.0): Plugins formen Belohnungen um (Bonus/done)
  // v2.9.0 FIX: info.upz/info.height wurden bisher NIE mitgeliefert
  // (immer undefined — Plugins konnten also nicht auf Aufrecht/Höhe
  // reagieren → „Kopfstand-Plugin verändert nichts"). Jetzt echt.
  const _o4 = 4 * sim.baseBody;
  const _bx = sim._xquat[_o4 + 1], _by = sim._xquat[_o4 + 2];
  const rBefore = r;
  const rw = pluginHost.fireReward(sim, {
    r, done, task,
    upz: 1 - 2 * (_bx * _bx + _by * _by),
    height: sim._xpos[3 * sim.baseBody + 2],
  });
  r = rw.r; done = rw.done;
  S.plgBonus = (S.plgBonus || 0) + (r - rBefore);
  for (let i = 0; i < act.length; i++) task.lastAct[i] = act[i];
  S.epReward += r;

  const full = trainer.store(S.obsBuf, act, logp, r, done, value);
  if (done) {
    S.episodes++;
    ui.pushEpisodeReward(S.epReward);
    S.epReward = 0;
    // v2.9.0 „Liegen lassen" konsequent: Endet eine GEH-Episode durch einen
    // Sturz UND „Liegen lassen" ist gewählt, bleibt der Roboter LIEGEN
    // (kein Teleport) — die Episode endet trotzdem sauber für PPO
    // (Value-Bootstrap via done=true), die nächste startet aus der Lage.
    const o4 = 4 * sim.baseBody;
    const fx = sim._xquat[o4 + 1], fy = sim._xquat[o4 + 2];
    const fallen = (1 - 2 * (fx * fx + fy * fy)) < sim.cfg.done.upMin;
    // kind==='speed' | undefined (Speed-Task vor v2.9.0 ohne kind) — nur die
    // Geh-Aufgabe bleibt liegen; Motion-Tracking/Recovery resetten normal.
    const stayDown = (task.kind === 'speed' || task.kind === undefined) && S.fallMode === 'stay' && fallen && Number.isFinite(fx + fy);
    if (stayDown) {
      task.reset(trainer.rng, sim); // neue Kommandos — POSE bleibt (liegt weiter)
      pluginHost.fireReset();
      const now = performance.now();
      if (now - lastFallLog > 6000) {
        log('Episode endete (Sturz) — Roboter bleibt liegen („Liegen lassen“). Aufstehen lernen: Aufgabe „Aufstehen“.', 'warn');
        lastFallLog = now;
      }
    } else {
      sim.reset();
      task.reset(trainer.rng, sim);
      pluginHost.fireReset();
    }
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
  // KI-Autofahrt (Cruise): fester Fahrbefehl, endet an Zeitgrenze oder
  // sobald der Nutzer den Stick bewegt (Eingriff geht immer vor).
  let cmd;
  if (S.cruise) {
    if (performance.now() > S.cruise.until || Math.abs(controls.stickX) > 0.15 || Math.abs(controls.stickY) > 0.15) {
      if (S.cruise.until && performance.now() > S.cruise.until) ui.toast('Autofahrt beendet');
      else ui.toast('Autofahrt beendet (Stick-Eingriff)');
      S.cruise = null;
    }
  }
  if (S.cruise) {
    cmd = { vx: S.cruise.vx, yaw: S.cruise.yaw, climb: 0 };
  } else {
    cmd = controls.command(cfg);
  }
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
  // Joystick/Buttons-Steuerung (v2.5.0): bei ctrlMode 'joy'/'btn' liefert
  // der Stick die Kommandos (vx = Vorwärts, yaw = Gieren), die die Policy
  // im Training mit Zufalls-Werten kennengelernt hat.
  if (task.kind === 'motion' && (task.ctrlMode === 'joy' || task.ctrlMode === 'btn')) {
    const c = controls.command(S.sim.cfg);
    task.cmd.vx = c.vx; task.cmd.wz = c.yaw;
  }
  task.observe(sim, S.obsBuf);
  // v2.9.0: NaN-Wache resetzt jetzt auf die AUFGABEN-Startpose (statt still
  // zur Keyframe-Stehpose zu teleportieren — „liegen an gemacht, aber wurde
  // zurück teleportiert"): Recovery bleibt liegend, Speed bleibt am Boden.
  if (!finiteArr(S.obsBuf)) {
    sim.reset();
    if (S.task && S.task.kind !== 'motion') S.task.reset(new RNG(4242), sim);
    if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0;
    pluginHost.fireReset();
    return;
  }
  trainer.actDeterministic(S.obsBuf, S.actBuf);
  task.actionToCtrl(sim, S.actBuf);
  pluginHost.fireAct(sim, sim.ctrl); // v2.8.0
  for (let i = 0; i < S.actBuf.length; i++) task.lastAct[i] = S.actBuf[i];
  sim.stepN(substeps);
  if (task.kind === 'motion') task.advance(CTRL_DT);
}

function resetRobot() {
  if (!S.sim) return;
  S.sim.reset();
  pluginHost.fireReset();
  if (S.task && S.task.kind === 'motion') S.task.reset(new RNG(4242), S.sim); // zurück auf den Bahn-Anfang
  if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0;
  S.epReward = 0;
  log('Roboter zurückgesetzt auf Keyframe „' + S.sim.cfg.keyName + '"');
}

// Sturz-Erkennung im Echtzeitbetrieb (v2.8.0: Verhalten wählbar)
// 'reset' (alt): Auto-Reset = Teleport zurück zur Keyframe-Pose.
// 'stay': kein Teleport — der Roboter bleibt liegen (Aufstehen üben).
// Recovery-Szenarien (getup/drop) haben IMMER kein Auto-Reset — dort ist
// der Sturz ja der Startzustand bzw. Bestandteil der Aufgabe.
let lastFallLog = 0;
function checkFall() {
  const sim = S.sim;
  if (!sim) return;
  if (S.task && S.task.kind === 'recovery') return; // Sturz gehört zur Aufgabe
  const o = 4 * sim.baseBody;
  const x = sim._xquat[o + 1], y = sim._xquat[o + 2]; // (x,y) der Quaternion [w,x,y,z]
  const upz = 1 - 2 * (x * x + y * y);
  const height = sim._xpos[3 * sim.baseBody + 2];
  const limit = sim.cfg.drone ? 0.35 : 0.32;
  const zMin = sim.cfg.drone ? 0.05 : sim.cfg.done.zMin * 0.8;
  if (upz < limit || height < zMin) {
    if (S.fallMode === 'stay') {
      const now = performance.now();
      if (now - lastFallLog > 4000) {
        log('Sturz — Roboter bleibt liegen („Liegen lassen“): Aufgabe → Aufstehen trainieren oder Reset-Button', 'warn');
        lastFallLog = now;
      }
      return;
    }
    const now = performance.now();
    if (now - lastFallLog > 2500) {
      log('Sturz erkannt — Auto-Reset', 'warn');
      lastFallLog = now;
    }
    sim.reset();
    if (S.gait && S.gait.ph !== undefined) S.gait.ph = 0;
    S.epReward = 0;
    pluginHost.fireReset();
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
    // KI-Agent-Zustand: Buttons, Joystick-Map, Schubs-Stärke
    S.aiButtons = loadButtons();
    controls.joyMap = loadJoyMap();
    S.pushStrength = loadPushStrength();
    // GLB-Animation im Training (v2.5.0): persistiert — AUS = nur Gleichgewicht
    S.animTraining = localStorage.getItem('tr_animOn') !== '0';
    const animTog = document.getElementById('animTrainToggle');
    if (animTog) animTog.checked = S.animTraining;
    // Werkstatt (v2.8.0): Beispiele einspeisen, API aufschalten, aktivierte
    // Plugins starten (Hooks feuern erst mit der Hauptschleife)
    pluginHost.setApiFactory(pluginApiFor);
    for (const b of BUILTIN_PLUGINS) pluginHost.addOrReplaceBuiltin(b);
    for (const p of pluginHost.list) {
      if (!p.enabled) continue;
      const r = pluginHost.install(p.id);
      if (!r.ok) log('Plugin „' + p.name + '” startet nicht: ' + r.error, 'err');
    }
    renderPluginList();
    controls.onPush = (dir, strength) => doPush(dir, strength);
    renderAIButtons();
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
    log('Bereit. Sechs Roboter · ' + WORLDS.length + ' Welten · Sensorik aktiv — gleiche Steuerung.', 'ok');
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
  pluginHost.fireFrame(dt); // Plugin-Hook: je Bild (v2.8.0)
  if (controls.consumeReset()) resetRobot();

  if (S.training) {
    if (S.parallel && S.parallel.active) {
      // v2.10.0 PARALLEL: Worker rollen selbstständig; hier nur Takt/Anzeige.
      S.stepsPerSec = S.parallel.rate;
    } else if (S.parallel && S.parallel.starting) {
      // Worker booten (WASM-Kompilierung) — Inline-Training anhalten,
      // damit die Kerne für den Boot frei sind (sonst Timeout-Gefahr).
      S.stepsPerSec = 0;
    } else {
      // Inline (Fallback / Tempo 1×–16×): Zeitbudget pro Frame
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
    }
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
      pluginHost.fireStep(cdt); // Plugin-Hook: je Regelzyklus, Echtzeit (v2.8.0)
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
    // Loop-Rebase: Referenz läuft nach jedem Durchlauf WEITER (kein Teleport)
    const rr = clip.root && clip.yaw && S.task.refRoot ? S.task.refRoot(S.task.phase, [0, 0, 0]) : null;
    if (r3d.sourceGhost) {
      r3d.updateSourceGhost(fr);
      if (rr) r3d.setSourceGhostLoop(rr[0] - clip.root[2 * fr], rr[1] - clip.root[2 * fr + 1]);
    }
    if (r3d.ghostGroups) {
      const gh = S.sim.makeGhostData();
      // baseQ: Lehrer-Nick/Roll (z. B. Zombie-Beuge) — der G1-Geist nimmt die
      // ABSOLUTE Lehrer-Pose an statt aufrecht daneben zu stehen
      const bq = clip.baseQ ? clip.baseQ.subarray(4 * fr, 4 * fr + 4) : null;
      if (rr) {
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], rr[0], rr[1], rr[2], bq);
      } else if (clip.root && clip.yaw) {
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], clip.root[2 * fr], clip.root[2 * fr + 1], clip.yaw[fr], bq);
      } else {
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], 0, 0, 0, bq);
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
    // v2.9.0: sichtbarer Beweis, dass Plugins das Training formen
    if (S.plgBonus && (S.training || S.mode === 'policy') && performance.now() - (S._plgLogT || 0) > 10000) {
      log(`Plugin-Belohnung aktiv (Σ Bonus ${S.plgBonus >= 0 ? '+' : ''}${S.plgBonus.toFixed(1)}) — Training reagiert`, 'ok');
      S._plgLogT = performance.now();
      S.plgBonus = 0;
    }
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

  // ── v2.7.0: Roboterleiste dynamisch (6 Modelle) ─────────
  renderRobotBar();
  renderWorldBar();

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
  // ── Szenarien + Sturz-Verhalten (v2.8.0) ────────────────
  for (const b of document.querySelectorAll('.scn-chip')) {
    b.addEventListener('click', () => { controls.buzz(); switchScenario(b.dataset.scn); });
  }
  for (const b of document.querySelectorAll('.fall-chip')) {
    b.addEventListener('click', () => { controls.buzz(); setFallMode(b.dataset.fall); });
  }
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
  // v2.7.0 FIX: Nur Chips mit data-speed sind Tempo-Chips — die Steuerungs-
  // Chips (Keine/Joystick/Buttons) teilen die Klasse .speed-chip und setzten
  // versehentlich speedMode=undefined → Training lief nur 1 Schritt/Frame!
  for (const b of document.querySelectorAll('.speed-chip[data-speed]')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('.speed-chip[data-speed]')) x.classList.remove('active');
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
  // ── Steuerung je Clip (v2.5.0): Keine = Referenzbahn, Joystick = Zufalls-
  // Kommandos im Training + echte Stick-Steuerung im POLICY-Modus.
  // v2.6.0: „Buttons" = wie Joystick PLUS 4 Trigger-Kanäle für nutzer-
  // definierte Aktionen (z. B. Kicken/Springen) — unten in der Leiste.
  for (const b of document.querySelectorAll('.ctrl-chip')) {
    b.addEventListener('click', () => {
      controls.buzz();
      const mode = b.dataset.ctrl;
      const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
      if (!rec || !S.task || S.task.kind !== 'motion') { ui.toast('Zuerst eine GLB-Referenz wählen', true); return; }
      for (const x of document.querySelectorAll('.ctrl-chip')) x.classList.toggle('active', x === b);
      rec.ctrl = mode;
      putClip(rec).catch(() => {});
      S.task.ctrlMode = mode;
      S.task.cmd.vx = 0; S.task.cmd.wz = 0; S.task._cmdHold = 0;
      S.task._trgHold.fill(0);
      syncBtnRow();
      renderClipButtons();
      log(mode === 'joy'
        ? 'Steuerung: JOYSTICK — im Training werden zufällige Fahrbefehle (vx, Gier-Rate) gewürfelt, damit die Policy lernt, dass der Joystick sie steuert; im POLICY-Modus steuert der echte Stick'
        : mode === 'btn'
          ? 'Steuerung: BUTTONS — wie Joystick, PLUS deine Buttons (z. B. Kicken/Springen): im Training feuern sie zufällig und die Policy lernt eine eigene Aktion dazu; im POLICY-Modus löst eine Taste die Aktion aus (unten in der Leiste)'
          : 'Steuerung: KEINE — das Gelernte folgt rein der Referenzbahn (typisch für Idle)', 'ok');
      ui.toast(mode === 'joy' ? 'Steuerung: Joystick' : mode === 'btn' ? 'Steuerung: Buttons' : 'Steuerung: keine');
    });
  }
  // ── Clip-Buttons hinzufügen (v2.6.0) ────────────────────
  const addClipBtn = document.getElementById('glbBtnAdd');
  const nameInp = document.getElementById('glbBtnName');
  if (addClipBtn && nameInp) {
    const addFromInput = () => {
      const label = (nameInp.value || '').trim().slice(0, 12);
      if (!label) { ui.toast('Erst einen Namen tippen (z. B. Kicken)', true); return; }
      const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
      if (!rec) { ui.toast('Zuerst eine GLB-Referenz wählen', true); return; }
      const list = Array.isArray(rec.buttons) ? rec.buttons.slice() : [];
      if (list.some(x => x.toLowerCase() === label.toLowerCase())) { ui.toast('Button existiert schon', true); return; }
      if (list.length >= 4) { ui.toast('Maximal 4 Buttons pro Clip', true); return; }
      list.push(label);
      rec.buttons = list;
      putClip(rec).catch(() => {});
      if (S.task && S.task.kind === 'motion') S.task.buttons = list.slice();
      nameInp.value = '';
      renderClipButtons();
      controls.buzz();
      log(`Button „${label}" hinzugefügt (${list.length}/4) — Training würfelt jetzt auch diesen Trigger`, 'ok');
      ui.toast('Button „' + label + '" angelegt');
    };
    addClipBtn.addEventListener('click', addFromInput);
    nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });
  }
  // ── Animation im Training an/aus (v2.5.0): AUS = nur Gleichgewicht lernen
  const animT = document.getElementById('animTrainToggle');
  if (animT) animT.addEventListener('change', () => {
    S.animTraining = animT.checked;
    try { localStorage.setItem('tr_animOn', animT.checked ? '1' : '0'); } catch (e) { /* voll */ }
    if (S.task && S.task.kind === 'motion') S.task.animOn = animT.checked;
    log(animT.checked
      ? 'Animation im Training: AN — Posen-Tracking aktiv'
      : 'Animation im Training: AUS — es wird nur GLEICHGEWICHT gelernt (Referenz = Stand; die Animationen haben ja kein Gleichgewicht)', 'warn');
    ui.toast(animT.checked ? 'Animation im Training an' : 'Nur Gleichgewicht lernen');
  });
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

// Chips der Steuerungs-Wahl auf den aktiven Clip syncen (v2.5.0)
function syncCtrlChips() {
  const mode = S.task && S.task.kind === 'motion' ? S.task.ctrlMode : 'none';
  for (const x of document.querySelectorAll('.ctrl-chip')) x.classList.toggle('active', x.dataset.ctrl === mode);
}

// Eingabezeile für neue Buttons nur im 'btn'-Modus zeigen (v2.6.0)
function syncBtnRow() {
  const row = document.getElementById('glbBtnRow');
  if (!row) return;
  const on = !!(S.task && S.task.kind === 'motion' && S.task.ctrlMode === 'btn');
  row.classList.toggle('hidden', !on);
}

// Clip-Buttons unten in der Leiste rendern (v2.6.0): sichtbar, wenn der
// aktive Clip im 'btn'-Modus ist und Buttons existieren. Tippen = Trigger
// (POLICY- UND MANUELL-Modus); lange drücken = Button löschen.
function renderClipButtons() {
  const bar = document.getElementById('clipButtons');
  if (!bar) return;
  bar.innerHTML = '';
  const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
  const labels = (rec && Array.isArray(rec.buttons)) ? rec.buttons : [];
  const on = !!(S.task && S.task.kind === 'motion' && S.task.ctrlMode === 'btn' && labels.length);
  bar.classList.toggle('hidden', !on);
  if (!on) return;
  labels.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.className = 'ai-btn clip-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      controls.buzz();
      if (S.task && S.task.kind === 'motion' && S.task.setTrigger(i)) {
        btn.classList.add('hold');
        setTimeout(() => btn.classList.remove('hold'), 500);
        log('Button „' + label + '\" ausgelöst');
      }
    });
    // Lang drücken (600 ms) = löschen
    let pressT = 0;
    btn.addEventListener('pointerdown', () => { pressT = setTimeout(() => {
      const list = labels.slice(); list.splice(i, 1);
      rec.buttons = list;
      putClip(rec).catch(() => {});
      if (S.task && S.task.kind === 'motion') S.task.buttons = list.slice();
      renderClipButtons();
      ui.toast('Button „' + label + '\" entfernt');
      controls.buzz(24);
    }, 600); });
    const clear = () => clearTimeout(pressT);
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('pointerleave', clear);
    bar.appendChild(btn);
  });
}

async function refreshClipList() {
  S.clips = await listClips();
  const list = document.getElementById('glbList');
  if (!list) return;
  list.innerHTML = '';
  for (const rec of S.clips) {
    const row = document.createElement('div');
    // v2.6.0: Aktiv-Merkung über die RECORD-ID (der alte Name-Vergleich
    // ‚motionClip.name === rec.name' griff nie — Datei- vs. Animationsname —
    // deshalb zeigte die aktive Zeile nie „Aktiv" und Deaktivieren war
    // unmöglich: „nur entfernen, aber es bleibt geladen")
    const active = S.activeRecId ? S.activeRecId === rec.id : false;
    row.className = 'glb-clip' + (active ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'glb-clip-name';
    name.textContent = rec.name;
    const meta = document.createElement('span');
    meta.className = 'glb-clip-meta';
    const m = rec.motion;
    meta.textContent = (m.duration || 0).toFixed(1) + 's · ' + m.n + 'F';
    // v2.7.0: Policy-Badge — zeigt, dass dieser Clip ein gespeichertes
    // Training hat (bleibt auch nach Deaktivieren/Neustart erhalten)
    if (policyExistsForClip(rec.id)) {
      const badge = document.createElement('span');
      badge.className = 'glb-clip-badge';
      badge.textContent = 'Policy';
      badge.title = 'Gespeicherte Policy vorhanden (wird beim Aktivieren geladen)';
      row.appendChild(badge);
    }
    const use = document.createElement('button');
    use.className = 'btn small';
    if (active) {
      // v2.6.0: aktiven Clip DEAKTIVIEREN ohne ihn aus der Liste zu werfen
      use.textContent = 'Aus';
      use.title = 'Referenz deaktivieren (Clip bleibt in der Liste)';
      use.addEventListener('click', () => deactivateClip());
    } else {
      use.textContent = 'Referenz';
      use.addEventListener('click', () => activateClip(rec));
    }
    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      await deleteClip(rec.id);
      if (active) deactivateClip();
      await refreshClipList();
      // v2.7.0: Die Policy des gelöschten Clips bleibt bewusst gespeichert —
      // ein versehentliches Entfernen zerstört kein Training.
      ui.toast('Clip entfernt — seine Policy bleibt gespeichert');
    });
    row.append(name, meta, use, del);
    list.appendChild(row);
  }
}

async function activateClip(rec) {
  if (S.robotId !== 'g1' || !S.sim) { ui.toast('Nur mit dem G1 möglich', true); return; }
  stopTraining(true);
  S.activeRecId = rec.id; // aktiver Clip-Datensatz (für Steuerungs-Wahl, v2.5.0)
  S.motionClip = unpackMotion(rec.motion);
  // v2.6.1 — AUTO-RE-RETARGET bei altem Algorithmus-Bestand: Das retargetete
  // Ergebnis liegt PERSISTIERT im Record (IndexedDB) — ein Bein-Fix im Code
  // erreichte bestehende Clips deshalb NIE („es ist wie davor", obwohl die
  // v2.6.0 längst den Valgus-Fix hatte). Ist der gespeicherte Stand älter
  // als RT_ALG UND die GLB-Datei liegt noch im Record, wird beim Aktivieren
  // EINMAL neu retargetet und der Record aktualisiert (ctrl/buttons/glb
  // bleiben erhalten — nur motion wird ausgetauscht).
  if ((rec.motion.alg || 0) < RT_ALG && rec.glb) {
    try {
      log('Bein-Algorithmus ist neuer als beim Import — „' + rec.name + '\u201c wird neu retargetet …');
      const c2 = new GlbClip(rec.glb);
      c2.useAnimation(rec.animIndex || 0);
      const motion = retargetToG1(c2, S.sim, (m) => log('  ' + m));
      rec.motion = packMotion(motion);
      await putClip(rec); // gleiche id → überschreibt nur motion
      S.motionClip = unpackMotion(rec.motion);
      log('Neu retargetet: ' + motion.n + ' Frames × ' + motion.nu + ' Gelenke — Beine im natürlichen G1-Stand (v' + VERSION + ')', 'ok');
    } catch (e) {
      log('Neu-Retargeting fehlgeschlagen — alter Bestand bleibt (' + (e && e.message ? e.message : e) + ')', 'warn');
    }
  }
  S.task = makeMotionTask(S.sim.cfg, S.motionClip, S.sim);
  // Steuerung + Animation-Status je Clip (v2.5.0, Buttons v2.6.0)
  S.task.ctrlMode = rec.ctrl === 'joy' || rec.ctrl === 'btn' ? rec.ctrl : 'none';
  S.task.buttons = Array.isArray(rec.buttons) ? rec.buttons.slice(0, 4) : [];
  S.task.animOn = S.animTraining;
  syncCtrlChips();
  syncBtnRow();
  renderClipButtons();
  S.task.reset(new RNG(4242), S.sim); // platziert die Basis AUF der Bahn
  pluginHost.fireReset(); // v2.9.0
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
  const ctrlInfo = S.task.ctrlMode === 'joy' ? ' · Steuerung: JOYSTICK (Training würfelt Fahrbefehle, POLICY-Modus: Stick)'
    : S.task.ctrlMode === 'btn' ? ' · Steuerung: BUTTONS (Training würfelt Fahrbefehle + Trigger, POLICY-Modus: Stick + Tasten unten)'
    : ' · Steuerung: keine (rein Referenzbahn)';
  log('GLB-Referenz aktiv: ' + rec.name + ' (' + S.motionClip.duration.toFixed(1) + 's, Endlosschleife)' + mergeInfo + rootInfo + ctrlInfo + ' — Aufgabe: Motion-Tracking' + (S.task.animOn ? '' : ' [ANIMATION AUS — nur Gleichgewicht]'), 'ok');
  ui.toast('Referenz aktiv: ' + rec.name);
  refreshClipList().catch(() => {});
}

function deactivateClip() {
  stopTraining(true);
  // v2.7.0: Policy des Clips AUTOMATISCH SPEICHERN (solange die Aufgabe
  // noch Motion ist und activeRecId gesetzt) — Deaktivieren ist KEIN
  // Verlust mehr: beim Reaktivieren wird das Netz wieder geladen.
  if (S.trainer && S.task && S.task.kind === 'motion' && S.activeRecId) {
    savePolicy(S.robotId, { silent: true });
    log('Policy des Clips automatisch gespeichert — bleibt erhalten');
  }
  S.motionClip = null;
  S.srcScene = null;
  S.activeRecId = null;
  syncCtrlChips();
  syncBtnRow();
  renderClipButtons();
  r3d.removeGhost();
  r3d.removeSourceGhost();
  if (S.sim) {
    const cfg = S.sim.cfg;
    S.task = makeTaskFor(S.robotId, cfg, S.sim); // v2.8.0: Szenario respektieren
    S.task.reset(new RNG(4242), S.sim);
    pluginHost.fireReset(); // v2.9.0
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
    get pushStrength() { return S.pushStrength; },
    get parallel() { return S.parallel; },
    get joyMap() { return controls.joyMap; },
    get aiButtons() { return S.aiButtons; },
    get cruise() { return S.cruise; },
    get switching() { return S.switching; },
    doPush: (dir, strength) => doPush(dir, strength),
    setTrigger: (i) => S.task && S.task.kind === 'motion' ? S.task.setTrigger(i) : false,
    // v2.8.0: Szenarien, Sturz-Modus, Werkstatt
    get scenario() { return scenarioOf(S.robotId); },
    get fallMode() { return S.fallMode; },
    setScenario: (s) => switchScenario(s),
    setFallMode: (m) => setFallMode(m),
    get pluginHost() { return pluginHost; },
    get plugins() { return pluginHost.list; },
    installPlugin: (name, code, enabled = true) => {
      try { compilePlugin(code); } catch (e) { return { ok: false, error: e.message }; }
      const rec = pluginHost.add({ name, desc: 'Test-Plugin', code, enabled: false });
      const en = pluginHost.enable(rec.id, !!enabled);
      renderPluginList();
      return en.ok ? { ok: true, id: rec.id } : { ok: false, error: en.error };
    },
    removePlugin: (id) => { pluginHost.remove(id); renderPluginList(); return true; },
    pluginChips: () => document.querySelectorAll('#pluginChips .ai-btn').length,
    executeAction: (action) => executeAction(action),
    applyAIPatch: (patch, opts) => applyAIPatch(patch, opts),
    ui,
  }),
});

wireUI();
boot();
