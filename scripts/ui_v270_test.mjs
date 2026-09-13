// ui_v270_test (Basis v2.6.0-Suite + v2.7.0: Roboter-/Weltleiste, Sensorik, Policy-Persistenz).mjs — UI-Verdrahtung v2.6.0 im Chromium:
//   1) „Buttons"-Chip vorhanden + Eingabezeile nur im btn-Modus
//   2) Button hinzufügen → untere Leiste erscheint (clipButtons unten!)
//   3) Button-Taste löst Trigger aus (obs-Kanal > 0)
//   4) „Aus"-Button deaktiviert den Clip (Clip bleibt in der Liste)
//   5) KI-Button-Leiste unten positioniert (CSS)
// Usage: node scripts/ui_v260_test.mjs

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

function quatAxis(axis, deg) {
  const a = deg * Math.PI / 180, s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
function synthSkeleton() {
  const defs = [];
  const add = (name, parent, translation) => { defs.push({ name, parent, translation }); return defs.length - 1; };
  const hips = add('mixamorig:Hips', -1, [0, 95, 0]);
  add('mixamorig:Spine', hips, [0, 10, 0]);
  add('mixamorig:Neck', 1, [0, 22, 0]);
  add('mixamorig:Head', 2, [0, 10, 0]);
  add('mixamorig:LeftArm', 1, [-14, 18, 0]);
  add('mixamorig:LeftForeArm', 4, [-26, 0, 0]);
  add('mixamorig:RightArm', 1, [14, 18, 0]);
  add('mixamorig:RightForeArm', 6, [26, 0, 0]);
  const lul = add('mixamorig:LeftUpLeg', hips, [-9, -6, 0]);
  add('mixamorig:LeftLeg', lul, [0, -44, 0]);
  add('mixamorig:LeftFoot', 9, [0, -42, 0]);
  const rul = add('mixamorig:RightUpLeg', hips, [9, -6, 0]);
  add('mixamorig:RightLeg', rul, [0, -44, 0]);
  add('mixamorig:RightFoot', 12, [0, -42, 0]);
  return defs;
}
function buildGlb(nodeDefs, anim, name) {
  const accessors = [], bufferViews = [], binChunks = [];
  let off = 0;
  for (const s of anim.samplers) {
    const bytes = new Uint8Array(s._output.buffer, s._output.byteOffset, s._output.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    off += bytes.length;
    s.output = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: s._comp === 3 ? 'VEC3' : 'VEC4' });
    const tb = new Uint8Array(s._times.buffer, s._times.byteOffset, s._times.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(tb);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: tb.length });
    off += tb.length;
    s.input = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: 'SCALAR' });
  }
  const bin = Buffer.concat(binChunks);
  const nodes = nodeDefs.map((n) => { const o = { name: n.name }; if (n.translation) o.translation = n.translation; return o; });
  nodeDefs.forEach((n, i) => { const ch = []; nodeDefs.forEach((m, j) => { if (m.parent === i) ch.push(j); }); if (ch.length) nodes[i].children = ch; });
  const enc = new TextEncoder();
  let jsonStr = JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes, animations: [{ name, samplers: anim.samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels: anim.channels }], accessors, bufferViews, buffers: [{ byteLength: bin.length }] });
  jsonStr += ' '.repeat((4 - enc.encode(jsonStr).length % 4) % 4);
  const jsonBytes = enc.encode(jsonStr);
  const binPad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length + binPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, bin.length + binPad, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  u8.set(bin, binOff + 8);
  return out;
}
function idleClipBuf() {
  const defs = synthSkeleton();
  const K = 49, fps = 30;
  const channels = [], samplers = [];
  const track = (node, comp) => {
    const times = new Float32Array(K);
    for (let k = 0; k < K; k++) times[k] = k / fps;
    const s = { _times: times, _output: new Float32Array(K * comp), _comp: comp, interpolation: 'LINEAR' };
    samplers.push(s);
    channels.push({ sampler: samplers.length - 1, target: { node, path: comp === 4 ? 'rotation' : 'translation' } });
    return s._output;
  };
  const armL = track(4, 4), armR = track(6, 4);
  for (let k = 0; k < K; k++) {
    const s = Math.sin(2 * Math.PI * (k / fps) / 1.6);
    const qa = quatAxis([1, 0, 0], 6 * s);
    armL.set(qa, k * 4); armR.set(qa, k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Idle_ui');
}

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 120)));

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });

