/* WebView-Simulation E2E (v1.2): index.html über **file://** laden — wie die
 * Android-WebView. Der Asset-Nachschub läuft NICHT über fetch (auf file://
 * blockiert), sondern über eine Mock-AndroidBridge mit EXAKTER Java-Semantik
 * (MainActivity): synchron, Schlüssel = "mjc/" + übergebener Pfad, null wenn
 * fehlt — inkl. v1.2-Chunk-Reader (1-MB-Häppchen mit Yield zwischen den
 * Calls, damit der Main-Thread beim 13,5-MB-ORT-WASM flüssig bleibt).
 *
 * Neu v1.2 (Gerätebefund S26 Ultra: „lädt nicht zu Ende · Duck liegt im
 * Boden · nichts reagiert"):
 *   A) Boot-Pfad blockiert nicht mehr auf 4 Eager-Sessions (Hintergrund-Warm).
 *   B) Spawn = STAND-Keyframe: aufrecht, z≈0,12 — nicht liegend.
 *   C) Regelung mit 50-Hz-Wanduhr-Takt: ≤ ~55 Schritte/s, NICHT mehr 1 Schritt
 *      pro rAF-Frame (120-Hz-Panel → Physik 2,4× Echtzeit → Sturz + Freeze).
 *
 * Die Bytes (MuJoCo-WASM, ORT-WASM, MJCF, STLs, 4 Eager-ONNX-Policies) werden
 * beim Teststart aus app/src/main/assets/mjc/ gelesen und als generiertes
 * Init-Skript (base64-Map) injiziert — die Bridge ist wie in Java synchron. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MJC = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'mjc');
const GEN = path.join(__dirname, '.tmp_mock_bridge.gen.js');

/* ---------- Init-Skript generieren (Mock-Bridge mit echten Bytes) ---------- */
function b64(rel) {
  return fs.readFileSync(path.join(MJC, rel)).toString('base64');
}
const want = [
  'mujoco.wasm',
  'ort-wasm-simd-threaded.wasm',
  'duck_legs.xml',
  '__index.json',
  'meshes/bottom_head_shell.stl', 'meshes/hip_l.stl', 'meshes/jaw.stl', 'meshes/leg.stl',
  'meshes/np_f970.stl', 'meshes/power_support.stl', 'meshes/sole_left.stl', 'meshes/sole_right.stl',
  'meshes/top_head_shell.stl', 'meshes/tire.stl',
  'policies/BEST_alpha_walking.onnx', 'policies/BEST_roller.onnx',
  'policies/BEST_alpha_sitstand.onnx', 'policies/BEST_alpha_stand.onnx',
];
const map = {};
for (const rel of want) map['mjc/' + rel] = b64(rel);
const total = Object.values(map).reduce((s, v) => s + v.length, 0);
/* Mock-Bridge: exakte Java-Semantik (v1.2 inkl. Chunk-Reader: [o, o+l), null
 * jenseits des Dateiendes / leer). Chunk-Größe wie Java-Test: 1 MB.
 * Performant: Bytes werden PRO PFAD GENAU EINMAL dekodiert (Cache), Base64-
 * Rückweg über Block-apply (kein Byte-für-Byte-Concat — bei 38 MB × 2 Seiten
 * wäre das ein Test-Timeout). */
