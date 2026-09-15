// duck_browser_test.mjs — E2E im Chromium (v2.12.0): Boot → MicroDuck →
// Tempo MAX (= PARALLEL über Web Workers) → Training starten →
// PPO-Runden mit Soft-MoE-Router nachweisen (Log + Router-Bars + steps/s).
// Usage: node scripts/duck_browser_test.mjs

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

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
console.log('Server:', BASE);

let fails = 0;
const check = (name, cond, detail = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FEHLER ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) fails++;
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1700 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('Stage: goto');
await page.goto(BASE + '/index.html');
console.log('Stage: warte auf Boot');
await page.waitForSelector('#robotBar.ui:not(.hidden)', { timeout: 150000 });
console.log('Boot ok');

const kidsText = () => page.evaluate(() => [...document.getElementById('consoleLog').children].map((d) => d.textContent.trim()));

// 1) MicroDuck wählen
await page.click('.robot-chip[data-robot="duck"]');
try {
  await page.waitForFunction(() => document.querySelector('.robot-chip[data-robot="duck"]')?.classList.contains('active'), null, { timeout: 150000 });
} catch (e) {
  console.log('Terminal-Tail:', JSON.stringify(await kidsText().catch(() => []), null, 1).slice(0, 1200));
  throw e;
}
check('MicroDuck aktiv', true);
const t1 = await kidsText();
check('Soft-MoE-Task geladen (MJCF OK, 14 Aktuatoren)', t1.some((l) => l.includes('MJCF OK') && l.includes('14 Aktuatoren')));

// 2) Trainings-Sheet öffnen + Tempo MAX (Parallel) wählen
await page.click('#btnTrainTop');
await page.waitForSelector('#trainSheet:not(.hidden)', { timeout: 5000 }).catch(() => {});
check('Trainings-Sheet offen', await page.evaluate(() => !document.getElementById('trainSheet')?.classList.contains('hidden')));
check('Router-Bars vorhanden', await page.evaluate(() => !!document.getElementById('routeBal')));
await page.click('.speed-chip[data-speed="max"]');

// 3) Training starten → Parallel + Soft-MoE-Log abwarten
await page.click('#tStart');
try {
  await page.waitForFunction(() => [...document.getElementById('consoleLog').children].some((d) => d.textContent.includes('SOFT-MOE')), null, { timeout: 20000 });
  check('Soft-MoE-PPO initialisiert', true);
} catch (e) {
  check('Soft-MoE-PPO initialisiert', false, (await kidsText()).slice(-4).join(' | '));
}
try {
  await page.waitForFunction(() => [...document.getElementById('consoleLog').children].some((d) => d.textContent.includes('PARALLEL')), null, { timeout: 40000 });
  check('Paralleltraining aktiv (Web Workers)', true);
} catch (e) {
  check('Paralleltraining aktiv (Web Workers)', false, (await kidsText()).slice(-4).join(' | '));
}

// 4) PPO-Runden laufen lassen (45 s)
await page.waitForTimeout(45000);
const t2 = await kidsText();
const roundLines = t2.filter((l) => l.includes('PPO-Runde'));
check('≥1 PPO-Runde gemischt', roundLines.length >= 1, roundLines.slice(-2).join(' | '));
check('Router im Log (Soft-MoE)', roundLines.some((l) => l.includes('Router')), roundLines[0] || '');
const rate = await page.evaluate(() => document.getElementById('tRate')?.textContent || '');
check('Schritte/s > 0 angezeigt', !/^0/.test(rate.trim()), rate);
const bars = await page.evaluate(() => ['routeBal', 'routeWalk', 'routeTurn', 'routeRec'].map(id => document.getElementById(id)?.style.width || ''));
check('Router-Bars bewegt', bars.every((w) => w.length > 0), bars.join(' '));
check('Level-Anzeige', await page.evaluate(() => /Lv \d/.test(document.getElementById('duckLevel')?.textContent || '')));

const workerErr = consoleErrors.filter((e) => /simworker|Worker/.test(e));
check('keine Worker-Konsolenfehler', workerErr.length === 0, workerErr.slice(0, 3).join(' | '));

await browser.close();
console.log(fails === 0 ? '\nBROWSER-E2E GRÜN' : `\n${fails} CHECK(S) ROT`);
process.exit(fails === 0 ? 0 : 1);
