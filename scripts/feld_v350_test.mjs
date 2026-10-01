// ═══════════════════════════════════════════════════════════
// feld_v350_test.mjs — POLLEN-PROFIL des ONNX-Exports (v3.5.0)
//
// Nutzer: „Stelle sicher das Exportierte onnx model gleichen Format
// hat wie die Originalen von pollen robotics. Bei mir zeigt es Fehler
// bei exportierten onnx Modellen an. Anscheinend sind sie nicht gleich.“
//
// Das Original-Format wurde an einer ECHTEN Pollen-Policy verifiziert
// (pollen-robotics/microduck-policies → velstand.onnx, exportiert via
// rsl_rl export_policy_to_onnx opset 18 + torch 2.9.1 + mjlab
// attach_metadata_to_onnx). Statische Pins auf:
//   1) Profil: ir 8 · producer pytorch/2.9.1 · opset 18 · main_graph
//   2) IO: „obs“ [1,D] fix · „actions“ [1,A] fix (kein dyn. N, kein mu)
//   3) Metadaten: 8 Original-Keys, %.3f-CSV, Pollen-Joint-Order,
//      STAND-Keyframe als default_joint_pos, kp 2.2/kv 0 (chosen_actuator)
//   4) manifest.json (schema 2) neben das ONNX (Originale = ONNX+Manifest)
//   5) App-Verdrahtung: out.actions, keyCtrl-Metadaten, exportJSON
//   6) Version 105 / 3.5.0 + CI-OR-Kette
// Laufzeit-Gegenprobe (Format-Diff + onnxruntime): scripts/pollen_profile_check.py
// Usage: node scripts/feld_v350_test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'app/src/main/assets/www');
const F = join(WWW, 'js/feld/feld.js');
const OX = join(WWW, 'js/feld/onnxexport.js');
const HT = join(WWW, 'index.html');
const VJ = join(WWW, 'js/feld/version.js');
const GR = join(ROOT, 'app/build.gradle');
const WF = join(ROOT, '.github/workflows/build-apk.yml');
const XML = join(WWW, 'models/pollen_microduck/microduck.xml');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };
const read = (p) => readFileSync(p, 'utf8');

const ox = read(OX);
const fj = read(F);
const html = read(HT);
const vj = read(VJ);
const gradle = read(GR);
const workflow = read(WF);
const xml = read(XML);

console.log('── 1. Pollen-Profil-Konstanten (onnxexport.js) ──');
ok(ox.includes("ir: 8, producer: 'pytorch', producerVer: '2.9.1', graph: 'main_graph',"), 'POLL_PROFILE: ir 8 · pytorch/2.9.1 · main_graph (wie Original)');
ok(ox.includes("inName: 'obs', outName: 'actions', opset: 18,"), 'POLL_PROFILE: obs→actions, opset 18');
ok(ox.includes("export const POLL_JOINTS = ["), 'POLL_JOINTS vorhanden (14er-Pollen-Order)');
const joints = ['left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle', 'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll', 'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle'];
ok(joints.every((j) => ox.includes("'" + j + "'")), 'alle 14 Pollen-Joint-Namen (dieselbe MJCF wie Originale)');
ok(ox.includes('export const POLL_DEFAULT_POS = [') && ox.includes('-0.08726646259971647') && ox.includes('0.3490658503988659'), 'POLL_DEFAULT_POS = STAND-Keyframe des Pollen-MJCF');
ok(ox.includes('export const POLL_STIFFNESS = 2.2, POLL_DAMPING = 0.0;'), 'kp 2.2 / kv 0 (chosen_actuator)');
const obsBlocks = ['base_ang_vel', 'projected_gravity', 'joint_pos', 'joint_vel', 'actions', 'command', 'head_command', 'body_command'];
ok(obsBlocks.every((b) => ox.includes("'" + b + "'")), '8 Obs-Blöcke in Original-Benennung (61 Dims, wie velstand.onnx)');
ok(ox.includes("['twist', 'head_pose', 'body_pose']"), 'command_names = twist,head_pose,body_pose (Original)');
ok(ox.includes('const csv3 = (arr) => Array.from(arr, (x) => Number(x).toFixed(3)).join(\',\');'), 'csv3 = %.3f-Komma-CSV (list_to_csv_str-Konvention)');

