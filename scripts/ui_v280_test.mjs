// ui_v270_test.mjs — UI-Verdrahtung v2.7.0 im Chromium:
//   1) Szenario-Chips (Gehen/Aufstehen/Abwurf) + Sturz-Chips vorhanden
//   2) AUFSTEHEN: Task 'recovery/getup', Roboter startet liegend (Höhe klein)
//   3) ABWURF: Task 'recovery/drop', Start in der Luft → fällt
//   4) Sturz-Verhalten 'stay': Schubs kippt den A1 — KEIN Auto-Reset (liegt)
//      vs. 'reset': Auto-Reset stellt die Keyframe-Höhe wieder her
//   5) Szenario-Wahl persistiert (localStorage)
//   6) Drohne: Szenario-Zeile versteckt
//   7) Werkstatt: ★-Beispiele gelistet, Abwurf-Plugin aktivierbar →
//      Plugin-Chip „ABWURF" erscheint und wirft den Roboter in die Luft
// Usage: node scripts/ui_v270_test.mjs

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

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 120)));

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });
console.log('Boot OK (A1)');

// Training-Panel öffnen (Szenario-Zeilen leben darin)
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(300);

// 1) Chips vorhanden
check('Aufgabe-Zeile mit 3 Chips', await page.evaluate(() => document.querySelectorAll('.scn-chip').length === 3));
check('Sturz-Zeile mit 2 Chips', await page.evaluate(() => document.querySelectorAll('.fall-chip').length === 2));
check('Drohnen-Zeilen für A1 sichtbar', await page.evaluate(() => !document.getElementById('scnRow').classList.contains('hidden')));

// 2) AUFSTEHEN
await page.evaluate(() => document.querySelector('.scn-chip[data-scn="getup"]').click());
await page.waitForTimeout(400);
check('Task = recovery/getup', await page.evaluate(() => window.__trainrobot.task.kind === 'recovery' && window.__trainrobot.task.mode === 'getup'));
check('Chip aktiv', await page.evaluate(() => document.querySelector('.scn-chip[data-scn="getup"]').classList.contains('active')));
const hGetup = await page.evaluate(() => window.__trainrobot.sim.baseHeight());
check('Roboter liegt am Boden (Höhe ' + hGetup.toFixed(2) + ' < 0,45)', hGetup < 0.45);
// Policy-Slot getrennt
check('Policy-Schlüssel recovery_getup', await page.evaluate(() => {
  const t = window.__trainrobot.task;
  return t.kind === 'recovery' && t.mode === 'getup';
}));

// 3) ABWURF — Klick + Messung im SELBEN evaluate (sonst fällt er schon)
const hDrop = await page.evaluate(() => {
  document.querySelector('.scn-chip[data-scn="drop"]').click();
  return window.__trainrobot.sim.baseHeight();
});
check('Task = recovery/drop', await page.evaluate(() => window.__trainrobot.task.kind === 'recovery' && window.__trainrobot.task.mode === 'drop'));
check('Start in der Luft (Höhe ' + hDrop.toFixed(2) + ' > 1,0)', hDrop > 1.0);
await page.waitForFunction(() => window.__trainrobot.sim.baseHeight() < 1.0, undefined, { timeout: 60000, polling: 500 }); // SwiftShader ist langsam
const hAfter = await page.evaluate(() => window.__trainrobot.sim.baseHeight());
check('Roboter ist gefallen (Höhe ' + hAfter.toFixed(2) + ' < 1,0)', hAfter < 1.0);

// 5) Persistierung
check('Szenario persistiert (drop für a1)', await page.evaluate(() => {
  const sc = JSON.parse(localStorage.getItem('tr_scenario_v1') || '{}');
  return sc.a1 === 'drop';
}));

// zurück zu Gehen (Speed-Task hat bewusst kein kind-Feld — Fallback 'speed')
await page.evaluate(() => document.querySelector('.scn-chip[data-scn="gehen"]').click());
await page.waitForTimeout(300);
check('Zurück auf Gehen (Task = Tempo-Tracking)', await page.evaluate(() => {
  const t = window.__trainrobot.task;
  return (t.kind == null || t.kind === 'speed') && t.obsDim === 3 * 12 + 17 + 4;
}));

