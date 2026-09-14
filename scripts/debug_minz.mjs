// debug_minz.mjs — Welcher Geom meldet minZ < 0 nach liegend-Teleport?
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

const id = process.argv[2] || 'duck';
const cfg = getRobot(id);
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');
const mod = sim.model, dat = sim.data;

sim.resetToKeyframe();
sim.placeBaseFull(0, 0, 0.05, 0, 1, 0, 0); // Rücken zu niedrig

// erwartete halbe Z-Ausdehnung je Geom nachrechnen und Top-Tiefste listen
const rows = [];
for (let g = 0; g < sim.ngeom; g++) {
  const body = mod.geom_bodyid[g];
  if (body === 0) continue;
  const t = mod.geom_type[g];
  if (t === 0 || t === 1) continue;
  const s0 = mod.geom_size[3 * g], s1 = mod.geom_size[3 * g + 1], s2 = mod.geom_size[3 * g + 2];
  let ex, ey, ez, src;
  if (t === 2) { ex = ey = ez = s0; src = 'sphere'; }
  else if (t === 3) { ex = ey = s0; ez = s0 + s1; src = 'capsule'; }
  else if (t === 4) { ex = s0; ey = s1; ez = s2; src = 'ellipsoid'; }
  else if (t === 5) { ex = ey = s0; ez = s1; src = 'cylinder'; }
  else if (t === 6) { ex = s0; ey = s1; ez = s2; src = 'box'; }
  else {
    const ab = mod.geom_aabb;
    if (ab && Number.isFinite(ab[6 * g + 3]) && ab[6 * g + 3] < 10) {
      ex = ab[6 * g + 3]; ey = ab[6 * g + 4]; ez = ab[6 * g + 5]; src = 'aabb';
    } else {
      const rb = mod.geom_rbound ? mod.geom_rbound[g] : 0.05;
      ex = ey = ez = rb; src = 'rbound';
    }
  }
  const R20 = dat.geom_xmat[9 * g + 2], R21 = dat.geom_xmat[9 * g + 5], R22 = dat.geom_xmat[9 * g + 8];
  const halfZ = Math.abs(R20) * ex + Math.abs(R21) * ey + Math.abs(R22) * ez;
  const z = dat.geom_xpos[3 * g + 2] - halfZ;
  let bname = '';
  try { bname = mj().mj_id2name(mod, 1, body) || ('body' + body); } catch (e) { bname = 'body' + body; }
  rows.push({ g, z, halfZ, src, t, body, bname, gz: dat.geom_xpos[3 * g + 2] });
}
rows.sort((a, b) => a.z - b.z);
console.log(`${id}: tiefste 10 Geome nach Rücken-Teleport (Basis z=0.05):`);
for (const r of rows.slice(0, 10)) {
  console.log(`  g${r.g} body=${r.body}(${r.bname}) type=${r.t} src=${r.src} halfZ=${r.halfZ.toFixed(3)} zpos=${r.gz.toFixed(3)} → z=${r.z.toFixed(4)}${r.z < 0 ? '  ← UNTER BODEN' : ''}`);
}
// Body-Zugehörigkeit der Statics prüfen
console.log('body_mass der beteiligten Bodies (0 = statisch):');
for (const r of rows.slice(0, 10)) console.log(`  body ${r.body} (${r.bname}) mass=${mod.body_mass[r.body].toFixed(3)}`);
console.log('minGeomZ():', sim.minGeomZ().toFixed(4));