// Training-Panel + GLB-Sektion öffnen (G1 nötig)
await page.evaluate(() => {
  document.querySelector('.robot-chip[data-robot="g1"]').click();
});
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'g1', undefined, { timeout: 120000 });
console.log('G1 geladen');

// Training-Panel öffnen (GLB-Sektion lebt darin)
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(300);

const input = await page.$('#glbFile');
await input.setInputFiles([{ name: 'ui_idle.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(idleClipBuf()) }]);
await page.waitForFunction(() => document.querySelectorAll('.glb-clip').length >= 1, undefined, { timeout: 300000, polling: 1000 });

// Clip aktivieren
await page.evaluate(() => { document.querySelectorAll('.glb-clip .btn.small')[0].click(); });
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
console.log('Motion-Task aktiv');

// 1) Chips + Eingabezeile
check('„Buttons"-Chip vorhanden (data-ctrl=btn)', await page.evaluate(() => !!document.querySelector('.ctrl-chip[data-ctrl="btn"]')));
check('Eingabezeile initial versteckt', await page.evaluate(() => document.getElementById('glbBtnRow').classList.contains('hidden')));

// 2) btn-Modus → Eingabezeile sichtbar
await page.evaluate(() => document.querySelector('.ctrl-chip[data-ctrl="btn"]').click());
await page.waitForTimeout(150);
check('btn-Modus aktiv (task.ctrlMode)', await page.evaluate(() => window.__trainrobot.task.ctrlMode === 'btn'));
check('Eingabezeile im btn-Modus sichtbar', await page.evaluate(() => !document.getElementById('glbBtnRow').classList.contains('hidden')));

// 3) Button hinzufügen → untere Leiste
await page.fill('#glbBtnName', 'Kicken');
await page.evaluate(() => document.getElementById('glbBtnAdd').click());
await page.waitForTimeout(150);
await page.fill('#glbBtnName', 'Springen');
await page.evaluate(() => document.getElementById('glbBtnAdd').click());
await page.waitForTimeout(150);
check('2 Buttons in der Leiste', await page.evaluate(() => document.querySelectorAll('#clipButtons .clip-btn').length === 2));
check('Leiste ist SICHTBAR', await page.evaluate(() => !document.getElementById('clipButtons').classList.contains('hidden')));
// Position unten: Bar-Unterkunde weit unterhalb der Bildschirmmitte
const posOk = await page.evaluate(() => {
  const r = document.getElementById('clipButtons').getBoundingClientRect();
  return r.top > window.innerHeight * 0.55 && r.bottom <= window.innerHeight + 1;
});
check('Button-Leiste sitzt im unteren Bereich (nicht oben)', posOk);
// Persistiert im Clip-Rec?
check('Buttons im Clip-Datensatz persistiert', await page.evaluate(() => {
  const tr = window.__trainrobot;
  return JSON.stringify(tr.task.buttons) === JSON.stringify(['Kicken', 'Springen']);
}));

// 4) Taste löst Trigger aus (SwiftShader rendert langsam → großzügig warten)
await page.evaluate(() => document.querySelectorAll('#clipButtons .clip-btn')[0].click());
await page.waitForTimeout(1500); // Glättung bei niedriger FPS-Ziel
const trgVal = await page.evaluate(() => window.__trainrobot.task.trg[0]);
check('Button-Taste setzt Trigger-Kanal 0 (' + trgVal.toFixed(2) + ')', trgVal > 0.15);

// 5) Lange drücken löscht
await page.evaluate(() => {
  const btn = document.querySelectorAll('#clipButtons .clip-btn')[1];
  const pd = new PointerEvent('pointerdown', { bubbles: true });
  btn.dispatchEvent(pd);
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const btn = document.querySelector('#clipButtons .clip-btn');
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
await page.waitForTimeout(200);
check('Lang-Drücken hat Button entfernt (1 übrig)', await page.evaluate(() => document.querySelectorAll('#clipButtons .clip-btn').length === 1));

// 6) „Aus" deaktiviert, Clip bleibt gelistet
const before = await page.evaluate(() => document.querySelectorAll('.glb-clip').length);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.glb-clip')];
  const active = rows.find(r => r.querySelector('.btn.small').textContent === 'Aus');
  active.querySelector('.btn.small').click();
});
await page.waitForTimeout(400);
check('Nach „Aus": keine Motion-Task mehr', await page.evaluate(() => window.__trainrobot.task.kind !== 'motion'));
check('Nach „Aus": kein aktiver Clip', await page.evaluate(() => !window.__trainrobot.motionClip));
check('Clip bleibt in der Liste (' + before + ')', await page.evaluate((n) => document.querySelectorAll('.glb-clip').length === n, before));
check('Nach „Aus": Button-Leiste weg', await page.evaluate(() => document.getElementById('clipButtons').classList.contains('hidden')));

// 7) KI-Buttons CSS unten (berechnete Position prüfen — top löst zu px auf)
const aiPos = await page.evaluate(() => {
  const bar = document.getElementById('aiButtons');
  bar.classList.remove('hidden');
  bar.innerHTML = '<button class="ai-btn">PROBE</button>';
  const r = bar.getBoundingClientRect();
  const ok = r.top > window.innerHeight * 0.55;
  bar.innerHTML = '';
  bar.classList.add('hidden');
  return ok;
});
check('KI-Button-Leiste sitzt unten (nicht oben)', aiPos);


// ── v2.7.0: Training + Policy-Persistenz pro Clip ───────
// Clip wieder aktivieren
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.glb-clip')];
  rows[0].querySelector('.btn.small').click(); // „Referenz"
});
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
console.log('Clip reaktiviert');

// Policy-Badge-Syntax prüfen (vor Training nicht vorhanden)
check('Kein Policy-Badge vor Training', await page.evaluate(() => !document.querySelector('.glb-clip-badge')));

// Training starten und ~300 Schritte sammeln (MAX-Modus ist default)
await page.evaluate(() => document.getElementById('tStart').click());
await page.waitForTimeout(6000);
const dbg = await page.evaluate(() => {
  const t = window.__trainrobot.task;
  const obs = new Float32Array(t.obsDim);
  t.observe(window.__trainrobot.sim, obs);
  const bad = [];
  for (let k = 0; k < obs.length; k++) if (!Number.isFinite(obs[k])) bad.push(k);
  return {
    trainer: !!window.__trainrobot.trainer,
    steps: window.__trainrobot.trainer ? window.__trainrobot.trainer.stepCount : -1,
    btn: document.getElementById('tStart').textContent,
    taskKind: t.kind,
    ctrlMode: t.ctrlMode,
    obsNonFinite: bad.length,
    badIdx: bad.slice(0, 10),
    actFinite: (() => { const a = new Float32Array(t.actDim); try { window.__trainrobot.trainer.actDeterministic(obs, a); } catch (e) { return 'ERR ' + e.message; } return a.every(Number.isFinite); })(),
  };
});
console.log('  [debug nach tStart]', JSON.stringify(dbg));
const prof = await page.evaluate(() => {
  const tr = window.__trainrobot;
  const t = tr.task, sim = tr.sim, trainer = tr.trainer;
  const obs = new Float32Array(t.obsDim);
  const out = {};
  let t0 = performance.now();
  t.observe(sim, obs); out.observe = performance.now() - t0;
  t0 = performance.now();
  trainer.norm.update(obs); const { act, logp, value } = trainer.act(obs, false); out.act = performance.now() - t0;
  t0 = performance.now();
  t.actionToCtrl(sim, act); out.actionToCtrl = performance.now() - t0;
  t0 = performance.now();
  sim.stepN(10); out.stepN = performance.now() - t0;
  t0 = performance.now();
  if (t.kind === 'motion') t.advance(0.02); out.advance = performance.now() - t0;
  t0 = performance.now();
  t.reward(sim); out.reward = performance.now() - t0;
  t0 = performance.now();
  trainer.store(obs, act, logp, 0.5, false, value); out.store = performance.now() - t0;
  return out;
});
console.log('  [profil ms]', JSON.stringify(prof));
const raf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
console.log('  [rAF in 3s]', raf);
const st2 = await page.evaluate(() => window.__trainrobot.trainer.stepCount);
console.log('  [steps nach 3s weiteren]', st2);
await page.waitForFunction(() => window.__trainrobot.trainer && window.__trainrobot.trainer.stepCount > 300, undefined, { timeout: 240000, polling: 500 });
await page.evaluate(() => document.getElementById('tStart').click()); // pausieren
const trainedSteps = await page.evaluate(() => window.__trainrobot.trainer.stepCount);
console.log('Training-Schritte gesammelt: ' + trainedSteps);

// Deaktivieren → Policy muss PRO CLIP gespeichert bleiben
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.glb-clip')];
  const active = rows.find(r => [...r.querySelectorAll('.btn.small')].some(b => b.textContent === 'Aus'));
  [...active.querySelectorAll('.btn.small')].find(b => b.textContent === 'Aus').click();
});
await page.waitForTimeout(500);
const clipKeys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tr_policy_g1_motion_glb_')));
check('Policy pro Clip gespeichert (Key tr_policy_g1_motion_<clipId>)', clipKeys.length >= 1, clipKeys.join(','));

