// ui_v2180_test.mjs — v2.18.0 Canvas VOLLBILD + MULTI-TOUCH (Playwright + CDP-Touch):
//   1) Vollbild: #canvasSheet füllt den ganzen Viewport (kein Bottom-Sheet), kein sheet-grab
//   2) Gesten-Hinweis #cvGesture sichtbar
//   3) Pinch-ZOOM: 2 Finger auseinander/zusammen → Zoom um Finger-MITTE (Weltpunkt unter Mitte bleibt)
//   4) Zwei-Finger-PAN: beide Finger bewegen → Translate folgt exakt
//   5) Finger-Wechsel: nach touchEnd eines Fingers pannt der Restfinger SPRUNGWEI frei
//   6) Wheel-Zoom um Cursor + Zoom-Buttons um Fläche-Mitte
//   7) fitView zeigt alle Karten wieder
//   8) Karten-Drag mit 1 Finger + Drag-Lock (zweiter Finger startet keinen Zweitzug)
//   9) cvClose schließt + body.cv-open Flag sauber
//  10) Keine Seitenfehler
// Usage: node scripts/ui_v2180_test.mjs
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
const near = (a, b, eps = 2.5) => Math.abs(a - b) <= eps;

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

// Pointer-Event-Helfer (synthetische PointerEvents mit pointerId — Multi-Touch-Kette,
// identische Handler-Logik wie im echten WebView-Touch; untrusted, aber Handler prüfen das nicht)
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
const view = () => page.evaluate(() => { const v = window.__trainrobot.canvas.graph.view; return { x: v.x, y: v.y, z: v.z }; });
const worldPt = (sx, sy, v, r) => ({ x: (sx - r.left - v.x) / v.z, y: (sy - r.top - v.y) / v.z });

// ── 1) Vollbild-Geometrie ───────────────────────────────────
console.log('\n[1] VOLLBILD');
await page.click('#btnCanvas');
await page.waitForTimeout(350);
const geo = await page.evaluate(() => {
  const sheet = document.getElementById('canvasSheet');
  const vp = document.getElementById('cvPort');
  const r = sheet.getBoundingClientRect(), vr = vp.getBoundingClientRect();
  return {
    w: r.width, h: r.height, left: r.left, top: r.top,
    iw: innerWidth, ih: innerHeight,
    grab: !!sheet.querySelector('.sheet-grab'),
    vh: vr.height, vhFrac: vr.height / innerHeight,
    gesture: (() => { const g = document.getElementById('cvGesture'); return g ? g.offsetHeight > 0 : false; })(),
    touchAction: getComputedStyle(vp).touchAction,
    dvh: sheet.style.height,
  };
});
ok(near(geo.w, geo.iw) && near(geo.h, geo.ih) && geo.left === 0 && geo.top === 0, 'Sheet füllt GANZEN Viewport', `${geo.w}×${geo.h} @(${geo.left},${geo.top}) vs ${geo.iw}×${geo.ih}`);
ok(!geo.grab, 'Kein sheet-grab mehr (kein Bottom-Sheet)');
ok(geo.vhFrac > 0.5, 'Viewport-Fläche > 50 % der Höhe', (geo.vhFrac * 100).toFixed(0) + ' %');
ok(geo.gesture, 'Gesten-Hinweis #cvGesture sichtbar');
ok(geo.touchAction === 'none', 'touch-action:none auf Viewport (keine Browser-Gesten)', geo.touchAction);

