// recovery_plugin_test.mjs — v2.7.0-Verifikation:
//   1) Recovery-Task 'getup': obsDim 3·nu+8, Start LIEGEND (upz<0, niedrig),
//      Reward endlich, Erfolg erst nach gehaltener Standphase, Zeitlimit
//   2) Recovery-Task 'drop': Start in der LUFT (h0+0,9…2,0), KEIN Erfolg vor
//      dem ersten Bodenkontakt, Erfolg danach, Abwurf-Neigungen normiert
//   3) PluginHost: Syntax-Check, Hooks (step/reward/reset), Reward-Boni,
//      Fehler → Plugin deaktiviert, Disposer, Storage-Namensraum,
//      BUILTIN-Plugins (Abwurf/Auto-Schubser) laufen mit Stub-API
// Läuft ohne MuJoCo (Stub-Sim reicht — nur Getter/Setter genutzt).

import { makeRecoveryTask, RECOVERY_R } from '../app/src/main/assets/www/js/recoverytask.js';
import { PluginHost, compilePlugin, BUILTIN_PLUGINS, MAX_PLUGIN_CODE } from '../app/src/main/assets/www/js/plugins.js';

let fails = 0;
const check = (name, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name);
  if (!cond) fails++;
};

// ── Stub-Sim: G1-ähnlich, Zustand von außen steuerbar ───────
function makeSim(nu = 6) {
  const s = {
    nu,
    keyCtrl: new Float64Array(nu),
    actRange: new Float64Array(nu * 2),
    actQposAdr: Array.from({ length: nu }, (_, i) => i),
    ctrl: new Float64Array(nu),
    _qpos: new Float64Array(20),
    _qvel: new Float64Array(12),
    data: { time: 0 },
    state: { pos: [0, 0, 0.79], quat: [1, 0, 0, 0] },
    lastPlace: null,
    resets: 0,
    reset() {
      this.resets++;
      this.data.time = 0;
      // Keyframe wiederherstellen (wie mj_resetDataKeyframe): Standpose
      this.state.pos = [0, 0, 0.79];
      this.state.quat = [1, 0, 0, 0];
    },
    basePos(out) { out[0] = this.state.pos[0]; out[1] = this.state.pos[1]; out[2] = this.state.pos[2]; return out; },
    baseQuat(out) { out[0] = this.state.quat[0]; out[1] = this.state.quat[1]; out[2] = this.state.quat[2]; out[3] = this.state.quat[3]; return out; },
    baseVelWorld(out) { out[0] = out[1] = out[2] = 0; return out; },
    // v2.8.0 Sensorblock-Getter (Stubs — Inhalt egal, Dimension zählt)
    gyroBody(out) { out[0] = 0; out[1] = 0; out[2] = 0; return out; },
    projectedGravity(out) { out[0] = 0; out[1] = 0; out[2] = 1; return out; },
    footContacts(out) { for (let i = 0; i < out.length; i++) out[i] = 0; return out; },
    jointPositions(out) { for (let i = 0; i < nu; i++) out[i] = 0.1 * i; return out; },
    jointVelocities(out) { for (let i = 0; i < nu; i++) out[i] = 0; return out; },
    placeBaseFull(x, y, z, qw, qx, qy, qz) {
      const n = Math.hypot(qw, qx, qy, qz) || 1;
      this.lastPlace = { x, y, z, qw: qw / n, qx: qx / n, qy: qy / n, qz: qz / n };
      this.state.pos = [x, y, z];
      this.state.quat = [qw / n, qx / n, qy / n, qz / n];
    },
  };
  for (let i = 0; i < nu; i++) { s.actRange[2 * i] = -1; s.actRange[2 * i + 1] = 1; }
  return s;
}

const upzOf = (q) => 1 - 2 * (q[1] * q[1] + q[2] * q[2]);

