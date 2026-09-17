// v2240_shot.mjs — Visueller Beweis v2.24.0: Gamepad offen, ×-Knopf sichtbar,
// rechter Tastenstapel FREI; Landscape: sticky Sheet-Head trotz Scroll.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
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

// ── Portrait: Gamepad offen + Tasten frei ──
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 90000 });
await page.evaluate(() => document.getElementById('btnPad').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await page.waitForTimeout(400);
await page.screenshot({ path: '/home/z/my-project/scripts/shot_v2240_gamepad.png' });
await page.close();

// ── Landscape: sticky Head trotz Scroll (GLB-Clip-Zeile sichtbar) ──
const page2 = await browser.newPage({ viewport: { width: 812, height: 375 } });
await page2.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page2.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 90000 });
await page2.evaluate(() => document.getElementById('btnTrainTop').click());
await page2.waitForTimeout(300);
await page2.evaluate(() => { document.getElementById('trainSheet').scrollTop = document.getElementById('trainSheet').scrollHeight; });
await page2.waitForTimeout(200);
await page2.screenshot({ path: '/home/z/my-project/scripts/shot_v2240_landscape_sticky.png' });
await page2.close();

await browser.close();
console.log('Shots: scripts/shot_v2240_gamepad.png, scripts/shot_v2240_landscape_sticky.png');