// ── 2) Pinch-ZOOM um Finger-Mitte ───────────────────────────
console.log('\n[2] PINCH-ZOOM (2 Finger)');
const vpR = await page.evaluate(() => document.getElementById('cvPort').getBoundingClientRect());
const CX = Math.round(vpR.left + vpR.width / 2), CY = Math.round(vpR.top + vpR.height * 0.45);
const bg = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return el ? (el.id + ' ' + el.className) : 'null';
}, [CX, CY]);
ok(/cv-world|cv-viewport|cv-wires|cv-gesture|cvWorld/.test(String(bg)), 'Testpunkt liegt auf leerer Fläche', String(bg));
const v0 = await view();
const wA = worldPt(CX, CY, v0, vpR);
// Pinch: Finger auseinander (60 → 120 px), Mitte bleibt EXAKT (CX,CY)
await pev('pointerdown', CX - 30, CY, 1);
await pev('pointerdown', CX + 30, CY, 2);
await pev('pointermove', CX - 30, CY, 1);
await pev('pointermove', CX + 30, CY, 2); // Leer-Move → Baseline: Mitte CX, dist 60
await pev('pointermove', CX - 60, CY, 1);
await pev('pointermove', CX + 60, CY, 2); // dist 120 → Faktor 2,0
const v1 = await view();
ok(v1.z > v0.z * 1.8, 'Auseinanderziehen zoomt HEREin', `z ${v0.z.toFixed(3)} → ${v1.z.toFixed(3)}`);
const wB = worldPt(CX, CY, v1, vpR);
ok(near(wA.x, wB.x, 1.5) && near(wA.y, wB.y, 1.5), 'Weltpunkt unter Finger-Mitte bleibt fix', `Δ(${(wB.x - wA.x).toFixed(2)},${(wB.y - wA.y).toFixed(2)})`);
// Zusammenziehen → raus
await pev('pointermove', CX - 20, CY, 1);
await pev('pointermove', CX + 20, CY, 2);
const v2 = await view();
ok(v2.z < v1.z && v2.z >= 0.22, 'Zusammenziehen zoomt RAUS (Klemme 0,22)', `z=${v2.z.toFixed(3)}`);
await pev('pointerup', CX + 20, CY, 1);
await pev('pointerup', CX + 20, CY, 2);
const v2b = await view();
ok(near(v2b.z, v2.z, 0.001) && near(v2b.x, v2.x, 0.001), 'pointerup ändert View nicht mehr');

// ── 3) Zwei-Finger-PAN ───────────────────────────────────────
console.log('\n[3] ZWEI-FINGER-PAN');
const v3 = await view();
const wC = worldPt(CX, CY, v3, vpR);
await pev('pointerdown', CX - 25, CY + 10, 11);
await pev('pointerdown', CX + 25, CY + 10, 12);
await pev('pointermove', CX - 25, CY + 10, 11);
await pev('pointermove', CX + 25, CY + 10, 12); // Baseline
await pev('pointermove', CX - 45, CY - 20, 11);
await pev('pointermove', CX + 5, CY - 20, 12); // Mitte: (-20,-30)
const v4 = await view();
ok(near(v4.x - v3.x, -20, 1.5) && near(v4.y - v3.y, -30, 1.5), 'Translate folgt Finger-MITTE exakt', `Δ(${(v4.x - v3.x).toFixed(1)},${(v4.y - v3.y).toFixed(1)}) erwartet (-20,-30)`);
const wD = worldPt(CX - 20, CY - 30, v4, vpR);
ok(near(wC.x, wD.x, 1.5) && near(wC.y, wD.y, 1.5), 'Zoom unverändert beim reinen Pan', `z ${v3.z.toFixed(3)}→${v4.z.toFixed(3)}`);

// ── 4) Finger-Wechsel: Restfinger pannt sprungfrei ──────────
console.log('\n[4] FINGER-WECHSEL');
await pev('pointerup', CX - 45, CY - 20, 11); // Finger 1 hoch — F2 bleibt
await page.waitForTimeout(60);
const v5 = await view();
await pev('pointermove', CX + 45, CY - 20, 12); // Restfinger +40/+0
const v6 = await view();
ok(near(v6.x - v5.x, 40, 1.5) && near(v6.y - v5.y, 0, 1.5), 'Rest-Finger pannt OHNE Sprung', `Δ(${(v6.x - v5.x).toFixed(1)},${(v6.y - v5.y).toFixed(1)})`);
await pev('pointerup', CX + 45, CY - 20, 12);

