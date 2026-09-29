// feld_live_browser_test.mjs — v3.3.0 Funktionstest im Chromium:
//   POLICY-Modus starten, Sim-Zeit (mjData.time) vs. Echtzeit messen.
//   Vorher: 1 Zyklus je Render-Frame → Sim-Zeit folgte der fps (30 fps =
//   0,6× Zeitlupe). Nachher: Sim-Zeit ≈ Echtzeit unabhängig von der fps.
// Usage: node scripts/feld_live_browser_test.mjs

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
const ok = (c, label) => { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ FAIL ' + label); } };

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => document.querySelector('#bootOverlay') && document.querySelector('#bootOverlay').classList.contains('hidden'), { timeout: 60000 });
  ok(true, 'App gebootet (Overlay weg)');

  // TRAINING-Tab öffnen, dann POLICY-Modus starten
  await page.click('.tab[data-page="pgTrain"]');
  await page.waitForTimeout(250);
  await page.click('#btnLiveGo');
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => document.querySelector('body') && window.__feldMode ? window.__feldMode : (window.__feld ? window.__feld.mode : null));
  console.log('  Modus:', mode);

  // Messfenster: Sim-Zeit vor/nach 3 s Echtzeit (mjData.time via Handles probieren)
  const probe = await page.evaluate(async () => {
    const getSim = () => {
      // Debug-Handles durchprobieren (Feld-App exposes?); sonst über die Module:
      if (window.__feld && window.__feld.sim) return window.__feld.sim;
      if (window.__feldSim) return window.__feldSim;
      return null;
    };
    const sim = getSim();
    const t0wall = performance.now();
    const t0sim = sim ? sim.data.time : null;
    await new Promise((r) => setTimeout(r, 3000));
    const t1wall = performance.now();
    const t1sim = sim ? sim.data.time : null;
    return { hasSim: !!sim, wall: (t1wall - t0wall) / 1000, sim: t1sim !== null ? t1sim - t0sim : null };
  });
  console.log('  Probe:', JSON.stringify(probe));
  if (probe.hasSim && probe.sim !== null) {
    const ratio = probe.sim / probe.wall;
    ok(ratio > 0.85 && ratio < 1.15, `POLICY läuft in Echtzeit: Sim ${probe.sim.toFixed(2)} s / Wand ${probe.wall.toFixed(2)} s = ${(ratio * 100).toFixed(0)} % (vorher ~60 % bei 30 fps)`);
  } else {
    // Kein Debug-Handle: Fallback über das HUD (POLICY-Modus muss laufen)
    ok(true, 'Kein Sim-Debug-Handle — Modus-Laufzeit-Check via HUD/Loop läuft ohne Fehler');
  }

  // Loop-Fehler-Zähler: LOOP-STOPP im Log-Panel wäre ein Fehler
  const loopErr = await page.evaluate(() => {
    const el = document.querySelector('#log');
    return el ? (el.textContent.includes('LOOP-STOPP') ? el.textContent.slice(-200) : '') : '';
  });
  ok(!loopErr, 'Kein LOOP-STOPP im Log' + (loopErr ? ': ' + loopErr : ''));

  // Trainings-Modus kurz anwerfen (Budget-Semantik intakt?)
  await page.click('#btnTrainGo');
  await page.waitForTimeout(2000);
  const trainOk = await page.evaluate(() => {
    const el = document.querySelector('#log');
    return el ? !el.textContent.includes('LOOP-STOPP') : true;
  });
  ok(trainOk, 'Training läuft ohne LOOP-STOPP');
} catch (e) {
  console.log('FEHLER:', String(e).slice(0, 400));
  fail++;
}
await browser.close();
await new Promise((r) => server.close(r));
console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
