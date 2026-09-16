// v2.13.1 Test: _visualCounts / _skipCollision Logik (aus render3d.js extrahiert, 1:1)
// Szenarien:
//  A) MicroDuck-Kopf: Body hat Visual-Meshes + head_collision-Box (group 3) → Box muss GESKIPPT werden
//  B) Hypothetischer Body mit NUR group-3-Geoms → Fallback: eines muss GERENDERT werden
//  C) Weltboden/Props (body 0, group 0) → nie geskippt
const G_PLANE = 0, G_HFIELD = 2;

function _visualCounts(sim) {
  const mod = sim.model;
  const nB = Math.max(mod.nbody || 1, 1);
  const visCnt = new Uint16Array(nB);
  for (let gI = 0; gI < sim.ngeom; gI++) {
    const t = mod.geom_type[gI];
    if (t === G_PLANE || t === G_HFIELD) continue;
    const b = mod.geom_bodyid[gI];
    if (b > 0 && b < nB && mod.geom_group[gI] !== 3) visCnt[b]++;
  }
  return visCnt;
}
function _skipCollision(sim, gI, visCnt) {
  const mod = sim.model;
  if (mod.geom_group[gI] !== 3) return false;
  const b = mod.geom_bodyid[gI];
  return b > 0 && b < visCnt.length && visCnt[b] > 0;
}

let fails = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) fails++;
}

// ── Szenario A: MicroDuck jaw_soft (verkürzt) ──────────────
// geoms: 0 floor(plane, body0), 1 visual lens(mesh,body1,g2), 2 visual face(mesh,body1,g2),
//        3 head_collision(box,body1,g3), 4 visual jaw(mesh,body1,g2)
const simA = {
  ngeom: 5, model: { nbody: 2,
    geom_type:   [G_PLANE, 7, 7, 6, 7],          // plane, mesh, mesh, box(6), mesh
    geom_bodyid: [0, 1, 1, 1, 1],
    geom_group:  [0, 2, 2, 3, 2] } };
const visA = _visualCounts(simA);
check("A1: jaw_soft hat 3 Visual-Geoms", visA[1] === 3);
check("A2: head_collision (g3) wird geskippt", _skipCollision(simA, 3, visA) === true);
check("A3: Visual-Geoms werden NICHT geskippt", !_skipCollision(simA, 1, visA) && !_skipCollision(simA, 2, visA) && !_skipCollision(simA, 4, visA));
check("A4: Boden (body0/plane) nie geskippt", !_skipCollision(simA, 0, visA));

// ── Szenario B: Body mit NUR group-3-Geoms (Fallback) ─────
const simB = { ngeom: 2, model: { nbody: 2,
  geom_type:   [6, 6],
  geom_bodyid: [1, 1],
  geom_group:  [3, 3] } };
const visB = _visualCounts(simB);
check("B1: keine Visual-Geoms gezählt", visB[1] === 0);
check("B2: Fallback → group-3 wird GERENDERT (nicht geskippt)", _skipCollision(simB, 0, visB) === false && _skipCollision(simB, 1, visB) === false);

// ── Szenario C: G1-artig — viele Kollisionsgeoms, alle versteckt ──
const simC = { ngeom: 4, model: { nbody: 2,
  geom_type:   [G_PLANE, 7, 6, 5],
  geom_bodyid: [0, 1, 1, 1],
  geom_group:  [0, 2, 3, 3] } };
const visC = _visualCounts(simC);
check("C1: 1 Visual gezählt", visC[1] === 1);
check("C2: beide Kollisions-Geoms geskippt", _skipCollision(simC, 2, visC) && _skipCollision(simC, 3, visC));

// ── Statik-Check der echten XMLs (Konsistenz mit Python-Analyse) ──
const { execSync } = require("child_process");
const out = execSync("python3 /home/z/my-project/scripts/check_collision_geoms.py", { encoding: "utf8" });
check("D1: XML-Analyse meldet 'SICHER für alle Modelle'", out.includes("SICHER für alle Modelle"));

console.log(fails === 0 ? "\nALLE TESTS GRÜN" : `\n${fails} TEST(S) FEHLGESCHLAGEN`);
process.exit(fails === 0 ? 0 : 1);
