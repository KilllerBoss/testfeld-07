// UI-Smoke: bootet die App in Chromium und prüft die NEUEN Karten v3.7.0
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
await new Promise((r) => srv.listen(8799, r));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8799/index.html');
await page.waitForSelector('#bootOverlay.hidden', { timeout: 60000, state: 'attached' });

const t = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + ' — ' + (e.message || e).split('\n')[0]); process.exitCode = 1; }
};
await t('KI-SETUP-Karte sichtbar (Wunsch/Modell/Schlüssel/Button)', async () => {
  for (const id of ['gemWish', 'gemModel', 'gemKey', 'btnGemGo', 'gemState']) {
    const el = page.locator('#' + id);
    if (!await el.count()) throw new Error(id + ' fehlt');
  }
});
await t('Schlüssel-Feld: leer ODER AQ.-Key vorgefüllt (Build-Injection)', async () => {
  const v = await page.inputValue('#gemKey');
  if (v && !v.startsWith('AQ.')) throw new Error('Ungültiges Format: ' + v.slice(0, 8));
});
await t('IMPORT-Karte sichtbar (beide Buttons + Status)', async () => {
  for (const id of ['btnImportOnnx', 'btnTestOnnx', 'impState']) {
    if (!await page.locator('#' + id).count()) throw new Error(id + ' fehlt');
  }
});
await t('Modell-Tab hat beide Karten (Tab-Wechsel OK)', async () => {
  await page.click('.tab[data-page="pgModel"]');
  await page.waitForFunction(() => document.getElementById('impState') !== null);
});
await t('ERNEUT TESTEN ohne Import → höfliche Meldung', async () => {
  await page.click('#btnTestOnnx');
  await page.waitForFunction(() => document.getElementById('impState').textContent.includes('Erst ein Modell importieren'), { timeout: 5000 });
});
await t('Keine Seiten-Fehler beim Boot', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});
await browser.close();
srv.close();
console.log('UI-SMOKE FERTIG');
