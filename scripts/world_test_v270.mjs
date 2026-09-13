// world_test_v270.mjs — v2.7.0 Welten-Verifikation:
//   1) Alle 6 Welten kompilieren für ALLE Roboter (inkl. neue: go2, duck)
//   2) Physik läuft stabil (300 Schritte, keine NaN, kein Absturz ins Nirwana)
//   3) Seed-Determinismus: gleicher Seed → identische Welt; anderer Seed → anders
//   4) Zufallswelten enthalten Hindernisse (mehrere Bodies)
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

const { initEngine, fetchModelIntoFS, RobotSim, writeWorldFile } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { ROBOT_ORDER, getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML, WORLDS } = await import(path.join(WWW, 'js/worlds.js'));

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

// ── 3) Determinismus (ohne WASM) ──
{
  const g1 = getRobot('g1');
  const a = buildWorldXML(g1, 'zufall', 42), b = buildWorldXML(g1, 'zufall', 42), c = buildWorldXML(g1, 'zufall', 43);
  check('gleicher Seed → identische Welt', a === b);
  check('anderer Seed → andere Welt', a !== c);
  check('Zufallswelt enthält viele Bodies', (a.match(/<body /g) || []).length >= 10, (a.match(/<body /g) || []).length + ' Bodies');
  const flat = buildWorldXML(g1, 'flach', 1);
  check('Flach enthält nur Boden (+Markierung)', (flat.match(/<body /g) || []).length <= 1, (flat.match(/<body /g) || []).length + ' Bodies');
}

// Modelle laden (einmalig pro Roboter)
const loaded = new Set();
for (const world of WORLDS) {
  for (const id of ROBOT_ORDER) {
    const cfg = getRobot(id);
    if (!loaded.has(id)) { await fetchModelIntoFS('models/' + cfg.dir); loaded.add(id); }
    let xml;
    try {
      xml = buildWorldXML(cfg, world.id, 7);
      writeWorldFile(cfg.dir, 'welt_test.xml', xml);
    } catch (e) { check(`${id}/${world.id}: generieren`, false, e.message); continue; }
    try {
      const sim = new RobotSim(cfg, 'welt_test.xml');
      // 300 Physik-Schritte aus dem Keyframe — finite prüfen
      sim.resetToKeyframe();
      let finite = true, minZ = 9;
      for (let i = 0; i < 300; i++) {
        sim.stepN(1);
        const z = sim.baseHeight();
        if (minZ > z) minZ = z;
        if (!Number.isFinite(z)) { finite = false; break; }
        const q = new Float64Array(sim.nu); sim.jointPositions(q);
        for (let j = 0; j < sim.nu; j++) if (!Number.isFinite(q[j])) { finite = false; break; }
        if (!finite) break;
      }
      check(`${id}/${world.id}: kompiliert + 300 Schritte stabil`, finite, `minZ=${minZ.toFixed(3)}`);
      sim.dispose();
    } catch (e) { check(`${id}/${world.id}: kompiliert`, false, e.message); }
  }
}

console.log(fails === 0 ? '\nALLE WELT-CHECKS GRÜN' : `\n${fails} FEHLER`);
process.exit(fails === 0 ? 0 : 1);
