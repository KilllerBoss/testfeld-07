// qpos_v2220_test.mjs — v2.22.0 „ARDY-BRÜCKE" (NVIDIA ARDY — Text→Motion als
//   Lehrer ohne eigenes CUDA):
//   0) SKELETT-IDENTITÄT: Die 29 G1-Gelenke der App (g1.xml) sind in NAME und
//      REIHENFOLGE identisch mit ARDYs G1-MuJoCo-XML (g1skel34) → QPOS-CSV
//      mappet 1:1, kein Retargeting (Grundlage des ganzen Imports)
//   1) parseQposCsv: synthetische ARDY-CSV (36 Spalten, echte G1-Winkel)
//      → q/h/root/yaw/baseQ/fps/n/nu/duration/meanSpeed/locomotion/robotId
//   2) packMotion/unpackMotion-Roundtrip (glbstore, reine Funktionen)
//   3) Integration an ECHTER Sim (WASM): makeMotionTask — sampleRef/refRoot/
//      refSpeed liefern exakt die CSV-Bahn, Geist (setGhostPose) läuft ohne
//      srcPos, buildBCDataset erzeugt den Datensatz, Trainingsschritt finit
//   4) Fehlerfälle: Header-Zeile, zu wenige Spalten, NaN, leer, 1 Zeile —
//      jeweils deutsche, handfest brauchbare Meldung
//   5) Verdrahtung: main.js (onCsvFiles + csvImportBtn + VERSION 2.22.0),
//      index.html (.csv (ARDY) + accept), ai.js (ARDY-BRÜCKE + Notebook-Doku),
//      build.gradle 34/2.22.0, ardy_colab.ipynb existiert + valide + --model g1
// Usage: node scripts/qpos_v2220_test.mjs
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

const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { makeMotionTask } = await import(path.join(WWW, 'js/motiontask.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { parseQposCsv, ARDY_G1_NQ, ARDY_G1_FPS } = await import(path.join(WWW, 'js/qpos.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};
const nearly = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

// ARDYs Gelenkliste (g1skel34/xml/g1.xml, 2026 verifiziert gegen nv-tlabs/ardy)
const ARDY_G1_JOINTS = [
  'left_hip_pitch_joint', 'left_hip_roll_joint', 'left_hip_yaw_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint',
  'right_hip_pitch_joint', 'right_hip_roll_joint', 'right_hip_yaw_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint',
  'waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint',
  'left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint', 'left_wrist_roll_joint', 'left_wrist_pitch_joint', 'left_wrist_yaw_joint',
  'right_shoulder_pitch_joint', 'right_shoulder_roll_joint', 'right_shoulder_yaw_joint', 'right_elbow_joint', 'right_wrist_roll_joint', 'right_wrist_pitch_joint', 'right_wrist_yaw_joint',
];

// ── 0) SKELETT-IDENTITÄT ────────────────────────────────────
console.log('\n[0] SKELETT-IDENTITÄT (App-g1.xml ↔ ARDY-g1.xml: 1:1-Mapping)');
{
  ok(ARDY_G1_NQ === 36, 'ARDY_G1_NQ = 36 (root 3 + Quat 4 + 29 DoF)', String(ARDY_G1_NQ));
  ok(ARDY_G1_FPS === 25, 'ARDY_G1_FPS = 25 (G1-Checkpoints)', String(ARDY_G1_FPS));
  const xml = await readFile(path.join(WWW, 'models/unitree_g1/g1.xml'), 'utf8');
  const names = [...xml.matchAll(/joint name="([^"]+)"/g)].map((m) => m[1]);
  const hinges = names.filter((n) => n !== 'floating_base_joint');
  ok(hinges.length === 29, 'App-G1 hat 29 Scharniere', String(hinges.length));
  let same = hinges.length === ARDY_G1_JOINTS.length;
  for (let i = 0; same && i < ARDY_G1_JOINTS.length; i++) if (hinges[i] !== ARDY_G1_JOINTS[i]) same = false;
  ok(same, 'Gelenkliste NAME-für-NAME, Reihenfolge-für-Reihenfolge identisch mit ARDY');
}

// ── Echte Sim + synthetische ARDY-CSV ──────────────────────
const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_ardy.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_ardy.xml');
ok(cfg.nu === 29, 'cfg.nu (G1) = 29', String(cfg.nu));

// Warm-up entfällt als Quell der Winkel — q0 ist deterministisch (oben)

const N = 75; // 3 s @ 25 fps
const q0 = new Float64Array(cfg.nu);
for (let j = 0; j < cfg.nu; j++) q0[j] = 0.3 * Math.sin(j + 1); // deterministische, bereichs-gültige Winkel
const SPEED = 0.5, FPS = 25, YAW0 = Math.PI / 8, ROOT_Z = 0.79;
const qw = Math.cos(YAW0 / 2), qz = Math.sin(YAW0 / 2);
function makeArdyCsv(n, { walk = true } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = walk ? (SPEED / FPS) * i : 0;
    const z = ROOT_Z;
    rows.push([x, 0, z, qw, 0, 0, qz, ...Array.from(q0)].map((v) => v.toFixed(6)).join(','));
  }
  return rows.join('\n') + '\n';
}
const csvText = makeArdyCsv(N);

