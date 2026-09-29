// ═══════════════════════════════════════════════════════════
// feld/feld.js — HAUPT-APP „Feld" (v3.0.0)
//
// Minimalistische Trainings-App: MuJoCo-WASM + MicroDuck,
// Policy = Soft-MoE-LLN, 3 Trainingsstufen, Belohnungssystem
// mit allen Reglern, Steuerkonsole (4 Buttons + 2 Joysticks),
// LAYA-Router (System 1) in Stufe 3, ONNX-Export/-Quantisierung
// mit CPU/GPU/NPU-Ausführung, Autosave + Import/Export.
// ═══════════════════════════════════════════════════════════

import { APP_NAME, VERSION } from './version.js';
import { initEngine, RobotSim, fetchModelIntoFS, writeWorldFile, hasModelInFS } from '../engine.js';
import { getRobot } from '../robots.js';
import { buildWorldXML } from '../worlds.js';
import { RNG } from '../math.js';
import { Renderer3D } from '../render3d.js';
import { FeldTrainer } from './trainer.js';
import { RewModel, RwxModel, RW_FIELDS, PRESETS, RWX_DEFS } from './rewards.js';
import { Console, BUTTONS } from './console.js';
import { CmdGen, CMD_MODES, CMD_MODE_LABELS } from './cmdgen.js';
import { SchubModel, SCHUB_DIR_LABELS } from './schubser.js'; // v3.2.0: AutoSchubser
import { GroundModel, GroundState, GROUND_MODE_LABELS, probeGravity, setGroundTilt, applyGroundImpulse } from './ground.js'; // v3.2.0: beweglicher Boden
import { PhoneModel, PhoneSensor, phonePush } from './phone.js'; // v3.2.0: Handy-Gyroskop
import { LayaRouter } from './laya.js';
import { moeToOnnx, createSession, selfTest, loadOrt, EP_MODES } from './onnxexport.js';
import * as store from './store.js';

// ── Zustand ────────────────────────────────────────────────
const S = {
  sim: null, task: null, trainer: null, renderer: null,
  rew: null, rwx: null, laya: null, konsole: null,
  mode: 'pause',            // 'train' | 'live' | 'pause'
  world: 'flach',
  budget: 30,               // RL-Schritte je Animation-Frame (nur TRAINING)
  _liveAcc: 0,              // v3.3.0: Zeitakkumulator des POLICY-Betriebs (Echtzeit)
  _ortMu: null,             // v3.3.0: letzter gültiger ONNX-Befehl (wird gehalten)
  updatePause: false,
  dirty: false, lastSave: 0,
  layaActive: false, layaTimer: 0,
  ortInfer: null,           // { session, ep, ort } — Policy über ONNX
  cmdgen: null,             // v3.1.0: Befehls-Generator (Trainings-Einsatz der Joysticks)
  schubser: null,           // v3.2.0: AutoSchubser (an/aus · wie oft · wie stark)
  ground: null, groundState: null, groundRng: null, // v3.2.0: beweglicher Boden
  g0: null, gDirect: true, groundTilt: { x: 0, y: 0 }, // Schwerkraft-Snapshot + Modus
  phone: null, phoneSensor: null, _phSt: null, // v3.2.0: Handy-Gyroskop
  cmdFold: false,           // v3.1.0: Konsole im FELD ausgeklappt?
  fallMode: 'reset',        // v3.4.0: Sturz-Verhalten 'reset' (Neustart) | 'ueben' (Weiterüben)
  fallWinS: 6,              // v3.4.0: Aufsteh-Fenster in Sekunden
  chartMax: 1,
  booted: false,
};
const $ = (id) => document.getElementById(id);
const log = (m, k) => {
  const el = $('bootlog');
  if (!el) return;
  el.textContent += (el.textContent ? '\n' : '') + m;
  if (k === 'err') el.classList.add('err');
};

// ── Boot ───────────────────────────────────────────────────
async function boot() {
  try {
    log('FELD ' + VERSION + ' — starte …');
    await initEngine(log);
    log('MuJoCo-WASM bereit', 'ok');
    const cfg = Object.assign({}, getRobot('duck'));
    // Belohnungsmodell: TRÄGT die rW-Zahlen (Task liest live)
    S.rew = new RewModel(cfg.rW);
    S.rwx = new RwxModel(null);
    // v3.2.0: AutoSchubser — VOR Task-Bau an cfg binden (Task liest je
    // reward()-Aufruf live; in-place Mutationen von Autosave/Import gelten)
    // v3.2.0: AutoSchubser + beweglicher Boden + Handy-Sensor
    S.schubser = new SchubModel(null);
    cfg.schubser = S.schubser;
    S.ground = new GroundModel(null);
    S.groundState = new GroundState();
    S.groundRng = new RNG(20260302); // deterministische Plattform
    S.phone = new PhoneModel(null);
    S.phoneSensor = new PhoneSensor();
    S._phSt = { t: 0, last: -9 };
    cfg.rW = S.rew;
    cfg.rWx = S.rwx;
    if (!hasModelInFS(cfg.dir)) {
      await fetchModelIntoFS('models/' + cfg.dir);
    }
    log('MicroDuck geladen (' + cfg.nActuators + ' Aktuatoren)', 'ok');
    const worldXml = buildWorldXML(cfg, S.world, 7);
    writeWorldFile(cfg.dir, 'welt_live.xml', worldXml);
    S.sim = new RobotSim(cfg, 'welt_live.xml');
    // v3.2.0: Schwerkraft-Snapshot + Schreibbarkeit prüfen (beweglicher Boden)
    S.g0 = new Float64Array([0, 0, -9.81]);
    try { const gv = S.sim.model.opt.gravity; if (gv && gv.length >= 3) S.g0 = Float64Array.from(gv); } catch (e) { /* Defaults */ }
    S.gDirect = probeGravity(S.sim);
    log('Beweglicher Boden: ' + (S.gDirect ? 'Schwerkraft steuerbar' : 'Impuls-Fallback'), 'ok');
    // Task (Soft-MoE-Task des Ducks) + cfg-Rückverweis (Stufen-Glättung)
    S.task = cfg.task(cfg);
    S.task.cfg = cfg;
    applyFallMode(); // v3.4.0: Sturz-Verhalten (recoverOnFall + Fenster) am Task
    S.task.reset(new RNG(4242), S.sim);
    log('Task bereit: ' + S.task.obsDim + ' Obs × ' + S.task.actDim + ' Aktionen · ' + S.task.expertNames.join(' · '), 'ok');
    // Trainer + Speicherstand
    S.trainer = new FeldTrainer(S.task, S.sim, { seed: 20260929, rWBase: S.rew.snapshot() });
    S.laya = new LayaRouter({});
    // v3.1.0: Befehls-Generator (vor applySession — der Import kann ihn überschreiben)
    S.cmdgen = new CmdGen({});
    const sess = store.loadSession();
    if (sess) applySession(sess, { quiet: true });
    // Renderer
    S.renderer = new Renderer3D($('gl'));
    S.renderer.buildFromModel(S.sim);
    wireResize();
    // Konsole
    S.konsole = new Console($('consolePad'), { onButton: (i) => { log('Konsole: ' + BUTTONS[i].label); } });
    S.konsole.driveActive = false;
    // UI
    wireTabs();
    wireTrainUI();
    buildRewardUI();
    buildSchubUI();
    buildGroundUI();
    buildPhoneUI();
    wireConsoleUI();
    wireCmdUI();
    wireConsoleFold();
    wireModelUI();
    wireGesture();
    $('bootOverlay').classList.add('hidden');
    S.booted = true;
    requestAnimationFrame(loop);
  } catch (e) {
    log('BOOT FEHLGESCHLAGEN: ' + (e && e.message), 'err');
    console.error(e);
  }
}

