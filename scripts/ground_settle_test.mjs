// ground_settle_test.mjs — v2.9.0-Verifikation mit ECHTER Physik:
//
//   1) placeBaseFull/settleAboveGround: liegend/kopfüber gesetzte Roboter
//      hängen NIE in den Boden (minGeomZ ≥ −1e-6 nach dem Versetzen)
//   2) Recovery 'getup' („Aufgabe liegen"): Startpose liegt ÜBER dem Boden
//      und bleibt 1 s physikalisch sauber (keine NaN, kein Ausfliegen,
//      Roboter bleibt nah am Boden = liegt wirklich)
//   3) Recovery 'drop': Start in der Luft, Landung, danach finite Werte
//   4) _h0-Fix: Microduck-Erfolgsschwelle ist erreichbar (h0 = echte
//      Standhöhe, nicht 0,2-m-Klemme)
//   5) Kopfstand-BUILTIN-Plugin: onReset-Teleport kopfüber bleibt über dem
//      Boden; onReward liefert finite Boni und {done:false} hebt den
//      Sturz-Abbruch auf (fireReward-Override)
//
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const { initEngine, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { makeRecoveryTask } = await import(path.join(WWW, 'js/recoverytask.js'));
const { PluginHost, BUILTIN_PLUGINS, compilePlugin } = await import(path.join(WWW, 'js/plugins.js'));

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

const upzOf = (sim) => {
  const o = 4 * sim.baseBody;
  const x = sim._xquat[o + 1], y = sim._xquat[o + 2];
  return 1 - 2 * (x * x + y * y);
};

const sims = {};
for (const id of ['a1', 'spot', 'g1', 'go2', 'duck']) {
  const cfg = getRobot(id);
  await fetchModelIntoFS('models/' + cfg.dir);
  sims[id] = { cfg, sim: new RobotSim(cfg, 'testfeld.xml') };
}

console.log('\n═══ 1) placeBaseFull: kopfüber/rücken/seite bleibt ÜBER dem Boden ═══');
{
  // Basis-Quaternionen: Rücken (180° X), Bauch (−180° X), Seite (90° Y), kopfüber+Gieren
  const poses = [
    ['Rücken', (cy, sy) => [0, cy, 0, sy]],
    ['Bauch', (cy, sy) => [0, -cy, 0, sy]],
    ['Seite+', () => [0, 0, Math.SQRT1_2, 0]],
    ['Seite−', () => [0, 0, -Math.SQRT1_2, 0]],
  ];
  for (const [id, { sim }] of Object.entries(sims)) {
    let ok = true, worst = 9, worstP = '';
    for (const [pname, qf] of poses) {
      for (let k = 0; k < 6; k++) {
        const yaw = k * 1.0472; // 0..314°
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
        const [qw, qx, qy, qz] = qf(cy, sy);
        sim.placeBaseFull(0, 0, 0.05, qw, qx, qy, qz); // absichtlich ZU niedrig
        const mz = sim.minGeomZ(true);
        if (mz < worst) { worst = mz; worstP = pname; }
        if (mz < -1e-6) { ok = false; break; }
      }
    }
    check(`${id}: 24 gekippte Lagen alle ≥ 0 (min ${worst.toFixed(4)} @ ${worstP})`, ok);
  }
}

console.log('\n═══ 2) „Aufgabe liegen" (getup): Start über dem Boden, 1 s stabil ═══');
{
  for (const [id, { cfg, sim }] of Object.entries(sims)) {
    const t = makeRecoveryTask(cfg, 'getup');
    let ok = true, detail = '';
    for (let i = 0; i < 12 && ok; i++) {
      t.reset({ range: (a, b) => a + (b - a) * 0.5, int: () => 0 }, sim); // deterministisch
      const mz0 = sim.minGeomZ(true);
      if (mz0 < -1e-6) { ok = false; detail = `Reset ${i}: Start minZ ${mz0.toFixed(4)}`; break; }
      if (!(upzOf(sim) < 0.2)) { ok = false; detail = `Reset ${i}: nicht liegend (upz ${upzOf(sim).toFixed(2)})`; break; }
      let finite = true, vmax = 0;
      const restMinZ = []; // letzte 0,2 s: Roboter muss AUF dem Boden liegen
      for (let s = 0; s < 500; s++) { // 1 s
        sim.stepN(1);
        const q = sim._qvel;
        if (!Number.isFinite(q[0] + q[1] + q[2] + q[3] + q[4] + q[5])) { finite = false; break; }
        if (s < 499) { /* weiter */ }
        const sp = Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) + Math.abs(q[3]) + Math.abs(q[4]) + Math.abs(q[5]);
        if (sp > vmax) vmax = sp;
        if (s >= 400 && s % 5 === 0) restMinZ.push(sim.minGeomZ(true)); // gedrosselt (Vertex-Scan)
      }
      if (!finite) { ok = false; detail = `Reset ${i}: NaN in qvel`; break; }
      if (vmax > 60) { ok = false; detail = `Reset ${i}: Physik-Explosion (|v| ${vmax.toFixed(1)})`; break; }
      const worstRest = Math.min(...restMinZ);
      if (worstRest < -0.06) { ok = false; detail = `Reset ${i}: endet tief IM Boden (${worstRest.toFixed(4)})`; break; }
      const p = [0, 0, 0]; sim.basePos(p);
      const standZ = t._h0;
      if (p[2] > standZ + 0.3) { ok = false; detail = `Reset ${i}: ausgeflogen (z=${p[2].toFixed(2)})`; break; }
    }
    check(`${id}: 12 getup-Starts bodenfrei, 1 s NaN-frei, liegt AUF dem Boden`, ok, detail);
  }
}

