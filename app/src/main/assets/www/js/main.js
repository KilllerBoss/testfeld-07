// ═══════════════════════════════════════════════════════════
// main.js — TRAINROBOT · TESTFELD·07 (v2.2)
// Boot-Sequenz, Master-Loop, Modi (MANUELL / POLICY / TRAINING),
// Roboterwechsel. Kein Fallback: Fehler werden hart angezeigt.
// ═══════════════════════════════════════════════════════════

import { initEngine, fetchModelIntoFS, removeModelFromFS, hasModelInFS, RobotSim, setModelProgress, mj, writeWorldFile } from './engine.js';
import { ROBOT_ORDER, getRobot, HOVER_R } from './robots.js';
import { buildWorldXML, WORLDS, getWorld, sanitizeKiObjects } from './worlds.js';
import { Renderer3D } from './render3d.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { PPO, SoftMoEPolicy, finiteArr } from './train.js';
import { RNG } from './math.js';
import { GlbClip } from './glb.js';
import { retargetToG1, retargetToRobot, RT_ALG, findFootGeoms, groundSrcPosTrack, ardyMotionQuality } from './retarget.js'; // v2.28.1: Boden-Reparatur für gespeicherte Clips · v2.28.3: Versuchs-Qualität für Auto-Retry
import { makeMotionTask, MOTION_R } from './motiontask.js';
import { makeRecoveryTask, RECOVERY_R } from './recoverytask.js';
import { PluginHost, BUILTIN_PLUGINS, compilePlugin } from './plugins.js';
import { ParallelTrainer, suggestWorkerCount } from './parallel.js';
import { DR_LEVELS, drFromLevel, restoreDrModel } from './dr.js';
import { putClip, listClips, deleteClip, packMotion, unpackMotion } from './glbstore.js';
import { parseQposCsv, ARDY_G1_NQ } from './qpos.js'; // v2.22.0: ARDY-Brücke (Lehrer ohne CUDA)
import { ensureMotionSet, clearMotionSet, clipForExpert, clipForSkill } from './motionset.js'; // v2.23.0: HF-Lehrer-Datensatz (Auto-Download)
import { setExpertR, expertRSummary, defaultExpertNames } from './skill.js'; // v2.23.0: Experten-/Router-Rewards pro Roboter
import { buildGlbScene } from './glbscene.js';
import { initAITransport, ensureModels, askAI, validatePatch, loadHistory, saveHistory, getApiKey, setApiKey, isCustomKey, AI_DOCS } from './ai.js';
import { loadButtons, addButton, removeButton, loadJoyMap, saveJoyMap, validateJoyMap, loadPushStrength, savePushStrength } from './agent.js';
import { EXPERT_R } from './skill.js';   // v2.13.0: Experten-/Router-Belohnungen (KI-tunbar)
import { Fpv } from './fpv.js';          // v2.13.0: FPV-Kamerabild (nur Anzeige, KEIN Policy-Eingang)
import { loadAppearance, saveAppearance, clearAppearance, sanitizeAppearance, partCatalog } from './appearance.js'; // v2.14.0: Aussehen-Editor
import { loadArdyRuntime, clearArdyCache, BASIS_ANIMS, deToEn, ardyCapabilities, refreshArdyImports, ardyImportSummary } from './ardy.js'; // v2.25.0: ARDY Mini AUF DEM GERÄT (Text→Motion ohne Cloud) · v2.27.0: Dateimanager-Import
import { ArdyClip } from './ardyclip.js'; // v2.25.0: cskel27-Weltposen → Retarget-Clip
import { sanitizeRwx } from './rewardx.js'; // v2.14.0: komplexe Belohnungsterme
import { CanvasBoard, addPolicyNode, addUINode, addConstNode, addLogicNode, addLink, removeLink, findNode, findNodeByName, nodeOutCount, CARD_R_FIELDS, cardPPOFromAppPolicy, buildPlanGraph, linkManyGraph, LOGIC_OPS } from './canvas.js'; // v2.20.0: + Logik/LinkMany

const VERSION = '2.28.3'; // v2.28.3: ARDY AUTO-RETRY — kollabiert/instabil ein Versuch, wird automatisch mit neuem Seed erneut generiert (bis 3 Versuche, bestes Ergebnis gewinnt; Quality-Funktion ardyMotionQuality in retarget.js). v2.28.2: ARDY-EXPLOSIONS-FIX (Decoder IMMER fp32 — der echte fp16-Decoder erzeugt auf WebGPU-f16-Geräten explodierte posedJoints: „Streifen“-Skeleton + zappelnder Geist) + Sanitizer (NaN-Frames halten, Knochenlängen reparieren, Metriken) + Denoiser-Endlichkeits-Wache + klare Meldungen. v2.28.1: Boden-Reparatur + ARDY-Overlay + Geist-lenk-Standard. v2.28.0: Geist lenken + Boden-Garantie.
const CTRL_DT = 0.02; // 50 Hz Regelrate

// ── v2.11.0 — DOMAIN RANDOMIZATION (MASTER-PROMPT §10 „Pflicht“) ─
// Stufe global (nicht je Roboter — die Physik-Störungen betreffen das
// Training, nicht den Roboter). Persistiert; Standard LEICHT, damit
// Policies von Anfang an robust lernen.
const DR_KEY = 'tr_dr_v1';
function loadDrLevel() {
  try { const l = localStorage.getItem(DR_KEY); if (DR_LEVELS.includes(l)) return l; } catch (e) { /* egal */ }
  return 'leicht';
}

const ui = new UI();
ui.init();
const controls = new Controls();
let r3d = null;
let fpv = null;      // v2.13.0: FPV-Renderer (Kamera-Rechteck, nur Anzeige)
let wakeLock = null; // v2.13.0: Bildschirm wachhalten im Training

const S = {
  robotId: null,
  motionClip: null,   // aktive GLB-Referenz (v2.15.0: je Roboter retargetet)
  srcScene: null,     // Original-3D-Modell des Lehrer-Ghosts (In-Memory)
  // v2.24.0 — Geist vs. Original getrennt: Der G1-Geist zeigt die RETARGETETE
  // Referenz (= exakt was trainiert wird), das Original-Mesh ist NUR Deko.
  // Nutzerwunsch: Mesh weg, nur Geist → Original standardmäßig AUS.
  srcShow: false,
  clips: [],          // gespeicherte Clips (IndexedDB)
  ghostOn: true,
  ardyBusy: false,    // v2.25.0: ARDY-Mini-Generierung läuft
  ardyRuntime: null,  // v2.25.0: geladene ARDY-Laufzeit (lazy)
  sim: null,
  gait: null,        // Gang-/Flugregler-Instanz
  task: null,        // Trainingsaufgaben-Instanz
  trainer: null,     // PPO
  mode: 'manuell',   // 'manuell' | 'policy'
  training: false,
  speedMode: loadSpeed(), // v2.14.0: Slider 1–16 (Schritte/Frame) statt 1×/4×/16×/MAX
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
  refMode: 'frei',    // v2.15.0: 'frei' (Bahn ablaufen) | 'stelle' (fix) | 'folgt' (am Roboter)
  motionKi: { on: false, mix: 0.7, prevRef: null }, // v2.21.0: MOTION-KI — trainierte Motion animiert, Stick/Buttons steuern bei Bedarf
  cruise: null,      // KI-Autofahrt {vx, yaw, until} — endet bei Stick-Bewegung
  aiButtons: [],     // KI-eingerichtete Buttons (agent.js)
  world: loadWorldState(), // v2.7.0: aktuelle Welt {id, seed} — prozedural generiert
  drLevel: loadDrLevel(), // v2.11.0: Störungs-Stufe ('aus'|'leicht'|'mittel'|'stark')
  // v2.8.0 — VOLLSTÄNDIGER ROBOTER: Szenarien (Aufstehen/Abwurf/Gehen),
  // Sturz-Verhalten (Auto-Reset vs. Liegen lassen) und Plugin-Werkstatt.
  scenario: {},      // je Roboter: 'gehen' | 'getup' | 'drop' (GLB-Clip zählt als eigene Aufgabe)
  fallMode: 'reset', // 'reset' = Auto-Teleport bei Sturz, 'stay' = Roboter bleibt liegen
  canvasBoard: null, // v2.17.0: NETZ-CANVAS (Graph + Karten-PPOs + Editor)
};

// Persistierte Szenario-/Sturz-Wahl laden (v2.8.0)
try {
  const sc = JSON.parse(localStorage.getItem('tr_scenario_v1') || '{}');
  if (sc && typeof sc === 'object') S.scenario = sc;
} catch (e) { /* defekt → Standard */ }
S.fallMode = localStorage.getItem('tr_fallMode') === 'stay' ? 'stay' : 'reset';

// v2.14.0 — TRAININGS-TEMPO: Slider (1–16 Schritte/Frame). „MAX" (paralleles
// Training) ist ENTFERNT — es hat auf Handys das UI blockiert. Slider-Wert
// persistiert; alter 'max'-Bestand wird auf 4× abgebildet.
function loadSpeed() {
  try {
    const v = parseInt(localStorage.getItem('tr_speed_v2') || '', 10);
    if (Number.isFinite(v)) return String(Math.min(16, Math.max(1, v)));
    if (localStorage.getItem('tr_speed_v1') === 'max') return '4'; // Migration
  } catch (e) { /* egal */ }
  return '2';
}

// v2.14.0 — KI-WELT: Objektliste für worldId 'ki' (setWorld-Tool)
function loadKiObjects() {
  try {
    const o = JSON.parse(localStorage.getItem('tr_world_ki_v1') || 'null');
    return (o && Array.isArray(o.objects)) ? o.objects : [];
  } catch (e) { return []; }
}
function saveKiObjects(objects) {
  try { localStorage.setItem('tr_world_ki_v1', JSON.stringify({ objects })); } catch (e) { /* voll */ }
}

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

/** DR-Spec der gewählten Stufe (FRESH je Aufruf — Reset würfelt je Episode neu). */
function drCfg() { return drFromLevel(S.drLevel); }

/** Stufe wechseln (Chips „Störungen“ im Trainings-Panel). */
function setDr(level) {
  if (!DR_LEVELS.includes(level)) return;
  S.drLevel = level;
  try { localStorage.setItem(DR_KEY, level); } catch (e) { /* voll */ }
  if (S.sim) S.sim.cfg.dr = drCfg(); // wirkt ab der nächsten Episode
  syncDrChips();
  const beschrieb = {
    aus: 'keine Störungen — perfektionistischer Simulator',
    leicht: 'kleine Masse-/Motor-/Reibungs-/Pose-Schwankungen',
    mittel: '+ Gravitation, Sensorrauschen, Schübe, 20 ms Aktions-Verzögerung',
    stark: '+ große Streuung, 40 ms Verzögerung, kräftige Schübe — robust, lernt langsamer',
  }[level];
  log('Störungen (Domain Randomization): ' + level.toUpperCase() + ' — ' + beschrieb, 'ok');
  ui.toast('Störungen: ' + level);
}

function syncDrChips() {
  for (const x of document.querySelectorAll('.dr-chip')) x.classList.toggle('active', x.dataset.dr === S.drLevel);
}

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
    // v2.14.0: worldId 'ki' = von Gemini gebaute Objektwelt (setWorld)
    const worldXml = buildWorldXML(cfg, S.world.id, S.world.seed, S.world.id === 'ki' ? loadKiObjects() : null);
    writeWorldFile(cfg.dir, 'welt_live.xml', worldXml);
    const sim = new RobotSim(cfg, 'welt_live.xml');
    cfg.dr = drCfg(); // v2.11.0: DR-Spec je Roboter-Cfg (wirkt je Episode in task.reset)
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
    // v2.15.0: Aktive GLB-Referenz auf den NEUEN Roboter ÜBERTRAGEN —
    // derselbe Clip wird je Roboter frisch retargetet (G1: Beine+Arme,
    // MicroDuck: Beine, X2: nur Flugbahn) und bleibt aktiv. Passt es
    // nicht (keine GLB-Daten), wird die Referenz deaktiviert.
    if (S.activeRecId && S.motionClip && S.motionClip.robotId !== id) {
      const rec = S.clips.find(r => r.id === S.activeRecId);
      let carried = false;
      if (rec && rec.glb) {
        try {
          const c2 = new GlbClip(rec.glb);
          c2.useAnimation(rec.animIndex || 0);
          const motion = retargetToRobot(c2, sim, (m) => log('  ' + m));
          rec.motionByRobot = rec.motionByRobot || {};
          rec.motionByRobot[id] = packMotion(motion);
          if (id === 'g1') rec.motion = rec.motionByRobot[id];
          putClip(rec).catch(() => {});
          S.motionClip = unpackMotion(rec.motionByRobot[id]);
          log('GLB-Referenz „' + rec.name + '\u201c auf ' + (cfg.name || id) + ' übertragen: ' + motion.n + ' Frames × ' + motion.nu + ' Kanäle', 'ok');
          carried = true;
        } catch (e) {
          log('GLB-Referenz passt nicht zu ' + (cfg.name || id) + ' (' + e.message + ')', 'warn');
        }
      }
      if (!carried) { S.motionClip = null; S.activeRecId = null; }
    }
    // Trainingsaufgabe (v2.8.0): GLB-Tracking → Recovery-Szenario → Standard
    S.task = makeTaskFor(id, cfg, sim);
    if (S.task.kind === 'motion') {
      S.task = makeMotionTask(cfg, S.motionClip, sim);
      S.task.animOn = S.animTraining;
      S.task.refMode = S.refMode;
      wireTeacher(S.task); // v2.23.0: Lehrer-Belohnung (falls Datensatz da)
      // Steuerungs-Wahl des aktiven Clips restaurieren (v2.5.0, 'btn' v2.6.0)
      const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
      if (rec && (rec.ctrl === 'joy' || rec.ctrl === 'btn')) S.task.ctrlMode = rec.ctrl;
      if (rec && Array.isArray(rec.buttons)) S.task.buttons = rec.buttons.slice(0, 4);
      syncCtrlChips();
      syncBtnRow();
      renderClipButtons();
    }
    if (S.task.kind === 'speed' && cfg.moe) S.task.onLevelUp = (lv) => log(`Curriculum: Level ${lv} erreicht (MicroDuck)`, 'ok'); // v2.12.0
    S.task.reset(new RNG(4242), sim);
    pluginHost.fireReset(); // v2.9.0: Plugins (z. B. Kopfstand) dürfen die Startpose formen
    S.obsBuf = new Float32Array(S.task.obsDim);
    S.actBuf = new Float32Array(S.task.actDim);
    // v2.15.0: GLB-Sektion gilt für ALLE Roboter (je Ziel andere Tiefe:
    // G1/MicroDuck voll, Drohne nur Flugbahn)
    ui.$('glbSection').classList.remove('hidden');
    // KI-Anpassungen für diese Aufgabe wieder aufschalten (Belohnungen etc.)
    applySavedAICfg(id);
    // v2.17.0: Canvas auf den neuen Roboter/die neue Aufgabe umschalten —
    // je Roboter gibt es einen EIGENEN Graphen (Ports = obsDim/nu der Aufgabe)
    if (S.canvasBoard) {
      S.canvasBoard.load();
      updateCvStat();
      log('Netz-Canvas geladen: ' + S.canvasBoard.graph.nodes.filter(n => n.type === 'policy').length + ' Karten, ' + S.canvasBoard.graph.links.length + ' Kabel', S.canvasBoard.graph.nodes.length > 2 ? 'ok' : '');
    }

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
    // v2.14.0: Gespeichertes AUSSEHEN (Farben/Material) anwenden — nur Rendering
    try {
      const look = loadAppearance(id);
      r3d.setAppearance(sim, look);
      if (look && (look.all || look.parts.length)) log('Aussehen geladen (' + (look.parts.length ? look.parts.length + ' Teil(e)' : 'Grundfarbe') + ')');
    } catch (e) { /* Look ist optional */ }
    r3d.camDist = cfg.dist; controls._camDist = cfg.dist;
    // v2.24.0: Geister NEU aufbauen — die alten Gruppen hängen an der alten
    // Modell-Geometrie (fossiler Cyan-Geist des Vorgänger-Roboters blieb
    // sonst eingefroren stehen). Nur mit aktivem Clip + Toggles.
    r3d.removeGhost();
    r3d.removeSourceGhost();
    if (S.motionClip) applyGhosts();
    sim.reset();
    S.epReward = 0; S.episodes = 0;

    // UI
    ui.setRobotActive(id);
    ui.setRobotTitle(cfg);
    ui.setDroneMode(!!cfg.drone);
    syncScenarioChips();
    syncDrChips();
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
    const p = PPO.fromAny(JSON.parse(raw)); // v2.12.0: MLP + Soft-MoE ladbar
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

/** Aufgabenauswahl: GLB-Tracking (Roboter mit Clip) → Recovery-Szenario → Standard. */
function makeTaskFor(id, cfg, sim) {
  // v2.15.0: GLB-Motion-Tracking für ALLE Roboter mit Gelenken — der Clip
  // muss zum Roboter passen (nu-Vergleich; eine G1-Variante am MicroDuck
  // wäre Müll). Die Drohne bekommt stattdessen den Lehrpfad injiziert.
  if (S.motionClip && !cfg.drone && S.motionClip.nu === cfg.nu) {
    const mt = makeMotionTask(cfg, S.motionClip, sim);
    wireTeacher(mt); // v2.23.0: Lehrer-Belohnung (falls Datensatz da)
    return mt;
  }
  const scn = scenarioOf(id);
  if (!cfg.drone && (scn === 'getup' || scn === 'drop')) return makeRecoveryTask(cfg, scn);
  const t = cfg.task(cfg);
  if (cfg.drone && S.motionClip && S.motionClip.nu === cfg.nu && t.setPath) t.setPath(S.motionClip, S.refMode);
  wireTeacher(t); // v2.23.0: Lehrer-Belohnung (falls Datensatz da)
  return t;
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
  if (S.task && S.task.setUserCmd) S.task.recoverOnFall = (mode === 'stay'); // v2.12.1: läuft sofort ins Training ein
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
      // v2.14.0: KOMPLEXE TERME (Ziele/Bedingungen) — ersetzen die bisherigen
      if (patch.rWx) { cfg.rWx = patch.rWx; touched.push('rWx(' + patch.rWx.terms.length + ' Terme, ' + (patch.rWx.on ? 'AN' : 'AUS') + ')'); }
      if (patch.cmd) {
        if (patch.cmd.vx) { cfg.cmd.vx = patch.cmd.vx.slice(); touched.push('cmd.vx=' + patch.cmd.vx.map(x => x.toFixed(2)).join('..')); }
        if (patch.cmd.yaw) { cfg.cmd.yaw = patch.cmd.yaw.slice(); touched.push('cmd.yaw'); }
      }
      if (patch.done) for (const [k, v] of Object.entries(patch.done)) { cfg.done[k] = v; touched.push('done.' + k); }
      if (patch.actSpan !== undefined) { cfg.actSpan = patch.actSpan; touched.push('actSpan'); }
      // v2.12.0: MicroDuck-Curriculum-Level (ersetzt die DR-Chips für den Duck)
      if (patch.duckLevel !== undefined && S.task && S.task.setLevel) {
        S.task.setLevel(patch.duckLevel); touched.push('duckLevel=' + S.task.level);
      }
    } else if (kind === 'hover') {
      if (patch.hoverR) for (const [k, v] of Object.entries(patch.hoverR)) { HOVER_R[k] = v; touched.push('hoverR.' + k); }
      if (patch.cmd && patch.cmd.vx) { cfg.cmd.vx = patch.cmd.vx.slice(); touched.push('cmd.vx'); }
    }
  }
  if (patch.motionR) for (const [k, v] of Object.entries(patch.motionR)) { MOTION_R[k] = v; touched.push('motionR.' + k); }
  if (patch.hoverR && kind !== 'hover') for (const [k, v] of Object.entries(patch.hoverR)) { HOVER_R[k] = v; touched.push('hoverR.' + k); }
  // v2.13.0: Experten-/Router-Belohnungen (skill.js GLOBAL-Objekt, deep-merge)
  if (patch.expertR) {
    for (const [k, v] of Object.entries(patch.expertR)) {
      if (typeof v === 'object' && v !== null && typeof EXPERT_R[k] === 'object') Object.assign(EXPERT_R[k], v);
      else EXPERT_R[k] = v;
    }
    touched.push('expertR');
  }
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
      localStorage.setItem('tr_ai_speed_' + S.robotId, JSON.stringify({ rW: cfg.rW, cmd: cfg.cmd, done: cfg.done, actSpan: cfg.actSpan, rWx: cfg.rWx || null }));
    }
    localStorage.setItem('tr_ai_motion', JSON.stringify(MOTION_R));
    localStorage.setItem('tr_ai_hover', JSON.stringify(HOVER_R));
    localStorage.setItem('tr_ai_ppo', JSON.stringify(PPO_OVERRIDES));
    localStorage.setItem('tr_ai_expertR', JSON.stringify(EXPERT_R)); // v2.13.0
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
    const er = JSON.parse(localStorage.getItem('tr_ai_expertR') || 'null'); // v2.13.0
    if (er) { const v = validatePatch({ expertR: er }); if (v.expertR) for (const [k, val] of Object.entries(v.expertR)) { if (typeof val === 'object' && typeof EXPERT_R[k] === 'object') Object.assign(EXPERT_R[k], val); else EXPERT_R[k] = val; } }
    const me = parseInt(localStorage.getItem('tr_ai_moeE') || '', 10); // v2.14.0: Soft-MoE-Experten
    if (Number.isFinite(me) && me >= 2 && me <= 8) PPO_OVERRIDES.moeE = me;
  } catch (e) { /* defekt → Standardwerte */ }
}

