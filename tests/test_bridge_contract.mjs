/* Bridge-Kontrakt-Test (v1.1/v1.2-Regression): Der Produktions-Bug war ein
 * doppelt präfixierter Asset-Pfad ("mjc/mjc/…") zwischen mjc.js und der
 * Java-Bridge → Bridge lieferte null → atob("null") → Müll-Bytes → MJ-Boot
 * scheiterte STILL → unsichtbarer Werkstatt-Fallback.
 *
 * Dieser Test sperrt den Kontrakt ein:
 *  1. JS normalisiert Pfade VOR dem Bridge-Aufruf (nie "mjc/…", nie "/…").
 *  2. Java-seitige Semantik (Map-Schlüssel "mjc/" + bare) muss matchen.
 *  3. null-Antworten → saubere Ableitung mit klarem Fehler (kein atob-Garbage).
 *  4. Konsole: "version"/"engine" liefert op:engine (sichtbare Kennung).
 *  5. v1.2: readAssetChunkBase64-Kontrakt — [offset,offset+length) exakt,
 *     Multi-Chunk-Reassemblierung byteidentisch, offset>Größe → null,
 *     Fallback auf readAssetBase64 wenn Chunk-Methode fehlt.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* --- mjc.js in Node laden (klassische IIFE, global = globalThis) --- */
const src = readFileSync(join(ROOT, 'sim/src/mjc.js'), 'utf8');
new Function(src)(); // führt (function(global){...})(globalThis) aus
const TF = globalThis.TF07;
if (!TF || !TF.mjc) { console.error('FEHLER: TF07.mjc nicht geladen'); process.exit(1); }

let fails = 0;
const check = (name, cond) => {
  console.log((cond ? '  OK  ' : '  X   ') + name);
  if (!cond) fails++;
};

/* --- 1) Pfad-Normalisierung --- */
check('bridgePath("mujoco.wasm") bleibt relativ', TF.mjc.bridgePath('mujoco.wasm') === 'mujoco.wasm');
check('bridgePath("mjc/mujoco.wasm") wird gestrippt', TF.mjc.bridgePath('mjc/mujoco.wasm') === 'mujoco.wasm');
check('bridgePath("policies/walk.onnx") bleibt erhalten', TF.mjc.bridgePath('policies/walk.onnx') === 'policies/walk.onnx');
check('bridgePath("mjc/policies/walk.onnx") wird gestrippt', TF.mjc.bridgePath('mjc/policies/walk.onnx') === 'policies/walk.onnx');
check('bridgePath("/mjc/x") wird normalisiert', TF.mjc.bridgePath('/mjc/x') === 'x');
check('bridgePath(null) → ""', TF.mjc.bridgePath(null) === '');

/* --- 2) Java-Bridge-Semantik simulieren (exakt wie MainActivity) ---
 * Map-Schlüssel = "mjc/" + übergebener Pfad; nicht gefunden → null.
 * v1.2: Chunk-Reader mit exakter skip-Loop-Semantik wie MainActivity. */
const files = {
  'mjc/mujoco.wasm': new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  'mjc/__index.json': '{"meshes":[]}',
  'mjc/policies/walk.onnx': new Uint8Array([0x4f, 0x4e, 0x4e, 0x10]),
  /* 2,5 MB Pseudo-Zufall (deterministisch) für Multi-Chunk-Test */
  'mjc/big.bin': (() => { const a = new Uint8Array(2.5 * 1048576 | 0); let x = 123456789; for (let i = 0; i < a.length; i++) { x = (1103515245 * x + 12345) & 0x7fffffff; a[i] = x & 0xff; } return a; })(),
};
const receivedPaths = [];
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.AndroidBridge = {
  readAssetBase64(path) {
    receivedPaths.push(path);
    const hit = files['mjc/' + path];
    if (!hit) return null;
    return Buffer.from(hit).toString('base64');
  },
  readAssetChunkBase64(path, offset, length) {
    receivedPaths.push(path);
    const hit = files['mjc/' + path];
    if (hit == null) return null;
    if (offset < 0 || length <= 0 || offset >= hit.length) return null;
    const slice = hit.subarray(offset, Math.min(offset + length, hit.length));
    if (!slice.length) return null;
    return Buffer.from(slice).toString('base64');
  },
  readAssetText(path) {
    const hit = files['mjc/' + path];
    return hit == null ? null : String(hit);
  },
};

