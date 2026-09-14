// debug_minz2.mjs — Welches Geom meldet minGeomZ < 0 im Ruhzustand? Details.
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
const { makeRecoveryTask } = await import(path.join(WWW, 'js/recoverytask.js'));

const id = process.argv[2] || 'duck';
const cfg = getRobot(id);
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');
const mod = sim.model, dat = sim.data;
const t = makeRecoveryTask(cfg, 'getup');
t.reset({ range: (a, b) => a + (b - a) * 0.5, int: () => 0 }, sim);
for (let s = 0; s < 500; s++) sim.stepN(1);

// Kontakt-Wahrheit
let worstDist = 1;
for (let i = 0; i < dat.ncon; i++) { const c = dat.contact.get(i); if (c.dist < worstDist) worstDist = c.dist; }
console.log(`${id}: Kontakt-Wahrheit dist=${worstDist.toFixed(4)} (ncon=${dat.ncon}), minGeomZ=${sim.minGeomZ().toFixed(4)}`);

const rows = [];
for (let g = 0; g < sim.ngeom; g++) {
  const body = mod.geom_bodyid[g];
  if (body === 0 || (sim._robotBody && !sim._robotBody[body])) continue;
  const ty = mod.geom_type[g];
  if (ty === 0 || ty === 1) continue;
  let bname = ''; try { bname = mj().mj_id2name(mod, 1, body) || ('b' + body); } catch (e) { bname = 'b' + body; }
  const R20 = dat.geom_xmat[9 * g + 2], R21 = dat.geom_xmat[9 * g + 5], R22 = dat.geom_xmat[9 * g + 8];
  const gz = dat.geom_xpos[3 * g + 2];
  let z = 99, src = '';
  if (ty === 7) {
    const did = mod.geom_dataid[g];
    const vAdr = mod.mesh_vertadr[did], vNum = mod.mesh_vertnum[did];
    let mn = Infinity;
    for (let i = 0; i < vNum; i++) {
      const vx = mod.mesh_vert[3 * (vAdr + i)], vy = mod.mesh_vert[3 * (vAdr + i) + 1], vz = mod.mesh_vert[3 * (vAdr + i) + 2];
      const wz = gz + R20 * vx + R21 * vy + R22 * vz;
      if (wz < mn) mn = wz;
    }
    z = mn; src = `mesh vNum=${vNum}`;
  } else {
    z = gz; src = 'type' + ty + ' (nur Zentrum)';
  }
  rows.push({ g, z, src, bname, contype: mod.geom_contype[g], gz });
}
rows.sort((a, b) => a.z - b.z);
for (const r of rows.slice(0, 6)) {
  console.log(`  g${r.g} body=${r.bname} contype=${r.contype} ${r.src} zentrum=${r.gz.toFixed(4)} → minZ=${r.z.toFixed(4)}${r.z < 0 ? ' ←' : ''}`);
}