// In loadRobot: KI-Tuning je Roboter wieder aufschalten
function applySavedAICfg(id) {
  const cfg = getRobot(id);
  if (!cfg || cfg.drone) return;
  try {
    const raw = JSON.parse(localStorage.getItem('tr_ai_speed_' + id) || 'null');
    if (!raw) return;
    const v = validatePatch({ rW: raw.rW, cmd: raw.cmd, done: raw.done, actSpan: raw.actSpan, rWx: raw.rWx });
    if (v.rW) Object.assign(cfg.rW, v.rW);
    if (v.cmd) { if (v.cmd.vx) cfg.cmd.vx = v.cmd.vx; if (v.cmd.yaw) cfg.cmd.yaw = v.cmd.yaw; }
    if (v.done) Object.assign(cfg.done, v.done);
    if (v.actSpan !== undefined) cfg.actSpan = v.actSpan;
    if (v.rWx) cfg.rWx = v.rWx; // v2.14.0: Zielterme restaurieren
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
    speedMode: S.speedMode + '× (Schritte/Frame)',
    speed: sim ? +sim.baseSpeed().toFixed(2) : null,
    height: sim ? +sim.baseHeight().toFixed(2) : null,
    upright: up !== null ? +up.toFixed(2) : null,
    episodes: S.episodes,
    policySaved: !!S.trainer,
    moeExperts: (S.trainer && S.trainer.net && S.trainer.net.E) || (PPO_OVERRIDES.moeE || null),
    rWx: (S.sim && S.sim.cfg && S.sim.cfg.rWx) || null,
    look: (function () { try { const l = loadAppearance(S.robotId); return l ? { teile: l.parts.map(p => p.part), grund: !!l.all } : null; } catch (e) { return null; } })(),
    motionClips: S.clips.map((c, i) => ({ index: i, name: c.name })),
    activeClip: S.motionClip ? S.motionClip.name : null,
    motionKi: { on: S.motionKi.on, mix: +S.motionKi.mix.toFixed(2), ghostPaused: !!(S.task && S.task.ghostPaused), hinweis: 'Modus POLICY + aktive GLB-Referenz — die Policy animiert, Stick/Buttons steuern bei Bedarf (mix 0 = nur Clip, 1 = nur Stick)' },
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
    // v2.17.0: Canvas-Status (Gemini sieht den Graph-Zustand im observe)
    canvas: S.canvasBoard ? (() => {
      const d = S.canvasBoard.describe();
      return {
        karten: d.nodes.filter(n => n.type === 'policy').length,
        uiElemente: d.nodes.filter(n => n.type === 'ui').length,
        kabel: d.links.length,
        training: d.training,
        modusAktiv: S.mode === 'canvas',
        werkzeuge: 'canvasBuild/canvasGraph/canvasReward/canvasRun/canvasUI (doc: CANVAS)',
      };
    })() : null,
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
      if (act.mode === 'canvas') { setCanvasMode(true); return 'Modus: CANVAS (Netz-Graph fährt den Roboter)'; }
      if (act.mode === 'manuell' && S.mode === 'canvas') { setCanvasMode(false); return 'Modus: MANUELL'; }
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
async function execTool(tool, args) {
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
    // ── v2.13.0: ART-MCP — Wissensdokumente (offline im APK) ──
    if (tool === 'readDoc') {
      const doc = AI_DOCS.some(d => d.doc === args.doc) ? args.doc : 'README';
      if (!execTool._docCache) execTool._docCache = {};
      if (execTool._docCache[doc]) return 'DOKUMENT ' + doc + '.md:\n\n' + execTool._docCache[doc];
      const resp = await fetch('mcp/' + doc + '.md', { cache: 'force-cache' });
      if (!resp.ok) return 'Fehler: Dokument ' + doc + '.md nicht gefunden (' + resp.status + ')';
      const txt = await resp.text();
      execTool._docCache[doc] = txt;
      return 'DOKUMENT ' + doc + '.md:\n\n' + txt;
    }
    // ── v2.13.0: FPV-Kamera (nur ANZEIGE — die Policy sieht das Bild NICHT) ──
    if (tool === 'setCamera') {
      if (!fpv) return 'Fehler: Kamera-Renderer nicht initialisiert';
      fpv.applySettings(args);
      try { localStorage.setItem('tr_fpv_v1', JSON.stringify({ on: fpv.on, fov: fpv.fov, pitch: fpv.pitch })); } catch (e) { /* egal */ }
      const fpvWrap = document.getElementById('fpvWrap');
      if (fpvWrap) fpvWrap.classList.toggle('hidden', !fpv.on);
      return 'FPV-Kamera: ' + (fpv.on ? 'AN' : 'AUS') + ' (FOV ' + fpv.fov + '°, Pitch ' + fpv.pitch + '°) — reine Anzeige, kein Policy-Eingang';
    }
    // ── v2.14.0: AUSSEHEN-EDITOR (Farben + Material je Teil, nur Rendering) ──
    if (tool === 'setAppearance') {
      if (args.list) {
        return 'TEILE-KATALOG: ' + JSON.stringify(partCatalog(S.sim));
      }
      if (args.reset) {
        clearAppearance(S.robotId);
        r3d.setAppearance(S.sim, null);
        return 'Aussehen zurückgesetzt (Original-Farben)';
      }
      const spec = sanitizeAppearance(args);
      if (!spec.all && !spec.parts.length) {
        return 'Fehler: keine gültigen Änderungen (color als "#rrggbb", shine/metal 0–1). Verfügbare Teile: ' + JSON.stringify(partCatalog(S.sim));
      }
      const saved = saveAppearance(S.robotId, spec);
      const hits = r3d.setAppearance(S.sim, saved);
      const unmatched = (saved.parts || []).filter(p => p._unmatched).map(p => p.part);
      return 'Aussehen gesetzt: ' + hits.size + ' Geoms übernommen. Teile: [' + saved.parts.map(p => p.part).join(', ') + ']' +
        (saved.all ? ' + Grundfarbe' : '') +
        (unmatched.length ? ' — UNBEKANNT: ' + unmatched.join(', ') + ' (verfügbare Teile: ' + JSON.stringify(partCatalog(S.sim)) + ')' : '') +
        ' — bleibt gespeichert. Physik unverändert.';
    }
    // ── v2.14.0: WELT-EDITOR (KI-Welt neu bauen / Objekte hinzufügen) ──
    if (tool === 'setWorld') {
      if (args.preset && WORLDS.some(w => w.id === args.preset)) {
        await setWorld(args.preset, S.world.seed);
        return 'Welt: Preset "' + args.preset + '" geladen (Training bleibt im Speicher erhalten)';
      }
      const current = loadKiObjects();
      const incoming = sanitizeKiObjects(args.replace ? args.objects : [].concat(current, args.objects || []));
      if (args.replace && !Array.isArray(args.objects)) return 'Fehler: replace=true braucht objects=[…]';
      if (!incoming.objects.length) {
        return 'Fehler: keine gültigen Objekte. ' + incoming.errors.join(' | ') + ' — Format: {type:"box"|"ball"|"cyl"|"ramp"|"tilt"|"gate"|"stair", x, y, w/l/h oder r, color:"#rrggbb", euler}';
      }
      saveKiObjects(incoming.objects);
      await setWorld('ki', S.world.seed);
      const w = getWorld('ki');
      return 'KI-WELT gebaut: ' + incoming.objects.length + ' Objekte' + (incoming.errors.length ? ' | Verworfen: ' + incoming.errors.join(' | ') : '') + ' — Welt "' + w.name + '" aktiv. Training pausiert — bitte neu starten (Policy bleibt gespeichert).';
    }
    // ── v2.14.0: UI-ANPASSUNG (Design + KI-Vorschläge) ──
    if (tool === 'setUI') {
      const done = [];
      const THEMES = ['standard', 'neon', 'amber', 'ice', 'wald'];
      if (args.theme !== undefined) {
        if (args.theme === null || args.theme === '' || args.theme === 'standard') {
          document.body.dataset.theme = '';
          try { localStorage.removeItem('tr_ui_theme'); } catch (e) { /* egal */ }
          done.push('Design: Standard');
        } else if (THEMES.includes(args.theme)) {
          document.body.dataset.theme = args.theme;
          try { localStorage.setItem('tr_ui_theme', args.theme); } catch (e) { /* egal */ }
          done.push('Design: ' + args.theme);
        } else return 'Fehler: unbekanntes Design "' + args.theme + '" (erlaubt: ' + THEMES.join(', ') + ')';
      }
      if (args.suggestions !== undefined) {
        const sug = Array.isArray(args.suggestions) ? args.suggestions.slice(0, 6)
          .filter(s => s && typeof s.label === 'string' && typeof s.q === 'string' && s.label.trim() && s.q.trim())
          .map(s => ({ label: s.label.trim().slice(0, 20), q: s.q.trim().slice(0, 120) })) : [];
        renderAISuggestions(sug);
        try { localStorage.setItem('tr_ai_suggest_v1', JSON.stringify(sug)); } catch (e) { /* voll */ }
        done.push(sug.length + ' Vorschlags-Chips');
      }
      return done.length ? 'UI angepasst: ' + done.join(', ') : 'Fehler: nichts angegeben (theme und/oder suggestions)';
    }
    // ── v2.14.0: SOFT-MOE-EXPERTEN (Anzahl 2–8, braucht Policy-Neustart)
    // v2.23.0: für ALLE Roboter (MicroDuck · G1 · Drohne — Soft-MoE überall)
    if (tool === 'setMoE') {
      const E = Math.round(parseFloat(args.experts));
      if (!Number.isFinite(E) || E < 2 || E > 8) return 'Fehler: experts muss 2–8 sein';
      stopTraining(true);
      S.trainer = null;
      PPO_OVERRIDES.moeE = E;
      try { localStorage.setItem('tr_ai_moeE', String(E)); } catch (e) { /* voll */ }
      ui.resetRewards();
      S.episodes = 0;
      if (S.sim) S.sim.reset();
      ui.$('tStart').textContent = 'Training starten';
      ui.$('tStart').classList.remove('btn-stop');
      ui.trainStats({ reward: '–', episodes: 0, steps: 0, rate: 0 });
      ui.drawChart();
      return 'Soft-MoE auf ' + E + ' Experten gesetzt (' + S.robotId + '). Die alte Policy wurde verworfen (Architektur-Änderung) — starte das Training neu. Experten-Namen: ' + defaultExpertNames(!!(S.sim && S.sim.cfg.drone)).slice(0, E).join(', ') + (E > 4 ? ' + ' + (E - 4) + ' weitere (experte5…)' : '');
    }
    // ── v2.23.0: LEHRER-BELOHNUNG (Datensatz als Imitations-Reward, reward-only)
    if (tool === 'setTeacher') {
      if (typeof args.on === 'boolean') {
        try { localStorage.setItem('tr_teacher_on', args.on ? '1' : '0'); } catch (e) { /* voll */ }
      }
      if (Number.isFinite(args.weight)) {
        try { localStorage.setItem('tr_teacherW_' + S.robotId, String(Math.max(0, Math.min(1, args.weight)))); } catch (e) { /* voll */ }
      }
      wireTeacher();
      const on = teacherOn(); const w = teacherDefaultWeight();
      if (!on) return 'Lehrer-Belohnung AUS — reine Task-Belohnung. Die Obs enthielten die Animation nie, das Verhalten bleibt stabil.';
      if (!S.motionSet) return 'Lehrer AN, aber der Datensatz lädt noch (HuggingFace-Auto-Download läuft) — er greift, sobald er da ist.';
      return 'Lehrer AN: ' + S.motionSet.clips.length + ' Clips, Gewicht ' + Math.round(w * 100) + ' %. Die Animation wirkt NUR in der Belohnung — bei Gewicht 0 ist sie „weg", ohne dass das Verhalten springt.';
    }
    // ── v2.23.0: EXPERTEN-/ROUTER-REWARDS pro Roboter
    if (tool === 'setExpertR') {
      const prof = setExpertR(S.robotId, args);
      if (!prof) return 'Fehler: leeres/ungültiges Reward-Patch';
      if (S.task && S.task.refreshExpertR) S.task.refreshExpertR();
      return 'Experten-Rewards (' + S.robotId + ') gesetzt: routerBonus ' + prof.routerBonus + ' · wrongPenalty ' + prof.wrongPenalty + ' · walk.speed ' + prof.walk.speed + ' · turn.rate ' + prof.turn.rate + ' · recover.rise ' + prof.recover.rise + '. Wirkt ab dem nächsten Schritt.';
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
    // ── v2.17.0: NETZ-CANVAS — voll steuerbar ──
    if (tool === 'canvasGraph') return canvasGraphTool(args || {});
    if (tool === 'canvasReward') return canvasRewardTool(args || {});
    if (tool === 'canvasRun') return canvasRunTool(args || {});
    if (tool === 'canvasUI') return canvasUITool(args || {});
    if (tool === 'canvasBuild') return canvasBuildTool(args || {}); // v2.19.0: EIN Aufruf = ganze Architektur
    if (tool === 'motionKi') return motionKiTool(args || {}); // v2.21.0: Motion-Wiedergabe mit Steuer-Mix
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
      const result = await execTool(res.tool, res.args); // v2.13.0: async (readDoc fetch)
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

// ── v2.14.0: KI-Vorschlags-Chips (von setUI austauschbar) ───
function renderAISuggestions(sug) {
  const wrap = document.querySelector('.ai-suggest');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const s of (sug && sug.length ? sug : [])) {
    const b = document.createElement('button');
    b.className = 'ai-sug';
    b.dataset.q = s.q;
    b.textContent = s.label;
    b.addEventListener('click', () => { controls.buzz(); sendAIMessage(s.q); });
    wrap.appendChild(b);
  }
}

function restoreAISuggestions() {
  try {
    const sug = JSON.parse(localStorage.getItem('tr_ai_suggest_v1') || 'null');
    if (Array.isArray(sug) && sug.length) renderAISuggestions(sug);
  } catch (e) { /* egal */ }
  try {
    const th = localStorage.getItem('tr_ui_theme');
    if (th && th !== 'standard') document.body.dataset.theme = th;
  } catch (e) { /* egal */ }
}

async function aiOnOpen() {
  // Verlauf anzeigen (ohne Apply-Buttons)
  const logEl = document.getElementById('aiLog');
  logEl.innerHTML = '';
  for (const m of S.aiHistory.slice(-10)) aiPush(m.role === 'model' ? 'bot' : 'user', m.text);
  if (!S.aiHistory.length) aiPush('bot', 'Sag mir, was dein Roboter lernen soll — ich stelle Belohnungen, Zieltempo und Training dafür ein. Ich kann auch EIGENE MODS/PLUGINS für die App schreiben (Werkstatt unten) und den Roboter direkt steuern. (z. B. „schreibe ein Plugin, das ihn alle 10 s schubst“)');
  renderPluginList(); // Werkstatt-Stand auffrischen (v2.8.0)
  restoreAISuggestions(); // v2.14.0: eigene Chips + Design
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
  if (kind === 'motion') return {
    kind: 'motion', clip: S.motionClip,
    // v2.16.0: Animations-/Modus-Flags mitgeben — vorher trainierten die
    // Worker mit Default (animOn=true/'frei') weiter, selbst nach „OHNE
    // ANIM WEITER“ → Policy „vergaß“ beim Umschalten alles.
    animOn: S.task.animOn !== false,
    refMode: S.task.refMode,
    ctrlMode: S.task.ctrlMode,
    buttons: Array.isArray(S.task.buttons) ? S.task.buttons.slice(0, 4) : null,
  };
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
  if (cfg.rWx) env.rWx = sanitizeRwx(cfg.rWx); // v2.14.0: Zielterme an Worker
  if (S.task && S.task.kind === 'motion') {
    env.motionR = { ...MOTION_R };
    // v2.16.0: Live-Flags je Runde (kick()) — „OHNE ANIM WEITER“,
    // Referenz-Modus und Steuerung greifen SOFORT im Paralleltraining.
    env.motionFlags = { animOn: S.task.animOn !== false, refMode: S.task.refMode, ctrlMode: S.task.ctrlMode };
  }
  if (S.task && S.task.kind === 'recovery') env.recoveryR = { ...RECOVERY_R };
  env.fallMode = S.fallMode;
  env.dr = drCfg(); // v2.11.0: Störungen an ALLE Worker durchreichen (je Worker anders gewürfelt)
  return env;
}

/** Merge-Ergebnis einer Worker-Runde → UI/Statistik. */
function onParallelSegment(info) {
  S.episodes += info.episodes;
  for (const r of info.epRewards) ui.pushEpisodeReward(r);
  if (info.round <= 3 || info.round % 10 === 0) {
    const mm = info.metrics || {};
    const rw = mm.routeW ? (' · Router ' + mm.routeW.map((v) => v.toFixed(2)).join('/')) : '';
    log(`PPO-Runde ${info.round}: ${info.steps} Schritte aus ${S.parallel ? S.parallel.n : '?'} Workern gemischt · clipFrac ${(100 * (mm.clipFrac || 0)).toFixed(0)}%${rw} · ${Math.round(info.rate)} Schritte/s`, 'ok');
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
  // v2.17.0: Normales Training und Canvas schließen sich aus — Canvas-Modus
  // sauber verlassen (Roboter-Reset gehört dazu).
  if (S.mode === 'canvas') setCanvasMode(false);
  if (S.canvasBoard && S.canvasBoard.training) S.canvasBoard.stopTraining(true);
  if (!S.trainer) {
    const moe = !!S.sim.cfg.moe;
    // v2.14.0: moeE (KI-tunbar über setMoE) steuert die Soft-MoE-Expertenanzahl
    const moeE = Math.max(2, Math.min(8, Math.round(PPO_OVERRIDES.moeE || 4)));
    S.trainer = new PPO(S.task.obsDim, S.task.actDim, { ...PPO_OVERRIDES, policyOpts: { E: moeE } }, 1337 + ROBOT_ORDER.indexOf(S.robotId), moe ? SoftMoEPolicy : undefined);
    if (moe) {
      // v2.14.0: Experten-Namen an E anpassen (skill.js ist längenagnostisch)
      if (S.task.setRouting) {
        const base = ['balance', 'walk', 'turn', 'recover'];
        S.task.expertNames = Array.from({ length: S.trainer.net.E }, (_, i) => base[i] || ('experte' + (i + 1)));
      }
      log(`PPO initialisiert: SOFT-MOE — obs ${S.task.obsDim} → Encoder 128/128 → ${S.trainer.net.E} Soft-Experts → Decoder → act ${S.task.actDim} · ${S.trainer.net.paramCount()} Parameter`, 'warn');
      log('MicroDuck: automatisches Curriculum Level ' + (S.task.level || 1) + ' (Störungs-Chips gelten hier nicht; Styles: nur neutral aktiv)', 'warn');
    } else {
      log(`PPO initialisiert: obs ${S.task.obsDim} → 64×64 → act ${S.task.actDim} · CPU`, 'warn');
    }
  }
  // v2.10.0: PARALLEL-Training startete bei Tempo „MAX“ — v2.14.0 ist MAX
  // ENTFERNT (blockierte Handys); der Parallel-Code bleibt für den expliziten
  // Weg über runCode/debug erhalten, der UI-Slider nutzt NUR Inline-Training.
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
        worldXml: buildWorldXML(S.sim.cfg, S.world.id, S.world.seed, S.world.id === 'ki' ? loadKiObjects() : null),
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
  if (S.task && S.task.kind === 'motion') S.task.dropAnimP = MOTION_R.dropP || 0; // v2.16.0: Anim-Dropout im Training scharf
  if (S.task.setUserCmd) S.task.recoverOnFall = (S.fallMode === 'stay'); // v2.12.1: Sturz → Aufsteh-Fenster im „Liegen lassen“-Modus
  pluginHost.fireReset();
  S.training = true;
  S.epReward = 0;
  // v2.13.0: Bildschirm wachhalten (Über-Nacht-Training: Android killt
  // Hintergrund-WebViews — die „Policy vergessen"-Bugs hatten diese Ursache)
  try {
    if (navigator.wakeLock && !wakeLock) {
      navigator.wakeLock.request('screen').then((wl) => { wakeLock = wl; log('Wake Lock aktiv — Bildschirm bleibt im Training an', 'ok'); }).catch(() => { /* verweigert — egal */ });
    }
  } catch (e) { /* egal */ }
  log('Störungen (DR): ' + S.drLevel.toUpperCase() + ' — jede Episode andere Physik' + (S.speedMode === 'max' && !S.parallel ? '' : ''), 'ok');
  ui.$('tStart').textContent = 'Training pausieren';
  ui.$('tStart').classList.add('btn-stop');
  const tInfo = S.task.kind === 'recovery'
    ? (S.task.mode === 'getup' ? 'Aufstehen — Start liegend' : 'Abwurf — Start in der Luft')
    : S.task.kind === 'motion' ? 'GLB-Motion-Tracking'
    : S.task.pathOn ? 'GLB-Lehrpfad (Drohne)'
    : 'Tempo-Tracking';
  log('Training läuft (' + tInfo + ') — rollout + update auf der CPU', 'ok');
}

function stopTraining(silent = false) {
  if (!S.training) return;
  S.training = false;
  if (S.parallel) { S.parallel.stop(); S.parallel = null; }
  // v2.13.0: Wake Lock freigeben
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) { /* egal */ }
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
  // v2.28.0 GEIST LENKEN: der Stick führt die REFERENZ — auch im Training.
  // Vorher bekam der Stick die Referenz NIE ab (nur Zufalls-Kommandos),
  // der Nutzer steuerte gefühlt „nur den Roboter“. Jetzt: cmd = Stick,
  // advance() integriert _tx/_ty, die Bahn-Belohnung zieht den Roboter
  // der gefahrenen Referenz nach. Animation bleibt NUR Reward (nie Input).
  if (task.kind === 'motion' && (task.ctrlMode === 'joy' || task.ctrlMode === 'btn') && task.refMode === 'folgt') {
    const c = controls.command(sim.cfg);
    task.cmd.vx = c.vx; task.cmd.wz = c.yaw;
    task._manualCmd = true; // advance darf NICHT hineinwürfeln
  }

  const o = task.observe(sim, S.obsBuf);
  if (!finiteArr(S.obsBuf)) { sim.reset(); task.reset(trainer.rng, sim); pluginHost.fireReset(); return; }
  trainer.norm.update(S.obsBuf);
  const { act, logp, value } = trainer.act(S.obsBuf, false);
  if (task.setRouting && trainer.lastW) task.setRouting(trainer.lastW); // v2.12.0 §5
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
  if (task.afterAct) task.afterAct(sim, act); // v2.12.0: Duck-Scheduler/Obs-Verkettung
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
      task.reset(trainer.rng, sim, true); // neue Kommandos — POSE bleibt (liegt weiter; Duck: Aufsteh-Fenster)
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
    trainer._lastMetrics = m; // v2.14.0: Live-Kurven (Loss-Verlauf)
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
  // v2.15.0: GLB-Lehrpfad der Drohne — Autopilot folgt der Animationsbahn;
  // der Stick hat Vorrang (Eingriff = manuell übernehmen).
  const task0 = S.task;
  if (task0 && task0.pathOn && Math.hypot(controls.stickX, controls.stickY) < 0.25) {
    task0.updateCmd(dtCtrl, sim);
    cmd = { vx: task0.cmd.vx, yaw: task0.cmd.yaw, alt: task0.cmd.alt, climb: 0 };
  }
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
  // v2.15.0: Drohnen-Lehrpfad — die cmd-Kanäle (vx/alt/yaw) folgen der Bahn,
  // die Policy fliegt sie (obs enthält cmd.vx/alt)
  if (task && task.pathOn) task.updateCmd(S.sim.cfg.ctrlDt || CTRL_DT, sim);
  // v2.21.0: ⭐ MOTION-KI — die trainierte Motion-Policy ANIMIERT (Clip liefert
  // Stil/Phase in 'folgt'-Semantik), der Nutzer steuert BEI BEDARF: der
  // STEUER-MIX mischt Stick-Kommando und Clip-Tempo in die Befehl-Kanäle.
  //   mix = 0   → nur Clip (autonome Motion-Wiedergabe)
  //   mix = 1   → nur Stick (volle Steuerung, Stil bleibt)
  // Der GEIST kann per ⏸ eingefroren werden (ghostPaused — Roboter hält die Pose).
  if (S.motionKi.on && task) {
    const ki = S.motionKi, mix = Math.max(0, Math.min(1, ki.mix));
    const c = controls.command(S.sim.cfg);
    if (task.kind === 'motion') {
      const clipVx = task.refSpeed ? (task.refSpeed(task.phase) || 0) : 0;
      task.cmd.vx = mix * c.vx + (1 - mix) * clipVx;
      task.cmd.wz = mix * c.yaw; // Clip-Gierdreh-Tempo ist im Stil selbst enthalten
      task._manualCmd = true;    // advance darf die Kommandos NICHT überschreiben
    } else if (task.pathOn && task.cmd) {
      const wzKey = 'wz' in task.cmd ? 'wz' : 'yaw'; // Drohne: cmd.yaw
      task.cmd.vx = mix * c.vx + (1 - mix) * (task.cmd.vx || 0);
      task.cmd[wzKey] = mix * c.yaw + (1 - mix) * (task.cmd[wzKey] || 0);
    }
  }
  // Joystick/Buttons-Steuerung (v2.5.0): bei ctrlMode 'joy'/'btn' liefert
  // der Stick die Kommandos (vx = Vorwärts, yaw = Gieren), die die Policy
  // im Training mit Zufalls-Werten kennengelernt hat.
  if (task.kind === 'motion' && (task.ctrlMode === 'joy' || task.ctrlMode === 'btn' || task.animOn === false)) {
    const c = controls.command(S.sim.cfg);
    task.cmd.vx = c.vx; task.cmd.wz = c.yaw;
    task._manualCmd = true; // v2.16.0: advance darf NICHT hineinwürfeln (Stick führt)
  }
  // v2.12.1: Der ECHTE Stick steuert ALLE Speed-Aufgaben im POLICY-Modus.
  // Vorher kam der Stick hier NIE an (nur bei GLB-Motion): Speed-Policies
  // fuhren mit dem LETZTEN Trainingskommando weiter bzw. der Duck lief der
  // Zufalls-Scheduler weiter → „falsch synchronisiert“ (Sturz, zähes
  // Schieben statt Antwort auf den Stick).
  if (task.setUserCmd) {
    const c = controls.command(S.sim.cfg);
    // v2.23.0: quer (vy) + Gamepad-Buttons (bA Hüpfen · bB Hinlegen · bC Aufstehen · bD Stopp)
    task.setUserCmd(c.vx, c.vy || 0, c.yaw, controls.padBtn.slice());
  } else if (task.kind === 'speed' && task.cmd) {
    const c = controls.command(S.sim.cfg);
    const R = S.sim.cfg.cmd || { vx: [-1, 1], yaw: [-1, 1] };
    task.cmd.vx = Math.max(R.vx[0], Math.min(R.vx[1], c.vx));
    task.cmd.yaw = Math.max(R.yaw[0], Math.min(R.yaw[1], c.yaw));
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
  if (task.afterAct) task.afterAct(sim, S.actBuf); // v2.12.0: Duck-Scheduler
}

function resetRobot() {
  if (!S.sim) return;
  S.sim.reset();
  restoreDrModel(S.sim); // v2.11.0: „Zurücksetzen“ = wieder die ECHTE Physik
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
// ═══════════════ v2.23.0: LEHRER-DATENSATZ (HF-Auto-Download) · GAMEPAD · EXPERTEN-REWARDS ═══════════════
// Grundsat (Nutzer): Die Animation ist NUR Belohnung — NIE Policy-Input.
// Gewalt 0 = exakt das Reward-System ohne Animation; die Obs enthielten
// sie nie → das Verhalten bleibt beim Wegfaden stabil.

async function downloadMotionSetBg(force = false) {
  if (S.teacherLoading) return;
  S.teacherLoading = true;
  try {
    if (force) await clearMotionSet();
    S.motionSet = await ensureMotionSet(log);
    wireTeacher();
    ui.toast('Lehrer-Datensatz bereit (' + S.motionSet.clips.length + ' Clips)');
  } catch (e) {
    log('Lehrer-Datensatz: ' + e.message + ' — Training läuft OHNE Lehrer weiter', 'warn');
  } finally { S.teacherLoading = false; }
}

function teacherOn() { try { return localStorage.getItem('tr_teacher_on') === '1'; } catch (e) { return false; } }
function teacherDefaultWeight() {
  try { const w = parseFloat(localStorage.getItem('tr_teacherW_' + S.robotId)); if (Number.isFinite(w)) return Math.max(0, Math.min(1, w)); } catch (e) { /* egal */ }
  return 0.6;
}

/** Clips aus dem Datensatz an die aktuelle Aufgabe hängen (reward-only). */
function wireTeacher(task) {
  const t = task || S.task;
  if (!t || !t.setTeacher) return;
  if (!S.motionSet) { t.setTeacher(null); return; }
  const rid = S.robotId;
  const pick = (name) => clipForExpert(S.motionSet, rid, name) || clipForSkill(S.motionSet, rid, 'idle');
  const once = {};
  for (const sk of ['huepfen', 'sprung', 'liegen', 'aufstehen', 'stopp', 'starten', 'landen', 'rolle', 'salto']) {
    const c = clipForSkill(S.motionSet, rid, sk);
    if (c) once[sk] = c;
  }
  t.setTeacher(pick, once);
  t.setTeacherW(teacherOn() ? teacherDefaultWeight() : 0);
  syncTeacherUI();
}

function syncTeacherUI() {
  const chip = document.getElementById('teacherChip');
  const src = document.getElementById('teacherSrc');
  if (chip) {
    const on = teacherOn();
    chip.textContent = on ? 'AN' : 'AUS';
    chip.classList.toggle('active', on);
  }
  const wv = document.getElementById('teacherWVal');
  if (wv) wv.textContent = Math.round(teacherDefaultWeight() * 100) + ' %';
  if (src) src.textContent = S.motionSet ? (S.motionSet.clips.length + ' Clips · ' + (S.motionSet.fromCache ? 'Cache' : 'HF')) : 'lädt…';
}

function initTeacherUI() {
  const chip = document.getElementById('teacherChip');
  if (chip) chip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { localStorage.setItem('tr_teacher_on', teacherOn() ? '0' : '1'); } catch (e2) { /* voll */ }
    wireTeacher();
    log('Lehrer-Belohnung: ' + (teacherOn()
      ? 'AN — Basis-Motionen (HuggingFace-Datensatz) formen NUR die Belohnung, nie die Eingänge'
      : 'AUS — reine Task-Belohnung; Verhalten bleibt (Obs enthielten die Animation nie)'), 'ok');
  });
  const w = document.getElementById('teacherW');
  if (w) w.addEventListener('input', () => {
    const v = Math.max(0, Math.min(1, +w.value || 0));
    try { localStorage.setItem('tr_teacherW_' + S.robotId, String(v)); } catch (e) { /* voll */ }
    if (S.task && S.task.setTeacherW) S.task.setTeacherW(teacherOn() ? v : 0);
    const wv = document.getElementById('teacherWVal'); if (wv) wv.textContent = Math.round(v * 100) + ' %';
  });
  const rl = document.getElementById('teacherReload');
  if (rl) rl.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.toast('Datensatz wird neu geladen…'); downloadMotionSetBg(true); });
  const padBtn = document.getElementById('btnPad');
  if (padBtn) padBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const on = controls.setPad(!controls.padOn);
    controls.buzz(18);
    log('Gamepad ' + (on ? 'AN — links vor/seit, rechts drehen, A Hüpfen · B Hinlegen · C Aufstehen · D Stopp (physisches Gamepad wird automatisch erkannt)' : 'AUS'), 'ok');
  });
  const erT = document.getElementById('erToggle');
  if (erT) erT.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    buildExpertRPanel();
    const p = document.getElementById('expertRPanel');
    if (p) p.classList.toggle('hidden');
  });
}

