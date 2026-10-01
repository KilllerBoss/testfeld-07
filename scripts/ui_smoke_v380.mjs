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
  // STAND-Keyframe des Pollen-MicroDuck: Basis-Höhe 0,12 m (microduck.xml, key „STAND",
  // qpos z = 0.12) — winzige Ente, KEINE G1-Höhe. Liegend wäre sie bei ~0,04.
  if (!(h > 0.08 && h < 0.2)) throw new Error('Basishöhe außerhalb STAND-Keyframe (0,12): ' + h);
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
  // Hit-Test: nichts verdeckt den Griff (Redesign-Risiko Nr. 1)
  const hit = await page.evaluate(() => {
    const b = document.getElementById('btnConsoleFold');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === b || b.contains(el);
  });
  if (!hit) throw new Error('Griff wird von etwas anderem verdeckt');
  // Klick per DOM-Event (derselbe 'click', den der addEventListener der App
  // empfängt). Grund: Playwrights CDP-Input-Transport (scrollIntoViewIfNeeded →
  // Maus-Events) verhungert unter der Software-Render-Last des Browsers
  // (SwiftShader + MuJoCo-Loop, ~1,3 s/Frame) — rein Test-Umgebungs-Artefakt,
  // auf dem Handy mit GPU irrelevant. Treffbarkeit ist durch den Hit-Test
  // oben bewiesen, Verdrahtung + Toggle + Pads werden unten bewiesen.
  await page.evaluate(() => document.getElementById('btnConsoleFold').click());
  await page.waitForFunction(() => document.getElementById('feldConsole').classList.contains('open'), null, { timeout: 8000 });
  const pads = await page.evaluate(() => document.querySelectorAll('#feldConsoleHost *').length);
  if (!pads) throw new Error('Konsole leer — Pads fehlen');
  // Sichtbarkeit/Bedienbarkeit des Panels: EIN in-page-Poll über rAFs (die
  // Opacity-Transition braucht hier je Frame ~1,3 s — CDP-Polls von außen
  // verpassen sonst das Fortschreiten). Beweist Transition + pointer-events.
  const openLook = await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const cs = getComputedStyle(document.getElementById('feldConsolePanel'));
      if (parseFloat(cs.opacity) > 0.9 && cs.pointerEvents === 'auto') return { ok: true, op: +cs.opacity, pe: cs.pointerEvents };
    }
    const cs = getComputedStyle(document.getElementById('feldConsolePanel'));
    return { ok: false, op: +cs.opacity, pe: cs.pointerEvents };
  });
  if (!openLook.ok) throw new Error('Panel nicht sichtbar/bedienbar: ' + JSON.stringify(openLook));
  await page.evaluate(() => document.getElementById('btnConsoleFold').click()); // wieder zu
  await page.waitForFunction(() => !document.getElementById('feldConsole').classList.contains('open'), null, { timeout: 8000 });
});

await t('Keine Seiten-Fehler beim Boot/Teleport/Tab-Wechsel', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

await browser.close();
srv.close();
console.log(`UI-SMOKE v3.8.0: ${pass} PASS · ${fail} FAIL`);
if (fail) process.exit(1);
console.log('FERTIG');
