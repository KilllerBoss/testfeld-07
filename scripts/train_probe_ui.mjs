// train_probe_ui.mjs — Warum zählt stepCount nicht im Browser?
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
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

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });

// A1 (klein, schnell) statt G1
await page.evaluate(() => document.querySelector('#robotBar .robot-chip[data-robot="a1"]').click());
await page.waitForFunction(() => window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'a1', undefined, { timeout: 120000 });
console.log('A1 geladen, obsDim =', await page.evaluate(() => window.__trainrobot.task.obsDim));

await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById('tStart').click());
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({ steps: window.__trainrobot.trainer ? window.__trainrobot.trainer.stepCount : -1, eps: window.__trainrobot.episodes }));
  console.log(`t+${(i + 1) * 2}s: steps=${st.steps} episodes=${st.eps}`);
}
await browser.close();
process.exit(0);