// ── Hauptschleife ──────────────────────────────────────────
let _lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - _lastT) / 1000 || 0.016);
  _lastT = t;
  if (!S.sim) return;
  try {
    if (S.phoneSensor && S.phone && S.phone.on) S.phoneSensor.poll(); // v3.2.0: Sensor einmal je Frame
    if (S.mode === 'train') {
      tickCmdGen(dt);
      trainTick(dt);
    } else if (S.mode === 'live') {
      tickCmdGen(dt);
      liveTick(dt);
    } else {
      groundPhoneStep(0); // v3.2.0: Pause — Plattform ruht (Neigung 0, Schwerkraft exakt g0)
    }
    applyConsole();
    // v3.3.0: im POLICY-Betrieb interpolierte Pose (Physik 50 Hz ↔ Display
    // beliebig — sonst zittert die Darstellung); Training/Pause wie gehabt
    const livePose = S.mode === 'live' ? S.sim.renderPose(Math.min(1, S._liveAcc / 0.02)) : null;
    S.renderer.updateFrame(S.sim, dt, livePose);
    S.renderer.render();
    hud();
    maybeAutosave(t);
  } catch (e) {
    S.mode = 'pause';
    log('LOOP-STOPP: ' + (e && e.message), 'err');
    console.error(e);
  }
}

/** Trainings-Takt: budgetierte RL-Schritte (UI bleibt bedienbar). */
function trainTick() {
  S.task._schubLive = false; // v3.2.0: Schubser gelten im Training (live-Flag aus)
  S.trainer.onStep = groundPhoneStep; // v3.2.0: je Regelzyklus Handy + Boden
  if (cmdDriven()) pushUserCmd();
  if (S.layaActive) pushLaya();
  if (S.updatePause) { S.updatePause = false; return; }
  const did = S.trainer.pump(S.budget);
  if (did) {
    S.updatePause = true;
    S.dirty = true;
    drawChart();
    markStages();
  }
}

/** Kommandos nötig: echte Hand (Konsole) ODER Befehls-Generator aktiv. */
function cmdDriven() {
  return !!(S.konsole && (S.konsole.driveActive || (S.cmdgen && S.cmdgen.active())));
}

/**
 * v3.1.0: VIRTUELLE HAND — der Befehls-Generator (Trainings-Einsatz:
 * Fix / Zufallssprünge / Flüssig / Schlangelinien) schreibt seine Werte
 * in die Konsole. Alle bestehenden Wege gelten unverändert (setUserCmd,
 * Konsole→goTo/faceYaw, LAYA); die Sticks bewegen sich sichtbar.
 * Eine echte Hand (touchL/touchR) gewinnt pro Kanal.
 */
function tickCmdGen(dt) {
  const g = S.cmdgen, k = S.konsole;
  if (!g || !k) return;
  if (g.drive.mode !== 'manuell' || g.head.mode !== 'manuell') {
    const out = g.tick(dt);
    if (g.drive.mode !== 'manuell' && !k.touchL) {
      k.drive.x = g.drive.mode === 'aus' ? 0 : out.x;
      k.drive.y = g.drive.mode === 'aus' ? 0 : -out.y; // Generator +y = vorwärts → Stick hoch (−y)
    }
    if (g.head.mode !== 'manuell' && !k.touchR) {
      k.head.x = g.head.mode === 'aus' ? 0 : out.hx;
      k.head.y = g.head.mode === 'aus' ? 0 : out.hy;
    }
  }
  k.renderSticks();
}

/**
 * v3.3.0 — Live-Takt (POLICY): ECHTZEIT statt „ein Zyklus je Bild“.
 * Vorher lief pro Render-Frame GENAU EIN Regelzyklus (sim.stepN(10)):
 * bei 30 fps Zeitlupe (0,6×), bei 120 Hz Überlicht (2,4×), bei
 * schwankender Framerate Zittern — egal, was der Schritte-Budget-
 * Slider stand (der wirkt nur im Training). Jetzt folgt die Simulation
 * der ECHTEN UHR: Zeitakkumulator + Aufholschleife mit Budget.
 * ONNX: die Inferenz läuft asynchron WEITER — die Physik wartet nicht
 * mehr (letzter gültiger Befehl wird gehalten, wie bei echter Robotik);
 * vorher fror die Sim während jeder Inferenz ein (Stottern/Langsam).
 */
function liveTick(dt) {
  const task = S.task;
  // v3.2.0: Schubser im POLICY-Betrieb nur, wenn extra eingeschaltet —
  // so sieht man live, wie die Ente auf Stöße reagiert.
  task._schubLive = !!(S.schubser && S.schubser.on && S.schubser.live);
  if (cmdDriven()) pushUserCmd();
  // Echte Zeit akkumulieren (App-Wechsel-Sprünge auf 0,25 s begrenzen)
  S._liveAcc = Math.min(0.25, (S._liveAcc || 0) + Math.max(0, dt));
  S.sim.snapPrev(); // Pose VOR diesem Frame für die Render-Interpolation sichern
  const CYC = 0.02;  // Regelzyklus = 10 Substeps × 0,002 s (wie im Training)
  const t0 = performance.now();
  let guard = 0;
  while (S._liveAcc >= CYC && guard < 15) {
    S._liveAcc -= CYC;
    guard++;
    // v3.4.0: Blend-Basis VOR JEDEM Zyklus — bei Aufholzyklen (2+ pro Frame)
    // war die Basis mehrere Zyklen alt → gestreckte Sprünge im Bild (ruckartig).
    S.sim.snapPrev(); // v3.4.0: Basis = Zustand vor DIESEM Zyklus
    liveCycle();
    if (performance.now() - t0 > 9) break; // Aufholbudget: Render nie würgen
  }
  if (S._liveAcc > CYC * 4) S._liveAcc = CYC; // Notbremse nach Systemlast
  if (S.rwx.on && S.rwx.terms.some((x) => x.source === 'console')) pushConsoleGoals();
}

/** EIN Regelzyklus im POLICY-Betrieb (0,02 s Simzeit — wie trainTick). */
function liveCycle() {
  const task = S.task, sim = S.sim;
  groundPhoneStep(0.02); // v3.2.0: Handy + beweglicher Boden JE Zyklus (wie im Training)
  task.observe(sim, S.trainer._obs);
  if (S.ortInfer) {
    // ONNX-Ausführung (CPU/GPU/NPU — EP wie im Modell-Tab gewählt):
    // Inferenz anstoßen, falls frei — die Physik läuft SOGAR WEITER,
    // solange das Ergebnis unterwegs ist (letzter Befehl wird gehalten)
    if (!S._ortBusy) {
      S._ortBusy = true;
      const obs = Float32Array.from(S.trainer._obs);
      S.ortInfer.run({ obs: new S._ortT('float32', obs, [1, obs.length]) })
        .then((out) => {
          S._ortBusy = false;
          S._ortMu = Float32Array.from(out.actions.data); // v3.5.0: Pollen-Ausgangsname
        })
        .catch((e) => { S._ortBusy = false; log('ONNX-Lauf: ' + e.message, 'err'); });
    }
    const mu = S._ortMu || (S._ortMu = new Float32Array(task.actDim));
    // v3.6.0: der Export backt actSpan·tanh(·) ein — „actions“ sind fertige
    // Positionsoffsets in rad (wie beim echten Duck): Ziel = Referenzpose +
    // Offset. Genau so setzt der Roboter-Loader die Servos → 1:1-Vorschau.
    for (let i = 0; i < task.actDim; i++) {
      sim.ctrl[i] = task._ref[i] + mu[i];
      task._curAct[i] = mu[i];
    }
    sim.stepN(10);
    task.reward(sim);
    for (let i = 0; i < task.actDim; i++) task.lastAct[i] = mu[i];
    if (task.afterAct) task.afterAct(sim, mu);
  } else {
    const a = S.trainer.actLive(S.trainer._obs, true);
    if (S.task.setRouting && S.trainer.ppo.lastW) S.task.setRouting(S.trainer.ppo.lastW);
    task.actionToCtrl(sim, a.act);
    sim.stepN(10);
    task.reward(sim);
    for (let i = 0; i < task.actDim; i++) task.lastAct[i] = a.act[i];
    if (task.afterAct) task.afterAct(sim, a.act);
  }
}

