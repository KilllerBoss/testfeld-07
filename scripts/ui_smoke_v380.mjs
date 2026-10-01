// UI-Smoke v3.8.0: bootet die App in Chromium und prüft TELEPORT + Redesign
// Nutzer: „beim ausführen auf Startseite ein kleinen Button … zurück auf
// die Beine teleportieren" + „ganze app minimalistischer … ui/ux"
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
await new Promise((r) => srv.listen(8801, r));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8801/index.html');
await page.waitForSelector('#bootOverlay.hidden', { timeout: 60000, state: 'attached' });

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + (e.message || e).split('\n')[0]); process.exitCode = 1; }
};

await t('Teleport-Button sichtbar auf der Startseite (FELD)', async () => {
  const v = await page.locator('#btnTeleport').isVisible();
  if (!v) throw new Error('btnTeleport nicht sichtbar');
  const txt = await page.textContent('#btnTeleport');
  if (!txt.includes('AUFSTELLEN')) throw new Error('Beschriftung fehlt: ' + txt);
});

await t('Redesign: schwebende Tabbar + aktiver Tab gefüllt', async () => {
  const r = await page.locator('.tabs').evaluate((el) => getComputedStyle(el).borderRadius);
  if (parseFloat(r) < 20) throw new Error('Tabbar-Radius zu klein: ' + r);
  const bg = await page.locator('.tab.on').evaluate((el) => getComputedStyle(el).backgroundColor);
  if (bg === 'rgba(0, 0, 0, 0)') throw new Error('aktiver Tab hat keinen gefüllten Hintergrund');
});

await t('Redesign: Toggle-Schalter sind Pill-Switches (appearance: none)', async () => {
  const ap = await page.locator('#tricksOn').evaluate((el) => getComputedStyle(el).appearance);
  if (ap === 'checkbox') throw new Error('Checkbox nativ gerendert: ' + ap);
});

await t('TELEPORT: Klick setzt die Ente aufrecht an den Startpunkt (Vel 0)', async () => {
  await page.click('#btnTeleport');
  await page.waitForFunction(() => {
    const F = window.__feld; if (!F || !F.sim) return false;
    const bq = new Float64Array(4); F.sim.baseQuat(bq);
    const upz = 1 - 2 * (bq[1] * bq[1] + bq[2] * bq[2]);
    const p = new Float64Array(3); F.sim.basePos(p);
    const q = F.sim._qvel;
    return upz > 0.99 && Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 &&
      Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) < 1e-9 &&
      Math.abs(q[3]) + Math.abs(q[4]) + Math.abs(q[5]) < 1e-9;
  }, null, { timeout: 8000 });
  const h = await page.evaluate(() => { const p = new Float64Array(3); window.__feld.sim.basePos(p); return p[2]; });
  if (!(h > 0.3)) throw new Error('Basishöhe unrealistisch: ' + h);
});

await t('TELEPORT: idempotent (2. Klick bleibt sauber aufrecht)', async () => {
  await page.click('#btnTeleport');
  await page.waitForTimeout(300);
  const upz = await page.evaluate(() => {
    const bq = new Float64Array(4); window.__feld.sim.baseQuat(bq);
    return 1 - 2 * (bq[1] * bq[1] + bq[2] * bq[2]);
  });
  if (upz < 0.99) throw new Error('upz nach 2. Teleport: ' + upz);
});

await t('Alle 5 Tabs schalten fehlerfrei (Redesign bricht nichts)', async () => {
  for (const id of ['pgTrain', 'pgReward', 'pgConsole', 'pgModel', 'pgFeld']) {
    await page.click(`.tab[data-page="${id}"]`);
    await page.waitForFunction((i) => document.getElementById(i).classList.contains('on'), id);
  }
});

await t('FELD-Overlay (STEUERUNG-Griff) öffnet nach Redesign', async () => {
  await page.click('#btnConsoleFold');
  await page.waitForFunction(() => document.getElementById('feldConsole').classList.contains('open'));
  await page.click('#btnConsoleFold'); // wieder zu
});

await t('Keine Seiten-Fehler beim Boot/Teleport/Tab-Wechsel', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

await browser.close();
srv.close();
console.log(`UI-SMOKE v3.8.0: ${pass} PASS · ${fail} FAIL`);
if (fail) process.exit(1);
console.log('FERTIG');
