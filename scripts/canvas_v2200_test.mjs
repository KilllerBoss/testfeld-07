// canvas_v2200_test.mjs — v2.20.0: LOGIK-VERBINDER + STAPELVERBINDUNG + PORT-SICHT:
//   1) logicFold: alle Operatoren mathematisch nachgerechnet (add/sub/mul/div/min/max/abs/neg),
//      ÷0-Guard, NaN/∞-Guard, ±1e6-Klemme
//   2) addLogicNode: Klemmen (op-min nIn, Limits 1–16, Limit 16 Karten), nodeIn/OutCount
//   3) sanitizeGraph: Logik-Knoten überleben Roundtrip
//   4) policyOrder: Logik + Policy topologisch gemischt (Logik VOR abhängiger Policy)
//   5) buildPlanGraph: gemischte cards (Policy + Logik), Kabel durch Logik, Report kind
//   6) linkManyGraph: ok/fail-Sammlung
//   7) describe(): portsList (io/out JEDER Port mit used) + freeIn/freeOut je Karte
//   8) Board-Runtime an ECHTER MuJoCo-Sim (G1): io → LOGIK(add) → Policy → out,
//      Auswertung in topo-Ordnung, ctrl-Formel exakt, Training finit
//   9) Stapelverbindung (Langdruck-Logik ohne DOM): freie Ports wählen → andere Karte
//      verbinden, Überzählige bleiben frei, falsche Seite abgelehnt
//  10) Verdrahtung: main.js (linkMany/logic), ai.js (Whitelist), index.html (+Logik), CANVAS.md
// Usage: node scripts/canvas_v2200_test.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFile(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot, makeTrackTask } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const canvasMod = await import(path.join(WWW, 'js/canvas.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