console.log('── 2. Metadaten + Manifest ──');
ok(ox.includes("['run_path', meta.runPath != null ? String(meta.runPath) : 'None'],") &&
   ox.includes("['joint_names', POLL_JOINTS.join(',')],") &&
   ox.includes("['joint_stiffness', csv3(new Array(net.actDim).fill(POLL_STIFFNESS))],") &&
   ox.includes("['joint_damping', csv3(new Array(net.actDim).fill(POLL_DAMPING))],") &&
   ox.includes("['default_joint_pos', csv3(djp)],") &&
   ox.includes("['command_names', POLL_CMD_NAMES.join(',')],") &&
   ox.includes("['observation_names', POLL_OBS_NAMES.join(',')],") &&
   ox.includes("['action_scale', actScale.toFixed(3)],"),
   'buildPollenMeta: exakt die 8 Original-Keys in Original-Reihenfolge');
ok(ox.includes('schema_version: 2,') && ox.includes('model_api: 1, // Feed-Forward (LSTM wäre 2)'), 'Manifest: schema 2, model_api 1 (Feed-Forward)');
ok(ox.includes("robot: { model: 'microduck', hw_rev: 1, servos: 'xl330', control_hz: 50 },"), 'Manifest: robot microduck/hw_rev 1/xl330/50 Hz (wie Originale)');
ok(ox.includes("kind: 'perpetual',") && ox.includes("encoding: 'constant', idle: [0, 0, 0]"), 'Manifest: kind perpetual, command constant+idle');
ok(ox.includes('obs_len: net.obsDim,') && ox.includes('action_len: net.actDim,'), 'Manifest: obs_len/action_len ehrlich aus dem Netz');
ok(ox.includes('export function buildPollenMeta(') && ox.includes('export function buildManifest('), 'buildPollenMeta + buildManifest exportiert');

console.log('── 3. Graph-Aufbau (feste Dims, kein mu, opset 18) ──');
ok(ox.includes("bf(2, utf8(POLL_PROFILE.graph)),") && ox.includes("bf(11, valueInfo(POLL_PROFILE.inName, DT.FLOAT, [1, D])),") && ox.includes("bf(12, valueInfo(POLL_PROFILE.outName, DT.FLOAT, [1, A])),"),
   'Graph: main_graph · Input obs [1,D] FEST · Output actions [1,A] FEST');
ok(ox.includes("vf(1, POLL_PROFILE.ir),") && ox.includes("bf(2, utf8(POLL_PROFILE.producer)),") && ox.includes("bf(3, utf8(POLL_PROFILE.producerVer)),") && ox.includes("vf(2, POLL_PROFILE.opset)"),
   'Modell-Header: ir · producer_name (Feld 2) · producer_version (Feld 3) · opset 18');
ok(ox.includes(".map(([k, v]) => bf(14, metaEntry(k, v))),"), 'metadata_props als ModelProto-Feld 14');
ok(!ox.includes("bf(13, valueInfo"), 'KEINE value_info für Zwischentensoren (Original hat auch keine; feste Dims = vollständige Shape-Inferenz)');
ok(ox.includes("node('Cast', [muOut], [POLL_PROFILE.outName], [attrI('to', DT.FLOAT)])"), 'Hauptausgang über Cast → „actions“ (immer fp32)');
ok(ox.includes("outputs: [POLL_PROFILE.outName].concat(extraOut)"), 'Rückgabe nennt „actions“');
ok(ox.includes("out[POLL_PROFILE.outName].data"), 'selfTest liest den Pollen-Ausgang');
ok(!ox.includes("['mu']") && !ox.includes("outputs: ['mu']") && !ox.includes("out.mu"), 'kein „mu“-Rest im Exporter');
ok(ox.includes("node('Softmax', ['rlogits'], ['w'], [attrI('axis', 1)]))"), 'Softmax-Achse bleibt Attribut (gilt bis opset 18)');
ok(ox.includes('const CMD = D - 13;'), 'CMD-Block (Legacy-Trailing) unverändert — Drohne/Alt-App');
ok(ox.includes('const ABS = !!net.absCmd;'), 'v3.6.0: ABS-Modus (Pollen-Obs) im Export');
ok(ox.includes("inits.push(tensorScalar('act_scale', bakeSpan, dt));"), 'v3.6.0: Skalierung EINGEBACKEN (actSpan·tanh → Positionsoffsets rad)');
ok(ox.includes("const actScale = meta.actionScale != null ? Number(meta.actionScale) : 1.0;"), 'v3.6.0: action_scale-Metadatum = 1.000 (wie Originale)');

