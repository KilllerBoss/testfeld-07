/* Trainrobot CI-Suite — offizieller Simulator-Kern, kein Fallback.
 * Prüft deterministisch (ohne Browser/Netz):
 *   1. Dist-Integrität (Dateien, wasm-Magic, Patches im App-Bundle)
 *   2. Bridge-Vertrag (md_bridge.js: GeminiSource, addSource, __mdGetState)
 *   3. Android-Verkabelung (Zwei-Handler-Logik, loadUrl-Flags, kein file://)
 *   4. Identität (Trainrobot.apk-Name, appId, versionCode 5, kein Fallback-Marker)
 *   5. ROBOLAB-Zweig (assets/robo: MJCF-Menagerie arm/hum, kein ONNX, kein Fallback)
 * Der Browser-Boot-Test (tests/browser_official_boot.js) deckt Verhalten ab.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (p) => path.join(ROOT, 'app', 'src', 'main', p);
const SIM = path.join(A('assets'), 'sim');

let pass = 0, fail = 0;
function check(cond, msg) {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  cond ? pass++ : fail++;
}
const read = (p) => fs.readFileSync(p, 'utf8');

// ── 1. Dist-Integrität ──────────────────────────────────────────
console.log('>> 1. Dist-Integrität (assets/sim)');
for (const rel of [
  'index.html', 'policies/microduck_rough_v2.onnx', 'policies/BEST_alpha_walking.onnx',
  'robot/mjlab/microduck.glb', 'robot/mjlab/robot_allcollisions.xml',
]) check(fs.existsSync(path.join(SIM, rel)), 'vorhanden: ' + rel);

const wasms = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.wasm')) wasms.push(p);
  }
})(SIM);
check(wasms.some((w) => path.basename(w).startsWith('mujoco')), 'MuJoCo-WASM vorhanden');
check(wasms.some((w) => path.basename(w).startsWith('ort-wasm')), 'onnxruntime-WASM vorhanden');
for (const w of wasms) {
  check(fs.readFileSync(w).subarray(0, 4).toString('latin1') === '\x00asm',
        'wasm-Magic: ' + path.basename(w));
}

const appBundle = fs.readdirSync(path.join(SIM, 'bundle'))
  .filter((f) => f.startsWith('App-'))
  .map((f) => read(path.join(SIM, 'bundle', f)))
  .join('');
check(appBundle.includes('microduck_rough_v2'), 'Patch 1: walk = microduck_rough_v2.onnx');
check(appBundle.includes('noghosts'), 'Patch 2: ?noghosts-Multiplayer-Abschaltung');
const simIndex = read(path.join(SIM, 'index.html'));
check(/src="\/bundle\/index-/.test(simIndex), 'index.html nutzt absolute /bundle-Pfade (Root-Handler nötig)');

// ── 2. Bridge-Vertrag ───────────────────────────────────────────
console.log('>> 2. Bridge-Vertrag (md_bridge.js)');
const bridge = read(A('assets') + '/md_bridge.js');
check(bridge === read(path.join(ROOT, 'bridge', 'md_bridge.js')),
      'assets/md_bridge.js === bridge/md_bridge.js (Single Source of Truth)');
check(bridge.includes('GeminiSource'), 'GeminiSource vorhanden');
check(bridge.includes('rl.controller.addSource'), 'addSource in Controller');
check(bridge.includes('__mdGetState'), '__mdGetState (Zustandsabfrage)');
check(bridge.includes('AndroidHost.ready'), 'Rückkanal AndroidHost.ready');

// ── 3. Android-Verkabelung ──────────────────────────────────────
console.log('>> 3. Android-Verkabelung');
const simAct = read(A('java') + '/com/trainrobot/app/SimActivity.java');
const handler = read(A('java') + '/com/trainrobot/app/SimAssetHandler.java');
const manifest = read(A('AndroidManifest.xml'));
check(simAct.includes('"https://appassets.androidplatform.net/assets/sim/index.html?boot=1&touch=1&noghosts"'),
      'loadUrl: appassets…/assets/sim/index.html?boot=1&touch=1&noghosts');
check(simAct.includes('addPathHandler("/assets/sim/"'), 'Handler 1: /assets/sim/ → sim/');
check(simAct.includes('addPathHandler("/", new SimAssetHandler(this, "sim")'), 'Handler 2: / → sim/ (absolute Pfade)');
check(handler.includes('am.open(baseDir + "/" + clean)'), 'Handler öffnet baseDir + Pfad (kein sim/sim-Bug)');
check(!simAct.includes('file:///android_asset'), 'kein file://-Loading mehr');
check(manifest.includes('.SimActivity'), 'SimActivity im Manifest');
check(simAct.includes('pollGameReady'), 'pollGameReady (window.rl-Warten) vorhanden');
check(simAct.includes('md_bridge.js'), 'Bridge wird als Asset injiziert');

// ── 4. Identität & kein Fallback ────────────────────────────────
console.log('>> 4. Identität & Fallback-frei');
const gradle = read(path.join(ROOT, 'app', 'build.gradle'));
check(gradle.includes('outputFileName = "Trainrobot.apk"'), 'APK heißt Trainrobot.apk');
check(gradle.includes('applicationId "com.trainrobot.app"'), 'appId com.trainrobot.app');
check(gradle.includes('versionCode 5') && gradle.includes('versionName "2.1.0"'), 'versionCode 5 / versionName 2.1.0');
const javaFiles = ['MainActivity.java', 'SimActivity.java', 'SimAssetHandler.java', 'GeminiClient.java', 'Notifier.java'];
for (const f of javaFiles) {
  check(fs.existsSync(path.join(A('java'), 'com/trainrobot/app', f)), 'Klasse vorhanden: ' + f);
}
check(!fs.existsSync(path.join(ROOT, 'sim', 'src')), 'Alte Eigenbau-Engine (Fallback-Motor) entfernt');
check(!fs.existsSync(path.join(A('assets'), 'index.html')), 'Kein altes assets/index.html mehr');
check(manifest.includes('android.permission.POST_NOTIFICATIONS'), 'POST_NOTIFICATIONS (Notifier)');
check(simAct.includes('setAllowFileAccess(false)'), 'allowFileAccess=false (wie Referenz)');

// ── 5. ROBOLAB-Zweig (assets/robo) ─────────────────────────────
console.log('>> 5. ROBOLAB-Zweig (Armbot + Humanoid, MJ-only)');
const ROBO = path.join(A('assets'), 'robo');
check(fs.existsSync(path.join(ROBO, 'index.html')), 'robo/index.html vorhanden');
check(simAct.includes('/assets/robo/'), 'SimActivity: robo-Handler registriert');
check(simAct.includes('?robot='), 'SimActivity: robot-Parameter an ROBOLAB-URL');
check(simAct.includes('"robot"'), 'SimActivity: robot-Extra gelesen');
check(fs.existsSync(path.join(ROBO, 'mjc', 'wx250s.xml')), 'MJCF vorhanden: wx250s.xml (Armbot)');
check(fs.existsSync(path.join(ROBO, 'mjc', 'op3.xml')), 'MJCF vorhanden: op3.xml (Humanoid)');
check(fs.existsSync(path.join(ROBO, 'mjc', 'mujoco.wasm')), 'MuJoCo-WASM im ROBOLAB-Zweig');
check(fs.existsSync(path.join(ROBO, 'mjc', 'mujoco.wrapped.js')), 'MuJoCo-Glue im ROBOLAB-Zweig');
const roboHtml = read(path.join(ROBO, 'index.html'));
check(roboHtml.includes('TF07.BUILTIN_POLICIES'), 'ROBOLAB: Builtin-Champions eingebettet');
check(roboHtml.includes('armmj') && roboHtml.includes('op3mj'), 'ROBOLAB: armmj + op3mj Champions');
check(!/inferencesession|ort\.glue|ort\.global|ort-wasm/i.test(roboHtml), 'ROBOLAB: kein ONNX/ORT');
check(!/DuckEnv|ArmEnv|HumanoidEnv|makeEnv/.test(roboHtml), 'ROBOLAB: kein Werkstatt-Env-Kern');
check(!/Werkstatt-Kern bleibt aktiv|WERKSTATT-FALLBACK/.test(roboHtml), 'ROBOLAB: kein Fallback-Zweig');
check(roboHtml.includes('KEIN FALLBACK'), 'ROBOLAB: Fallback-freiheit explizit deklariert');
const roboIdx = JSON.parse(fs.readFileSync(path.join(ROBO, 'mjc', '__index.json'), 'utf8'));
check(Array.isArray(roboIdx) && roboIdx.length >= 30, 'mjc/__index.json: ' + roboIdx.length + ' Mesh-Einträge');
check(!fs.existsSync(path.join(ROBO, 'mjc', 'policies')), 'Kein ONNX-Policy-Ordner im ROBOLAB-Zweig');

console.log(`\n>> ERGEBNIS: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
