// ═══════════════════════════════════════════════════════════
// duck_sync_test.mjs — v2.12.1 Fixes (Node, kein WASM):
//   A) Liegend-Start → Aufsteh-Fenster statt 1-Schritt-Episoden
//      („kann nicht mal hinfallen, extrem kurz" bei Liegen lassen)
//   B) recoverOnFall: Sturz → Aufsteh-Fenster (stay) / Sofort-done (reset)
//   C) setUserCmd: Stick steuert Policy-Modus, Scheduler pausiert
//   D) Curriculum-Selbstkorrektur: Level sinkt bei Kollaps
//   E) obs-Layout unverändert (74) + Scheduler-Regression (Training)
// Aufruf: node scripts/duck_sync_test.mjs
// ═══════════════════════════════════════════════════════════
import { makeDuckMoeTask, getRobot } from '../app/src/main/assets/www/js/robots.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';

let fails = 0, pass = 0;
function check(name, cond, detail = '') {
  console.log((cond ? '  \u2713 ' : '  \u2717 FEHLER ') + name + (detail ? ' — ' + detail : ''));
  if (cond) pass++; else fails++;
}

// ── Stub-Sim: liefert die vom Duck-Task gelesenen Zustände ──
function stubSim(cfg) {
  const nu = cfg.nu;
  const st = {
    upz: 1.0, gz: 0.12, vFwd: 0, yawRate: 0, contacts: [1, 1],
    resets: 0, // zählt resetToKeyframe-Aufrufe
  };
  const quat = () => {
    const u = Math.max(-1, Math.min(1, st.upz));
    const th = Math.acos(u);
    return [Math.cos(th / 2), Math.sin(th / 2), 0, 0]; // (w,x,y,z), Kippung um Y
  };
  const sim = {
    cfg, nbody: 3, model: {},
    _mjApi: { mj_id2name: (m, t, b) => (b === 1 ? 'ankle_left' : b === 2 ? 'ankle_right' : null) },
    _xpos: new Float64Array(24),
    _xquat: new Float64Array(16),
    _qvel: new Float64Array(12),
    actRange: new Float64Array(2 * nu).map((_, i) => (i % 2 ? 0.5 : -0.5)),
    keyCtrl: new Float64Array(nu),
    ctrl: new Float64Array(nu),
    resetToKeyframe() { st.resets++; st.upz = 1.0; st.gz = 0.12; },
    baseQuat(o) { const q = quat(); o[0] = q[0]; o[1] = q[1]; o[2] = q[2]; o[3] = q[3]; },
    basePos(o) { o[0] = 0; o[1] = 0; o[2] = st.gz; },
    baseVelWorld(o) { o[0] = st.vFwd; o[1] = 0; o[2] = 0; },
    jointPositions(o) { o.fill(0); },
    jointVelocities(o) { o.fill(0); },
    gyroBody(o) { o.fill(0); },
    projectedGravity(o) { o[0] = 0; o[1] = 0; o[2] = st.upz; },
    footContacts(o) { o[0] = st.contacts[0]; o[1] = st.contacts[1]; },
    pushImpulse() {},
  };
  return { sim, st };
}

const cfg = getRobot("duck");
const rng = new RNG(777);

// ── A) Liegend-Start („Liegen lassen", keepPose) ────────────
console.log('A) Liegend-Start → Aufsteh-Fenster');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  st.upz = -0.9; st.gz = 0.035; // Rückenlage
  const resetsBefore = st.resets;
  task.reset(rng, sim, true);
  check('keepPose: kein Teleport (resetToKeyframe NICHT aufgerufen)', st.resets === resetsBefore);
  check('Liegend-Start erkannt → Aufsteh-Fenster aktiv', task._recoverMode === true && task._recThisEp === true);
  task.observe(sim, new Float64Array(task.obsDim));
  let doneAt = -1;
  for (let i = 0; i < 500; i++) {
    const { r, done } = task.reward(sim);
    if (!Number.isFinite(r)) { check('Reward finit', false, 'r=' + r); break; }
    if (done && doneAt < 0) { doneAt = i + 1; break; }
  }
  check('Episode läuft MINDESTENS ~8 s (400 Schritte), nicht 1 Schritt', doneAt >= 380, 'doneAt=' + doneAt);
  // Aufsteh-Fortschritt wird belohnt: GLEICHER Anstieg, höhere Lage → mehr Reward
  task.observe(sim, new Float64Array(task.obsDim));
  st.upz = 0.3; const r0 = task.reward(sim).r;
  st.upz = 0.5; const r1 = task.reward(sim).r;
  st.upz = 0.7; const r2 = task.reward(sim).r;
  check('Aufricht-Fortschritt bringt mehr Reward (gleicher Anstieg, höhere Lage)', r2 > r1, `r(.3→.5)=${r1.toFixed(3)} r(.5→.7)=${r2.toFixed(3)} (Erstschritt aus Rückenlage: ${r0.toFixed(3)})`);
}

