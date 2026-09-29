// ═══════════════════════════════════════════════════════════
// feld_test.mjs — Tests für die neue App „Feld" (≥ v3.1.0)
//
// Beweisziele:
//  1. 3-Stufen-Semantik: Stufe 2 friert Experten BIT-GENAU ein,
//     Stufe 3 öffnet alles + LR ×0,25 + Glättung ×3
//  2. Verhalten: Trainer lernt Fake-Task (EMA-Reward steigt)
//  3. Tricks: autoLr / autoRollout / autoNoise wirken
//  4. Belohnung: Presets + Klemmen + rWx-Terme
//  5. Konsole: Mapping + Buttons
//  6. LAYA: getypte Entscheidungen (balance/walk/turn/recover)
//  7. ONNX: Bytes sind echtes ONNX (Mini-Parser), fp32/fp16/int8
//  8. Store: base64-Roundtrip bit-exakt, Policy-Parität
// ═══════════════════════════════════════════════════════════

import { APP_NAME, VERSION } from '../app/src/main/assets/www/js/feld/version.js';
import { PARAM_GROUPS, STAGE_GROUPS, STAGE_LR, STAGE_SMOOTH, FeldMoE } from '../app/src/main/assets/www/js/feld/moe.js';
import { FeldTrainer } from '../app/src/main/assets/www/js/feld/trainer.js';
import { RewModel, RwxModel, RW_FIELDS, PRESETS } from '../app/src/main/assets/www/js/feld/rewards.js';
import { Console } from '../app/src/main/assets/www/js/feld/console.js';
import { LayaRouter, LAYA_SKILLS, layaInput } from '../app/src/main/assets/www/js/feld/laya.js';
import { moeToOnnx, EXPORT_FORMATS } from '../app/src/main/assets/www/js/feld/onnxexport.js';
import * as store from '../app/src/main/assets/www/js/feld/store.js';
import { SoftMoEPolicy, PPO } from '../app/src/main/assets/www/js/train.js';
import { RNG } from '../app/src/main/assets/www/js/math.js';

let pass = 0, fail = 0;
const FAILS = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; FAILS.push(name); console.log('  ✗ ' + name); }
}
function sec(s) { console.log('\n── ' + s + ' ──'); }

// ════════════════ 1 · VERSION ════════════════
sec('VERSION');
ok(APP_NAME === 'Feld', 'App-Name = Feld');
ok(VERSION === '3.1.0', 'VERSION = 3.1.0');

// ════════════════ 2 · STUFEN (FeldMoE) ════════════════
sec('STUFEN — Freeze-Semantik');
const net = new SoftMoEPolicy(74, 14, new RNG(7), { E: 4 });
const moe = new FeldMoE(net);
ok(moe.obsDim === 74 && moe.actDim === 14, 'SoftMoE 74 Obs × 14 Aktionen (MicroDuck)');
ok(JSON.stringify(STAGE_GROUPS[1].concat(['value', 'std']).sort()) === JSON.stringify(['decoder', 'encoder', 'experts', 'std', 'value']),
  'Stufe 1: Encoder+Experten+Decoder (+value/std)');
ok(STAGE_GROUPS[2].length === 1 && STAGE_GROUPS[2][0] === 'router', 'Stufe 2: NUR Router');
ok(STAGE_LR[3] === 0.25 && STAGE_SMOOTH[3] === 3, 'Stufe 3: LR ×0,25 · Glättung ×3');