// EXPERTEN-REWARDS-Editor: Router + jeder Experte individuell pro Roboter
function applyER(patch) {
  setExpertR(S.robotId, patch);
  if (S.task && S.task.refreshExpertR) S.task.refreshExpertR();
  log('Experten-Rewards (' + S.robotId + '): ' + JSON.stringify(patch), 'ok');
}
function buildExpertRPanel() {
  const panel = document.getElementById('expertRPanel');
  if (!panel) return;
  const prof = expertRSummary(S.robotId);
  const names = (S.task && S.task.expertNames) || ['stand', 'walk', 'turn', 'recover'];
  panel.innerHTML = '';
  const mkNum = (val, cb, min, max) => {
    const i = document.createElement('input');
    i.type = 'number'; i.step = '0.05'; i.value = String(val);
    i.addEventListener('change', () => { cb(Math.max(min, Math.min(max, parseFloat(i.value) || 0))); });
    return i;
  };
  const line = (label, fill) => {
    const d = document.createElement('div'); d.className = 'er-line';
    const s = document.createElement('span'); s.className = 'er-name'; s.textContent = label;
    d.appendChild(s); fill(d); panel.appendChild(d);
  };
  // ROUTER: Bonus für passenden Experten + Strafe für klaren Fehlgriff
  line('ROUTER', (d) => {
    let b = document.createElement('span'); b.className = 'er-hint'; b.textContent = 'Bonus'; d.appendChild(b);
    d.appendChild(mkNum(prof.routerBonus, (v) => applyER({ routerBonus: v }), 0, 2));
    b = document.createElement('span'); b.className = 'er-hint'; b.textContent = 'Fehler'; d.appendChild(b);
    d.appendChild(mkNum(prof.wrongPenalty, (v) => applyER({ wrongPenalty: v }), 0, 1));
  });
  const KEYS = { stand: ['up', 'quiet'], hover: ['up', 'quiet'], walk: ['speed'], move: ['speed'], turn: ['rate'], recover: ['rise', 'uprightOnce'], descend: ['rate'], climb: ['rate'] };
  for (const nm of names) {
    const key = prof[nm] !== undefined && typeof prof[nm] === 'object' ? nm : null;
    if (!key) continue;
    line(nm.toUpperCase(), (d) => {
      for (const kk of Object.keys(prof[key])) {
        const lb = document.createElement('span'); lb.className = 'er-hint'; lb.textContent = kk; d.appendChild(lb);
        d.appendChild(mkNum(prof[key][kk], (v) => applyER({ [key]: { [kk]: v } }), 0, 3));
      }
    });
  }
  const hint = document.createElement('div'); hint.className = 'er-hint';
  hint.textContent = 'Pro Roboter gespeichert (tr_expertR_' + S.robotId + ') · KI-Trainer: setExpertR';
  panel.appendChild(hint);
}

