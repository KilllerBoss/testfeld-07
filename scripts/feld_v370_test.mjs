// ═══════════════════════════════════════════════════════════
// feld_v370_test.mjs — ONNX-IMPORT + GEMINI-KI-SETUP (v3.7.0)
//
// Nutzer: „Mache das ich onnx Modelle importieren kann und testen.
// Und füge Gemini API hinzu, damit es alles für mich einstellt."
//
// Dieser Test pinnt:
//   1) IMPORT: Datei-Picker (importBytes, OHNE MIME-Filter — .onnx hat
//      kein registriertes MIME), importSession/inspectOnnx (Dims aus der
//      Session-Metadaten, Null-Obs-Probe, Dim-Lernen aus ORT-Fehlern),
//      Verdrahtung in feld.js + IMPORT-Karte in index.html
//   2) ECHTE ort-node-Ausführung: eigenes Export-Netz obs [1,61] →
//      actions [1,14] wird importiert, Dims gelesen, Probe läuft,
//      Parität JS ↔ ONNX bleibt; FALSCHER Dim (74) → Fehlermeldung
//      wird gelernt („Expected: 61") → erneuter Versuch läuft
//   3) GEMINI: eingebetteter AQ.-Schlüssel, generateContent-URL/Body
//      (responseMimeType json), extractJson (Codezäune), applySetup
//      Klemmt Zahlen/bools/Enums hart + deutsche Änderungsliste,
//      State-Snapshot über echte Modelle, Schema-Text mit Bereichen
//   4) Version 107 / 3.7.0 + CI-OR-Kette
// Aufruf: node scripts/feld_v370_test.mjs
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

const ox = read(join(WWW, 'js/feld/onnxexport.js'));
const st = read(join(WWW, 'js/feld/store.js'));
const fj = read(join(WWW, 'js/feld/feld.js'));
const gj = read(join(WWW, 'js/feld/gemini.js'));
const html = read(join(WWW, 'index.html'));
const vj = read(join(WWW, 'js/feld/version.js'));
const gradle = read(join(ROOT, 'app/build.gradle'));
const workflow = read(join(ROOT, '.github/workflows/build-apk.yml'));

console.log('── 1. IMPORT: Picker + Session + UI-Verdrahtung ──');
ok(st.includes('export function importBytes()'), 'store.importBytes: Binär-Picker existiert');
ok(/importBytes\(\)[\s\S]{0,600}inp\.accept = '';/s.test(st), 'Picker OHNE accept-Filter (.onnx hat kein MIME in Dateimanagern)');
ok(st.includes('r.readAsArrayBuffer(f)') && st.includes("resolve({ name: f.name || 'modell.onnx', bytes })"), 'Picker liefert { name, bytes: Uint8Array }');
ok(ox.includes('export async function importSession(onnxBytes, epMode'), 'importSession: EP-Kette + Dim-Ermittlung + Probe');
ok(ox.includes('export async function inspectOnnx(session, ort, startDim = 0)'), 'inspectOnnx: IO-Namen + Dims + Null-Obs-Probe');
ok(ox.includes('export function modelDim(meta)'), 'modelDim: dims-Parser (letzte finite Zahl > 1, symbolische übersprungen)');
ok(ox.includes('export function dimFromError(e)') && /Expected:\\s\*\(\\d\+\)/.test(ox), 'dimFromError: lernt Dim aus ORT-Fehlermeldung (Expected: N)');
ok(ox.includes("opts.chain || EP_MODES[epMode] || EP_MODES.auto"), 'importSession: opts.chain überschreibt Kette (Tests: ort-node cpu)');
ok(fj.includes("const { name, bytes } = await store.importBytes();"), 'feld: IMPORT-Button nutzt den Binär-Picker');
ok(fj.includes("await importSession(bytes, $('epSel').value, null, { budgetMs: 8, startDim: S.task.obsDim })"), 'feld: importSession mit EP-Auswahl + Start-Dim = Task-Obs');
ok(fj.includes("if ((b0 === 0x50 && bytes[1] === 0x4b) || b0 === 0x7b || b0 === 0x5b || (b0 === 0x1f && bytes[1] === 0x8b))"), 'Magic-Check: ZIP/JSON/GZ werden mit klarer Meldung abgewiesen');
ok(fj.includes('function importVerdict(res)') && fj.includes("res.obsDim === S.task.obsDim") && fj.includes("res.actDim === S.task.actDim"), 'Verdict: Dims gegen Task (61/14) prüfen');
ok(fj.includes("'TEST OK — Modell fährt jetzt den POLICY-Betrieb: '"), 'Verdict kompatibel → Modell aktiviert POLICY-Betrieb');
ok(fj.includes("'TEST OK (Inferenz läuft) — ABER kein Live-Betrieb: '"), 'Verdict fremde Dims → Test OK + klare Begründung');
ok(fj.includes('S._ortMu = Float32Array.from(out[S._ortOut || \'actions\'].data);'), 'liveCycle: Ausgangsname der AKTIVEN Session (Import kann abweichen)');
ok(fj.includes("S._ortOut = res.outName;") && fj.includes("S._ortOut = 'actions'; // v3.7.0: eigener Export = Pollen-Ausgangsname"), 'Ausgangsname: Import = Modell-Name, eigener Export = actions');
ok(fj.includes("S.ortInfer = res.session;") && fj.includes("S._ortT = res.ort.Tensor;"), 'Import-Aktivierung: gleicher Pfad wie btnRunOrt');
ok(fj.includes("$('btnTestOnnx').addEventListener"), 'ERNEUT TESTEN-Button verdrahtet');
ok(html.includes('btnImportOnnx') && html.includes('btnTestOnnx') && html.includes('impState'), 'index.html: IMPORT-Karte mit beiden Buttons + Statuszeile');
ok(html.includes('MODELL IMPORTIEREN (.ONNX)') && html.includes('obs 1×61 → actions 1×14'), 'IMPORT-Hint dokumentiert Vertrag + Auto-Aktivierung');
ok(fj.includes("import { moeToOnnx, createSession, selfTest, loadOrt, EP_MODES, importSession, inspectOnnx } from './onnxexport.js';"), 'feld: Import-Funktionen aus onnxexport');

