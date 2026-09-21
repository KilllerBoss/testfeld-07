// Debug: lens/tLen/Körperpositionen im TransferBlock rekonstruieren
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import ort from 'onnxruntime-node';

const ROOT = '/home/z/my-project';
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const HERE = path.join(ROOT, 'scripts/ardy');
const manifest = JSON.parse(readFileSync(path.join(HERE, 'model.json'), 'utf8'));
const sessions = {
  textEncoder: await ort.InferenceSession.create(path.join(HERE, 'text_encoder.onnx')),
  denoiser: await ort.InferenceSession.create(path.join(HERE, 'denoiser.onnx')),
  decoder: await ort.InferenceSession.create(path.join(HERE, 'decoder.onnx')),
};
const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'tokenizer.json.gz'))));
const { ArdyRuntime, setOrtTensorClass } = await import(path.join(WWW, 'js/ardy.js'));
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
const wb = readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
await initEngine(() => {}, { wasmBinary: wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_dbg.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_dbg.xml');

const g0 = sim.makeGhostData();
sim._mjApi.mj_resetData(sim.model, g0);
sim._mjApi.mj_forward(sim.model, g0);
const pos0 = (b) => [g0.xpos[3 * b], g0.xpos[3 * b + 1], g0.xpos[3 * b + 2]];
const bid = (act) => sim.model.jnt_bodyid[sim.actJoint[sim.actByName[act]]];
const elbow = bid('left_elbow_joint');
console.log('elbow body:', elbow, pos0(elbow).map(v => v.toFixed(3)).join(','));
for (let b = 17; b <= 23; b++) {
  let nm = ''; try { nm = sim._mjApi.mj_id2name(sim.model, 1, b) || ''; } catch (e) {}
  console.log('  body', b, nm, pos0(b).map(v => v.toFixed(3)).join(','), 'parent:', sim.model.body_parentid[b]);
}
const childBodyOf = (b) => { for (let x = 1; x < sim.nbody; x++) if (sim.model.body_parentid[x] === b) return x; return -1; };
const wr = childBodyOf(elbow);
console.log('wrist (first child of elbow):', wr, pos0(wr).map(v => v.toFixed(3)).join(','));
const d = (b1, b2) => Math.hypot(pos0(b2)[0] - pos0(b1)[0], pos0(b2)[1] - pos0(b1)[1], pos0(b2)[2] - pos0(b1)[2]);
console.log('dist(shoulder_pitch 17 → elbow):', d(17, elbow).toFixed(4));
console.log('dist(parent_of_elbow → elbow):', d(sim.model.body_parentid[elbow], elbow).toFixed(4));
console.log('dist(elbow → wrist):', d(elbow, wr).toFixed(4));
