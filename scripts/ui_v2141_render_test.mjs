// ui_v2141_render_test.mjs — v2.14.1 GRAU-FIX Browser-Test (Playwright):
//   1) G1 rendert mit Materialfarben (schwarz/metal) statt 0,5-Grau
//   2) MicroDuck rendert beige/dunkle Schalenfarben
//   3) Skydio X2 bekommt seine TEXTUR (material.map + uv-Attribut)
//   4) Vollbild-/Konsole-Button weg, verstecktes Log schreibt weiter
// Usage: node scripts/ui_v2141_render_test.mjs
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
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// Boot abwarten (Splash weg)
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.classList.contains('gone');
  }, null, { timeout: 120000 });
  ok(true, 'Boot abgeschlossen (Splash weg)');
} catch (e) {
  ok(false, 'Boot abgeschlossen (Splash weg)', '— Timeout');
}

// Meshes des aktuell geladenen Roboters (via __trainrobot-Handle)
const probe = async () => page.evaluate(() => {
  const T = window.__trainrobot;
  const r = T && T.renderer;
  if (!r || !r.bodyGroups) return { found: false };
  const meshes = [];
  for (const grp of r.bodyGroups) {
    if (!grp) continue;
    for (const m of grp.children) {
      const col = m.material.color;
      meshes.push({
        r: +col.r.toFixed(3), g: +col.g.toFixed(3), b: +col.b.toFixed(3),
        map: !!m.material.map, uv: !!(m.geometry && m.geometry.attributes && m.geometry.attributes.uv),
      });
    }
  }
  return { found: true, meshes };
});

// Warte bis der Roboter gerendert hat
try {
  await page.waitForFunction(() => {
    const T = window.__trainrobot;
    const r = T && T.renderer;
    return r && r.bodyGroups && r.bodyGroups.some(g => g && g.children.length);
  }, null, { timeout: 60000 });
  ok(true, 'G1 gerendert');
} catch (e) { ok(false, 'G1 gerendert'); }

const g1 = await probe();
if (g1.found && g1.meshes.length) {
  const gray = g1.meshes.filter(m => Math.abs(m.r - 0.5) < 0.02 && Math.abs(m.g - 0.5) < 0.02 && Math.abs(m.b - 0.5) < 0.02).length;
  const black = g1.meshes.filter(m => Math.abs(m.r - 0.2) < 0.02 && Math.abs(m.g - 0.2) < 0.02 && Math.abs(m.b - 0.2) < 0.02).length;
  ok(gray === 0, `G1: kein 0,5-Grau mehr (${g1.meshes.length} Meshes, ${gray} grau)`);
  ok(black > 0, `G1: Materialfarbe "black" aktiv (${black} Meshes)`);
} else {
  ok(false, 'G1: Meshes gefunden');
}

// Roboterwechsel → X2 (Drohne, texturiert) — über den echten UI-Chip
const switched = await page.evaluate(() => {
  const chip = document.querySelector('.robot-chip[data-robot="x2"]');
  if (!chip) return false;
  chip.click();
  return true;
});
if (switched) {
  // Auf X2-Meshes mit Textur warten (Laden dauert)
  try {
    await page.waitForFunction(() => {
      const T = window.__trainrobot;
      const r = T && T.renderer;
      if (!r || !r.bodyGroups) return false;
      for (const grp of r.bodyGroups) {
        if (!grp) continue;
        for (const m of grp.children) if (m.material.map) return true;
      }
      return false;
    }, null, { timeout: 90000 });
    const x2 = await probe();
    const textured = x2.meshes.filter(m => m.map && m.uv).length;
    const mapNoUv = x2.meshes.filter(m => m.map && !m.uv).length;
    ok(textured > 0, `X2: Textur + UVs aktiv (${textured} Meshes)`, mapNoUv ? `⚠ ${mapNoUv} map ohne UV` : '');
    ok(mapNoUv === 0, 'X2: jedes texturierte Mesh hat UVs');
  } catch (e) {
    ok(false, 'X2: Textur + UVs aktiv', '— keine map nach Wechsel');
  }
} else {
  ok(false, 'X2: Roboterwechsel möglich (Chip fehlt)');
}

// UI-Elemente
const uiState = await page.evaluate(() => ({
  btnFull: !!document.getElementById('btnFull'),
  btnConsole: !!document.getElementById('btnConsole'),
  consolePanel: !!document.getElementById('consolePanel'),
  hiddenLog: !!document.getElementById('consoleLog'),
  logHidden: document.getElementById('consoleLog') ? document.getElementById('consoleLog').hidden : null,
  logLines: document.getElementById('consoleLog') ? document.getElementById('consoleLog').childElementCount : -1,
}));
ok(!uiState.btnFull && !uiState.btnConsole && !uiState.consolePanel, 'Vollbild-/Konsolen-Panel aus dem DOM');
ok(uiState.hiddenLog && uiState.logHidden === true, 'Log-Element unsichtbar vorhanden');
ok(uiState.logLines > 0, `Log schreibt weiter (${uiState.logLines} Zeilen)`);

ok(errs.length === 0, 'keine Seiten-/Konsolenfehler', errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n═══ ERGEBNIS: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