/**
 * v3.2.0: JE REGELZYKLUS (0,02 s) — beweglicher Boden + Handy-Sensor.
 *   • Trainings-Boden (GroundState) tickt mit Simzeit, wenn an
 *     (im POLICY-Betrieb nur mit grLive), Muster amp/freq aus der UI.
 *   • Handy-Neigung (wenn „Neigung bewegt den Boden“) addiert sich.
 *   • Die Gesamt-Neigung kippt die Schwerkraft (opt.gravity) — oder
 *     Impuls-Fallback, wenn die WASM-Bindung nicht schreibbar ist.
 *   • Handy-Bewegung („Bewegung schubst den Roboter“) → Impuls.
 * dt = 0 (Pause) hält alles ruhig und stellt die gerade Bodenlage her.
 */
function groundPhoneStep(dt) {
  const sim = S.sim;
  if (!sim) return;
  let tx = 0, ty = 0, any = false;
  // Trainings-Plattform (beweglicher Boden)
  if (S.ground && S.ground.on && (S.mode === 'train' || (S.mode === 'live' && S.ground.live)) && dt > 0) {
    const g = S.groundState.tick(dt, S.ground, S.groundRng);
    tx += g.x; ty += g.y; any = true;
    S.groundTilt.x = g.x; S.groundTilt.y = g.y;
  } else if (S.groundTilt) {
    S.groundTilt.x = 0; S.groundTilt.y = 0;
  }
  // Handy-Neigung → Boden
  if (S.phone && S.phone.on && S.phone.groundOn && S.phoneSensor && S.phoneSensor.ok && S.mode !== 'pause') {
    const p = S.phoneSensor.tilt(S.phone.tiltMax);
    tx += p.x; ty += p.y; any = true;
  }
  // Schwerkraft schreiben (oder exakt g0 bei Neigung 0)
  const cl = Math.PI / 180 * 25;
  tx = Math.max(-cl, Math.min(cl, tx));
  ty = Math.max(-cl, Math.min(cl, ty));
  if (S.gDirect) setGroundTilt(sim, tx, ty, S.g0);
  else applyGroundImpulse(sim, tx, ty, dt, S._gMass || (S._gMass = { m: 0 }));
  // Handy-Schubser (Bewegung → Impuls) — nie in Pause
  if (S.phone && S.phone.on && S.phone.pushOn && S.phoneSensor && S.phoneSensor.ok && S.mode !== 'pause') {
    const hit = phonePush(sim, S.phone, S.phoneSensor, S._phSt, dt);
    if (hit) S._phLast = hit; // Anzeige in der HANDY-SENSOR-Karte (phState)
  }
}

/** Konsole → Task-Kommandos (in-Verteilung zum Training). */
function pushUserCmd() {
  const c = S.konsole.commands();
  const cfg = S.task.cfg;
  S.task.setUserCmd(c.vx * (cfg.speedMax || 0.25), c.vy * 0.1, c.wz * (cfg.yawMax || 1.0), S.konsole.buttons);
}

/** LAYA (System 1) → Skill-Hinweis + Kommandos (Stufe 3). */
function pushLaya() {
  const sim = S.sim, task = S.task;
  S.layaTimer -= 1;
  if (S.layaTimer > 0) return;
  S.layaTimer = 25; // 0,5 s
  const bq = new Float64Array(4);
  sim.baseQuat(bq);
  const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
  const upz = 1 - 2 * (x * x + y * y);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  sim.baseVelWorld(new Float64Array(3));
  const c = S.konsole.commands();
  const bv = new Float64Array(3);
  sim.baseVelWorld(bv);
  const state = {
    upz,
    vFwd: Math.cos(yaw) * bv[0] + Math.sin(yaw) * bv[1],
    yawRate: sim._qvel[5],
    cmdVx: Math.max(0, c.vx), cmdWz: c.wz,
    fallen: upz < 0.5, hGTol: Math.max(0, sim.cfg.h0 - sim._xpos[3 * sim.baseBody + 2]),
  };
  const d = S.laya.decide(state);
  const cfg = task.cfg;
  const vx = Math.max(0, c.vx) * (cfg.speedMax || 0.25);
  const wz = c.wz * (cfg.yawMax || 1.0);
  task._setCmd(vx, 0, wz, d.w);
}

/** Konsole → Belohnungsziele (goTo/faceYaw mit source:'console'). */
function pushConsoleGoals() {
  const sim = S.sim;
  const p = new Float64Array(3);
  sim.basePos(p);
  const bq = new Float64Array(4);
  sim.baseQuat(bq);
  const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const c = S.konsole.commands();
  for (const t of S.rwx.terms) {
    if (t.source !== 'console') continue;
    if (t.kind === 'goTo') {
      // Ziel „d = Joystick-Fahrt" vor dem Roboter (max 3 m)
      const d = Math.min(3, Math.hypot(c.vx, c.vy));
      const a = yaw + Math.atan2(c.vy, Math.max(0.001, c.vx));
      t.x = Math.max(-12, Math.min(12, p[0] + Math.cos(a) * d));
      t.y = Math.max(-12, Math.min(12, p[1] + Math.sin(a) * d));
    } else if (t.kind === 'faceYaw') {
      let ty = yaw + c.wz * 1.2;
      while (ty > Math.PI) ty -= 2 * Math.PI;
      while (ty <= -Math.PI) ty += 2 * Math.PI;
      t.yaw = ty;
    }
  }
}

/** Konsole-Eingaben überhaupt in die Sim schieben (Train & Live). */
function applyConsole() {
  if (!S.konsole || !S.konsole.driveActive) return;
  if (S.mode === 'train') return; // trainTick macht das selbst (Reihenfolge)
  // Live: Kommandos sind in liveTick gesetzt — Ziele trotzdem pflegen:
  if (S.rwx.on && S.rwx.terms.some((x) => x.source === 'console')) pushConsoleGoals();
}