console.log('\n═══ 3) „Aufgabe liegen": _h0 = echte Standhöhe (Microduck-Erfolg möglich) ═══');
{
  for (const [id, { cfg, sim }] of Object.entries(sims)) {
    sim.resetToKeyframe();
    const p = [0, 0, 0]; sim.basePos(p);
    const standZ = p[2];
    const t = makeRecoveryTask(cfg, 'getup');
    t.reset({ range: (a, b) => a + (b - a) * 0.5, int: () => 0 }, sim);
    // Nach getup-Reset liegt der Roboter — aber _h0 wurde VOR dem Umlegen
    // aus der Keyframe-Standhöhe gemessen (sim.reset() stellt das Keyframe her)
    const ok = Math.abs(t._h0 - standZ) < 0.12 && t._h0 >= 0.05;
    check(`${id}: _h0 ${t._h0.toFixed(3)} ≈ Standhöhe ${standZ.toFixed(3)}`, ok);
    // Erfolgsschwelle ERREICHBAR: 0.72·_h0 < Standhöhe
    check(`${id}: Erfolgsschwelle ${(0.72 * t._h0).toFixed(3)} < Standhöhe ${standZ.toFixed(3)}`, 0.72 * t._h0 < standZ);
  }
}

console.log('\n═══ 4) drop: Start in der Luft, Landung finite, ruht auf dem Boden ═══');
{
  const { cfg, sim } = sims.g1;
  const t = makeRecoveryTask(cfg, 'drop');
  let ok = true, detail = '';
  for (let i = 0; i < 6 && ok; i++) {
    t.reset({ range: (a, b) => a + (b - a) * (i / 6), int: () => 0 }, sim);
    const p = [0, 0, 0]; sim.basePos(p);
    if (p[2] < 1.0) { ok = false; detail = `Start zu niedrig: ${p[2].toFixed(2)}`; break; }
    let finite = true;
    const restMinZ = [];
    for (let s = 0; s < 4000; s++) { // 8 s fallen + landen + ruhen
      sim.stepN(1);
      const q = sim._qvel;
      if (!Number.isFinite(q[0] + q[2])) { finite = false; break; }
      if (s >= 3800 && s % 10 === 0) restMinZ.push(sim.minGeomZ(true)); // gedrosselt
    }
    if (!finite) { ok = false; detail = 'NaN nach Landung'; break; }
    const worstRest = Math.min(...restMinZ);
    if (worstRest < -0.045) { ok = false; detail = `ruht tief IM Boden: ${worstRest.toFixed(3)}`; break; }
  }
  check('G1 drop: 6 Starts (0,9–2 m), Landung finite & ruht auf dem Boden', ok, detail);
}

