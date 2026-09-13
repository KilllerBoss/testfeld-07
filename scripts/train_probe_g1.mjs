// train_probe_g1.mjs — G1-Motion-Task: zählt stepCount? Wenn nein: welcher obs-Kanal ist nicht endlich?
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
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
  return buildGlb(defs, { samplers, channels }, 'Idle_g1probe');
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__trainrobot && window.__trainrobot.sim, undefined, { timeout: 60000 });
await page.evaluate(() => document.querySelector('#robotBar .robot-chip[data-robot="g1"]').click());
await page.waitForFunction(() => window.__trainrobot.cfg && window.__trainrobot.cfg.id === 'g1', undefined, { timeout: 120000 });
console.log('G1 geladen, obsDim =', await page.evaluate(() => window.__trainrobot.task.obsDim));

await page.evaluate(() => document.getElementById('btnTrainTop').click());
const input = await page.$('#glbFile');
await input.setInputFiles([{ name: 'probe.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(idleClipBuf()) }]);
await page.waitForFunction(() => document.querySelectorAll('.glb-clip').length >= 1, undefined, { timeout: 300000, polling: 1000 });
await page.evaluate(() => document.querySelectorAll('.glb-clip .btn.small')[0].click());
await page.waitForFunction(() => window.__trainrobot.task && window.__trainrobot.task.kind === 'motion', undefined, { timeout: 60000 });
console.log('Motion-Task aktiv, obsDim =', await page.evaluate(() => window.__trainrobot.task.obsDim));

// Training starten + Kanal-Diagnose
await page.evaluate(() => document.getElementById('tStart').click());
await page.waitForTimeout(3000);
const raf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
console.log('[rAF in 3s]', raf);
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => {
    const t = window.__trainrobot.task;
    const tr = window.__trainrobot.trainer;
    const obs = new Float32Array(t.obsDim);
    t.observe(window.__trainrobot.sim, obs);
    const bad = [];
    for (let k = 0; k < obs.length; k++) if (!Number.isFinite(obs[k])) bad.push(k);
    return { steps: tr ? tr.stepCount : -1, eps: window.__trainrobot.episodes, bad: bad.slice(0, 8), badCount: bad.length };
  });
  console.log(`t+${(i + 1) * 3}s: steps=${st.steps} eps=${st.eps} obsNonFinite=${st.badCount} [${st.bad.join(',')}]`);
}
await browser.close();
process.exit(0);