// ── HUD/Chart ──────────────────────────────────────────────
function hud() {
  const t = S.trainer;
  if (!t) return;
  const el = $('hud');
  if (!el) return;
  const er = t.epRewards.length ? t.epRewards[t.epRewards.length - 1] : 0;
  const ti = t.lastMetrics && t.lastMetrics.trickInfo ? t.lastMetrics.trickInfo : null;
  // v3.2.0: Schubser-Status (Anzahl + letzter Δv) — nur wenn aktiv
  let scInfo = '';
  if (S.schubser && S.schubser.on && S.task && S.task._schubCount) {
    const sL = S.task._schubLast;
    scInfo = ' · SCHUBS ' + S.task._schubCount + '×' + (sL ? ' · Δv ' + sL.dv.toFixed(1) : '');
  }
  el.innerHTML =
    'STUFE ' + S.trainer.stage + ' · ' + S.mode.toUpperCase() +
    ' · UPDATES ' + t.updates +
    ' · EP ' + t.episodes +
    ' · EP-REWARD ' + er.toFixed(1) +
    ' · EMA ' + t.emaEpR.toFixed(1) +
    (ti ? ' · LR ' + ti.lr.toExponential(1) + ' · T ' + ti.T + ' · σ ' + ti.std.toFixed(2) : '') +
    scInfo;
  // v3.2.0: Detailzeile in der SCHUBSER-Karte (Belohnungs-Tab)
  const ss = $('schState');
  if (ss) {
    if (!S.schubser || !S.schubser.on) ss.textContent = 'Aus — die Ente trainiert ohne Stör-Impulse.';
    else {
      const sL = S.task ? S.task._schubLast : null;
      const cN = S.task ? (S.task._schubCount || 0) : 0;
      const suc = S.task && S.task._schubSuc != null ? (' · Erfolg ' + Math.round(S.task._schubSuc * 100) + ' %') : '';
      ss.textContent = cN + ' Schubser gesamt' + suc + (sL ? ' · letzter: Δv ' + sL.dv.toFixed(2) + ' m/s (' + (SCHUB_DIR_LABELS[sL.dir] || sL.dir) + ')' : ' · erster kommt');
    }
  }
  // v3.2.0: Detailzeile BEWEGLICHER BODEN
  const gs = $('grState');
  if (gs) {
    if (!S.ground || !S.ground.on) gs.textContent = 'Aus — fester Boden.';
    else {
      const gt = S.groundTilt || { x: 0, y: 0 };
      const dg = (r) => Math.round(Math.abs(r) * 180 / Math.PI);
      gs.textContent = 'Muster ' + (GROUND_MODE_LABELS[S.ground.mode] || S.ground.mode) + ' · Neigung jetzt ' + dg(gt.x) + '° vor/zurück · ' + dg(gt.y) + '° seitlich (max ' + Math.round(S.ground.amp) + '°)';
    }
  }
  // v3.2.0: Detailzeile HANDY-SENSOR
  const ps = $('phState');
  if (ps) {
    if (!S.phone || !S.phone.on) ps.textContent = 'Sensor aus — Schalter „Sensor lesen (Gyroskop)“ einschalten.';
    else {
      const src = S.phoneSensor && S.phoneSensor.ok ? (S.phoneSensor.src === 'app' ? 'App-Sensor' : 'WebView-Sensor') : 'kein Signal';
      const a = S.phoneSensor ? S.phoneSensor.act.toFixed(1) : '0.0';
      const sL = S._phLast;
      ps.textContent = 'Quelle: ' + src + ' · Wucht ' + a + ' m/s² (Schwelle ' + S.phone.thr.toFixed(1) + ')' +
        (sL ? ' · letzter Handy-Schubs: Δv ' + sL.dv.toFixed(2) + ' m/s' : '') +
        (!S.phone.pushOn && !S.phone.groundOn ? ' · beide Wirkungen aus' : '');
    }
  }
}
function drawChart() {
  const cv = $('chart');
  if (!cv) return;
  const g = cv.getContext('2d');
  const Wd = cv.width, Hd = cv.height;
  g.clearRect(0, 0, Wd, Hd);
  const hist = S.trainer.epRewards.slice(-160);
  if (!hist.length) return;
  const mx = Math.max(1e-6, ...hist.map((v) => Math.abs(v)));
  S.chartMax = mx;
  g.strokeStyle = '#4CC24A';
  g.lineWidth = 1.5;
  g.beginPath();
  hist.forEach((v, i) => {
    const x = (i / Math.max(1, hist.length - 1)) * (Wd - 8) + 4;
    const yv = Hd - 6 - ((v + mx) / (2 * mx)) * (Hd - 12);
    if (i === 0) g.moveTo(x, yv); else g.lineTo(x, yv);
  });
  g.stroke();
  g.strokeStyle = '#262626';
  g.setLineDash([3, 4]);
  g.beginPath();
  g.moveTo(0, Hd / 2); g.lineTo(Wd, Hd / 2);
  g.stroke();
  g.setLineDash([]);
}

// ── Autosave ───────────────────────────────────────────────
function maybeAutosave(t) {
  if (!S.dirty) return;
  if (t - S.lastSave < 10000) return;
  S.lastSave = t;
  S.dirty = false;
  const ok = store.saveSession(sessionBlob());
  const el = $('saveState');
  if (el) el.textContent = 'Autosave ' + new Date().toLocaleTimeString('de-DE') + (ok ? '' : ' (FEHLER)');
}
function sessionBlob() {
  return {
    app: APP_NAME, v: VERSION, ts: Date.now(),
    stage: S.trainer.stage,
    policy: store.policyToJSON(S.trainer.ppo),
    hyper: S.trainer.hyper,
    tricks: S.trainer.tricks,
    rewards: S.rew.toJSON(),
    rwx: S.rwx.toJSON(),
    console: S.konsole ? S.konsole.toJSON() : null,
    cmdgen: S.cmdgen ? S.cmdgen.toJSON() : null,
    schubser: S.schubser ? S.schubser.toJSON() : null, // v3.2.0: AutoSchubser im Autosave
    ground: S.ground ? S.ground.toJSON() : null,       // v3.2.0: beweglicher Boden
    phone: S.phone ? S.phone.toJSON() : null,          // v3.2.0: Handy-Sensor
    fall: { mode: S.fallMode || 'reset', winS: S.fallWinS || 6 }, // v3.4.0: Sturz-Verhalten
    cmdFold: S.cmdFold,
    laya: S.laya ? S.laya.toJSON() : null,
    layaActive: S.layaActive,
    world: S.world,
  };
}
function applySession(sess, opts = {}) {
  try {
    if (!sess || !sess.policy) return false;
    const pol = sess.policy;
    const net = S.trainer.ppo.net;
    // v3.6.0: altes Policy-Format (74er-Obs) sauber abweisen — das neue
    // Pollen-Layout (61 Obs, wie der echte Duck) ist nicht kompatibel dazu.
    if (pol.obsDim && pol.obsDim !== net.obsDim) {
      log('Speicherstand gehört zum alten Policy-Format (' + pol.obsDim + ' Obs) — das neue Pollen-Layout hat ' + net.obsDim + ' Obs. Bitte neu trainieren.', 'err');
      return false;
    }
    const params = {};
    for (const n of net.pNames) {
      if (!pol.params[n]) return false;
      params[n] = store.b64ToF32(pol.params[n]);
    }
    net.applyFromJSON(params);
    const nm = store.b64ToF32(pol.norm.mean), nM2 = store.b64ToF32(pol.norm.M2);
    S.trainer.ppo.norm.mean.set(nm);
    S.trainer.ppo.norm.M2.set(nM2);
    S.trainer.ppo.norm.count = pol.norm.count || 1;
    if (sess.hyper) Object.assign(S.trainer.hyper, sess.hyper);
    if (sess.tricks) Object.assign(S.trainer.tricks, sess.tricks);
    if (sess.rewards) Object.assign(S.rew, RewModel.fromJSON(sess.rewards, S.rew.toJSON()));
    if (sess.rwx) {
      const r = RwxModel.fromJSON(sess.rwx);
      S.rwx.on = r.on; S.rwx.terms = r.terms;
      if (S.task) S.task.cfg.rWx = S.rwx;
    }
    if (sess.laya && S.laya) S.laya = LayaRouter.fromJSON(sess.laya);
    if (typeof sess.layaActive === 'boolean') S.layaActive = sess.layaActive && S.trainer.stage === 3;
    if (typeof sess.stage === 'number') setStage(sess.stage, true);
    if (sess.console && S.konsole) {
      S.konsole.driveActive = !!sess.console.driveActive;
      S.konsole.goalFollow = sess.console.goalFollow !== false;
      S.konsole.headFollow = sess.console.headFollow !== false;
    }
    // v3.1.0: Befehls-Generator + Klappzustand der FELD-Konsole
    if (sess.cmdgen) S.cmdgen = CmdGen.fromJSON(sess.cmdgen);
    if (typeof sess.cmdFold === 'boolean') S.cmdFold = sess.cmdFold;
    // v3.2.0: AutoSchubser — in-place (cfg-Bindung bleibt), UI aktualisieren
    if (sess.schubser && S.schubser) {
      S.schubser.setFrom(sess.schubser);
      S.schubser.sanitize();
      buildSchubUI();
    }
    // v3.2.0: beweglicher Boden + Handy-Sensor
    if (sess.ground && S.ground) {
      S.ground.setFrom(sess.ground);
      S.ground.sanitize();
      buildGroundUI();
    }
    if (sess.phone && S.phone) {
      S.phone.setFrom(sess.phone);
      S.phone.sanitize();
      buildPhoneUI();
    }
    // v3.4.0: Sturz-Verhalten restaurieren
    if (sess.fall) {
      S.fallMode = sess.fall.mode === 'ueben' ? 'ueben' : 'reset';
      const ws = parseFloat(sess.fall.winS);
      if (Number.isFinite(ws)) S.fallWinS = Math.max(1, Math.min(30, ws));
      applyFallMode();
      buildFallUI();
    }
    if (!opts.quiet) log('Speicherstand übernommen', 'ok');
    return true;
  } catch (e) {
    log('Speicherstand unlesbar: ' + e.message, 'err');
    return false;
  }
}