console.log('── 1) Recovery-Task AUFSTEHEN ──');
{
  const nu = 6;
  const cfg = { nu, actSpan: 0.4 };
  const sim = makeSim(nu);
  const t = makeRecoveryTask(cfg, 'getup');
  check("kind/mode: 'recovery'/'getup'", t.kind === 'recovery' && t.mode === 'getup');
  check('obsDim = 3·nu + 8 + Sensoren (9 + 0 Füße = 17)', t.obsDim === 3 * nu + 17 && t.actDim === nu);
  // Sensorblock ist IM obs: observe füllt exakt obsDim, letzte Kanäle = Phasen-Uhr
  t.reset(null, sim);
  const obs = new Float32Array(t.obsDim);
  const used = t.observe(sim, obs);
  check('observe füllt exakt obsDim (Sensorblock inklusive)', used === t.obsDim);
  check('Phasen-Uhr am Ende (sin/cos, |v| ≤ 1)', Math.abs(obs[t.obsDim - 2]) <= 1 && Math.abs(obs[t.obsDim - 1]) <= 1);

  // 20 Resets: NICHT stehend (Rücken/Bauch ≈ ∓1, Seite ≈ 0), niedrig,
  // Quat normiert — „liegend" heißt hier: deutlich unter der Standlage
  let lyingOk = true, normOk = true, lowOk = true;
  for (let k = 0; k < 20; k++) {
    t.reset(null, sim);
    const upz = upzOf(sim.state.quat);
    if (!(upz < 0.7)) lyingOk = false; // Seite liegt bei ~0, Rücken/Bauch bei ~−1
    if (!(sim.lastPlace.z > 0.001 && sim.lastPlace.z < 0.5 * 0.79)) lowOk = false;
    const q = sim.state.quat;
    if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-9) normOk = false;
  }
  check('Start: nicht stehend (upz < 0,7) in allen 20 Resets — liegend/Seite', lyingOk);
  check('Start: Basis niedrig (z < 0,5·h0)', lowOk);
  check('Start-Quaternion normiert', normOk);

  // Reward endet nicht sofort, ist endlich
  t.reset(null, sim);
  sim.data.time = 0.1;
  const { r, done } = t.reward(sim);
  check('liegend: Reward endlich, Episode läuft weiter', Number.isFinite(r) && !done);

  // Erfolg: aufrecht + hoch, 0,8 s GEHALTEN → done mit Bonus
  sim.state.pos = [0, 0, 0.79];
  sim.state.quat = [1, 0, 0, 0];
  let successSeen = false, bonusOk = false, earlyDone = false;
  for (let k = 0; k < 70; k++) { // 1,4 s
    sim.data.time += 0.02;
    const out = t.reward(sim);
    if (out.done) {
      if (k < 35) earlyDone = true; // vor ~0,7 s darf kein done kommen
      successSeen = true;
      if (out.r >= RECOVERY_R.successBonus) bonusOk = true;
      break;
    }
  }
  check('Erfolg erkannt (aufrecht + hoch, gehalten)', successSeen);
  check('Erfolgs-Bonus gezahlt (r ≥ ' + RECOVERY_R.successBonus + ')', bonusOk);
  check('Kein Vorzeit-done in der ersten halben Sekunde', !earlyDone);

  // Zeitlimit: t > 12 s → done
  t.reset(null, sim);
  sim.data.time = 13;
  check('Zeitlimit (12 s) beendet die Episode', t.reward(sim).done === true);
}