if (!globalThis.localStorage) {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

// ── 1) logicFold ───────────────────────────────────────────
console.log('\n[1] logicFold — Operatoren + Guards');
{
  const f = canvasMod.logicFold;
  ok(near(f('add', [2, 3, 4]), 9), 'add: ((2+3)+4)=9');
  ok(near(f('sub', [10, 3, 2]), 5), 'sub: ((10−3)−2)=5');
  ok(near(f('mul', [2, 3, 4]), 24), 'mul: ((2·3)·4)=24');
  ok(near(f('div', [100, 5, 2]), 10), 'div: ((100/5)/2)=10');
  ok(f('div', [5, 0]) === 0 && f('div', [5, 1e-12]) === 0, 'div durch 0 → 0 (kein Infinity)');
  ok(near(f('min', [3, -2, 7]), -2), 'min: −2');
  ok(near(f('max', [3, -2, 7]), 7), 'max: 7');
  ok(near(f('abs', [-4.2, 99, -99]), 4.2), 'abs: unär |in0| (Rest ignoriert)');
  ok(near(f('neg', [3.5, 99]), -3.5), 'neg: unär −in0');
  ok(f('add', [NaN, 2]) === 2 && f('add', [1, Infinity]) === 1, 'NaN/∞-Eingänge → 0');
  ok(f('div', [5, 1e-9]) <= 1e6 && f('div', [5, 1e-9]) > 0, 'riesiges Ergebnis auf ±1e6 geklemmt', String(f('div', [5, 1e-9])));
  ok(f('mul', [1e300, 1e300]) === 0, '±∞-Ergebnis → 0 (nach Klemme-Reihenfolge)');
  ok(f('add', []) === 0, 'leere Eingaben → 0');
  ok(f('quatsch', [1, 2]) === 3, 'unbekannter Operator fällt auf add');
  ok(f('add', [1, '3', null]) === 4, 'String/Null-Eingänge werden zu Zahlen/0');
}

// ── 2) addLogicNode ────────────────────────────────────────
console.log('\n[2] addLogicNode — Klemmen + Portzahlen');
{
  const g = canvasMod.newGraph();
  const l1 = canvasMod.addLogicNode(g, { name: 'Mischer', op: 'add', nIn: 2, nOut: 1 });
  ok(l1.type === 'logic' && l1.op === 'add' && l1.nIn === 2 && l1.nOut === 1, 'Logik-Karte angelegt', JSON.stringify({ op: l1.op, nIn: l1.nIn, nOut: l1.nOut }));
  ok(canvasMod.nodeInCount(g, l1) === 2 && canvasMod.nodeOutCount(g, l1) === 1, 'nodeIn/OutCount');
  const l2 = canvasMod.addLogicNode(g, { op: 'abs' }); // unär → nIn darf 1
  ok(l2.nIn === 2 && l2.op === 'abs', 'abs ohne nIn → Default 2 erlaubt (unär nutzt in0)');
  const l3 = canvasMod.addLogicNode(g, { op: 'abs', nIn: 1 });
  ok(l3.nIn === 1, 'abs mit nIn=1 erlaubt (unär)');
  const l4 = canvasMod.addLogicNode(g, { op: 'add', nIn: 1 }); // add braucht min 2
  ok(l4.nIn === 2, 'add mit nIn=1 → auf Operator-Minimum 2 geklemmt');
  const l5 = canvasMod.addLogicNode(g, { op: 'unbekannt', nIn: 99, nOut: 99 });
  ok(l5.op === 'add' && l5.nIn === 16 && l5.nOut === 16, 'unbekannter op → add; nIn/nOut auf 16 geklemmt');
  let threw = false;
  try { for (let i = 0; i < 20; i++) canvasMod.addLogicNode(g, {}); } catch (e) { threw = true; ok(/Maximal 16/.test(e.message), 'Limit-Meldung', e.message); }
  ok(threw, 'Limit 16 Logik-Karten durchgesetzt');
}

// ── 3) Sanitize ────────────────────────────────────────────
console.log('\n[3] sanitizeGraph — Logik überlebt');
{
  const raw = { view: { z: 0.9 }, nodes: [{ id: 'io' }, { id: 'out', sink: [] }, { type: 'logic', name: 'M', op: 'mul', nIn: 3, nOut: 2 }, { type: 'logic', op: 'muell', nIn: -4, nOut: 77 }], links: [{ from: { n: 'io', port: 0 }, to: { n: 'm', port: 0 } }] };
  const { g, errors } = canvasMod.sanitizeGraph(raw);
  const lg = g.nodes.filter(n => n.type === 'logic');
  ok(lg.length === 2, '2 Logik-Karten behalten', String(lg.length));
  ok(lg[0].op === 'mul' && lg[0].nIn === 3 && lg[0].nOut === 2, 'Felder übernommen');
  ok(lg[1].op === 'add' && lg[1].nIn === 2 && lg[1].nOut === 16, 'Müll-Felder geklemmt (nOut 77→16)');
}

// ── 4) policyOrder mit Logik ───────────────────────────────
console.log('\n[4] policyOrder — Logik + Policy topologisch');
{
  const g = canvasMod.newGraph();
  g._ioCount = 8; g._actCount = 2;
  const lg = canvasMod.addLogicNode(g, { op: 'add', nIn: 2, nOut: 1 });
  const pol = canvasMod.addPolicyNode(g, { name: 'P', nIn: 1, nOut: 1, hidden: [8] });
  canvasMod.addLink(g, { n: 'io', port: 0 }, { n: lg.id, port: 0 });
  canvasMod.addLink(g, { n: 'io', port: 1 }, { n: lg.id, port: 1 });
  canvasMod.addLink(g, { n: lg.id, port: 0 }, { n: pol.id, port: 0 });
  canvasMod.addLink(g, { n: pol.id, port: 0 }, { n: 'out', port: 0 });
  const order = canvasMod.policyOrder(g).map(n => n.id);
  ok(order.length === 2, 'nur Karten mit Netzen/Logik in der Ordnung', String(order.length));
  ok(order.indexOf(lg.id) < order.indexOf(pol.id), 'Logik VOR abhängiger Policy');
  // Kette Policy → Logik → Policy
  const pol2 = canvasMod.addPolicyNode(g, { name: 'P2', nIn: 1, nOut: 1, hidden: [8] });
  const lg2 = canvasMod.addLogicNode(g, { op: 'neg', nIn: 1, nOut: 1 });
  const pol3 = canvasMod.addPolicyNode(g, { name: 'P3', nIn: 1, nOut: 1, hidden: [8] });
  canvasMod.addLink(g, { n: pol.id, port: 0 }, { n: lg2.id, port: 0 });
  canvasMod.addLink(g, { n: lg2.id, port: 0 }, { n: pol3.id, port: 0 });
  const order2 = canvasMod.policyOrder(g).map(n => n.id);
  ok(order2.indexOf(pol.id) < order2.indexOf(lg2.id) && order2.indexOf(lg2.id) < order2.indexOf(pol3.id), 'Policy → Logik → Policy Reihenfolge');
}

// ── 5) buildPlanGraph mit Logik ────────────────────────────
console.log('\n[5] buildPlanGraph — gemischte Karten + Report');
{
  const g = canvasMod.newGraph();
  g._ioCount = 8; g._actCount = 2;
  const rep = canvasMod.buildPlanGraph(g, {
    cards: [
      { name: 'Netz A', nIn: 2, nOut: 2, hidden: [8] },
      { name: 'Mischer', logic: 'mul', nIn: 2, nOut: 1 },
      { name: 'Wender', logic: 'neg', nIn: 1, nOut: 1 },
    ],
    links: [
      { from: { node: 'io', port: 0 }, to: { node: 'Netz A', port: 0 } },
      { from: { node: 'Netz A', port: 0 }, to: { node: 'Mischer', port: 0 } },
      { from: { node: 'io', port: 1 }, to: { node: 'Mischer', port: 1 } },
      { from: { node: 'Mischer', port: 0 }, to: { node: 'Wender', port: 0 } },
      { from: { node: 'Wender', port: 0 }, to: { node: 'out', port: 0 } },
    ],
    sink: 'residual',
  });
  ok(rep.errors.length === 0 && rep.linksOk === 5 && rep.linksFail.length === 0, '5 Kabel gesetzt, 0 Fehler', JSON.stringify(rep));
  const lg = g.nodes.find(n => n.name === 'Mischer');
  const wd = g.nodes.find(n => n.name === 'Wender');
  ok(lg && lg.type === 'logic' && lg.op === 'mul', 'Logik-Karte via canvasBuild angelegt');
  ok(wd && wd.op === 'neg', 'Wender neg');
  ok(rep.cards.find(c => c.name === 'Mischer').kind === 'logic', 'Report markiert kind=logic');
  // Bestehende Logik-Karte umkonfigurieren (gleicher Name)
  const rep2 = canvasMod.buildPlanGraph(g, { cards: [{ name: 'Mischer', logic: 'div', nIn: 2, nOut: 1 }], links: [] });
  ok(rep2.cards[0].kind === 'logic' && !rep2.cards[0].isNew && lg.op === 'div', 'bestehende Logik umkonfiguriert (kein Duplikat)');
  ok(g.nodes.filter(n => n.name === 'Mischer').length === 1, 'kein Duplikat angelegt');
}

// ── 6) linkManyGraph ───────────────────────────────────────
console.log('\n[6] linkManyGraph — Stapel-Kabel');
{
  const g = canvasMod.newGraph();
  g._ioCount = 8; g._actCount = 2;
  const a = canvasMod.addPolicyNode(g, { name: 'A', nIn: 4, nOut: 4, hidden: [8] });
  const b = canvasMod.addPolicyNode(g, { name: 'B', nIn: 3, nOut: 2, hidden: [8] });
  const rep = canvasMod.linkManyGraph(g, [
    { from: { node: 'io', port: 0 }, to: { node: 'A', port: 0 } },
    { from: { node: 'io', port: 1 }, to: { node: 'A', port: 1 } },
    { from: { node: 'io', port: 2 }, to: { node: 'A', port: 2 } },
    { from: { node: 'A', port: 0 }, to: { node: 'B', port: 0 } },
    { from: { node: 'Geist', port: 0 }, to: { node: 'B', port: 1 } }, // Quelle fehlt
    { from: { node: 'A', port: 9 }, to: { node: 'B', port: 2 } },   // Port existiert nicht
  ]);
  ok(rep.ok === 4, '4 Kabel ok', String(rep.ok));
  ok(rep.fail.length === 2 && /nicht gefunden/.test(rep.fail[0].error) && /Ausgangsport/.test(rep.fail[1].error), '2 Fehler gesammelt (Namen/Port)', JSON.stringify(rep.fail));
  ok(g.links.length === 4, 'Kabel im Graph');
  const repEmpty = canvasMod.linkManyGraph(g, []);
  ok(repEmpty.ok === 0 && repEmpty.fail.length === 0, 'leere Liste ok');
}

// ── 7) describe() — JEDER Port sichtbar ────────────────────
console.log('\n[7] describe() — Port-Sichtbarkeit');
{
  const g = canvasMod.newGraph();
  g._ioCount = 6; g._actCount = 3;
  const a = canvasMod.addPolicyNode(g, { name: 'A', nIn: 3, nOut: 2, hidden: [8] });
  const lg = canvasMod.addLogicNode(g, { op: 'add', nIn: 2, nOut: 1 });
  canvasMod.addLink(g, { n: 'io', port: 2 }, { n: a.id, port: 0 });
  canvasMod.addLink(g, { n: a.id, port: 1 }, { n: lg.id, port: 0 });
  canvasMod.addLink(g, { n: lg.id, port: 0 }, { n: 'out', port: 1 });
  const board = new canvasMod.CanvasBoard({ log: () => {}, toast: () => {}, buzz: () => {}, getSim: () => null, getTask: () => null, getRobotId: () => 'g1', getStick: () => ({ x: 0, y: 0 }) });
  board.graph = g;
  board._cacheLinks();
  const d = board.describe();
  const ioD = d.nodes.find(n => n.id === 'io');
  const outD = d.nodes.find(n => n.id === 'out');
  const aD = d.nodes.find(n => n.id === a.id);
  const lgD = d.nodes.find(n => n.id === lg.id);
  ok(ioD.portsList.length === 6 && ioD.portsList.every(p => Number.isFinite(p.port)), 'io: 6 Ports einzeln gelistet');
  ok(ioD.portsList[2].used === true && ioD.portsList[0].used === false, 'io: Port 2 belegt, Port 0 frei');
  ok(outD.portsList.length === 3 && outD.portsList[1].used === true && outD.portsList[0].used === false, 'out: 3 Ports, Port 1 belegt');
  ok(Array.isArray(aD.freeIn) && aD.freeIn.join(',') === '1,2' && aD.freeOut.join(',') === '0', 'Policy: freeIn=[1,2] freeOut=[0]', JSON.stringify({ in: aD.freeIn, out: aD.freeOut }));
  ok(lgD.op === 'add' && lgD.freeIn.join(',') === '1' && lgD.freeOut.length === 0, 'Logik: op + freeIn=[1] freeOut=[]');
  ok(ioD.portsList[5].name === 'Stick Y', 'io: Stick-Port benannt (5 = letzter bei ioCount 6)');
}

// ── 8) Board-Runtime an ECHTER Sim ─────────────────────────
console.log('\n[8] Board-Runtime — io → LOGIK(add) → Policy → out (G1, echte Physik)');
{
  const cfg = getRobot('g1');
  await fetchModelIntoFS('models/' + cfg.dir);
  writeWorldFile(cfg.dir, 'welt_canvas2200.xml', buildWorldXML(cfg, 'flach', 1, null));
  const sim = new RobotSim(cfg, 'welt_canvas2200.xml');
  const task = makeTrackTask(cfg);
  cfg.dr = null;
  task.reset(new RNG(4242), sim);

  const board = new canvasMod.CanvasBoard({
    log: () => {}, toast: () => {}, buzz: () => {},
    getSim: () => sim, getTask: () => task, getRobotId: () => 'g1',
    getStick: () => ({ x: 0.5, y: 0 }),
    setMode: () => {}, getMode: () => 'canvas', stopMainTraining: () => {},
    fireAct: () => {}, fireReset: () => {}, fireReward: (s, i) => i,
    pushEpisodeReward: () => {}, getMainPolicyJSON: () => null,
  });
  const g = board.graph;
  g._ioCount = task.obsDim + 2; g._actCount = sim.nu;
  board._obs = new Float32Array(task.obsDim);
  board._obsNames = canvasMod.obsPortNames(task, cfg);
  board._actNames = sim.actName.slice();
  board._refBuf = new Float64Array(sim.nu);
  const lg = canvasMod.addLogicNode(g, { name: 'Summe', op: 'add', nIn: 2, nOut: 1 });
  const cst = canvasMod.addConstNode(g, { name: 'Bias', values: [0.3] });
  const card = canvasMod.addPolicyNode(g, { name: 'T', nIn: 1, nOut: 2, hidden: [16], T: 64 });
  board._ensurePPO(card);
  ok(canvasMod.addLink(g, { n: 'io', port: task.obsDim }, { n: lg.id, port: 0 }).ok, 'Stick X → Logik a (getStick x=0,5)');
  ok(canvasMod.addLink(g, { n: cst.id, port: 0 }, { n: lg.id, port: 1 }).ok, 'Konstante 0,3 → Logik b');
  ok(canvasMod.addLink(g, { n: lg.id, port: 0 }, { n: card.id, port: 0 }).ok, 'Logik y → Karte[0]');
  ok(canvasMod.addLink(g, { n: card.id, port: 0 }, { n: 'out', port: 0 }).ok, 'Karte[0] → out[0]');
  board._cacheLinks();

  sim.reset();
  board._evalSources();
  const e0 = board._vals.get('io:' + task.obsDim) || 0; // Stick X = 0,5
  const e1 = board._vals.get(cst.id + ':0') || 0;       // 0,3
  const expectFold = e0 + e1;                           // 0,8
  ok(near(expectFold, 0.8, 1e-9), 'Test-Voraussetzung: Stick+Konst = 0,8', String(expectFold));
  board.execCtrlStep();
  const got = board._outVals.get(lg.id);
  ok(got && got.length === 1 && near(got[0], expectFold, 1e-5), 'Logik-Ausgabe = Stick X + 0,3 (topo vor Policy)', (got ? got[0].toFixed(4) : '—') + ' vs ' + expectFold.toFixed(4));
  const mu = board.ppo.get(card.id).actMu(new Float32Array([expectFold])).slice();
  const expected0 = sim.keyCtrl[0] + cfg.actSpan * Math.tanh(mu[0] * (cfg.jointResidual || 1));
  ok(near(sim.ctrl[0], expected0, 1e-6), 'ctrl[0] = keyCtrl + actSpan·tanh(mu([Summe]))', sim.ctrl[0].toFixed(6));
  ok(sim.ctrl.every((v) => Number.isFinite(v)), 'ctrl finit');
  ok(near(sim.ctrl[2], sim.keyCtrl[2], 1e-9), 'unverbundener Aktuator hält Keyframe-Pose');

  // Logik-Op LIVE ändern (add → mul): Ausgabe folgt sofort (0,5·0,3 = 0,15)
  lg.op = 'mul';
  board.execCtrlStep();
  const gotMul = board._outVals.get(lg.id);
  ok(near(gotMul[0], e0 * e1, 1e-5), 'op-Wechsel add→mul wirkt sofort (0,15)', gotMul[0].toFixed(4));
  // unverbundener Logik-Eingang zählt 0: b-Kabel lösen → Ergebnis = Stick X
  g.links = g.links.filter(l => !(l.to.n === lg.id && l.to.port === 1));
  board._cacheLinks();
  lg.op = 'add';
  board.execCtrlStep();
  ok(near(board._outVals.get(lg.id)[0], e0, 1e-5), 'unverbundener Eingang zählt 0 (0,5+0)', board._outVals.get(lg.id)[0].toFixed(4));

  // TRAINING mit Logik im Graph — finit
  board.training = true;
  for (let t = 0; t < 60; t++) board.trainCtrlStep();
  ok(board.stats.steps === 60 && sim.ctrl.every((v) => Number.isFinite(v)), 'trainCtrlStep: 60 Schritte finit (Logik läuft mit)', String(board.stats.steps));
  ok(board.ppo.get(card.id).stepCount > 0, 'Karte hat gelernt');
  // Persistenz inkl. Logik
  board.saveNow();
  const saved = JSON.parse(globalThis.localStorage.getItem('tr_canvas_v2_g1') || 'null');
  ok(saved.nodes.some(n => n.type === 'logic' && n.name === 'Summe'), 'saveNow enthält Logik-Karte');
  const { g: gReload } = canvasMod.sanitizeGraph(saved);
  ok(gReload.nodes.filter(n => n.type === 'logic').length === 1, 'Reload: Logik überlebt sanitize');
}

// ── 9) Stapelverbindung (Langdruck-Logik) ──────────────────
console.log('\n[9] Stapelverbindung — freie Ports wählen, paarweise verbinden');
{
  const board = new canvasMod.CanvasBoard({
    log: () => {}, toast: () => {}, buzz: () => {},
    getSim: () => null, getTask: () => null, getRobotId: () => 'g1', getStick: () => ({ x: 0, y: 0 }),
  });
  const g = board.graph;
  g._ioCount = 8; g._actCount = 2;
  const a = canvasMod.addPolicyNode(g, { name: 'A', nIn: 2, nOut: 4, hidden: [8] });
  const b = canvasMod.addPolicyNode(g, { name: 'B', nIn: 3, nOut: 2, hidden: [8] });
  // a) Seite A.out lang gedrückt → alle freien Ausgänge gewählt
  board._batchPress(a, 'out');
  ok(board._batch && board._batch.n === a.id && board._batch.side === 'out' && board._batch.ports.join(',') === '0,1,2,3', 'A.out: 4 freie Ports gewählt', JSON.stringify(board._batch && board._batch.ports));
  // b) Seite B.in lang gedrückt → 3 Paare verbunden, A.3 bleibt frei
  board._batchPress(b, 'in');
  ok(!board._batch, 'Auswahl nach Verbindung geleert');
  ok(g.links.length === 3, '3 Kabel gesetzt (min(freiA, freiB))', String(g.links.length));
  const pairs = g.links.map(l => l.from.port + '>' + l.to.port).sort().join(',');
  ok(pairs === '0>0,1>1,2>2', 'paarweise oben→unten', pairs);
  ok(!g.links.some(l => l.from.n === a.id && l.from.port === 3), 'Überzähliger A.3 bleibt frei (Nutzer: „Wenn es übrig bleibt ist egal. Lasse es leer")');
  // c) andere Karte, gegenüberliegende Seite, RICHTUNG automatisch (C.out → A.in)
  //    (A→B existiert bereits — B.out→A.in wäre ein Zyklus und WIRD zu Recht abgelehnt)
  const c = canvasMod.addPolicyNode(g, { name: 'C', nIn: 2, nOut: 2, hidden: [8] });
  board._batchPress(c, 'out'); // C.out frei: 0,1
  ok(board._batch && board._batch.ports.join(',') === '0,1', 'C.out: 2 freie Ports gewählt');
  const before = g.links.length;
  board._batchPress(a, 'in'); // A.in0..1 frei → 2 Paare C.out → A.in
  ok(g.links.length === before + 2, 'C.out → A.in: 2 Paare (Richtung automatisch)', String(g.links.length - before));
  ok(g.links.filter(l => l.from.n === c.id && l.to.n === a.id).length === 2, 'Kabel laufen C → A');
  // d) out→out abgelehnt (Gegenstück fehlt): A.out wählen, Ziel C.out
  board._batchPress(a, 'out'); // A.out frei: nur Port 3
  ok(board._batch && board._batch.ports.join(',') === '3', 'A.out: nur noch Port 3 frei');
  const before2 = g.links.length;
  board._batchPress(c, 'out'); // gleiche Seite → Fehler, keine Kabel
  ok(g.links.length === before2, 'out→out abgelehnt (Gegenstück fehlt)', String(g.links.length - before2));
  // e) gleiche Karte + gleiche Seite = Auswahl aufheben
  board._batchPress(a, 'out');
  ok(board._batch && board._batch.n === a.id, 'A.out gewählt');
  board._batchPress(a, 'out');
  ok(!board._batch, 'gleiche Seite nochmal → Auswahl aufgehoben');
  // f) belegte Ports werden NICHT gewählt
  board._batchPress(b, 'in'); // B.in0..2 sind alle verkabelt → keine frei
  ok(!board._batch, 'keine freien Eingänge → keine Auswahl');
}

// ── 10) Verdrahtung main.js/ai.js/index.html/CANVAS.md ─────
console.log('\n[10] Verdrahtung — Werkzeuge + UI + Doku');
{
  const mainSrc = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const aiSrc = await readFile(path.join(WWW, 'js/ai.js'), 'utf8');
  const htmlSrc = await readFile(path.join(WWW, 'index.html'), 'utf8');
  const docSrc = await readFile(path.join(WWW, 'mcp/CANVAS.md'), 'utf8');
  const cssSrc = await readFile(path.join(WWW, 'style.css'), 'utf8');
  ok((v => v && +v[1] >= 2)(/VERSION = '(\d+)\.(\d+)\.(\d+)'/.exec(mainSrc)), 'main.js VERSION ≥ 2.20.0 (v2.21.0: Pin auf ≥ gelockert)');
  ok(/linkManyGraph/.test(mainSrc) && /cmd === 'linkMany'/.test(mainSrc), 'main.js: linkMany-Handler');
  ok(/type === 'logic'/.test(mainSrc) && /addLogicNode/.test(mainSrc), 'main.js: Logik-add/config');
  ok(/cvAddLogic/.test(htmlSrc) && /cvAddLogic/.test(mainSrc), 'index.html + main.js: +Logik-Button verdrahtet');
  ok(/cvBatch/.test(htmlSrc) && /cv-batch/.test(cssSrc), 'Stapel-Banner im DOM + CSS');
  ok(/cv-sel/.test(cssSrc), 'CSS: Auswahl-Highlight');
  ok(!/max-height: 330px/.test(cssSrc), 'CSS: Listen-Bug beseitigt (kein max-height 330px mehr)');
  ok(/'linkMany'/.test(aiSrc) && /LOGIC_OPS/.test(aiSrc), 'ai.js: linkMany + LOGIC_OPS validiert');
  ok(/NIEMALS NUR Training starten/.test(aiSrc), 'ai.js: Prompt verbietet Training-ohne-Architektur');
  ok(/linkMany/.test(docSrc) && /Logik-Karten/.test(docSrc) && /LANG DRÜCKEN/.test(docSrc), 'CANVAS.md: linkMany + Logik + Geste dokumentiert');
  ok(/versionCode (3[2-9]|4[0-9]|50)/.test(await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8')), 'build.gradle versionCode ≥ 32 (v2.21.0: Pin auf ≥ gelockert)');
}

console.log('\n════════════════════════════════');
console.log(`ERGEBNIS: ${pass} grün, ${fail} rot`);
process.exit(fail ? 1 : 0);
