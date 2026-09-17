// ui_v2200_test.mjs — v2.20.0 Canvas UI (Playwright + synthetische PointerEvents):
//   1) + Logik-Button erstellt LOGIK-Karte (rosa, Ports a/b + y0, Kopf „+ · 2→1")
//   2) Listen-Bug weg: io-Knoten zeigt Ports in SPALTEN (≤ 20 Zeilen je Spalte),
//      .cv-nbody ohne max-height/overflow — untere Ports bleiben antippbar
//   3) Langdruck auf eine Kartenseite wählt alle FREIEN Ports (gelb, Banner an)
//   4) Langdruck auf andere Karte verbindet paarweise (Überzählige frei, Banner aus)
//   5) Bewegung beim Langdruck = kein Batch (Draht-Ziehen bleibt)
//   6) Hintergrund-Druck verwirft die Auswahl
//   7) Tap-Tap-Einzelkabel funktioniert weiter (Regression)
//   8) canvasGraph linkMany via execTool (Reparatur-Weg der KI)
//   9) Keine Seitenfehler
// Usage: node scripts/ui_v2200_test.mjs
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
const context = await browser.newContext({ viewport: { width: 420, height: 860 }, hasTouch: true });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.classList.contains('gone');
  }, null, { timeout: 120000 });
  ok(true, 'Boot abgeschlossen');
} catch (e) {
  ok(false, 'Boot abgeschlossen', '— Timeout');
}
await page.waitForFunction(() => !!(window.__trainrobot && window.__trainrobot.canvas), null, { timeout: 60000 }).catch(() => {});

async function pev(type, x, y, id, sel) {
  await page.evaluate(([type, x, y, id, sel]) => {
    const el = sel ? document.querySelector(sel) : document.getElementById('cvWorld');
    if (!el) return;
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1,
      width: 1, height: 1, pressure: (type === 'pointerup' || type === 'pointercancel') ? 0 : 0.5,
    }));
  }, [type, x, y, id, sel]);
  await page.waitForTimeout(25);
}

await page.click('#btnCanvas');
await page.waitForTimeout(350);

// sauberer Graph (Falls ein alter Stand Persistiert wäre)
await page.evaluate(() => window.__trainrobot.execTool('canvasGraph', { cmd: 'clear' }));
await page.waitForTimeout(150);

// ── 1) + Logik ──────────────────────────────────────────────
console.log('\n[1] LOGIK-KARTE via +Logik');
await page.click('#cvAddLogic');
await page.waitForTimeout(200);
const logicInfo = await page.evaluate(() => {
  const el = document.querySelector('.cv-node.cv-logic');
  if (!el) return null;
  const id = el.dataset.id;
  const sub = el.querySelector('.cv-nsub').textContent;
  const inRows = [...el.querySelectorAll('.cv-port[data-side="in"]')];
  const outRows = [...el.querySelectorAll('.cv-port[data-side="out"]')];
  return { id, sub, nIn: inRows.length, nOut: outRows.length, in0: inRows[0] && inRows[0].querySelector('.cv-plabel').textContent, out0: outRows[0] && outRows[0].querySelector('.cv-plabel').textContent, editOpen: !document.getElementById('cvEdit').classList.contains('hidden') };
});
ok(!!logicInfo, 'LOGIK-Karte erscheint rosa im Canvas');
ok(logicInfo && logicInfo.sub.includes('+') && /\u2192/.test(logicInfo.sub.replace('→', '\u2192')) && logicInfo.sub.includes('2') && logicInfo.sub.includes('1'), 'Kopf zeigt Operator + 2→1', logicInfo && logicInfo.sub);
ok(logicInfo && logicInfo.nIn === 2 && logicInfo.nOut === 1, 'Ports: 2 Eingänge (a,b) · 1 Ausgang');
ok(logicInfo && logicInfo.in0 === 'a' && logicInfo.out0 === 'y0', 'Logik-Port-Namen a… / y0');
ok(logicInfo && logicInfo.editOpen, 'Edit-Panel öffnet sich (Operator wählbar)');

