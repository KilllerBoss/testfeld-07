/* Trainrobot E2E — ROBOLAB-Zweig (ARMBOT + HUMANOID) bootet wie in der App.
 *
 * Reproduziert die SimActivity-Verkabelung 1:1 im Chromium:
 *   https://appassets.androidplatform.net/assets/robo/**  →  assets/robo/**
 *   (gleiches URL-Schema, gleiche MIME-Tabelle wie SimAssetHandler.java)
 *   URLs: /assets/robo/index.html?robot=arm   und   ?robot=humanoid
 * Bestanden je Roboter = MJ-Modell geladen (S.mjc.arm / S.mjc.hum), Physik
 * läuft (Pacer), Armbot-Ball über dem Tisch, OP3 steht aufrecht (z>0.2),
 * Badge auf MUJOCO, KEIN FALLBACK-Text irgendwo.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const ROBODIR = path.join(ROOT, 'robo');
const BASE = 'https://appassets.androidplatform.net/assets';

function mimeFor(p) {
  const l = p.toLowerCase();
  if (l.endsWith('.wasm')) return 'application/wasm';
  if (l.endsWith('.html')) return 'text/html';
  if (l.endsWith('.js') || l.endsWith('.mjs')) return 'text/javascript';
  if (l.endsWith('.css')) return 'text/css';
  if (l.endsWith('.json')) return 'application/json';
  if (l.endsWith('.stl')) return 'application/octet-stream';
  if (l.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

(async () => {
  let failures = 0;

  for (const robot of ['arm', 'humanoid']) {
  // Frischer Browser pro Roboter: SwiftShader-Renderer können nach langen
  // Trainingsläufen sterben — ein Crash darf den anderen Roboter nicht mitreißen.
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const served = [];
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    // Spiegelt EXAKT die SimActivity-Verkabelung (robo-Handler + Root-Handler)
    await page.route('https://appassets.androidplatform.net/**', (route) => {
      const url = new URL(route.request().url());
      const full = decodeURIComponent(url.pathname);
      let rel = null;
      if (full.startsWith('/assets/robo/')) rel = full.slice('/assets/robo/'.length);
      else rel = full.slice(1);
      if (!rel || rel.includes('..')) return route.fulfill({ status: 404, body: 'nope' });
      const file = path.join(ROBODIR, rel);
      if (!file.startsWith(ROBODIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: 'missing ' + rel });
      }
      served.push(rel);
      return route.fulfill({ status: 200, contentType: mimeFor(rel), body: fs.readFileSync(file) });
    });

    console.log('>> [' + robot + '] Lade ' + BASE + '/robo/index.html?robot=' + robot);
    await page.goto(BASE + '/robo/index.html?robot=' + robot, { waitUntil: 'domcontentloaded' });

    // MJ-Modell muss innerhalb 90 s geladen sein (WASM + MJCF + Meshes)
    const key = robot === 'arm' ? 'arm' : 'hum';
    const ok = await page
      .waitForFunction(
        `(function () {
           try {
             var inst = window.TF07 && window.TF07.inst;
             return !!(inst && inst.state && inst.state.mjc && inst.state.mjc.${key});
           } catch (e) { return false; }
         })()`,
        null,
        { timeout: 90000 }
      )
      .then(() => true)
      .catch(() => false);
    console.log('>> [' + robot + '] MJ-Modell geladen:', ok ? 'JA' : 'NEIN');
    if (!ok) {
      console.log('ERRORS:', errors.slice(0, 5));
      console.log('SERVED (tail):', served.slice(-10));
      const st = await page.evaluate('window.TF07 && TF07.inst ? JSON.stringify({err: TF07.inst.state.mjc.err, veil: document.getElementById("bootVeil").className}) : "kein inst"').catch(() => '?');
      console.log('STATE:', st);
      failures++;
      await page.close();
      continue;
    }

    // Physik anlaufen lassen (rAF startet nach Boot) und Zustand lesen
    await page.waitForTimeout(6000);
    const state = await page.evaluate(
      `(function () {
         try {
           var inst = window.TF07.inst, S = inst.state;
           var d = S.mjc.${key}.data;
           var badge = document.getElementById('engineBadge').textContent;
           var status = document.getElementById('statusLine').textContent;
           var veilGone = document.getElementById('bootVeil').classList.contains('gone');
           return { nq: d.qpos.length, z: +d.qpos[2].toFixed(3),
                    badge: badge, status: status.slice(0, 40), veilGone: veilGone };
         } catch (e) { return { err: String(e) }; }
       })()`
    );
    console.log('>> [' + robot + '] Zustand:', JSON.stringify(state));
    console.log('>> [' + robot + '] geroutete Requests:', served.length);

    let robotOk =
      state.nq > 0 && state.veilGone === true &&
      /MUJOCO/.test(state.badge) && !/FALLBACK/i.test(state.badge);
    if (robot === 'arm') robotOk = robotOk && state.z > 0.0; // Ball/Tisch über Boden
    else robotOk = robotOk && state.z > 0.2;                  // OP3 steht aufrecht

    // Trainings-Rauchtest (nur Arm): startTraining initialisiert armmj mit
    // 4 MJ-Geistern. Headless-rAF kann stürmen — die Generation kann also
    // schon fertig sein, wenn wir das erste Mal nachsehen. Beides zählt als
    // Bestehen: (aktiv + 4 Geister) ODER (abgeschlossen, gen ≥ 1).
    if (robot === 'arm' && robotOk) {
      try {
        const train = await page.evaluate(
          '(function () { var inst = window.TF07.inst;' +
          ' inst.startTraining("arm", 1);' +
          ' var S = inst.state;' +
          ' return { active: S.training.active, robot: S.training.robot, ghosts: S.mjc.ghostRigs.length, gen: S.training.gen }; })()'
        );
        // rAF weiterlaufen lassen, dann Endstand lesen
        await page.waitForTimeout(300);
        const after = await page.evaluate(
          '(function () { var S = window.TF07.inst.state;' +
          ' return { active: S.training.active, ghosts: S.mjc.ghostRigs.length, gen: S.training.gen,' +
          '  champ: S.champions.armmj ? +S.champions.armmj.fit.toFixed(2) : null }; })()'
        );
        console.log('>> [arm] Training-Smoke:', JSON.stringify(train), '→', JSON.stringify(after));
        const initOk = train.active === true && train.robot === 'armmj' && train.ghosts === 4;
        const doneOk = after.gen >= 1 && (after.champ !== null || after.active === false);
        if (!(initOk || doneOk)) robotOk = false;
      } catch (e) {
        console.log('>> [arm] Training-Smoke fehlgeschlagen:', String(e.message).slice(0, 80));
        robotOk = false;
      }
      try { await page.evaluate('window.TF07.inst.stopTraining()'); } catch (e) { /* Seite evtl. weg */ }
    }

    if (errors.length) { console.log('>> [' + robot + '] PAGEERRORS:', errors.slice(0, 3)); robotOk = false; }
    console.log(robotOk
      ? ('>> [' + robot + '] GRÜN')
      : ('>> [' + robot + '] ROT'));
    if (!robotOk) failures++;
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(failures === 0
    ? 'ROBOLAB-E2E GRÜN — Armbot + Humanoid booten auf echtem MuJoCo, kein Fallback'
    : 'ROBOLAB-E2E ROT — ' + failures + ' Roboter fehlgeschlagen');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E-Crash:', e);
  process.exit(1);
});
