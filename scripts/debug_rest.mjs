// debug_rest.mjs — Vergleich: minGeomZ-Schätzung vs. echte Kontakt-Distanzen
// nach 1 s getup-Simulation (Microduck + G1).
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

for (const id of ['duck', 'g1']) {
  const cfg = getRobot(id);
  await fetchModelIntoFS('models/' + cfg.dir);
  const sim = new RobotSim(cfg, 'testfeld.xml');
  const mod = sim.model, dat = sim.data;
  const t = makeRecoveryTask(cfg, 'getup');
  t.reset({ range: (a, b) => a + (b - a) * 0.5, int: () => 0 }, sim);
  for (let s = 0; s < 500; s++) sim.stepN(1);

  // echte Kontakt-Penetration (dist < 0 = Eindringtiefe)
  let worst = { dist: 1 };
  const con = dat.contact;
  for (let i = 0; i < dat.ncon; i++) {
    const c = con.get(i);
    if (c.dist < worst.dist) worst = c;
  }
  console.log(`\n═══ ${id} nach 1 s getup ══`);
  console.log(`  ncon=${dat.ncon}, tiefster Kontakt dist=${worst.dist ? worst.dist.toFixed(4) : worst.dist}`);
  console.log(`  minGeomZ()-Schätzung: ${sim.minGeomZ().toFixed(4)}`);
  // Differenz-Analyse: welche Geome meldet minGeomZ als tiefste?
  // (die 3 tiefsten Roboter-Geome mit Zentrum + halfZ)
  const rows = [];
  for (let g = 0; g < sim.ngeom; g++) {
    const body = mod.geom_bodyid[g];
    if (body === 0 || (sim._robotBody && !sim._robotBody[body])) continue;
    const ty = mod.geom_type[g];
    if (ty === 0 || ty === 1) continue;
    const s0 = mod.geom_size[3 * g], s1 = mod.geom_size[3 * g + 1], s2 = mod.geom_size[3 * g + 2];
    let ex, ey, ez, src;
    if (ty === 2) { ex = ey = ez = s0; src = 'sphere'; }
    else if (ty === 3) { ex = ey = s0; ez = s0 + s1; src = 'capsule'; }
    else if (ty === 4) { ex = s0; ey = s1; ez = s2; src = 'ellipsoid'; }
    else if (ty === 5) { ex = ey = s0; ez = s1; src = 'cyl'; }
    else if (ty === 6) { ex = s0; ey = s1; ez = s2; src = 'box'; }
    else {
      const ab = mod.geom_aabb;
      if (ab && Number.isFinite(ab[6 * g + 3]) && ab[6 * g + 3] < 10) { ex = ab[6 * g + 3]; ey = ab[6 * g + 4]; ez = ab[6 * g + 5]; src = 'aabb'; }
      else { const rb = mod.geom_rbound ? mod.geom_rbound[g] : 0.05; ex = ey = ez = rb; src = 'rbound'; }
    }
    const R20 = dat.geom_xmat[9 * g + 2], R21 = dat.geom_xmat[9 * g + 5], R22 = dat.geom_xmat[9 * g + 8];
    const halfZ = Math.abs(R20) * ex + Math.abs(R21) * ey + Math.abs(R22) * ez;
    rows.push({ g, ty, src, halfZ, z: dat.geom_xpos[3 * g + 2] - halfZ, cz: dat.geom_xpos[3 * g + 2] });
  }
  rows.sort((a, b) => a.z - b.z);
  for (const r of rows.slice(0, 4)) console.log(`  tiefst: g${r.g} type=${r.ty} src=${r.src} zentrum=${r.cz.toFixed(4)} halfZ=${r.halfZ.toFixed(4)} → ${r.z.toFixed(4)}`);
}