async function boot() {
  try {
    log(`TRAINROBOT v${VERSION} · Testfeld·07 · ${new Date().toLocaleString('de-DE')}`);
    log('BIOS: Offline-Betrieb, kein Netzwerk nötig');
    log('KI-Trainer: Gemini (nur auf Anfrage online)');
    initAITransport();
    loadGlobalAICfg();
    restoreAISuggestions(); // v2.14.0: Design + eigene Chips sofort
    S.aiHistory = loadHistory();
    // KI-Agent-Zustand: Buttons, Joystick-Map, Schubs-Stärke
    S.aiButtons = loadButtons();
    controls.joyMap = loadJoyMap();
    S.pushStrength = loadPushStrength();
    // GLB-Animation im Training (v2.5.0): persistiert — AUS = nur Gleichgewicht
    S.animTraining = localStorage.getItem('tr_animOn') !== '0';
    const animTog = document.getElementById('animTrainToggle');
    if (animTog) animTog.checked = S.animTraining;
    // v2.24.0: Geist/Original-Trennung (Original = Mesh AUS) — Nutzerwunsch
    // „mache das 3d mesh weg, lasse nur den Geist“
    S.srcShow = localStorage.getItem('tr_srcShow') === '1';
    const srcTog = document.getElementById('srcShowToggle');
    if (srcTog) srcTog.checked = S.srcShow;
    // v2.15.0: Referenz-Modus persistiert (frei/stelle/folgt)
    try {
      const rm = localStorage.getItem('tr_refmode_v1');
      if (rm === 'stelle' || rm === 'frei' || rm === 'folgt') S.refMode = rm;
      // v2.21.0: MOTION-KI-Zustand wiederherstellen (on bleibt AUS — der Nutzer
      // schaltet bewusst ein; nur mix wird gemerkt)
      try {
        const mki = JSON.parse(localStorage.getItem('tr_motionki_v1') || 'null');
        if (mki && Number.isFinite(+mki.mix)) S.motionKi.mix = Math.max(0, Math.min(1, +mki.mix));
      } catch (e2) { /* kein Speicher */ }
    } catch (e) { /* egal */ }
    syncRefChips();
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
    // v2.23.0: Gamepad-Overlay + Lehrer-Datensatz (HF-Auto-Download) + Experten-UI
    initTeacherUI();
    downloadMotionSetBg();
    // ── v2.13.0: FPV-KAMERA (Rechteck oben rechts, NUR Anzeige — die Policy
    // bekommt das Bild NIEMALS; Vision-Modell-Kanal bleibt bewusst frei) ──
    try {
      const fpvCanvas = document.getElementById('fpvCanvas');
      if (fpvCanvas) {
        fpv = new Fpv(r3d, fpvCanvas);
        try {
          const s = JSON.parse(localStorage.getItem('tr_fpv_v1') || 'null');
          if (s) { fpv.applySettings(s); fpvCanvas.classList.toggle('hidden', !fpv.on); }
        } catch (e) { /* egal */ }
        const camBtn = document.getElementById('btnCam');
        const fpvWrap = document.getElementById('fpvWrap');
        const showFpv = (on) => { if (fpvWrap) fpvWrap.classList.toggle('hidden', !on); };
        showFpv(fpv.on);
        if (camBtn) camBtn.addEventListener('click', () => {
          controls.buzz();
          fpv.applySettings({ on: !fpv.on });
          showFpv(fpv.on);
          try { localStorage.setItem('tr_fpv_v1', JSON.stringify({ on: fpv.on, fov: fpv.fov, pitch: fpv.pitch })); } catch (e) { /* egal */ }
          ui.toast(fpv.on ? 'Kamera: Robotersicht AN (nur Anzeige)' : 'Kamera aus');
        });
      }
    } catch (e) { log('FPV nicht verfügbar: ' + e.message, 'warn'); }
    // ── v2.13.0: ÜBER-NACHT-SCHUTZ — Auto-Save bei Hintergrundwechsel
    // (Android killt Hintergrund-WebViews und die Policy lebte nur im RAM)
    // + Bildschirm-Wachhalten im Training.
    const autoSave = () => {
      if (S.trainer && S.trainer.stepCount > 0) { try { savePolicy(S.robotId, { silent: true }); log('Auto-Save: Policy gesichert', 'ok'); } catch (e) { /* egal */ } }
      if (S.canvasBoard) S.canvasBoard.saveNow(); // v2.17.0: Canvas + Karten-Netze sichern
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSave(); });
    window.addEventListener('pagehide', autoSave);
    window.addEventListener('beforeunload', autoSave);
    setModelProgress((done, total, rel) => {
      const sp = document.getElementById('splash');
      if (sp) ui.splash(`Lade Modelldateien (${done}/${total}) …`, 0.45 + 0.5 * (done / total));
    });

    ui.splash('Kompiliere Unitree G1 …', 0.6);
    await loadRobot('g1', true);

    // ── v2.17.0: NETZ-CANVAS — Board erstellen, Sheet verdrahten ──
    try {
      S.canvasBoard = new CanvasBoard({
        log,
        toast: (m, e, ms) => ui.toast(m, e, ms),
        buzz: (ms) => controls.buzz(ms),
        getSim: () => S.sim,
        getTask: () => S.task,
        getRobotId: () => S.robotId,
        getStick: () => ({ x: controls.stickX, y: controls.stickY }),
        setMode: (m) => { if (m === 'canvas' && S.mode !== 'canvas') setCanvasMode(true); },
        getMode: () => S.mode,
        stopMainTraining: () => { if (S.training) stopTraining(true); },
        fireAct: (sim, ctrl) => pluginHost.fireAct(sim, ctrl),
        fireReset: () => pluginHost.fireReset(),
        fireReward: (sim, info) => pluginHost.fireReward(sim, info),
        pushEpisodeReward: (r) => ui.pushEpisodeReward(r),
        getMainPolicyJSON: () => (S.trainer ? S.trainer.toJSON() : null),
        toggleRun: () => setCanvasMode(S.mode !== 'canvas'),
      });
      S.canvasBoard.mount({
        viewport: document.getElementById('cvPort'),
        world: document.getElementById('cvWorld'),
        wires: document.getElementById('cvWires'),
        uiBar: document.getElementById('canvasUIBar'),
        edit: document.getElementById('cvEdit'),
        batch: document.getElementById('cvBatch'), // v2.20.0: Stapel-Banner
        runBtn: document.getElementById('cvRun'),
        trainBtn: document.getElementById('cvTrain'),
        sheet: document.getElementById('canvasSheet'),
      });
      S.canvasBoard.load();
      updateCvStat();
      log('Netz-Canvas bereit — Sensoren links, Aktuatoren rechts, Karten frei verdrahtbar', 'ok');
    } catch (e) {
      log('Canvas nicht verfügbar: ' + e.message, 'err');
      S.canvasBoard = null;
    }

    ui.splash('Bereit.', 1);
    setTimeout(() => { ui.splashDone(); }, 250);
    log('Bereit. Drei Roboter (G1 · MicroDuck · Drohne) · ' + WORLDS.length + ' Welten · Sensorik aktiv — gleiche Steuerung.', 'ok');
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

  if (S.mode === 'canvas' && S.canvasBoard) {
    // ── v2.17.0: NETZ-CANVAS — Ausführung (Echtzeit) oder Karten-Training ──
    const b = S.canvasBoard;
    if (b.training) {
      const nSteps = Math.min(16, Math.max(1, parseInt(S.speedMode, 10) || 1));
      const t0 = performance.now();
      let done = 0;
      while (done < nSteps) {
        b.trainCtrlStep();
        done++;
        if (performance.now() - t0 > 34) break; // Not-Aus: max ~2 Frames
      }
      b.stats._times.push({ n: done, ms: performance.now() - t0 });
      if (b.stats._times.length > 30) b.stats._times.shift();
      let sn = 0, sm = 0;
      for (const s of b.stats._times) { sn += s.n; sm += s.ms; }
      b.stats.rate = sm > 0 ? (sn / sm) * 1000 : 0;
      S.stepsPerSec = b.stats.rate;
    } else {
      const cdt = S.sim.cfg.ctrlDt || CTRL_DT;
      S.acc += dt;
      let guard = 0;
      while (S.acc >= cdt && guard < 10) {
        S.acc -= cdt;
        guard++;
        b.execCtrlStep();
        checkFall();
        pluginHost.fireStep(cdt);
      }
      S.stepsPerSec = fps * Math.max(1, Math.round(CTRL_DT / S.sim.timestep));
    }
  } else if (S.training) {
    if (S.parallel && S.parallel.active) {
      // v2.10.0 PARALLEL: Worker rollen selbstständig; hier nur Takt/Anzeige.
      S.stepsPerSec = S.parallel.rate;
    } else if (S.parallel && S.parallel.starting) {
      // Worker booten (WASM-Kompilierung) — Inline-Training anhalten,
      // damit die Kerne für den Boot frei sind (sonst Timeout-Gefahr).
      S.stepsPerSec = 0;
    } else {
      // Inline (Slider 1–16 Schritte/Frame, v2.14.0): fester Schritte-Soll
      // pro Bild — das UI bleibt reagierfähig, PPO-Updates kommen seltener
      // als bei „MAX“ (deshalb hängt nichts mehr).
      const nSteps = Math.min(16, Math.max(1, parseInt(S.speedMode, 10) || 1));
      const t0 = performance.now();
      let done = 0;
      while (done < nSteps) {
        trainCtrlStep();
        done++;
        if (performance.now() - t0 > 34) break; // Not-Aus: max ~2 Frames
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
        // v2.28.0 GEIST LENKEN: auch OHNE Training führt der Stick die
        // Referenz (joy/btn) — der Geist fährt neben dem Roboter her und
        // zeigt die gefahrene Route, bevor der Nutzer Training startet.
        if (S.task && S.task.kind === 'motion' && (S.task.ctrlMode === 'joy' || S.task.ctrlMode === 'btn') && S.task.refMode === 'folgt') {
          const c = controls.command(S.sim.cfg);
          S.task.cmd.vx = c.vx; S.task.cmd.wz = c.yaw;
          S.task._manualCmd = true;
        }
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
  // v2.27.0: Geist OHNE laufende Referenz = Spiegelbild des echten Roboters.
  // Vorher blieben die Geist-Gruppen im Ruhesatz am Ursprung kleben (halb im
  // Boden, Teile verstreut — „plötzlich blaue Objekte“). Jetzt steht der
  // cyanfarbene Geist immer NORMAL neben dem echten Roboter, solange keine
  // Motion-Task (oder keine brauchbare Referenz) ihn bespielt.
  if (r3d.ghostGroups && S.ghostOn && S.sim) {
    const refLive = S.task && (S.task.kind === 'motion' || S.task.pathOn) &&
      (S.task.kind === 'motion' ? !!S.task.clip : !!S.task.pathClip);
    if (!refLive) r3d.mirrorGhost(S.sim);
  }
  // Geist: Referenzpose mitlaufen lassen — Lehrer (Original) + Roboter-Geist.
  // v2.15.0: der ANKER hängt vom Referenz-Modus ab (ghostAnchor):
  //   frei   → Lehrer wandert auf der Clip-Bahn durchs Feld (mit Loop-Offset)
  //   stelle → Lehrer steht FIX am Startpunkt (Bewegung auf der Stelle)
  //   folgt  → Lehrer hängt am LEBENDEN Roboter (Bewegung relativ zu ihm)
  // Die Drohne (pathOn) zeigt nur den Lehrer (humanoid auf der Bahn).
  if ((S.ghostOn || S.srcShow) && S.task && (S.task.kind === 'motion' || S.task.pathOn) && (r3d.ghostGroups || r3d.sourceGhost)) {
    const clip = S.task.kind === 'motion' ? S.task.clip : S.task.pathClip;
    if (clip) {
      const isMotion = S.task.kind === 'motion';
      const phase = isMotion ? S.task.phase : (clip.fps ? (S.task._animT / clip.fps) / clip.n : 0);
      const fr = Math.floor(phase * clip.n) % clip.n;
      // LEBENDE Roboter-Basis (Anker für 'folgt')
      const rp = [0, 0, 0];
      S.sim.basePos(rp);
      const rq = [0, 0, 0, 0];
      S.sim.baseQuat(rq);
      const ryaw = Math.atan2(2 * (rq[0] * rq[3] + rq[1] * rq[2]), 1 - 2 * (rq[2] * rq[2] + rq[3] * rq[3]));
      const rr = S.task.ghostAnchor ? S.task.ghostAnchor(phase, rp, ryaw, [0, 0, 0]) : (clip.root && clip.yaw && S.task.refRoot ? S.task.refRoot(S.task.phase, [0, 0, 0]) : null);
      if (r3d.sourceGhost) {
        const mode = isMotion ? S.task.refMode : S.task.refMode;
        if (isMotion && clip.srcOverlay && rr) {
          // v2.28.1 ARDY-OVERLAY: das grüne Skeleton reitet EXAKT auf dem
          // Geist-Anker (Demo-Avatar-Prinzip: EINE Figur spielt die Motion).
          // Relative Darstellung + Gruppen-Offset je Frame → die Hüfte des
          // Skeletons sitzt Millimeter-genau auf der Geist-Basis. Der Weg,
          // den die ARDY-Hüfte im Clip nimmt, kürzt sich heraus — nichts
          // wandert mehr auseinander, auch nicht bei Geist-lenk (Stick).
          r3d.placeSourceGhostAt(fr, rr[0], rr[1]);
          r3d.sourceGhost.visible = true;
        } else {
          // GLB-Pfade: absolute Darstellung (konsistent mit dem Original-Mesh)
          r3d.setSourceGhostRelative(false);
          if (mode === 'frei' && isMotion && rr && clip.root) {
            r3d.setSourceGhostLoop(rr[0] - clip.root[2 * fr], rr[1] - clip.root[2 * fr + 1]);
            r3d.sourceGhost.visible = true;
          } else if (rr && mode !== 'stelle') {
            // 'folgt' (Roboter/Drohne): Geist hängt am Roboter (srcPos = relativ)
            r3d.setSourceGhostLoop(0, 0);
            r3d.sourceGhost.position.set(rr[0], rr[1], 0);
            r3d.sourceGhost.visible = true;
          } else if (mode === 'stelle') {
            // Auf der Stelle: Original-Mesh aus — seine srcPos laufen sonst die
            // Wegroute ab. Der Roboter-Geist (setGhostPose) zeigt die Pose korrekt.
            r3d.sourceGhost.visible = false;
          }
        }
        r3d.updateSourceGhost(fr); // v2.28.1: NACH der Anker-Wahl (Relativ-Flag!)
      }
      if (r3d.ghostGroups && isMotion && rr) {
        const gh = S.sim.makeGhostData();
        // baseQ: Lehrer-Nick/Roll (z. B. Zombie-Beuge) — der Geist nimmt die
        // ABSOLUTE Lehrer-Pose an statt aufrecht daneben zu stehen
        const bq = clip.baseQ ? clip.baseQ.subarray(4 * fr, 4 * fr + 4) : null;
        S.sim.setGhostPose(gh, clip.q, fr * clip.nu, clip.h[fr], rr[0], rr[1], rr[2], bq);
        // v2.28.0 BODEN-GARANTIE: hängt die Referenz-Pose (ARDY-Höhendrift)
        // unter dem Boden, hebt die ANZEIGE den Geist an, bis der Fuß bei 0
        // steht — der Geist steht wirklich AUF dem Boden, nie darin.
        try {
          const feet = S.sim.footGeoms || (S.sim.footGeoms = findFootGeoms(S.sim));
          S.sim.groundGhost(gh, feet);
        } catch (e) { /* fehlende Geom-API: Anzeige ohne Feinkorrektur */ }
        r3d.updateGhost(gh);
      }
    }
  }
  r3d.render();
  // v2.13.0: FPV-Rechteck (jeder 2. Frame gedrosselt, reine Anzeige)
  if (fpv && fpv.on && S.sim) { S._fpvSkip = !S._fpvSkip; if (!S._fpvSkip) fpv.render(S.sim); }

  // Statuszeile (5 Hz)
  statusT += dt;
  if (statusT > 0.2) {
    statusT = 0;
    ui.status(S.sim.baseSpeed(), S.sim.baseHeight(), fps);
    // v2.17.0: Canvas-Liveanzeigen (Karten-Fußzeilen, Gauges, Lichter)
    if (S.canvasBoard) {
      S.canvasBoard.renderLive();
      const cvSheetEl = document.getElementById('canvasSheet');
      if (cvSheetEl && !cvSheetEl.classList.contains('hidden')) updateCvStat();
    }
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
      });      // v2.12.0 Soft-MoE-Dashboard (MicroDuck): Routing-Bars + Level
      // v2.14.0: E-flexibel — Bars über der Expertenanzahl ausblenden
      const duckRow = document.getElementById('duckRow');
      if (duckRow) duckRow.style.display = (S.robotId === 'duck') ? 'flex' : 'none';
      if (duckRow && S.robotId === 'duck' && S.task && S.task.kind === 'speed' && S.task.moe) {
        const E = (S.trainer && S.trainer.net && S.trainer.net.E) || 4;
        const barIds = ['routeBal', 'routeWalk', 'routeTurn', 'routeRec'];
        for (let i = 0; i < barIds.length; i++) {
          const el = document.getElementById(barIds[i]);
          if (el) el.parentElement.style.visibility = (i < E) ? 'visible' : 'hidden';
        }
        const w = (S.trainer && S.trainer.lastW) ? S.trainer.lastW : null;
        if (w) {
          for (let i = 0; i < Math.min(4, w.length); i++) {
            const el = document.getElementById(barIds[i]);
            if (el) el.style.width = Math.max(3, Math.min(100, w[i] * 100)) + '%';
          }
        }
        const lv = document.getElementById('duckLevel');
        if (lv) lv.textContent = 'Lv ' + S.task.level;
      }
    }
  }
  chartT += dt;
  if (chartT > 0.35) {
    chartT = 0;
    if (!ui.$('trainSheet').classList.contains('hidden')) {
      ui.drawChart();
      // v2.14.0 LIVE-KURVEN: Schritte/s + Policy-Loss als zweite Kurve
      const lm = S.trainer ? S.trainer._lastMetrics : null;
      ui.pushRate(S.training ? S.stepsPerSec : 0, lm ? lm.piLoss : null);
      ui.drawRateChart();
      // v2.26.0: ARDY-Panel — Trainings-Prozent LIVE (Schritte / Ziel)
      const as_ = document.getElementById('ardySheet');
      if (as_ && !as_.classList.contains('hidden')) {
        const goal = S.ardyTrainGoal || 1000000;
        const steps = S.trainer ? S.trainer.stepCount : 0;
        const frac = Math.max(0, Math.min(1, steps / goal));
        const tp = document.getElementById('ardyTrainPct');
        if (tp) tp.textContent = (frac * 100).toFixed(1).replace('.', ',') + ' %';
        const tf = document.getElementById('ardyTrainFill');
        if (tf) tf.style.width = (frac * 100).toFixed(2) + '%';
        const ti = document.getElementById('ardyTrainInfo');
        if (ti) ti.textContent = fmtIntD(steps) + ' / ' + fmtIntD(goal) + (S.training ? ' · trainiert' : ' · pausiert');
      }
    }
  }
}