const fp = (names) => moe.groupFingerprint(names);
const G_ALL = ['encoder', 'router', 'experts', 'decoder', 'style', 'value', 'std'];
const snap = {};
const snapAll = () => { for (const g of G_ALL) snap[g] = fp([g]); };
snapAll();
moe.stage = 1;
// ein paar Trainingsschritte auf Stufe 1 (Gradienten simulieren)
for (const n of net.pNames) { const g = net['g' + n]; for (let i = 0; i < g.length; i++) g[i] = (i % 7 - 3) * 1e-4; }
moe.stepGroups(3e-4, 1);
for (const g of ['encoder', 'experts', 'decoder', 'value', 'std']) ok(fp([g]) !== snap[g], 'Stufe 1 ändert ' + g);
ok(fp(['router']) === snap['router'], 'Stufe 1 FRIERT router');
snapAll();
moe.stepGroups(3e-4, 2);
ok(fp(['router']) !== snap['router'], 'Stufe 2 ändert router');
for (const g of ['encoder', 'experts', 'decoder', 'style']) ok(fp([g]) === snap[g], 'Stufe 2 FRIERT ' + g);
snapAll();
const r3 = moe.stepGroups(3e-4, 3);
ok(Math.abs(r3.lr - 3e-4 * 0.25) < 1e-12, 'Stufe 3: effektive LR = lr × 0,25');
for (const g of G_ALL) ok(fp([g]) !== snap[g], 'Stufe 3 ändert ' + g);

// ════════════════ 3 · TRAINER — VERHALTEN ════════════════
sec('TRAINER — Verhaltensnachweis (Fake-Task)');
function fakeTask() {
  const CMD = 13, obsDim = 3 + CMD, actDim = 3;
  let phase = 0, t = 0;
  return {
    kind: 'speed', obsDim, actDim, expertNames: ['e0', 'e1', 'e2', 'e3'],
    stepsLeft: 0, lastAct: new Float64Array(actDim),
    _routeW: new Float64Array(4), _routePen: 0,
    cfg: { rW: { route: 0.15, smooth: 0.01 } },
    sampleCmd() { },
    setRouting(w) {
      let pen = 0;
      for (let i = 0; i < 4; i++) { const d = w[i] - this._routeW[i]; pen += d * d; }
      this._routePen = pen; this._routeW.set(w);
    },
    observe(sim, out) {
      out[0] = Math.sin(phase); out[1] = Math.cos(phase); out[2] = phase % 1;
      for (let i = 3; i < obsDim; i++) out[i] = 0;
      out[3] = 0.1; out[3 + 3] = 1; out[3 + 7] = 1;
    },
    actionToCtrl(sim, a) { sim.ctrl.set(a); },
    reward(sim) {
      const err = Math.abs(sim.ctrl[0] - Math.sin(phase));
      t++; phase += 0.06;
      let done = t >= 60;
      if (done) t = 0;
      return { r: 1 - err, done };
    },
    afterAct(sim, a) { for (let i = 0; i < actDim; i++) this.lastAct[i] = a[i]; },
    reset(rng, sim) { phase = 0; t = 0; },
  };
}
const fakeSim = { stepN() { }, reset() { }, ctrl: new Float64Array(3) };
const task = fakeTask();
const tr = new FeldTrainer(task, fakeSim, { seed: 12345, hyper: { T: 256, mb: 128, epochs: 3 } });
ok(tr.ppo.net.kind === 'moe' && tr.ppo.net.E === 4, 'Trainer nutzt Soft-MoE (4 Experten)');
tr.tricks.on = false; // erst ohne Tricks: reines Lernen
let updates = 0, hit50 = -1;
for (let i = 0; i < 60000 && updates < 60; i++) {
  if (tr.stepOnce()) {
    updates++;
    if (hit50 < 0 && tr.emaEpR > 45) hit50 = updates;
  }
}
ok(updates >= 40, 'PPO-Updates laufen: ' + updates);
// Lernnachweis OHNE Trainingsrauschen: deterministische mu-Ausgabe trifft sin(phase)
let errSum = 0, n2 = 0;
for (let k = 0; k < 24; k++) {
  const ph = (k * 0.145) % 3.5; // im Trainingsbereich (Episoden 0…3,6 rad)
  const obs = new Float32Array(task.obsDim);
  obs[0] = Math.sin(ph); obs[1] = Math.cos(ph); obs[2] = ph % 1;
  obs[3] = 0.1; obs[6] = 1; obs[10] = 1;
  const a = tr.ppo.act(obs, true);
  errSum += Math.abs(a.act[0] - Math.sin(ph)); n2++;
}
const detErr = errSum / n2;
ok(detErr < 0.3, 'POLITIK LERNT: deterministischer Fehler |mu−sin| = ' + detErr.toFixed(3) + ' < 0,3 (Zufall ≈ 0,64)');
ok(tr.emaEpR > 26, 'EMA ' + tr.emaEpR.toFixed(1) + ' über Zufalls-Niveau ≈ 22 (σ-Rauschen begrenzt die Summe bei ≈ 30)');