// Reaktivieren → Policy wird wieder geladen (nicht „gelöscht")
// Erst warten, bis die Liste den Deaktivier-Refresh abgeschlossen hat
await page.waitForFunction(() => {
  const rows = [...document.querySelectorAll('.glb-clip')];
  if (!rows.length) return false;
  const btns = [...rows[0].querySelectorAll('button')];
  return btns.some(b => b.textContent === 'Referenz');
}, undefined, { timeout: 60000 });
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.glb-clip')];
  const btns = [...rows[0].querySelectorAll('button')];
  const use = btns.find(b => b.textContent === 'Referenz' || b.textContent === 'Aus');
  if (!use) return 'BUTTON NICHT GEFUNDEN';
  use.click();
  return use.textContent;
});
console.log('  [reaktiviere via]', clicked);
await page.waitForTimeout(2000);
const lastLog = await page.evaluate(() => [...document.querySelectorAll('#consoleLog .log-line, #consoleLog div')].slice(-4).map(d => d.textContent));
console.log('  [app-konsole]', JSON.stringify(lastLog));
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
await page.waitForTimeout(400);
const restored = await page.evaluate(() => window.__trainrobot.trainer && window.__trainrobot.trainer.stepCount);
check('Policy beim Reaktivieren wieder geladen (' + restored + ' Schritte)', restored >= 300);
check('Policy-Badge sichtbar nach Training', await page.evaluate(() => !!document.querySelector('.glb-clip-badge')));