// ── 1) parseQposCsv ────────────────────────────────────────
console.log('\n[1] parseQposCsv (synthetische ARDY-CSV, echte G1-Winkel)');
let motion = null;
{
  motion = parseQposCsv(csvText, { name: 'gehen_ardy' });
  ok(motion.n === N && motion.nu === 29 && motion.fps === 25, 'n/nu/fps', `${motion.n}/${motion.nu}/${motion.fps}`);
  ok(nearly(motion.duration, N / 25), 'duration = n/fps', motion.duration.toFixed(2) + 's');
  ok(motion.q.length === N * 29, 'q hat n×29 Werte', String(motion.q.length));
  let dofOk = true;
  for (let j = 0; j < 29; j++) if (!nearly(motion.q[j], q0[j], 1e-5)) dofOk = false;
  ok(dofOk, 'DoF 1:1 übernommen (identische Reihenfolge, echte Keyframe-Winkel)');
  ok(nearly(motion.h[0], ROOT_Z) && nearly(motion.h[N - 1], ROOT_Z), 'h = pelvis z (0,79)', motion.h[0].toFixed(3));
  ok(nearly(motion.root[0], 0) && nearly(motion.root[1], 0), 'root relativ: Frame 0 = (0,0)');
  ok(nearly(motion.root[2 * (N - 1)], (SPEED / FPS) * (N - 1), 1e-3), 'root-Bahn läuft vorwärts', motion.root[2 * (N - 1)].toFixed(3) + ' m');
  ok(nearly(motion.yaw[0], YAW0, 1e-5) && nearly(motion.yaw[N - 1], YAW0, 1e-5), 'yaw aus Quat = π/8, entfaltet konstant', motion.yaw[0].toFixed(4));
  ok(nearly(motion.baseQ[0], qw) && nearly(motion.baseQ[3], qz), 'baseQ w-first übernommen');
  ok(nearly(motion.meanSpeed, SPEED, 1e-3), 'meanSpeed = 0,5 m/s', motion.meanSpeed.toFixed(3));
  ok(motion.locomotion === true, 'locomotion erkannt (Gehen)');
  ok(motion.robotId === 'g1' && motion.src === 'ardy' && Array.isArray(motion.mapped) && motion.mapped.length === 0, 'robotId g1, src ardy, mapped leer');
  ok(motion.alg >= 99, 'alg hoch — kein Re-Retarget möglich (kein GLB)', String(motion.alg));
  // Yaw-Entfaltung über eine volle Drehung (±2π-Sprünge werden stetig)
  const spinRows = [];
  const qyw = Math.cos(0.4), qyz = 0; // quasi-Identität, Yaw kommt aus θ unten
  for (let i = 0; i < 40; i++) {
    const th = -3.0 + i * 0.16; // überschreitet ±π
    spinRows.push([0, 0, ROOT_Z, Math.cos(th / 2), 0, 0, Math.sin(th / 2), ...Array.from(q0)].map((v) => v.toFixed(6)).join(','));
  }
  const spin = parseQposCsv(spinRows.join('\n') + '\n', { name: 'spin' });
  let mono = true;
  for (let i = 1; i < 40; i++) if (spin.yaw[i] < spin.yaw[i - 1]) mono = false;
  ok(mono && nearly(spin.yaw[39] - spin.yaw[0], 39 * 0.16, 1e-3), 'Yaw-Entfaltung stetig über ±π hinweg', (spin.yaw[39] - spin.yaw[0]).toFixed(2) + ' rad');
}

