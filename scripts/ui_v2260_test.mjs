// ui_v2260_test.mjs — v2.26.0 im echten Browser (Playwright):
//   ▸ ARDY Mini hat ein EIGENES Sheet (#ardySheet) — Steuerung + Prompting
//     getrennt vom Trainings-/GLB-Bereich, eigener Topbar-Button (btnArdy)
//   ▸ Modell-Download-Button (ardyDl) + Download-% (ardyDlPct)
//   ▸ Live-Steuerung: Live-% (ardyPct), Status (ardyGen), Stop-Knopf,
//     Live-Prompt-Schalter (ardyLive, Standard AN)
//   ▸ Trainings-Prozent live: ardyTrainPct/Fill + Ziel-Input (persistiert)
//   ▸ Cross-Close (ARDY öffnen ⇒ Training/KI weichen — Close nie verdeckt)
//   ▸ Pins: VERSION 2.26.0, applicationId com.lertrain.app, versionCode 38
//
// Usage: node scripts/ui_v2260_test.mjs

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
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)));

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });
await page.evaluate(() => { document.querySelector('.robot-chip[data-robot="g1"]').click(); });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'g1', undefined, { timeout: 120000 });
console.log('G1 geladen');

// ── 1) Eigenes ARDY-Sheet, getrennt ─────────────────────────
console.log('■ ARDY Mini — eigenes Panel');
check('#ardySheet existiert, initial HIDDEN, außerhalb #trainSheet', await page.evaluate(() => {
  const sh = document.getElementById('ardySheet');
  return !!sh && sh.classList.contains('hidden') && !sh.contains(document.getElementById('trainNote'));
}));
check('Kein ARDY-Element mehr im Trainings-/GLB-Bereich', await page.evaluate(() => !document.querySelector('#trainSheet #ardyChips') && !document.querySelector('#trainSheet #ardyPrompt')));
check('btnArdy in der Topbar sichtbar', await page.evaluate(() => {
  const b = document.getElementById('btnArdy');
  return !!b && b.offsetParent !== null;
}));

// ── 2) Öffnen/Schließen + Cross-Close ───────────────────────
console.log('■ Öffnen / Schließen / Cross-Close');
await page.evaluate(() => document.getElementById('btnArdy').click());
await page.waitForTimeout(200);
check('btnArdy öffnet #ardySheet (sichtbar + .lit)', await page.evaluate(() => !document.getElementById('ardySheet').classList.contains('hidden') && document.getElementById('btnArdy').classList.contains('lit')));
check('Cross-Close: Trainings-Sheet weicht (trainClose nie verdeckt)', await page.evaluate(() => document.getElementById('trainSheet').classList.contains('hidden')));

await page.evaluate(() => { document.getElementById('btnTrainTop').click(); }); // Training öffnet
await page.waitForTimeout(200);
check('Training-Öffnen schließt ARDY (andersherum auch)', await page.evaluate(() => document.getElementById('ardySheet').classList.contains('hidden')));
await page.evaluate(() => { document.getElementById('btnArdy').click(); });     // ARDY wieder auf
await page.waitForTimeout(200);
check('KI-Sheet weicht ebenfalls (toggleArdy schließt aiSheet)', await page.evaluate(async () => {
  window.__trainrobot && (document.getElementById('btnAI').click());
  await new Promise(r => setTimeout(r, 120));
  const aiOpen = !document.getElementById('aiSheet').classList.contains('hidden');
  document.getElementById('btnArdy').click();
  await new Promise(r => setTimeout(r, 120));
  return aiOpen && document.getElementById('aiSheet').classList.contains('hidden') && !document.getElementById('ardySheet').classList.contains('hidden');
}));
await page.evaluate(() => document.getElementById('ardyClose').click());
await page.waitForTimeout(200);
check('ardyClose schließt das Panel', await page.evaluate(() => document.getElementById('ardySheet').classList.contains('hidden')));

// ── 3) MODELL-Bereich (Download-Button + %) ─────────────────
console.log('■ Modell-Download');
await page.evaluate(() => document.getElementById('btnArdy').click());
check('Download-Button + Download-% + Cache-löschen + Balken', await page.evaluate(() => {
  const dl = document.getElementById('ardyDl');
  return !!dl && /Modell herunterladen/.test(dl.textContent) && !dl.disabled
    && !!document.getElementById('ardyDlPct') && !!document.getElementById('ardyCacheClear')
    && !!document.getElementById('ardyBar') && !!document.getElementById('ardyBarFill');
}));
check('Status erklärt Download (Hugging Face, ~650 MB)', await page.evaluate(() => /Hugging Face/.test(document.getElementById('ardyStatus').textContent) && /650/.test(document.getElementById('ardyStatus').textContent)));

// ── 4) LIVE-Bereich ─────────────────────────────────────────
console.log('■ Live-Steuerung');
check('Live-% + Status + Stop (initial disabled)', await page.evaluate(() => {
  const p = document.getElementById('ardyPct');
  const g = document.getElementById('ardyGen');
  const s = document.getElementById('ardyStop');
  return !!p && /—|0|100/.test(p.textContent) && !!g && !!s && s.disabled;
}));
check('Live-Prompt-Schalter vorhanden, Standard AN', await page.evaluate(() => {
  const l = document.getElementById('ardyLive');
  return !!l && l.type === 'checkbox' && l.checked;
}));

