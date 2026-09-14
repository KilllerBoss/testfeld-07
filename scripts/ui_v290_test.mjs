// ui_v290_test.mjs — v2.9.0-Verifikation im Browser (echte Physik + UI):
//   1) Werkstatt zeigt 3 ★-Plugins (inkl. „Kopfstand-Training")
//   2) „Aufgabe liegen" (getup): Roboter liegt ÜBER dem Boden (minGeomZ)
//      — Fix für „Roboter ist unter dem Boden wie auf der Bodendecke"
//   3) Kopfstand-Plugin: onReset-Teleport kopfüber ÜBER dem Boden, Reward
//      bekommt ECHTES info.upz (v2.8.0: immer undefined) — „Plugin formt
//      Belohnung" ist im Training sichtbar (Log-Zeile)
//   4) „Liegen lassen" + Training: Sturz-Ende einer Episode teleportiert
//      NICHT mehr (Episoden zählen weiter, Roboter bleibt unten)
// Jede schwere Sektion in einem FRISCHEN Browser (SwiftShader-Speicher).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]));
    const buf = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name + (extra ? ' — ' + extra : '')); if (!cond) fails++; };

const upzExpr = `(() => { const s = window.__trainrobot.sim; const o = 4 * s.baseBody; const x = s._xquat[o + 1], y = s._xquat[o + 2]; return 1 - 2 * (x * x + y * y); })()`;

async function freshPage() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });
  return { browser, page };
}

// ── Sektion 1+2: Werkstatt + getup liegt ÜBER dem Boden ──
console.log('── Sektion 1/3: Werkstatt + getup-Startlage ──');
{
  const { browser, page } = await freshPage();
  check('Kopfstand-Training in der Werkstatt gelistet', (await page.evaluate(() => window.__trainrobot.plugins.map(p => p.name).join(','))).includes('Kopfstand-Training'));
  check('3 ★-Plugins insgesamt', await page.evaluate(() => window.__trainrobot.plugins.filter(p => p.builtin).length === 3));

  await page.evaluate(() => window.__trainrobot.setScenario('getup'));
  await page.waitForTimeout(400);
  const mz = await page.evaluate(() => window.__trainrobot.sim.minGeomZ(true));
  const upz = await page.evaluate(upzExpr);
  check(`getup-Start bodenfrei (minZ ${mz.toFixed(4)} ≥ −0.005)`, mz >= -0.005);
  check(`getup-Start liegt (upz ${upz.toFixed(2)} < 0.2)`, upz < 0.2);
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const s = window.__trainrobot.sim;
    const q = s._qvel;
    return { finite: Number.isFinite(q[0] + q[1] + q[2] + q[3] + q[4] + q[5]), mz: s.minGeomZ(true) };
  });
  check('nach 1,2 s: qvel endlich', st.finite);
  check(`nach 1,2 s: am Boden geblieben (minZ ${st.mz.toFixed(4)} > −0.06)`, st.mz > -0.06);
  await browser.close();
}