// ── 2) Spalten statt Liste ──────────────────────────────────
console.log('\n[2] SPALTEN-LAYOUT (Listen-Bug weg)');
const colInfo = await page.evaluate(() => {
  const io = document.querySelector('.cv-node.cv-io');
  const body = io.querySelector('.cv-nbody');
  const cols = [...io.querySelectorAll('.cv-col')];
  const cs = getComputedStyle(body);
  return {
    ioPorts: window.__trainrobot.canvas.graph._ioCount || 0,
    colCount: cols.length,
    maxRows: Math.max(...cols.map(c => c.querySelectorAll('.cv-port').length)),
    maxHeight: cs.maxHeight, overflow: cs.overflowY,
  };
});
ok(colInfo.ioPorts > 20, 'io-Knoten hat > 20 Ports (früher Listen-Fall)', colInfo.ioPorts + ' Ports');
ok(colInfo.colCount >= 2, 'Ports laufen in MEHRERE Spalten', colInfo.colCount + ' Spalten');
ok(colInfo.maxRows <= 20, 'max. 20 Zeilen je Spalte (alles antippbar, kein Scroll)', 'max ' + colInfo.maxRows);
ok(colInfo.maxHeight === 'none' && colInfo.overflow === 'visible', '.cv-nbody ohne max-height/overflow (keine Liste mehr)', colInfo.maxHeight + ' / ' + colInfo.overflow);