console.log('\n═══ 5) Kopfstand-BUILTIN: Teleport kopfüber bodenfrei + done:false-Override ═══');
{
  const kopf = BUILTIN_PLUGINS.find(p => p.id === 'builtin_kopfstand');
  check('Kopfstand-BUILTIN existiert', !!kopf);
  const host = new PluginHost();
  const { cfg, sim } = sims.duck; // kleiner Roboter als Härtefall
  const api = {
    log: () => {}, toast: () => {},
    sim: () => sim,
    teleport: (x, y, z, qw, qx, qy, qz) => sim.placeBaseFull(x, y, z, qw, qx, qy, qz),
    onReset: (f) => { host.hooks('t').reset.push(f); return () => {}; },
    onReward: (f) => { host.hooks('t').reward.push(f); return () => {}; },
  };
  host.setApiFactory(() => api);
  host.plugins.push({ id: 't', name: kopf.name, desc: '', code: kopf.code, enabled: true, builtin: true });
  const inst = host.install('t');
  check('Kopfstand-Plugin installiert sich', inst.ok, inst.error || '');

  // onReset feuern → kopfüber — muss über dem Boden sein
  host.fireReset();
  const mz = sim.minGeomZ(true);
  check(`onReset-Teleport kopfüber bodenfrei (minZ ${mz.toFixed(4)})`, mz >= -1e-6);
  const u0 = upzOf(sim);
  check(`kopfüber angekommen (upz ${u0.toFixed(2)} < −0.5)`, u0 < -0.5);

  // fireReward: Sturz-Abbruch (done:true) MUSS durch {done:false} aufgehoben werden
  sim.resetToKeyframe();
  host.fireReset(); // wieder kopfüber
  const out = host.fireReward(sim, { r: 0.1, done: true, upz: upzOf(sim), height: 0.1, task: { kind: 'speed' } });
  check('done:true (Sturz) wurde durch Plugin aufgehoben', out.done === false, `done=${out.done}`);
  check('Bonus finite & positiv für kopfüber', Number.isFinite(out.r) && out.r > 0.1, `r=${out.r.toFixed(3)}`);

  // 100 Reward-Schritte kopfüber ruhig → okT steigt, kein Fehler-Deaktivieren
  let deact = false;
  host.onError = () => { deact = true; };
  for (let i = 0; i < 100; i++) host.fireReward(sim, { r: 0.1, done: true, upz: upzOf(sim), height: 0.1, task: { kind: 'speed' } });
  check('100 Reward-Schritte ohne Plugin-Deaktivierung', !deact);
  const rec2 = host.plugins.find(p => p.id === 't');
  check('Plugin bleibt aktiviert', rec2 && rec2.enabled);
}

console.log('\n═══ 6) PluginHost done:false-Override (Einheitstest) ═══');
{
  const host = new PluginHost();
  host.setApiFactory(() => ({ onReward: (f) => { host.hooks('x').reward.push(f); return () => {}; } }));
  host.plugins.push({ id: 'x', name: 'X', code: 'api.onReward((info) => ({ bonus: 0.5, done: false }));', enabled: true });
  host.install('x');
  const a = host.fireReward(null, { r: 1, done: true });
  check('{bonus:0.5, done:false} → r=1.5, done=false', a.r === 1.5 && a.done === false);
  host.uninstall('x');
  host.plugins = host.plugins.filter(p => p.id !== 'x');
  host.plugins.push({ id: 'y', name: 'Y', code: 'api.onReward(() => ({ bonus: 0, done: true }));', enabled: true });
  host.setApiFactory(() => ({ onReward: (f) => { host.hooks('y').reward.push(f); return () => {}; } }));
  host.install('y');
  const b = host.fireReward(null, { r: 1, done: false });
  check('{done:true} erzwingt weiter done=true', b.done === true);
}

console.log(fails ? `\n${fails} FEHLER` : '\nALLE CHECKS GRÜN');
process.exit(fails ? 1 : 0);
