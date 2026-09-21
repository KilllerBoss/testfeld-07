// ═══════════════════════════════════════════════════════════
// ardy_side_test.mjs — v2.28.9 SEITEN-REPARATUR (Report E):
// „Beine und Hände nicht am Skelett … überkreuzen sich … Policy an Geist?
//  Der Geist sollte rohe Ausgabe von ardy sein."
//
// Wurzel: der v2.28.4er X-Spiegel beruhte auf einem Kreuzprodukt-Fehler
// („right = up × drift" ist anatomisch LINKS; korrekt ist right = fwd × up)
// und vertauschte seitdem Links/Rechts in JEDER ARDY-Generierung.
//
// Beweise:
//   1) FK-Beweis mirrorMotionY (ECHTE G1-Sim, kein ONNX nötig): Für zufällige
//      q-Konfigurationen gilt FK(mirror(q)) = Y-Spiegel(FK(q)) über ALLE
//      Körper (Positionen + Quats) — die Migration ist exakt, nicht geraten.
//   2) Involution: doppelte Anwendung = Original (q/srcPos/root/yaw/baseQ).
//   3) mv-Marker: Anwendung setzt motion.mv = ARDY_MV (2) — packMotion/
//      unpackMotion tragen ihn (Migration läuft nur EINMAL).
//   4) Real-Pin (decoder.onnx): frisch generiertes idle → linke Rollen liegen
//      auf MJC-+y (Roboter-links) und shoulder_yaw bleibt verankert
//      (< 0,25 rad Range — Soft-Twist-Anker wirkt).
// Usage: node scripts/ardy_side_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { strict as assert } from 'node:assert';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const ARDY = path.join(ROOT, 'scripts/ardy');

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const { ARDY_MV, mirrorMotionY } = await import(path.join(WWW, 'js/retarget.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));

console.log('\n[1] Struktur + Persistenz');
await ok('ARDY_MV = 2 (Pipeline-Version nach Spiegel-Abschaltung)', () => assert.equal(ARDY_MV, 2));
await ok('mirrorMotionY exportiert', () => assert.equal(typeof mirrorMotionY, 'function'));
await ok('packMotion/unpackMotion tragen mv', () => {
  const m = { q: [0, 0], h: [1], fps: 20, n: 1, nu: 2, mv: 7 };
  const p = packMotion(m);
  assert.equal(p.mv, 7);
  const u = unpackMotion(p);
  assert.equal(u.mv, 7);
  assert.equal(unpackMotion({ q: [0], h: [1], n: 1, nu: 1 }).mv, 0, 'alter Bestand: mv=0');
});

// ── Echte G1-Sim (mujoco.wasm + Modelle liegen im Repo) ─────
console.log('\n[2] FK-Beweis mirrorMotionY an der echten G1-Sim');
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
const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_side_test.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_side_test.xml');

// deterministischer Zufall
let _s = 20260921 >>> 0;
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
const NFR = 4;
const nu = sim.nu;
const mkMotion = () => {
  const q = new Float32Array(NFR * nu);
  for (let f = 0; f < NFR; f++) {
    for (let a = 0; a < nu; a++) {
      const lo = sim.actRange[2 * a], hi = sim.actRange[2 * a + 1];
      q[f * nu + a] = lo + rnd() * (hi - lo);
    }
  }
  const baseQ = new Float32Array(NFR * 4);
  for (let f = 0; f < NFR; f++) {
    const yaw = (rnd() - 0.5) * 2, roll = (rnd() - 0.5) * 0.6, pitch = (rnd() - 0.5) * 0.6;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    // ZYX-Komposition → xyzw
    baseQ[4 * f] = sr * cp * cy - cr * sp * sy;
    baseQ[4 * f + 1] = cr * sp * cy + sr * cp * sy;
    baseQ[4 * f + 2] = cr * cp * sy - sr * sp * cy;
    baseQ[4 * f + 3] = cr * cp * cy + sr * sp * sy;
  }
  const root = new Float32Array(NFR * 2);
  for (let f = 0; f < NFR; f++) { root[2 * f] = rnd() * 2 - 1; root[2 * f + 1] = rnd() * 2 - 1; }
  const yaw = new Float32Array(NFR); for (let f = 0; f < NFR; f++) yaw[f] = rnd() * 2 - 1;
  // srcPos: 27-Rollen-Layout mit Pseudo-Positionen
  const srcJoints = ['hips', 'spine', 'spine1', 'spine2', 'spine3', 'neck', 'head',
    'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand', 'rightHandEnd', 'rightHandThumb1',
    'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand', 'leftHandEnd', 'leftHandThumb1',
    'rightUpLeg', 'rightLeg', 'rightFoot', 'rightToeBase',
    'leftUpLeg', 'leftLeg', 'leftFoot', 'leftToeBase'];
  const srcPos = new Float32Array(NFR * 27 * 3);
  for (let i = 0; i < srcPos.length; i++) srcPos[i] = rnd() * 1.2 - 0.6;
  const h = new Float32Array(NFR); for (let f = 0; f < NFR; f++) h[f] = 0.7 + rnd() * 0.2;
  return { n: NFR, nu, q, baseQ, root, yaw, srcPos, srcJoints, h, fps: 20 };
};
const copyMotion = (m) => ({
  n: m.n, nu: m.nu, fps: m.fps, srcJoints: m.srcJoints.slice(),
  q: Float32Array.from(m.q), baseQ: Float32Array.from(m.baseQ),
  root: Float32Array.from(m.root), yaw: Float32Array.from(m.yaw),
  srcPos: Float32Array.from(m.srcPos), h: Float32Array.from(m.h),
});
const mirrorQuatY = (w, x, y, z) => [w, -x, y, -z]; // MuJoCo (w,x,y,z)-Konvention

await ok('FK(mirror(q)) = Y-Spiegel(FK(q)) über alle Körper (Pos + Quat, Seiten-Paarung)', () => {
  const A = mkMotion();        // wird gespiegelt
  const B = copyMotion(A);     // Referenz (unspiegelt)
  assert.equal(mirrorMotionY(A, sim), true, 'mirrorMotionY meldet keine Anwendung');
  const gA = sim.makeGhostData(), gB = sim.makeGhostData();
  // Der Spiegel mappt die KONFIGURATION auf die gespiegelte Konfiguration
  // desselben Roboters: der linke Körper spielt künftig, was der rechte
  // spielte (gespiegelt). Vergleichspaare also left↔right (per Name),
  // Mittel-Körper mit sich selbst.
  const mjName = (b) => { try { return sim._mjApi.mj_id2name(sim.model, 1, b); } catch (e) { return null; } };
  const nameOf = []; for (let b = 0; b < sim.nbody; b++) nameOf.push(mjName(b) || String(b));
  const pairOf = nameOf.map((nm) => {
    if (/^left/.test(nm)) return nameOf.indexOf(nm.replace(/^left/, 'right'));
    if (/^right/.test(nm)) return nameOf.indexOf(nm.replace(/^right/, 'left'));
    return nameOf.indexOf(nm);
  });
  let maxPosErr = 0, minQuatDot = 1, worstBody = '';
  // ACHTUNG: makeGhostData() liefert eine GECACHTE Singleton-Instanz —
  // gA und gB wären dasselbe Objekt! Daher: Pose nach JEDEM setGhostPose
  // sofort in lokale Puffer kopieren (wie die fk()-Helfer der Diags).
  const posB = new Float64Array(3 * sim.nbody), quatB = new Float64Array(4 * sim.nbody);
  for (let f = 0; f < NFR; f++) {
    sim.setGhostPose(gB, B.q, f * nu, B.h[f], 0, 0, 0, null);
    posB.set(gB.xpos); quatB.set(gB.xquat);
    sim.setGhostPose(gA, A.q, f * nu, A.h[f], 0, 0, 0, null);
    for (let b = 1; b < sim.nbody; b++) {
      const pb = pairOf[b];
      const bx = posB[3 * pb], by = posB[3 * pb + 1], bz = posB[3 * pb + 2];
      const ax = gA.xpos[3 * b], ay = gA.xpos[3 * b + 1], az = gA.xpos[3 * b + 2];
      const e = Math.max(Math.abs(ax - bx), Math.abs(ay + by), Math.abs(az - bz));
      if (e > maxPosErr) { maxPosErr = e; worstBody = nameOf[b] + '↔' + nameOf[pb]; }
      // Quats: A[b] = Spiegel von B[pair(b)] → (w,−x,y,−z); q ≡ −q
      const qw = [gA.xquat[4 * b], gA.xquat[4 * b + 1], gA.xquat[4 * b + 2], gA.xquat[4 * b + 3]];
      const mr = mirrorQuatY(quatB[4 * pb], quatB[4 * pb + 1], quatB[4 * pb + 2], quatB[4 * pb + 3]);
      let d = qw[0] * mr[0] + qw[1] * mr[1] + qw[2] * mr[2] + qw[3] * mr[3];
      if (d < 0) d = -d; // q ≡ −q
      const dev = 1 - d;
      if (dev > (minQuatDot === 1 ? -1 : minQuatDot)) minQuatDot = dev;
    }
  }
  assert.ok(maxPosErr < 2e-4, 'max Positionsfehler ' + maxPosErr.toExponential(2) + ' m an ' + worstBody);
  assert.ok(minQuatDot < 1e-5, 'max Quat-Winkelfehler ' + minQuatDot.toExponential(2));
});
await ok('Regeln: baseQ (x,y,z,w)→(−x,y,−z,w) · yaw → −yaw · root.y → −y · srcPos.y → −y', () => {
  const A = mkMotion();
  const q0 = Float32Array.from(A.q), bq0 = Float32Array.from(A.baseQ);
  const y0 = Float32Array.from(A.yaw), r0 = Float32Array.from(A.root), s0 = Float32Array.from(A.srcPos);
  mirrorMotionY(A, sim);
  for (let f = 0; f < NFR; f++) {
    assert.ok(Math.abs(A.baseQ[4 * f] + bq0[4 * f]) < 1e-9 && Math.abs(A.baseQ[4 * f + 1] - bq0[4 * f + 1]) < 1e-9 &&
      Math.abs(A.baseQ[4 * f + 2] + bq0[4 * f + 2]) < 1e-9 && Math.abs(A.baseQ[4 * f + 3] - bq0[4 * f + 3]) < 1e-9, 'baseQ f' + f);
    assert.ok(Math.abs(A.yaw[f] + y0[f]) < 1e-9, 'yaw f' + f);
    assert.ok(Math.abs(A.root[2 * f] - r0[2 * f]) < 1e-9 && Math.abs(A.root[2 * f + 1] + r0[2 * f + 1]) < 1e-9, 'root f' + f);
  }
  for (let i = 0; i < s0.length; i += 3) {
    assert.ok(Math.abs(A.srcPos[i] - s0[i]) < 1e-9 && Math.abs(A.srcPos[i + 1] + s0[i + 1]) < 1e-9 && Math.abs(A.srcPos[i + 2] - s0[i + 2]) < 1e-9, 'srcPos ' + i);
  }
  assert.ok(Math.abs(A.q[0] - q0[0]) > 0 || Math.abs(A.q[nu] - q0[nu]) > 0, 'q wurde verändert (Spiegel aktiv)');
});
await ok('Involution: zweifache Anwendung = Original', () => {
  const A = mkMotion();
  const ref = copyMotion(A);
  mirrorMotionY(A, sim);
  mirrorMotionY(A, sim);
  for (let i = 0; i < ref.q.length; i++) assert.ok(Math.abs(A.q[i] - ref.q[i]) < 1e-6, 'q ' + i);
  for (let i = 0; i < ref.srcPos.length; i++) assert.ok(Math.abs(A.srcPos[i] - ref.srcPos[i]) < 1e-6, 'srcPos ' + i);
  for (let f = 0; f < NFR; f++) {
    assert.ok(Math.abs(A.baseQ[4 * f] - ref.baseQ[4 * f]) < 1e-6, 'baseQ x f' + f);
    assert.ok(Math.abs(A.yaw[f] - ref.yaw[f]) < 1e-6, 'yaw f' + f);
    assert.ok(Math.abs(A.root[2 * f + 1] - ref.root[2 * f + 1]) < 1e-6, 'root y f' + f);
  }
});
await ok('Marker: motion.mv = ARDY_MV nach Anwendung · pack/unpack erhält ihn', () => {
  const A = mkMotion();
  assert.equal(A.mv, undefined);
  mirrorMotionY(A, sim);
  assert.equal(A.mv, ARDY_MV);
  const u = unpackMotion(packMotion(A));
  assert.equal(u.mv, ARDY_MV);
});
await ok('Guards: leere/defekte Motionen werden abgelehnt (keine Anwendung)', () => {
  assert.equal(mirrorMotionY(null, sim), false);
  assert.equal(mirrorMotionY({ q: new Float32Array(6), n: 2, nu: 3 }, null), false);
  assert.equal(mirrorMotionY({ q: new Float32Array(5), n: 2, nu: 3 }, sim), false);
});

// ── Real-Pin: frische Generierung ist seitenrichtig + Anker wirkt ──
console.log('\n[3] Real-Pin (decoder.onnx): idle seitenrichtig + Schulter-Anker');
{
  const decPath = path.join(ARDY, 'decoder.onnx');
  if (!existsSync(decPath)) {
    console.log('  ⚠ decoder.onnx fehlt (gitignored) — Real-Pin übersprungen (lokal: scripts/ardy laden)');
  } else {
    const { createRequire } = await import('node:module');
    const requireFromArdy = createRequire(path.join(ARDY, 'package.json'));
    const ort = requireFromArdy('onnxruntime-node');
    const { gunzipSync } = await import('node:zlib');
    const manifest = JSON.parse(readFileSync(path.join(ARDY, 'model.json'), 'utf8'));
    const sessions = {
      textEncoder: await ort.InferenceSession.create(path.join(ARDY, 'text_encoder.onnx')),
      denoiser: await ort.InferenceSession.create(path.join(ARDY, 'denoiser.onnx')),
      decoder: await ort.InferenceSession.create(decPath),
    };
    const tokJson = JSON.parse(gunzipSync(readFileSync(path.join(ARDY, 'tokenizer.json.gz'))));
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
    const { retargetToRobot, SRC_ROLES, smoothMotionPhysics } = await import(path.join(WWW, 'js/retarget.js'));
    const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
    console.log('  Generiere „a person stands still, idle" (Seed 7, 2 s) …');
    const out = await rt.generate({ prompt: 'a person stands still, idle', seconds: 2, seed: 7 });
    const motion = retargetToRobot(new ArdyClip(out), sim, () => {});
    smoothMotionPhysics(motion);
    const n = motion.n, nR = motion.srcJoints.length;
    const si = {}; motion.srcJoints.forEach((r, i) => { si[r] = i; });
    await ok('Linke Rollen liegen auf MJC-+y (Roboter-links) — Seiten korrekt', () => {
      let leftPos = 0, cnt = 0;
      for (const r of ['leftUpLeg', 'leftArm', 'leftFoot', 'leftHand', 'leftShoulder']) {
        if (si[r] === undefined) continue;
        cnt++;
        if (motion.srcPos[si[r] * 3 + 1] > 0) leftPos++;
      }
      assert.equal(leftPos, cnt, leftPos + '/' + cnt + ' linke Rollen auf +y');
    });
    await ok(' Schulter-Yaw verankert (Range < 0,25 rad — kein 45°-Drift mehr)', () => {
      const A = sim.actByName;
      for (const side of ['left', 'right']) {
        const nm = side + '_shoulder_yaw_joint';
        const a = A[nm];
        let mn = Infinity, mx = -Infinity;
        for (let f = 0; f < n; f++) { const v = motion.q[f * motion.nu + a]; if (v < mn) mn = v; if (v > mx) mx = v; }
        assert.ok(mx - mn < 0.25, nm + ' Range ' + (mx - mn).toFixed(3) + ' rad');
      }
    });
  }
}

console.log('\n═══ Ergebnis: ' + passed + ' bestanden, ' + failed + ' fehlgeschlagen ═══');
if (failed > 0) process.exit(1);