// Stufe 2 an der echten Task: Experten-Freeze während Training
sec('STUFE 2 im Trainer — Experten bleiben bitgleich');
const task2 = fakeTask();
const tr2 = new FeldTrainer(task2, fakeSim, { seed: 99, hyper: { T: 256, mb: 128, epochs: 3 } });
tr2.setStage(2);
const net2 = tr2.ppo.net;
const fpOf = (p) => { let h = 0; for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + ((p[i] * 1e6) | 0)) | 0; return h; };
const expBefore = fpOf(net2.EW1) ^ fpOf(net2.EW2) ^ fpOf(net2.Eb1) ^ fpOf(net2.Eb2);
const encBefore = fpOf(net2.W1) ^ fpOf(net2.W2);
for (let i = 0; i < 3000 && tr2.updates < 4; i++) tr2.stepOnce();
const expAfter = fpOf(net2.EW1) ^ fpOf(net2.EW2) ^ fpOf(net2.Eb1) ^ fpOf(net2.Eb2);
const encAfter = fpOf(net2.W1) ^ fpOf(net2.W2);
const rtBefore = fpOf(net2.Wr1) ^ fpOf(net2.Wr2);
ok(expBefore === expAfter, 'Stufe 2 (4 Updates): Experten bitgleich');
ok(encBefore === encAfter, 'Stufe 2 (4 Updates): Encoder bitgleich');
ok(rtBefore !== fpOf(net2.Wr1) ^ fpOf(net2.Wr2), 'Stufe 2 (4 Updates): Router geändert');
// Stufe 3: Glättung im Task-cfg
task2.cfg.rW.route = 0.15; task2.cfg.rW.smooth = 0.01;
tr2.rWBase = { route: 0.15, smooth: 0.01 };
tr2.setStage(3);
ok(Math.abs(task2.cfg.rW.route - 0.45) < 1e-9 && Math.abs(task2.cfg.rW.smooth - 0.03) < 1e-9,
  'Stufe 3: rW.route ×3 und rW.smooth ×3 im Task wirksam');

// ════════════════ 4 · TRICKS ════════════════
sec('TRICKS — adaptive Lernrate/Rollout/Rauschen');
const task3 = fakeTask();
const tr3 = new FeldTrainer(task3, fakeSim, { seed: 5 });
const t3 = tr3.tricks;
t3.on = true; t3.autoLr = true; t3.autoRollout = true; t3.autoNoise = true;
const lr0 = tr3.hyper.lr, T0 = tr3.hyper.T;
const std0 = tr3._meanStd();
// Erfolgs-Trend erzwingen: EMA-Historie steil steigend
tr3.emaEpR = 10; tr3.trendHist = [1, 2, 3, 10];
let m3 = tr3._applyTricks({ clipFrac: 0.1 });
ok(tr3.hyper.lr > lr0, 'autoLr: Erfolg → LR steigt (' + lr0.toExponential(1) + ' → ' + tr3.hyper.lr.toExponential(1) + ')');
ok(tr3.hyper.T > T0, 'autoRollout: Erfolg → T steigt (' + T0 + ' → ' + tr3.hyper.T + ')');
ok(tr3._meanStd() < std0, 'autoNoise: Erfolg → σ sinkt');
// Misserfolgs-Trend (2 aufeinanderfolgende schwache Updates nötig)
const lr1 = tr3.hyper.lr, T1 = tr3.hyper.T;
tr3.trendHist = [10, 8, 6, 4]; tr3.emaEpR = 4;
let m4 = tr3._applyTricks({ clipFrac: 0.05 });
let m4b = tr3._applyTricks({ clipFrac: 0.05 });
ok(tr3.hyper.lr < lr1, 'autoLr: Misserfolg (2× Trend<0) → LR sinkt');
ok(tr3.hyper.T < T1, 'autoRollout: Misserfolg → T sinkt');
const std1 = tr3._meanStd();
tr3.trendHist = [10, 8, 6, 4]; // frischer sinkender Trend
tr3._applyTricks({ clipFrac: 0.05 });
ok(tr3._meanStd() > std1, 'autoNoise: Misserfolg → σ steigt (mehr Exploration)');
ok(tr3.hyper.T >= t3.TMin && tr3.hyper.T <= t3.TMax, 'T bleibt im Band 512…4096');
ok(tr3.hyper.lr >= t3.lrMin && tr3.hyper.lr <= t3.lrMax, 'LR bleibt im Band');