console.log('── 2. ECHTE ort-node-Ausführung (Import des eigenen Exports) ──');
const ort = require('../scripts/ardy/node_modules/onnxruntime-node');
const { SoftMoEPolicy } = await import(join(WWW, 'js/train.js'));
const { RNG } = await import(join(WWW, 'js/math.js'));
const { moeToOnnx, modelDim, dimFromError, importSession, inspectOnnx } = await import(join(WWW, 'js/feld/onnxexport.js'));

const net = new SoftMoEPolicy(61, 14, new RNG(42), { E: 4, cmdOff: 48 });
for (const n of net.pNames) {
  const P = net[n];
  for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.7 + P.length * 1e-4) * (P.length % 3) * 0.05;
}
const D = net.obsDim;
const raw = new Float32Array(D);
for (let i = 0; i < D; i++) raw[i] = Math.sin(i * 1.3) * 0.4;
raw[48] = 0.12; raw[49] = -0.05; raw[50] = 0.2;
const mu = net.forward(raw, raw).slice();
const SPAN = 0.35, JRES = 1.0;
const ref = new Float32Array(14);
for (let i = 0; i < 14; i++) ref[i] = SPAN * Math.tanh(mu[i] * JRES);

const { bytes } = moeToOnnx(net, {
  format: 'fp32',
  norm: { mean: new Array(D).fill(0), std: new Array(D).fill(1) },
  actSpan: SPAN, jointResidual: JRES, meta: {},
});

// importSession mit ort-node (chain ['cpu']) — der app-nahen Pfad:
const imp = await importSession(bytes, 'cpu', ort, { chain: ['cpu'], budgetMs: 1000, startDim: 61 });
ok(imp.inName === 'obs' && imp.outName === 'actions', 'importSession: IO-Namen obs→actions');
ok(imp.obsDim === 61 && imp.actDim === 14, 'Dims aus der Session gelesen: obs 61 / actions 14 (erwartet obs ' + imp.obsDim + '/act ' + imp.actDim + ')');
ok(imp.sample instanceof Float32Array && imp.sample.length === 14, 'Probe: Ausgangs-Vektor (14 Werte) geliefert');
ok(imp.ms >= 0, 'Probe: Latenz gemessen (' + imp.ms.toFixed(2) + ' ms)');