const script =
  'window.__bridgePaths = [];\n' +
  'window.__bridgeChunkCalls = [];\n' +
  'window.ASSET_MAP = ' + JSON.stringify(map) + ';\n' +
  'var __bytesCache = {};\n' +
  'function __getBytes(p) {\n' +
  '  if (!(p in __bytesCache)) {\n' +
  '    var v = window.ASSET_MAP["mjc/" + p];\n' +
  '    if (v == null) { __bytesCache[p] = null; return null; }\n' +
  '    var bin = atob(v), n = bin.length, out = new Uint8Array(n);\n' +
  '    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);\n' +
  '    __bytesCache[p] = out;\n' +
  '  }\n' +
  '  return __bytesCache[p];\n' +
  '}\n' +
  'function __u8ToB64(u) {\n' +
  '  var s = "";\n' +
  '  for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + 32768, u.length)));\n' +
  '  return btoa(s);\n' +
  '}\n' +
  'window.AndroidBridge = {\n' +
  '  readAssetBase64: function (p) { window.__bridgePaths.push(p); return window.ASSET_MAP["mjc/" + p] || null; },\n' +
  '  readAssetChunkBase64: function (p, off, len) {\n' +
  '    window.__bridgePaths.push(p); window.__bridgeChunkCalls.push([p, off, len]);\n' +
  '    var bytes = __getBytes(p);\n' +
  '    if (bytes == null) return null;\n' +
  '    if (off < 0 || len <= 0 || off >= bytes.length) return null;\n' +
  '    var slice = bytes.subarray(off, Math.min(off + len, bytes.length));\n' +
  '    if (!slice.length) return null;\n' +
  '    return __u8ToB64(slice);\n' +
  '  },\n' +
  '  readAssetText: function (p) { window.__bridgePaths.push(p); var v = window.ASSET_MAP["mjc/" + p]; return v == null ? null : atob(v); },\n' +
  '};\n';
fs.writeFileSync(GEN, script);
console.log(`Mock-Bridge generiert: ${want.length} Assets, ${(total / 1e6).toFixed(1)} MB base64`);

