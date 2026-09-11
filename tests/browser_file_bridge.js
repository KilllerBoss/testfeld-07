/* WebView-Simulation E2E (v1.1): index.html über **file://** laden — wie die
 * Android-WebView. Der Asset-Nachschub läuft NICHT über fetch (auf file://
 * blockiert), sondern über eine Mock-AndroidBridge mit EXAKTER Java-Semantik
 * (MainActivity): synchron, Schlüssel = "mjc/" + übergebener Pfad, null wenn
 * fehlt. Ein Doppelprefix-Regression ("mjc/mjc/…") würde hier sofort als
 * FALLBACK-Badge sichtbar und der Test rot.
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
const script =
  'window.__bridgePaths = [];\n' +
  'window.ASSET_MAP = ' + JSON.stringify(map) + ';\n' +
  'window.AndroidBridge = {\n' +
  '  readAssetBase64: function (p) { window.__bridgePaths.push(p); return window.ASSET_MAP["mjc/" + p] || null; },\n' +
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

  /* Bridge-Kontrakt im echten Lauf: KEIN Aufruf mit "mjc/…"-Präfix */
  const paths = await page.evaluate(() => window.__bridgePaths);
  const dirty = paths.filter((p) => p.startsWith('mjc/') || p.startsWith('/'));
  console.log(`[${t()}s] Bridge-Aufrufe: ${paths.length}, mit Präfix: ${dirty.length}${dirty.length ? ' → ' + dirty.slice(0, 3).join(', ') : ''}`);

  const info = await page.evaluate(() => TF07.mjc.info());
  const pol = await page.evaluate(() => TF07.mjc.policiesLoaded());
  console.log(`[${t()}s] duck nq=${info.nq} nu=${info.nu} · Policies: ${pol.join(', ')}`);

  const run = await page.evaluate(async () => {
    const d = TF07.inst.state.mjc.duck;
    d.setCmd(0.3, 0, 0);
    for (let i = 0; i < 50; i++) await d.controlStepAsync();
    return { finite: d.data.qpos.every(isFinite), z: d.data.qpos[2] };
  });
  console.log(`[${t()}s] 50 Regelschritte (ONNX auf MuJoCo): finite=${run.finite} z=${run.z.toFixed(3)}`);

  const ok = /MUJOCO/.test(badge) && /v1\.1\.0/.test(badge) && dirty.length === 0 && run.finite && pol.length >= 4;
  console.log(ok ? 'FILE://-BRIDGE-SMOKE GRÜN' : 'FILE://-BRIDGE-SMOKE FEHLER');
  fs.unlinkSync(GEN);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { try { fs.unlinkSync(GEN); } catch (_) {} console.error('SMOKE FEHLGESCHLAGEN:', e.message); process.exit(1); });
