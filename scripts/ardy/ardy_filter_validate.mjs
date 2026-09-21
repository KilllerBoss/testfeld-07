// ═══════════════════════════════════════════════════════════
// ardy_filter_validate.mjs — End-to-End: ECHTE ARDY-Generierung
// → ECHTES Retarget → ECHTER App-Filter (smoothMotionPhysics)
// → Statistik + Physik-Fahrtest. Beweist den v2.28.5-Effekt.
// Usage: node scripts/ardy/ardy_filter_validate.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: readFileSync(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { retargetToRobot, smoothMotionPhysics, fitSrcPosToRobot } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { ArdyRuntime, setOrtTensorClass } = await import(path.join(WWW, 'js/ardy.js'));
const { BertWordPiece } = await import(path.join(WWW, 'js/ardytoken.js'));

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_diag.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_diag.xml');
const nu = sim.nu;

function rates(q, n, dt) {
  const arr = [];
  for (let f = 0; f < n - 1; f++) {
    let mx = 0;
    for (let j = 0; j < nu; j++) mx = Math.max(mx, Math.abs(q[(f + 1) * nu + j] - q[f * nu + j]) / dt);
    arr.push(mx);
  }
  arr.sort((a, b) => a - b);
  const p = (x) => arr[Math.min(arr.length - 1, Math.floor(x * arr.length))];
  return { p50: p(0.5), p95: p(0.95), max: arr[arr.length - 1] };
}

function driveTest(name, motion, seconds = 5) {
  const { q, n, fps } = motion;
  const CTRL_DT = 0.02;
  const substeps = Math.max(1, Math.round(CTRL_DT / sim.timestep));
  sim.reset();
  const keyCtrl = sim.keyCtrl;
  let upzMin = 1, fallT = -1, sqErr = 0, sqN = 0;
  const bq = new Float64Array(4), p3 = new Float64Array(3), ref = new Float64Array(nu), qq = new Float64Array(nu);
  for (let s = 0; s <= Math.round(seconds / CTRL_DT); s++) {
    const t = s * CTRL_DT;
    const tf = (t * fps) % n;
    const i0 = Math.floor(tf), i1 = (i0 + 1) % n, u = tf - i0;
    const blend = Math.min(1, t / 0.6);
    for (let j = 0; j < nu; j++) ref[j] = keyCtrl[j] * (1 - blend) + (q[i0 * nu + j] * (1 - u) + q[i1 * nu + j] * u) * blend;
    for (let j = 0; j < nu; j++) sim.ctrl[j] = ref[j];
    sim.stepN(substeps);
    sim.baseQuat(bq);
    const upz = 1 - 2 * (bq[1] * bq[1] + bq[2] * bq[2]);
    sim.basePos(p3);
    upzMin = Math.min(upzMin, upz);
    if (fallT < 0 && (upz < 0.5 || p3[2] < 0.35)) fallT = t;
    sim.jointPositions(qq);
    for (let j = 0; j < nu; j++) { const d = qq[j] - ref[j]; sqErr += d * d; sqN++; }
  }
  return { fallT, upzMin, rms: Math.sqrt(sqErr / Math.max(1, sqN)) };
}

const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));
const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
setOrtTensorClass(ort.Tensor);
const tokenizer = await BertWordPiece.fromTokenizerJson(tokJson);
const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
const rt = new ArdyRuntime(manifest, tokenizer, sessions, 'wasm');

console.log('■ v2.28.5 End-to-End (echter App-Filter, echte G1-Physik)');
for (const c of [
  { prompt: 'a person walks forward at a steady pace', seed: 7 },
  { prompt: 'a person dances energetically', seed: 7 },
]) {
  const out = await rt.generate({ prompt: c.prompt, seconds: 5, seed: c.seed });
  const motion = retargetToRobot(new ArdyClip(out), sim, () => {});
  const dt = 1 / motion.fps;
  const r0 = rates(motion.q, motion.n, dt);
  let yawJ0 = 0;
  for (let f = 1; f < motion.n; f++) yawJ0 = Math.max(yawJ0, Math.abs(motion.yaw[f] - motion.yaw[f - 1]));
  const pf = smoothMotionPhysics(motion);
  const r1 = rates(motion.q, motion.n, dt);
  let yawJ1 = 0;
  for (let f = 1; f < motion.n; f++) yawJ1 = Math.max(yawJ1, Math.abs(motion.yaw[f] - motion.yaw[f - 1]));
  const dr0 = null;
  console.log('\n  „' + c.prompt.slice(10, 21) + '” #' + c.seed + ':');
  console.log('    Raten rad/s  p50 ' + r0.p50.toFixed(1) + ' → ' + r1.p50.toFixed(1) +
    '  ·  p95 ' + r0.p95.toFixed(1) + ' → ' + r1.p95.toFixed(1) +
    '  ·  max ' + r0.max.toFixed(1) + ' → ' + r1.max.toFixed(1));
  console.log('    yawΔmax ' + (yawJ0 * 180 / Math.PI).toFixed(0) + '° → ' + (yawJ1 * 180 / Math.PI).toFixed(0) + '°  ·  pf=' + motion.pf);
  const d = driveTest('gefiltert', motion, 5);
  console.log('    Fahrtest (ideal-Tracker): ' + (d.fallT < 0 ? 'übertand' : 'Sturz ' + d.fallT.toFixed(2) + ' s') +
    ' · RMS ' + d.rms.toFixed(3) + ' rad · upzMin ' + d.upzMin.toFixed(2));
}
process.exit(0);
