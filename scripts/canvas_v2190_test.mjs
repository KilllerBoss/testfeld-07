// canvas_v2190_test.mjs — v2.19.0 CANVASBUILD + MODEL-PIN + TOOL-WHITELIST-FIX:
//   1) ⭐ validateToolCall (ai.js): canvasGraph/canvasReward/canvasRun/canvasUI sind
//      JETZT in der Whitelist (Bug bis v2.18.0: fehlten → Aufruf stumm verworfen,
//      Gemini "hat nichts gemacht"); canvasBuild validiert/clampt Karten+Kabel+Flags
//   2) buildPlanGraph (canvas.js): Karte anlegen (Namen/Architektur/Belohnung),
//      Kabel NACH NAME auflösen, Fehler pro Kabel sammeln statt abbrechen,
//      Wiederaufruf ohne clear = Karten WIEDERVERWENDEN (keine Duplikate),
//      Architekturwechsel = archReset, Limits, Zyklus-Schutz, Port-Ersatz, sink
//   3) End-to-End des NUTZERWUNSCHS: "Router + 4 Experten (gehen/drehen/
//      Gleichgewicht/aufstehen, geringe Latenz)" als EIN canvasBuild-Aufruf —
//      validateToolCall → buildPlanGraph → 5 Karten, Kabel, custom-Belohnungen
//   4) Modell-Pin: alter Cache (tr_ai_models_v1) wird IGNORIERT; Netzwerk-Fail →
//      smart = 'gemini-3.8-flash' (Pinned-Default), nicht 'gemini-3-flash'
//   5) System-Prompt enthält canvasBuild (Tool 20), 5-Schritte-Budget, Rezept;
//      AI_DOCS/CANVAS-Titel aktualisiert; Version 2.19.0 / versionCode 31
// Usage: node scripts/canvas_v2190_test.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

// localStorage-Shim VOR Import (ai.js nutzt es im Modul-Kontext)
if (!globalThis.localStorage) {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
// Netzwerk-Simulierung: alle realen fetch-Aufrufe schlagen fehl (Offline-Test) —
// ensureModels muss dann auf die GEPINNTE Default-Kette fallen.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
    throw new Error('offline (Test)');
  }
  return realFetch(url);
};

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

const ai = await import(path.join(WWW, 'js/ai.js'));
const cv = await import(path.join(WWW, 'js/canvas.js'));