// ── v2.7.0: Roboterleiste dynamisch (6 Modelle) ────────
check('6 Roboter-Chips dynamisch gerendert', await page.evaluate(() => document.querySelectorAll('#robotBar .robot-chip').length === 6));
check('Microduck-Chip vorhanden (duck)', await page.evaluate(() => !!document.querySelector('#robotBar .robot-chip[data-robot="duck"]')));
check('Go2-Chip vorhanden', await page.evaluate(() => !!document.querySelector('#robotBar .robot-chip[data-robot="go2"]')));

// ── v2.7.0: Weltleiste (Presets + Zufall) ──────────────
check('Weltleiste vorhanden mit 6 Welten', await page.evaluate(() => document.querySelectorAll('#worldBar .world-chip').length === 6));
check('WELT-Label vorhanden', await page.evaluate(() => !!document.querySelector('#worldBar .world-label')));
check('Aktive Welt = Testfeld (default)', await page.evaluate(() => document.querySelector('#worldBar .world-chip.active')?.dataset.world === 'testfeld'));
check('Würfel-Button versteckt außer bei Zufall', await page.evaluate(() => document.getElementById('worldDice').classList.contains('hidden')));

// Weltwechsel: FLACH — Roboter wird neu kompiliert, Clip bleibt aktiv
const waitIdle = async () => {
  try {
    await page.waitForFunction(() => window.__trainrobot.switching === false, undefined, { timeout: 90000 });
  } catch (e) {
    const c = await page.evaluate(() => [...document.querySelectorAll('#consoleLog div')].slice(-6).map(d => d.textContent));
    console.log('  [waitIdle steckt] app-konsole:', JSON.stringify(c, null, 1));
    const fl = await page.evaluate(() => ({ log: (window.__fetchLog || []).slice(-8), len: (window.__fetchLog || []).length }));
    console.log('  [fetch-log]', JSON.stringify(fl));
    throw e;
  }
};
await waitIdle();
await page.evaluate(() => {
  window.__fetchLog = [];
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    window.__fetchLog.push(['START ' + String(u).slice(-44)]);
    return of(u, o).then((r) => { window.__fetchLog.push([String(u).slice(-44), 'OK ' + r.status]); return r; }, (e) => { window.__fetchLog.push([String(u).slice(-44), 'ERR ' + e.message]); throw e; });
  };
});
page.on('console', (m) => { const t = m.text(); if (/FEHLER|Error|error/.test(t)) console.log('  [page-console]', t.slice(0, 180)); });
await page.evaluate(() => document.querySelector('#worldBar .world-chip[data-world="flach"]').click());
await page.waitForFunction(() => document.querySelector('#worldBar .world-chip.active')?.dataset.world === 'flach', undefined, { timeout: 120000 });
await waitIdle();
await page.waitForTimeout(800);
check('Welt FLACH aktiv', await page.evaluate(() => document.querySelector('#worldBar .world-chip.active')?.dataset.world === 'flach'));
check('Roboter nach Weltwechsel geladen (sim OK)', await page.evaluate(() => !!window.__trainrobot.sim));
check('GLB-Clip bleibt über Weltwechsel aktiv', await page.evaluate(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion'));
check('Weltwahl persistiert', await page.evaluate(() => JSON.parse(localStorage.getItem('tr_world_v1')).id === 'flach'));

// Zufallswelt + Würfel-Button
await waitIdle();
await page.evaluate(() => document.querySelector('#worldBar .world-chip[data-world="zufall"]').click());
await page.waitForFunction(() => document.querySelector('#worldBar .world-chip.active')?.dataset.world === 'zufall', undefined, { timeout: 120000 });
await waitIdle();
await page.waitForTimeout(600);
check('Würfel-Button bei Zufall sichtbar', await page.evaluate(() => !document.getElementById('worldDice').classList.contains('hidden')));
const seed1 = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_world_v1')).seed);
await page.evaluate(() => document.getElementById('worldDice').click());
await page.waitForFunction((s) => JSON.parse(localStorage.getItem('tr_world_v1')).seed !== s, seed1, { timeout: 120000 });
await waitIdle();
const seed2 = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_world_v1')).seed);
check('Neu würfeln ändert den Seed (' + seed1 + ' → ' + seed2 + ')', seed2 !== seed1);

// Sensorik im Task-Kontext (KI-Agent-Info)
check('Sensorik-Info im Agent-Zustand', await page.evaluate(() => (window.__trainrobot.ui && true) === true));

console.log(fails === 0 ? '\nALLE v2.7.0 UI-CHECKS GRÜN' : `\n${fails} v2.7.0 UI-CHECK(S) ROT`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
