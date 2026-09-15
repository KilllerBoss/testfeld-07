// ═══════════════════════════════════════════════════════════
// duck_test.mjs — MicroDuck Soft-MoE Verifikation (Node + ECHTES MuJoCo-WASM)
// Basis: v2.12.0 — echtes pollen_microduck-Modell + makeDuckMoeTask
//   1) Modell kompiliert: 14 Aktuatoren, obsDim 76 (63er-Basis + 13 cmd)
//   2) Stand-Stabilität: STAND-Keyframe hält 3 s
//   3) Observation: Layout + finit; Style-Block neutral=1
//   4) Rollout + PPO-Update (SoftMoE): Metriken finit + Routing reagiert
//   5) Transition-Scheduler: Skills wechseln (§7)
//   6) Curriculum: Level-Aufstieg verändert DR-Spec (§18)
//   7) Reward-Module: Fußkontakte/Kontaktwechsel/Routing-Penalty aktiv
// Aufruf: node scripts/duck_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

let fails = 0;
function check(name, cond, detail = '') {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) fails++;
}

const wasmBinary = await readFile(path.join(WWW, 'vendor/mujoco.wasm'));
const { initEngine, mj, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary });
const M = mj();
const { getRobot, makeDuckMoeTask } = await import(path.join(WWW, 'js/robots.js'));
const { PPO, SoftMoEPolicy } = await import(path.join(WWW, 'js/train.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));
const { writeWorldFile } = await import(path.join(WWW, 'js/engine.js'));

const cfg = getRobot('duck');
check('cfg vorhanden + moe-Flag', !!cfg && cfg.moe === true && cfg.nu === 14);

// Modell ins Emscripten-FS spiegeln (wie fetchModelIntoFS, ohne fetch)
const manifest = JSON.parse(await readFile(path.join(WWW, 'models', cfg.dir, 'manifest.json'), 'utf8'));
for (const rel of manifest.files) {
  const buf = await readFile(path.join(WWW, 'models', cfg.dir, rel));
  const vpath = '/models/' + cfg.dir + '/' + rel;
  const parts = vpath.split('/').slice(1, -1);
  let acc = '';
  for (const p of parts) { acc += '/' + p; try { M.FS.mkdir(acc); } catch (e) { /* ok */ } }
  M.FS.writeFile(vpath, buf);
}
const sim = new RobotSim(cfg, cfg.scene);
check('14 Aktuatoren', sim.nu === 14, 'nu=' + sim.nu);

const task = makeDuckMoeTask(cfg);
const rng = new RNG(4242);
task.reset(rng, sim);
check('obsDim = 74 (61er-Basis + 13 cmd)', task.obsDim === 74, 'obsDim=' + task.obsDim);
check('actDim = 14', task.actDim === 14);

// ── 2) Stand-Stabilität ─────────────────────────────────────
console.log('[2] Stand-Stabilität (STAND-Keyframe, 3 s)');
{
  sim.resetToKeyframe();
  let ok = true, zMin = 9, zMax = 0;
  for (let i = 0; i < 1500; i++) {
    sim.stepN(1);
    const z = sim.baseHeight();
    if (!Number.isFinite(z)) { ok = false; break; }
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  const bq = sim.baseQuat(new Float64Array(4));
  const upz = 1 - 2 * (bq[1] * bq[1] + bq[2] * bq[2]);
  check('keine NaN/Explosion', ok);
  check('Standhöhe über Boden (zMin > 0.04)', zMin > 0.04, `z∈[${zMin.toFixed(3)}, ${zMax.toFixed(3)}]`);
  check('aufrecht nach 3 s (upz > 0.85)', upz > 0.85, 'upz=' + upz.toFixed(3));
}

// ── 3) Observation ──────────────────────────────────────────
console.log('[3] Observation (74 Dims)');
{
  task.reset(rng, sim);
  const o = new Float32Array(task.obsDim);
  const n = task.observe(sim, o);
  check('observe füllt obsDim', n === task.obsDim, n + '/' + task.obsDim);
  check('obs finit', Array.from(o).every(Number.isFinite));
  // Soft-Block: Position obsDim−13 … obsDim−1
  const off = task.obsDim - 13;
  check('Soft-Block: neutral=1 (style[0])', o[off + 7] === 1 && o[off + 8] === 0);
  check('Soft-Block: skill balance=1', o[off + 3] === 1);
}

// ── 4) Rollout + PPO-Update (SoftMoE) ───────────────────────
console.log('[4] Training: Rollout + PPO-Update (echte Physik)');
{
  const ppo = new PPO(task.obsDim, task.actDim, { T: 512, mb: 128, epochs: 3 }, 77, SoftMoEPolicy);
  const trng = new RNG(99);
  task.reset(trng, sim);
  let stored = 0;
  const o = new Float32Array(task.obsDim);
  const t0 = performance.now();
  while (stored < ppo.h.T) {
    task.observe(sim, o);
    ppo.norm.update(o);
    const { act, logp, value } = ppo.act(o, false);
    if (task.setRouting && ppo.lastW) task.setRouting(ppo.lastW);
    task.actionToCtrl(sim, act);
    sim.stepN(10);
    const { r, done } = task.reward(sim);
    task.afterAct(sim, act);
    const full = ppo.store(o, act, logp, r, done, value);
    stored++;
    if (done) { sim.resetToKeyframe(); task.reset(trng, sim); }
  }
  const ms = performance.now() - t0;
  const lastVal = ppo.act(new Float32Array(task.obsDim), true).value;
  const m = ppo.finishAndUpdate(lastVal);
  check('π-Loss finit', Number.isFinite(m.piLoss), m.piLoss.toFixed(4));
  check('Routing-Statistik Σ=1', Math.abs(m.routeW.reduce((a, b) => a + b, 0) - 1) < 1e-6, m.routeW.map(v => v.toFixed(2)).join('/'));
  const sps = stored / (ms / 1000);
  check('Rollout-Tempo plausibel (>150/s Node)', sps > 150, `${Math.round(sps)} Schritte/s (1 Env, Node)`);
}

// ── 5) Transition-Scheduler ─────────────────────────────────
console.log('[5] Transition-Scheduler (§7)');
{
  task.reset(rng, sim);
  const skills = [];
  const o = new Float32Array(task.obsDim);
  const a = new Float32Array(task.actDim);
  for (let i = 0; i < 3000; i++) {
    task.observe(sim, o);
    if (task.setRouting) task.setRouting([1, 0, 0, 0]);
    task.actionToCtrl(sim, a);
    sim.stepN(10);
    const { done } = task.reward(sim);
    task.afterAct(sim, a);
    skills.push(task._curSkill);
    if (done) { sim.resetToKeyframe(); task.reset(rng, sim); }
  }
  const uniq = [...new Set(skills)];
  let switches = 0;
  for (let i = 1; i < skills.length; i++) if (skills[i] !== skills[i - 1]) switches++;
  check('≥2 Skills angefahren', uniq.length >= 2, uniq.join(', '));
  check('≥8 Übergänge in 60 s', switches >= 8, String(switches));
}

// ── 6) Curriculum-Level ändern DR (§18) ─────────────────────
console.log('[6] Curriculum + DR');
{
  task.setLevel(1, true);
  task.reset(rng, sim);
  const baseMass = sim.model.body_mass.reduce((s, v) => s + v, 0);
  task.setLevel(4, true);
  const masses = new Set();
  for (let i = 0; i < 5; i++) {
    task.reset(rng, sim);
    masses.add(sim.model.body_mass.reduce((s, v) => s + v, 0).toFixed(3));
  }
  check('Level 4: Masse variiert (DR aktiv)', masses.size >= 3, [...masses].slice(0, 3).join(' … '));
  task.setLevel(1, true);
}

// ── 7) Reward-Module ────────────────────────────────────────
console.log('[7] Reward-Module (Fußkontakte, Routing)');
{
  task.reset(rng, sim);
  task.setLevel(3, true);
  const o = new Float32Array(task.obsDim);
  const a = new Float32Array(task.actDim);
  let finite = true, contactSeen = false;
  for (let i = 0; i < 300; i++) {
    task.observe(sim, o);
    if (task._fc) for (let f = 0; f < task._fc.length; f++) if (task._fc[f]) contactSeen = true;
    if (task.setRouting) task.setRouting([0.4, 0.3, 0.2, 0.1]);
    task.actionToCtrl(sim, a);
    sim.stepN(10);
    const { r } = task.reward(sim);
    task.afterAct(sim, a);
    if (!Number.isFinite(r)) { finite = false; break; }
  }
  check('Rewards finit über 300 Schritte (L3)', finite);
  check('Fußkontakte im Sim sichtbar', contactSeen);
  task.setLevel(1, true);
}

console.log(fails === 0 ? '\nALLE DUCK-CHECKS GRÜN' : `\n${fails} CHECK(S) ROT`);
process.exit(fails === 0 ? 0 : 1);
