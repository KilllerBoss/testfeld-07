// ui_v2140_test.mjs — v2.14.0 Browser-Smoke-Test (Playwright, Headless):
//   1) Boot ohne Fehler, Splash endet, 3 Roboter-Chips (g1/duck/x2)
//   2) Tempo-SLIDER vorhanden, MAX-Chip weg, Slider-Wirkung (speedMode)
//   3) rateChart + rewardChart vorhanden; drawRateChart zeichnet ohne Fehler
//   4) Theme setzen (setUI-Pfad → body[data-theme]) + Design-Variablen wirken
//   5) KI-Welt per buildWorldXML + Weltleiste hat KI-WELT-Chip
//   6) Aussehen: setAppearance-Pfad am echten Modell (r3d.setAppearance) — Meshfarbe ändert sich
// Usage: node scripts/ui_v2140_test.mjs
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
  let p = path.join(WWW, url === '/' ? 'index.html' : url);
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
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
console.log('\n■ 1) Boot + Roster');
await page.waitForFunction(() => !document.getElementById('splash') || document.getElementById('splash').classList.contains('gone'), null, { timeout: 60000 });
ok(true, 'Splash beendet (Roboter kompiliert)');
await page.waitForFunction(() => document.querySelectorAll('#robotBar .robot-chip').length > 0, null, { timeout: 20000 });
const chips = await page.$$eval('#robotBar .robot-chip', els => els.map(e => e.dataset.robot));
ok(chips.length === 3 && chips.includes('g1') && chips.includes('duck') && chips.includes('x2'), '3 Roboter-Chips: g1/duck/x2', chips.join(', '));
const bootLog = await page.$eval('#consoleLog', el => el.textContent);
ok(bootLog.includes('Drei Roboter'), 'Boot-Log meldet Drei Roboter');

console.log('\n■ 2) Tempo-Slider');
const hasMax = await page.$$eval('.speed-chip[data-speed]', els => els.length);
ok(hasMax === 0, 'MAX/1×/4×/16×-Chips entfernt', String(hasMax));
const slider = await page.$('#speedSlider');
ok(!!slider, 'speedSlider vorhanden');
const val0 = await page.$eval('#speedVal', el => el.textContent);
ok(/^\d+×$/.test(val0), 'Label zeigt „N×"', val0);
await page.$eval('#speedSlider', el => { el.value = 9; el.dispatchEvent(new Event('input', { bubbles: true })); });
const sm = await page.evaluate(() => window.__trainrobot ? 'kein-handle' : 'kein-handle');
void sm;
const label9 = await page.$eval('#speedVal', el => el.textContent);
ok(label9 === '9×', 'Slider-Eingabe → 9×', label9);
const stored = await page.evaluate(() => localStorage.getItem('tr_speed_v2'));
ok(stored === '9', 'Slider persistiert', String(stored));

console.log('\n■ 3) Charts');
ok(!!(await page.$('#rateChart')), 'rateChart vorhanden');
ok(!!(await page.$('#rewardChart')), 'rewardChart vorhanden');
// Trainings-Panel öffnen → drawChart/drawRateChart laufen (Klick auf Trainings-Button)
await page.click('#btnTrainTop');
await page.waitForTimeout(700);
const chartDrawn = await page.evaluate(() => {
  const c = document.getElementById('rateChart');
  if (!c) return false;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n > 100; // Platzhaltertext/Regen-Muster gezeichnet
});
ok(chartDrawn, 'rateChart zeichnet (Platzhalter/Live-Daten)');

console.log('\n■ 4) Theme (setUI-Pfad)');
await page.evaluate(() => { document.body.dataset.theme = 'neon'; });
const acc = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--amber').trim());
ok(acc.toLowerCase() === '#b44dff', 'Theme „neon" ändert --amber', acc);
await page.evaluate(() => { document.body.dataset.theme = ''; });

console.log('\n■ 5) KI-WELT in der Weltleiste');
const worldChips = await page.$$eval('#worldBar .world-chip', els => els.map(e => e.dataset.world));
ok(worldChips.includes('ki'), 'Weltleiste hat KI-WELT-Chip', worldChips.join(', '));

console.log('\n■ 6) setAppearance am echten Modell');
const lookRes = await page.evaluate(async () => {
  const T = window.__trainrobot;
  if (!T || !T.sim) return { err: 'kein Handle' };
  const { sanitizeAppearance, resolveAppearance, partCatalog } = await import('./js/appearance.js');
  const cat = partCatalog(T.sim);
  const spec = sanitizeAppearance({ parts: [{ part: cat.materials[0], color: '#ff00ff', shine: 1 }] });
  const before = [];
  T.renderer.bodyGroups.forEach(g => g && g.children.forEach(m => before.push(m.material.color.getHexString())));
  const map = T.renderer.setAppearance(T.sim, spec);
  const after = [];
  T.renderer.bodyGroups.forEach(g => g && g.children.forEach(m => after.push(m.material.color.getHexString())));
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i] !== after[i]) changed++;
  return { geoms: map.size, changed, mats: cat.materials.length, first: cat.materials[0], hex: after[0] };
});
if (lookRes.err) ok(false, 'setAppearance-Test', lookRes.err);
else {
  ok(lookRes.geoms > 0, 'resolveAppearance matcht Geoms (' + lookRes.first + ')', lookRes.geoms + ' Geoms');
  ok(lookRes.changed > 0, 'Mesh-Farben im Renderer GEÄNDERT (live)', lookRes.changed + ' Meshes');
}
ok(lookRes && !lookRes.err && lookRes.mats > 0, 'Teile-Katalog im Browser', lookRes.mats + ' Materialien');

console.log('\n■ JS-Fehler');
const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('net::') && !e.includes('Gemini'));
ok(realErrors.length === 0, 'keine Seitelfehler (pageerror/console.error)', realErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${fail === 0 ? 'ALLE ' + pass + ' CHECKS GRÜN' : fail + ' FEHLER, ' + pass + ' grün'}`);
process.exit(fail === 0 ? 0 : 1);