// ════════════════ 5 · BELohnung ════════════════
sec('BELohnung — Presets, Klemmen, Terme');
const base = { vel: 0.25, yaw: 0.05, up: 0.12, alive: 0.06, energy: 0.0002, smooth: 0.01, jlimit: 0.05, fall: 0.5, height: 0.5, foot: 0.02, route: 0.15, recover: 0.1, imit: 0.6 };
const rm = new RewModel(base);
ok(RW_FIELDS.length === 13, '13 rW-Felder vorhanden');
rm.applyPreset('aufstehen');
ok(rm.recover === 0.9 && rm.fall === 0.05, 'Preset aufstehen: recover 0,9 · fall 0,05');
const s2 = JSON.stringify(new RewModel(base).applyPreset('stehen') === null ? {} : {});
const rm2 = new RewModel(base); rm2.applyPreset('stehen');
const rm3 = new RewModel(base); rm3.applyPreset('gehen');
ok(rm2.foot > rm3.foot && rm2.energy > rm3.energy, 'Preset stehen ≠ gehen (Fuß-Ruhe/Energie)');
rm.vel = 99; rm.sanitize();
ok(rm.vel === 2, 'Klemme auf max 2');
const rwx = new RwxModel(null);
const tGo = rwx.add('goTo', { x: 1, y: 2, tol: 0.4 });
ok(tGo && tGo.w === 0.5 && rwx.on === 1, 'rWx: goTo hinzugefügt (w default 0,5)');
const tFace = rwx.add('faceYaw', { yaw: 9 });
ok(Math.abs(tFace.yaw) <= Math.PI, 'rWx: faceYaw-Winkel normalisiert (−π, π]');
rwx.remove(0);
ok(rwx.terms.length === 1 && rwx.terms[0].kind === 'faceYaw', 'rWx: Term entfernt');

// ════════════════ 6 · KONSOLE ════════════════
sec('KONSOLE — Mapping und Buttons');
const kon = new Console(null, {});
kon.setAnalog(0, -1, 0.5, 0); // links voll vorwärts, rechts halb rechts
const c = kon.commands();
ok(Math.abs(c.vx - 1) < 1e-9, 'Joystick hoch → vx +1 (vorwärts)');
ok(Math.abs(c.wz + 0.5) < 1e-9, 'Joystick rechts → wz −0,5 (Lenkrad)');
kon.setAnalog(-1, 1, 0, 0);
ok(kon.commands().vy === -1, 'Joystick links → vy −1 (seitlich)');
let btnIdx = -1;
kon.onButton = (i) => { btnIdx = i; };
kon.press(2);
ok(btnIdx === 2, 'Button C (AUFSTEHEN) feuert onButton');
ok(kon.buttons.every((b) => b === 0), 'Buttons sind Momentaufnahmen (nach press wieder 0)');
ok(kon.driveActive === false, 'Konsole default AUS (Training unangetastet)');

