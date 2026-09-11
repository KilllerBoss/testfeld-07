/* Browser-Smoke (mjonly): duck ready → Arm-MJ (IK + STL-Rig) → OP3-MJ (stehen/gehen).
 * Cookie-Polling für Readiness (Task-9-Muster), evaluate im mjonly-Modus (kein rAF-Sättigung). */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const T0 = Date.now();
  const t = () => ((Date.now() - T0) / 1000).toFixed(1);
  page.on('pageerror', (e) => console.log(`[${t()}s] PAGEERROR: ${String(e && e.message || e).slice(0, 200)}`));

  await page.goto('http://localhost:8788/index.html?mjonly=1');
  const ev = (ms) => new Promise((res) => setTimeout(res, ms));

  let ready = false, err = null;
  for (let i = 0; i < 120 && !ready && !err; i++) {
    await ev(1000);
    try {
      const cks = await context.cookies('http://localhost:8788');
      const get = (n) => { const c = cks.find((c) => c.name === n); return c ? decodeURIComponent(c.value) : null; };
      err = get('tf07mjerr');
      /* v1.2: BEREIT = Modell bereit (Policies laden im Hintergrund weiter,
       * letzte Stage ist dann 'POLICIES n/4' — beides zählt als bereit). */
      const stg = get('tf07mj') || '';
      ready = stg === 'BEREIT' || stg.indexOf('POLICIES') === 0;
      if (i % 10 === 0) console.log(`[${t()}s] stage=${get('tf07mj')} err=${err}`);
    } catch (e) { /* ignorieren */ }
  }
  if (!ready) { console.log('MJ nicht bereit, err=', err); await browser.close(); process.exit(1); }
  console.log(`[${t()}s] MuJoCo bereit (duck)`);

  // --- Arm laden (lazy) ---
  await page.evaluate(() => TF07.inst.setRobot('arm'));
  let armOk = false;
  for (let i = 0; i < 60 && !armOk; i++) {
    await ev(1000);
    armOk = await page.evaluate(() => !!(TF07.inst.state.mjc.arm && TF07.mjc.hasRobot('arm')));
  }
  if (!armOk) { console.log('Arm nicht geladen'); await browser.close(); process.exit(1); }
  console.log(`[${t()}s] Arm-MJ geladen:`, await page.evaluate(() => JSON.stringify(TF07.mjc.robotInfo('arm'))));

  // Mesh-Rig: STL-Visuals im echten GL hochgeladen?
  await ev(3000);
  const meshCount = await page.evaluate(() => {
    const rig = TF07.inst.state.mjc.armRig;
    const count = (n) => { let c = n.mesh ? 1 : 0; for (const k of n.children) c += count(k); return c; };
    return count(rig.root);
  });
  console.log(`[${t()}s] Arm-Mesh-Nodes im Szenengraph:`, meshCount);

  // IK-Lauf: Ziel = Ball, 200 Regelschritte
  const armRes = await page.evaluate(async () => {
    const a = TF07.inst.state.mjc.arm;
    const bp = a.ballPos();
    a.target = [bp[0] - 0.02, bp[1], 0.07];
    for (let i = 0; i < 200; i++) await a.controlStepAsync(false, null);
    const e = a.eePos();
    return { dist: Math.hypot(e[0] - a.target[0], e[1] - a.target[1], e[2] - a.target[2]), fit: a.fit, finite: a.data.qpos.every(isFinite) };
  });
  console.log(`[${t()}s] Arm IK: dist=${armRes.dist.toFixed(3)} fit=${armRes.fit.toFixed(2)} finite=${armRes.finite}`);

  // --- Humanoid laden ---
  await page.evaluate(() => TF07.inst.setRobot('humanoid'));
  let humOk = false;
  for (let i = 0; i < 60 && !humOk; i++) {
    await ev(1000);
    humOk = await page.evaluate(() => !!(TF07.inst.state.mjc.hum && TF07.mjc.hasRobot('hum')));
  }
  if (!humOk) { console.log('Hum nicht geladen'); await browser.close(); process.exit(1); }
  console.log(`[${t()}s] OP3-MJ geladen:`, await page.evaluate(() => JSON.stringify(TF07.mjc.robotInfo('hum'))));

  const humRes = await page.evaluate(async () => {
    const h = TF07.inst.state.mjc.hum;
    h.reset();
    for (let i = 0; i < 400; i++) await h.controlStepAsync(null);   // 8 s stehen
    const zStand = h.data.qpos[2];
    h.reset(); h.mode = 'gehen';
    const x0 = h.data.qpos[0];
    for (let i = 0; i < 500; i++) await h.controlStepAsync(null);   // 10 s gehen
    return { zStand, dx: h.data.qpos[0] - x0, finite: h.data.qpos.every(isFinite) };
  });
  console.log(`[${t()}s] OP3: zStand=${humRes.zStand.toFixed(3)} dx(10 s gehen)=${humRes.dx.toFixed(3)} finite=${humRes.finite}`);

  const ok = armRes.dist < 0.03 && armRes.finite && humRes.finite && humRes.zStand > 0.2 && meshCount >= 10;
  console.log(ok ? 'BROWSER-SMOKE GRÜN' : 'BROWSER-SMOKE FEHLER');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('SMOKE FEHLGESCHLAGEN:', e.message); process.exit(1); });