function fmtIntD(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function lastEma() {
  const e = ui.episodeEma;
  return e.length ? e[e.length - 1] : 0;
}

// ── UI-Verdrahtung ──────────────────────────────────────────
// ── v2.17.0: NETZ-CANVAS — Modus, Sheet, Gemini-Werkzeuge ──
/** Canvas-Modus EIN/AUS: der Graph fährt den Roboter (statt Gait/Policy). */
function setCanvasMode(on) {
  if (on) {
    if (S.training) stopTraining(true);
    S.mode = 'canvas';
    log('CANVAS-Modus: der Netz-Graph fährt den Roboter (unverbundene Aktuatoren halten die Keyframe-Pose)', 'ok');
  } else {
    if (S.canvasBoard) S.canvasBoard.stopTraining(true);
    S.mode = 'manuell';
    log('Canvas-Modus beendet — MANUELL');
  }
  ui.setMode(S.mode);
  if (S.sim) S.sim.reset();
  if (S.task && S.task.kind === 'motion') S.task.reset(new RNG(4242), S.sim);
  // Laufzeit-Leiste: nur im Canvas-Modus sichtbar (Inhalt baut das Board)
  const bar = document.getElementById('canvasUIBar');
  if (bar) {
    if (S.mode === 'canvas' && S.canvasBoard) S.canvasBoard.renderUIBar();
    else bar.classList.add('hidden');
  }
  if (S.canvasBoard) S.canvasBoard.syncButtons();
}

function updateCvStat() {
  const el = document.getElementById('cvStat');
  if (!el || !S.canvasBoard) return;
  const g = S.canvasBoard.graph;
  const pol = g.nodes.filter(n => n.type === 'policy');
  const tr = pol.filter(n => n.trainable).length;
  const lg = g.nodes.filter(n => n.type === 'logic').length;
  el.textContent = pol.length + ' Karten' + (lg ? ' · ' + lg + ' Logik' : '') + ' (' + tr + ' trainierbar) · ' + g.links.length + ' Kabel · ' +
    (g._ioCount || 0) + ' Sensor-Ports · ' + (g._actCount || 0) + ' Aktuator-Ports';
}

// ── v2.21.0: ⭐ MOTION-KI — MotionBrick/AI4Animation-artige Wiedergabe ──
// Die FERTIG trainierte Motion-Policy animiert den Roboter (die GLB-Referenz
// liefert Stil/Phase in 'folgt'-Semantik), der Nutzer steuert BEI BEDARF per
// Joystick und Buttons: der STEUER-MIX mischt Stick-Kommando und Clip-Tempo
// in die Befehl-Kanäle, ⏸ friert den Geist ein (Roboter hält die Pose),
// ⏭ springt zum nächsten Clip.
function setMotionKi(on) {
  const ki = S.motionKi, t = S.task;
  ki.on = !!on;
  const chip = document.getElementById('mkiChip');
  if (chip) {
    chip.textContent = ki.on ? 'AN' : 'AUS';
    chip.classList.toggle('active', ki.on);
  }
  if (ki.on) {
    if (t && t.kind === 'motion' && S.refMode !== 'folgt') {
      ki.prevRef = S.refMode;
      S.refMode = 'folgt';
      try { localStorage.setItem('tr_refmode_v1', 'folgt'); } catch (e) { /* voll */ }
      t.refMode = 'folgt';
      syncRefChips();
    }
    log('MOTION-KI AN — die trainierte Policy animiert, der Stick führt bei Bedarf (Mix ' + Math.round(ki.mix * 100) + ' % · 0 % = nur Clip, 100 % = nur Stick). Modus POLICY wählen.', 'ok');
    ui.toast('MOTION-KI an — Modus POLICY starten');
  } else {
    if (t && t.kind === 'motion' && ki.prevRef && S.refMode === 'folgt') {
      S.refMode = ki.prevRef;
      try { localStorage.setItem('tr_refmode_v1', ki.prevRef); } catch (e) { /* voll */ }
      t.refMode = ki.prevRef;
      syncRefChips();
    }
    if (t && t.ghostPaused) t.ghostPaused = false;
    const p = document.getElementById('mkiPause');
    if (p) { p.textContent = '⏸ GEIST'; p.classList.remove('active'); }
    log('MOTION-KI AUS — Referenz-Modus wiederhergestellt');
    ui.toast('MOTION-KI aus');
  }
}

/** ⏭ NÄCHSTER CLIP: springt zum nächsten Clip, der eine Variante für den
 *  aktiven Roboter trägt (motionByRobot[robot] bzw. rec.motion beim G1). */
async function nextMotionClip() {
  const rid = S.robotId;
  const eligible = (S.clips || []).filter(r => (r.motionByRobot && r.motionByRobot[rid]) || (rid === 'g1' && r.motion));
  if (!eligible.length) { ui.toast('Keine Clips für diesen Roboter — erst GLB importieren', true); return; }
  const idx = eligible.findIndex(r => r.id === S.activeRecId);
  const next = eligible[(idx + 1) % eligible.length];
  if (idx < 0 || !next) { ui.toast('Kein aktiver Clip — Referenz wählen', true); return; }
  if (next.id === S.activeRecId) { ui.toast('Nur ein Clip vorhanden'); return; }
  try {
    await activateClip(next);
    const t = S.task;
    if (S.motionKi.on && t && t.kind === 'motion' && S.refMode !== 'folgt') { t.refMode = 'folgt'; S.refMode = 'folgt'; syncRefChips(); }
    ui.toast('Clip: ' + next.name);
  } catch (e) { log('Clip-Wechsel fehlgeschlagen: ' + e.message, 'err'); }
}

function toggleCanvasSheet(force) {
  const sheet = document.getElementById('canvasSheet');
  if (!sheet) return;
  const show = force !== undefined ? force : sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden', !show);
  document.body.classList.toggle('cv-open', !!show); // v2.18.0: UI-Leiste über Vollbild-Canvas
  const btn = document.getElementById('btnCanvas');
  if (btn) btn.classList.toggle('lit', show);
  if (show) {
    ui.toggleTrain(false);
    ui.toggleAI(false);
    if (S.canvasBoard) {
      S.canvasBoard.attach();
      S.canvasBoard.render();
      updateCvStat();
    }
  }
}

/** Werkzeug 16: canvasGraph — Graph bauen/lesen (voller Zugriff). */
function canvasGraphTool(args) {
  const b = S.canvasBoard;
  if (!b) return 'Fehler: Canvas nicht bereit';
  const g = b.graph;
  const cmd = args.cmd || 'state';
  try {
    if (cmd === 'state') return JSON.stringify(b.describe());
    if (cmd === 'linkMany') { // v2.20.0: viele Kabel in EINEM Aufruf (Reparatur)
      if (!Array.isArray(args.links) || !args.links.length) return 'Fehler: links = [{from:{node,port}, to:{node,port}}, …] fehlen';
      const rep = linkManyGraph(g, args.links);
      b._cacheLinks();
      b.render();
      b.scheduleSave();
      let out = 'Kabel gesetzt: ' + rep.ok + '/' + args.links.length;
      if (rep.fail.length) out += ' · FEHLGESCHLAGEN: ' + rep.fail.slice(0, 6).map(f => '#' + f.i + ' ' + f.error).join(' | ') + (rep.fail.length > 6 ? ' … (' + rep.fail.length + ' gesamt)' : '');
      return out + ' — Port-Status (frei/belegt) steht in cmd=state';
    }
    if (cmd === 'clear') { b.clearAll(); return 'Canvas geleert (je Roboter)'; }
    if (cmd === 'add') {
      let nd;
      if (args.type === 'policy') nd = addPolicyNode(g, args);
      else if (args.type === 'logic') nd = addLogicNode(g, args); // v2.20.0
      else if (args.type === 'ui') nd = addUINode(g, args);
      else if (args.type === 'const') nd = addConstNode(g, args);
      else return 'Fehler: type muss "policy", "logic", "ui" oder "const" sein';
      b._ensurePPO(nd);
      b._cacheLinks();
      b.render();
      b.scheduleSave();
      return 'Knoten erstellt: id=' + nd.id + ' type=' + nd.type +
        (nd.type === 'policy' ? ' nIn=' + nd.nIn + ' nOut=' + nd.nOut + ' hidden=' + nd.hidden.join('/') + ' — verbinde Ports jetzt mit cmd=link (io = Sensoren, out = Aktuatoren). Ausgänge wirken als tanh×Aktionsamplitude um die Ruhepose.'
          : nd.type === 'logic' ? ' op=' + nd.op + ' nIn=' + nd.nIn + ' nOut=' + nd.nOut + ' (KEIN Netz — Verbinder: Ergebnis = ((in0 ⊗ in1) …), alle Ausgänge = Ergebnis)'
          : nd.type === 'ui' ? ' kind=' + nd.kind + ' io=' + nd.io
          : ' values=' + nd.values.join(','));
    }
    if (cmd === 'link') {
      if (!args.from || !args.to) return 'Fehler: from/to brauchen {node, port}';
      const fromNd = findNode(g, args.from.node) || findNodeByName(g, args.from.node);
      const toNd = findNode(g, args.to.node) || findNodeByName(g, args.to.node);
      if (!fromNd) return 'Fehler: Quell-Knoten "' + args.from.node + '" nicht gefunden (io = Sensoren, out = Aktuatoren, sonst Karten-IDs/Namen)';
      if (!toNd) return 'Fehler: Ziel-Knoten "' + args.to.node + '" nicht gefunden';
      const res = addLink(g, { n: fromNd.id, port: +args.from.port || 0 }, { n: toNd.id, port: +args.to.port || 0 });
      if (!res.ok) return 'Fehler: ' + res.error;
      b._cacheLinks();
      b.render();
      b.scheduleSave();
      return 'Kabel gesetzt: ' + (fromNd.name || fromNd.id) + '[' + args.from.port + '] → ' + (toNd.name || toNd.id) + '[' + args.to.port + ']';
    }
    if (cmd === 'unlink') {
      const ok = args.id ? removeLink(g, { id: args.id }) : (args.from && args.to ? removeLink(g, { from: args.from, to: args.to }) : false);
      if (!ok) return 'Fehler: Kabel nicht gefunden (ids stehen in cmd=state)';
      b._cacheLinks();
      b.render();
      b.scheduleSave();
      return 'Kabel entfernt';
    }
    if (cmd === 'remove') {
      const nd = findNode(g, args.node) || findNodeByName(g, args.node);
      if (!nd) return 'Fehler: Knoten nicht gefunden';
      b.removeNodeUI(nd.id);
      return 'Knoten entfernt: ' + nd.id;
    }
    if (cmd === 'config') {
      const nd = findNode(g, args.node) || findNodeByName(g, args.node);
      if (!nd) return 'Fehler: Knoten nicht gefunden';
      let archChanged = false;
      if (args.name) nd.name = String(args.name).slice(0, 24);
      if (nd.type === 'policy') {
        if (args.hidden !== undefined) {
          const h = (Array.isArray(args.hidden) ? args.hidden : String(args.hidden).split(',')).map(x => Math.round(+x)).filter(x => Number.isFinite(x) && x >= 8 && x <= 256).slice(0, 3);
          if (h.length && h.join(',') !== nd.hidden.join(',')) { archChanged = true; nd.hidden = h; }
        }
        if (args.nIn !== undefined) { const v = Math.round(+args.nIn); if (v >= 1 && v <= 64 && v !== nd.nIn) { archChanged = true; nd.nIn = v; } }
        if (args.nOut !== undefined) { const v = Math.round(+args.nOut); if (v >= 1 && v <= 32 && v !== nd.nOut) { archChanged = true; nd.nOut = v; } }
        if (args.trainable !== undefined) nd.trainable = !!args.trainable;
        if (args.lr !== undefined && Number.isFinite(+args.lr)) nd.lr = Math.max(1e-5, Math.min(3e-3, +args.lr));
        if (args.T !== undefined && Number.isFinite(+args.T)) nd.T = Math.round(Math.max(128, Math.min(4096, +args.T)));
        if (archChanged) { nd.ppo = null; b.ppo.delete(nd.id); }
        b._ensurePPO(nd);
        g.links = g.links.filter(l => {
          const tN = findNode(g, l.to.n), fN = findNode(g, l.from.n);
          if (tN && tN.id === nd.id && l.to.port >= nd.nIn) return false;
          if (fN && fN.id === nd.id && l.from.port >= nd.nOut) return false;
          return true;
        });
      } else if (nd.type === 'logic') { // v2.20.0
        if (args.op && LOGIC_OPS[args.op]) nd.op = args.op;
        if (args.nIn !== undefined) { const v = Math.round(+args.nIn); const min = LOGIC_OPS[nd.op].min; if (v >= min && v <= 16 && v !== nd.nIn) { archChanged = true; nd.nIn = v; } }
        if (args.nOut !== undefined) { const v = Math.round(+args.nOut); if (v >= 1 && v <= 16 && v !== nd.nOut) { archChanged = true; nd.nOut = v; } }
        if (archChanged) {
          g.links = g.links.filter(l => {
            if (l.to.n === nd.id && l.to.port >= nd.nIn) return false;
            if (l.from.n === nd.id && l.from.port >= nd.nOut) return false;
            return true;
          });
        }
      } else if (nd.type === 'const') {
        if (Array.isArray(args.values)) nd.values = args.values.slice(0, 8).map(v => Math.max(-10, Math.min(10, Number.isFinite(+v) ? +v : 0)));
      } else if (nd.type === 'out') {
        if (args.sink === 'direct' || args.sink === 'residual') { for (let a = 0; a < (g._actCount || 0); a++) nd.sink[a] = args.sink; }
      }
      b._cacheLinks();
      b.render();
      b.scheduleSave();
      return 'Konfiguration gesetzt für „' + (nd.name || nd.id) + '"' + (archChanged ? ' — Architektur geändert, das Netz ist FRISCH (lernt von 0)' : '');
    }
    if (cmd === 'import') {
      const nd = findNode(g, args.node) || findNodeByName(g, args.node);
      if (!nd || nd.type !== 'policy') return 'Fehler: node muss eine Policy-Karte sein';
      const json = b.hooks.getMainPolicyJSON ? b.hooks.getMainPolicyJSON() : null;
      if (!json) return 'Fehler: keine App-Policy im Speicher — erst normal trainieren (oder „Laden" im Trainings-Panel), dann importieren';
      if (json.obsDim !== nd.nIn || json.actDim !== nd.nOut) return 'Fehler: Maße passen nicht (Policy ' + json.obsDim + '→' + json.actDim + ', Karte ' + nd.nIn + '→' + nd.nOut + ') — setze nIn/nOut der Karte passend (cmd=config)';
      const p = cardPPOFromAppPolicy(json);
      b.ppo.set(nd.id, p);
      nd.ppo = p.toJSON();
      b.render();
      b.scheduleSave();
      return 'App-Policy in Karte „' + nd.name + '" geladen (' + p.stepCount + ' Schritte, 64×64-MLP) — sie läuft jetzt an ihren verkabelten Ports';
    }
    return 'Fehler: unbekannter cmd — erlaubt: state | add | link | linkMany | unlink | remove | config | clear | import';
  } catch (e) { return 'Fehler: ' + e.message; }
}

/** Werkzeug 17: canvasReward — globale oder karteigene Belohnung. */
function canvasRewardTool(args) {
  const b = S.canvasBoard;
  if (!b) return 'Fehler: Canvas nicht bereit';
  const g = b.graph;
  let targets;
  if (args.card && args.card !== 'alle') {
    const nd = findNode(g, args.card) || findNodeByName(g, args.card);
    if (!nd || nd.type !== 'policy') return 'Fehler: Karten-ID/-Name nicht gefunden (' + args.card + ')';
    targets = [nd];
  } else {
    targets = g.nodes.filter(n => n.type === 'policy');
    if (!targets.length) return 'Fehler: keine Policy-Karten im Canvas';
  }
  for (const nd of targets) {
    if (args.mode === 'global' || args.mode === 'custom') nd.reward.mode = args.mode;
    if (args.scale !== undefined && Number.isFinite(+args.scale)) nd.reward.scale = Math.max(0, Math.min(3, +args.scale));
    if (args.w && typeof args.w === 'object') {
      for (const [k, [lo, hi]] of Object.entries(CARD_R_FIELDS)) {
        if (args.w[k] !== undefined && Number.isFinite(+args.w[k])) nd.reward.w[k] = Math.max(lo, Math.min(hi, +args.w[k]));
      }
    }
  }
  b.scheduleSave();
  return 'Belohnung gesetzt für [' + targets.map(n => n.name).join(', ') + ']: ' + JSON.stringify(targets[0].reward) +
    (targets[0].reward.mode === 'custom' ? ' — EIGENE Formel: r = alive + up·(upz−0,7) + vel·min(1,|vfwd|) + turn·min(1,|yawRate|) − energy·Σact² − fall·(Sturz)' : ' — GLOBALE Aufgaben-Belohnung × ' + targets[0].reward.scale);
}

/** Werkzeug 18: canvasRun — Ausführung/Training schalten. */
function canvasRunTool(args) {
  const b = S.canvasBoard;
  if (!b) return 'Fehler: Canvas nicht bereit';
  if (args.train !== undefined) {
    if (args.train) {
      b.startTraining();
      const n = b.graph.nodes.filter(n2 => n2.type === 'policy' && n2.trainable).length;
      return 'Canvas-TRAINING gestartet (' + n + ' trainierbare Karten, Tempo = Tempo-Slider im Trainings-Panel) — Modus CANVAS ist aktiv, der Roboter läuft den Graph live';
    }
    b.stopTraining();
    return 'Canvas-Training pausiert (' + b.stats.episodes + ' Episoden, ' + b.stats.steps + ' Schritte)';
  }
  if (args.run !== undefined) {
    setCanvasMode(!!args.run);
    return args.run
      ? 'Canvas AUSGEFÜHRT — Modus CANVAS aktiv. Der Graph fährt den Roboter.'
      : 'Canvas-Modus beendet — Modus MANUELL';
  }
  return 'Fehler: run oder train angeben (true/false)';
}

/** Werkzeug 19: canvasUI — eigene UI-Elemente als Ein-/Ausgänge. */
function canvasUITool(args) {
  const b = S.canvasBoard;
  if (!b) return 'Fehler: Canvas nicht bereit';
  const g = b.graph;
  try {
    if (args.remove) {
      const nd = findNode(g, args.node) || findNodeByName(g, args.node);
      if (!nd || nd.type !== 'ui') return 'Fehler: UI-Knoten nicht gefunden (node = id oder Name)';
      b.removeNodeUI(nd.id);
      return 'UI-Element entfernt: ' + nd.name;
    }
    let nd = args.node ? (findNode(g, args.node) || findNodeByName(g, args.node)) : null;
    if (!nd) {
      nd = addUINode(g, args);
    } else if (nd.type !== 'ui') {
      return 'Fehler: Knoten ' + nd.id + ' ist kein UI-Element';
    } else {
      if (args.kind && ['button', 'toggle', 'slider', 'joy', 'gauge', 'light', 'code'].includes(args.kind)) nd.kind = args.kind;
      if (args.label) nd.label = String(args.label).slice(0, 16);
      if (args.name) nd.name = String(args.name).slice(0, 20);
      if ((args.io === 'in' || args.io === 'out') && nd.io !== args.io) {
        nd.io = args.io;
        g.links = g.links.filter(l => l.from.n !== nd.id && l.to.n !== nd.id);
      }
      if (args.nOut !== undefined) nd.nOut = Math.max(1, Math.min(4, Math.round(+args.nOut) || 1));
      if (typeof args.code === 'string') {
        nd.code = args.code.slice(0, 2000);
        nd._codeRev = (nd._codeRev || 0) + 1;
        if (b._codeFn) delete b._codeFn[nd.id + ':' + (nd._codeRev - 1)];
      }
    }
    // Harte io-Semantik je Art (Widgets sind eindeutig)
    if (nd.kind === 'gauge' || nd.kind === 'light') nd.io = 'out';
    if (['button', 'toggle', 'slider', 'joy'].includes(nd.kind)) nd.io = 'in';
    let codeNote = '';
    if (nd.kind === 'code' && nd.code && nd.code.trim()) {
      try { new Function('ctx', '"use strict";' + nd.code); } catch (e) {
        return 'UI „' + nd.name + '" gespeichert, aber SYNTAX-FEHLER im Code: ' + e.message + ' — korrigiere und rufe canvasUI erneut auf.';
      }
      codeNote = ' Code läuft je Schritt mit ctx = {t (Sekunden), dt, state (dauerhafter Speicher)} und MUSS ein Array mit ' + nd.nOut + ' Zahl(en) zurückgeben (io=in) bzw. bekommt ctx.value (io=out).';
    }
    b._cacheLinks();
    b.render();
    b.scheduleSave();
    return 'UI-Element „' + nd.name + '" (id=' + nd.id + ', kind=' + nd.kind + ', io=' + nd.io +
      (nd.io === 'in' ? ', ' + nodeOutCount(g, nd) + ' Ausgangsport(s)' : ', 1 Eingangsport') +
      ') bereit' + codeNote + ' — verbinde es per canvasGraph cmd=link.';
  } catch (e) { return 'Fehler: ' + e.message; }
}

/** Werkzeug 20: canvasBuild — GANZE Architektur in EINEM Aufruf (v2.19.0).
 *  Baut Karten (+Belohnungen), Kabel und Senken-Modus atomar (buildPlanGraph),
 *  schaltet danach Ausführung/Training und liefert der KI einen kompakten
 *  Report mit FEHLGESCHLAGENEN Kabeln (nicht abgebrochen — korrigierbar). */
function canvasBuildTool(args) {
  const b = S.canvasBoard;
  if (!b) return 'Fehler: Canvas nicht bereit';
  const g = b.graph;
  try {
    let cleared = false;
    if (args.clear) { b.clearAll(); cleared = true; }
    const rep = buildPlanGraph(g, args);
    // Architektur-gänderte Karten: altes PPO im Board-Map verwerfen (wie cmd=config)
    for (const c of rep.cards) {
      if (!c.archReset) continue;
      const nd = findNode(g, c.id);
      if (nd) { nd.ppo = null; b.ppo.delete(nd.id); }
    }
    for (const nd of g.nodes) if (nd.type === 'policy') b._ensurePPO(nd);
    b._cacheLinks();
    b.render();
    b.scheduleSave();
    // Ausführung/Training am ENDE schalten (train schließt run ein)
    let runNote = ' — Modus unverändert';
    if (args.train === true) { b.startTraining(); runNote = ' — Canvas-TRAINING LÄUFT (Tempo = Tempo-Slider im Trainings-Panel)'; }
    else if (args.run === true) { setCanvasMode(true); runNote = ' — Modus CANVAS aktiv (Graph fährt den Roboter)'; }
    else if (args.run === false) { setCanvasMode(false); runNote = ' — Modus MANUELL'; }
    // Kompakter Report für die KI
    const parts = [];
    if (cleared) parts.push('Canvas geleert');
    parts.push('Karten: ' + (rep.cards.map(c => (c.kind === 'logic' ? 'LOGIK „' : '„') + c.name + '"(id=' + c.id + (c.isNew ? ',neu' : ',angepasst') + (c.archReset ? ',Netz-FRISCH' : '') + ')').join(', ') || 'keine'));
    parts.push('Kabel gesetzt: ' + rep.linksOk);
    if (rep.linksFail.length) {
      parts.push('Kabel FEHLGESCHLAGEN: ' + rep.linksFail.slice(0, 6).map(f => '#' + f.i + ' ' + f.error).join(' | ') +
        (rep.linksFail.length > 6 ? ' … (' + rep.linksFail.length + ' gesamt)' : '') +
        ' — Port-Zahlen stehen in canvasGraph cmd=state; setze diese Kabel EINZELN mit cmd=link');
    }
    if (rep.errors.length) parts.push('Hinweise: ' + rep.errors.slice(0, 4).join(' | '));
    const nLinked = new Set(g.links.filter(l => l.to.n === 'out').map(l => l.to.port)).size;
    parts.push('Aktuatoren verkabelt: ' + nLinked + '/' + (g._actCount || 0) + ' (unverkabelte halten die Ruhe-/Keyframe-Pose)');
    parts.push('Trainierbare Karten: ' + g.nodes.filter(n => n.type === 'policy' && n.trainable).length);
    return parts.join(' · ') + runNote;
  } catch (e) { return 'Fehler: ' + e.message; }
}

/** Werkzeug 21: motionKi — MOTION-KI-Wiedergabe (v2.21.0): die fertig
 *  trainierte Motion-Policy animiert den Roboter, der Nutzer steuert bei
 *  Bedarf per Joystick/Buttons. args = {on:<bool>, mix:0…1, paused:<bool>,
 *  nextClip:<bool>} — paused/nextClip brauchen eine aktive GLB-Referenz. */
function motionKiTool(args) {
  const out = [];
  if (args.on !== undefined) {
    setMotionKi(!!args.on);
    out.push('MOTION-KI ' + (S.motionKi.on ? 'AN' : 'AUS') + (S.motionKi.on ? ' — Modus POLICY starten, der Stick führt je nach Mix' : ''));
  }
  if (args.mix !== undefined && Number.isFinite(+args.mix)) {
    S.motionKi.mix = Math.max(0, Math.min(1, +args.mix));
    const s = document.getElementById('mkiMix');
    if (s) s.value = String(S.motionKi.mix);
    const v = document.getElementById('mkiMixVal');
    if (v) v.textContent = Math.round(S.motionKi.mix * 100) + ' %';
    try { localStorage.setItem('tr_motionki_v1', JSON.stringify({ mix: S.motionKi.mix })); } catch (e) { /* voll */ }
    out.push('Steuer-Mix: ' + Math.round(S.motionKi.mix * 100) + ' % Stick / ' + Math.round((1 - S.motionKi.mix) * 100) + ' % Clip');
  }
  if (args.paused !== undefined) {
    const t = S.task;
    if (!t || t.kind !== 'motion') return 'Fehler: keine aktive GLB-Referenz (erst Clip aktivieren)';
    t.ghostPaused = !!args.paused;
    const p = document.getElementById('mkiPause');
    if (p) { p.textContent = t.ghostPaused ? '▶ GEIST' : '⏸ GEIST'; p.classList.toggle('active', t.ghostPaused); }
    out.push('Geist ' + (t.ghostPaused ? 'PAUSIERT — der Roboter hält die Pose' : 'läuft weiter'));
  }
  if (args.nextClip) {
    return nextMotionClip().then((/* nextMotionClip meldet selbst per toast/log */) =>
      'Clip-Wechsel ausgelöst — aktiver Clip jetzt: ' + (S.motionClip ? S.motionClip.name : 'keiner') +
      (out.length ? ' · ' + out.join(' · ') : ''));
  }
  if (!out.length) return 'Fehler: on, mix, paused oder nextClip angeben';
  return out.join(' · ');
}

function wireUI() {
  // v2.14.1: btnConsole/consoleClose ENTFERNT (Nutzerwunsch) — Log läuft unsichtbar.
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
  document.getElementById('btnTrainTop').addEventListener('click', () => { ui.toggleTrain(); controls.buzz(); });
document.getElementById('btnArdy').addEventListener('click', () => { ui.toggleArdy(); controls.buzz(); });
const ardyCloseBtn = document.getElementById('ardyClose'); if (ardyCloseBtn) ardyCloseBtn.addEventListener('click', () => { ui.toggleArdy(false); controls.buzz(); });
  document.getElementById('trainClose').addEventListener('click', () => ui.toggleTrain(false));
  // ── v2.17.0: NETZ-CANVAS ────────────────────────────────
  document.getElementById('btnCanvas').addEventListener('click', () => { controls.buzz(); toggleCanvasSheet(); });
  document.getElementById('cvClose').addEventListener('click', () => toggleCanvasSheet(false));
  document.getElementById('cvAddPolicy').addEventListener('click', () => {
    controls.buzz();
    if (!S.canvasBoard) return;
    const nd = addPolicyNode(S.canvasBoard.graph, { name: 'Netz ' + (S.canvasBoard.graph.nodes.filter(n => n.type === 'policy').length + 1) });
    S.canvasBoard._ensurePPO(nd);
    S.canvasBoard._cacheLinks();
    S.canvasBoard.render();
    S.canvasBoard.scheduleSave();
    S.canvasBoard.openEdit(nd.id);
    updateCvStat();
    log('Canvas: neue Karte „' + nd.name + '" (' + nd.nIn + '→' + nd.hidden.join('/') + '→' + nd.nOut + ') — Ports antippen zum Verbinden', 'ok');
  });
  document.getElementById('cvAddUI').addEventListener('click', () => {
    controls.buzz();
    if (!S.canvasBoard) return;
    const nd = addUINode(S.canvasBoard.graph, { kind: 'button', label: 'Knopf' });
    S.canvasBoard._cacheLinks();
    S.canvasBoard.render();
    S.canvasBoard.scheduleSave();
    S.canvasBoard.openEdit(nd.id);
    updateCvStat();
  });
  document.getElementById('cvAddLogic').addEventListener('click', () => { // v2.20.0: Logik/Verbinder
    controls.buzz();
    if (!S.canvasBoard) return;
    const nd = addLogicNode(S.canvasBoard.graph, { op: 'add', nIn: 2, nOut: 1 });
    S.canvasBoard._cacheLinks();
    S.canvasBoard.render();
    S.canvasBoard.scheduleSave();
    S.canvasBoard.openEdit(nd.id);
    updateCvStat();
    log('Canvas: Logik-Karte „' + nd.name + '" (' + LOGIC_OPS[nd.op].sym + ', ' + nd.nIn + '→' + nd.nOut + ') — KEIN Netz, verbindet Signale', 'ok');
  });
  document.getElementById('cvAddConst').addEventListener('click', () => {
    controls.buzz();
    if (!S.canvasBoard) return;
    const nd = addConstNode(S.canvasBoard.graph, { values: [0] });
    S.canvasBoard._cacheLinks();
    S.canvasBoard.render();
    S.canvasBoard.scheduleSave();
    S.canvasBoard.openEdit(nd.id);
    updateCvStat();
  });
  document.getElementById('cvZoomIn').addEventListener('click', () => S.canvasBoard && S.canvasBoard.zoomBy(1.18));
  document.getElementById('cvZoomOut').addEventListener('click', () => S.canvasBoard && S.canvasBoard.zoomBy(1 / 1.18));
  document.getElementById('cvFit').addEventListener('click', () => S.canvasBoard && S.canvasBoard.fitView());
  document.getElementById('cvClear').addEventListener('click', () => {
    controls.buzz();
    if (!S.canvasBoard) return;
    S.canvasBoard.clearAll();
    updateCvStat();
    ui.toast('Canvas geleert');
  });
  document.getElementById('modeCanvas').addEventListener('click', () => {
    controls.buzz();
    setCanvasMode(S.mode !== 'canvas');
    if (S.mode === 'canvas') ui.toast('CANVAS: Graph fährt den Roboter');
  });
  // v2.14.1: btnFull ENTFERNT — die App ist nativ Immersive (MainActivity),
  // der WebView hat keine Fullscreen-API: der Button konnte nichts tun.

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
  // ── Störungen / Domain Randomization (v2.11.0) ──────────
  for (const b of document.querySelectorAll('.dr-chip')) {
    b.addEventListener('click', () => { controls.buzz(); setDr(b.dataset.dr); });
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
  // v2.14.0: Tempo-SLIDER (1–16 Schritte/Frame) ersetzt die Chips 1×/4×/16×/MAX
  // („MAX“ = Parallel-Training hat auf Handys das UI blockiert — deshalb raus).
  const speedSlider = document.getElementById('speedSlider');
  const speedVal = document.getElementById('speedVal');
  if (speedSlider) {
    speedSlider.value = String(Math.min(16, Math.max(1, parseInt(S.speedMode, 10) || 2)));
    if (speedVal) speedVal.textContent = speedSlider.value + '×';
    speedSlider.addEventListener('input', () => {
      const v = String(Math.min(16, Math.max(1, parseInt(speedSlider.value, 10) || 1)));
      S.speedMode = v;
      if (speedVal) speedVal.textContent = v + '×';
      try { localStorage.setItem('tr_speed_v2', v); } catch (e) { /* voll */ }
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
    // v2.14.0: Export MIT Metadaten (Roboter, Aufgabe, Version) — Import
    // akzeptiert weiterhin auch das alte Naked-Format.
    const json = JSON.stringify({
      meta: {
        app: 'trainrobot', version: VERSION,
        robot: S.robotId, task: S.task ? S.task.kind : null, scenario: scenarioOf(S.robotId),
        obsDim: S.trainer.obsDim, actDim: S.trainer.actDim,
        stepCount: S.trainer.stepCount, saved: new Date().toISOString(),
        moeE: S.trainer.net && S.trainer.net.E ? S.trainer.net.E : undefined,
      },
      policy: S.trainer.toJSON(),
    });
    const name = 'trainrobot_policy_' + S.robotId + '_' + S.trainer.stepCount + 'steps.json';
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
      // v2.14.0: Wrapper {meta, policy} ODER klassisches Naked-Format
      const wrapped = data && data.policy && data.meta ? data.policy : data;
      const p = PPO.fromAny(wrapped); // v2.12.0: MLP + Soft-MoE
      if (p.obsDim !== S.task.obsDim || p.actDim !== S.task.actDim) throw new Error('Policy passt nicht zu diesem Roboter/Aufgabe');
      S.trainer = p;
      ui.policyAvailable(true);
      const meta = data && data.meta ? ' (von ' + (data.meta.robot || '?') + ', ' + (data.meta.stepCount || 0) + ' Schritte)' : '';
      ui.toast('Import ok (' + p.stepCount + ' Schritte)');
      log('Policy importiert: ' + f.name + meta, 'ok');
    } catch (err) {
      ui.toast('Import fehlgeschlagen: ' + err.message, true);
    }
    e.target.value = '';
  });
  document.getElementById('failReload').addEventListener('click', () => location.reload());

  // ── GLB-Bewegung (G1) ──────────────────────────────────
  document.getElementById('glbImportBtn').addEventListener('click', () => document.getElementById('glbFile').click());
  document.getElementById('glbFile').addEventListener('change', onGlbFiles);
  // v2.22.0: ARDY-Brücke — QPOS-CSV (NVIDIA ARDY, Text→Motion) als Lehrer
  initArdy(); // v2.25.0: ARDY Mini auf dem Gerät (Text→Motion)
  wireArdyGhostDrive(); // v2.27.0: Geist lenken (Stick → Referenz → Reward)
  document.getElementById('csvImportBtn').addEventListener('click', () => document.getElementById('csvFile').click());
  document.getElementById('csvFile').addEventListener('change', onCsvFiles);
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
      if (S.parallel) S.parallel.envCfg = parallelEnvCfg(); // v2.16.0: Steuerung sofort an Worker
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
  // ── v2.15.0: REFERENZ-MODUS (STELLE / FREI / FOLGT) ─────
  for (const b of document.querySelectorAll('.ref-chip')) {
    b.addEventListener('click', () => {
      controls.buzz();
      const m = b.dataset.ref;
      if (!['stelle', 'frei', 'folgt'].includes(m)) return;
      S.refMode = m;
      try { localStorage.setItem('tr_refmode_v1', m); } catch (e) { /* voll */ }
      if (S.task && S.task.kind === 'motion') S.task.refMode = m;
      if (S.task && S.task.pathOn) S.task.refMode = m;
      if (S.parallel) S.parallel.envCfg = parallelEnvCfg(); // v2.16.0: Modus sofort an Worker
      syncRefChips();
      log('Referenz-Modus: ' + ({ stelle: 'AN EINER STELLE — Referenz steht fix, Bewegung auf der Stelle', frei: 'FREI — der Lehrer wandert auf seiner Bahn durchs Feld', folgt: 'AM ROBOTER GEANKERT — der Lehrer hängt am Roboter, kein Bahn-Zwang' })[m], 'ok');
      ui.toast('Referenz: ' + ({ stelle: 'An einer Stelle', frei: 'Frei', folgt: 'Folgt dem Roboter' })[m]);
    });
  }
  // ── v2.21.0: ⭐ MOTION-KI — trainierte Motion animiert, Stick/Buttons steuern bei Bedarf ──
  const mkiChip = document.getElementById('mkiChip');
  if (mkiChip) {
    mkiChip.addEventListener('click', () => {
      controls.buzz();
      setMotionKi(!S.motionKi.on);
    });
    const mkiMix = document.getElementById('mkiMix');
    const mkiMixVal = document.getElementById('mkiMixVal');
    const syncMix = () => { if (mkiMixVal) mkiMixVal.textContent = Math.round(S.motionKi.mix * 100) + ' %'; if (mkiMix) mkiMix.value = String(S.motionKi.mix); };
    syncMix();
    if (mkiMix) mkiMix.addEventListener('input', () => {
      S.motionKi.mix = Math.max(0, Math.min(1, +mkiMix.value || 0));
      syncMix();
      try { localStorage.setItem('tr_motionki_v1', JSON.stringify({ mix: S.motionKi.mix })); } catch (e) { /* voll */ }
    });
    const mkiPause = document.getElementById('mkiPause');
    if (mkiPause) mkiPause.addEventListener('click', () => {
      controls.buzz();
      const t = S.task;
      if (!t || t.kind !== 'motion') { ui.toast('Nur mit aktiver GLB-Referenz', true); return; }
      t.ghostPaused = !t.ghostPaused;
      mkiPause.textContent = t.ghostPaused ? '▶ GEIST' : '⏸ GEIST';
      mkiPause.classList.toggle('active', t.ghostPaused);
      ui.toast(t.ghostPaused ? 'Geist PAUSIERT — der Roboter hält die Pose' : 'Geist läuft weiter');
      log('MOTION-KI: Geist ' + (t.ghostPaused ? 'pausiert (Pose halten)' : 'läuft weiter'), 'ok');
    });
    const mkiNext = document.getElementById('mkiNext');
    if (mkiNext) mkiNext.addEventListener('click', () => { controls.buzz(); nextMotionClip(); });
  }
  // ── v2.15.0/v2.16.0: ANIMATION LÖSEN — Policy WEITERTRAINIEREN ohne GLB ──
  document.getElementById('glbUnbind').addEventListener('click', () => {
    controls.buzz();
    const t = S.task;
    if (!t || (t.kind !== 'motion' && !t.pathOn)) { ui.toast('Nur mit aktiver GLB-Referenz möglich', true); return; }
    stopTraining(true);
    if (t.kind === 'motion') {
      S.animTraining = false;
      try { localStorage.setItem('tr_animOn', '0'); } catch (e) { /* voll */ }
      t.animOn = false;
      // v2.16.0: Referenz-MODUS bleibt wie gewählt (stelle/frei/folgt) —
      // ohne Animation läuft der KOMMANDOGANG (Trainings-Fahrbefehle bzw.
      // Stick). Ist keine Steuerung gewählt, schalten wir auf Joystick um,
      // damit der Stick im POLICY-Modus wirklich führen kann.
      if (t.ctrlMode === 'none') {
        t.ctrlMode = 'joy';
        const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
        if (rec) { rec.ctrl = 'joy'; putClip(rec).catch(() => {}); }
        syncCtrlChips();
      }
    } else {
      // v2.16.0: Drohnen-Lehrpfad lösen — die Drohne fliegt auf Stick/Gait
      t.pathOn = false; t.pathClip = null;
    }
    const at = document.getElementById('animTrainToggle');
    if (at) at.checked = false;
    syncRefChips();
    if (S.parallel) S.parallel.envCfg = parallelEnvCfg(); // Worker sofort umstellen (v2.16.0)
    log('ANIMATION GELÖST — die Policy trainiert WEITER (Kommandogang: das Gehen bleibt erhalten, Fahrbefehle/Stick führen; nur Balance & Freibewegung werden nachtrainiert). Netz, Norm-Statistik und Policy-Slot bleiben erhalten — der Aktions-Anker ist seit v2.16.0 animations-unabhängig, die Policy ist NICHT mehr an die Animation gebunden.', 'ok');
    ui.toast('Animation gelöst — trainiert ohne weiter', false, 3000);
  });
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
    if (S.parallel) S.parallel.envCfg = parallelEnvCfg(); // v2.16.0: sofort an Worker
    log(animT.checked
      ? 'Animation im Training: AN — Posen-Tracking aktiv (20 % der Episoden laufen trotzdem ohne — die Policy bleibt unabhängig)'
      : 'Animation im Training: AUS — Kommandogang ohne GLB (Fahrbefehle führen; Gehen/Balance bleiben erhalten, nichts wird neu angefangen)', 'warn');
    ui.toast(animT.checked ? 'Animation im Training an' : 'Nur Gleichgewicht lernen');
  });
  // ── Geist & Original getrennt (v2.24.0) ────────────────
  // Geist = cyanfarbener Roboter mit der retargeteten Referenz (= was
  // trainiert wird). Original = Mesh der Quelldatei (nur Deko, Standard AUS
  // — Nutzerwunsch „3D-Mesh weg, nur den Geist lassen").
  document.getElementById('ghostToggle').addEventListener('change', (e) => {
    S.ghostOn = e.target.checked;
    applyGhosts();
    log(S.ghostOn ? 'Geist AN — der cyanfarbene Roboter zeigt die trainierte Referenzbewegung'
      : 'Geist AUS — nur der echte Roboter', 'warn');
  });
  const srcTog = document.getElementById('srcShowToggle');
  if (srcTog) srcTog.addEventListener('change', (e) => {
    S.srcShow = e.target.checked;
    try { localStorage.setItem('tr_srcShow', S.srcShow ? '1' : '0'); } catch (err) { /* voll */ }
    applyGhosts();
    log(S.srcShow ? 'Original-Lehrer AN — Quelldatei (Mesh) läuft mit'
      : 'Original-Lehrer AUS — nur der Geist zeigt, was trainiert wird', 'warn');
    ui.toast(S.srcShow ? 'Original-Lehrer an' : 'Nur Geist (Standard)');
  });

  refreshClipList().catch(() => { /* IDB evtl. gesperrt */ });
}