// ── UI: Tabs ───────────────────────────────────────────────
function wireTabs() {
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');
  tabs.forEach((tb) => {
    tb.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('on'));
      pages.forEach((x) => x.classList.remove('on'));
      tb.classList.add('on');
      const p = $(tb.dataset.page);
      if (p) p.classList.add('on');
      if (tb.dataset.page === 'pgFeld') S.renderer && S.renderer.resize();
    });
  });
  $('btnMode').addEventListener('click', () => {
    const next = S.mode === 'pause' ? (S.trainer.updates > 0 ? 'live' : 'train') : 'pause';
    setMode(next);
  });
  $('btnTrainGo').addEventListener('click', () => setMode('train'));
  $('btnLiveGo').addEventListener('click', () => setMode('live'));
  $('btnStop').addEventListener('click', () => setMode('pause'));
  $('btnReset').addEventListener('click', () => {
    S.trainer.resetAll();
    log('Episode zurückgesetzt');
  });
}
function setMode(m) {
  S.mode = m;
  $('modeChip').textContent = { train: 'TRAINING', live: 'POLICY', pause: 'PAUSE' }[m];
  $('btnMode').textContent = m === 'pause' ? '▶ START' : '⏸ PAUSE';
}

// ── v3.4.0: STURZ-VERHALTEN (Train-Tab) ───────────────────
// 'reset'  = Sturz beendet die Episode SOFORT — neue Lage, neue Runde
//            (klassisches Training, schnelle Vielfalt).
// 'ueben'  = Episode läuft WEITER — nach dem Sturz bekommt die Ente ein
//            Aufsteh-Fenster (recoverOnFall + recStepsMax), um sich selbst
//            hochzuziehen. Längeres Anpassen PRO RUNDE + Aufstehen wird
//            mittrainiert (Belohnung „Aufstehen“). Gilt auch im
//            POLICY-Betrieb: statt liegen zu bleiben, steht sie auf.
const FALL_MODES = [
  { id: 'reset', label: 'NEUSTART' },
  { id: 'ueben', label: 'WEITERÜBEN' },
];
function applyFallMode() {
  if (!S.task) return;
  S.task.recoverOnFall = S.fallMode === 'ueben';
  // Fenster: 50 Regelzyklen/s, 1–30 s hart geklemmt (Slider 2–20 s)
  S.task.recStepsMax = Math.max(50, Math.min(1500, Math.round((S.fallWinS || 6) * 50)));
}
function setFallMode(m) {
  S.fallMode = m === 'ueben' ? 'ueben' : 'reset';
  applyFallMode();
  S.dirty = true;
  buildFallUI();
  log('Sturz-Verhalten: ' + (S.fallMode === 'ueben' ? 'WEITERÜBEN (Aufstehen lernen)' : 'NEUSTART (Sturz beendet die Runde)'), 'ok');
}
function buildFallUI() {
  const host = $('fallSeg');
  if (!host) return;
  host.innerHTML = '';
  for (const m of FALL_MODES) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.dataset.mode = m.id;
    if ((S.fallMode || 'reset') === m.id) b.classList.add('on');
    b.addEventListener('click', () => setFallMode(m.id));
    host.appendChild(b);
  }
  const winRow = $('fallWinRow');
  if (winRow) winRow.classList.toggle('dimrow', S.fallMode !== 'ueben');
  const win = $('fallWin');
  if (win) win.value = S.fallWinS || 6;
  const out = $('fallWinVal');
  if (out) out.textContent = String(S.fallWinS || 6);
}

// ── UI: Training (3 Stufen) ────────────────────────────────
function wireTrainUI() {
  document.querySelectorAll('.stage-btn').forEach((b) => {
    b.addEventListener('click', () => setStage(parseInt(b.dataset.stage, 10)));
  });
  const bud = $('budget');
  bud.value = S.budget;
  bud.addEventListener('input', () => { S.budget = parseInt(bud.value, 10) || 30; $('budgetVal').textContent = S.budget; });
  $('budgetVal').textContent = S.budget;
  // v3.4.0: Sturz-Verhalten (NEUSTART / WEITERÜBEN + Fenster)
  buildFallUI();
  const fw = $('fallWin');
  if (fw) fw.addEventListener('input', () => {
    S.fallWinS = parseFloat(fw.value) || 6;
    $('fallWinVal').textContent = String(S.fallWinS);
    applyFallMode();
    S.dirty = true;
  });
  // Tricks-Schalter
  const tk = $('tricksOn');
  tk.checked = S.trainer.tricks.on;
  tk.addEventListener('change', () => { S.trainer.tricks.on = tk.checked; S.dirty = true; });
  for (const [id, key] of [['tkLr', 'autoLr'], ['tkRollout', 'autoRollout'], ['tkNoise', 'autoNoise']]) {
    const el = $(id);
    el.checked = S.trainer.tricks[key];
    el.addEventListener('change', () => { S.trainer.tricks[key] = el.checked; S.dirty = true; });
  }
  // LAYA (Stufe 3)
  $('layaOn').addEventListener('change', (e) => {
    if (S.trainer.stage !== 3) { e.target.checked = false; $('layaHint').classList.remove('hidden'); return; }
    S.layaActive = e.target.checked;
    $('layaHint').classList.add('hidden');
    S.dirty = true;
  });
  $('layaTemp').addEventListener('input', (e) => {
    S.laya.temp = parseFloat(e.target.value) || 1.6;
    $('layaTempVal').textContent = S.laya.temp.toFixed(1);
    S.dirty = true;
  });
  markStages();
}
function setStage(s, silent = false) {
  const old = S.trainer.stage;
  S.trainer.setStage(s);
  if (s !== 3) { S.layaActive = false; const lo = $('layaOn'); if (lo) lo.checked = false; }
  if (!silent) log('Stufe ' + s + ': ' + ['…', 'Experten trainieren (Router friert)', 'Router trainiert (Experten frieren)', 'Feinabstimmung — sanfte Übergänge'][s]);
  markStages();
  S.dirty = true;
  if (s !== old && !silent) { S.trainer.resetAll(); }
}
function markStages() {
  document.querySelectorAll('.stage-btn').forEach((b) => {
    b.classList.toggle('on', parseInt(b.dataset.stage, 10) === S.trainer.stage);
  });
  const info = {
    1: 'EXPERTEN · Encoder + 4 Experten + Decoder · Router friert',
    2: 'ROUTER · nur Router, Experten EINGEFROREN',
    3: 'FEINABSTIMMUNG · alles offen · LR ×0,25 · Übergangsglättung ×3',
  }[S.trainer.stage];
  $('stageInfo').textContent = info;
  const layaSec = $('layaSec');
  if (layaSec) layaSec.classList.toggle('dim', S.trainer.stage !== 3);
}

