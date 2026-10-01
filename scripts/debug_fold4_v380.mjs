// Debug 4: Force-Klick-Beweis — echte Mouse-Events am Griff, Panel öffnet/schließt
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const WWW = '/home/z/my-project/app/src/main/assets/www';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const srv = createServer((req, res) => {
  let p = join(WWW, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(8805, r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto('http://localhost:8805/index.html');
await page.waitForSelector('#bootOverlay.hidden', { timeout: 90000, state: 'attached' });

// 1) Hit-Test am Klickpunkt (Beweis: der Griff bekommt den Touch)
const hit = await page.evaluate(() => {
  const b = document.getElementById('btnConsoleFold');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el === b || b.contains(el);
});
console.log('1) Hit-Test am Griff-Punkt:', hit ? 'TRIFFT GRIFF' : 'verfehlt');

// 2) force-Klick öffnet (echte Maus-Events an der Stelle)
await page.locator('#btnConsoleFold').click({ force: true, timeout: 10000 });
const open = await page.evaluate(() => ({
  cls: document.getElementById('feldConsole').className,
  txt: document.getElementById('btnConsoleFold').textContent,
  pads: document.querySelectorAll('#feldConsoleHost *').length,
  panelVisible: (() => { const p = document.getElementById('feldConsolePanel'); const cs = getComputedStyle(p); return cs.opacity === '1' && cs.pointerEvents === 'auto'; })(),
}));
console.log('2) Nach force-Klick (offen?):', JSON.stringify(open));

// 3) force-Klick schließt wieder
await page.locator('#btnConsoleFold').click({ force: true, timeout: 10000 });
const closed = await page.evaluate(() => ({
  cls: document.getElementById('feldConsole').className,
  txt: document.getElementById('btnConsoleFold').textContent,
}));
console.log('3) Nach 2. force-Klick (zu?):', JSON.stringify(closed));

await browser.close();
srv.close();
console.log(open.cls.includes('open') && !closed.cls.includes('open') && hit ? 'BEWEIS: Griff funktioniert (Hit + echtes Maus-Event + Toggle)' : 'PROBLEM');