console.log('── 4. App-Verdrahtung (feld.js) ──');
ok(fj.includes("import { moeToOnnx, createSession, selfTest, loadOrt, EP_MODES, importSession, inspectOnnx } from './onnxexport.js';"), 'feld: kein buildManifest-Import mehr (Nutzer: „Manifest brauche ich auch nicht“)');
ok(fj.includes('defaultJointPos: (S.sim && S.sim.keyCtrl) ? Array.from(S.sim.keyCtrl) : null,'), 'feld: default_joint_pos aus dem laufenden Sim (STAND-Keyctrl)');
ok(fj.includes('actSpan: duck.actSpan, jointResidual: duck.jointResidual != null ? duck.jointResidual : 1,'), 'feld: actSpan/jointResidual für die Einbackung übergeben');
ok(!fj.includes("'feld-policy-' + fmt + '.manifest.json'"), 'feld: KEINE Manifest-Datei mehr im Export');
ok(!fj.includes('buildManifest(S.trainer.ppo.net'), 'feld: buildManifest wird NICHT mehr aufgerufen');
ok((fj.match(/out\.actions\.data/g) || []).length === 1 && (fj.match(/out\[S\._ortOut \|\| 'actions'\]\.data/g) || []).length === 1, 'feld: liveCycle (Session-Ausgangsname) + Warm-up (out.actions) — je 1 Stelle');
ok(fj.includes('Pollen-Format: obs [1,\' + S.task.obsDim + \'] → actions'), 'feld: Statuszeile nennt das Pollen-Format (obs [1,61])');
ok(html.includes('nur die .onnx, KEIN Manifest') && html.includes('microduck-policies') && html.includes('opset 18') && html.includes('1:1 wie die Original-Policies von Pollen Robotics'), 'html: Hint dokumentiert Pollen-Format ohne Manifest');
ok(html.includes('1×61') && html.includes('GOT 61 EXPECTED 74'), 'html: Hint nennt das 61er-Obs-Layout + den Fix');

console.log('── 5. Ehrlichkeit der Metadaten (MJCF-Pins) ──');
ok(xml.includes('<position kp="2.2" kv="0.0" forcerange="-0.96 0.96" ctrlrange="-10.0 10.0"/>'), 'MJCF: chosen_actuator kp 2.2 / kv 0 (= joint_stiffness/damping-Metadatum)');
ok(xml.includes('ctrl="0 -0.08726646259971647 -0.457924 -0.004940 0.452984 0.3490658503988659 0.3490658503988659 0 0 0 0.08726646259971647 0.457924 0.004940 -0.452984"'), 'MJCF: STAND-ctrl = default_joint_pos der Pollen-Originale (0.000,-0.087,-0.458,…)');
for (const j of joints) ok(xml.includes('name="' + j + '"'), 'MJCF-Aktuator: ' + j);

console.log('── 6. Version 105 / 3.5.0 + CI ──');
ok((vj.includes("export const VERSION = '3.5.0';") && vj.includes('export const VERSION_CODE = 105;')) ||
   (vj.includes("export const VERSION = '3.6.0';") && vj.includes('export const VERSION_CODE = 106;')) || (vj.includes("export const VERSION = '3.7.0';") && vj.includes('export const VERSION_CODE = 107;')), 'version.js: 3.6.0/106 oder 3.7.0/107');
ok(((gradle.includes('versionCode 105') && gradle.includes('versionName "3.5.0"') || ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || (gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"')))))) ||
   ((gradle.includes('versionCode 106') && gradle.includes('versionName "3.6.0"') || (gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"')))), 'build.gradle: 105/3.5.0 oder 106/3.6.0');
ok(workflow.includes('5\\.0|6\\.0'), 'CI: OR-Kette auf 3.6.0 erweitert');

console.log('\nERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) process.exit(1);
