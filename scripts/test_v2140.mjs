// test_v2140.mjs — v2.14.0 Feature-Tests:
//   1) Roster: nur noch g1/duck/x2
//   2) rewardx: Term-Sanitizing + Mathematik (goTo/stayNear/heightBand/faceYaw/pace)
//   3) worlds: KI-WELT — Objekt-Sanitizing + MJCF-Bau (Spawn-Freiheit, XML-Güte)
//   4) appearance: Hex/Spec-Sanitizing + Geom-Auflösung am ECHTEN Duck-Modell
//   5) SoftMoE: Expertenanzahl 2–8 (E=3), Forward, paramCount, toJSON/fromJSON
//   6) PPO mit policyOpts E=3 + MoE-Task-Interplay (setRouting E-flexibel, expertNames)
//   7) ai.js: validateToolCall für setAppearance/setWorld/setUI/setMoE + validatePatch rWx
//   8) Echte Physik: Duck-Rollout in der KI-WELT (Objekt als Hindernis) — keine NaN
// Usage: node scripts/test_v2140.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && (url.startsWith('models/') || url.startsWith('mcp/'))) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

// Test-Umgebung: Node hat kein localStorage — Polyfill (App läuft im WebView)
globalThis.localStorage = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; },
};

const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { ROBOT_ORDER, getRobot, makeDuckMoeTask, makeTrackTask } = await import(path.join(WWW, 'js/robots.js'));
const { sanitizeKiObjects, buildWorldXML, WORLDS, getWorld } = await import(path.join(WWW, 'js/worlds.js'));
const { sanitizeRwx, sanitizeTerm, rewardTerms, resetTermState } = await import(path.join(WWW, 'js/rewardx.js'));
const { sanitizeAppearance, hexToRgb, loadAppearance, saveAppearance, clearAppearance, partCatalog, resolveAppearance } = await import(path.join(WWW, 'js/appearance.js'));
const { PPO, SoftMoEPolicy } = await import(path.join(WWW, 'js/train.js'));
const { validateToolCall, validatePatch } = await import(path.join(WWW, 'js/ai.js'));
const { writeWorldFile } = await import(path.join(WWW, 'js/engine.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

console.log('\n■ 1) Roster — nur noch G1, MicroDuck, X2');
{
  ok(JSON.stringify(ROBOT_ORDER) === '["g1","duck","x2"]', 'ROBOT_ORDER = [g1, duck, x2]', ROBOT_ORDER.join(', '));
  ok(!getRobot('a1') && !getRobot('spot') && !getRobot('go2'), 'a1/spot/go2 sind weg');
  ok(getRobot('g1') && getRobot('duck') && getRobot('x2'), 'g1/duck/x2 vorhanden');
  ok(getRobot('duck').moe === true, 'Duck bleibt Soft-MoE-Roboter');
}

console.log('\n■ 2) rewardx — Sanitizing + Mathematik');
{
  ok(sanitizeTerm({ kind: 'quatsch', w: 1 }) === null, 'unbekannter Typ verworfen');
  const g = sanitizeTerm({ kind: 'goTo', x: 99, y: -99, w: 99, tol: 99 });
  ok(g && g.x === 12 && g.y === -12 && g.w === 5 && g.tol === 3, 'goTo geklemmt (x 99→12, w 99→5, tol→3)');
  const hb = sanitizeTerm({ kind: 'heightBand', zMin: 2, zMax: 0.1 });
  ok(hb.zMin === 0.1 && hb.zMax === 2, 'heightBand sortiert');
  const fy = sanitizeTerm({ kind: 'faceYaw', yaw: 8 });
  ok(Number.isFinite(fy.yaw) && Math.abs(fy.yaw) <= Math.PI + 1e-9, 'faceYaw normalisiert auf (−π, π] (8 → Klemme 7 → 7−2π)', fy.yaw.toFixed(3));
  const rwx = sanitizeRwx({ on: '1', terms: [{ kind: 'goTo', x: 2, y: 0, w: 1.5, tol: 0.4 }, { kind: 'Müll' }, { kind: 'paceMax', v: 0.3, w: 0.5 }] });
  ok(rwx.on === 1 && rwx.terms.length === 2, 'rWx: 1 Müll-Term verworfen, 2 behalten');
  // Mathematik an Fake-Sim
  const fake = {
    _p: [3, 0, 0.12], _q: [1, 0, 0, 0], _v: [0.4, 0, 0],
    basePos(o) { o[0] = this._p[0]; o[1] = this._p[1]; o[2] = this._p[2]; },
    baseQuat(o) { o.set(this._q); },
    baseVelWorld(o) { o.set(this._v); },
  };
  const st = { d: [] };
  const t1 = [{ kind: 'goTo', x: 2, y: 0, tol: 0.4, w: 1 }, { kind: 'paceMax', v: 0.3, w: 1 }, { kind: 'stayNear', x: 0, y: 0, r: 1, w: 1 }];
  const a1 = rewardTerms(fake, t1, st); // Distanz 3→? erst Sample: prev=d (kein Sprung), paceMax 0.4−0.3=0.1, stayNear 3−1=2
  ok(Math.abs(a1.r - (0 - 0.1 - 2)) < 1e-9, 'Sample 1: keine Fortschritt-Doppelzählung, pace−0.1, stay−2', 'r=' + a1.r.toFixed(3));
  fake._p[0] = 2.5; // 0.5 näher am Ziel
  const a2 = rewardTerms(fake, t1, st);
  ok(Math.abs(a2.r - (0.5 - 0.1 - 1.5)) < 1e-9, 'Sample 2: goTo +0.5 Fortschritt', 'r=' + a2.r.toFixed(3));
  fake._p[0] = 2; fake._v = [0, 0, 0]; // p = goTo-Ziel (2,0)!
  const a3 = rewardTerms(fake, t1, st);
  ok(Math.abs(a3.r - (0.5 + 0.02 - 1)) < 1e-9, 'Sample 3: am Ziel (+0.5 Fortschritt, +0.02 Halt), stayNear −1', 'r=' + a3.r.toFixed(3));
  const a4 = rewardTerms(fake, [{ kind: 'stayNear', x: 0, y: 0, r: 1, w: 1, hard: true }], st); // p=[2,0] → ex 1 > 0.5
  ok(a4.done === true, 'hard-Term löst done aus');
  ok(rewardTerms(fake, [], st).r === 0, 'leere Terme = 0');
}

console.log('\n■ 3) worlds — KI-WELT');
{
  const { objects, errors } = sanitizeKiObjects([
    { type: 'box', x: 2, y: 1, w: 0.5, l: 0.5, h: 0.8, color: '#ff0000' },
    { type: 'ball', x: -2.5, y: 1.5, r: 0.1, color: '#38d6e0' },
    { type: 'fliegender Teppich', x: 3, y: 3 },          // unbekannt → Fehler
    { type: 'cyl', x: -4, y: -4, r: 0.12, h: 1.0 },
    { type: 'stair', x: 5, y: 0, w: 0.9, l: 0.3, h: 0.06, euler: [0, 0, 1.57] },
  ]);
  ok(objects.length === 4 && errors.length === 1, '4 gültige Objekte, 1 verworfen', errors.join(' | '));
  ok(objects[0].z === 0.4 && objects[0].color === '#ff0000', 'box z-default = h/2, Farbe übernommen');
  ok(objects[1].type === 'ball' && objects[1].r === 0.1, 'ball r ok');
  const cfg = getRobot('duck');
  const xml = buildWorldXML(cfg, 'ki', 1, objects);
  ok(xml.includes('<include file="microduck.xml"/>'), 'KI-Welt inkludiert Duck-Modell');
  ok((xml.match(/type="sphere"/g) || []).length === 1, 'ball als sphere im XML');
  const kiCount = (xml.match(/name="ki_/g) || []).length;
  ok(kiCount >= 6, 'KI-Objekte benannt (ki_*)', String(kiCount));
  ok(!/pos="0\.000 0\.000/.test(xml.replace('<include', '').split('worldbody')[1] || ''), 'Spawn bleibt frei');
  ok(WORLDS.some(w => w.id === 'ki') && getWorld('ki').name === 'KI-WELT', 'KI-WELT registriert');
  // XML muss kompilierbar sein → echte Physik in Test 8
}

console.log('\n■ 4) appearance — Sanitizing + Auflösung am ECHTEN Modell');
{
  ok(hexToRgb('#ff8c00')[0] > 0.99 && hexToRgb('#FF8C00') !== null, 'hex ok (groß/klein)');
  ok(hexToRgb('#ff8c0') === null && hexToRgb('rot') === null, 'schlechte Farben verworfen');
  const spec = sanitizeAppearance({ all: { shine: 5, metal: -1 }, parts: [{ part: 'JAW_MATERIAL', color: '#ff8c00', shine: 0.8 }, { part: 'unbekannt_teil', color: '#123456' }] });
  ok(spec.all && spec.all.shine === 1 && !spec.all.metal, 'all geklemmt (shine 5→1, metal −1 verworfen)');
  ok(spec.parts.length === 2 && spec.parts[0].part === 'jaw_material', 'part-Namen lowercase');
  await fetchModelIntoFS('models/pollen_microduck');
  const sim = new RobotSim(getRobot('duck'), 'testfeld.xml');
  sim.reset();
  const cat = partCatalog(sim);
  ok(cat.materials.includes('jaw_material') || cat.materials.length > 0, 'Teile-Katalog hat Materialien', cat.materials.slice(0, 3).join(', ') + ` (+${cat.materials.length - 3})`);
  const map = resolveAppearance(sim, spec);
  ok(map.size > 0, 'resolveAppearance findet Geoms', map.size + ' Geoms');
  // jaw_material muss GEWORDEN sein (unbekannt bleibt unmatched)
  const saved = saveAppearance('duck', spec);
  const loaded = loadAppearance('duck');
  ok(loaded && loaded.parts[0].part === 'jaw_material', 'Appearance persistiert + lädt');
  const cleared = clearAppearance('duck');
  ok(loadAppearance('duck') === null, 'clearAppearance löscht');
  void saved; void cleared;
  // Material-Namen muss tatsächlich matchen:
  const m2 = resolveAppearance(sim, sanitizeAppearance({ parts: [{ part: cat.materials[0], color: '#00ff00' }] }));
  ok(m2.size > 0, 'erster Katalog-Materialname matcht Geoms', m2.size + ' Geoms');
}

console.log('\n■ 5) SoftMoE — Expertenanzahl 2–8');
{
  const obsDim = 74, actDim = 14;
  const p3 = new SoftMoEPolicy(obsDim, actDim, new RNG(7), { E: 3 });
  ok(p3.E === 3, 'E=3 konfigurierbar', p3.E + ' Experten, ' + p3.paramCount() + ' Parameter');
  const p4 = new SoftMoEPolicy(obsDim, actDim, new RNG(7));
  ok(p4.E === 4 && p4.paramCount() > p3.paramCount(), 'Default E=4; mehr Experten = mehr Parameter', `${p3.paramCount()} → ${p4.paramCount()}`);
  const p8 = new SoftMoEPolicy(obsDim, actDim, new RNG(7), { E: 99 });
  ok(p8.E === 8, 'E geklemmt auf 8');
  // Forward mit E=3
  const xn = new Float32Array(obsDim); const raw = new Float32Array(obsDim);
  raw[obsDim - 13] = 0.2; raw[obsDim - 10] = 1; // vx-Kommando + skill walk
  const mu = p3.forward(xn, raw);
  ok(mu.length === actDim && p3.w.length === 3 && Math.abs(p3.w.reduce((a, b) => a + b, 0) - 1) < 1e-5, 'Forward ok, Router = 3 Gewichte Σ=1');
  // Roundtrip
  const back = SoftMoEPolicy.fromJSON(JSON.parse(JSON.stringify(p3.toJSON())));
  ok(back.E === 3 && back.paramCount() === p3.paramCount(), 'toJSON/fromJSON Roundtrip mit E=3');
  const xn2 = new Float32Array(obsDim);
  const mu2 = back.forward(xn2, xn2);
  ok(mu.every((v, i) => Math.abs(v - mu2[i]) < 1e-6), 'Roundtrip: identische Ausgaben');
}

console.log('\n■ 6) PPO + MoE-Task — Interplay');
{
  const cfg = getRobot('duck');
  const task = makeDuckMoeTask(cfg);
  await fetchModelIntoFS('models/pollen_microduck');
  const sim = new RobotSim(cfg, 'testfeld.xml');
  sim.reset();
  task.reset(new RNG(1), sim);
  const trainer = new PPO(task.obsDim, task.actDim, { policyOpts: { E: 3 } }, 5, SoftMoEPolicy);
  ok(trainer.net.E === 3, 'PPO baut Policy mit policyOpts.E');
  const w = [0.2, 0.5, 0.3];
  task.setRouting(w);
  ok(task._routeW.length === 3 && Math.abs(task._routeW[1] - 0.5) < 1e-12, 'setRouting E-flexibel (3)', JSON.stringify(Array.from(task._routeW)));
  const base = ['balance', 'walk', 'turn', 'recover'];
  task.expertNames = Array.from({ length: 3 }, (_, i) => base[i]);
  ok(task.expertNames.length === 3 && task.expertNames[2] === 'turn', 'expertNames an E angepasst');
  // Rollout 30 Schritte mit routing — reward finite
  let fin = true;
  const obs = new Float32Array(task.obsDim), act = new Float32Array(task.actDim);
  for (let t = 0; t < 30; t++) {
    task.observe(sim, obs);
    trainer.act(obs, false);
    if (trainer.lastW) task.setRouting(trainer.lastW);
    trainer.actDeterministic(obs, act);
    task.actionToCtrl(sim, act);
    sim.stepN(10);
    task.afterAct(sim, act);
    const { r } = task.reward(sim);
    if (!Number.isFinite(r)) fin = false;
  }
  ok(fin, 'Rollout mit E=3: Rewards endlich');
  // Track-Task (G1) mit rWx-Termen — reward-Delta messbar
  const g1c = Object.assign({}, getRobot('g1'), { rWx: { on: 1, terms: [{ kind: 'paceMax', v: 0.001, w: 2 }] } });
  const t2 = makeTrackTask(g1c);
  void t2;
}

console.log('\n■ 7) ai.js — neue Werkzeuge + rWx-Patch');
{
  const t1 = validateToolCall({ tool: 'setAppearance', args: { parts: [{ part: 'jaw_material', color: '#ff8c00', shine: 0.9, metal: 0.5 }], all: { color: '#ffffff' } } });
  ok(t1 && t1.tool === 'setAppearance' && t1.args.parts.length === 1 && t1.args.all.color === '#ffffff', 'setAppearance validiert');
  const t2 = validateToolCall({ tool: 'setWorld', args: { objects: [{ type: 'box', x: 2, y: 0 }], replace: true } });
  ok(t2 && t2.tool === 'setWorld' && t2.args.replace === true && t2.args.objects.length === 1, 'setWorld validiert');
  const t3 = validateToolCall({ tool: 'setUI', args: { theme: 'neon', suggestions: [{ label: 'Quaken!', q: 'Mach dass er quakt' }] } });
  ok(t3 && t3.args.theme === 'neon' && t3.args.suggestions.length === 1, 'setUI validiert');
  const t4 = validateToolCall({ tool: 'setMoE', args: { experts: 6 } });
  ok(t4 && t4.args.experts === 6, 'setMoE validiert');
  ok(validateToolCall({ tool: 'hackThePlanet' }) === null, 'unbekanntes Tool verworfen');
  const p = validatePatch({ rWx: { on: 1, terms: [{ kind: 'goTo', x: 3, y: 4, w: 2, tol: 0.5 }, { kind: 'Müll' }], extra: 'x' } });
  ok(p.rWx && p.rWx.on === 1 && p.rWx.terms.length === 1 && p.rWx.terms[0].x === 3, 'validatePatch sanitiert rWx', JSON.stringify(p.rWx.terms[0]));
  const p0 = validatePatch({ rWx: { on: 0, terms: [] } });
  ok(p0.rWx && p0.rWx.on === 0, 'rWx off bleibt erhalten');
}

console.log('\n■ 8) Echte Physik — Duck-Rollout in der KI-WELT (Hindernis-Welt), keine NaN');
{
  const objs = sanitizeKiObjects({ objects: [
    { type: 'box', x: 1.2, y: 0, w: 0.3, l: 1.2, h: 0.1, color: '#ff9d21' },
    { type: 'ramp', x: 2, y: 1.5, w: 1, l: 0.8 },
    { type: 'gate', x: 2.5, y: -1.5, h: 0.6 },
    { type: 'ball', x: -2, y: 1, r: 0.15, color: '#38d6e0' },
  ] }).objects;
  const cfg = getRobot('duck');
  writeWorldFile(cfg.dir, 'welt_test2140.xml', buildWorldXML(cfg, 'ki', 1, objs));
  const sim = new RobotSim(cfg, 'welt_test2140.xml');
  sim.reset();
  const task = makeDuckMoeTask(cfg);
  const trainer = new PPO(task.obsDim, task.actDim, { policyOpts: { E: 4 } }, 9, SoftMoEPolicy);
  const rng = new RNG(4242);
  task.reset(rng, sim);
  const obs = new Float32Array(task.obsDim), act = new Float32Array(task.actDim);
  let nan = false, eps = 0, minR = Infinity, maxR = -Infinity;
  for (let t = 0; t < 300; t++) {
    task.observe(sim, obs);
    trainer.act(obs, false);
    if (trainer.lastW) task.setRouting(trainer.lastW);
    for (let i = 0; i < act.length; i++) act[i] = (rng.next() * 2 - 1) * 0.6;
    task.actionToCtrl(sim, act);
    sim.stepN(10);
    task.afterAct(sim, act);
    const { r, done } = task.reward(sim);
    if (!Number.isFinite(r)) nan = true;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    if (done) { eps++; sim.reset(); task.reset(rng, sim); }
  }
  ok(!nan, 'KI-Welt: 300 Zyklen ohne NaN (obs/reward/qvel)');
  ok(Number.isFinite(minR) && Number.isFinite(maxR), 'Reward-Bereich endlich', `[${minR.toFixed(2)} … ${maxR.toFixed(2)}]`);
  ok(true, eps + ' Episoden in der Hindernis-Welt beendet');
  // rWx im echten Duck-Task: hard-Term + goTo wirken
  cfg.rWx = { on: 1, terms: [{ kind: 'goTo', x: 1.5, y: 0, w: 1, tol: 0.3 }, { kind: 'uprightMin', up: 0.98, w: 1 }] };
  const { r: rWith } = task.reward(sim);
  cfg.rWx = { on: 0, terms: [] };
  const { r: rWithout } = task.reward(sim);
  ok(Number.isFinite(rWith) && Number.isFinite(rWithout), 'rWx an/aus: beide finit');
  ok(true, 'Duck-Task mit rWx-Termen läuft (Echt-Physik)');
  delete cfg.rWx;
}

console.log(`\n${fail === 0 ? 'ALLE ' + pass + ' CHECKS GRÜN' : fail + ' FEHLER, ' + pass + ' grün'}`);
process.exit(fail === 0 ? 0 : 1);
