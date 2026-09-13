// glb_browser_test.mjs — End-to-End im Chromium: Boot, Roboterwechsel G1,
// GLB-Import (synthetisch, Idle + Walk), Retargeting, Referenz-Aktivierung,
// Geist-Anzeige + 10 s Wiedergabe ohne Konsolen-Fehler.
// Usage: node scripts/glb_browser_test.mjs

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

// ── Mini-HTTP-Server für die App ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]));
    const buf = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;
console.log('Server:', BASE);

// ── Synthetische Test-GLBs (wie im Diag-Harness) ──
const { quatRot: quatRotGlb } = await import(path.join(WWW, 'js/glb.js')).catch(() => ({ quatRot: null }));
// direkt die GlbClip-Funktionen der App nutzen wäre zirkulär — hier bauen wir
// die GLBs einfach mit den bekannten Formeln:
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
    const comp = s._comp;
    const bytes = new Uint8Array(s._output.buffer, s._output.byteOffset, s._output.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(bytes); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length }); off += bytes.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: comp === 3 ? 'VEC3' : 'VEC4' });
    s.output = accessors.length - 1;
    const tb = new Uint8Array(s._times.buffer, s._times.byteOffset, s._times.byteLength);
    if (off % 4) { const pad = new Uint8Array(4 - off % 4); binChunks.push(pad); off += pad.length; }
    binChunks.push(tb); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: tb.length }); off += tb.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: s._times.length, type: 'SCALAR' });
    s.input = accessors.length - 1;
  }
  const bin = Buffer.concat(binChunks);
  const nodes = nodeDefs.map((n) => { const o = { name: n.name }; if (n.translation) o.translation = n.translation; return o; });
  nodeDefs.forEach((n, i) => { const ch = []; nodeDefs.forEach((m, j) => { if (m.parent === i) ch.push(j); }); if (ch.length) nodes[i].children = ch; });
  const gltf = {
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes,
    animations: [{ name, samplers: anim.samplers.map(({ input, output, interpolation }) => ({ input, output, interpolation })), channels: anim.channels }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  };
  const enc = new TextEncoder();
  let jsonStr = JSON.stringify(gltf);
  jsonStr += ' '.repeat((4 - enc.encode(jsonStr).length % 4) % 4);
  const jsonBytes = enc.encode(jsonStr);
  const binPad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length + binPad;
  const out = new ArrayBuffer(total); const dv = new DataView(out); const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, bin.length + binPad, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  u8.set(bin, binOff + 8);
  return Buffer.from(out);
}
function idleClip() {
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
  const armL = track(4, 4), armR = track(6, 4), spine = track(1, 4);
  for (let k = 0; k < K; k++) {
    const t = k / fps, s = Math.sin(2 * Math.PI * t / 1.6);
    const qa = quatAxis([1, 0, 0], 6 * s);
    armL.set(qa, k * 4); armR.set(qa, k * 4);
    spine.set(quatAxis([0, 1, 0], 2 * s), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Idle_planted');
}
function walkClip() {
  const defs = synthSkeleton();
  const K = 73, fps = 30, dur = 2.4;
  const channels = [], samplers = [];
  const track = (node, comp) => {
    const times = new Float32Array(K);
    for (let k = 0; k < K; k++) times[k] = k / fps;
    const s = { _times: times, _output: new Float32Array(K * comp), _comp: comp, interpolation: 'LINEAR' };
    samplers.push(s);
    channels.push({ sampler: samplers.length - 1, target: { node, path: comp === 4 ? 'rotation' : 'translation' } });
    return s._output;
  };
  const hipsT = track(0, 3), hipsR = track(0, 4);
  const uLegL = track(8, 4), uLegR = track(11, 4), legL = track(9, 4), legR = track(12, 4);
  for (let k = 0; k < K; k++) {
    const t = k / fps, w = 2 * Math.PI * t / (dur / 2);
    const s = Math.sin(w), c = Math.cos(w);
    hipsR.set(quatAxis([1, 0, 0], 4 * s), k * 4);
    hipsT.set([0, 95 + 2.5 * Math.abs(c), t * 120], k * 3);
    uLegL.set(quatAxis([1, 0, 0], 28 * s - 5), k * 4);
    uLegR.set(quatAxis([1, 0, 0], -28 * s - 5), k * 4);
    legL.set(quatAxis([1, 0, 0], Math.max(0, 42 * -s)), k * 4);
    legR.set(quatAxis([1, 0, 0], Math.max(0, 42 * s)), k * 4);
  }
  return buildGlb(defs, { samplers, channels }, 'Walk_plusZ');
}

// ── Browser-Test ──
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=2048'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

console.log('Lade App …');
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
// Auf Boot-Ende warten (Splash weg + Konsole „Bereit")
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });
console.log('✓ App gebootet, A1 aktiv');