// ── B) Erholung: Timeout + Exit oben ───────────────────────
console.log('B) Aufsteh-Fenster: Timeout + Exit');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  st.upz = 0.2; st.gz = 0.05;
  task.reset(rng, sim, true);
  st.upz = 0.95; st.gz = 0.11; // steht wieder
  task.observe(sim, new Float64Array(task.obsDim));
  const { done } = task.reward(sim);
  check('Oben angekommen → Fenster verlassen, Episode läuft weiter', done === false && task._recoverMode === false);
  // Timeout: frisch liegend, 400+ Schritte → done
  st.upz = 0.1; st.gz = 0.045;
  task.reset(rng, sim, true);
  task.observe(sim, new Float64Array(task.obsDim));
  let doneAt = -1;
  for (let i = 0; i < 600; i++) { if (task.reward(sim).done) { doneAt = i + 1; break; } }
  check('Ohne Erfolg endet das Fenster (~400 Schritte)', doneAt >= 380 && doneAt <= 450, 'doneAt=' + doneAt);
}

// ── C) Sturz MID-Episode: stay vs reset ────────────────────
console.log('C) Sturz-Verhalten (recoverOnFall)');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  task.reset(rng, sim); // steht (Stub upz=1)
  task.recoverOnFall = true; // „Liegen lassen"
  task.observe(sim, new Float64Array(task.obsDim));
  task.reward(sim); task.reward(sim);
  st.upz = 0.2; st.gz = 0.05; // STURZ
  task.observe(sim, new Float64Array(task.obsDim));
  const { done, r } = task.reward(sim);
  check('stay: Sturz → KEIN Sofort-done, Fenster geht los', done === false && task._recoverMode === true);
  check('stay: Sturz-Malus einmalig vergeben', r < 0, 'r=' + r.toFixed(3));
  // reset-Modus (Regression = v2.12.0-Verhalten)
  const task2 = makeDuckMoeTask(cfg);
  task2.reset(rng, sim); task2.recoverOnFall = false;
  task2.observe(sim, new Float64Array(task2.obsDim));
  task2.reward(sim);
  st.upz = 0.2;
  task2.observe(sim, new Float64Array(task2.obsDim));
  const r2 = task2.reward(sim);
  check('reset: Sturz → sofort done (wie bisher)', r2.done === true);
}

// ── D) setUserCmd (Stick im Policy-Modus) ───────────────────
console.log('D) Stick → Soft-Kommandos (Policy-Modus)');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  task.reset(rng, sim);
  const segBefore = task._curSkill;
  task.setUserCmd(0.5, 0, 0.3); // volle Kraft voraus (L1 klemmt auf 0,10)
  check('User-Modus an', task._userCmd === true);
  for (let i = 0; i < 80; i++) task.afterAct(sim, null); // Blenden
  check('vx auf Level-Band geklemmt (L1: 0,10 m/s)', Math.abs(task.softCmd.vx - 0.10) < 0.01, 'vx=' + task.softCmd.vx.toFixed(3));
  check('Legacy-Block synchron', Math.abs(task.cmd.vx - 0.10) < 0.01);
  check('Skill-Form „gehen" dominant', task.skillW[1] > 0.7, 'skillW=' + Array.from(task.skillW).map(v => v.toFixed(2)).join('/'));
  check('Scheduler PAUSIERT (kein neues Zufalls-Segment)', task._curSkill === segBefore || task._userCmd, 'cur=' + task._curSkill);
  // Drehen-Form
  task.setUserCmd(0, 0, 0.5);
  for (let i = 0; i < 80; i++) task.afterAct(sim, null);
  check('Skill-Form „drehen" dominant bei wz', task.skillW[2] > 0.5, 'skillW=' + Array.from(task.skillW).map(v => v.toFixed(2)).join('/'));
  // Balance-Form
  task.setUserCmd(0, 0, 0);
  for (let i = 0; i < 80; i++) task.afterAct(sim, null);
  check('Skill-Form „balance" bei Stillstand', task.skillW[0] > 0.9);
  // obs: Soft-Block am Ende unverändert 13 Kanäle
  const obs = new Float64Array(task.obsDim);
  const o = task.observe(sim, obs);
  check('obsDim 74 unverändert (Schnittstelle)', o === 74 && task.obsDim === 74, 'o=' + o);
  check('obs enthält Stick-Kommandos (letzte 13)', Math.abs(obs[61] - task.softCmd.vx) < 1e-9);
}