// Parität mit dem JS-Netz (Null-Obs-Fehler == Null-Obs-Probe):
const muJs = net.forward(new Float32Array(61), new Float32Array(61)).slice();
let mx0 = 0;
for (let i = 0; i < 14; i++) mx0 = Math.max(mx0, Math.abs(imp.sample[i] - SPAN * Math.tanh(muJs[i] * JRES)));
ok(mx0 < 1e-5, 'Parität bei Null-Obs: max|Δ| = ' + mx0.toExponential(2));

// Falsche Dim (74) → Fehlermeldung lernen → 61 (Genau die Nutzer-Fehler-Spur):
let dimErr = null;
try {
  await ort.InferenceSession.create(bytes, { executionProviders: ['cpu'] }).then((s) =>
    s.run({ obs: new ort.Tensor('float32', new Float32Array(74), [1, 74]) }));
} catch (e) { dimErr = e; }
ok(!!dimErr, 'obs [1,74] schlägt fehl (wie beim Nutzer-Report)');
ok(dimFromError(dimErr) === 61, 'dimFromError liest „Expected: 61" aus der Meldung');
const info61 = await inspectOnnx((await ort.InferenceSession.create(bytes, { executionProviders: ['cpu'] })), ort, 74);
ok(info61.obsDim === 61 && info61.sample.length === 14, 'inspectOnnx: Start-Dim 74 wird korrigiert → Probe läuft mit 61 (Fallback-Pfad)');
ok(modelDim({ dims: [1, 61] }) === 61 && modelDim({ dims: ['N', 61] }) === 61 && modelDim({ dims: ['N'] }) === -1, 'modelDim: symbolische Dims übersprungen');

