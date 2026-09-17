// ui_v2170_test.mjs — v2.17.0 NETZ-CANVAS Browser-Test (Playwright, EIN Boot):
//   1) Canvas-UI vorhanden: Topbar-Button, Sheet, Modus-Chip CANVAS, io/out-Knoten
//   2) Karte bauen (+ Netz), Ports vorhanden, Sensoren links/Aktuatoren rechts
//   3) Kabel via MCP-Werkzeug (canvasGraph add/link) — UI zeigt Kabel-Pfad
//   4) Modus CANVAS: Graph fährt den Roboter (AUSFÜHREN), ctrl finit, io/out aktiv
//   5) Canvas-TRAINING (train:true) — Karten-Steps wachsen, Statistik läuft
//   6) UI-Element (canvasUI) — Widget in der Leiste, Slider-Wert fließt
//   7) canvasReward (eigene Formel), canvasRun run:false → MANUELL
//   8) Persistenz: localStorage-Eintrag je Roboter vorhanden
//   9) Keine Seitenfehler
// Usage: node scripts/ui_v2170_test.mjs
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xml': 'model/xml', '.stl': 'model/stl', '.obj': 'text/plain', '.png': 'image/png', '.md': 'text/markdown', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const p = path.join(WWW, url === '/' ? 'index.html' : url);
  if (!p.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  try {
    const buf = fs.readFileSync(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// Tempo-Slider auf 16 stellen, BEVOR die App bootet (Canvas-Training nutzt S.speedMode)
await page.evaluate(() => { try { localStorage.setItem('tr_speed_v2', '16'); } catch (e) { /* egal */ } });
await page.reload({ waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.classList.contains('gone');
  }, null, { timeout: 120000 });
  ok(true, 'Boot abgeschlossen');
} catch (e) {
  ok(false, 'Boot abgeschlossen', '— Timeout');
}

// ── 1) Canvas-UI vorhanden ─────────────────────────────────
console.log('\n[1] Canvas-UI');
ok(await page.locator('#btnCanvas').count() === 1, 'Topbar-Button #btnCanvas existiert');
ok(await page.locator('#modeCanvas').count() === 1, 'Modus-Chip #modeCanvas existiert');
await page.click('#btnCanvas');
await page.waitForTimeout(300);
ok(!(await page.locator('#canvasSheet').evaluate(el => el.classList.contains('hidden'))), 'Canvas-Sheet öffnet');
const nodeInfo = await page.evaluate(() => {
  const T = window.__trainrobot;
  const b = T.canvas;
  const io = document.querySelector('.cv-node[data-id="io"]');
  const out = document.querySelector('.cv-node[data-id="out"]');
  return {
    ioPorts: io ? io.querySelectorAll('.cv-port.cv-out').length : 0,
    outPorts: out ? out.querySelectorAll('.cv-port.cv-in').length : 0,
    ioLabel: io ? io.querySelector('.cv-nname').textContent : '',
    outLabel: out ? out.querySelector('.cv-nname').textContent : '',
    ioCount: b.graph._ioCount, actCount: b.graph._actCount,
    obs0: io ? io.querySelector('.cv-plabel').textContent : '',
  };
});
ok(nodeInfo.ioPorts === nodeInfo.ioCount, 'io-Knoten hat ALLE Sensor-Ports einzeln', nodeInfo.ioPorts + ' Ports (obs ' + (nodeInfo.ioCount - 2) + ' + 2 Stick)');
ok(nodeInfo.outPorts === nodeInfo.actCount, 'out-Knoten hat ALLE Aktuator-Ports einzeln', nodeInfo.outPorts + ' Ports');
ok(/SENSOREN/.test(nodeInfo.ioLabel) && /AKTUATOREN/.test(nodeInfo.outLabel), 'io/out-Beschriftung', nodeInfo.ioLabel + ' · ' + nodeInfo.outLabel);
ok(nodeInfo.ioPorts === 108, 'G1: 106 Sensor-Kanäle + 2 Stick = 108', String(nodeInfo.ioPorts));

// ── 2) Karte bauen ─────────────────────────────────────────
console.log('\n[2] Karte bauen');
await page.click('#cvAddPolicy');
await page.waitForTimeout(200);
const cardInfo = await page.evaluate(() => {
  const b = window.__trainrobot.canvas;
  const cards = b.graph.nodes.filter(n => n.type === 'policy');
  const el = document.querySelector('.cv-node[data-id="' + cards[0].id + '"]');
  return { id: cards[0].id, n: cards.length, dom: !!el, inP: el ? el.querySelectorAll('.cv-port.cv-in').length : 0, outP: el ? el.querySelectorAll('.cv-port.cv-out').length : 0, editOpen: !document.getElementById('cvEdit').classList.contains('hidden') };
});
ok(cardInfo.n === 1 && cardInfo.dom, 'Karte erstellt + gerendert', 'id=' + cardInfo.id);
ok(cardInfo.inP === 8 && cardInfo.outP === 4, 'Default-Ports 8→4', cardInfo.inP + '→' + cardInfo.outP);
ok(cardInfo.editOpen, 'Einstell-Panel öffnet automatisch');
// Kleinen PPO-Puffer setzen (damit Updates schon im kurzen Test feuern)
await page.evaluate(() => { window.__trainrobot.execTool('canvasGraph', { cmd: 'config', node: (window.__trainrobot.canvas.graph.nodes.find(n => n.type === 'policy')).id, T: 64 }); });
// Architektur über Edit-Panel ändern: hidden "16", nIn 2, nOut 2
await page.evaluate(() => {
  const ed = document.getElementById('cvEdit');
  const rows = ed.querySelectorAll('.cv-edit-row input, .cv-edit-row select');
  // Reihenfolge: Name, Eingänge, Ausgänge, Hidden, Lernrate, T, [Trainierbar], ...
  const numIn = rows[1], numOut = rows[2], hid = rows[3];
  numIn.value = '2'; numIn.dispatchEvent(new Event('input', { bubbles: true }));
  numOut.value = '2'; numOut.dispatchEvent(new Event('input', { bubbles: true }));
  hid.value = '16'; hid.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.locator('#cvEdit .cv-edit-btns .btn-solid').first().click();
await page.waitForTimeout(200);
const arch = await page.evaluate(() => {
  const card = window.__trainrobot.canvas.graph.nodes.find(n => n.type === 'policy');
  return { nIn: card.nIn, nOut: card.nOut, hidden: card.hidden.join(','), net: window.__trainrobot.canvas.ppo.get(card.id).net.dims.join(',') };
});
ok(arch.nIn === 2 && arch.nOut === 2 && arch.hidden === '16', 'Architektur geändert (2→16→2)', JSON.stringify(arch));
ok(arch.net === '2,16,2', 'Netz an Architektur angepasst', arch.net);

// ── 3) Kabel via MCP-Werkzeug ──────────────────────────────
console.log('\n[3] Kabel (canvasGraph)');
const linkRes = await page.evaluate(async () => {
  const T = window.__trainrobot;
  const card = T.canvas.graph.nodes.find(n => n.type === 'policy');
  const nu = T.sim.nu;
  const vIdx = 2 * nu + 4; // "Fahrt vorwärts" (Speed-Task)
  const r1 = await T.execTool('canvasGraph', { cmd: 'link', from: { node: 'io', port: vIdx }, to: { node: card.id, port: 0 } });
  const r2 = await T.execTool('canvasGraph', { cmd: 'link', from: { node: 'io', port: T.canvas.graph._ioCount - 2 }, to: { node: card.id, port: 1 } }); // Stick X
  const r3 = await T.execTool('canvasGraph', { cmd: 'link', from: { node: card.id, port: 0 }, to: { node: 'out', port: 0 } });
  const r4 = await T.execTool('canvasGraph', { cmd: 'link', from: { node: card.id, port: 1 }, to: { node: 'out', port: 1 } });
  const r5 = await T.execTool('canvasGraph', { cmd: 'link', from: { node: card.id, port: 0 }, to: { node: card.id, port: 1 } });
  return { r1, r2, r3, r4, r5, wires: document.querySelectorAll('#cvWires .cv-wire:not(.cv-wtemp)').length, links: T.canvas.graph.links.length, vIdxName: T.canvas._obsNames[vIdx] };
});
ok(/Kabel gesetzt/.test(linkRes.r1) && /Stick/.test(linkRes.vIdxName) === false, 'canvasGraph link: Sensor → Karte', linkRes.r1.slice(0, 60));
ok(/Kabel gesetzt/.test(linkRes.r3) && /Kabel gesetzt/.test(linkRes.r4), 'Karte → Aktuatoren out[0]/out[1]');
ok(/Fehler/.test(linkRes.r5), 'Karte → sich selbst abgelehnt', linkRes.r5.slice(0, 50));
ok(linkRes.links === 4, '4 Kabel im Graph', String(linkRes.links));
ok(linkRes.wires === 4, '4 Kabel-Pfade im SVG gerendert', String(linkRes.wires));

// ── 4) Modus CANVAS (Ausführen) ────────────────────────────
console.log('\n[4] AUSFÜHREN (Modus CANVAS)');
const runRes = await page.evaluate(() => window.__trainrobot.execTool('canvasRun', { run: true }));
ok(/CANVAS aktiv/.test(runRes), 'canvasRun run:true', runRes.slice(0, 60));
ok(await page.evaluate(() => window.__trainrobot.mode === 'canvas'), 'S.mode === canvas');
ok(await page.evaluate(() => document.getElementById('stMode').textContent === 'CANVAS'), 'Statuszeile zeigt CANVAS');
ok(await page.evaluate(() => document.getElementById('modeCanvas').classList.contains('active')), 'CANVAS-Chip aktiv');
// Roboter läuft ein paar Sekunden im Canvas-Modus
await page.waitForTimeout(1500);
const runState = await page.evaluate(() => {
  const T = window.__trainrobot;
  const ctrl = Array.from(T.sim.ctrl);
  return { finit: ctrl.every(Number.isFinite), ctrl0: ctrl[0], key0: T.sim.keyCtrl[0], diffs: ctrl.filter((v, i) => Math.abs(v - T.sim.keyCtrl[i]) > 1e-9).length };
});
ok(runState.finit, 'Canvas-Modus: ctrl finit nach 1,5 s');
ok(runState.diffs >= 0, 'Aktuatoren beschrieben', runState.diffs + ' abweichend von Keyframe');
// AUSFÜHREN-Button zeigt STOPP
ok(await page.evaluate(() => /STOPP/.test(document.getElementById('cvRun').textContent)), 'AUSFÜHREN-Button zeigt STOPP');

// ── 5) Canvas-TRAINING ─────────────────────────────────────
console.log('\n[5] TRAINIEREN (PPO je Karte)');
const trainRes = await page.evaluate(() => window.__trainrobot.execTool('canvasRun', { train: true }));
ok(/TRAINING gestartet/.test(trainRes), 'canvasRun train:true', trainRes.slice(0, 60));
await page.waitForTimeout(2500);
const trainState = await page.evaluate(() => {
  const b = window.__trainrobot.canvas;
  const card = b.graph.nodes.find(n => n.type === 'policy');
  const p = b.ppo.get(card.id);
  return { training: b.training, steps: p.stepCount, updates: p.updateCount, boardSteps: b.stats.steps, episodes: b.stats.episodes, mode: window.__trainrobot.mode, finit: Array.from(window.__trainrobot.sim.ctrl).every(Number.isFinite) };
});
ok(trainState.training && trainState.mode === 'canvas', 'Training läuft im CANVAS-Modus');
ok(trainState.boardSteps >= 5, 'Board sammelt Trainingsschritte', String(trainState.boardSteps));
ok(trainState.steps >= 5, 'Karten-PPO sammelt Schritte', String(trainState.steps) + ' · Updates ' + trainState.updates);
ok(trainState.finit, 'ctrl bleibt finit im Training');
const trainStop = await page.evaluate(() => window.__trainrobot.execTool('canvasRun', { train: false }));
ok(/pausiert/.test(trainStop), 'Training pausierbar', trainStop.slice(0, 40));

// ── 6) UI-Element ──────────────────────────────────────────
console.log('\n[6] canvasUI — Slider als Eingang');
const uiRes = await page.evaluate(() => window.__trainrobot.execTool('canvasUI', { kind: 'slider', label: 'Boost', name: 'Boost' }));
ok(/bereit/.test(uiRes) && /slider/.test(uiRes), 'canvasUI erstellt Slider', uiRes.slice(0, 80));
const uiState1 = await page.evaluate(() => {
  const b = window.__trainrobot.canvas;
  const ui = b.graph.nodes.find(n => n.type === 'ui');
  const card = b.graph.nodes.find(n => n.type === 'policy');
  // Slider statt Stick auf Karte-Eingang 1 kabeln
  window.__trainrobot.execTool('canvasGraph', { cmd: 'link', from: { node: ui.id, port: 0 }, to: { node: card.id, port: 1 } });
  return { id: ui.id, widgets: document.querySelectorAll('#canvasUIBar .cv-uiel').length, barVisible: !document.getElementById('canvasUIBar').classList.contains('hidden') };
});
ok(uiState1.widgets >= 1, 'UI-Widget in der Leiste', uiState1.widgets + ' Elemente');
// Modus canvas aktiv? run war true → bar sichtbar
ok(uiState1.barVisible, 'CANVAS-UI-Leiste sichtbar');
// Slider hochziehen → Wert fließt (ctrl[1] ändert sich)
await page.locator('#canvasUIBar input[type="range"]').first().evaluate((el) => {
  el.value = '1';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(700);
const uiEffect = await page.evaluate(() => {
  const b = window.__trainrobot.canvas;
  const ui = b.graph.nodes.find(n => n.type === 'ui');
  return { slider: ui.state.value, ctrl1: window.__trainrobot.sim.ctrl[1] };
});
ok(uiState1 && uiEffect.slider === 1, 'Slider-State übernommen', 'value=' + uiEffect.slider);
ok(Number.isFinite(uiEffect.ctrl1), 'Karten-Eingang empfängt Slider-Wert (ctrl finit)');

// ── 7) canvasReward + Zurück zu MANUELL ────────────────────
console.log('\n[7] canvasReward + Stop');
const rwRes = await page.evaluate(() => window.__trainrobot.execTool('canvasReward', { card: 'alle', mode: 'custom', w: { alive: 0.4, up: 1, vel: 0.5, fall: 2 } }));
ok(/EIGENE Formel|custom/.test(rwRes) && /alive/.test(rwRes), 'canvasReward setzt eigene Formel', rwRes.slice(0, 90));
const stopRes = await page.evaluate(() => window.__trainrobot.execTool('canvasRun', { run: false }));
ok(/MANUELL/.test(stopRes), 'canvasRun run:false → MANUELL');
ok(await page.evaluate(() => window.__trainrobot.mode === 'manuell'), 'Modus ist MANUELL');
ok(await page.evaluate(() => document.getElementById('canvasUIBar').classList.contains('hidden')), 'UI-Leiste versteckt nach Modus-Ende');

// ── 8) Persistenz ──────────────────────────────────────────
console.log('\n[8] Persistenz');
const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('tr_canvas_v2_g1');
  if (!raw) return null;
  const d = JSON.parse(raw);
  return { nodes: d.nodes.length, policies: d.nodes.filter(n => n.type === 'policy').length, links: d.links.length, ui: d.nodes.filter(n => n.type === 'ui').length };
});
ok(!!persisted && persisted.policies === 1 && persisted.ui === 1, 'Graph im localStorage (je Roboter)', JSON.stringify(persisted));
ok(persisted && persisted.links >= 4, 'Kabel gespeichert', String(persisted.links));

// canvasGraph state für Gemini
const st = await page.evaluate(() => window.__trainrobot.execTool('canvasGraph', { cmd: 'state' }));
ok(/"nodes"/.test(st) && /"links"/.test(st) && /"portNamen"/.test(st), 'canvasGraph state liefert Graph-JSON');

// ── 9) Fehler ──────────────────────────────────────────────
console.log('\n[9] Seitenfehler');
ok(errs.length === 0, 'Keine Seiten-/Konsolenfehler', errs.length ? errs.slice(0, 3).join(' | ').slice(0, 300) : '');
await browser.close();
server.close();

console.log('\n════════════════════════════════');
console.log(`ERGEBNIS: ${pass} grün, ${fail} rot`);
process.exit(fail ? 1 : 0);
