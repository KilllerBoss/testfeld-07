// ui_v2240_test.mjs — UI-Verdrahtung v2.24.0 (Port der v2.6.2-Fixes auf v2.23.0):
//   1) GAMEPAD: padClose ×-Knopf hängt ÜBER den A/B/C/D-Tasten (nie blockierbar),
//      rechts 88px frei → actionCol (btnPad/btnCam/btnReset/btnPush) bleibt
//      antippbar während das Gamepad offen ist; body.pad-on versteckt Leisten
//   2) Geist/Original getrennt: Original-Toggle Standard AUS, nach Clip-
//      Aktivierung KEIN Lehrer-Mesh (r3d.sourceGhost === null), Geist da
//   3) Original einschalten → Lehrer wird LAZY gebaut
//   4) Clip-Zeile: erweiterte Meta (s·F·fps·m) + aufklappbare Details
//   5) Sheet-Head sticky (Schließen-Knopf bleibt beim Scrollen erreichbar)
//   6) Cross-Close: Training öffnen schließt KI-Sheet (sonst verdeckt es
//      den trainClose — gleicher z-Wert, später im DOM)
// Usage: node scripts/ui_v2240_test.mjs

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
  return buildGlb(defs, { samplers, channels }, 'Idle_v2240');
}

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  ✓ ' : '  ✗ FEHLER: ') + name); if (!cond) fails++; };
const ov = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 120)));

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 90000 });