// ── GLB: Import, Liste, Aktivierung, BC ────────────────────
// Universell: GLB von beliebiger Quelle (Mixamo, Cartwheel, Unity,
// Unreal, VRM …) — das Retargeting erkennt das Skelett automatisch
// (Alias-Tabelle + Heuristik). v2.15.0: Import aus JEDEM Roboter-View —
// das Ziel ist der AKTUELLE Roboter (G1: Beine+Arme, MicroDuck: Beine,
// Drohne: Flugbahn); andere Roboter werden on-demand nachretargetet.
// ALLE Animationen einer Datei werden importiert (Hart-Limit 8).

// ══ v2.24.0 — Geist / Original getrennt ═════════════════════
// Geister gemäß den beiden Toggles aufbauen/abbauen. Der Roboter-Geist
// (cyan) zeigt die retargetete Referenz = EXAKT was trainiert wird. Das
// Original-Mesh (Lehrer) ist reine Deko und standardmäßig ausgeblendet —
// die Szene wird erst LAZY gebaut, wenn der Nutzer es einschaltet.
function applyGhosts() {
  if (!r3d) return;
  if (!S.ghostOn && !S.srcShow) { r3d.removeGhost(); r3d.removeSourceGhost(); return; }
  if (S.ghostOn) { if (S.sim && !S.sim.cfg.drone) r3d.buildGhost(S.sim); } else r3d.removeGhost();
  if (S.srcShow && S.motionClip) {
    r3d.buildSourceGhost(S.motionClip, S.srcScene || null);
    ensureSrcScene();
  } else {
    r3d.removeSourceGhost();
  }
}

// Original-GLB-Szene erst bauen, wenn sie wirklich angezeigt werden soll
function ensureSrcScene() {
  if (S.srcScene || !S.activeRecId) return;
  const rec = S.clips.find(r => r.id === S.activeRecId);
  if (!rec || !rec.glb) return;
  try {
    const c2 = new GlbClip(rec.glb);
    c2.useAnimation(rec.animIndex || 0);
    const pkg = buildGlbScene(c2);
    if (pkg) {
      S.srcScene = pkg;
      if (S.srcShow && S.motionClip && r3d) r3d.buildSourceGhost(S.motionClip, pkg);
      log('Original-Modell gebaut (' + pkg.meshCount + ' Meshes, ' + pkg.bones + ' Knochen) — zeigt die Quell-Animation');
    }
  } catch (e) {
    log('Original-Modell nicht darstellbar — Skelett-Lehrer aktiv (' + e.message + ')');
  }
}
async function onGlbFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  if (!S.sim) { ui.toast('Roboter lädt noch — kurz warten', true); return; }
  // v2.15.0: Import für den AKTUELLEN Roboter (G1: Beine+Arme+Taille,
  // MicroDuck: Beine, X2: Flugbahn). Weitere Roboter werden beim Aktivieren
  // bzw. beim Roboterwechsel on-demand nachretargetet.
  const target = S.robotId;
  log('GLB-Import für ' + (S.sim.cfg.name || target) + ' — Profil: ' + (target === 'g1' ? 'humanoid komplett' : target === 'duck' ? 'Beine (Kopf bleibt STAND)' : 'nur Flugbahn'));
  for (const f of files) {
    ui.$('glbStatus').textContent = 'Importiere ' + f.name + ' …';
    try {
      const buf = await f.arrayBuffer();
      const clip = new GlbClip(buf);
      const anims = clip.animations;
      log('GLB „' + f.name + '": ' + anims.length + ' Animation(en) — ' + anims.map(a => a.name + ' (' + a.duration.toFixed(1) + 's)').join(', '));
      const list = anims.slice(0, 8);
      let last = null, lastMotion = null;
      for (const an of list) {
        if (an.index > 0) clip.useAnimation(an.index);
        const motion = retargetToRobot(clip, S.sim, (m) => log('  ' + m));
        const packed = packMotion(motion);
        const rec = {
          id: 'glb_' + Date.now() + '_' + an.index + '_' + Math.floor(Math.random() * 1e4),
          name: f.name.replace(/\.glb$/i, '') + (anims.length > 1 ? ' · ' + an.name : ''),
          size: buf.byteLength,
          glb: an.index === 0 ? buf : null,
          animIndex: an.index,
          motion: target === 'g1' ? packed : undefined, // Legacy-Feld (G1)
          motionByRobot: { [target]: packed }, // v2.15.0: je Roboter eine Variante
        };
        await putClip(rec);
        log('Retargeting „' + rec.name + '": ' + motion.n + ' Frames × ' + motion.nu + ' Kanäle, ' + motion.duration.toFixed(1) + 's — Boden angepasst', 'ok');
        last = rec; lastMotion = motion;
        await new Promise(r => setTimeout(r, 0)); // UI-Frame
      }
      await refreshClipList();
      ui.$('glbStatus').textContent = (list.length > 1 ? list.length + ' Animationen importiert — letzte: ' : '') + (last ? last.name + ': ' + lastMotion.duration.toFixed(1) + 's @ ' + lastMotion.fps + ' fps bereit' : 'bereit');
      ui.toast('GLB importiert: ' + (last ? last.name : f.name));
    } catch (err) {
      console.error(err);
      log('GLB-Fehler: ' + err.message, 'err');
      ui.$('glbStatus').textContent = 'Fehler: ' + err.message;
      ui.toast('GLB-Import fehlgeschlagen: ' + err.message, true, 4000);
    }
  }
}