// ── 1) validateToolCall: Canvas-Werkzeuge endlich erlaubt ──
console.log('\n[1] validateToolCall — Canvas-Whitelist (v2.18.0-Bug behoben)');
{
  const a = ai.validateToolCall({ tool: 'canvasGraph', args: { cmd: 'add', type: 'policy', nIn: 20, nOut: 14, hidden: [48, 32], name: 'Experte Gehen' } });
  ok(a && a.tool === 'canvasGraph', 'canvasGraph cmd=add wird akzeptiert (vormals null!)');
  ok(a.args.nIn === 20 && a.args.nOut === 14 && a.args.hidden.join(',') === '48,32', 'add: nIn/nOut/hidden unverändert übernommen', JSON.stringify(a.args));

  const link = ai.validateToolCall({ tool: 'canvasGraph', args: { cmd: 'link', from: { node: 'io', port: 3 }, to: { node: 'Experte Gehen', port: 0 } } });
  ok(link.args.from.node === 'io' && link.args.from.port === 3 && link.args.to.port === 0, 'link: Port-Referenzen sauber');

  const linkBad = ai.validateToolCall({ tool: 'canvasGraph', args: { cmd: 'link', from: { node: '', port: -5 }, to: 42 } });
  ok(linkBad.args.from === null && linkBad.args.to === null, 'link: Müll-Referenzen → null (Handler lehnt ab)');

  const cfg = ai.validateToolCall({ tool: 'canvasGraph', args: { cmd: 'config', node: 'n7', hidden: [999, 4, 64], lr: 0.9, T: 1e6, trainable: 1, sink: 'direct' } });
  ok(cfg.args.hidden.join(',') === '256,8,64' && cfg.args.lr === 0.003 && cfg.args.T === 4096 && cfg.args.trainable === true && cfg.args.sink === 'direct', 'config: Klemmen greifen (hidden/lr/T/sink)');

  const state = ai.validateToolCall({ tool: 'canvasGraph', args: { cmd: 'boese' } });
  ok(state.args.cmd === 'state', 'canvasGraph: unbekannter cmd → sicherer state');

  const rew = ai.validateToolCall({ tool: 'canvasReward', args: { card: 'Experte Gehen', mode: 'custom', scale: 9, w: { vel: 99, alive: 0.3, energy: 1 } } });
  ok(rew.args.scale === 3 && rew.args.w.vel === 2 && rew.args.w.alive === 0.3 && rew.args.w.energy === 0.01, 'canvasReward: scale/w geklemmt (vel 99→2, energy 1→0.01)');

  const run = ai.validateToolCall({ tool: 'canvasRun', args: { train: 1, run: 'yes' } });
  ok(run.args.train === true && run.args.run === true, 'canvasRun: Flags zu Booleans gezwungen');

  const ui = ai.validateToolCall({ tool: 'canvasUI', args: { kind: 'slider', label: 'Tempo', io: 'in' } });
  ok(ui.args.kind === 'slider' && ui.args.label === 'Tempo', 'canvasUI: gültig');
  const uiBad = ai.validateToolCall({ tool: 'canvasUI', args: { kind: 'nuclear', label: 'x'.repeat(99) } });
  ok(uiBad.args.kind === undefined && uiBad.args.label === 'x'.repeat(16), 'canvasUI: unbekannter kind verworfen, Label geklemmt');

  ok(ai.validateToolCall({ tool: 'nuclearOption', args: {} }) === null, 'unbekanntes Werkzeug weiterhin abgelehnt');
  ok(ai.validateToolCall({ tool: 'readDoc', args: { doc: 'CANVAS' } }).args.doc === 'CANVAS', 'readDoc CANVAS weiterhin erlaubt');
}

// ── canvasBuild-Validierung ──
console.log('\n[1b] validateToolCall — canvasBuild (Ein-Schritt-Plan)');
{
  const b = ai.validateToolCall({ tool: 'canvasBuild', args: {
    clear: true,
    cards: [
      { name: 'A', nIn: 20, nOut: 3, hidden: [48, 32], reward: { mode: 'custom', w: { vel: 1.2, fall: 2 } } },
      { name: 'B', nIn: 999, nOut: 0, hidden: [4, 999], trainable: 0, lr: 0.01, T: 9 },
      'MÜLL',
    ],
    links: [
      { from: { node: 'io', port: 0 }, to: { node: 'A', port: 0 } },
      { from: { node: 'A', port: 0 }, to: { node: 'out', port: 2 } },
      { from: { node: 7 }, to: { node: 'B', port: 0 } },
    ],
    sink: 'residual', run: true, train: false,
  } });
  ok(b && b.tool === 'canvasBuild', 'canvasBuild akzeptiert');
  ok(b.args.clear === true && b.args.run === true && b.args.train === false && b.args.sink === 'residual', 'Flags korrekt übernommen');
  ok(b.args.cards.length === 2, 'Müll-Karte verworfen, 2 gültige bleiben');
  ok(b.args.cards[1].nIn === 64 && b.args.cards[1].nOut === 1 && b.args.cards[1].hidden.join(',') === '8,256' && b.args.cards[1].trainable === false, 'Karte B geklemmt (nIn 999→64, nOut 0→1, hidden 4/999→8/256)');
  ok(b.args.cards[1].lr === 0.003 && b.args.cards[1].T === 128, 'Karte B: lr/T geklemmt');
  ok(b.args.cards[0].reward.mode === 'custom' && b.args.cards[0].reward.w.vel === 1.2 && b.args.cards[0].reward.w.fall === 2, 'Karte A: custom-Belohnung übernommen');
  ok(b.args.links.length === 2, 'Müll-Kabel verworfen, 2 gültige bleiben');

  const empty = ai.validateToolCall({ tool: 'canvasBuild', args: {} });
  ok(empty.args.clear === false && !empty.args.cards && !empty.args.links, 'leerer Plan valide (Report erklärt dann fehlende Felder)');
}

