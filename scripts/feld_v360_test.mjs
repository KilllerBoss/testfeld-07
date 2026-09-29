// ═══════════════════════════════════════════════════════════
// feld_v360_test.mjs — POLLEN-OBS 61 + Einbackung + kein Manifest (v3.6.0)
//
// Nutzer: „LOADING POLICIES … GOT INVALID DIMENSIONS FOR INPUT: OBS …
// INDEX: 1 GOT: 61 EXPECTED: 74 … PLEASE FIX EITHER THE INPUTS/OUTPUTS OR
// THE MODEL. … Und manifest brauche ich auch nicht“
//
// Der echte Microduck speist seine native 61er-Obs (velstand.onnx:
// base_ang_vel, projected_gravity, joint_pos, joint_vel, actions, command,
// head_command, body_command). Dieser Test pinnt:
//   1) Task-Obs = exakt dieses Layout (61, Pollen-Reihenfolge)
//   2) Router liest RAW vx,vy,wz an cmdOff (kein Skill-Onehot/Prior)
//   3) Export backt actSpan·tanh(mu·J) ein → actions = Offsets in rad,
//      action_scale-Metadatum 1.000 (wie Originale)
//   4) ECHTE ort-node-Ausführung: obs [1,61] läuft; obs [1,74] MUSS
//      fehlschlagen (der Fehler des Nutzers ist damit strukturell weg)
//   5) KEIN Manifest mehr im Export (nur die .onnx)
//   6) Version 106 / 3.6.0 + CI-OR-Kette
// Aufruf: node scripts/feld_v360_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const read = (p) => readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? ' — ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const robots = read(join(WWW, 'js/robots.js'));
const trainjs = read(join(WWW, 'js/train.js'));
const ox = read(join(WWW, 'js/feld/onnxexport.js'));
const fj = read(join(WWW, 'js/feld/feld.js'));
const tj = read(join(WWW, 'js/feld/trainer.js'));
const sj = read(join(WWW, 'js/feld/store.js'));
const html = read(join(WWW, 'index.html'));
const vj = read(join(WWW, 'js/feld/version.js'));
const gradle = read(join(ROOT, 'app/build.gradle'));
const workflow = read(join(ROOT, '.github/workflows/build-apk.yml'));

console.log('── 1. Task-Obs = POLLEN-61 (robots.js) ──');
ok(robots.includes('const obsDim = 6 + 3 * nu + 3 + 10;'), 'obsDim = 6 IMU + 3·nu + cmd + 10 (Duck: 61)');
ok(robots.includes('const cmdOff = 6 + 3 * nu;'), 'cmdOff = Router-Kommando-Position (Duck: 48)');
ok(robots.includes('cmdOff, cmdDims: 3,'), 'Task legt cmdOff/cmdDims für den ABS-Modus offen');
const duckSrc = robots.slice(robots.indexOf('export function makeDuckMoeTask'));
ok(duckSrc.indexOf('sim.gyroBody(this._gy') < duckSrc.indexOf('sim.jointPositions(q)') &&
   duckSrc.indexOf('sim.jointPositions(q)') < duckSrc.indexOf('out[o++] = this.softCmd.vx'), 'Obs-Order: gyro → projGravity → Joints → … → cmd');
ok(robots.includes('const aspan = cfg.actSpan * (this.spanScale || 1) * J;') &&
   robots.includes('out[o++] = aspan * Math.tanh(this.lastAct[i] * J);'), 'actions-Block = ausgeführte Offsets (actSpan·tanh(a·J))');
