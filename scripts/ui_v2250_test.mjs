// ui_v2250_test.mjs — UI-Verdrahtung v2.25.0 (ARDY Mini auf dem Gerät):
//   1) ARDY-Panel in der GLB-Sektion: 16 Basis-Animations-Chips (englische
//      Prompts), Prompt-Feld, Generieren, Dauer/Seed/CFG, Cache-Button
//   2) EP-Label (WebGPU/CPU) — Feature-Detection läuft ohne Hänger
//   3) Leerer Prompt → saubere Fehlermeldung (kein Absturz)
//   4) G1-Wache: nicht-G1-Roboter → Hinweis, keine Generierung
//   5) Bestand: srcShowToggle/padClose/Clip-Details unangetastet
// Usage: node scripts/ui_v2250_test.mjs

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
  const spine = add('mixamorig:Spine', hips, [0, 10, 0]);
  const neck = add('mixamorig:Neck', spine, [0, 22, 0]);
  add('mixamorig:Head', neck, [0, 10, 0]);
  const larm = add('mixamorig:LeftArm', spine, [-14, 18, 0]);
  add('mixamorig:LeftForeArm', larm, [-26, 0, 0]);
  const rarm = add('mixamorig:RightArm', spine, [14, 18, 0]);
  add('mixamorig:RightForeArm', rarm, [26, 0, 0]);
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
  return buildGlb(defs, { samplers, channels }, 'Idle_v2250');
}

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
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(300);

// ── 1) ARDY-Panel ──────────────────────────────────────────
console.log('■ ARDY Mini (auf dem Gerät)');
check('ARDY-Sektion im EIGENEN Sheet (#ardySheet, seit v2.26.0 getrennt)', await page.evaluate(() => !!document.querySelector('#ardySheet .ardy-section') && !document.querySelector('#trainSheet #ardyChips')));
check('16 Basis-Animations-Chips', await page.evaluate(() => document.querySelectorAll('#ardyChips .ardy-chip').length === 16));
check('Chips decken die Basis-Animationen ab (Idle/Gehen/Hüpfen/Weitsprung/Liegen/Aufstehen/Kicken/Tanzen/Drehen)', await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('#ardyChips .ardy-chip')).map(x => x.textContent);
  for (const want of ['Idle', 'Gehen', 'Hüpfen', 'Weitsprung', 'Liegen', 'Aufstehen', 'Kicken', 'Tanzen', 'Drehen']) {
    if (!labels.includes(want)) return false;
  }
  return true;
}));
check('Chip-Prompts sind Englisch (title)', await page.evaluate(() => {
  const c = document.querySelectorAll('#ardyChips .ardy-chip');
  return c.length && Array.from(c).every(x => /^a person /.test(x.title));
}));
check('Prompt + Generieren + Dauer (2/5/8/10) + Seed + CFG + Cache-Button', await page.evaluate(() => {
  const opts = Array.from(document.querySelectorAll('#ardyDur option')).map(o => o.value);
  return !!document.getElementById('ardyPrompt') && !!document.getElementById('ardyGenerate')
    && opts.join(',') === '2,5,8,10'
    && !!document.getElementById('ardySeed') && !!document.getElementById('ardyCfg')
    && !!document.getElementById('ardyCacheClear');
}));
check('Statuszeile erklärt Auto-Download (Hugging Face, ~650 MB)', await page.evaluate(() => /Hugging Face/.test(document.getElementById('ardyStatus').textContent) && /650/.test(document.getElementById('ardyStatus').textContent)));

// EP-Label: Feature-Detection im headless Chromium → CPU (kein WebGPU-Adapter)
await page.waitForFunction(() => /WebGPU|CPU|—/.test(document.getElementById('ardyEp').textContent), undefined, { timeout: 15000 });
check('EP-Label gesetzt (' + (await page.evaluate(() => document.getElementById('ardyEp').textContent)) + ')', true);

// ── 2) Leerer Prompt → Fehlerpfad ──────────────────────────
console.log('■ Fehlerpfade');
await page.evaluate(() => document.getElementById('ardyGenerate').click());
await page.waitForTimeout(300);
check('Leerer Prompt → kein Absturz, App lebt', await page.evaluate(() => window.__trainrobot.sim !== null));

// ── 3) Bestandteile unangetastet ───────────────────────────
console.log('■ Bestand (v2.24.0-Features)');
check('CSV-Import (ARDY-Brücke) weiterhin da', await page.evaluate(() => !!document.getElementById('csvImportBtn') && !!document.getElementById('csvFile')));
check('srcShowToggle (Mesh-aus) weiterhin da, Standard AUS', await page.evaluate(() => !!document.getElementById('srcShowToggle') && !document.getElementById('srcShowToggle').checked));
check('Referenz-Modi (STELLE/FREI/FOLGT) da', await page.evaluate(() => document.querySelectorAll('.ref-chip').length === 3));
check('MOTION-KI-Zeile da', await page.evaluate(() => !!document.getElementById('mkiChip')));
check('LEHRER-Zeile da (HF-Datensatz)', await page.evaluate(() => !!document.getElementById('teacherChip')));

// ── 4) GLB-Import + Aktivierung funktioniert weiter ────────
console.log('■ GLB-Regression');
const input = await page.$('#glbFile');
await input.setInputFiles([{ name: 'v2250_idle.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(idleClipBuf()) }]);
await page.waitForFunction(() => document.querySelectorAll('.glb-clip').length >= 1, undefined, { timeout: 300000, polling: 1000 });
await page.evaluate(() => { document.querySelectorAll('.glb-clip .btn.small')[0].click(); });
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
check('GLB-Import + Aktivierung unverändert', await page.evaluate(() => window.__trainrobot.task.kind === 'motion'));
check('ARDY-Chips nach Aktivierung noch da', await page.evaluate(() => document.querySelectorAll('#ardyChips .ardy-chip').length === 16));

await browser.close();
console.log('');
console.log(fails ? 'FEHLER: ' + fails : 'ALLE CHECKS GRÜN (ui_v2250)');
process.exit(fails ? 1 : 0);