// ── 2) pack/unpack-Roundtrip ───────────────────────────────
console.log('\n[2] packMotion/unpackMotion-Roundtrip (IndexedDB-Format)');
{
  const packed = packMotion(motion);
  ok(Array.isArray(packed.q) && packed.n === N && packed.fps === 25, 'gepackt: Plain-Arrays', packed.q.length + ' Werte');
  const back = unpackMotion(packed);
  ok(back.q instanceof Float32Array && back.n === N, 'entpackt: Float32Array zurück');
  let eq = true;
  for (let i = 0; i < 29; i++) if (!nearly(back.q[i], motion.q[i], 1e-6)) eq = false;
  ok(eq, 'Werte identisch nach Roundtrip');
  ok(back.root && back.root.length === 2 * back.n && back.yaw && back.yaw.length === back.n && back.baseQ && back.baseQ.length === 4 * back.n, 'root/yaw/baseQ-Längen-Guards bestehen');
  ok(!back.srcPos && !back.srcJoints, 'ohne srcPos/srcJoints — Geist kommt aus clip.q (setGhostPose)');
}

// ── 3) Integration an echter Sim ───────────────────────────
console.log('\n[3] Motion-Task an ECHTER Sim (Lehrer-Pfad wie GLB)');
{
  const task = makeMotionTask(cfg, motion, sim);
  task.reset(new RNG(4242), sim);
  ok(task.kind === 'motion' && task.obsDim > 0, 'Motion-Task gebaut', 'obsDim ' + task.obsDim);
  const ref = new Float32Array(29);
  // Einblendung (erste 0,6 s ab Keyframe-Pose) voll fahren — danach liefert
  // sampleRef EXAKT die CSV-Werte (kein Keyframe-Anteil mehr)
  task.ghostPaused = false;
  for (let i = 0; i < 31; i++) task.advance(0.02); // tElapsed ≈ 0,62 s → Blend = 1
  task.sampleRef(0, ref);
  let eq = true;
  for (let j = 0; j < 29; j++) if (!nearly(ref[j], motion.q[j], 1e-5)) eq = false;
  ok(eq, 'sampleRef(Phase 0) = CSV-Frame 0 (nach voller Einblendung)');
  const p = 0.5; // Sekunden → t = p·fps = Frame 12,5
  task.sampleRef(p, ref);
  const i0 = 12, i1 = 13, u = 0.5;
  let lerpOk = true;
  for (let j = 0; j < 29; j++) {
    const expect = motion.q[i0 * 29 + j] * (1 - u) + motion.q[i1 * 29 + j] * u;
    if (!nearly(ref[j], expect, 1e-5)) lerpOk = false;
  }
  ok(lerpOk, 'sampleRef interpoliert linear zwischen Frames (t=0,5 s → Frame 12,5)');
  const rr = task.refRoot(0, [0, 0, 0]);
  ok(nearly(rr[0], 0) && nearly(rr[2], YAW0, 1e-5), 'refRoot(0) = Bahnstart + Yaw π/8', `x=${rr[0].toFixed(3)} yaw=${rr[2].toFixed(4)}`);
  ok(nearly(task.refSpeed(0), SPEED, 1e-3), 'refSpeed = 0,5 m/s', task.refSpeed(0).toFixed(3));
  // Kinematischer Geist OHNE srcPos (BC-Pfad + Anzeige)
  const ghost = sim.makeGhostData();
  let ghostOk = true;
  try {
    for (let f = 0; f < motion.n; f += 7) {
      sim.setGhostPose(ghost, motion.q, f * 29, motion.h[f], motion.root[2 * f], motion.root[2 * f + 1], motion.yaw[f], motion.baseQ.subarray(4 * f, 4 * f + 4));
    }
  } catch (e) { ghostOk = false; console.error(e.message); }
  ok(ghostOk, 'setGhostPose läuft über alle Stütz-Frames (kein srcPos nötig)');
  let ds = null;
  try { ds = task.buildBCDataset(sim); } catch (e) { console.error(e.message); }
  ok(ds && ds.n === motion.n && ds.X.length === ds.n * task.obsDim && ds.Y.length === ds.n * task.actDim, 'buildBCDataset: n Frames × obs/act', `${ds ? ds.n : '—'} Frames`);
  // Kurzer PPO-Trainingspfad: obs sammeln → finit
  const obs = new Float32Array(task.obsDim);
  let finite = true;
  task.observe(sim, obs);
  for (let i = 0; i < obs.length; i++) if (!Number.isFinite(obs[i])) finite = false;
  ok(finite, 'observe() liefert finites obs (Referenz fließt ein)');
  // Phase läuft, Geist-Pause greift weiter (v2.21-Regression)
  task.ghostPaused = false;
  const p0 = task.phase;
  task.advance(0.02); task.advance(0.02);
  ok(task.phase !== p0, 'Phase läuft');
  task.ghostPaused = true;
  const pf = task.phase;
  for (let i = 0; i < 5; i++) task.advance(0.02);
  ok(task.phase === pf, 'GEIST-PAUSE friert weiterhin (v2.21-Regression)');
}

