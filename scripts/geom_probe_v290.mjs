// geom_probe_v290.mjs — Prüft, welche mjModel/mjData-Felder das WASM-Binding
// für die Boden-Abhebe-Logik (placeBaseFull) hergibt.
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

for (const id of ['g1', 'duck']) {
  const cfg = getRobot(id);
  await fetchModelIntoFS('models/' + cfg.dir);
  const sim = new RobotSim(cfg, 'testfeld.xml');
  const m = sim.model, d = sim.data;
  console.log(`\n═══ ${id} (nu=${sim.nu}, ngeom=${sim.ngeom}, nbody=${sim.nbody}) ═══`);
  for (const f of ['geom_rbound', 'geom_aabb', 'geom_size', 'geom_pos', 'geom_quat', 'geom_type', 'geom_contype', 'geom_conaffinity', 'geom_bodyid', 'body_geomadr', 'body_geomnum']) {
    console.log(`  model.${f}:`, m[f] === undefined ? '✗ FEHLT' : `ok (len ${m[f].length})`);
  }
  for (const f of ['geom_xpos', 'geom_xmat', 'xpos', 'xquat']) {
    console.log(`  data.${f}:`, d[f] === undefined ? '✗ FEHLT' : `ok (len ${d[f].length})`);
  }
  // rbound-Werte der ersten Geoms
  if (m.geom_rbound) {
    const rb = Array.from(m.geom_rbound).slice(0, 8).map(v => (+v).toFixed(3));
    console.log('  geom_rbound[0..7]:', rb.join(', '));
  }
  if (m.geom_aabb) {
    const ab = Array.from(m.geom_aabb).slice(0, 12).map(v => (+v).toFixed(3));
    console.log('  geom_aabb[0..11]:', ab.join(', '));
  }
  sim.resetToKeyframe();
  if (d.geom_xpos) {
    let minZ = 9;
    for (let g = 0; g < sim.ngeom; g++) {
      if (m.geom_bodyid[g] === 0) continue;
      const t = m.geom_type[g];
      if (t === 0 || t === 2) continue; // plane/hfield
      minZ = Math.min(minZ, d.geom_xpos[3 * g + 2]);
    }
    console.log('  min geom_xpos[2] im Stand:', minZ.toFixed(4));
  }
  // Liegend-Test: Basis auf den Rücken drehen, dann schauen wo die Geoms sind
  sim.placeBaseFull(0, 0, 0.2, 0, 1, 0, 0); // 180° um X (Rücken)
  if (d.geom_xpos) {
    let minZ = 9;
    for (let g = 0; g < sim.ngeom; g++) {
      if (m.geom_bodyid[g] === 0) continue;
      const t = m.geom_type[g];
      if (t === 0 || t === 2) continue;
      minZ = Math.min(minZ, d.geom_xpos[3 * g + 2]);
    }
    console.log('  liegend (Rücken, Basis z=0,2): min geom_xpos[2] =', minZ.toFixed(4), minZ < 0 ? '← UNTER DEM BODEN!' : '');
  }
}
console.log('\nProbe fertig.');