// ── UI: Belohnung ──────────────────────────────────────────
function buildRewardUI() {
  const host = $('rewRows');
  host.innerHTML = '';
  for (const [k, label, lo, hi, st] of RW_FIELDS) {
    const row = document.createElement('div');
    row.className = 'rrow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = st; sl.value = S.rew[k];
    const num = document.createElement('input');
    num.type = 'number'; num.min = lo; num.max = hi; num.step = st; num.value = S.rew[k];
    const sync = (v) => {
      const x = parseFloat(v);
      if (!Number.isFinite(x)) return;
      S.rew[k] = x; S.dirty = true;
      sl.value = x; num.value = x;
    };
    sl.addEventListener('input', () => sync(sl.value));
    num.addEventListener('change', () => sync(num.value));
    row.appendChild(lab); row.appendChild(sl); row.appendChild(num);
    host.appendChild(row);
  }
  // Presets
  const ph = $('presetRow');
  ph.innerHTML = '';
  for (const id of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'ghost';
    b.textContent = PRESETS[id].name;
    b.addEventListener('click', () => {
      S.rew.applyPreset(id);
      S.dirty = true;
      buildRewardUI();
      log('Preset: ' + PRESETS[id].name, 'ok');
    });
    ph.appendChild(b);
  }
  // Terme
  buildRwxUI();
}
function buildRwxUI() {
  const host = $('rwxRows');
  host.innerHTML = '';
  S.rwx.terms.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trow';
    const head = document.createElement('div');
    head.className = 'trow-head';
    const nm = document.createElement('span');
    nm.textContent = (RWX_DEFS[t.kind] ? RWX_DEFS[t.kind].label : t.kind) + ' · w ' + t.w.toFixed(2);
    head.appendChild(nm);
    const del = document.createElement('button');
    del.className = 'mini';
    del.textContent = '✕';
    del.addEventListener('click', () => { S.rwx.remove(i); S.dirty = true; buildRwxUI(); });
    head.appendChild(del);
    row.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'tgrid';
    for (const p of (RWX_DEFS[t.kind] ? RWX_DEFS[t.kind].params : [])) {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = '0.05'; inp.value = t[p];
      inp.dataset.p = p;
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) { t[p] = v; S.dirty = true; }
      });
      const l = document.createElement('label');
      l.textContent = p;
      const wrap = document.createElement('div');
      wrap.appendChild(l); wrap.appendChild(inp);
      grid.appendChild(wrap);
    }
    // Gewicht
    const wInp = document.createElement('input');
    wInp.type = 'number'; wInp.step = '0.05'; wInp.value = t.w;
    wInp.addEventListener('change', () => {
      const v = parseFloat(wInp.value);
      if (Number.isFinite(v)) { t.w = Math.max(0, Math.min(5, v)); S.dirty = true; }
    });
    const wL = document.createElement('label');
    wL.textContent = 'w';
    const wWrap = document.createElement('div');
    wWrap.appendChild(wL); wWrap.appendChild(wInp);
    grid.appendChild(wWrap);
    // Quelle: Konsole (nur goTo/faceYaw)
    if (t.kind === 'goTo' || t.kind === 'faceYaw') {
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = t.source === 'console';
      chk.addEventListener('change', () => { t.source = chk.checked ? 'console' : null; S.dirty = true; });
      const cl = document.createElement('label');
      cl.textContent = 'Quelle: Konsole';
      const cWrap = document.createElement('div');
      cWrap.appendChild(cl); cWrap.appendChild(chk);
      grid.appendChild(cWrap);
    }
    row.appendChild(grid);
    host.appendChild(row);
  });
  $('rwxOn').checked = S.rwx.on === 1 && S.rwx.terms.length > 0;
}
function wireRewardUI() {
  $('rwxOn').addEventListener('change', (e) => {
    S.rwx.on = e.target.checked ? 1 : 0;
    S.dirty = true;
  });
  $('rwxKind').addEventListener('change', () => { /* nur Auswahl */ });
  $('rwxAdd').addEventListener('click', () => {
    const kind = $('rwxKind').value;
    const t = S.rwx.add(kind, {});
    if (t) { S.dirty = true; buildRwxUI(); }
  });
}

// ── v3.2.0: AutoSchubser-Regler (Belohnungs-Tab) ─────────
// Bindet die Karte SCHUBSER an S.schubser (in-place, S.dirty = Autosave).
// Regler: an/aus · wie oft (Intervall von/bis) · wie stark (Δv von/bis) ·
// Richtung · Stärke wächst mit Erfolg · auch im POLICY-Betrieb.
function buildSchubUI() {
  const m = S.schubser;
  if (!m) return;
  const sw = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.checked = !!m[key];
    el.onchange = () => { m[key] = el.checked ? 1 : 0; m.sanitize(); S.dirty = true; };
  };
  sw('schOn', 'on');
  sw('schGrow', 'grow');
  sw('schLive', 'live');
  const sl = (id, outId, key, fix = 1) => {
    const el = $(id);
    if (!el) return;
    el.value = m[key];
    const out = $(outId);
    if (out) out.textContent = (+m[key]).toFixed(fix);
    el.oninput = () => {
      m[key] = parseFloat(el.value);
      m.sanitize(); // hält min ≤ max (Intervall/Stärke) — der Partner-Slider folgt erst beim Neuaufbau
      if (out) out.textContent = (+m[key]).toFixed(fix);
      S.dirty = true;
      syncPartner(key);
    };
  };
  sl('schTmin', 'schTminVal', 'sMin', 1);
  sl('schTmax', 'schTmaxVal', 'sMax', 1);
  sl('schVmin', 'schVminVal', 'vMin', 2);
  sl('schVmax', 'schVmaxVal', 'vMax', 2);
  const dir = $('schDir');
  if (dir) {
    dir.value = m.dir;
    dir.onchange = () => { m.dir = dir.value; m.sanitize(); S.dirty = true; };
  }
}
/** Nach sanitize() den Partner-Slider auf die (geklemmten) Werte bringen. */
function syncPartner(key) {
  const m = S.schubser;
  const map = { sMin: ['schTmin', 'schTminVal'], sMax: ['schTmax', 'schTmaxVal'], vMin: ['schVmin', 'schVminVal'], vMax: ['schVmax', 'schVmaxVal'] };
  const pair = map[key];
  if (!pair) return;
  const el = $(pair[0]), out = $(pair[1]);
  if (el) el.value = m[key];
  if (out) out.textContent = (+m[key]).toFixed(key[0] === 's' ? 1 : 2);
}