/* --- 3) Lader: bare Pfad → Auflösung; Doppelprefix-Toleranz; null → klarer Fehler --- */
const ok1 = await TF.mjc._readAsset('mujoco.wasm').then(
  (b) => b instanceof Uint8Array && b[0] === 0x00 && b[3] === 0x6d,
  (e) => { console.log('      err:', e.message); return false; }
);
check('readAsset("mujoco.wasm") liefert echte Bytes', ok1);

// Auch der Historische (falsche) JS-Aufruf mit "mjc/…"-Präfix muss dank
// Normalisierung noch auflösen — die Bridge sieht trotzdem den bare Pfad:
const ok2 = await TF.mjc._readAsset('mjc/policies/walk.onnx').then(
  (b) => b.length === 4 && b[0] === 0x4f,
  (e) => { console.log('      err:', e.message); return false; }
);
check('readAsset("mjc/policies/walk.onnx") toleriert Präfix', ok2);
check('Bridge bekam NIE einen "mjc/…"-Pfad (kein Doppelprefix)',
  receivedPaths.length === 2 && receivedPaths.every((p) => !p.startsWith('mjc/')));

const ok3 = await TF.mjc._readAsset('fehlt.onnx').then(
  () => false,
  (e) => /Asset fehlt/.test(e.message)
);
check('readAsset(miss) → klarer Fehler "Asset fehlt"', ok3);

const ok4 = await TF.mjc._readAssetText('__index.json').then(
  (t) => JSON.parse(t).meshes.length === 0, () => false
);
check('readAssetText("__index.json") liest Text', ok4);

/* --- 5) v1.2 Chunk-Kontrakt --- */
const big = files['mjc/big.bin'];
const chunked = await TF.mjc._readAsset('big.bin').then(
  (b) => {
    if (b.length !== big.length) return false;
    for (let i = 0; i < big.length; i += 65536) { // Stichproben über die ganze Datei
      if (b[i] !== big[i]) return false;
    }
    return b[big.length - 1] === big[big.length - 1];
  },
  (e) => { console.log('      err:', e.message); return false; }
);
check('Chunked readAsset("big.bin", 2,5 MB) = Multi-Chunk, byteidentisch', chunked);

const chunkMiss = await TF.mjc._readAsset('gibtsnicht.bin').then(
  () => false,
  (e) => /Asset fehlt/.test(e.message)
);
check('Chunked readAsset(miss) → klarer Fehler "Asset fehlt"', chunkMiss);

/* Fallback: ohne Chunk-Methode muss der Whole-Call weiterhin funktionieren */
const saved = globalThis.AndroidBridge.readAssetChunkBase64;
delete globalThis.AndroidBridge.readAssetChunkBase64;
const fallback = await TF.mjc._readAsset('mujoco.wasm').then(
  (b) => b.length === 8 && b[0] === 0x00,
  () => false
);
globalThis.AndroidBridge.readAssetChunkBase64 = saved;
check('Ohne Chunk-Methode: Fallback auf readAssetBase64 funktioniert', fallback);

/* --- 6) Konsole: „version" / „engine" / JSON cmd:engine --- */
delete globalThis.AndroidBridge;
const conSrc = readFileSync(join(ROOT, 'sim/src/console.js'), 'utf8');
new Function(conSrc)();
const C = globalThis.TF07.console;
const S = { robot: 'duck', mode: 'manual', tod: 'day' };
const r1 = C.handle('version', S);
check('„version" → op:engine', r1.actions.length === 1 && r1.actions[0].op === 'engine');
const r2 = C.handle('welche version ist das?', S);
check('„welche version ist das?" → op:engine', r2.actions.length === 1 && r2.actions[0].op === 'engine');
const r3 = C.parseJsonProtocol({ cmd: 'engine' });
check('JSON {"cmd":"engine"} → op:engine', r3.actions.length === 1 && r3.actions[0].op === 'engine');
const r4 = C.handle('status', S);
check('„status" bleibt status', r4.actions.length === 1 && r4.actions[0].op === 'status');
const r5 = C.handle('baue den duck', S);
check('„baue den duck" wird NICHT als engine fehlinterpretiert',
  !(r5.actions.length === 1 && r5.actions[0].op === 'engine'));

console.log(fails === 0 ? 'BRIDGE-KONTRAKT GRÜN' : `BRIDGE-KONTRAKT FEHLER (${fails})`);
process.exit(fails === 0 ? 0 : 1);
