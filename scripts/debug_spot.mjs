// debug_spot.mjs — spot getup Ruhelage: welche Geoms hängen unten, und
// kollidieren sie wirklich mit dem Boden?
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

const id = process.argv[2] || 'spot';
const cfg = getRobot(id);
await fetchModelIntoFS('models/' + cfg.dir);
const sim = new RobotSim(cfg, 'testfeld.xml');
const mod = sim.model, dat = sim.data;
const t = makeRecoveryTask(cfg, 'getup');
t.reset({ range: (a, b) => a + (b - a) * 0.5, int: () => 0 }, sim);
for (let s = 0; s < 500; s++) sim.stepN(1);

// Boden-Geom finden (Plane) → contype/conaffinity
let floorG = -1;
for (let g = 0; g < sim.ngeom; g++) if (mod.geom_type[g] === 0 && mod.geom_bodyid[g] === 0) floorG = g;
console.log(`Boden-Geom g${floorG}: contype=${mod.geom_contype[floorG]} conaffinity=${mod.geom_conaffinity[floorG]}`);

// Kontakte mit dem Boden zählen
let floorCons = 0;
for (let i = 0; i < dat.ncon; i++) {
  const c = dat.contact.get(i);
  if (c.geom1 === floorG || c.geom2 === floorG) floorCons++;
}
console.log(`ncon=${dat.ncon}, davon mit Boden: ${floorCons}`);

const rows = [];
for (let g = 0; g < sim.ngeom; g++) {
  const body = mod.geom_bodyid[g];
  if (body === 0 || (sim._robotBody && !sim._robotBody[body])) continue;
  const ty = mod.geom_type[g];
  if (ty === 0 || ty === 1) continue;
  if (!(mod.geom_contype[g] & 1) && !(mod.geom_conaffinity[g] & 1)) continue;
  let bname = ''; try { bname = mj().mj_id2name(mod, 1, body) || ('b' + body); } catch (e) { bname = 'b' + body; }
  const R20 = dat.geom_xmat[9 * g + 2], R21 = dat.geom_xmat[9 * g + 5], R22 = dat.geom_xmat[9 * g + 8];
  const gz = dat.geom_xpos[3 * g + 2];
  let z = 99, src = '';
  if (ty === 7) {
    const did = mod.geom_dataid[g];
    const vAdr = mod.mesh_vertadr[did], vNum = mod.mesh_vertnum[did];
    let mn = Infinity;
    for (let i = 0; i < vNum; i++) {
      const wz = gz + R20 * mod.mesh_vert[3 * (vAdr + i)] + R21 * mod.mesh_vert[3 * (vAdr + i) + 1] + R22 * mod.mesh_vert[3 * (vAdr + i) + 2];
      if (wz < mn) mn = wz;
    }
    z = mn; src = `mesh(${vNum})`;
  } else if (ty === 3) {
    z = gz - (Math.abs(R22) * mod.geom_size[3 * g + 1] + mod.geom_size[3 * g]); src = 'capsule';
  } else { z = gz; src = 'type' + ty; }
  rows.push({ g, z, src, bname, ct: mod.geom_contype[g], ca: mod.geom_conaffinity[g] });
}
rows.sort((a, b) => a.z - b.z);
for (const r of rows.slice(0, 6)) console.log(`  g${r.g} ${r.bname} ct=${r.ct} ca=${r.ca} ${r.src} → minZ=${r.z.toFixed(4)}${r.z < 0 ? ' ←' : ''}`);