console.log('── 2) Recovery-Task ABWURF ──');
{
  const nu = 6;
  const cfg = { nu, actSpan: 0.4 };
  const sim = makeSim(nu);
  const t = makeRecoveryTask(cfg, 'drop');
  check("kind/mode: 'recovery'/'drop'", t.kind === 'recovery' && t.mode === 'drop');

  // 20 Resets: Start in der Luft, Quat normiert, Höhe in [h0+0,9; h0+2,0]
  let airOk = true, normOk = true, tiltOk = true;
  for (let k = 0; k < 20; k++) {
    t.reset(null, sim);
    const h = sim.lastPlace.z;
    if (!(h > 0.79 + 0.85 && h < 0.79 + 2.05)) airOk = false;
    const q = sim.state.quat;
    if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-9) normOk = false;
    if (Math.abs(upzOf(q)) > 1.01) tiltOk = false;
  }
  check('Start: in der Luft (h0 + 0,9…2,0 m)', airOk);
  check('Start-Quaternion normiert', normOk);
  check('Start-Neigung physikalisch (|upz| ≤ 1)', tiltOk);

  // In der Luft aufrecht = KEIN Erfolg (landed=false sperrt)
  t.reset(null, sim);
  sim.state.pos = [0, 0, 1.9];
  sim.state.quat = [1, 0, 0, 0];
  let premature = false;
  for (let k = 0; k < 60; k++) {
    sim.data.time += 0.02;
    if (t.reward(sim).done) { premature = true; break; }
  }
  check('In der Luft „aufrecht“ zählt NICHT als Erfolg', !premature);

  // Bodenkontakt → danach Erfolg möglich
  sim.state.pos = [0, 0, 0.2]; // < 0,55·h0 → landed
  sim.data.time += 0.02;
  t.reward(sim);
  sim.state.pos = [0, 0, 0.79];
  sim.state.quat = [1, 0, 0, 0];
  let successSeen = false;
  for (let k = 0; k < 70; k++) {
    sim.data.time += 0.02;
    if (t.reward(sim).done) { successSeen = true; break; }
  }
  check('Nach Bodenkontakt + Aufstehen = Erfolg', successSeen);
}

console.log('── 3) PluginHost (Werkstatt) ──');
{
  // Syntax-Check
  let threw = false;
  try { compilePlugin('synta(x {'); } catch (e) { threw = true; }
  check('Syntax-Fehler werden erkannt', threw);
  threw = false;
  try { compilePlugin('x'.repeat(MAX_PLUGIN_CODE + 1)); } catch (e) { threw = true; }
  check('Größenlimit greift', threw);

  const host = new PluginHost();
  const logs = [];
  let errors = [];
  host.setApiFactory((rec) => ({
    log: (m) => logs.push(rec.name + ':' + m),
    onStep: (f) => { host.hooks(rec.id).step.push(f); return () => {}; },
    onReward: (f) => { host.hooks(rec.id).reward.push(f); return () => {}; },
    onReset: (f) => { host.hooks(rec.id).reset.push(f); return () => {}; },
    onAct: (f) => { host.hooks(rec.id).act.push(f); return () => {}; },
    onFrame: (f) => { host.hooks(rec.id).frame.push(f); return () => {}; },
    ui: { addChip: () => ({ remove: () => {} }) },
    storage: {
      _m: new Map(),
      get(k, d) { return this._m.has(k) ? this._m.get(k) : d; },
      set(k, v) { this._m.set(k, v); return true; },
    },
  }));
  host.onError = (id, name, e) => errors.push(name + ':' + e.message);

  // Hook + Reward-Bonus + Disposer (new Function sieht nur globalThis —
  // daher der Marker global)
  globalThis.__plgDisposed = false;
  const rec1 = host.add({
    name: 'Bonus',
    code: `api.onStep((dt) => { if (dt < 0 || dt > 1) throw new Error('dt-Wahnsinn'); });
api.onReward((info) => 1.5 + info.r);
return () => { globalThis.__plgDisposed = true; };`,
    enabled: false,
  });
  const en = host.enable(rec1.id, true);
  check('Plugin mit Hooks installiert', en.ok);
  const out = host.fireReward(null, { r: 1, done: false });
  check('Reward-Bonus aggregiert (1 + 1,5 + 1 = 3,5)', Math.abs(out.r - 3.5) < 1e-9 && out.done === false);
  host.fireStep(0.02); // kein Fehler
  host.uninstall(rec1.id);
  check('Disposer läuft bei Deinstallation', globalThis.__plgDisposed === true);

  // done erzwingen über {bonus, done}
  const rec2 = host.add({ name: 'Stop', code: 'api.onReward(() => ({bonus: 0.25, done: true}));', enabled: false });
  host.enable(rec2.id, true);
  const out2 = host.fireReward(null, { r: 0.5, done: false });
  check('Plugin kann done erzwingen + Bonus geben', out2.done === true && Math.abs(out2.r - 0.75) < 1e-9);
  host.uninstall(rec2.id);

  // Fehler → Plugin deaktiviert + onError
  const rec3 = host.add({ name: 'Kaputt', code: 'api.onStep(() => { throw new Error("boom"); });', enabled: false });
  host.enable(rec3.id, true);
  host.fireStep(0.02);
  const rec3b = host.list.find(p => p.id === rec3.id);
  check('Hook-Fehler deaktiviert das Plugin', rec3b.enabled === false && errors.some(e => e.startsWith('Kaputt:boom')));
  // Nicht-Kaputt-Plugins laufen weiter
  const rec4 = host.add({ name: 'Gesund', code: 'api.onStep(() => {});', enabled: false });
  host.enable(rec4.id, true);
  host.fireStep(0.02);
  check('Andere Plugins laufen nach Fehler weiter', host.list.find(p => p.id === rec4.id).enabled === true);
}