ok(robots.includes('while (o < obsDim) out[o++] = 0;'), 'head/body-Befehle = 0 (keine Quelle in der App, neutral wie beim Einsatz)');
ok(!/observe\(sim, out\) \{[\s\S]*?skillW\[i\][\s\S]*?return o;/.test(robots.slice(robots.indexOf('makeDuckMoeTask'))), 'kein Skill/Style-Onehot mehr in der Obs');
ok(robots.includes('for (let k = 0; k < 6; k++) out[k] += drSensor(nR, this.drSpec.sensor);'), 'DR-Sensorrauschen auf die 6 IMU-Kanäle vorn');
ok(duckSrc.includes('if (nFeet) sim.footContacts(this._fc || (this._fc = new Float64Array(nFeet)));') &&
   duckSrc.indexOf('if (nFeet) sim.footContacts(this._fc') > duckSrc.indexOf('    reward(sim) {'), 'Fußkontakte werden im REWARD frisch gelesen (Obs hat sie nicht mehr)');

console.log('── 2. SoftMoEPolicy ABS-Modus (train.js) ──');
ok(trainjs.includes('const absCmd = !!(opts && opts.cmdOff != null);') && trainjs.includes('this.absCmd = absCmd;'), 'ABS-Modus per opts.cmdOff');
ok(trainjs.includes('this.RIN = this.H + (absCmd ? 3 : 4);'), 'Router-Eingang h2⊕3 (ABS) bzw. h2⊕4 (Legacy)');
ok(trainjs.includes('this.kPrior = absCmd ? 0 : 1.2;'), 'kPrior nur im Legacy-Modus');
ok(trainjs.includes('this.cmdV[i] = raw ? raw[co + i] : xn[co + i];'), 'Router liest RAW vx,vy,wz (unnormalisiert, ohne Relu)');
ok(trainjs.includes('this.style[k] = this.SE[k];'), 'Style neutral = SE-Zeile 0 (fest)');
ok(trainjs.includes('cmdOff: this.cmdOff, // v3.6.0: ABS-Modus (null = Legacy-Trailing)'), 'toJSON trägt cmdOff');
ok(tj.includes('policyOpts: { E: this.hyper.E, cmdOff: task.cmdOff },'), 'Trainer reicht task.cmdOff an die Policy');
ok(sj.includes('cmdOff: net.cmdOff != null ? net.cmdOff : null,'), 'Autosave trägt cmdOff');

console.log('── 3. Export: obs [1,61], Einbackung, kein Manifest (onnxexport.js/feld.js) ──');
ok(ox.includes("export const POLL_OBS_NAMES = [\n  'base_ang_vel', 'projected_gravity', 'joint_pos', 'joint_vel', 'actions',\n  'command', 'head_command', 'body_command',\n];"), 'POLL_OBS_NAMES = Original-Benennung (velstand.onnx)');
ok(ox.includes("export const POLL_CMD_NAMES = ['twist', 'head_pose', 'body_pose'];"), 'POLL_CMD_NAMES = Original');
ok(ox.includes('const ABS = !!net.absCmd;'), 'ABS-Zweig im Exporter');
ok(ox.includes("inits.push(S64('cm_s', net.cmdOff), S64('cm_e', net.cmdOff + 3));"), 'Router-Slice liest obs[cmdOff..cmdOff+3]');
ok(ox.includes("// v3.6.0: vx,vy,wz an fester Position — KEIN Relu (Rückwärts ist legitim!)"), 'kein Relu auf dem Kommando (Rückwärts/negativ bleibt erhalten)');
ok(ox.includes("const Wd2 = W('dec2', [A, DH], mulArr(N.Wd2, bakeJ));") &&
   ox.includes("inits.push(tensorScalar('act_scale', bakeSpan, dt));") &&
   ox.includes("nodes.push(node('Mul', ['mu_t', 'act_scale'], ['mu_s']));"), 'Einbackung: J in dec2, Tanh, actSpan-Mul');
ok(ox.includes('const actScale = meta.actionScale != null ? Number(meta.actionScale) : 1.0;'), 'action_scale-Metadatum 1.000 (wie Originale)');
ok(ox.includes('const folded[j] = N.bd1[j];') || ox.includes('folded[j] = N.bd1[j];'), 'Style-Anteil exakt in den Decoder-Bias gefaltet');
ok(fj.includes("import { moeToOnnx, createSession, selfTest, loadOrt, EP_MODES } from './onnxexport.js';"), 'feld: KEIN buildManifest-Import');
ok(!fj.includes('.manifest.json') || !fj.includes("'feld-policy-' + fmt + '.manifest.json'"), 'feld: keine Manifest-Datei im Export');
ok(fj.includes('actSpan: duck.actSpan, jointResidual: duck.jointResidual != null ? duck.jointResidual : 1,') &&
   (fj.match(/actSpan: getRobot\('duck'\)\.actSpan,/g) || []).length === 1, 'feld: Einbackung beim Export + in der App-Session übergeben');
ok(fj.includes('sim.ctrl[i] = task._ref[i] + mu[i];'), 'liveCycle ONNX: Ziel = Referenzpose + Aktion (Roboter-Aktuation 1:1)');
ok(fj.includes("log('Speicherstand gehört zum alten Policy-Format (' + pol.obsDim + ' Obs)"), 'alter 74er-Speicherstand wird sauber mit Hinweis abgewiesen');
ok(fj.includes('const warm = new Float32Array(D); // v3.6.0: Null-Kommando = neutrale Stand-Startlage'), 'Warm-up = Null-Kommando');
ok(html.includes('nur die .onnx, KEIN Manifest') && html.includes('1×61') && html.includes('GOT 61 EXPECTED 74'), 'Hint dokumentiert 61er-Layout + Manifest-Verzicht');

console.log('── 4. ECHTE ort-node-Ausführung (ABS-Netz, obs [1,61]) ──');
const ort = require('../scripts/ardy/node_modules/onnxruntime-node');
const { SoftMoEPolicy } = await import(join(WWW, 'js/train.js'));
const { RNG } = await import(join(WWW, 'js/math.js'));
const { moeToOnnx } = await import(join(WWW, 'js/feld/onnxexport.js'));

const net = new SoftMoEPolicy(61, 14, new RNG(42), { E: 4, cmdOff: 48 });
ok(net.absCmd && net.cmdOff === 48 && net.RIN === 131, 'Netz im ABS-Modus (cmdOff 48, RIN 131)');
for (const n of net.pNames) {
  const P = net[n];
  for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.7 + P.length * 1e-4) * (P.length % 3) * 0.05;
}
const D = net.obsDim;
const raw = new Float32Array(D);
for (let i = 0; i < D; i++) raw[i] = Math.sin(i * 1.3) * 0.4;
raw[48] = 0.12; raw[49] = -0.05; raw[50] = 0.2; // command: vx, vy, wz (vy negativ = rückwärts!)
const mu = net.forward(raw, raw).slice();
const SPAN = 0.35, JRES = 1.0;
const ref = new Float32Array(14);
for (let i = 0; i < 14; i++) ref[i] = SPAN * Math.tanh(mu[i] * JRES);