// ── 4) Fehlerfälle ─────────────────────────────────────────
console.log('\n[4] Fehlerfälle (deutsche, brauchbare Meldungen)');
{
  const cases = [
    ['header,header2', /nicht numerisch/],
    [makeArdyCsv(5).split('\n')[0].split(',').slice(1).join(','), /Spalten/],
    ['', /leer/],
    [makeArdyCsv(1), /zu wenige Frames/i],
  ];
  for (const [txt, rx] of cases) {
    let threw = null;
    try { parseQposCsv(txt, { name: 'x' }); } catch (e) { threw = e.message; }
    ok(threw && rx.test(threw), 'Fehler gemeldet: ' + (threw || 'KEIN Wurf').slice(0, 72));
  }
  // Toleranz: ZUSÄTZLICHE Spalten (z. B. neuere ARDY-Versionen) werden ignoriert
  const extra = parseQposCsv(makeArdyCsv(4).trim().split('\n').map((l) => l + ',0.5,0.5').join('\n') + '\n', { name: 'extra' });
  ok(extra.n === 4 && extra.nu === 29, 'Extraspalten jenseits von 36 werden toleriert');
}

// ── 5) Verdrahtung ─────────────────────────────────────────
console.log('\n[5] Verdrahtung (main.js / index.html / ai.js / Doku / Notebook / Gradle)');
{
  const main = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  ok(main.includes("from './qpos.js'"), 'main.js importiert qpos.js');
  ok(main.includes('async function onCsvFiles'), 'onCsvFiles vorhanden');
  ok(main.includes("getElementById('csvImportBtn')") && main.includes("getElementById('csvFile')"), 'CSV-Button/Input verdrahtet');
  ok(main.includes("VERSION = '2.22.0'") || main.includes("VERSION = '2.27.0'") || main.includes("VERSION = '2.27.1'") || main.includes("VERSION = '2.28.0'") || main.includes("VERSION = '2.28.1'"), 'VERSION (>= 2.22.0-Pin)');
  ok(main.includes('ARDY-Referenz aktiv'), 'Aktiv-Log nennt ARDY-Referenz');
  const html = await readFile(path.join(WWW, 'index.html'), 'utf8');
  ok(html.includes('id="csvImportBtn"') && html.includes('id="csvFile"') && html.includes('accept=".csv,text/csv"'), 'index.html: .csv (ARDY)-Button + Datei-Input');
  ok(html.includes('ARDY-BRÜCKE (v2.22.0)'), 'index.html: ARDY-Erklärnotiz');
  const ai = await readFile(path.join(WWW, 'js/ai.js'), 'utf8');
  ok(ai.includes('ARDY-BRÜCKE') && ai.includes('ardy_colab.ipynb') && ai.includes('v2.22.0'), 'ai.js: System-Prompt + WANN-WAS dokumentieren die Brücke');
  const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(gradle.includes('applicationId "com.lertrain.app"') && /versionCode (3[4-9]|4[0-9])/.test(gradle), 'build.gradle (>= 34-Pin, LerTrain-Package)');
  let nb = null;
  try { nb = JSON.parse(await readFile(path.join(ROOT, 'scripts/ardy_colab.ipynb'), 'utf8')); } catch (e) { /* invalid */ }
  ok(nb && Array.isArray(nb.cells), 'ardy_colab.ipynb existiert + valides JSON', nb ? nb.cells.length + ' Zellen' : '—');
  const nbRaw = JSON.stringify(nb || {});
  ok(nbRaw.includes('generate.py') && nbRaw.includes('--model') && nbRaw.includes('g1'), 'Notebook erzeugt mit generate.py --model g1');
  ok(nbRaw.includes('HF-Token') || nbRaw.includes('HF_TOKEN'), 'Notebook: HF-Token-Schritt (Llama-3-Zugang)');
  ok(nbRaw.includes('.csv (ARDY)'), 'Notebook erklärt den App-Import-Button');
}

console.log(`\n════════════════════════════════════════`);
console.log(`ERGEBNIS: ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