// ═══ v2.22.0 „ARDY-BRÜCKE“: QPOS-CSV-Import (NVIDIA ARDY — Text→Motion)
// ═══ ARDY läuft OHNE eigenes CUDA auf einer kostenlosen Cloud-GPU
// ═══ (Colab — Notebook: scripts/ardy_colab.ipynb im Repo). Die G1-QPOS-CSV
// ═══ (36 Spalten: root+Quat+29 Gelenke — Gelenkliste identisch zur App)
// ═══ wird direkt zum Lehrer-Clip: Geist, BC, PPO-Motion-Tracking,
// ═══ MOTION-KI-Wiedergabe — genau wie GLB, nur ohne Retargeting.
// ── v2.25.0 — ARDY Mini AUF DEM GERÄT (Text → Motion) ─────────
// Nutzerwunsch: „Du solltest dieses model benutzen wie hier
// https://huggingface.co/spaces/intsuc/ardy-mini" — das Modell
// intsuc/Llama-3-ARDY-Mini-Core40-Browser läuft wie im Space mit
// onnxruntime-web DIREKT im Gerät (WebGPU, Fallback WASM): erster
// Einsatz lädt die Modell-Dateien von Hugging Face (einmalig,
// Cache Storage), danach funktioniert Text→Bewegung OFFLINE.
// Die cskel27-Weltposen (27 Gelenke, Mixamo-Namen) laufen über
// ArdyClip → retargetToG1 → normaler Lehrer-Clip (Belohnung-only,
// nie Policy-Input — wie alle Referenzen). Kein Colab, keine CSV.
function initArdy() {
  const chipsEl = document.getElementById('ardyChips');
  const promptEl = document.getElementById('ardyPrompt');
  const genBtn = document.getElementById('ardyGenerate');
  const barEl = document.getElementById('ardyBar');
  const fillEl = document.getElementById('ardyBarFill');
  const statusEl = document.getElementById('ardyStatus');
  const durEl = document.getElementById('ardyDur');
  const seedEl = document.getElementById('ardySeed');
  const cfgEl = document.getElementById('ardyCfg');
  const epEl = document.getElementById('ardyEp');
  // v2.26.0: eigenes Panel — Modell-Download, Live-%, Stop, Trainings-%
  const dlBtn = document.getElementById('ardyDl');
  const dlPctEl = document.getElementById('ardyDlPct');
  const pctEl = document.getElementById('ardyPct');
  const genEl = document.getElementById('ardyGen');
  const stopBtn = document.getElementById('ardyStop');
  const liveEl = document.getElementById('ardyLive');
  const goalEl = document.getElementById('ardyTrainGoal');
  const trainInfoEl = document.getElementById('ardyTrainInfo');
  if (!chipsEl || !genBtn) return;

  const setBar = (pct) => {
    if (pct === null) { barEl.classList.add('hidden'); fillEl.style.width = '0%'; return; }
    barEl.classList.remove('hidden');
    fillEl.style.width = Math.round(pct * 100) + '%';
  };
  const fmtMB = (n) => (n / 1048576).toFixed(0) + ' MB';
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ── Trainings-Ziel (Schritte) — persistent, default 1.000.000 ──
  S.ardyTrainGoal = parseInt(localStorage.getItem('tr_tgoal') || '1000000', 10) || 1000000;
  if (goalEl) {
    goalEl.value = S.ardyTrainGoal;
    goalEl.addEventListener('change', () => {
      const v = parseInt(goalEl.value, 10);
      if (Number.isFinite(v) && v >= 10000) {
        S.ardyTrainGoal = v;
        localStorage.setItem('tr_tgoal', String(v));
        ui.toast('Trainings-Ziel: ' + fmtInt(v) + ' Schritte');
      } else { goalEl.value = S.ardyTrainGoal; }
    });
  }

  // ── Modell-Download: Gesamt-Prozent über gewichtete Stufen ──
  const DL_W = { ort: 3, manifest: 0.2, tokenizer: 1.5, text_encoder: 22, denoiser: 56, decoder: 38 };
  let dlState = {};
  const dlPercent = (p) => {
    if (p && p.stage in DL_W) dlState[p.stage] = { got: p.completed, total: p.total };
    let done = 0, all = 0;
    for (const st of Object.keys(DL_W)) {
      all += DL_W[st];
      const stt = dlState[st];
      if (stt) done += DL_W[st] * (stt.total > 1 ? Math.min(1, stt.got / stt.total) : (stt.got >= 1 ? 1 : 0));
    }
    return all ? done / all : 0;
  };

  for (const a of BASIS_ANIMS) {
    const chip = document.createElement('button');
    chip.className = 'ardy-chip';
    chip.textContent = a.label;
    chip.title = a.prompt;
    chip.addEventListener('click', () => {
      controls.buzz();
      promptEl.value = a.prompt;
      runArdy(a.prompt, a.label);
    });
    chipsEl.appendChild(chip);
  }

  (async () => {
    try {
      const caps = await ardyCapabilities();
      epEl.textContent = caps.webgpu ? (caps.shaderF16 ? 'WebGPU · fp16' : 'WebGPU · fp32') : 'CPU (WASM) — langsam';
    } catch (e) { epEl.textContent = '—'; }
  })();

  async function ensureRuntime(mode) {
    if (S.ardyRuntime) return S.ardyRuntime;
    const downloading = mode === 'dl';
    statusEl.textContent = downloading
      ? 'Download läuft … (~650 MB, einmalig — danach offline)'
      : 'Lade ARDY … (Modell wird einmalig geladen und gecacht)';
    const rt = await loadArdyRuntime({
      onProgress: (p) => {
        if (p.stage === 'denoising') {
          statusEl.textContent = 'Denoising ' + p.completed + '/' + p.total + ' (Fenster)';
          setBar(p.completed / p.total);
        } else if (p.stage === 'decoding') {
          statusEl.textContent = 'Decodieren … Frame ' + (p.frame || 0);
          setBar(0.97);
        } else if (p.stage === 'encoding-text') {
          statusEl.textContent = 'Text kodieren …';
        } else if (p.stage === 'manifest' && p.total <= 1) {
          statusEl.textContent = 'Manifest …';
        } else {
          const dp = dlPercent(p);
          if (downloading && dlPctEl) dlPctEl.textContent = Math.round(dp * 100) + ' %';
          if (p.stage === 'denoiser' || p.stage === 'text_encoder' || p.stage === 'decoder' || p.stage === 'tokenizer' || p.stage === 'ort' || p.stage === 'manifest') {
            if (p.total > 1) {
              statusEl.textContent = 'Download ' + Math.round(dp * 100) + ' % — ' + p.stage + ' ' + fmtMB(p.completed) + ' / ' + fmtMB(p.total);
              setBar(dp);
            } else if (p.message) {
              statusEl.textContent = p.stage + ': ' + p.message;
            }
          }
        }
      },
    });
    S.ardyRuntime = rt;
    dlState = {};
    if (dlPctEl) dlPctEl.textContent = '100 %';
    if (dlBtn) { dlBtn.textContent = '✓ Modell bereit'; dlBtn.disabled = true; }
    statusEl.textContent = 'ARDY Mini bereit (' + rt.epName.toUpperCase() + ' · ' + rt.fps + ' FPS · ' + rt.jointNames.length + ' Gelenke) — ab jetzt offline nutzbar.';
    log('ARDY Mini geladen (' + rt.epName + ') — Modell intsuc/Llama-3-ARDY-Mini-Core40-Browser, läuft ab jetzt auf dem Gerät', 'ok');
    return rt;
  }

  async function runArdy(promptRaw, label) {
    if (S.ardyBusy) { ui.toast('Generierung läuft schon', true); return; }
    const prompt = deToEn(promptRaw || promptEl.value || '').trim();
    if (!prompt) { ui.toast('Prompt eingeben oder Chip wählen', true); return; }
    promptEl.value = prompt;
    if (!S.sim) { ui.toast('Roboter lädt noch — kurz warten', true); return; }
    if (S.robotId !== 'g1') {
      ui.toast('ARDY Mini erzeugt humanoides Motion — bitte zuerst den G1 wählen', true, 4000);
      log('ARDY-Mini abgelehnt: cskel27 → G1-Retargeting, anderer Roboter aktiv', 'warn');
      return;
    }
    S.ardyBusy = true;
    genBtn.disabled = true;
    const oldLabel = genBtn.textContent;
    genBtn.textContent = '…';
    if (stopBtn) stopBtn.disabled = false;
    if (pctEl) pctEl.textContent = '0 %';
    S.ardyAbort = new AbortController();
    try {
      const rt = await ensureRuntime();
      const seedRaw = seedEl.value.trim();
      const seed0 = seedRaw ? (Number.isFinite(parseInt(seedRaw, 10)) ? parseInt(seedRaw, 10) : seedRaw) : undefined;
      const cfg = parseFloat(cfgEl.value);
      const seconds = parseFloat(durEl.value) || 5;
      const liveOn = liveEl ? !!liveEl.checked : false;
      log('ARDY Mini: „' + prompt + '“ — ' + seconds + ' s' + (seed0 !== undefined ? ' · Seed ' + seed0 : '') + (Number.isFinite(cfg) ? ' · CFG ' + cfg : '') + (liveOn ? ' · LIVE-Steuerung an' : ''));
      // v2.28.3 AUTO-RETRY: kollabiert oder instabil (NaN/Reparatur) EIN Versuch,
      // wird automatisch mit neuem Seed erneut generiert (bis 3 Versuche) — das
      // BESTE Ergebnis wird übernommen. Der Nutzer sieht keinen Geist-Haufen
      // mehr (Screenshot 2026-09-21), nur eine klare Meldung, falls ALLE
      // Versuche kippen. Schwellen: unverändert v2.28.1-Kollaps-Warnung.
      const ARDY_MAX_ATTEMPTS = 3;
      let best = null, attemptsUsed = 0;
      for (let attempt = 1; attempt <= ARDY_MAX_ATTEMPTS; attempt++) {
        attemptsUsed = attempt;
        const useSeed = attempt === 1 ? seed0 : (typeof seed0 === 'number' ? seed0 + attempt * 101 : undefined);
        if (attempt > 1) {
          const why = best && best.q && best.q.collapsed ? 'kollabiert' : 'instabil (Decoder)';
          log('ARDY Mini: Versuch ' + attempt + '/' + ARDY_MAX_ATTEMPTS + ' mit neuem Seed' + (useSeed !== undefined ? ' ' + useSeed : ' (zufällig)') + ' — vorheriger Versuch ' + why);
          statusEl.textContent = 'Neuer Versuch ' + attempt + '/' + ARDY_MAX_ATTEMPTS + ' …';
          setBar(0);
          if (pctEl) pctEl.textContent = '0 %';
        }
        const out = await rt.generate({
          prompt, seconds,
          seed: useSeed, cfgWeight: Number.isFinite(cfg) ? cfg : undefined,
          signal: S.ardyAbort.signal,
          // v2.26.0: LIVE — Prompt-Feld wird an jedem Fensteranfang gelesen;
          // eine Änderung lenkt die laufende Bewegung sofort um.
          getLivePrompt: liveOn ? () => deToEn(promptEl.value || '').trim() : undefined,
          onProgress: (p) => {
            if (p.stage === 'denoising') {
              const frac = p.total > 0 ? p.completed / p.total : 0;
              statusEl.textContent = 'Denoising ' + p.completed + '/' + p.total;
              setBar(frac);
              if (pctEl) pctEl.textContent = Math.round(frac * 100) + ' %';
              if (genEl) genEl.textContent = 'Fenster ' + Math.ceil(p.completed / Math.max(1, p.total / Math.max(1, Math.ceil(seconds * rt.fps / 16)))) + '/' + Math.ceil(seconds * rt.fps / 16);
            } else if (p.stage === 'decoding') {
              statusEl.textContent = 'Decodieren … Frame ' + (p.frame || 0);
              setBar(0.97);
              if (pctEl) pctEl.textContent = '99 %';
            } else if (p.stage === 'encoding-text') {
              statusEl.textContent = 'Text kodieren … (Live-Prompt möglich)';
            }
          },
        });
        log('ARDY Mini: ' + out.frameCount + ' Frames @ ' + out.fps + ' FPS (' + out.duration.toFixed(1) + ' s)' + (out.promptsLive ? ' · Live umgelenkt auf „' + out.promptsLive + '“' : '') + ' — Retargeting cskel27 → G1 …');
        statusEl.textContent = 'Retargeting auf G1 …';
        const clip = new ArdyClip(out);
        const motion = retargetToG1(clip, S.sim, (m) => log('  ' + m));
        const q = ardyMotionQuality(motion, out.sanity, out.frameCount); // v2.28.3
        if (!best || q.score > best.q.score) best = { out, motion, q };
        if (!q.bad) break;
        log('ARDY Mini: Versuch ' + attempt + ' verworfen (' + (q.collapsed ? 'kollabiert, Hüftenhöhe ' + q.hMin.toFixed(2) + '–' + q.hMax.toFixed(2) + ' m' : 'instabile Decoder-Ausgabe — Sanitizer hätte eingreifen müssen') + ')', 'warn');
      }
      const out = best.out, motion = best.motion;
      if (attemptsUsed > 1 && !best.q.bad) log('ARDY Mini: sauberes Ergebnis nach ' + attemptsUsed + ' Versuchen — übernommen', 'ok');
      // v2.28.2 SANITY-MELDUNG: der Sanitizer hat NaN-Frames gehalten /
      // Knochenlängen repariert — dem Nutzer KLAR sagen (trennt App-Fix
      // von Modell-Ausreißer) statt still weiterzuarbeiten.
      if (out.sanity && out.frameCount > 0 && (out.sanity.nanFrames > 0 || out.sanity.fixedFrames > out.frameCount * 0.15)) {
        log('ARDY-Warnung: instabile Decoder-Ausgabe automatisch repariert (NaN-Frames ' + out.sanity.nanFrames + ', reparierte Frames ' + out.sanity.fixedFrames + '/' + out.frameCount + ', max. Knochenfehler ' + Math.round(out.sanity.maxBoneErr * 100) + ' %) — bitte anderen Prompt oder Seed probieren', 'warn');
        ui.toast('Generierung instabil — automatisch repariert', true, 4500);
      }
      const name = (label ? 'ARDY · ' + label : 'ARDY · ' + prompt.slice(0, 24)) + ' (KI)';
      const packed = packMotion(motion);
      // v2.28.1/3 KOLLAPS-MELDUNG: kollabiert die BESTE Generierung immer
      // noch (ARDY Mini ist autoregressiv — lange/unübliche Prompts können
      // kollabieren, Auto-Retry hat es schon 2× probiert), sage es KLAR.
      if (best.q.collapsed) {
        log('ARDY-Warnung: die generierte Bewegung kollabiert (Hüftenhöhe ' + best.q.hMin.toFixed(2) + '–' + best.q.hMax.toFixed(2) + ' m, ' + attemptsUsed + ' Versuche) — bitte anderen Prompt probieren', 'warn');
        ui.toast('Bewegung kollabiert — anderen Prompt probieren', true, 4500);
      }
      const rec = {
        id: 'ardy_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name,
        size: out.frameCount * 27 * 3 * 4,
        glb: null,               // keine Mesh-Datei → nie Re-Retarget
        animIndex: 0,
        src: 'ardy',             // auf dem Gerät generiert
        ctrl: 'joy',             // v2.28.1: Geist-lenk-Standard (Stick fährt die Referenz)
        prompt: out.promptsLive || prompt,
        seed: out.seed,
        motion: packed,
        motionByRobot: { g1: packed }, // v2.15.0-Konvention
      };
      await putClip(rec);
      await refreshClipList();
      await activateClip(rec);
      statusEl.textContent = 'Fertig: „' + name + '“ — ' + out.duration.toFixed(1) + ' s als Referenz aktiv.';
      setBar(null);
      if (pctEl) pctEl.textContent = '100 %';
      if (genEl) genEl.textContent = 'fertig';
      ui.toast('KI-Bewegung bereit: ' + name);
      log('ARDY-Mini-Bewegung „' + name + '“ gespeichert und aktiviert — ' + motion.n + ' Frames × ' + motion.nu + ' Gelenke', 'ok');
    } catch (err) {
      console.error(err);
      const aborted = err && err.name === 'AbortError';
      const msg = err && err.message ? err.message : String(err);
      statusEl.textContent = aborted ? 'Abgebrochen — Modell bleibt geladen, nichts gespeichert.' : 'Fehler: ' + msg;
      setBar(null);
      if (pctEl) pctEl.textContent = '—';
      if (genEl) genEl.textContent = 'bereit';
      if (!aborted) {
        log('ARDY-Mini-Fehler: ' + msg, 'err');
        ui.toast('ARDY Mini fehlgeschlagen: ' + msg, true, 5000);
      } else {
        log('ARDY-Mini-Generierung abgebrochen (Stop)', 'warn');
      }
    } finally {
      S.ardyBusy = false;
      S.ardyAbort = null;
      genBtn.disabled = false;
      genBtn.textContent = oldLabel;
      if (stopBtn) stopBtn.disabled = true;
    }
  }

  genBtn.addEventListener('click', () => { controls.buzz(); runArdy(); });
  promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); controls.buzz(); runArdy(); } });
  if (stopBtn) stopBtn.addEventListener('click', () => {
    controls.buzz();
    if (S.ardyAbort) { S.ardyAbort.abort(); ui.toast('ARDY-Generierung gestoppt'); }
  });
  if (dlBtn) dlBtn.addEventListener('click', async () => {
    controls.buzz();
    if (S.ardyBusy) { ui.toast('Generierung läuft schon', true); return; }
    if (S.ardyRuntime) { ui.toast('Modell ist schon geladen'); return; }
    dlBtn.disabled = true;
    const old = dlBtn.textContent;
    dlBtn.textContent = '…';
    try { await ensureRuntime('dl'); }
    catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      statusEl.textContent = 'Download-Fehler: ' + msg;
      if (dlPctEl) dlPctEl.textContent = '—';
      setBar(null);
      log('ARDY-Download-Fehler: ' + msg, 'err');
      ui.toast('Modell-Download fehlgeschlagen: ' + msg, true, 5000);
    } finally {
      dlBtn.disabled = !!S.ardyRuntime;
      dlBtn.textContent = S.ardyRuntime ? '✓ Modell bereit' : old;
    }
  });
  document.getElementById('ardyCacheClear').addEventListener('click', async () => {
    controls.buzz();
    await clearArdyCache();
    S.ardyRuntime = null;
    if (dlBtn) { dlBtn.textContent = '⬇ Modell herunterladen'; dlBtn.disabled = false; }
    if (dlPctEl) dlPctEl.textContent = '—';
    statusEl.textContent = 'Cache gelöscht — Modell wird beim nächsten Einsatz neu geladen.';
    ui.toast('ARDY-Cache gelöscht');
  });

  // ── v2.27.0: MODELL-IMPORT ÜBER DEN DATEIMANAGER ────────
  // Der HF-Download schlägt auf manchen Geräten fehl. Stattdessen öffnet
  // „📁 Vom Gerät wählen“ den ANDROID-DATEIMANAGER; der Nutzer wählt die
  // Modell-Dateien (z. B. vorher per PC auf das Handy kopiert), die native
  // Brücke kopiert sie ins App-Verzeichnis (mit Fortschritt) und die App
  // lädt sie ab sofort same-origin von dort — ohne Hugging Face.
  const impBtn = document.getElementById('ardyImport');
  if (impBtn) impBtn.addEventListener('click', () => {
    controls.buzz();
    const B = window.TrainrobotBridge;
    if (!B || typeof B.ardyPickModel !== 'function') {
      ui.toast('Dateimanager-Import nur in der App verfügbar', true);
      return;
    }
    // Rückrufe der nativen Brücke (Kopier-Fortschritt je Datei + Fertigmeldung)
    window.__ardyImportProgress = (name, got) => {
      if (statusEl) statusEl.textContent = 'Importiere ' + name + ' … ' + (got / 1048576).toFixed(0) + ' MiB';
      if (dlPctEl) dlPctEl.textContent = '…';
      if (dlBtn) dlBtn.disabled = true;
    };
    window.__ardyImportDone = async (ok, msg) => {
      refreshArdyImports();
      const sum = ardyImportSummary();
      if (!ok) {
        if (statusEl) statusEl.textContent = 'Import: ' + (msg || 'abgebrochen') + ' — Dateien fehlen? (fp16-Ordner: model.json.gz + tokenizer.json.gz + 3× .onnx.gz)';
        if (dlBtn) dlBtn.disabled = !!S.ardyRuntime;
        return;
      }
      if (statusEl) statusEl.textContent = msg + ' (' + sum.count + ' Dateien, ' + sum.mib + ' MiB) — ARDY Mini wird geladen …';
      try {
        await ensureRuntime();
        log('ARDY-Modell vom Gerät importiert und geladen (' + sum.count + ' Dateien, ' + sum.mib + ' MiB) — läuft ab jetzt ohne Hugging Face', 'ok');
      } catch (err) {
        const m = err && err.message ? err.message : String(err);
        if (statusEl) statusEl.textContent = 'Import ok, aber Laden fehlgeschlagen: ' + m + ' — fehlt eine Datei? (5 Dateien: model.json.gz, tokenizer.json.gz, text_encoder/denoiser/decoder .onnx.gz)';
        log('ARDY-Import-Ladefehler: ' + m, 'err');
      }
    };
    if (statusEl) statusEl.textContent = 'Dateimanager geöffnet — bitte Modell-Dateien wählen (fp16-Ordner: 5 Dateien) …';
    B.ardyPickModel();
  });
  // Beim Panel-Start: Import-Liste zeigen, falls schon Dateien vorhanden sind
  refreshArdyImports();
  {
    const impSum = ardyImportSummary();
    if (impSum.count > 0 && impBtn) {
      impBtn.textContent = '📁 Weitere Datei wählen (' + impSum.count + ')';
      if (statusEl) statusEl.textContent = impSum.count + ' Modell-Datei(en) vom Gerät (' + impSum.mib + ' MiB) — „Generieren“ lädt sie direkt von dort.';
    }
  }
}

// ── v2.27.0: GEIST LENKEN — Stick führt die Referenz, Roboter lernt ──
// Der cyanfarbene Geist hängt an LEBENDEN Roboter (folgt) und die Referenz-
// Wurzel folgt dem Stick (ctrlMode joy): der Nutzer „fährt“ den Geist und
// der Roboter lernt die gefahrene Route per Motion-Belohnung. Die Animation
// bleibt wie immer REIN BELohnung (AMP/DeepMimic) — NIE Netzwerk-Eingabe.
function wireArdyGhostDrive() {
  const gdBtn = document.getElementById('ardyGhostDrive');
  if (!gdBtn) return;
  gdBtn.addEventListener('click', () => {
    controls.buzz();
    const t = S.task;
    if (!t || t.kind !== 'motion' || !t.clip) {
      ui.toast('Erst eine Bewegung aktivieren — ARDY generieren oder Clip wählen', true);
      return;
    }
    // v2.28.0: TOGGLE — nochmal tippen schaltet zurück (frei + keine
    // Stick-Führung der Referenz).
    const on = !(t.refMode === 'folgt' && (t.ctrlMode === 'joy' || t.ctrlMode === 'btn'));
    if (on) {
      S.refMode = 'folgt';
      t.refMode = 'folgt';
      try { localStorage.setItem('tr_refmode_v1', 'folgt'); } catch (e) { /* voll */ }
      syncRefChips();
      if (t.ctrlMode !== 'joy' && t.ctrlMode !== 'btn') {
        t.ctrlMode = 'joy';
        syncCtrlChips();
      }
      // Referenz SOFORT an den Roboter legen (der Geist startet bei IHM,
      // nicht bei der Clip-Bahn) — dann führt der Stick sie weiter.
      try {
        const p = [0, 0, 0]; S.sim.basePos(p);
        t._tx = p[0]; t._ty = p[1];
        const q4 = [0, 0, 0, 0]; S.sim.baseQuat(q4);
        t._tyaw = Math.atan2(2 * (q4[0] * q4[3] + q4[1] * q4[2]), 1 - 2 * (q4[2] * q4[2] + q4[3] * q4[3]));
      } catch (e) { /* egal */ }
      if (!S.training) startTraining();
      log('GEIST LENKEN: der Stick fährt jetzt die REFERENZ (der cyanfarbene Geist folgt dem Stick, steht auf dem Boden) — der Roboter lernt die gefahrene Route per Motion-Belohnung. Animation ist NIE Eingabe, nur Reward.', 'ok');
      ui.toast('Geist folgt dem Stick — Roboter lernt die Route');
    } else {
      S.refMode = 'frei';
      t.refMode = 'frei';
      try { localStorage.setItem('tr_refmode_v1', 'frei'); } catch (e) { /* voll */ }
      syncRefChips();
      log('GEIST LENKEN aus — die Referenz läuft wieder die Clip-Bahn (frei).', 'warn');
      ui.toast('Geist lenken aus');
    }
    ui.toggleArdy(false);
  });
}