// ── v3.2.0: BEWEGLICHER BODEN (Belohnungs-Tab) ───────────
// Muster (Sinus/Zufall/Achter/Drift) · Neigung max (°) · Frequenz (Hz) ·
// an/aus · auch im POLICY-Betrieb. Wirkt je Regelzyklus (onStep-Haken).
function buildGroundUI() {
  const m = S.ground;
  if (!m) return;
  const sw = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.checked = !!m[key];
    el.onchange = () => { m[key] = el.checked ? 1 : 0; m.sanitize(); S.dirty = true; };
  };
  sw('grOn', 'on');
  sw('grLive', 'live');
  const mode = $('grMode');
  if (mode) {
    mode.value = m.mode;
    mode.onchange = () => { m.mode = mode.value; m.sanitize(); S.groundState.reset(); S.dirty = true; };
  }
  const sl = (id, outId, key, fix = 2) => {
    const el = $(id);
    if (!el) return;
    el.value = m[key];
    const out = $(outId);
    if (out) out.textContent = (+m[key]).toFixed(fix);
    el.oninput = () => {
      m[key] = parseFloat(el.value);
      m.sanitize();
      if (out) out.textContent = (+m[key]).toFixed(fix);
      S.dirty = true;
    };
  };
  sl('grAmp', 'grAmpVal', 'amp', 0);
  sl('grFreq', 'grFreqVal', 'freq', 2);
}

// ── v3.2.0: HANDY-SENSOR (Belohnungs-Tab) ────────────────
// Sensor starten/stoppen · Bewegung schubst Roboter · Neigung bewegt
// Boden · Richtung umkehren · Empfindlichkeit/Schwelle/Stärke/Neigung.
function buildPhoneUI() {
  const m = S.phone;
  if (!m) return;
  const sw = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.checked = !!m[key];
    el.onchange = () => {
      m[key] = el.checked ? 1 : 0;
      m.sanitize();
      // Sensor-Laufzeit je „Sensor lesen“-Schalter
      if (key === 'on') {
        if (m.on) S.phoneSensor.start(); else S.phoneSensor.stop();
      }
      S.dirty = true;
    };
  };
  sw('phOn', 'on');
  sw('phPush', 'pushOn');
  sw('phGround', 'groundOn');
  sw('phInv', 'inv');
  const sl = (id, outId, key, fix = 1) => {
    const el = $(id);
    if (!el) return;
    el.value = m[key];
    const out = $(outId);
    if (out) out.textContent = (+m[key]).toFixed(fix);
    el.oninput = () => {
      m[key] = parseFloat(el.value);
      m.sanitize();
      if (out) out.textContent = (+m[key]).toFixed(fix);
      S.dirty = true;
    };
  };
  sl('phSens', 'phSensVal', 'sens', 1);
  sl('phThr', 'phThrVal', 'thr', 1);
  sl('phVmax', 'phVmaxVal', 'vMax', 1);
  sl('phTilt', 'phTiltVal', 'tiltMax', 0);
}

// ── UI: Konsole ────────────────────────────────────────────
function wireConsoleUI() {
  $('consOn').addEventListener('change', (e) => {
    S.konsole.driveActive = e.target.checked;
    $('consHint').classList.toggle('hidden', e.target.checked);
    S.dirty = true;
  });
  $('btnConsoleTest').addEventListener('click', () => {
    // kurzer Selbstdruck aller 4 Buttons (Anzeige-Demo)
    for (let i = 0; i < 4; i++) setTimeout(() => S.konsole.press(i), i * 160);
  });
}

// ── v3.1.0: Konsole im FELD ein-/ausklappen ────────────────
function wireConsoleFold() {
  $('btnConsoleFold').addEventListener('click', () => foldConsole(!S.cmdFold));
  foldConsole(S.cmdFold === true); // gespeicherten Zustand ins DOM bringen
}

/**
 * Klappen die Steuerkonsole über der 3D-Ansicht ein/aus — wie bei
 * Spielen: Pads + Buttons als halbtransparentes Overlay, der Roboter
 * bleibt sichtbar („sehen, wie er reagiert“). Das GLEICHE consolePad
 * wandert zwischen Overlay und STEUER-Tab (eine Instanz, Zustand bleibt).
 */
function foldConsole(open) {
  S.cmdFold = !!open;
  const fc = $('feldConsole');
  if (!fc) return;
  fc.classList.toggle('open', S.cmdFold);
  $('btnConsoleFold').textContent = S.cmdFold ? '▼ EINKLAPPEN' : '▲ STEUERUNG';
  const padEl = $('consolePad');
  if (!padEl) return;
  if (S.cmdFold) {
    $('feldConsoleHost').appendChild(padEl);
  } else {
    $('consoleHome').appendChild(padEl);
  }
}

// ── v3.1.0: UI Trainingseinsatz der Joysticks ──────────────
function chanOf(id) { return id === 'drive' ? S.cmdgen.drive : S.cmdgen.head; }

function wireCmdUI() {
  buildCmdSeg('drive', $('segDrive'));
  buildCmdSeg('head', $('segHead'));
  buildCmdRows();
}

function buildCmdSeg(id, host) {
  if (!host) return;
  host.innerHTML = '';
  for (const m of CMD_MODES) {
    const b = document.createElement('button');
    b.textContent = CMD_MODE_LABELS[m];
    b.dataset.mode = m;
    if (chanOf(id).mode === m) b.classList.add('on');
    b.addEventListener('click', () => {
      chanOf(id).mode = m;
      S.dirty = true;
      buildCmdSeg(id, host);
      buildCmdRows();
      log('Trainingseinsatz ' + (id === 'drive' ? 'BEWEGUNG' : 'KOPF') + ': ' + CMD_MODE_LABELS[m], 'ok');
    });
    host.appendChild(b);
  }
}

function buildCmdRows() {
  buildCmdRowsFor('drive', $('cmdRowsDrive'));
  buildCmdRowsFor('head', $('cmdRowsHead'));
}

function buildCmdRowsFor(id, host) {
  if (!host) return;
  const c = chanOf(id);
  host.innerHTML = '';
  const mkRow = (label, lo, hi, st, key, modes) => {
    const row = document.createElement('div');
    row.className = 'rrow' + (modes && !modes.includes(c.mode) ? ' dimrow' : '');
    const lab = document.createElement('label');
    lab.textContent = label;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = st; sl.value = c[key];
    const out = document.createElement('output');
    out.textContent = (+c[key]).toFixed(2);
    sl.addEventListener('input', () => {
      c[key] = parseFloat(sl.value);
      out.textContent = (+sl.value).toFixed(2);
      S.cmdgen.sanitize();
      S.dirty = true;
    });
    row.appendChild(lab); row.appendChild(sl); row.appendChild(out);
    host.appendChild(row);
  };
  mkRow('Amplitude', 0, 1, 0.05, 'amp', ['fix', 'sprung', 'fluessig', 'schlange']);
  if (id === 'drive') {
    mkRow('Fix: vor (+) / zurück (−)', -1, 1, 0.05, 'fixY', ['fix']);
    mkRow('Fix: seitlich', -1, 1, 0.05, 'fixX', ['fix']);
  } else {
    mkRow('Fix: drehen (− links, + rechts)', -1, 1, 0.05, 'fixX', ['fix']);
  }
  mkRow('Sprungdauer (s)', 0.3, 10, 0.1, 'holdS', ['sprung']);
  mkRow('Aktiv-Chance', 0, 1, 0.05, 'prob', ['sprung']);
  mkRow('Glättung (s)', 0.1, 3, 0.05, 'tauS', ['fluessig']);
  mkRow('Neues Ziel alle (s)', 0.3, 6, 0.1, 'retargetS', ['fluessig']);
  mkRow('Schlangenfrequenz (Hz)', 0.05, 1.5, 0.05, 'freqHz', ['schlange']);
}