// ── 2) buildPlanGraph ──
console.log('\n[2] buildPlanGraph — Graph-Mutation + Report');
{
  const g = cv.newGraph();
  g._ioCount = 24; g._actCount = 14; // wie Board.attach (obs+2 Stick / nu)
  const plan = {
    cards: [
      { name: 'Experte Gehen', nIn: 8, nOut: 4, hidden: [48, 32], reward: { mode: 'custom', w: { vel: 1.2, alive: 0.3, energy: 0.002, fall: 2 } } },
      { name: 'Router', nIn: 8, nOut: 2, hidden: [48], trainable: false },
    ],
    links: [
      { from: { node: 'io', port: 0 }, to: { node: 'Experte Gehen', port: 0 } },
      { from: { node: 'io', port: 23 }, to: { node: 'Router', port: 1 } },
      { from: { node: 'Experte Gehen', port: 3 }, to: { node: 'out', port: 13 } },
      { from: { node: 'NIRGENDS', port: 0 }, to: { node: 'Router', port: 0 } },
      { from: { node: 'io', port: 99 }, to: { node: 'Router', port: 0 } },
      { from: { node: 'Router', port: 9 }, to: { node: 'out', port: 0 } },
    ],
  };
  const rep = cv.buildPlanGraph(g, plan);
  ok(rep.cards.length === 2 && rep.cards[0].isNew && rep.cards[0].id, '2 Karten angelegt', JSON.stringify(rep.cards));
  const geh = cv.findNodeByName(g, 'Experte Gehen');
  ok(geh && geh.nIn === 8 && geh.nOut === 4 && geh.hidden.join(',') === '48,32', 'Karte „Experte Gehen": Architektur korrekt');
  ok(geh.reward.mode === 'custom' && Math.abs(geh.reward.w.vel - 1.2) < 1e-9 && Math.abs(geh.reward.w.alive - 0.3) < 1e-9 && Math.abs(geh.reward.w.energy - 0.002) < 1e-9 && geh.reward.w.fall === 2, 'custom-Belohnung gesetzt (vel/alive/energy/fall)');
  const rout = cv.findNodeByName(g, 'Router');
  ok(rout && rout.trainable === false, 'Router: trainable:false (eingefroren)');
  ok(rep.linksOk === 3, '3 gültige Kabel gesetzt', 'linksOk=' + rep.linksOk);
  ok(rep.linksFail.length === 3, '3 fehlerhafte Kabel GESAMMELT statt Abbruch', JSON.stringify(rep.linksFail.map(f => f.error)));
  ok(rep.linksFail.some(f => /NIRGENDS/.test(f.error)) && rep.linksFail.filter(f => /Ausgangsport/.test(f.error)).length === 2, 'Fehlertexte nennen Quelle + Port-Problem (unbekannter Knoten, 2× Port außerhalb)');
  ok(g.links.length === 3 && g.links.some(l => l.from.n === 'io' && l.from.port === 0 && l.to.n === geh.id), 'Kabel im Graph, io-Port 0 → Experte');

  // Wiederaufruf ohne clear: Karten wiederverwenden, keine Duplikate
  const plan2 = { cards: [{ name: 'Experte Gehen', nIn: 10, nOut: 5, hidden: [64] }], links: [] };
  const rep2 = cv.buildPlanGraph(g, plan2);
  ok(rep2.cards.length === 1 && !rep2.cards[0].isNew && rep2.cards[0].archReset === true, 'Wiederaufruf: Karte ANGEPASST (nicht neu), Architekturwechsel markiert');
  ok(cv.findNodeByName(g, 'Experte Gehen').nIn === 10 && g.nodes.filter(n => n.type === 'policy').length === 2, 'keine Duplikate, nIn aktualisiert');
  ok(!g.links.some(l => l.to.n === geh.id && l.to.port >= 10), 'Kabel auf tote Ports der neuen Architektur entfernt');

  // trainables bleiben bei Architektur-Änderung UNVERÄNDERT (nur Netz frisch)
  ok(cv.findNodeByName(g, 'Experte Gehen').reward.w.vel === 1.2, 'Belohnung überlebt Architekturwechsel');

  // Zyklus-Schutz im Plan
  const g3 = cv.newGraph(); g3._ioCount = 8; g3._actCount = 4;
  const rep3 = cv.buildPlanGraph(g3, {
    cards: [{ name: 'A', nIn: 4, nOut: 4 }, { name: 'B', nIn: 4, nOut: 4 }],
    links: [
      { from: { node: 'A', port: 0 }, to: { node: 'B', port: 0 } },
      { from: { node: 'B', port: 0 }, to: { node: 'A', port: 1 } },
    ],
  });
  ok(rep3.linksOk === 1 && rep3.linksFail.length === 1 && /Zyklus/.test(rep3.linksFail[0].error), 'Zyklus A→B→A abgelehnt, A→B bleibt');

  // Port-Ersatz: gleicher Ziel-Port zweimal → 1 Kabel
  const g4 = cv.newGraph(); g4._ioCount = 4; g4._actCount = 2;
  cv.buildPlanGraph(g4, {
    cards: [{ name: 'X', nIn: 2, nOut: 1 }],
    links: [
      { from: { node: 'io', port: 0 }, to: { node: 'X', port: 0 } },
      { from: { node: 'io', port: 1 }, to: { node: 'X', port: 0 } },
    ],
  });
  ok(g4.links.length === 1 && g4.links[0].from.port === 1, 'Port-Ersatz: letztes Kabel gewinnt (1 Kabel je Eingang)');

  // Limits
  const g5 = cv.newGraph(); g5._ioCount = 4; g5._actCount = 2;
  const many = { cards: Array.from({ length: 18 }, (_, i) => ({ name: 'K' + i, nIn: 2, nOut: 1 })), links: [] };
  const rep5 = cv.buildPlanGraph(g5, many);
  ok(rep5.cards.length === 16 && rep5.errors.some(e => /Limit/.test(e)), 'Karten-Limit 16 + Hinweis im Report');

  // sink
  const g6 = cv.newGraph(); g6._ioCount = 4; g6._actCount = 5; cv.findNode(g6, 'out').sink = new Array(5).fill('residual');
  cv.buildPlanGraph(g6, { cards: [], links: [], sink: 'direct' });
  ok(cv.findNode(g6, 'out').sink.every(s => s === 'direct'), 'sink:direct auf alle Aktuator-Ports');

  // leerer/ungültiger Plan
  const rep7 = cv.buildPlanGraph(cv.newGraph(), null);
  ok(rep7.errors.length === 1 && rep7.cards.length === 0, 'null-Plan → sauberer Report ohne Crash');
}