const { bytes, ops } = moeToOnnx(net, {
  format: 'fp32',
  norm: { mean: new Array(D).fill(0), std: new Array(D).fill(1) },
  actSpan: SPAN, jointResidual: JRES,
  meta: {},
});
const buf = Buffer.from(bytes);
ok(buf.includes('main_graph') && buf.includes('pytorch'), 'Bytes tragen Pollen-Header (main_graph/pytorch)');
ok(buf.includes('base_ang_vel') && buf.includes('twist,head_pose,body_pose'), 'Metadaten: observation/command_names wie das Original eingebettet');

const session = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: 'all' });
ok(session.inputNames[0] === 'obs' && session.outputNames[0] === 'actions', 'IO obs→actions (Pollen-Konvention)');
const t61 = new ort.Tensor('float32', Float32Array.from(raw), [1, 61]);
const out = await session.run({ obs: t61 });
const act = Array.from(out.actions.data);
let mx = 0;
for (let i = 0; i < 14; i++) mx = Math.max(mx, Math.abs(act[i] - ref[i]));
ok(mx < 1e-5, 'Parität ONNX ↔ JS (inkl. Einbackung): max|Δ| = ' + mx.toExponential(3) + ' (' + ops + ' Knoten)');
ok(Math.max(...act.map(Math.abs)) <= SPAN + 1e-6, 'actions im Offset-Band ±actSpan (rad) — roh anwendbar');

// Der Fehler des Nutzers ist strukturell WEG: [1,74] MUSS jetzt fehlschlagen,
// [1,61] ist der EINZIGE Vertrag (wie beim echten Duck).
let threw = false;
try {
  await session.run({ obs: new ort.Tensor('float32', new Float32Array(74), [1, 74]) });
} catch (e) { threw = true; }
ok(threw, 'obs [1,74] wird abgelehnt — das Modell WILL 61 („GOT 61 EXPECTED 74“ unmöglich geworden)');

console.log('── 5. Version 106 / 3.6.0 + CI ──');
ok(vj.includes("export const VERSION = '3.6.0';") && vj.includes('export const VERSION_CODE = 106;'), 'version.js: 3.6.0 / 106');
ok(gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"'), 'build.gradle: 106 / "3.6.0"');
ok(workflow.includes('5\\.0|6\\.0'), 'CI: OR-Kette auf 3.6.0 erweitert');

console.log('\nERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) process.exit(1);