// ── 5) Wheel-Zoom + Buttons ─────────────────────────────────
console.log('\n[5] WHEEL + BUTTONS');
await page.mouse.move(CX, CY);
const v7 = await view();
const wE = worldPt(CX, CY, v7, vpR);
await page.mouse.wheel(0, -240); // hoch = rein
const v8 = await view();
ok(v8.z > v7.z * 1.05, 'Wheel hoch zoomt rein', `${v7.z.toFixed(3)} → ${v8.z.toFixed(3)}`);
const wF = worldPt(CX, CY, v8, vpR);
ok(near(wE.x, wF.x, 1.5) && near(wE.y, wF.y, 1.5), 'Wheel zoomt um Cursor (Punkt fix)');
await page.click('#cvZoomIn');
const v9 = await view();
ok(v9.z > v8.z * 1.1, 'Button + zoomt', `${v8.z.toFixed(3)} → ${v9.z.toFixed(3)}`);
const midPt0 = worldPt(Math.round(vpR.left + vpR.width / 2), Math.round(vpR.top + vpR.height / 2), v8, vpR);
const midPt1 = worldPt(Math.round(vpR.left + vpR.width / 2), Math.round(vpR.top + vpR.height / 2), v9, vpR);
ok(near(midPt0.x, midPt1.x, 1.5) && near(midPt0.y, midPt1.y, 1.5), 'Button zoomt um Fläche-MITTE');
await page.click('#cvZoomOut');
await page.click('#cvZoomOut');
const v10 = await view();
ok(v10.z < v9.z, 'Button − zoomt raus');

// ── 6) fitView ──────────────────────────────────────────────
console.log('\n[6] FIT');
await page.evaluate(() => window.__trainrobot.canvas.zoomBy(0.4)); // weit raus
await page.click('#cvFit');
await page.waitForTimeout(120);
const fit = await page.evaluate(() => {
  const vp = document.getElementById('cvPort').getBoundingClientRect();
  const ids = ['io', 'out'];
  let inside = 0, total = 0;
  for (const el of document.querySelectorAll('#cvWorld .cv-node')) {
    total++;
    const r = el.getBoundingClientRect();
    const over = Math.min(r.right, vp.right) - Math.max(r.left, vp.left);
    const overY = Math.min(r.bottom, vp.bottom) - Math.max(r.top, vp.top);
    if (over > 10 && overY > 10) inside++;
  }
  return { inside, total, z: window.__trainrobot.canvas.graph.view.z };
});
ok(fit.inside === fit.total && fit.total >= 2, '⤢ zeigt ALLE Karten (' + fit.total + ') im Viewport', `${fit.inside}/${fit.total}, z=${fit.z.toFixed(2)}`);