// ── 3) End-to-End: Nutzerwunsch als EIN canvasBuild-Aufruf ──
console.log('\n[3] End-to-End: „Soft-MoE-Architektur: Router + 4 Experten“ (geringe Latenz)');
{
  const validated = ai.validateToolCall({ tool: 'canvasBuild', args: {
    clear: true,
    cards: [
      { name: 'Experte Gehen', nIn: 22, nOut: 14, hidden: [48, 32], reward: { mode: 'custom', w: { vel: 1.2, alive: 0.3, energy: 0.002, fall: 2 } } },
      { name: 'Experte Drehen', nIn: 22, nOut: 14, hidden: [48, 32], reward: { mode: 'custom', w: { turn: 1.2, alive: 0.3, fall: 2 } } },
      { name: 'Experte Gleichgewicht', nIn: 22, nOut: 14, hidden: [48, 32], reward: { mode: 'custom', w: { up: 1.5, alive: 0.3, fall: 3 } } },
      { name: 'Experte Aufstehen', nIn: 22, nOut: 14, hidden: [48, 32], reward: { mode: 'custom', w: { up: 2, alive: 0.3, fall: 0 } } },
      { name: 'Router', nIn: 22, nOut: 4, hidden: [48], reward: { mode: 'global', scale: 1 } },
    ],
    links: [
      ...[0, 1, 2, 3].flatMap(p => [
        { from: { node: 'io', port: p }, to: { node: 'Experte Gehen', port: p } },
        { from: { node: 'io', port: p }, to: { node: 'Experte Drehen', port: p } },
        { from: { node: 'io', port: p }, to: { node: 'Experte Gleichgewicht', port: p } },
        { from: { node: 'io', port: p }, to: { node: 'Experte Aufstehen', port: p } },
        { from: { node: 'io', port: p }, to: { node: 'Router', port: p } },
      ]),
      ...[0, 1, 2, 3].map(p => ({ from: { node: 'Router', port: p }, to: { node: 'out', port: p } })),
    ],
    sink: 'residual',
    train: true,
  } });
  ok(validated && validated.tool === 'canvasBuild' && validated.args.cards.length === 5 && validated.args.links.length === 24, 'Plan validiert: 5 Karten, 24 Kabel');

  const g = cv.newGraph(); g._ioCount = 74 + 2; g._actCount = 14;
  const rep = cv.buildPlanGraph(g, validated.args);
  ok(rep.cards.length === 5 && rep.linksOk === 24 && rep.linksFail.length === 0, 'Graph gebaut: 5 Karten, 24/24 Kabel ok', JSON.stringify({ ok: rep.linksOk, fail: rep.linksFail.length }));
  ok(g.nodes.filter(n => n.type === 'policy').length === 5, '5 Policy-Karten im Graph');
  const names = g.nodes.filter(n => n.type === 'policy').map(n => n.name);
  ok(['Experte Gehen', 'Experte Drehen', 'Experte Gleichgewicht', 'Experte Aufstehen', 'Router'].every(n => names.includes(n)), 'alle Wunschkarten vorhanden', names.join(' · '));
  const auf = cv.findNodeByName(g, 'Experte Aufstehen');
  ok(auf.reward.w.up === 2 && auf.reward.w.fall === 0, 'Aufstehen-Experte: up 2, KEIN fall-Malus (darf liegen)');
  ok(cv.findNodeByName(g, 'Experte Gehen').hidden.join(',') === '48,32' && cv.findNodeByName(g, 'Router').hidden.join(',') === '48', 'geringe Latenz: kleine Hidden-Schichten [48,32] / Router [48]');
  ok(cv.findNode(g, 'out').sink.every(s => s === 'residual'), 'Senken residual (App-Semantik)');
  // topologische Ordnung: Router hat keine Karten-Vorgänger, Experten auch nicht → alle lauffähig
  const order = cv.policyOrder(g);
  ok(order.length === 5, 'topologische Ordnung über alle 5 Karten');
}

