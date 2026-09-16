// ui_v2150_test.mjs — v2.15.0 Browser-Test (Playwright):
//   1) GLB-Sektion für ALLE Roboter sichtbar
//   2) Referenz-Chips STELLE/FREI/FOLGT + OHNE-ANIM-Button + Persistenz
//   3) Clip-Aktivierung am MicroDuck (motionByRobot → Motion-Task nu=14)
//   4) OHNE ANIM WEITER: animOn=false, Task bleibt (Policy-Slot erhalten)
//   5) Roboterwechsel ohne GLB-Datei → saubere Deaktivierung (Wechsel zu X2)
// EIN Boot (SwiftShader stirbt sonst nach ~3 Boot-Vorgängen — bekannt seit
// v2.4.1); Roboter-Wechsel: g1(Boot) → duck → x2.
// Usage: node scripts/ui_v2150_test.mjs
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xml': 'model/xml', '.stl': 'model/stl', '.obj': 'text/plain', '.png': 'image/png', '.md': 'text/markdown', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const p = path.join(WWW, url === '/' ? 'index.html' : url);
  if (!p.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  try {
    const buf = fs.readFileSync(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const s = document.getElementById('splash');
  return !s || s.classList.contains('gone');
}, null, { timeout: 120000 });
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(300);

const switchRobot = async (rid) => {
  await page.evaluate(async (r) => {
    const T = window.__trainrobot;
    document.querySelector(`.robot-chip[data-robot="${r}"]`).click();
    while (T.switching) await new Promise(res => setTimeout(res, 100));
  }, rid);
  await page.waitForTimeout(400);
};

console.log('\n■ 1) GLB-Sektion für alle Roboter');
ok(await page.evaluate(() => !document.getElementById('glbSection').classList.contains('hidden')), 'GLB-Sektion sichtbar bei G1 (Boot)');
await switchRobot('duck');
ok(await page.evaluate(() => !document.getElementById('glbSection').classList.contains('hidden')), 'GLB-Sektion sichtbar bei MicroDuck');
await switchRobot('x2');
ok(await page.evaluate(() => !document.getElementById('glbSection').classList.contains('hidden')), 'GLB-Sektion sichtbar bei Drohne');

console.log('\n■ 2) Referenz-Chips + Persistenz');
const chipCount = await page.$$eval('.ref-chip', els => els.map(e => e.dataset.ref));
ok(chipCount.length === 3 && chipCount.includes('stelle') && chipCount.includes('frei') && chipCount.includes('folgt'), '3 Chips: STELLE/FREI/FOLGT', chipCount.join(','));
ok(!!(await page.$('#glbUnbind')), 'OHNE-ANIM-WEITER-Button vorhanden');
await page.evaluate(() => window.__trainrobot.setRefMode('stelle'));
const persisted0 = await page.evaluate(() => localStorage.getItem('tr_refmode_v1'));
ok(persisted0 === 'stelle', 'setRefMode persistiert sofort', String(persisted0));

console.log('\n■ 3) Clip-Aktivierung am MicroDuck (motionByRobot)');
await switchRobot('duck');
await page.evaluate(async () => {
  const { putClip } = await import('./js/glbstore.js');
  const n = 30, nu = 14, fps = 10;
  const q = new Array(n * nu).fill(0);
  const h = new Array(n).fill(0.12);
  const root = [];
  for (let f = 0; f < n; f++) root.push(0, f * 0.05);
  const yaw = new Array(n).fill(0);
  await putClip({
    id: 'glb_testduck', name: 'TestDuck', size: 10, glb: null, animIndex: 0,
    motionByRobot: { duck: { q, h, fps, n, nu, name: 'TestDuck', duration: 3, mapped: [], alg: 99, root, yaw, locomotion: true, robotId: 'duck' } },
  });
  window.__trainrobot.refreshClips();
});
let rows = 0;
try {
  await page.waitForFunction(() => document.querySelectorAll('#glbList .glb-clip').length >= 1, null, { timeout: 8000 });
  rows = await page.$$eval('#glbList .glb-clip', els => els.length);
} catch (e) { /* Timeout — rows bleibt 0 */ }
ok(rows >= 1, 'Clip-Liste zeigt Eintrag', rows + ' Zeilen');
const activated = await page.evaluate(() => {
  const row = [...document.querySelectorAll('#glbList .glb-clip')].find(r => r.textContent.includes('TestDuck'));
  const use = row && [...row.querySelectorAll('button')].find(b => b.textContent === 'Referenz');
  if (use) use.click();
  return !!use;
});
ok(activated, 'Referenz-Button geklickt');
await page.waitForTimeout(700);
const mi = await page.evaluate(() => window.__trainrobot.motionInfo);
ok(mi.active === true && mi.taskKind === 'motion', 'Motion-Task aktiv am Duck', JSON.stringify(mi));
ok(mi.nu === 14 && mi.clipRobot === 'duck', 'Clip-Variante für Duck (nu=14)', `nu=${mi.nu} robot=${mi.clipRobot}`);

console.log('\n■ 4) Referenz-Modi + OHNE ANIM WEITER');
await page.evaluate(() => document.querySelector('.ref-chip[data-ref="folgt"]').click());
ok((await page.evaluate(() => window.__trainrobot.refMode)) === 'folgt', 'Chip FOLGT → refMode=folgt');
await page.evaluate(() => document.querySelector('.ref-chip[data-ref="stelle"]').click());
ok((await page.evaluate(() => window.__trainrobot.refMode)) === 'stelle', 'Chip STELLE → refMode=stelle');
await page.evaluate(() => document.querySelector('.ref-chip[data-ref="folgt"]').click());
await page.evaluate(() => window.__trainrobot.unbindAnimation());
await page.waitForTimeout(300);
const afterUnbind = await page.evaluate(() => ({ info: window.__trainrobot.motionInfo, ref: window.__trainrobot.refMode, tog: document.getElementById('animTrainToggle').checked }));
ok(afterUnbind.info.animOn === false, 'unbind → animOn=false', String(afterUnbind.info.animOn));
ok(afterUnbind.info.taskKind === 'motion' && afterUnbind.info.active === true, 'Motion-Task bleibt aktiv (Policy-Slot erhalten)');
ok(afterUnbind.ref === 'folgt' && afterUnbind.tog === false, 'unbind → refMode folgt + Checkbox aus');

console.log('\n■ 5) Roboterwechsel ohne GLB-Datei → saubere Deaktivierung');
await switchRobot('x2');
const mi2 = await page.evaluate(() => window.__trainrobot.motionInfo);
ok(mi2.active === false, 'Referenz deaktiviert (keine GLB-Daten für X2)', JSON.stringify(mi2));

const realErrors = errs.filter(e => !e.includes('favicon') && !e.includes('net::') && !e.includes('Gemini') && !e.includes('Core assertion'));
ok(realErrors.length === 0, 'keine Seiten-/Konsolenfehler', realErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n═══ ERGEBNIS: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