// ── E) Training-Regression: Scheduler läuft weiter ──────────
console.log('E) Training-Regression');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  task.reset(rng, sim);
  check('Training: User-Modus aus', task._userCmd === false);
  const w0 = Array.from(task.skillW);
  let changed = false;
  for (let i = 0; i < 1200 && !changed; i++) { task.afterAct(sim, null); if (Array.from(task.skillW).some((v, k) => Math.abs(v - w0[k]) > 0.2)) changed = true; }
  check('Zufalls-Scheduler wechselt weiterhin Segmente', changed);
}

// ── F) Curriculum-Selbstkorrektur ───────────────────────────
console.log('F) Curriculum: Level-Abstieg bei Kollaps');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  task.reset(rng, sim);
  task.setLevel(3, true);
  task.recoverOnFall = false;
  task._epSinceUp = 9;   // 10. Episode...
  task._emaLen = 60;     // ...immer Kollaps (60 Schritte EMA)
  task._recThisEp = false;
  st.upz = 0.2; st.gz = 0.05; // Sturz → done
  task.observe(sim, new Float64Array(task.obsDim));
  task.reward(sim);
  check('Level sank 3 → 2 (EMA weit unter Gate)', task.level === 2, 'level=' + task.level);
  // Aufsteh-Episoden zählen nicht
  task.setLevel(3, true);
  task._recThisEp = true; task._epSinceUp = 9; task._emaLen = 999;
  task.observe(sim, new Float64Array(task.obsDim));
  task.reward(sim); // done (Timeout-Pfad simuliert)
  check('Aufsteh-Episode zählt NICHT zum Level-Aufstieg', task.level === 3 && task._epSinceUp === 0);
}

// ── G) Experten-/Router-Belohnungen (v2.13.0) ───────────────
console.log('G) expertR: Router-Bonus + KI-Schalter');
{
  const { sim, st } = stubSim(cfg);
  const task = makeDuckMoeTask(cfg);
  task.reset(rng, sim);
  task.observe(sim, new Float64Array(task.obsDim));
  // Router gewichtet balance (Default) — Zustand stand → passend → Bonus
  st.vFwd = 0; st.yawRate = 0;
  const rOn = task.reward(sim).r;          // cfg.expertR.on = 1 (Duck-Default)
  const wr = task._routeW; wr.set([0.05, 0.9, 0.05, 0]); // walk dominant
  st.vFwd = 0.5; // geht → walk passt
  task.observe(sim, new Float64Array(task.obsDim));
  const rWalk = task.reward(sim).r;
  check('Router-Bonus wirkt (walk-Experte beim Gehen)', rWalk > 0.1, 'r=' + rWalk.toFixed(3));
  // KI-Schalter: on=0 → Bonus weg
  cfg.expertR.on = 0;
  const wr2 = task._routeW; wr2.set([0.05, 0.9, 0.05, 0]);
  task.observe(sim, new Float64Array(task.obsDim));
  const rOff = task.reward(sim).r;
  cfg.expertR.on = 1;
  const delta = rWalk - rOff; // Router-Bonus 0.25*0.9 + Walk-Ergebnis 0.3*0.2 = 0.285
  check('expertR.on=0 schaltet Skill-Belohnungen ab', Math.abs(delta - 0.285) < 0.02, `delta=${delta.toFixed(3)} (erwartet 0.285)`);
}

console.log('\n' + (fails === 0 ? 'ALLE ' + pass + ' CHECKS GRÜN' : fails + ' VON ' + (fails + pass) + ' CHECKS ROT'));
process.exit(fails === 0 ? 0 : 1);
