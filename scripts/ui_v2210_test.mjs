// ui_v2210_test.mjs — v2.21.0 MOTION-KI UI (Playwright, EIN Boot):
//   1) Panel-Zeile vorhanden: Chip AUS + Mix-Slider 70 % + ⏸ GEIST + ⏭ CLIP
//   2) Chip-Klick → AN, motionKiState().on true, Label AN
//   3) execTool motionKi {mix:0.4} → Slider + Anzeige synchron, Persistenz gesetzt
//   4) execTool motionKi {on:false} → AUS, Label zurück
//   5) motionKi paused ohne GLB-Referenz → klare Fehlermeldung (kein Crash)
//   6) Keine Seitenfehler
// Usage: node scripts/ui_v2210_test.mjs
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xml': 'model/xml', '.stl': 'model/stl', '.obj': 'text/plain', '.png': 'image/png', '.md': 'text/markdown', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const p = path.join(WWW, url === '/' ? 'index.html' : url);
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
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const context = await browser.newContext({ viewport: { width: 420, height: 860 }, hasTouch: true });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.classList.contains('gone');
  }, null, { timeout: 120000 });
  ok(true, 'Boot abgeschlossen');
} catch (e) {
  ok(false, 'Boot abgeschlossen', '— Timeout');
}
await page.waitForFunction(() => !!(window.__trainrobot && window.__trainrobot.motionKiState), null, { timeout: 60000 }).catch(() => {});

// ── 1) Panel vorhanden ──────────────────────────────────────
console.log('\n[1] PANEL');
const panel = await page.evaluate(() => ({
  chip: !!document.getElementById('mkiChip'),
  chipLabel: document.getElementById('mkiChip') ? document.getElementById('mkiChip').textContent : null,
  mix: !!document.getElementById('mkiMix'),
  mixVal: document.getElementById('mkiMixVal') ? document.getElementById('mkiMixVal').textContent : null,
  pause: !!document.getElementById('mkiPause'),
  next: !!document.getElementById('mkiNext'),
}));
ok(panel.chip && panel.mix && panel.pause && panel.next, 'MOTION-KI-Zeile: Chip + Mix + ⏸ + ⏭ vollständig');
ok(panel.chipLabel === 'AUS', 'Chip startet AUS', String(panel.chipLabel));
ok(panel.mixVal === '70 %', 'Mix-Anzeige = 70 % (Standard)', String(panel.mixVal));

// ── 2) Chip AN ──────────────────────────────────────────────
console.log('\n[2] CHIP AN');
await page.evaluate(() => window.__trainrobot.setMotionKi(true));
await page.waitForTimeout(80);
const st1 = await page.evaluate(() => window.__trainrobot.motionKiState());
const label1 = await page.evaluate(() => document.getElementById('mkiChip').textContent);
ok(st1.on === true && label1 === 'AN', 'Chip AN + State.on true', JSON.stringify(st1));

// ── 3) Mix via execTool ─────────────────────────────────────
console.log('\n[3] MIX via motionKi-Werkzeug');
const mixRes = await page.evaluate(() => window.__trainrobot.execTool('motionKi', { mix: 0.4 }));
await page.waitForTimeout(80);
const st2 = await page.evaluate(() => ({
  state: window.__trainrobot.motionKiState(),
  mixVal: document.getElementById('mkiMixVal').textContent,
  persisted: localStorage.getItem('tr_motionki_v1'),
}));
ok(/40 % Stick/.test(String(mixRes)), 'Tool meldet den Mix', String(mixRes).slice(0, 70));
ok(st2.state.mix === 0.4 && st2.mixVal === '40 %', 'Slider + Anzeige synchron (40 %)', st2.mixVal);
ok(st2.persisted && /0\.4/.test(st2.persisted), 'Mix persistiert (tr_motionki_v1)', String(st2.persisted));

// ── 4) AUS ──────────────────────────────────────────────────
console.log('\n[4] CHIP AUS');
await page.evaluate(() => window.__trainrobot.execTool('motionKi', { on: false }));
await page.waitForTimeout(80);
const st3 = await page.evaluate(() => ({ s: window.__trainrobot.motionKiState(), label: document.getElementById('mkiChip').textContent }));
ok(st3.s.on === false && st3.label === 'AUS', 'Tool schaltet AUS + Label zurück');

// ── 5) paused ohne GLB → klare Meldung ──────────────────────
console.log('\n[5] PAUSED OHNE GLB');
const pausedRes = await page.evaluate(() => window.__trainrobot.execTool('motionKi', { paused: true }));
ok(/keine aktive GLB-Referenz/.test(String(pausedRes)), 'klare Fehlermeldung ohne Clip', String(pausedRes).slice(0, 60));

// ── 6) Seitenfehler ─────────────────────────────────────────
console.log('\n[6] Seitenfehler');
ok(errs.length === 0, 'keine Seiten-/Konsolen-Fehler', errs.slice(0, 3).join(' | '));

console.log('\n════════════════════════════════');
console.log(`ERGEBNIS: ${pass} grün, ${fail} rot`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