async function onCsvFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  if (!S.sim) { ui.toast('Roboter lädt noch — kurz warten', true); return; }
  if (S.robotId !== 'g1') {
    ui.toast('ARDY-QPOS ist ein G1-Skelett — bitte zuerst den G1 wählen', true, 4000);
    log('ARDY-CSV abgelehnt: aktuell ist nicht der G1 aktiv (Skelett passt nur zum G1)', 'warn');
    return;
  }
  for (const f of files) {
    ui.$('glbStatus').textContent = 'Importiere ' + f.name + ' …';
    try {
      const text = await f.text();
      const motion = parseQposCsv(text, { name: f.name.replace(/\.csv$/i, '') });
      const packed = packMotion(motion);
      const rec = {
        id: 'qpos_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name: motion.name + ' (ARDY)',
        size: f.size,
        glb: null,               // kein GLB → nie Re-Retarget
        src: 'qpos',
        motion: packed,          // gepackt — wie beim GLB-Pfad (Legacy-Feld, G1)
        motionByRobot: { g1: packed },
      };
      await putClip(rec);
      log('ARDY-Referenz importiert: ' + rec.name + ' — ' + motion.n + ' Frames × ' + motion.nu +
        ' Gelenke @ ' + motion.fps + ' fps (' + motion.duration.toFixed(1) + 's, Tempo ' +
        motion.meanSpeed.toFixed(2) + ' m/s) — 1:1-Mapping, kein Retargeting nötig', 'ok');
      ui.$('glbStatus').textContent = 'ARDY-Clip bereit: ' + rec.name + ' (' + motion.duration.toFixed(1) + 's)';
      ui.toast('ARDY-Motion importiert: ' + rec.name + ' — jetzt „Referenz“ antippen');
    } catch (err) {
      console.error(err);
      log('ARDY-CSV-Fehler: ' + err.message, 'err');
      ui.$('glbStatus').textContent = 'Fehler: ' + err.message;
      ui.toast('ARDY-Import fehlgeschlagen: ' + err.message, true, 5000);
    }
  }
  await refreshClipList();
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

// v2.15.0: Referenz-Modus-Chips syncen
function syncRefChips() {
  for (const x of document.querySelectorAll('.ref-chip')) x.classList.toggle('active', x.dataset.ref === S.refMode);
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

    // v2.24.0: Zeile zeigt, WIE der Clip ist — Dauer · Frames · fps · Root-Weg.
    // Tippen auf Name/Meta/Chevron klappt die Detail-Liste auf (Ablauf,
    // Root-Bahn, Lehrer-Pose, assimp, Steuerung, Buttons, Größe, Status …).
    const name = document.createElement('span');
    name.className = 'glb-clip-name';
    name.textContent = rec.name;
    const meta = document.createElement('span');
    meta.className = 'glb-clip-meta';
    meta.textContent = clipMetaText(rec);
    const chev = document.createElement('span');
    chev.className = 'glb-clip-chevron';
    chev.textContent = '▾';
    const det = buildClipDetails(rec, active);
    const toggleDet = () => {
      det.classList.toggle('hidden');
      row.classList.toggle('open');
    };
    name.addEventListener('click', toggleDet);
    meta.addEventListener('click', toggleDet);
    chev.addEventListener('click', toggleDet);

    // v2.15.0: neue Records tragen motionByRobot (je Roboter) — rec.motion
    // kann fehlen. Für die Meta-Zeile genügt irgendeine Variante.
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
    row.append(name, meta, chev, use, del, det);
    list.appendChild(row);
  }
}

// Irgendeine Motion-Variante des Records (rec.motion oder je-Roboter-Map)
function clipMotionAny(rec) {
  return rec.motion
    || (rec.motionByRobot ? Object.values(rec.motionByRobot)[0] : null)
    || { duration: 0, n: 0 };
}

// Kompakt-Meta: „12,3s · 370F · 30fps · 4,2m" (Root-Weg nur bei Root-Motion)
function clipMetaText(rec) {
  const m = clipMotionAny(rec);
  const parts = [(m.duration || 0).toFixed(1).replace('.', ',') + 's', (m.n || 0) + 'F'];
  if (m.fps) parts.push(Math.round(m.fps) + 'fps');
  const dist = rootPathLength(m);
  if (dist !== null) parts.push(dist.toFixed(1).replace('.', ',') + 'm');
  return parts.join(' · ');
}

// Root-Bahnlänge in Metern (Summe der Teilstrecken) oder null (In-place)
function rootPathLength(m) {
  if (!m.root || !m.yaw || !m.n || m.root.length < 2 * m.n) return null;
  let d = 0;
  for (let i = 1; i < m.n; i++) {
    const dx = m.root[2 * i] - m.root[2 * (i - 1)];
    const dy = m.root[2 * i + 1] - m.root[2 * (i - 1) + 1];
    d += Math.hypot(dx, dy);
  }
  return d;
}

// Detail-Zeilen pro Clip („zeige wie die Clips sind")
function buildClipDetails(rec, active) {
  const m = clipMotionAny(rec);
  const rows = [];
  const add = (k, v, hi) => rows.push({ k, v, hi });
  const ctrlLabel = rec.ctrl === 'joy' ? 'Joystick (Training: Zufalls-Fahrbefehle · POLICY: Stick)'
    : rec.ctrl === 'btn' ? 'Buttons (Joystick + Aktionstasten)'
    : 'Keine (reine Referenzbahn)';
  const dist = rootPathLength(m);
  add('Clip', rec.name);
  if (rec.animIndex) add('Animation #' + rec.animIndex, 'aus einer Mehr-Anim-Datei');
  add('Ablauf', (m.n || 0) + ' Frames × ' + (m.nu || 0) + ' Gelenke @ ' + (m.fps ? Math.round(m.fps) + ' fps' : '?') + ' → ' + (m.duration || 0).toFixed(2).replace('.', ',') + 's, Endlosschleife');
  add('Root-Bahn', dist !== null ? dist.toFixed(1).replace('.', ',') + ' m Wegstrecke (Lehrer läuft durchs Feld)' : 'In-place (Bewegung auf der Stelle)');
  add('Lehrer-Pose', m.srcPos && m.srcJoints ? m.srcJoints.length + ' Quell-Gelenke erfasst' : 'keine Quell-Posen');
  if (m.mergedFrom) add('assimp', m.mergedFrom + ' Fragmente zusammengeführt');
  if (rec.motionByRobot) add('Varianten', Object.keys(rec.motionByRobot).join(', ') + ' (je Roboter retargetet)');
  add('Steuerung', ctrlLabel, !!rec.ctrl && rec.ctrl !== 'none');
  add('Buttons', Array.isArray(rec.buttons) && rec.buttons.length ? rec.buttons.join(', ') : '—', !!(rec.buttons && rec.buttons.length));
  add('Gelernt', m.locomotion === false ? 'In-place-Task' : 'Locomotion (Root folgt der Bahn)');
  if (rec.size) add('Dateigröße', (rec.size / 1048576).toFixed(1).replace('.', ',') + ' MB');
  add('Status', (active ? 'AKTIV — wird trainiert' : 'bereit') + (policyExistsForClip(rec.id) ? ' · Policy gespeichert' : ''), active);
  const det = document.createElement('div');
  det.className = 'glb-clip-details hidden';
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'glb-cd-row';
    const k = document.createElement('span');
    k.className = 'glb-cd-k';
    k.textContent = r.k;
    const v = document.createElement('span');
    v.className = 'glb-cd-v' + (r.hi ? ' hi' : '');
    v.textContent = r.v;
    line.append(k, v);
    det.appendChild(line);
  }
  return det;
}

async function activateClip(rec) {
  if (!S.sim) { ui.toast('Roboter lädt noch — kurz warten', true); return; }
  stopTraining(true);
  S.activeRecId = rec.id; // aktiver Clip-Datensatz (für Steuerungs-Wahl, v2.5.0)
  // v2.15.0: JE-ROBOTER-VARIANTE wählen — fehlt sie (Clip wurde für einen
  // anderen Roboter importiert), wird sie JETZT aus der GLB-Datei retargetet.
  let packed = rec.motionByRobot ? rec.motionByRobot[S.robotId] : null;
  if (!packed && S.robotId === 'g1' && rec.motion) packed = rec.motion; // Legacy
  if (!packed && rec.glb) {
    try {
      const c2 = new GlbClip(rec.glb);
      c2.useAnimation(rec.animIndex || 0);
      const motion = retargetToRobot(c2, S.sim, (m) => log('  ' + m));
      packed = packMotion(motion);
      rec.motionByRobot = rec.motionByRobot || {};
      rec.motionByRobot[S.robotId] = packed;
      if (S.robotId === 'g1') rec.motion = packed;
      await putClip(rec); // gleiche id → überschreibt nur motion
      log('Erstmalig für ' + (S.sim.cfg.name || S.robotId) + ' retargetet: ' + motion.n + ' Frames × ' + motion.nu + ' Kanäle', 'ok');
    } catch (e) {
      log('Retargeting fehlgeschlagen: ' + e.message, 'err');
      ui.toast('GLB passt nicht zu diesem Roboter: ' + e.message, true, 3500);
      S.activeRecId = null;
      return;
    }
  }
  if (!packed) { ui.toast('Keine Animationsdaten für diesen Roboter', true); S.activeRecId = null; return; }
  S.motionClip = unpackMotion(packed);
  // v2.6.1 — AUTO-RE-RETARGET bei altem Algorithmus-Bestand (je Roboter):
  // Ist der gespeicherte Stand älter als RT_ALG UND die GLB-Datei liegt
  // noch im Record, wird für DIESEN Roboter einmal neu retargetet.
  if ((S.motionClip.alg || 0) < RT_ALG && rec.glb) {
    try {
      log('Bein-Algorithmus ist neuer als beim Import — „' + rec.name + '\u201c wird neu retargetet …');
      const c2 = new GlbClip(rec.glb);
      c2.useAnimation(rec.animIndex || 0);
      const motion = retargetToRobot(c2, S.sim, (m) => log('  ' + m));
      const packed2 = packMotion(motion);
      rec.motionByRobot = rec.motionByRobot || {};
      rec.motionByRobot[S.robotId] = packed2;
      if (S.robotId === 'g1') rec.motion = packed2;
      await putClip(rec);
      S.motionClip = unpackMotion(packed2);
      log('Neu retargetet: ' + motion.n + ' Frames × ' + motion.nu + ' Kanäle — Stand natürlich (v' + VERSION + ')', 'ok');
    } catch (e) {
      log('Neu-Retargeting fehlgeschlagen — alter Bestand bleibt (' + (e && e.message ? e.message : e) + ')', 'warn');
    }
  }
  // ── v2.28.1 BODEN-REPARATUR (Migration): vor der v2.28.0-Boden-Garantie
  // generierte Clips tragen ungeerdete srcPos (Skeleton hängt im Boden).
  // Beim Aktivieren je Frame erden und SOFORT PERSISTIEREN — der alte
  // Bestand ist danach dauerhaft repariert (ohne Re-Generierung).
  if (S.motionClip.srcPos && S.motionClip.srcJoints && S.motionClip.n) {
    try {
      const lifted = groundSrcPosTrack(S.motionClip.srcPos, S.motionClip.n, S.motionClip.srcJoints);
      if (lifted > 0) {
        const packedFix = packMotion(S.motionClip);
        rec.motionByRobot = rec.motionByRobot || {};
        rec.motionByRobot[S.robotId] = packedFix;
        if (S.robotId === 'g1') rec.motion = packedFix;
        await putClip(rec);
        log('Boden-Reparatur: ' + lifted + ' Frames des Lehrer-Skeletons auf den Boden gehoben (alter Bestand vor der Boden-Garantie)' + (rec.src === 'ardy' ? ' — für beste Posen-Qualität den Clip neu generieren' : ''));
      }
    } catch (e) { /* Reparatur ist rein visuell — kein Grund abzubrechen */ }
  }
  // v2.28.1 ARDY-OVERLAY: das grüne Skeleton gehört ZUM Geist (eine Figur).
  if (rec.src === 'ardy') S.motionClip.srcOverlay = true;
  // v2.28.1 GEIST-LENK-STANDARD für ARDY: der Nutzer erwartet, dass der
  // Stick SOFORT die ARDY-Referenz fährt („der Geist, was ARDY steuert").
  // Ohne gespeicherte Steuerungswahl gilt: ctrl 'joy' + refMode 'folgt'.
  // Explizite Chip-Wahlen (joy/btn/none) bleiben erhalten.
  if (rec.src === 'ardy') {
    if (rec.ctrl !== 'joy' && rec.ctrl !== 'btn' && rec.ctrl !== 'none') {
      rec.ctrl = 'joy';
      await putClip(rec).catch(() => {});
      log('Steuerung: JOYSTICK (Standard für ARDY) — der Stick fährt jetzt die Referenz; über die Steuer-Chips änderbar');
    }
    S.refMode = 'folgt';
    try { localStorage.setItem('tr_refmode_v1', 'folgt'); } catch (e) { /* voll */ }
  }
  // Lehrer-Ghost: v2.24.0 — der GEIST zeigt die trainierte Referenz;
  // das Original-Mesh wird nur gebaut, wenn der Nutzer „Original" einschaltet
  // (Standard AUS: „Mesh weg, nur den Geist" — spart RAM & Upload).
  // Drohne: nur Lehrer — der Dronen-Geist wäre statisch/irreführend.
  S.srcScene = null;
  applyGhosts();
  const modeInfo = ' · Referenz: ' + (({ stelle: 'AN EINER STELLE', folgt: 'AM ROBOTER GEANKERT', frei: 'FREI (Bahn ablaufen)' })[S.refMode] || 'FREI');
  if (S.sim.cfg.drone) {
    // ── v2.15.0: DROHNE — der Clip wird zum FLUGWEG (keine Gelenk-Pose);
    // der Hover-Task folgt der Bahn (Autopilot) via cmd.vx/alt/yaw.
    S.task = makeTaskFor(S.robotId, S.sim.cfg, S.sim);
    S.task.reset(new RNG(4242), S.sim);
    pluginHost.fireReset();
    S.obsBuf = new Float32Array(S.task.obsDim);
    S.actBuf = new Float32Array(S.task.actDim);
    S.trainer = loadPolicy(S.robotId);
    ui.policyAvailable(!!S.trainer);
    ui.$('stMode').textContent = 'PFAD';
    const rootInfo = S.motionClip.root ? ' · Root-Bahn aktiv (Drohne fliegt die Route des Lehrers)' : '';
    log('GLB-Lehrpfad aktiv: ' + rec.name + ' (' + S.motionClip.duration.toFixed(1) + 's, Endlosschleife)' + rootInfo + modeInfo + ' — Aufgabe: Pfadverfolgung', 'ok');
    ui.toast('Lehrpfad aktiv: ' + rec.name);
    refreshClipList().catch(() => {});
    return;
  }
  S.task = makeMotionTask(S.sim.cfg, S.motionClip, S.sim);
  wireTeacher(S.task); // v2.23.0: Lehrer-Belohnung (falls Datensatz da)
  // Steuerung + Animation-Status je Clip (v2.5.0, Buttons v2.6.0)
  S.task.ctrlMode = rec.ctrl === 'joy' || rec.ctrl === 'btn' ? rec.ctrl : 'none';
  S.task.buttons = Array.isArray(rec.buttons) ? rec.buttons.slice(0, 4) : [];
  S.task.animOn = S.animTraining;
  S.task.refMode = S.refMode;
  syncCtrlChips();
  syncBtnRow();
  renderClipButtons();
  syncRefChips();
  S.task.reset(new RNG(4242), S.sim); // platziert die Basis AUF der Bahn
  pluginHost.fireReset(); // v2.9.0
  S.obsBuf = new Float32Array(S.task.obsDim);
  S.actBuf = new Float32Array(S.task.actDim);
  S.trainer = loadPolicy(S.robotId);
  ui.policyAvailable(!!S.trainer);
  ui.$('stMode').textContent = 'GLB';
  const rootInfo = S.motionClip.root ? ' · Root-Bahn aktiv (' + ({ stelle: 'Referenz steht FIX am Startpunkt', folgt: 'Lehrer hängt am Roboter — kein Bahn-Zwang', frei: 'Roboter folgt dem wandernden Lehrer' })[S.refMode] + ')' : '';
  const mergeInfo = S.motionClip.mergedFrom ? ' [assimp: ' + S.motionClip.mergedFrom + ' Fragmente zusammengeführt]' : '';
  const ctrlInfo = S.task.ctrlMode === 'joy' ? ' · Steuerung: JOYSTICK (Training würfelt Fahrbefehle, POLICY-Modus: Stick)'
    : S.task.ctrlMode === 'btn' ? ' · Steuerung: BUTTONS (Training würfelt Fahrbefehle + Trigger, POLICY-Modus: Stick + Tasten unten)'
    : ' · Steuerung: keine (rein Referenzbahn)';
  const srcInfo = rec.src === 'qpos' ? 'ARDY-Referenz aktiv (Cloud-CSV)'
    : rec.src === 'ardy' ? 'ARDY-Mini-Referenz aktiv (auf dem Gerät generiert)'
    : 'GLB-Referenz aktiv';
  log(srcInfo + ': ' + rec.name + ' (' + S.motionClip.duration.toFixed(1) + 's, Endlosschleife)' + mergeInfo + rootInfo + ctrlInfo + ' — Aufgabe: Motion-Tracking' + (S.task.animOn ? '' : ' [ANIMATION AUS — nur Gleichgewicht]'), 'ok');
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
    get ardyTrainGoal() { return S.ardyTrainGoal; }, // v2.26.0: Trainings-Ziel sichtbar
    get joyMap() { return controls.joyMap; },
    get aiButtons() { return S.aiButtons; },
    get cruise() { return S.cruise; },
    get switching() { return S.switching; },
    doPush: (dir, strength) => doPush(dir, strength),
    setTrigger: (i) => S.task && S.task.kind === 'motion' ? S.task.setTrigger(i) : false,
    // v2.15.0: Referenz-Modi + Animation-lösen (Tests + KI)
    get refMode() { return S.refMode; },
    get motionInfo() {
      const rec = S.activeRecId ? S.clips.find(r => r.id === S.activeRecId) : null;
      return {
        active: !!S.activeRecId,
        clipRobot: S.motionClip ? S.motionClip.robotId : null,
        nu: S.motionClip ? S.motionClip.nu : null,
        variants: rec && rec.motionByRobot ? Object.keys(rec.motionByRobot) : [],
        taskKind: S.task ? S.task.kind : null,
        animOn: S.task && S.task.animOn !== undefined ? S.task.animOn : null,
      };
    },
    setRefMode: (m) => {
      if (!['stelle', 'frei', 'folgt'].includes(m)) return false;
      S.refMode = m;
      try { localStorage.setItem('tr_refmode_v1', m); } catch (e) { /* voll */ }
      if (S.task) { if (S.task.kind === 'motion') S.task.refMode = m; if (S.task.pathOn) S.task.refMode = m; }
      syncRefChips();
      return true;
    },
    unbindAnimation: () => { const b = document.getElementById('glbUnbind'); if (b) b.click(); return S.animTraining === false; },
    refreshClips: () => refreshClipList().catch(() => {}),
    // v2.8.0: Szenarien, Sturz-Modus, Werkstatt
    get scenario() { return scenarioOf(S.robotId); },
    get fallMode() { return S.fallMode; },
    setScenario: (s) => switchScenario(s),
    setFallMode: (m) => setFallMode(m),
    get drLevel() { return S.drLevel; },
    setDr: (l) => setDr(l),
    drActiveInfo: () => ({ level: S.drLevel, spec: drCfg(), modelRandomized: !!(S.sim && S.sim._drOrig) }),
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
    // v2.17.0: NETZ-CANVAS (Tests + tiefe KI-Integration)
    get canvas() { return S.canvasBoard; },
    canvasDescribe: () => S.canvasBoard ? S.canvasBoard.describe() : null,
    setCanvasMode: (on) => setCanvasMode(!!on),
    toggleCanvasSheet: (force) => toggleCanvasSheet(force),
    execTool: (tool, args) => execTool(tool, args || {}),
    // v2.21.0: MOTION-KI (Tests)
    setMotionKi: (on) => setMotionKi(!!on),
    nextMotionClip: () => nextMotionClip(),
    motionKiState: () => ({ on: S.motionKi.on, mix: S.motionKi.mix, ghostPaused: !!(S.task && S.task.ghostPaused), refMode: S.refMode }),
    ui,
  }),
});

wireUI();
boot();
