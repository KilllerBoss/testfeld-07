// ═══════════════════════════════════════════════════════════
// ardy_wobble_probe.mjs — Woher kommt das Idle-Wobbeln des Geists?
// Misst (OHNE X-Spiegel = korrekte Seiten):
//   ▸ triadYaw-Verlauf (Roh) — Wobble-Bereich + Periodenstruktur
//   ▸ Hüft-Yaw/Roll-Track + Schulter-Yaw-Track (Form: Drift vs. Oszillation)
//   ▸ Korrelation: wobbelt der Seed mit triadYaw?
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));

const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass, mirrorArdyOutputX } = await import(path.join(WWW, 'js/ardy.js'));
const { BertWordPiece } = await import(path.join(WWW, 'js/ardytoken.js'));
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
const wasmBuf = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { retargetToRobot, smoothMotionPhysics } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_wobble.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_wobble.xml');

console.log('Generiere idle (Seed 7) …');
const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 4, seed: 7 });
mirrorArdyOutputX(out); // involutiv → Rohzustand (Spiegel AUS)
const motion = retargetToRobot(new ArdyClip(out), sim, () => {});
smoothMotionPhysics(motion);
const n = motion.n;

// Hüft-Yaw/Roll + Schulter-Yaw-Tracks ausgeben (alle 3 Frames, Grad)
const A = sim.actByName, nu = motion.nu;
const show = (nm) => {
  const a = A[nm];
  const vals = [];
  for (let f = 0; f < n; f += 3) vals.push((motion.q[f * nu + a] * 180 / Math.PI).toFixed(1));
  console.log(`   ${nm.padEnd(28)} [${vals.join(', ')}]`);
};
console.log('\n■ Gelenk-Tracks (Grad, alle 3 Frames):');
show('left_hip_yaw_joint');
show('left_hip_roll_joint');
show('right_hip_yaw_joint');
show('left_shoulder_yaw_joint');
show('right_shoulder_yaw_joint');

// baseQ-Roll/Nick-Verlauf
const bq = motion.baseQ;
const vals = [];
for (let f = 0; f < n; f += 3) {
  const x = bq[4 * f], y = bq[4 * f + 1], z = bq[4 * f + 2], w = bq[4 * f + 3];
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  vals.push((roll * 180 / Math.PI).toFixed(1));
}
console.log('\n   baseQ-Roll (Grad): [' + vals.join(', ') + ']');

// triadYaw-Rohwert (vor Glättung — motion.triadYaw wird exportiert)
if (motion.triadYaw) {
  const tv = [];
  for (let f = 0; f < n; f += 3) tv.push((motion.triadYaw[f] * 180 / Math.PI).toFixed(1));
  let mn = Infinity, mx = -Infinity;
  for (let f = 0; f < n; f++) { const v = motion.triadYaw[f]; if (v < mn) mn = v; if (v > mx) mx = v; }
  console.log(`\n   triadYaw Roh-Range: ${((mx - mn) * 180 / Math.PI).toFixed(2)}° · Verlauf [${tv.join(', ')}]`);
}
// rawYaw
if (motion.rawYaw) {
  let mn = Infinity, mx = -Infinity;
  for (let f = 0; f < n; f++) { const v = motion.rawYaw[f]; if (v < mn) mn = v; if (v > mx) mx = v; }
  console.log(`   rawYaw Roh-Range: ${((mx - mn) * 180 / Math.PI).toFixed(2)}°`);
}