// ── 4) Modell-Pin ──
console.log('\n[4] Modell-Pin: gemini-3.8-flash');
{
  // Alter Cache unter v1-Key (alle Bestandsgeräte) wird IGNORIERT
  globalThis.localStorage.setItem('tr_ai_models_v1', JSON.stringify({ fast: 'gemini-2.5-flash-lite', smart: 'gemini-2.5-flash', t: Date.now(), src: 'list' }));
  // Frischer Cache unter v2 mit ALTEN Picks (falls je geschrieben) ebenfalls ungültig:
  globalThis.localStorage.setItem('tr_ai_models_v2', JSON.stringify({ fast: 'gemini-3-flash-lite', smart: 'gemini-3-flash', t: Date.now() - 8 * 24 * 3600e3, src: 'list' }));
  const models = await ai.ensureModels(true);
  ok(models.smart === 'gemini-3.8-flash', 'Netzwerk offline → Default-Kette mit GEPINNTEM smart', models.smart + ' (src=' + models.src + ')');
  const cached = JSON.parse(globalThis.localStorage.getItem('tr_ai_models_v2') || 'null');
  ok(cached && cached.smart === 'gemini-3-flash', 'veralteter v2-Cache (über TTL) bleibt NICHT als Default zurückschreibbar — Discovery/Dafault bleibt dynamisch');
  const src = await (await import('node:fs/promises')).readFile(path.join(WWW, 'js/ai.js'), 'utf8');
  ok(src.includes("'gemini-3.8-flash'") && src.includes("PREFERRED_SMART"), 'Pin im Quellcode verankert');
  ok(src.includes("tr_ai_models_v2"), 'Cache-Key auf v2 gebumpt (Bestandsgeräte laden neu)');
}