(async () => {
  const indexHtml = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html');
  const url = 'file://' + indexHtml + '?mjonly=1';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const T0 = Date.now();
  const t = () => ((Date.now() - T0) / 1000).toFixed(1);
  page.on('pageerror', (e) => console.log(`[${t()}s] PAGEERROR: ${String((e && e.message) || e).slice(0, 200)}`));
  await page.addInitScript({ path: GEN });

  await page.goto(url);
  const ev = (ms) => new Promise((r) => setTimeout(r, ms));

  let ready = false, badge = '', err = null;
  for (let i = 0; i < 150 && !ready; i++) {
    await ev(1000);
    try {
      const st = await page.evaluate(() => ({
        // Fertig erst, wenn der APP-Pfad durch ist: Badge 'MUJOCO' + Duck existiert
        ok: /MUJOCO/.test(((document.getElementById('engineBadge') || {}).textContent) || '') &&
            !!(TF07 && TF07.inst && TF07.inst.state && TF07.inst.state.mjc && TF07.inst.state.mjc.duck),
        badge: (document.getElementById('engineBadge') || {}).textContent || '(kein Badge)',
        err: (TF07 && TF07.inst && TF07.inst.state && TF07.inst.state.mjc && TF07.inst.state.mjc.err) || null,
        nCalls: (window.__bridgePaths || []).length,
      }));
      badge = st.badge; err = st.err;
      if (i % 10 === 0) console.log(`[${t()}s] badge="${badge}" bridge=${st.nCalls} Aufrufe err=${st.err}`);
      ready = st.ok;
    } catch (e) { /* weiterwarten */ }
  }
  if (!ready) {
    console.log(`FILE://-BRIDGE-SMOKE FEHLER: MJ nicht bereit — badge="${badge}" err=${err}`);
    await browser.close(); process.exit(1);
  }
  console.log(`[${t()}s] MJ bereit über file:// + Bridge — Badge: "${badge}"`);

  /* A) v1.2: Policies werden im HINTERGRUND geladen — hier poll-en bis 4 da */
  let pol = [];
  for (let i = 0; i < 60 && pol.length < 4; i++) {
    await ev(1000);
    pol = await page.evaluate(() => (TF07.mjc && TF07.mjc.policiesLoaded()) || []);
  }
  console.log(`[${t()}s] Policies (Hintergrund-Warm): ${pol.join(', ')}`);

  /* Bridge-Kontrakt im echten Lauf: KEIN Aufruf mit "mjc/…"-Präfix + Chunk-Nutzung */
  const paths = await page.evaluate(() => window.__bridgePaths);
  const dirty = paths.filter((p) => p.startsWith('mjc/') || p.startsWith('/'));
  const chunkStats = await page.evaluate(() => {
    const c = window.__bridgeChunkCalls || [];
    return { n: c.length, maxLen: c.reduce((m, x) => Math.max(m, x[2]), 0) };
  });
  console.log(`[${t()}s] Bridge-Aufrufe: ${paths.length} (Chunks: ${chunkStats.n}, maxLen ${chunkStats.maxLen}), mit Präfix: ${dirty.length}${dirty.length ? ' → ' + dirty.slice(0, 3).join(', ') : ''}`);

  const info = await page.evaluate(() => TF07.mjc.info());
  console.log(`[${t()}s] duck nq=${info.nq} nu=${info.nu}`);

  /* B) Spawn = STAND-Keyframe: aufrecht im Boden-Abstand, NICHT liegend */
  const spawn = await page.evaluate(() => {
    const d = TF07.inst.state.mjc.duck;
    d.reset();
    return { z: d.data.qpos[2], fallen: d.fallen, finite: d.data.qpos.every(isFinite) };
  });
  console.log(`[${t()}s] Spawn: z=${spawn.z.toFixed(3)} fallen=${spawn.fallen} finite=${spawn.finite}`);
  const spawnOk = spawn.finite && !spawn.fallen && spawn.z > 0.05 && spawn.z < 0.25;

  /* 50 Regelschritte (ONNX auf MuJoCo) — wie v1.1 */
  const run = await page.evaluate(async () => {
    const d = TF07.inst.state.mjc.duck;
    d.setCmd(0.3, 0, 0);
    for (let i = 0; i < 50; i++) await d.controlStepAsync();
    return { finite: d.data.qpos.every(isFinite), z: d.data.qpos[2] };
  });
  console.log(`[${t()}s] 50 Regelschritte (ONNX auf MuJoCo): finite=${run.finite} z=${run.z.toFixed(3)}`);

  /* C) v1.2-Kernfix: 50-Hz-Wanduhr-Pacer — deterministisch über den
   * Test-Hook __testDrive mit SYNTHETISCHEM 120-Hz-Takt gepumpt (so wie
   * das 120-Hz-Panel des S26 Ultra der App früher jede Frame einen
   * Regelschritt aufdrückte). Erwartung: gemessene Regelrate ~50 Hz
   * (≤ 65), NICHT ~120 — und der Duck bleibt mit Null-Command aufrecht.
   * (Ein echter rAF-Loop läuft im Headless-Chromium ohne Vsync als
   * BeginFrame-Sturm und wäre kein gerätetreues Messfenster.) */
  const pump = await page.evaluate(async () => {
    const d = TF07.inst.state.mjc.duck;
    d.reset();
    const inst = TF07.inst;
    const T = 1200; // ms Pump-Dauer
    const t0 = performance.now();
    let n = 0, last = performance.now();
    while (performance.now() - t0 < T) {
      await new Promise((r) => setTimeout(r, 0)); // Yield wie zwischen rAF-Frames
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); // ECHTE Wandzeit-dt (wie rAF-Timestamps)
      last = now;
      inst.__testDrive(dt);
      n++;
    }
    const dur = (performance.now() - t0) / 1000;
    const fallen = d.fallen;
    const z = d.data.qpos[2];
    const finite = d.data.qpos.every(isFinite);
    return { n, dur, hz: inst.ctrlHzMeasured(), fallen, z, finite };
  });
  console.log(`[${t()}s] Pacer-Pump (wandzeitgetreu): ${pump.n} Frames in ${pump.dur.toFixed(2)} s → gemessen ${pump.hz.toFixed(1)} Hz (Soll ~50, alt-Bug = Pumprate) · duck fallen=${pump.fallen} z=${pump.z.toFixed(3)} finite=${pump.finite}`);
  const pacerOk = pump.finite && !pump.fallen && pump.hz > 20 && pump.hz <= 65 && pump.z > 0.02;

  const ok = /MUJOCO/.test(badge) && /v1\.2\.0/.test(badge) && dirty.length === 0 &&
    run.finite && pol.length >= 4 && spawnOk && pacerOk;
  console.log(ok ? 'FILE://-BRIDGE-SMOKE GRÜN' : 'FILE://-BRIDGE-SMOKE FEHLER');
  fs.unlinkSync(GEN);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { try { fs.unlinkSync(GEN); } catch (_) {} console.error('SMOKE FEHLGESCHLAGEN:', e.message); process.exit(1); });
