// ui_v2100_test.mjs — v2.10.0 PARALLELES TRAINING im Chromium:
//   1) Szenario-Chips vorhanden (gehen/getup/drop), „Gehen“ aktiv
//   2) Tempo MAX startet MuJoCo-Sim-Worker(s) → Segmente werden gemischt,
//      stepCount wächst, Schritte/s > 0, PPO-Runden im Log
//   3) Pause terminiert die Worker sauber
//   4) Aufstehen-Szenario: Roboter startet ÜBER dem Boden (Regression v2.9.0)
//   5) Keine Seiten-Fehler (pageerror)
// Usage: node scripts/ui_v2100_test.mjs

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

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ FEHLER: ' + msg); } };

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, null, { timeout: 45000 });
  await page.waitForTimeout(600);

  console.log('\n■ Szenario-Chips (Aufgaben)');
  await page.click('#btnTrainTop');
  await page.waitForTimeout(250);
  const chips = await page.$$eval('#scnRow .scn-chip', els => els.map(e => e.dataset.scn));
  ok(chips.includes('gehen') && chips.includes('getup') && chips.includes('drop'), 'Szenario-Chips: ' + chips.join(', '));
  const scnActive = await page.$eval('#scnRow .scn-chip.active', e => e.dataset.scn);
  ok(scnActive === 'gehen', 'Standard-Szenario „Gehen“ aktiv (Tempo-Tracking = Parallel-Ziel)');

  console.log('\n■ PARALLELES TRAINING (Tempo MAX → Sim-Worker + PPO-Merge)');
  const maxActive = await page.$eval('.speed-chip[data-speed="max"]', e => e.classList.contains('active'));
  ok(maxActive, 'Tempo MAX vorausgewählt');
  await page.click('#tStart', { noWaitAfter: true });
  await page.waitForFunction(() => {
    const t = window.__trainrobot;
    return t.parallel && t.parallel.active && t.trainer && t.trainer.stepCount > 500;
  }, null, { timeout: 60000 });
  const st = await page.evaluate(() => ({
    active: window.__trainrobot.parallel.active,
    workers: window.__trainrobot.parallel.n,
    steps: window.__trainrobot.trainer.stepCount,
  }));
  ok(st.active, 'ParallelTrainer aktiv');
  ok(st.workers >= 1, 'Sim-Worker aktiv: ' + st.workers);
  ok(st.steps > 500, 'Schritte gemischt: ' + st.steps);
  await page.waitForTimeout(3500);
  const st2 = await page.evaluate(() => ({
    steps: window.__trainrobot.trainer.stepCount,
    rate: window.__trainrobot.parallel ? window.__trainrobot.parallel.rate : 0,
    round: window.__trainrobot.parallel ? window.__trainrobot.parallel.round : 0,
  }));
  ok(st2.steps > st.steps, 'Training läuft weiter (' + st2.steps + ' Schritte)');
  ok(st2.round >= 3, 'Mehrere PPO-Runden gemischt: ' + st2.round);
  ok(st2.rate > 0, 'Schritte/s: ' + Math.round(st2.rate));
  await page.click('#tStart', { noWaitAfter: true }); // pausieren
  await page.waitForTimeout(400);
  const stopped = await page.evaluate(() => !window.__trainrobot.parallel);
  ok(stopped, 'Pause beendet Paralleltraining (Worker terminiert)');

  console.log('\n■ Regression: Aufstehen startet über dem Boden (v2.9.0-Fix bleibt)');
  await page.click('#scnRow .scn-chip[data-scn="getup"]');
  await page.waitForTimeout(400);
  const pose = await page.evaluate(() => {
    const t = window.__trainrobot;
    const sim = t.sim;
    t.task.reset({}, sim);
    const h = sim._xpos[3 * sim.baseBody + 2];
    const x = sim._xquat[4 * sim.baseBody + 1], y = sim._xquat[4 * sim.baseBody + 2];
    return { kind: t.task.kind, mode: t.task.mode, h, upz: 1 - 2 * (x * x + y * y) };
  });
  ok(pose.kind === 'recovery' && pose.mode === 'getup', 'Recovery-Aufgabe (getup) aktiv');
  ok(pose.h > 0.03, 'Liegend-Start ÜBER dem Boden: h = ' + pose.h.toFixed(3) + ' m');

  ok(pageErrors.length === 0, 'Keine Seiten-Fehler' + (pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''));
} catch (e) {
  console.error('TEST-ABBRUCH:', e.message);
  fail++;
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (fail === 0 ? `ALLE ${pass} CHECKS GRÜN` : `${fail} von ${pass + fail} CHECKS FEHLGESCHLAGEN`));
process.exit(fail === 0 ? 0 : 1);
