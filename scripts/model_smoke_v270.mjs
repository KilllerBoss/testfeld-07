// model_smoke_v270.mjs — Smoke-Test der neuen Modelle (go2 + microduck):
// kompilieren, Keyframe-Stand halten, Sensoren lesen, Fußkontakte zählen.
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

const { initEngine, mj, fetchModelIntoFS, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

for (const id of ['a1', 'spot', 'g1', 'go2', 'duck']) {
  console.log(`\n═══ ${id} ═══`);
  const cfg = getRobot(id);
  await fetchModelIntoFS('models/' + cfg.dir);
  let sim;
  try {
    sim = new RobotSim(cfg, 'testfeld.xml');
    check(`${id}: kompiliert (nu=${sim.nu})`, sim.nu === cfg.nu, `nu=${sim.nu} vs cfg ${cfg.nu}`);
  } catch (e) { check(`${id}: kompiliert`, false, e.message); continue; }
  check(`${id}: Sensoren vorhanden (Gyro+Accel)`, sim._gyroAdr >= 0 && sim._accelAdr >= 0, `gyro@${sim._gyroAdr} accel@${sim._accelAdr}`);
  check(`${id}: Füße aufgelöst`, sim.nFeet === cfg.footBodies.length, `nFeet=${sim.nFeet}`);

  // Stand halten: 3 s
  sim.resetToKeyframe();
  const pg = new Float64Array(3), fc = new Float64Array(sim.nFeet), gy = new Float64Array(3);
  let minZ = 9, fell = false, contactSeen = 0;
  for (let i = 0; i < 1500; i++) { // 3 s bei dt=0.002
    sim.stepN(1);
    sim.basePos(pg); // wiederverwenden als tmp
    if (pg[2] < minZ) minZ = pg[2];
    if (pg[2] < cfg.done.zMin) { fell = true; break; }
    sim.footContacts(fc);
    contactSeen = Math.max(contactSeen, fc.reduce((a, b) => a + b, 0));
  }
  check(`${id}: hält STAND 3 s ohne Sturz`, !fell, `minZ=${minZ.toFixed(3)} (zMin ${cfg.done.zMin})`);
  check(`${id}: Fußkontakte erkannt`, contactSeen >= 1, `max gleichzeitig=${contactSeen}`);
  sim.gyroBody(gy);
  check(`${id}: Gyro ≈ 0 im Stand`, Math.hypot(gy[0], gy[1], gy[2]) < 0.15, `${gy.map(v => v.toFixed(3))}`);
  sim.projectedGravity(pg);
  check(`${id}: projizierte Gravitation ≈ (0,0,-1)`, Math.abs(pg[0]) < 0.1 && Math.abs(pg[1]) < 0.1 && Math.abs(pg[2] + 1) < 0.1, `${pg.map(v => v.toFixed(3))}`);
  const acc = new Float64Array(3); sim.accelBody(acc);
  check(`${id}: Accelerometer stehend ≈ (0,0,±9,8)`, Math.abs(Math.hypot(...acc) - 9.81) < 1.5, `${acc.map(v => v.toFixed(2))}`);

  // Gait anwenden (5 s Vorwärts): kein Sturz, bewegt sich
  sim.resetToKeyframe();
  const gait = cfg.gait(cfg);
  const cmd = { vx: cfg.speedMax * 0.5, yaw: 0 };
  const out = {};
  let fell2 = false, moved = 0;
  for (let i = 0; i < 2500; i++) { // 5 s
    gait.step(sim, 0.002, cmd, out);
    for (const n in out) { const a = sim.actByName[n]; if (a !== undefined) sim.ctrl[a] = out[n]; }
    sim.stepN(1);
    sim.basePos(pg);
    if (pg[2] < cfg.done.zMin) { fell2 = true; break; }
    moved = pg[0];
  }
  // G1-March: offener Shuffle, kippt irgendwann (Known-Behavior seit v2.1.0,
  // im App-Betrieb fängt checkFall das ab) → informativ statt hart
  if (id === 'g1') console.log(`  ℹ g1: Shuffle-Gait ${fell2 ? 'kippte (offener Loop, bekannt)' : 'überstand'} — End-x=${moved.toFixed(3)}`);
  else check(`${id}: Gait 5 s ohne Sturz`, !fell2, `End-x=${moved.toFixed(3)}`);
  sim.dispose();
}

console.log(fails === 0 ? '\nALLE CHECKS GRÜN' : `\n${fails} FEHLER`);
process.exit(fails === 0 ? 0 : 1);