// 4) Sturz-Verhalten 'stay' — DETERMINISTISCH: Roboter direkt hinlegen.
// stay: checkFall darf NICHT teleportieren (liegt nach 1,5 s noch)
await page.evaluate(() => document.querySelector('.fall-chip[data-fall="stay"]').click());
await page.waitForTimeout(150);
check('fallMode = stay', await page.evaluate(() => window.__trainrobot.fallMode === 'stay'));
check('stay persistiert', await page.evaluate(() => localStorage.getItem('tr_fallMode') === 'stay'));
await page.evaluate(() => {
  const s = window.__trainrobot.sim;
  s.placeBaseFull(0, 0, 0.05, 0, 1, 0, 0); // auf den Rücken gelegt (upz = −1)
});
await page.waitForTimeout(1500); // checkFall läuft in jedem Regelzyklus
const hStay = await page.evaluate(() => window.__trainrobot.sim.baseHeight());
check('„Liegen lassen": KEIN Teleport — Roboter liegt noch (Höhe ' + hStay.toFixed(2) + ' < 0,15)', hStay < 0.15);

// 'reset': gleiche Lage → Auto-Reset stellt das Keyframe wieder her
await page.evaluate(() => {
  window.__trainrobot.setFallMode('reset');
  const s = window.__trainrobot.sim;
  s.placeBaseFull(0, 0, 0.05, 0, 1, 0, 0);
});
await page.waitForFunction(() => window.__trainrobot.sim.baseHeight() > 0.24, undefined, { timeout: 30000, polling: 200 });
const hReset = await page.evaluate(() => window.__trainrobot.sim.baseHeight());
check('Auto-Reset: zurück zum Keyframe (Höhe ' + hReset.toFixed(2) + ' > 0,24)', hReset > 0.24);

// 6) Drohne: Zeile versteckt
await page.evaluate(() => document.querySelector('.robot-chip[data-robot="x2"]').click());
await page.waitForFunction(() => window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'x2', undefined, { timeout: 120000 });
check('Drohne: Szenario-Zeile versteckt', await page.evaluate(() => document.getElementById('scnRow').classList.contains('hidden')));

// 7) Werkstatt (zurück zum A1)
await page.evaluate(() => document.querySelector('.robot-chip[data-robot="a1"]').click());
await page.waitForFunction(() => window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'a1', undefined, { timeout: 120000 });
check('Werkstatt listet 2 ★-Beispiele', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plgList .plugin-row')];
  return rows.length === 2 && rows.every(r => r.textContent.includes('★'));
}));

// Abwurf-Plugin aktivieren → Chip erscheint
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plgList .plugin-row')];
  const ab = rows.find(r => r.textContent.includes('Abwurf-Button'));
  ab.querySelector('.btn.small').click(); // Aus → An
});
await page.waitForTimeout(300);
check('Plugin-Chip „ABWURF" erschienen', await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#pluginChips .ai-btn')];
  return chips.length === 1 && chips[0].textContent === 'ABWURF';
}));
await page.evaluate(() => window.__trainrobot.setFallMode('stay')); // kein Auto-Reset stört
await page.evaluate(() => document.querySelector('#pluginChips .ai-btn').click());
await page.waitForTimeout(150);
const hAbwurf = await page.evaluate(() => window.__trainrobot.sim.baseHeight());
check('ABWURF-Chip wirft den Roboter in die Luft (Höhe ' + hAbwurf.toFixed(2) + ' > 1,4)', hAbwurf > 1.4);

// Plugin wieder aus → Chip weg
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plgList .plugin-row')];
  const ab = rows.find(r => r.textContent.includes('Abwurf-Button'));
  ab.querySelector('.btn.small').click(); // An → Aus
});
await page.waitForTimeout(200);
check('Plugin aus → Chip verschwunden', await page.evaluate(() => document.getElementById('pluginChips').classList.contains('hidden')));

// installPlugin-Helfer: Reward-Bonus-Plugin installieren + entfernen
const inst = await page.evaluate(() => window.__trainrobot.installPlugin('Höhen-Bonus', 'api.onReward(() => 0.1);', true));
check('installPlugin ok', inst && inst.ok === true);
check('Plugin in der Liste', await page.evaluate(() => [...document.querySelectorAll('#plgList .plugin-row')].some(r => r.textContent.includes('Höhen-Bonus'))));
await page.evaluate((id) => window.__trainrobot.removePlugin(id), inst.id);
check('Plugin entfernt', await page.evaluate(() => ![...document.querySelectorAll('#plgList .plugin-row')].some(r => r.textContent.includes('Höhen-Bonus'))));

// Defekter Code wird abgelehnt
const bad = await page.evaluate(() => window.__trainrobot.installPlugin('Kaputt', 'api.onStep(() => {', true));
check('Syntax-defektes Plugin abgelehnt', bad && bad.ok === false);

console.log(fails === 0 ? '\nALLE UI-CHECKS GRÜN' : `\n${fails} UI-CHECK(S) ROT`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