// G1 laden
await page.evaluate(async () => {
  const tr = window.__trainrobot;
  document.querySelector('.robot-chip[data-robot="g1"]').click();
  await new Promise(r => setTimeout(r, 2500));
});
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'g1', undefined, { timeout: 120000 });
console.log('✓ G1 geladen, nu=' + await page.evaluate(() => window.__trainrobot.sim.nu));

// GLB importieren über den Datei-Input (2 Dateien: Idle + Walk)
const idleBuf = idleClip(), walkBuf = walkClip();
const input = await page.$('#glbFile');
await input.setInputFiles([
  { name: 'test_idle.glb', mimeType: 'model/gltf-binary', buffer: idleBuf },
  { name: 'test_walk.glb', mimeType: 'model/gltf-binary', buffer: walkBuf },
]);
await page.waitForFunction(() => document.querySelectorAll('.glb-clip').length >= 2, undefined, { timeout: 300000, polling: 1000 });
const clipCount = await page.evaluate(() => document.querySelectorAll('.glb-clip').length);
console.log(`✓ Import: ${clipCount} Clips in der Liste`);

// Ersten Clip als Referenz aktivieren
await page.evaluate(() => { document.querySelectorAll('.glb-clip .btn.small')[0].click(); });
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
const hasTask = true;
console.log(hasTask ? '✓ Motion-Task aktiv' : '✗ KEIN Motion-Task');
if (!hasTask) throw new Error('Motion-Task nicht aktiv');

// Ghost vorhanden?
await page.waitForFunction(() => !!window.__trainrobot.renderer.ghostGroups, undefined, { timeout: 60000 });
const hasGhost = await page.evaluate(() => !!window.__trainrobot.renderer.ghostGroups && !!window.__trainrobot.renderer.sourceGhost);
console.log(hasGhost ? '✓ G1-Geist + Lehrer sichtbar' : '✗ Geist fehlt');

// 8 s Wiedergabe: Geist-Position/-Yaw soll ohne Teleports bleiben (Idle!)
const drift = await page.evaluate(async () => {
  const tr = window.__trainrobot;
  const g = tr.renderer.ghostGroups;
  const read = () => { const grp = g[1]; return [grp.position.x, grp.position.y, grp.position.z]; };
  const samples = [];
  for (let i = 0; i < 80; i++) { samples.push(read()); await new Promise(r => setTimeout(r, 100)); }
  let maxJump = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1], samples[i][2] - samples[i - 1][2]);
    maxJump = Math.max(maxJump, d);
  }
  return { maxJump: +maxJump.toFixed(3), first: samples[0], last: samples[samples.length - 1] };
});
console.log(`✓ 8 s Idle-Wiedergabe: max Basis-Sprung=${drift.maxJump} m, Start=${drift.first.map(v => v.toFixed(2))}, Ende=${drift.last.map(v => v.toFixed(2))}`);
if (drift.maxJump > 0.5) throw new Error('Geist springt: maxJump=' + drift.maxJump);

// Walk-Clip aktivieren — Root-Bahn muss laufen
await page.evaluate(() => { document.querySelectorAll('.glb-clip .btn.small')[1].click(); });
let walkOk = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => {
    const tr = window.__trainrobot;
    return {
      name: tr.motionClip ? tr.motionClip.name : null,
      kind: tr.task ? tr.task.kind : null,
      locomotion: tr.motionClip ? tr.motionClip.locomotion : null,
      rows: document.querySelectorAll('.glb-clip').length,
    };
  });
  if (st.name && st.name.toLowerCase().includes('walk')) { console.log(`✓ Walk-Referenz aktiv (${st.name}, locomotion=${st.locomotion})`); walkOk = true; break; }
  if (i === 59) { console.log('Walk-Aktivierung fehlgeschlagen, Zustand:', JSON.stringify(st)); }
}
if (!walkOk) throw new Error('Walk-Referenz nicht aktiv');
await page.waitForTimeout(800);
const walkDist = await page.evaluate(async () => {
  const tr = window.__trainrobot;
  const g = tr.renderer.ghostGroups;
  const grp = g[1];
  const p0 = [grp.position.x, grp.position.y];
  for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 100));
  const p1 = [grp.position.x, grp.position.y];
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
});
console.log(`✓ 3 s Walk-Wiedergabe: Geist zurückgelegt=${walkDist.toFixed(2)} m (Root-Motion)`);
if (walkDist < 1) throw new Error('Root-Motion bewegt sich nicht: ' + walkDist);

const realErrors = errors.filter(e => !/favicon|Download the React DevTools/i.test(e));
if (realErrors.length) {
  console.log('\n⚠ Konsolen-Fehler:');
  for (const e of realErrors.slice(0, 10)) console.log('  ' + e);
  throw new Error(realErrors.length + ' Konsolen-Fehler');
}
console.log('\n═══ ALLE BROWSER-TESTS GRÜN ═══');
await browser.close();
server.close();
process.exit(0);