console.log('── 4) BUILTIN-Plugins (Abwurf / Auto-Schubser) ──');
{
  check('Zwei BUILTIN-Beispiele vorhanden', BUILTIN_PLUGINS.length === 2
    && BUILTIN_PLUGINS.some(p => p.id === 'builtin_abwurf')
    && BUILTIN_PLUGINS.some(p => p.id === 'builtin_autopush'));

  const host = new PluginHost();
  let pushed = 0, chipCb = null;
  host.setApiFactory((rec) => ({
    log: () => {}, toast: () => {},
    sim: () => ({ basePos: (o) => { o[0] = 0; o[1] = 0; o[2] = 0.79; } }),
    teleport: (x, y, z) => { if (z > 1.4 && z < 2.2) pushed++; return true; },
    push: (s) => { pushed += 100 + s; return true; },
    onStep: (f) => { host.hooks(rec.id).step.push(f); return () => {}; },
    onFrame: (f) => { host.hooks(rec.id).frame.push(f); return () => {}; },
    ui: { addChip: ({ label, onClick }) => { chipCb = onClick; return { remove: () => {} }; } },
    storage: { get: (k, d) => d, set: () => true },
  }));

  const ab = host.add({ name: BUILTIN_PLUGINS[0].name, desc: '', code: BUILTIN_PLUGINS[0].code, enabled: false });
  const r1 = host.enable(ab.id, true);
  check('★ Abwurf-Plugin installiert', r1.ok);
  let chipThrew = false;
  try { chipCb && chipCb(); } catch (e) { chipThrew = true; }
  check('★ Abwurf-Button teleportiert in ~1,5–2,1 m Höhe', !chipThrew && pushed === 1);

  const ap = host.add({ name: BUILTIN_PLUGINS[1].name, desc: '', code: BUILTIN_PLUGINS[1].code, enabled: false });
  const r2 = host.enable(ap.id, true);
  check('★ Auto-Schubser installiert', r2.ok);
  let pushedOnce = false;
  for (let k = 0; k < 1200; k++) { host.fireStep(0.02); if (pushed >= 101) { pushedOnce = true; break; } } // 24 s
  check('★ Auto-Schubser schubst im Takt (8–15 s, Stärke 1,5–4,5)', pushedOnce && pushed < 100 + 5.5);
}

console.log(fails === 0 ? '\nALLE CHECKS GRÜN' : '\n' + fails + ' FEHLER');
process.exit(fails === 0 ? 0 : 1);