// ── UI: Modell (Export/Quantisierung/EP/Speicher) ──────────
function wireModelUI() {
  $('expFmt').value = 'fp32';
  $('expNorm').checked = true;
  $('expValue').checked = false;
  $('btnExportOnnx').addEventListener('click', () => {
    const fmt = $('expFmt').value;
    try {
      const norm = $('expNorm').checked
        ? { mean: Array.from(S.trainer.ppo.norm.mean), std: Array.from(S.trainer.ppo.norm.stds()) }
        : null;
      const duck = getRobot('duck');
      const meta = {
        // v3.6.0: ECHTE Pollen-Metadaten — default_joint_pos aus dem laufenden
        // Sim (STAND-Keyframe). action_scale bleibt 1.000 (die Skalierung ist
        // EINGEBACKEN — „actions“ = fertige Positionsoffsets in rad).
        defaultJointPos: (S.sim && S.sim.keyCtrl) ? Array.from(S.sim.keyCtrl) : null,
      };
      const { bytes, ops, params } = moeToOnnx(S.trainer.ppo.net, {
        format: fmt, norm, valueHead: $('expValue').checked, meta,
        actSpan: duck.actSpan, jointResidual: duck.jointResidual != null ? duck.jointResidual : 1,
      });
      // v3.6.0: NUR die .onnx (Nutzer: „Manifest brauche ich auch nicht“) —
      // rohes Protobuf über die Android-Brücke (TrainrobotBridge.saveFile →
      // MediaStore) in den Download-Ordner; der Duck-Loader lädt die Datei
      // direkt (obs [1,61] wie velstand.onnx, Ausgang „actions“).
      const name = 'feld-policy-' + fmt + '.onnx';
      const how = store.exportBytes(name, bytes, 'application/octet-stream');
      $('expState').textContent = 'Export OK: ' + name + ' · ' + (bytes.length / 1024).toFixed(0) + ' KB · ' +
        ops + ' Knoten, ' + params + ' Parameter (' + fmt + ', Pollen-Format: obs [1,' + S.task.obsDim + '] → actions [1,' + S.task.actDim + '], opset 18, 8 Metadaten, Skalierung eingebacken)' +
        (how === 'download' ? ' → Ordner Download' : ' → Browser-Download');
      log('ONNX-Export (' + fmt + ', Pollen-Profil): ' + name + ', ' + bytes.length + ' Bytes → ' +
        (how === 'download' ? 'Download-Ordner' : 'Browser'), 'ok');
    } catch (e) {
      $('expState').textContent = 'Export-Fehler: ' + e.message;
    }
  });
  $('btnSelfTest').addEventListener('click', async () => {
    $('expState').textContent = 'Selbsttest läuft (ORT wird geladen) …';
    try {
      const duck = getRobot('duck');
      const r = await selfTest(S.trainer.ppo.net, $('epSel').value, {
        actSpan: duck.actSpan,
        jointResidual: duck.jointResidual != null ? duck.jointResidual : 1,
      });
      $('expState').textContent = 'Parität ONNX ↔ JS: maxΔ = ' + r.maxDiff.toExponential(2) + ' (n=' + r.n + ')';
      log('ONNX-Selbsttest: maxΔ ' + r.maxDiff.toExponential(2), 'ok');
    } catch (e) {
      $('expState').textContent = 'Selbsttest-Fehler: ' + e.message;
    }
  });
  $('btnRunOrt').addEventListener('click', async () => {
    try {
      $('expState').textContent = 'Erzeuge Session …';
      const norm = { mean: Array.from(S.trainer.ppo.norm.mean), std: Array.from(S.trainer.ppo.norm.stds()) };
      const { bytes } = moeToOnnx(S.trainer.ppo.net, {
        format: 'fp32', norm, valueHead: false,
        // v3.6.0: gleiche Einbackung wie der Export — liveCycle legt die
        // „actions“ direkt als Referenz + Offset auf die Servos.
        actSpan: getRobot('duck').actSpan,
        jointResidual: getRobot('duck').jointResidual != null ? getRobot('duck').jointResidual : 1,
      });
      // v3.4.0: Latenz-Probe (Warm-up + Median, Budget 8 ms) — trägele
      // NPU/GPU-Provider werden automatisch übersprungen (ruckartige
      // Befehle in Schüben), der schnellste Provider gewinnt.
      const D = S.task.obsDim;
      const warm = new Float32Array(D); // v3.6.0: Null-Kommando = neutrale Stand-Startlage
      const { session, ep, ort, ms } = await createSession(bytes, $('epSel').value, null, { warmDim: D, budgetMs: 8 });
      S.ortInfer = session;
      S._ortT = ort.Tensor;
      // v3.4.0: Startbefehl aus dem Warm-up (keine Null-Phase beim ersten Start)
      try {
        const out = await session.run({ obs: new ort.Tensor('float32', warm, [1, D]) });
        S._ortMu = Float32Array.from(out.actions.data); // v3.5.0: Pollen-Ausgangsname
      } catch (e) { /* Null-Start genügt */ }
      S._liveAcc = 0; // frischer Takt
      $('epReal').textContent = 'Aktiv: ' + ep + (ms > 0 ? ' · ~' + ms.toFixed(1) + ' ms/Inferenz' : '');
      $('expState').textContent = 'ONNX-Inferenz aktiv (' + ep + (ms > 0 ? ', ~' + ms.toFixed(1) + ' ms' : '') + ')';
    } catch (e) {
      $('expState').textContent = 'Session-Fehler: ' + e.message;
    }
  });
  $('btnStopOrt').addEventListener('click', () => {
    S.ortInfer = null;
    $('epReal').textContent = '';
    $('expState').textContent = 'ONNX-Inferenz aus';
  });
  // Speicher
  $('btnExportJson').addEventListener('click', () => {
    // v3.4.0: auch JSON über die Brücke (WebView führt kein <a download> aus)
    const how = store.exportJSON('feld-sitzung-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', sessionBlob());
    $('saveState').textContent = 'Exportiert' + (how === 'download' ? ' → Download-Ordner' : '');
  });
  $('btnImportJson').addEventListener('click', async () => {
    try {
      const obj = await store.importFile();
      if (applySession(obj)) $('saveState').textContent = 'Import OK';
    } catch (e) {
      $('saveState').textContent = 'Import-Fehler: ' + e.message;
    }
  });
  $('btnClearSave').addEventListener('click', () => {
    store.clearSession();
    $('saveState').textContent = 'Autosave gelöscht';
  });
}

// ── Renderer-Größe + Kamera-Geste ──────────────────────────
function wireResize() {
  const fit = () => { S.renderer && S.renderer.resize(); };
  window.addEventListener('resize', fit);
  setTimeout(fit, 0);
}
function wireGesture() {
  const cv = $('gl');
  let pid = null, px = 0, py = 0, pinch = 0;
  cv.addEventListener('pointerdown', (e) => { pid = e.pointerId; px = e.clientX; py = e.clientY; cv.setPointerCapture(pid); });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const r = S.renderer;
    r.camYaw -= (e.clientX - px) * 0.008;
    r.camPitch = Math.max(0.05, Math.min(1.35, r.camPitch + (e.clientY - py) * 0.006));
    px = e.clientX; py = e.clientY;
  });
  cv.addEventListener('pointerup', () => { pid = null; });
  cv.addEventListener('pointercancel', () => { pid = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.renderer.camDist = Math.max(0.6, Math.min(12, S.renderer.camDist * (1 + Math.sign(e.deltaY) * 0.1)));
  }, { passive: false });
}

// Test-/Debug-Handle (schadlos in Produktion — wie in der Alt-App):
// Browser-Tests messen darüber Sim-Zeit (mjData.time) gegen die Echtzeit.
Object.defineProperty(window, '__feld', {
  get: () => ({
    sim: S.sim,
    task: S.task,
    trainer: S.trainer,
    get mode() { return S.mode; },
    get budget() { return S.budget; },
    get liveAcc() { return S._liveAcc; },
  }),
});

// ── Los ────────────────────────────────────────────────────
wireRewardUI();
boot();