// ════════════════ 7 · LAYA ════════════════
sec('LAYA — System-1-Entscheidungen');
const lr = new LayaRouter({ temp: 1.8 });
const dRec = lr.decide({ upz: 0.1, vFwd: 0, yawRate: 0, cmdVx: 0, cmdWz: 0, fallen: true, hGTol: 0.1 });
ok(dRec.skill === 'recover' && dRec.p > 0.6, 'liegend → recover (p=' + dRec.p.toFixed(2) + ')');
const dWalk = lr.decide({ upz: 0.9, vFwd: 0.05, yawRate: 0, cmdVx: 0.25, cmdWz: 0, fallen: false, hGTol: 0 });
ok(dWalk.skill === 'walk', 'Fahrt-Befehl → walk');
const dTurn = lr.decide({ upz: 0.9, vFwd: 0, yawRate: 0.3, cmdVx: 0, cmdWz: 0.8, fallen: false, hGTol: 0 });
ok(dTurn.skill === 'turn', 'Dreh-Befehl → turn');
const dBal = lr.decide({ upz: 0.9, vFwd: 0, yawRate: 0, cmdVx: 0, cmdWz: 0, fallen: false, hGTol: 0 });
ok(dBal.skill === 'balance', 'aufrecht ohne Befehl → balance');
ok(dBal.w.length === 4 && Math.abs(dBal.w.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'Skill-Hinweis = Wahrscheinlichkeitsvektor (Σ=1)');
const inp = layaInput(dBal && { upz: 0.9, vFwd: 0.2, yawRate: 1, cmdVx: 0.3, cmdWz: -1, fallen: false, hGTol: 0.2 });
ok(inp.length === 7 && inp.every((v) => Number.isFinite(v) && v >= -1 && v <= 1), 'Laya-Eingabe: 7 normierte Werte');
// Hysterese direkt an der Softmax-Entscheidung (kalibriert, System 1)
lr.temp = 1.6; lr.hyst = 0.08;
lr._lastIdx = 1; // „walk“ geführt
const hNear = lr._softmaxTyped([1.0, 0.95, 0, 0]);
ok(hNear.skill === 'walk', 'Hysterese: knapp zweitbester Skill bleibt geführt (walk)');
lr._lastIdx = 1;
const hFar = lr._softmaxTyped([2.0, 0.0, 0, 0]);
ok(hFar.skill === 'balance', 'Hysterese: klar bester Skill übernimmt (balance)');

// ════════════════ 8 · ONNX ════════════════
sec('ONNX — echte Protobuf-Bytes (fp32/fp16/int8)');
function readFields(bytes) {
  const out = []; let p = 0;
  while (p < bytes.length) {
    let key = 0, shift = 0, b;
    do { b = bytes[p++]; key |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const f = key >>> 3, wt = key & 7;
    if (wt === 0) { let v = 0n, s = 0n; do { b = bytes[p++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); out.push([f, wt, v]); }
    else if (wt === 2) { let len = 0, sh = 0; do { b = bytes[p++]; len |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80); out.push([f, wt, bytes.subarray(p, p + len)]); p += len; }
    else throw new Error('wt ' + wt);
  }
  return out;
}
const byName = (fs, f) => fs.filter((x) => x[0] === f);
const m32 = moeToOnnx(net, { format: 'fp32' });
ok(m32.ops > 40 && m32.bytes.length > 200000, 'fp32: ' + m32.ops + ' Knoten, ' + m32.bytes.length + ' Bytes');
const mf = readFields(m32.bytes);
const graphF = byName(mf, 7);
ok(graphF.length === 1, 'ModelProto: graph (Feld 7) genau 1×');
const g = readFields(graphF[0][2]);
const nodesF = byName(g, 1), initsF = byName(g, 5), inF = byName(g, 11), outF = byName(g, 12);
ok(byName(g, 2).length === 1 && new TextDecoder().decode(byName(g, 2)[0][2]) === 'feld_policy', 'Graphname feld_policy');
ok(initsF.length >= 20, 'Initializer: ' + initsF.length);
ok(inF.length === 1 && new TextDecoder().decode(readFields(inF[0][2])[0][2]) === 'obs', 'Eingang: obs');
ok(outF.length >= 1 && new TextDecoder().decode(readFields(outF[0][2])[0][2]) === 'mu', 'Ausgang: mu');
// enc1-Wert verifizieren (fp32)
let enc1 = null;
for (const [, , tb] of initsF) {
  const tf = readFields(tb);
  const nm = byName(tf, 8)[0][2];
  if (new TextDecoder().decode(nm) === 'enc1') {
    const dtv = Number(byName(tf, 2)[0][2]);
    const dims = byName(tf, 1).map((x) => Number(x[2]));
    const raw = byName(tf, 9)[0][2];
    enc1 = { dtv, dims, raw };
  }
}
ok(!!enc1 && enc1.dtv === 1, 'enc1 ist FLOAT (dt=1)');
ok(enc1.dims[0] === 128 && enc1.dims[1] === 74, 'enc1-Dims [128,74] (out,in-Layout für transB-Gemm)');
const f0 = new Float32Array(enc1.raw.slice(0, 4).buffer)[0];
ok(Math.abs(f0 - net.W1[0]) < 1e-9, 'enc1[0] == W1[0] (transponiert korrekt gepackt)');
// fp16
const m16 = moeToOnnx(net, { format: 'fp16' });
const g16 = readFields(byName(readFields(m16.bytes), 7)[0][2]);
let fp16ok = false;
for (const [, , tb] of byName(g16, 5)) {
  const tf = readFields(tb);
  const nmf = byName(tf, 8), dtf = byName(tf, 2);
  if (nmf.length && dtf.length && new TextDecoder().decode(nmf[0][2]) === 'enc1' && Number(dtf[0][2]) === 10) fp16ok = true;
}
ok(fp16ok && m16.bytes.length < m32.bytes.length * 0.75, 'fp16: enc1 ist FLOAT16 und ~halbe Größe (' + m16.bytes.length + ' B)');
// int8
const m8 = moeToOnnx(net, { format: 'int8' });
const g8 = readFields(byName(readFields(m8.bytes), 7)[0][2]);
let int8cnt = 0, deqcnt = 0;
for (const [, , tb] of byName(g8, 5)) {
  const tf = readFields(tb);
  const dtf = byName(tf, 2);
  if (dtf.length && Number(dtf[0][2]) === 3) int8cnt++;
}
for (const [, , nb] of byName(g8, 1)) {
  const nf = readFields(nb);
  const opf = byName(nf, 4);
  if (opf.length && new TextDecoder().decode(opf[0][2]) === 'DequantizeLinear') deqcnt++;
}
ok(int8cnt >= 10, 'int8: ' + int8cnt + ' int8-Tensoren (Gewichte quantisiert)');
ok(deqcnt >= 10, 'int8: ' + deqcnt + ' DequantizeLinear-Knoten');
ok(m8.bytes.length < m32.bytes.length * 0.6, 'int8 deutlich kleiner als fp32');
// Norm-Variante + valueHead
const mn = moeToOnnx(net, { format: 'fp32', norm: { mean: new Array(74).fill(0), std: new Array(74).fill(1) }, valueHead: true });
const outs = readFields(byName(readFields(mn.bytes), 7)[0][2]).filter((x) => x[0] === 12);
ok(outs.length === 2, 'mit valueHead: 2 Ausgänge (mu + val)');

// ════════════════ 9 · STORE ════════════════
sec('STORE — base64 + Policy-Parität');
const arr = new Float32Array(257);
for (let i = 0; i < arr.length; i++) arr[i] = Math.sin(i) * 1e3;
const back = store.b64ToF32(store.f32ToB64(arr));
ok(back.length === arr.length && back.every((v, i) => v === arr[i]), 'f32↔base64 bit-exakt (257 Werte)');
const pj = store.policyToJSON({ net, norm: { mean: new Float32Array(74), M2: new Float32Array(74).fill(1), count: 42 } });
const x1 = new Float32Array(74); for (let i = 0; i < 74; i++) x1[i] = Math.sin(i);
const muBefore = net.forward(x1, x1).slice();
const rNet = store.policyFromJSON(pj, SoftMoEPolicy, RNG);
const muAfter = rNet.net.forward(x1, x1).slice();
ok(muBefore.every((v, i) => Math.abs(v - muAfter[i]) < 1e-12), 'Policy-Roundtrip: forward bitgleich');
ok(rNet.norm.count === 42, 'Norm-Zähler erhalten');

// ════════════════ ZUSAMMEN ════════════════
console.log('\n════════════════════════════════');
console.log('ERGEBNIS: ' + pass + ' bestanden · ' + fail + ' fehlgeschlagen');
if (fail) { console.log('FEHLSCHLÄGE:'); FAILS.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
