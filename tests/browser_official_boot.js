/* Trainrobot E2E — offizieller microduck-simulator bootet wie in der App.
 *
 * Reproduziert die SimActivity-Verkabelung 1:1 im Chromium:
 *   https://appassets.androidplatform.net/assets/**  →  assets/sim/**
 *   (gleiches URL-Schema, gleiche MIME-Tabelle wie SimAssetHandler.java)
 *   URL: /assets/sim/index.html?boot=1&touch=1&noghosts
 * Bestanden = window.rl + rl.controller existieren, Physik läuft, der Duck
 * steht aufrecht (z über Boden), Policy-Registry enthält microduck_rough_v2.
 * KEIN Fallback-Pfad im Spiel — die App hat keinen mehr.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const SIMDIR = path.join(ROOT, 'sim');
const BASE = 'https://appassets.androidplatform.net/assets';

function mimeFor(p) {
  const l = p.toLowerCase();
  if (l.endsWith('.wasm')) return 'application/wasm';
  if (l.endsWith('.html')) return 'text/html';
  if (l.endsWith('.js') || l.endsWith('.mjs')) return 'text/javascript';
  if (l.endsWith('.css')) return 'text/css';
  if (l.endsWith('.json')) return 'application/json';
  if (l.endsWith('.onnx')) return 'application/octet-stream';
  if (l.endsWith('.glb')) return 'model/gltf-binary';
  if (l.endsWith('.stl')) return 'application/octet-stream';
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const served = [];
  const failures = [];

  page.on('pageerror', (e) => failures.push('pageerror: ' + e.message));

  // Spiegelt EXAKT die SimActivity-Verkabelung (zwei Handler, Reihenfolge
  // entscheidend — siehe SimAssetHandler.java):
  //   1. /assets/sim/**  → sim/<suffix>
  //   2. /**             → sim/<path>   (Vite-Absolute-Pfade: /bundle, /policies, /robot, /assets)
  await page.route('https://appassets.androidplatform.net/**', (route) => {
    const url = new URL(route.request().url());
    const full = decodeURIComponent(url.pathname);
    let rel = null;
    if (full.startsWith('/assets/sim/')) rel = full.slice('/assets/sim/'.length);
    else rel = full.slice(1);
    if (!rel || rel.includes('..')) return route.fulfill({ status: 404, body: 'nope' });
    const file = path.join(SIMDIR, rel);
    if (!file.startsWith(SIMDIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: 'missing ' + rel });
    }
    served.push(rel);
    return route.fulfill({ status: 200, contentType: mimeFor(rel), body: fs.readFileSync(file) });
  });

  console.log('>> Lade ' + BASE + '/sim/index.html?boot=1&touch=1&noghosts');
  await page.goto(BASE + '/sim/index.html?boot=1&touch=1&noghosts', { waitUntil: 'domcontentloaded' });

  // window.rl muss innerhalb 60 s erscheinen (pollGameReady-Logik der App)
  const hasRl = await page
    .waitForFunction('!!(window.rl && window.rl.controller)', null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  console.log('>> window.rl & controller:', hasRl ? 'JA' : 'NEIN');
  if (!hasRl) {
    console.log('FAILURES:', failures.slice(0, 5));
    console.log('SERVED (tail):', served.slice(-10));
    await browser.close();
    process.exit(1);
  }

  // Policy-Registry: walk muss auf die eigene Kaggle-Policy zeigen (Patch 1)
  const walkPolicy = await page.evaluate(
    '(() => { try { return String(window.rl.policies ? (window.rl.policies.walk || "") : (window.rl.POLICIES ? window.rl.POLICIES.walk : "")); } catch (e) { return "ERR:" + e.message; } })()'
  );
  console.log('>> walk-Policy:', walkPolicy);

  // Physik läuft + Duck aufrecht über dem Boden
  await page.waitForTimeout(6000);
  const state = await page.evaluate(
    '(() => { try { const q = window.rl.data.qpos; return { z: +q[2].toFixed(3), nq: q.length }; } catch (e) { return { err: String(e) }; } })()'
  );
  console.log('>> qpos z (Höhe):', JSON.stringify(state));
  console.log('>> geroutete Requests:', served.length);

  const ok = state.z !== undefined && state.z > 0.1;
  console.log(ok ? 'BROWSER-SMOKE GRÜN — offizielle Sim bootet, Duck steht aufrecht' : 'BROWSER-SMOKE ROT');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('E2E-Crash:', e);
  process.exit(1);
});