// ── 7) Karten-Drag + Drag-Lock ──────────────────────────────
console.log('\n[7] KARTEN-DRAG + LOCK');
const card = await page.evaluate(() => {
  const T = window.__trainrobot;
  const b = T.canvas;
  let nd = b.graph.nodes.find(n => n.type === 'policy');
  if (!nd) {
    const res = T.execTool('canvasGraph', { cmd: 'add', type: 'policy', nIn: 2, nOut: 2, hidden: [16], name: 'DragTest' });
    nd = b.graph.nodes.find(n => n.type === 'policy');
  }
  if (nd) { b.fitView(); b.render(); }
  return nd ? { id: nd.id, x: nd.x, y: nd.y } : null;
});
await page.waitForTimeout(200);
if (!card) { ok(false, 'Karte vorhanden', '— keine policy-Karte im Graph'); }
else {
  await page.evaluate(() => { const b = window.__trainrobot.canvas; b.render(); });
  await page.waitForTimeout(120);
  const headP = await page.evaluate((id) => {
    const el = document.querySelector('.cv-node[data-id="' + id + '"] .cv-nhead');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), z: window.__trainrobot.canvas.graph.view.z };
  }, card.id);
  // 1 Finger: Karte ziehen (+30, +20 in Screen → /z in Welt)
  const headSel = '.cv-node[data-id="' + card.id + '"] .cv-nhead';
  const nodeSel = '.cv-node[data-id="' + card.id + '"]';
  await pev('pointerdown', headP.x, headP.y, 21, headSel);
  await pev('pointermove', headP.x + 30, headP.y + 20, 21, nodeSel);
  await pev('pointerup', headP.x + 30, headP.y + 20, 21, nodeSel);
  const dragged = await page.evaluate((id) => {
    const nd = window.__trainrobot.canvas.graph.nodes.find(n => n.id === id);
    return { x: nd.x, y: nd.y };
  }, card.id);
  ok(near(dragged.x - card.x, Math.round(30 / headP.z), 2) && near(dragged.y - card.y, Math.round(20 / headP.z), 2), '1-Finger zieht Karte (durch z geteilt)', `Δ(${(dragged.x - card.x).toFixed(1)},${(dragged.y - card.y).toFixed(1)}) @z=${headP.z.toFixed(2)}`);
  // Drag-Lock: zweiter Finger auf Kopf startet KEINEN Zweitzug
  const before = dragged;
  await pev('pointerdown', headP.x + 30, headP.y + 20, 21, headSel);
  await pev('pointerdown', headP.x + 30, headP.y + 20, 22, headSel);
  await pev('pointermove', headP.x + 80, headP.y + 60, 22, nodeSel); // nur F2 bewegt
  const mid = await page.evaluate((id) => {
    const nd = window.__trainrobot.canvas.graph.nodes.find(n => n.id === id);
    return { x: nd.x, y: nd.y };
  }, card.id);
  ok(near(mid.x, before.x, 0.01) && near(mid.y, before.y, 0.01), 'Zweiter Finger auf Kopf startet keinen Zweitzug (Lock)', `Δ(${(mid.x - before.x).toFixed(2)},${(mid.y - before.y).toFixed(2)})`);
  await pev('pointermove', headP.x + 30 + 20, headP.y + 20 + 10, 21, nodeSel); // F1 zieht weiter
  await pev('pointerup', headP.x + 30 + 20, headP.y + 20 + 10, 21, nodeSel);
  await pev('pointerup', headP.x + 80, headP.y + 60, 22, nodeSel);
  const after = await page.evaluate((id) => {
    const nd = window.__trainrobot.canvas.graph.nodes.find(n => n.id === id);
    return { x: nd.x, y: nd.y };
  }, card.id);
  ok(near(after.x - mid.x, Math.round(20 / headP.z), 2) && near(after.y - mid.y, Math.round(10 / headP.z), 2), 'Original-Finger zieht weiter (Lock räumt sauber auf)', `Δ(${(after.x - mid.x).toFixed(1)},${(after.y - mid.y).toFixed(1)})`);
}

// ── 8) Schließen + cv-open Flag ─────────────────────────────
console.log('\n[8] SCHLIESSEN');
ok(await page.evaluate(() => document.body.classList.contains('cv-open')), 'body.cv-open gesetzt bei offenem Canvas');
await page.click('#cvClose');
await page.waitForTimeout(350);
ok(await page.evaluate(() => !document.body.classList.contains('cv-open')), 'body.cv-open entfernt nach Schließen');
ok(await page.evaluate(() => document.getElementById('canvasSheet').classList.contains('hidden')), 'Sheet versteckt nach Schließen');
// Graph überlebt Schließen
ok(await page.evaluate(() => window.__trainrobot.canvas.graph.nodes.length >= 2), 'Graph bleibt je Roboter erhalten');

// ── 9) Seitenfehler ─────────────────────────────────────────
console.log('\n[9] FEHLER');
const realErrs = errs.filter(e => !/favicon|Slow network|GPU|swiftshader|GroupMarkerNotSet/i.test(e));
ok(realErrs.length === 0, 'Keine Seitenfehler', realErrs.slice(0, 3).join(' | '));

console.log(`\n═══ ERGEBNIS: ${pass} bestanden · ${fail} fehlgeschlagen ═══`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