// ── 3+4) Stapelverbindung per Langdruck ─────────────────────
console.log('\n[3/4] LANGDRUCK-STAPELVERBINDUNG');
// Zwei Karten anlegen: A (2→4) und B (3→2)
const addA = await page.evaluate(() => window.__trainrobot.execTool('canvasGraph', { cmd: 'add', type: 'policy', name: 'StapelA', nIn: 2, nOut: 4, hidden: [8] }));
const addB = await page.evaluate(() => window.__trainrobot.execTool('canvasGraph', { cmd: 'add', type: 'policy', name: 'StapelB', nIn: 3, nOut: 2, hidden: [8] }));
ok(/type=policy/.test(addA) && /type=policy/.test(addB), '2 Karten via execTool angelegt');
const posInfo = await page.evaluate(() => {
  const g = window.__trainrobot.canvas.graph;
  const find = (nm) => g.nodes.find(n => n.name === nm);
  const A = find('StapelA'), B = find('StapelB');
  // Positionen für synthische Events: Ports in SCREEN-Koordinaten holen
  const rect = (sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const aOut = rect(`.cv-node[data-id="${A.id}"] .cv-port[data-side="out"][data-port="0"] .dot`);
  const bIn = rect(`.cv-node[data-id="${B.id}"] .cv-port[data-side="in"][data-port="0"] .dot`);
  return { a: A.id, b: B.id, aOut, bIn };
});
ok(!!posInfo.aOut && !!posInfo.bIn, 'Port-Screen-Positionen gemessen');
// Wartehelfer: Page-Timer laufen unter SwiftShader-Last verzögert — auf ZUSTAND warten
const waitBatch = (want, timeout = 4000) => page.waitForFunction(
  (w) => { const b = window.__trainrobot.canvas._batch; return w ? !!b : !b; },
  want, { timeout }
).then(() => true).catch(() => false);
// Langdruck auf A.out (Port 0)
await pev('pointerdown', posInfo.aOut.x, posInfo.aOut.y, 21, `.cv-node[data-id="${posInfo.a}"] .cv-port[data-side="out"][data-port="0"]`);
const selOk = await waitBatch(true);
await pev('pointerup', posInfo.aOut.x, posInfo.aOut.y, 21);
// Banner-Text kann wenige ms hinter dem Batch-State liegen (Timer-Race) — aktiv warten
const bannerOk = await page.waitForFunction((aid) => {
  const b = document.getElementById('cvBatch');
  return b && b.classList.contains('on') && /freie AUSGÄNGE/.test(b.textContent);
}, posInfo.a, { timeout: 4000 }).then(() => true).catch(() => false);
await page.waitForTimeout(100);
const selInfo = await page.evaluate(([aid]) => {
  const sel = document.querySelectorAll(`.cv-node[data-id="${aid}"] .cv-port.cv-sel`);
  const banner = document.getElementById('cvBatch');
  const b = window.__trainrobot.canvas._batch;
  return { n: sel.length, bannerOn: banner.classList.contains('on'), bannerText: banner.textContent, batch: b ? { n: b.n, side: b.side, ports: b.ports } : null };
}, [posInfo.a]);
ok(selOk && selInfo.n === 4, '4 freie AUSGÄNGE leuchten gelb', selInfo.n + ' gewählt, Timer erkannt: ' + selOk);
ok(bannerOk && selInfo.bannerOn && /4 freie AUSGÄNGE/.test(selInfo.bannerText), 'Banner zeigt Auswahl', selInfo.bannerText);
ok(selInfo.batch && selInfo.batch.side === 'out' && selInfo.batch.ports.length === 4, 'Batch-Zustand korrekt');
// Langdruck auf B.in → verbinden
await pev('pointerdown', posInfo.bIn.x, posInfo.bIn.y, 22, `.cv-node[data-id="${posInfo.b}"] .cv-port[data-side="in"][data-port="0"]`);
const doneOk = await waitBatch(false); // Verbindung leert die Auswahl
await pev('pointerup', posInfo.bIn.x, posInfo.bIn.y, 22);
await page.waitForTimeout(150);
const doneInfo = await page.evaluate(([aid, bid]) => {
  const g = window.__trainrobot.canvas.graph;
  const links = g.links.filter(l => l.from.n === aid && l.to.n === bid);
  return {
    pairs: links.map(l => l.from.port + '>' + l.to.port).sort(),
    selLeft: document.querySelectorAll(`.cv-node[data-id="${aid}"] .cv-port.cv-sel`).length,
    bannerOn: document.getElementById('cvBatch').classList.contains('on'),
    bannerText: document.getElementById('cvBatch').textContent,
  };
}, [posInfo.a, posInfo.b]);
ok(doneOk && doneInfo.pairs.join(',') === '0>0,1>1,2>2', '3 Paare verbunden (A hat 4, B 3 → Überzähliger frei)', JSON.stringify(doneInfo.pairs));
ok(doneInfo.selLeft === 0, 'Port-Auswahl nach Verbindung geleert');
ok(!doneInfo.bannerOn || /VERBUNDEN/.test(doneInfo.bannerText || ''), 'Banner: leer ODER Erfolgs-Meldung (2,2 s)', doneInfo.bannerText || 'aus');

// ── 5) Bewegung bricht Langdruck ab ─────────────────────────
console.log('\n[5] BEWEGUNG bricht Langdruck ab');
await pev('pointerdown', posInfo.aOut.x, posInfo.aOut.y, 23, `.cv-node[data-id="${posInfo.a}"] .cv-port[data-side="out"][data-port="3"]`);
await pev('pointermove', posInfo.aOut.x + 40, posInfo.aOut.y + 40, 23); // > 14 px → Abbruch
await page.waitForTimeout(1300); // weit über die 550 ms — Timer bleibt tot
await pev('pointerup', posInfo.aOut.x + 40, posInfo.aOut.y + 40, 23);
await page.waitForTimeout(100);
const movedInfo = await page.evaluate(() => ({ batch: !!window.__trainrobot.canvas._batch, links: window.__trainrobot.canvas.graph.links.length }));
ok(!movedInfo.batch, 'Ziehen ≠ Auswahl (kein Batch-State)', String(movedInfo.batch));
ok(movedInfo.links === 3, 'keine Kabel durch abgebrochenen Langdruck', String(movedInfo.links));

// ── 6) Hintergrund verwirft Auswahl ─────────────────────────
console.log('\n[6] HINTERGRUND verwirft Auswahl');
await page.evaluate(() => { const g = window.__trainrobot.canvas.graph; g.view.x = 0; g.view.y = 0; g.view.z = 0.85; window.__trainrobot.canvas._viewApply(); });
await page.waitForTimeout(80);
// A.out lang drücken (Auswahl setzen) — Event geht direkt an cvWorld (target = Fläche,
// kein Karten-Treffer nötig: _worldDown prüft e.target, nicht elementFromPoint)
await pev('pointerdown', posInfo.aOut.x, posInfo.aOut.y, 24, `.cv-node[data-id="${posInfo.a}"] .cv-port[data-side="out"][data-port="3"]`);
const sel1 = await waitBatch(true);
await pev('pointerup', posInfo.aOut.x, posInfo.aOut.y, 24);
// Hintergrund-Druck (direkt auf cvWorld dispatcht — target ist die Fläche)
await pev('pointerdown', 10, 10, 25);
await pev('pointerup', 10, 10, 25);
const sel2 = await waitBatch(false);
ok(sel1, 'Auswahl aktiv vor Hintergrund-Druck');
ok(sel2, 'Hintergrund-Druck verwirft die Auswahl');

// ── 7) Tap-Tap-Einzelkabel (Regression) ─────────────────────
console.log('\n[7] TAP-TAP Einzelkabel (Regression)');
const tapInfo = await page.evaluate(() => {
  const g = window.__trainrobot.canvas.graph;
  const A = g.nodes.find(n => n.name === 'StapelA');
  const r = document.querySelector(`.cv-node[data-id="${A.id}"] .cv-port[data-side="out"][data-port="3"] .dot`).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, aid: A.id };
});
await pev('pointerdown', tapInfo.x, tapInfo.y, 26, `.cv-node[data-id="${tapInfo.aid}"] .cv-port[data-side="out"][data-port="3"]`);
await pev('pointerup', tapInfo.x, tapInfo.y, 26);
const out0 = await page.evaluate(() => {
  const r = document.querySelector('.cv-node[data-id="out"] .cv-port[data-side="in"][data-port="0"] .dot').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await pev('pointerdown', out0.x, out0.y, 27, '.cv-node[data-id="out"] .cv-port[data-side="in"][data-port="0"]');
await pev('pointerup', out0.x, out0.y, 27);
await page.waitForTimeout(120);
const tapLink = await page.evaluate(([aid]) => {
  const g = window.__trainrobot.canvas.graph;
  return g.links.some(l => l.from.n === aid && l.from.port === 3 && l.to.n === 'out' && l.to.port === 0);
}, [tapInfo.aid]);
ok(tapLink, 'Tap A.out3 → Tap out.0 verbindet EIN Kabel (Rest unberührt)');

// ── 8) linkMany via execTool ────────────────────────────────
console.log('\n[8] canvasGraph linkMany (KI-Reparaturweg)');
const lm = await page.evaluate(() => window.__trainrobot.execTool('canvasGraph', {
  cmd: 'linkMany',
  links: [
    { from: { node: 'io', port: 0 }, to: { node: 'StapelA', port: 0 } },
    { from: { node: 'io', port: 1 }, to: { node: 'StapelA', port: 1 } },
    { from: { node: 'Geist', port: 0 }, to: { node: 'StapelB', port: 0 } },
  ],
}));
ok(/Kabel gesetzt: 2\/3/.test(lm) && /FEHLGESCHLAGEN/.test(lm) && /Geist/.test(lm), 'linkMany: 2 ok + 1 Fehler im Report', lm.slice(0, 90));
const st = await page.evaluate(async () => {
  const d = JSON.parse(await window.__trainrobot.execTool('canvasGraph', { cmd: 'state' }));
  const io = d.nodes.find(n => n.id === 'io');
  const a = d.nodes.find(n => n.name === 'StapelA');
  return { ioPorts: io.portsList.length, used0: io.portsList[0].used, freeOut: a.freeOut };
});
ok(st.ioPorts > 20 && st.used0 === true, 'state: io portsList mit used-Flag', st.ioPorts + ' Ports, Port0 belegt');
ok(Array.isArray(st.freeOut) && st.freeOut.length === 0, 'state: StapelA freeOut leer (alle 4 verkabelt)', JSON.stringify(st.freeOut));

// ── 9) Seitenfehler ─────────────────────────────────────────
console.log('\n[9] Seitenfehler');
ok(errs.length === 0, 'keine Seiten-/Konsolen-Fehler', errs.slice(0, 3).join(' | '));

console.log('\n════════════════════════════════');
console.log(`ERGEBNIS: ${pass} grün, ${fail} rot`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