// ── Sektion 3: Kopfstand-Muster mit echtem upz + sichtbarem Trainingseffekt ──
console.log('── Sektion 2/3: Kopfstand-Muster (echtes info.upz, Plugin-Log) ──');
{
  const { browser, page } = await freshPage();
  const r = await page.evaluate(() => {
    window.__upzProbe = null;
    const code = `
api.onReset(() => { const s = api.sim(); if (!s) return; const p=[0,0,0]; s.basePos(p);
  const yaw = 0.3, cy=Math.cos(yaw/2), sy=Math.sin(yaw/2), t=Math.PI, ct=Math.cos(t/2), st2=Math.sin(t/2);
  api.teleport(p[0], p[1], Math.max(p[2],0.15), cy*ct, cy*st2, sy*st2, sy*ct); });
api.onReward((info) => { window.__upzProbe = info.upz; return { bonus: 0.25, done: false }; });`;
    return window.__trainrobot.installPlugin('upz-probe', code, true);
  });
  check('upz-probe Plugin installiert', r.ok, r.error || '');
  await page.evaluate(() => window.__trainrobot.executeAction({ type: 'reset' })); // onReset feuern
  await page.waitForTimeout(400);
  const mz = await page.evaluate(() => window.__trainrobot.sim.minGeomZ(true));
  const upz0 = await page.evaluate(upzExpr);
  check(`onReset-Teleport kopfüber bodenfrei (minZ ${mz.toFixed(4)} ≥ −0.005)`, mz >= -0.005);
  check(`kopfüber angekommen (upz ${upz0.toFixed(2)} < −0.5)`, upz0 < -0.5);

  // Training starten (gedrosselt 1× — SwiftShader verträgt kein MAX) → onReward feuert
  await page.evaluate(() => { document.querySelector('.speed-chip[data-speed="1"]').click(); document.getElementById('tStart').click(); });
  let probeOk = false, plgLog = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const p = await page.evaluate(() => ({ upz: window.__upzProbe, logs: Array.from(document.querySelectorAll('#consoleLog div')).map(e => e.textContent).join('§') }));
    if (p.upz !== null && Number.isFinite(p.upz)) probeOk = true;
    if (p.logs.includes('Plugin-Belohnung aktiv')) plgLog = true;
    if (probeOk && plgLog) break;
  }
  check('onReward bekommt ECHTES info.upz (v2.9.0-Fix, war undefined)', probeOk);
  check('„Plugin-Belohnung aktiv"-Log erscheint (Training sichtbar beeinflusst)', plgLog);
  await page.evaluate(() => document.getElementById('tStart').click()); // Training stoppen
  await browser.close();
}

// ── Sektion 3: „Liegen lassen" + Training — kein Teleport beim Sturz-Ende ──
console.log('── Sektion 3/3: Liegen lassen im Training ──');
{
  const { browser, page } = await freshPage();
  await page.evaluate(() => window.__trainrobot.setFallMode('stay'));
  // Deterministisch: Roboter AUF DEN RÜCKEN legen (upz = −1). Der erste
  // Trainings-Schritt sieht upz < upMin → Sturz-Done. Mit „Liegen lassen"
  // darf KEIN Teleport folgen: Episoden zählen pro Schritt weiter, der
  // Roboter bleibt unten. Altes Verhalten: Teleport zur Stehpose (ep ~1-3).
  await page.evaluate(() => {
    // IM GLEICHEN Frame legen + Training starten (sonst richtet sich der
    // A1 im Echtzeit-Loop mit seinem Trot-Gait wieder selbst auf)
    const s = window.__trainrobot.sim;
    s.placeBaseFull(0, 0, 0.14, 0, 1, 0, 0); // Rücken, niedrig
    document.querySelector('.speed-chip[data-speed="1"]').click();
    document.getElementById('tStart').click();
  });
  await page.waitForTimeout(3000); // ~3 s Training
  const st = await page.evaluate(() => {
    const s = window.__trainrobot.sim;
    const o = 4 * s.baseBody; const x = s._xquat[o + 1], y = s._xquat[o + 2];
    return { h: s._xpos[3 * s.baseBody + 2], upz: 1 - 2 * (x * x + y * y), ep: window.__trainrobot.episodes };
  });
  const ok = st.ep >= 3 && st.upz < 0 && st.h < 0.2;
  const detail = `ep=${st.ep} (alt: ~1-3), upz=${st.upz.toFixed(2)}, h=${st.h.toFixed(2)} — geblieben & Episoden zählen`;
  check('„Liegen lassen": Sturz-Ende im Training teleportiert NICHT', ok, detail);
  const chipStay = await page.evaluate(() => document.querySelector('.fall-chip[data-fall="stay"]').classList.contains('active'));
  check('Fall-Chip „Liegen lassen" aktiv', chipStay);
  await browser.close();
}

console.log(fails ? `\n${fails} FEHLER` : '\nALLE CHECKS GRÜN');
process.exit(fails ? 1 : 0);