// ── 1) GAMEPAD-Geometrie (Portrait) ──────────────────────────
// Gamepad ÖFFNEN (wie der Nutzer: „wenn man Controller öffnet")
await page.evaluate(() => document.getElementById('btnPad').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await page.waitForTimeout(200);
check('Gamepad-Overlay offen (.on)', await page.evaluate(() => document.getElementById('padOverlay').classList.contains('on')));
check('btnPad leuchtet (.lit)', await page.evaluate(() => document.getElementById('btnPad').classList.contains('lit')));
{
  const rep = await page.evaluate(() => {
    const r = {};
    for (const id of ['padClose', 'padBtnA', 'padBtnB', 'padBtnC', 'padBtnD', 'padRZone', 'padLZone', 'btnPad', 'btnCam', 'btnReset', 'btnPush', 'padOverlay']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      r[id] = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    return r;
  });
  // × über den A/B/C/D-Tasten (gleiche Spalte, klebt an deren Oberkante)
  check('padClose ÜBER padBtns (keine Überlappung)', !ov(rep.padClose, rep.padBtnA) && rep.padClose.y + rep.padClose.h <= rep.padBtnA.y + 2);
  check('padClose im Viewport', rep.padClose.y >= 0 && rep.padClose.y + rep.padClose.h <= 915);
  // Der rechte Tastenstapel bleibt frei — DAS ist der gemeldete Bug
  for (const b of ['btnPad', 'btnCam', 'btnReset', 'btnPush']) {
    check(`Gamepad-Tasten blockieren ${b} NICHT`, !ov(rep.padBtnA, rep[b]) && !ov(rep.padBtnB, rep[b]) && !ov(rep.padBtnC, rep[b]) && !ov(rep.padBtnD, rep[b]) && !ov(rep.padRZone, rep[b]));
  }
  check('Gamepad-Tasten blockieren padClose NICHT', !ov(rep.padBtnA, rep.padClose) && !ov(rep.padBtnB, rep.padClose) && !ov(rep.padBtnC, rep.padClose) && !ov(rep.padBtnD, rep.padClose) && !ov(rep.padRZone, rep.padClose));
}
// A/B-Leisten unter dem Gamepad versteckt (stille Blockade ausgeschlossen)
check('body.pad-on gesetzt', await page.evaluate(() => document.body.classList.contains('pad-on')));

// × schließt den Controller (DER Kern des Nutzerwunsches)
await page.evaluate(() => document.getElementById('padClose').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await page.waitForTimeout(150);
check('padClose schließt das Overlay', await page.evaluate(() => !document.getElementById('padOverlay').classList.contains('on')));
check('btnPad nicht mehr beleuchtet', await page.evaluate(() => !document.getElementById('btnPad').classList.contains('lit')));

// ── G1 + Trainings-Panel + GLB-Import ────────────────────────
await page.evaluate(() => document.querySelector('.robot-chip[data-robot="g1"]').click());
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'g1', undefined, { timeout: 120000 });
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(300);
const input = await page.$('#glbFile');
await input.setInputFiles([{ name: 'v2240_idle.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(idleClipBuf()) }]);
await page.waitForFunction(() => document.querySelectorAll('.glb-clip').length >= 1, undefined, { timeout: 300000, polling: 1000 });

// ── 2) Original-Toggle Standard AUS + kein Lehrer nach Aktivierung ──
check('srcShowToggle existiert und ist Standard AUS', await page.evaluate(() => {
  const t = document.getElementById('srcShowToggle');
  return t && !t.checked;
}));
check('ghostToggle (Geist) existiert und ist AN', await page.evaluate(() => document.getElementById('ghostToggle').checked));
await page.evaluate(() => document.querySelectorAll('.glb-clip .btn.small')[0].click());
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
await page.waitForTimeout(400);
check('KEIN Lehrer-Ghost (Mesh weg, nur Geist)', await page.evaluate(() => window.__trainrobot.renderer.sourceGhost === null));
check('G1-Geist DA (ghostGroups vorhanden)', await page.evaluate(() => !!window.__trainrobot.renderer.ghostGroups));

// ── 3) Original einschalten → lazy gebaut ────────────────────
await page.evaluate(() => {
  const t = document.getElementById('srcShowToggle');
  t.checked = true;
  t.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(300);
check('Original-Lehrer gebaut (Skelett-Fallback, Test-GLB ohne Mesh)', await page.evaluate(() => !!window.__trainrobot.renderer.sourceGhost));
await page.evaluate(() => {
  const t = document.getElementById('srcShowToggle');
  t.checked = false;
  t.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(200);
check('Original wieder aus → sourceGhost entfernt (null)', await page.evaluate(() => window.__trainrobot.renderer.sourceGhost === null));

// ── 4) Clip-Zeile: erweiterte Meta + Details ─────────────────
const metaTxt = await page.evaluate(() => document.querySelector('.glb-clip-meta').textContent);
check('Meta enthält fps (' + metaTxt + ')', /fps/.test(metaTxt));
check('Meta enthält Dauer+Frames', /\d+s · \d+F/.test(metaTxt));
await page.evaluate(() => document.querySelector('.glb-clip-chevron').click());
check('Details aufgeklappt (≥5 Zeilen)', await page.evaluate(() => {
  const d = document.querySelector('.glb-clip-details');
  return !d.classList.contains('hidden') && d.querySelectorAll('.glb-cd-row').length >= 5;
}));
check('Detail-Zeilen: Ablauf + Steuerung + Status', await page.evaluate(() => {
  const ks = [...document.querySelectorAll('.glb-clip-details .glb-cd-k')].map(e => e.textContent);
  return ks.includes('Ablauf') && ks.includes('Steuerung') && ks.includes('Status');
}));
await page.evaluate(() => document.querySelector('.glb-clip-chevron').click());
check('Details wieder zu', await page.evaluate(() => document.querySelector('.glb-clip-details').classList.contains('hidden')));

// ── 5) Sticky Sheet-Head ─────────────────────────────────────
check('.sheet-head ist position:sticky', await page.evaluate(() => getComputedStyle(document.querySelector('#trainSheet .sheet-head')).position === 'sticky'));
{
  const vis = await page.evaluate(() => {
    const sh = document.getElementById('trainSheet');
    sh.scrollTop = sh.scrollHeight;
    return new Promise((res) => setTimeout(() => {
      const b = document.getElementById('trainClose').getBoundingClientRect();
      res(b.top >= 0 && b.bottom <= window.innerHeight + 1);
    }, 120));
  });
  check('trainClose nach Scrollen IM Viewport', vis);
}

// ── 6) Cross-Close: Training schließt KI-Sheet ───────────────
await page.evaluate(() => document.getElementById('trainSheet').classList.add('hidden')); // Neustand: zu
await page.evaluate(() => document.getElementById('aiSheet').classList.remove('hidden')); // KI sichtbar simulieren
await page.evaluate(() => document.getElementById('btnTrainTop').click());
await page.waitForTimeout(100);
check('Training offen', await page.evaluate(() => !document.getElementById('trainSheet').classList.contains('hidden')));
check('KI-Sheet wurde beim Öffnen des Trainings geschlossen', await page.evaluate(() => document.getElementById('aiSheet').classList.contains('hidden')));

console.log(fails === 0 ? '\nALLE v2.24.0 UI-CHECKS GRÜN' : `\n${fails} CHECK(S) ROT`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