// ── 5) System-Prompt + Doku + Version ──
console.log('\n[5] System-Prompt / Doku / Version');
{
  const sys = ai.buildSystemPrompt({ current: { rW: {}, ppo: {} }, robotName: 'Unitree G1', robot: 'g1', taskKind: 'speed', history: [] });
  ok(/20\. tool="canvasBuild"/.test(sys), 'Tool 20 canvasBuild im Prompt');
  ok(/Maximal 5 Werkzeug-Schritte/.test(sys), '5 Werkzeug-Schritte Budget im Prompt');
  ok(/REZEPT „ROUTER \+ EXPERTEN“/.test(sys), 'Router+Experten-Rezept im Prompt');
  ok(/Gleichgewicht/.test(sys) && /Aufstehen/.test(sys), 'Rezept nennt die 4 Experten-Aufgaben');
  ok(sys.includes('canvasBuild|canvasGraph|canvasReward|canvasRun|canvasUI') || /canvasGraph\|canvasReward\|canvasRun\|canvasUI\|canvasBuild/.test(sys), 'Antwortformat-Enum enthält canvasBuild');
  ok(/NIEMALS nur beschreiben/.test(sys), 'Prompt verbietet Beschreiben-ohne-Bauen');
  const docs = ai.AI_DOCS.find(d => d.doc === 'CANVAS');
  ok(docs && docs.title.includes('canvasBuild'), 'AI_DOCS: CANVAS-Titel nennt canvasBuild');

  const mainSrc = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const verM = /const VERSION = '(\d+)\.(\d+)\.(\d+)'/.exec(mainSrc);
  const verOk = verM && ((+verM[1] * 10000) + (+verM[2] * 100) + +verM[3]) >= 20100;
  ok(verOk, 'main.js VERSION ≥ 2.19.0 (v2.20.0: Pin auf ≥ gelockert)', verM && verM[0]);
  ok(mainSrc.includes('canvasBuildTool') && mainSrc.includes("buildPlanGraph"), 'main.js: canvasBuildTool + buildPlanGraph importiert');
  ok(/tool === 'canvasBuild'/.test(mainSrc), 'execTool registriert canvasBuild');
  const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
  const gvM = /versionCode (\d+)\s*\/\s*versionName "(\d+)\.(\d+)\.(\d+)"/.exec(gradle.replace('\n', ' ')) || /versionCode (\d+)[\s\S]*?versionName "(\d+)\.(\d+)\.(\d+)"/.exec(gradle);
  const gvOk = gvM && +gvM[1] >= 31;
  ok(gvOk, 'build.gradle: versionCode ≥ 31 (v2.20.0: Pin auf ≥ gelockert)', gvM && gvM[0]);
  const canvasDoc = await readFile(path.join(WWW, 'mcp/CANVAS.md'), 'utf8');
  ok(canvasDoc.includes('canvasBuild') && canvasDoc.includes('5 Werkzeuge'), 'CANVAS.md: canvasBuild + 5-Werkzeuge-Tabelle');
}

console.log('\n─── ERGEBNIS: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen ───');
process.exit(fail ? 1 : 0);