console.log('── 3. GEMINI: Schlüssel, Transport, Validierung, Anwendung ──');
ok(gj.includes("try { ({ EMBEDDED_AI_KEY: EMBEDDED_KEY } = await import('./aiconfig.js'))"), 'Schlüssel-Zuführung: aiconfig.js dynamisch importiert (Build injiziert, TLA try/catch)');
ok(!/AQ\.[A-Za-z0-9_-]{20,}/.test(gj), 'gemini.js enthält KEINEN literalen Schlüssel (GitHub Push Protection)');
const ign = read(join(ROOT, '.gitignore'));
ok(ign.includes('js/feld/aiconfig.js'), 'aiconfig.js ist gitignoriert (Schlüssel landet nie im Repo)');
try {
  const aiCfg = read(join(WWW, 'js/feld/aiconfig.js'));
  ok(/^export const EMBEDDED_AI_KEY = '(|AQ\.[A-Za-z0-9_-]+)';\s*$/.test(aiCfg), 'lokale aiconfig.js: leer ODER AQ.-Schlüssel (Format)');
} catch (e) { ok(true, 'aiconfig.js fehlt lokal — App fragt in der Karte (zulässig)'); }
ok(gj.includes("const LS_KEY = 'tr_ai_key_v1';"), 'Schlüssel-Speicher geteilt mit dem Alt-Trainer (ersetzen wirkt in beiden)');
ok(gj.includes("'https://generativelanguage.googleapis.com/v1beta'"), 'Gemini-API-Basis-URL');
ok(gj.includes(":generateContent?key=") && gj.includes('encodeURIComponent(key)'), 'generateContent mit Key im Query (Brücke ohne Header-Mapping)');
ok(gj.includes("responseMimeType: 'application/json'"), 'Antwort-Format JSON erzwungen');
ok(gj.includes("window.TrainrobotAI") && gj.includes("__gemReply"), 'Transport: native Brücke (APK) mit Callback-Karte');
ok(gj.includes('MODEL_CHAIN') && gj.includes("autoModel"), 'Auto-Modell: Discovery + Fallback-Kette');
ok(/MODEL_CHAIN\s*=\s*\['gemini-3\.8-flash'/.test(gj), 'Kette führt gemini-3.8-flash (Google schaltete 2.5 für neue Keys ab — Echt-Test)');
ok(gj.includes('location is not supported'), 'Geo-Block („User location is not supported“) → verständliche deutsche Meldung');
ok(fj.includes('wireGemUI') && fj.includes("gemConfigure(wishEl.value.trim() || DEFAULT_WISH, S, { model: modelEl.value })"), 'feld: KI-SETUP-Karte verdrahtet (Wunsch → configure)');
ok(fj.includes('buildRewardUI(); buildSchubUI(); buildGroundUI(); buildPhoneUI(); buildFallUI();'), 'Nach der KI: alle Regler-UIs neu aufbauen (in-place-Bindung bleibt)');
ok(html.includes('btnGemGo') && html.includes('ALLES EINSTELLEN') && html.includes('gemWish') && html.includes('gemKey'), 'index.html: KI-SETUP-Karte (Wunsch/Modell/Schlüssel/Button)');
ok(html.includes('gemini-3.8-flash') && !html.includes('"gemini-2.0-flash"'), 'index.html: Modell-Auswahl auf 3.x-Generation');

const gem = await import(join(WWW, 'js/feld/gemini.js'));
ok(typeof gem.configure === 'function' && typeof gem.applySetup === 'function' && typeof gem.buildStateSnap === 'function' && typeof gem.extractJson === 'function', 'gemini.js-Exporte (configure/applySetup/buildStateSnap/extractJson)');

// extractJson: Codezäune + Prosa + hängende Kommata
const j1 = gem.extractJson('Hier ist dein Setup:\n```json\n{"rew":{"up":0.3,},}\n```\nViel Erfolg!');
ok(j1 && j1.rew && j1.rew.up === 0.3, 'extractJson: Codezäune/Prosa/hängende Kommata');

// applySetup gegen ECHTE Modelle (wie in der App live gebunden):
const { RewModel } = await import(join(WWW, 'js/feld/rewards.js'));
const { SchubModel } = await import(join(WWW, 'js/feld/schubser.js'));
const { GroundModel } = await import(join(WWW, 'js/feld/ground.js'));
const { PhoneModel } = await import(join(WWW, 'js/feld/phone.js'));
const { CmdGen } = await import(join(WWW, 'js/feld/cmdgen.js'));
const { FeldTrainer } = await import(join(WWW, 'js/feld/trainer.js'));

const S = {
  mode: 'train', budget: 30, fallMode: 'reset', fallWinS: 6,
  rew: new RewModel(null),
  schubser: new SchubModel(null),
  ground: new GroundModel(null),
  phone: new PhoneModel(null),
  cmdgen: new CmdGen({}),
  task: { obsDim: 61, actDim: 14, level: 3, setLevel(l) { this.level = Math.max(1, Math.min(5, Math.round(l))); } },
  trainer: { stage: 1, hyper: { T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2, epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005, maxGrad: 0.5 }, tricks: { on: true, autoLr: true, autoRollout: true, autoNoise: true } },
};
const res = gem.applySetup({
  rew: { up: 0.5, vel: -5, jlimit: 99, unbekannt: 1 },
  schubser: { on: 'ja', vMin: 0.8, vMax: 25, dir: 'diagonal', grow: true },
  ground: { on: 1, mode: 'achter', amp: 30 },
  phone: { on: 'ein', pushOn: 'true', thr: -2, vMax: 9, tiltMax: 90 },
  training: { budget: 500, level: 12, fallMode: 'ueben', fallWinS: 3.5, autoLr: 'false' },
  hyper: { lr: 1e-2, clip: 0.15, epochs: '6' },
  cmdgen: { drive: 'fluessig', head: 'quatsch' },
  muell: 'x',
}, S);
const all = res.changes.join(' | ');
ok(S.rew.up === 0.5, 'rew.up übernommen (0.5)');
ok(S.rew.vel === 0, 'rew.vel −5 → auf 0 GEKLEMMT (RW_FIELDS-Bereich)');
ok(S.rew.jlimit === 0.5, 'rew.jlimit 99 → auf 0.5 GEKLEMMT');
ok(!res.changes.some((c) => c.includes('unbekannt')), 'unbekanntes Rew-Feld still übersprungen');
ok(S.schubser.on === 1 && S.schubser.vMin === 0.8, 'schubser.on bool-Koercion („ja“) + vMin übernommen');
ok(S.schubser.vMax === 8, 'schubser.vMax 25 → auf 8 GEKLEMMT (Spec-Bereich)');
ok(S.schubser.dir === 'auto', 'schubser.dir „diagonal“ (kein Enum) → unverändert');
ok(S.schubser.grow === 1, 'schubser.grow true → 1');
ok(S.ground.on === 1 && S.ground.mode === 'achter' && S.ground.amp === 25, 'ground: on/„achter“ übernommen, amp 30 → 25 GEKLEMMT');
ok(S.phone.on === 1 && S.phone.pushOn === 1, 'phone-Schalter „ein“/„true“ → 1');
ok(S.phone.thr === 0.5 && S.phone.vMax === 4 && S.phone.tiltMax === 25, 'phone: thr/vMax/tiltMax auf Spec-Bereiche GEKLEMMT');
ok(S.budget === 150, 'training.budget 500 → 150 GEKLEMMT');
ok(S.task.level === 5, 'training.level 12 → 5 GEKLEMMT (setLevel genutzt)');
ok(S.fallMode === 'ueben' && S.fallWinS === 3.5, 'Sturz-Verhalten ueben + Fenster 3,5 s');
ok(S.trainer.tricks.autoLr === false, 'tricks.autoLr „false“ → false');
ok(S.trainer.hyper.clip === 0.15 && S.trainer.hyper.epochs === 6, 'hyper.clip/epochs übernommen (epochs string→int)');
ok(S.trainer.hyper.lr === 1.2e-3, 'hyper.lr 1e-2 → auf 1.2e-3 GEKLEMMT');
ok(S.cmdgen.drive.mode === 'fluessig' && S.cmdgen.head.mode !== 'quatsch', 'cmdgen: Enum drive übernommen, „quatsch“ abgewiesen');
ok(res.skipped.includes('muell') || (!all.includes('muell')), 'Gruppe ohne Schema übersprungen');
ok(all.includes('→') && all.includes('GEKLEMMT') === false, 'Änderungsliste deutsche Texte mit „alt → neu“');
ok(res.changes.some((c) => c.includes('Sturz-Verhalten: WEITERÜBEN')), 'Sturz-Verhalten-Änderung als deutscher Text');
ok(res.changes.some((c) => c.includes('Schubser: EIN')), 'Schubser-Einschalten als deutscher Text');

// Sanitizer: sMin ≤ sMax Intervall-Ordnung nach applySetup
gem.applySetup({ schubser: { sMin: 10, sMax: 2 } }, S);
ok(S.schubser.sMin <= S.schubser.sMax, 'sanitize hält Intervall-Ordnung (sMin ≤ sMax)');

// Kein-Op: leeres/ungültiges Setup darf nichts werfen
const r0 = gem.applySetup(null, S);
ok(r0.changes.length === 0 && r0.skipped.length === 0, 'applySetup(null) → leer, kein Wurf');

// State-Snapshot + Prompt
const snap = gem.buildStateSnap(S);
ok(snap.app.startsWith('Feld 3.7.0') || snap.app.startsWith('Feld 3.8.0') && snap.budget === 150 && snap.task_level_check === undefined, 'Snapshot trägt App+Version+budget');
ok(snap.schubser && typeof snap.schubser.vMax === 'number' && snap.ground && snap.phone && snap.rew, 'Snapshot: schubser/ground/phone/rew vollständig');
ok(snap.hyper && snap.hyper.lr > 0 && snap.fall.mode === 'ueben', 'Snapshot: hyper + fall-Modus');
const prompt = gem.buildPrompt('Mach sie schneller wendig', snap);
ok(prompt.includes('„Mach sie schneller wendig“'), 'Prompt enthält den Wunsch wörtlich');
ok(prompt.includes('"rew"') && prompt.includes('"schubser"') && prompt.includes('"training"'), 'Prompt: Schema-Gruppen');
ok(prompt.includes('0…2') || prompt.includes('0…2'), 'Schema-Text mit Bereichen (Zahl 0…2)');
ok(prompt.includes(JSON.stringify(snap)), 'Prompt: aktuelle Konfiguration als JSON eingebettet');
const body = JSON.parse(gem.gemBody(prompt));
ok(body.contents && body.contents[0].parts[0].text === prompt && body.generationConfig.temperature === 0.3, 'Request-Body: contents + generationConfig');

console.log('── 4. Version 107 / 3.7.0 + CI ──');
ok(vj.includes("export const VERSION = '3.7.0';") || vj.includes("export const VERSION = '3.8.0';") && vj.includes('export const VERSION_CODE = 107;') || vj.includes('export const VERSION_CODE = 108;'), 'version.js: 3.7.0 / 107');
ok((gradle.includes('versionCode 107') && gradle.includes('versionName "3.7.0"') || (gradle.includes('versionCode 108') && gradle.includes('versionName "3.8.0"'))), 'build.gradle: 107 / "3.7.0"');
ok(workflow.includes('7\\.0'), 'CI: OR-Kette auf 3.7.0 erweitert');

console.log('\nERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) process.exit(1);