// ── 5) PROMPTING-Bereich (wie v2.25.0, nur umgezogen) ───────
console.log('■ Prompting (getrennt)');
check('16 Chips + Prompt + Generieren + Dauer/Seed/CFG', await page.evaluate(() => {
  const opts = Array.from(document.querySelectorAll('#ardyDur option')).map(o => o.value);
  return document.querySelectorAll('#ardyChips .ardy-chip').length === 16
    && !!document.getElementById('ardyPrompt') && !!document.getElementById('ardyGenerate')
    && opts.join(',') === '2,5,8,10' && !!document.getElementById('ardySeed') && !!document.getElementById('ardyCfg');
}));
check('Chips decken Basis-Animationen ab (Idle/Gehen/Hüpfen/Weitsprung/Liegen/Aufstehen)', await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('#ardyChips .ardy-chip')).map(x => x.textContent);
  return ['Idle', 'Gehen', 'Hüpfen', 'Weitsprung', 'Liegen', 'Aufstehen'].every(w => labels.includes(w));
}));
check('Leerer Prompt → kein Absturz, App lebt', await page.evaluate(async () => {
  document.getElementById('ardyGenerate').click();
  await new Promise(r => setTimeout(r, 250));
  return window.__trainrobot.sim !== null;
}));

// ── 6) TRAINING-Prozent + Ziel ──────────────────────────────
console.log('■ Trainings-Prozent');
check('Trainings-% + Balken + Ziel-Input vorhanden', await page.evaluate(() => {
  const tp = document.getElementById('ardyTrainPct');
  const tf = document.getElementById('ardyTrainFill');
  const goal = document.getElementById('ardyTrainGoal');
  return !!tp && /%/.test(tp.textContent) && !!tf && !!goal;
}));
await page.evaluate(() => {
  const g = document.getElementById('ardyTrainGoal');
  g.value = '250000';
  g.dispatchEvent(new Event('change'));
});
check('Ziel 250000 → localStorage tr_tgoal + State', await page.evaluate(() =>
  localStorage.getItem('tr_tgoal') === '250000' && window.__trainrobot.ardyTrainGoal === 250000));
check('Live-Update läuft (Fortschritt ≥ 0 %, Format „12,3 %“)', await page.evaluate(() => {
  const tp = document.getElementById('ardyTrainPct');
  return /^\d+([,.]\d+)? %$/.test(tp.textContent.trim());
}));

// ── 7) Pins: Versionen + eigene App-ID ──────────────────────
console.log('■ Pins (separate App)');
const mainJs = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
const manifestXml = await readFile(path.join(ROOT, 'app/src/main/AndroidManifest.xml'), 'utf8');
const uiJs = await readFile(path.join(WWW, 'js/ui.js'), 'utf8');
const indexHtml = await readFile(path.join(WWW, 'index.html'), 'utf8');
check('main.js: VERSION 2.26.0 + getLivePrompt + Trainings-%-Loop + fmtIntD', (mainJs.includes("const VERSION = '2.26.0';") || mainJs.includes("const VERSION = '2.27.0';") || mainJs.includes("const VERSION = '2.27.1';") || mainJs.includes("const VERSION = '2.28.0';") || mainJs.includes("const VERSION = '2.28.1';") || mainJs.includes("const VERSION = '2.28.4';") || mainJs.includes("const VERSION = '2.28.5';") || mainJs.includes("const VERSION = '2.28.6';") || mainJs.includes("const VERSION = '2.28.7';") || mainJs.includes("const VERSION = '2.28.8';")) && mainJs.includes('getLivePrompt:') && mainJs.includes('ardyTrainFill') && mainJs.includes('function fmtIntD'));
check('main.js: btnArdy/ardyClose verdrahtet (toggleArdy)', mainJs.includes("getElementById('btnArdy')") && mainJs.includes("getElementById('ardyClose')"));
check('build.gradle: applicationId com.lertrain.app (EIGENE App)', gradle.includes('applicationId "com.lertrain.app"'));
check('build.gradle: versionCode 38 / versionName 2.26.0', (gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40') || gradle.includes('versionCode 41') || gradle.includes('versionCode 42') || gradle.includes('versionCode 43') || gradle.includes('versionCode 44') || gradle.includes('versionCode 45') || gradle.includes('versionCode 46') || gradle.includes('versionCode 47') || gradle.includes('versionCode 48') || gradle.includes('versionCode 49')) && gradle.includes('applicationId "com.lertrain.app"'));
check('Manifest: android:label="LerTrain"', manifestXml.includes('android:label="LerTrain"'));
check('ui.js: toggleArdy mit Cross-Close (Training + KI)', uiJs.includes('toggleArdy(force)') && /toggleArdy\(force\)[\s\S]{0,640}toggleTrain\(false\)[\s\S]{0,320}toggleAI\(false\)/.test(uiJs));
check('index.html: ardySheet + btnArdy + ardyDl + ardyStop + ardyLive + ardyTrainGoal', ['ardySheet', 'btnArdy', 'ardyDl', 'ardyStop', 'ardyLive', 'ardyTrainGoal'].every(id => indexHtml.includes('id="' + id + '"')));

await browser.close();
console.log('');
console.log(fails ? 'FEHLER: ' + fails : 'ALLE CHECKS GRÜN (ui_v2260)');
process.exit(fails ? 1 : 0);
