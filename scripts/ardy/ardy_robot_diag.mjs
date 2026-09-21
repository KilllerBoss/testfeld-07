// ═══════════════════════════════════════════════════════════
// ardy_robot_diag.mjs — v2.28.5-Diagnose: „Roboter zappelt/schlägt/springt/fällt
// bei ARDY" (Nutzer-Report 2026-09-21) + „Geist-Physik?" + „Skeleton zu groß?"
//
// Misst an der ECHTEN Kette (App-Code, echtes fp32-Modell, echte G1-MuJoCo-Sim):
//   A) q_ref-Timeline-Qualität (ARDY vs synthetischer GLB-Walk):
//      - Gelenkwinkel-Raten (rad/s): p50/p95/max — kann der G1 das folgen?
//      - Limit-Sättigung (Anteil an actRange-Klemmen)
//      - h/root/yaw-Sprünge
//   B) PHYSIK-FAHRTEST (der direkte Beweis): q_ref als Sollwinkel an die
//      G1-Positionaktoren (idealer Tracker, dieselbe 0,6 s-Blend wie die App)
//      → Überlebenszeit (upz ≥ 0,5), Tracking-Fehler RMS, Endlage.
//      ARDY vs GLB unter IDENTISCHEN Bedingungen.
// Usage: node scripts/ardy/ardy_robot_diag.mjs   (CWD egal)
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ort from 'onnxruntime-node';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const HERE = path.dirname(fileURLToPath(import.meta.url));

// models/-fetch auf lokale Dateien umleiten (wie qpos_v2220_test)
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.startsWith('models/')) {
    const buf = await readFileSync(path.join(WWW, url));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

// ── Echte G1-Sim (wie qpos_v2220_test) ─────────────────────
const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readBuf(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { retargetToRobot } = await import(path.join(WWW, 'js/retarget.js'));
const { GlbClip } = await import(path.join(WWW, 'js/glb.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { ArdyRuntime, setOrtTensorClass } = await import(path.join(WWW, 'js/ardy.js'));
const { BertWordPiece } = await import(path.join(WWW, 'js/ardytoken.js'));
const { walkClip } = await import(path.join(ROOT, 'scripts/_synthglb.mjs'));

async function readBuf(p) { return await readFileSync(p); }

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_diag.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_diag.xml');
const nu = sim.nu;
console.log('■ G1-Sim bereit (nu=' + nu + ', dt=' + sim.timestep + ' s)');

// ── Referenz-Timeline-Statistik ─────────────────────────────
function motionStats(name, motion) {
  const { q, h, root, yaw, n, fps } = motion;
  const dt = 1 / fps;
  // Winkel-Raten je Frame-Paar (max über Kanäle) — rad/s
  const rates = [];
  for (let f = 0; f < n - 1; f++) {
    let mx = 0;
    for (let j = 0; j < nu; j++) {
      const d = Math.abs(q[(f + 1) * nu + j] - q[f * nu + j]) / dt;
      if (d > mx) mx = d;
    }
    rates.push(mx);
  }
  rates.sort((a, b) => a - b);
  const pc = (p) => rates[Math.min(rates.length - 1, Math.floor(p * rates.length))];
  // Limit-Sättigung (am Klemmrand ±0.02 rad)
  const rng = sim.actRange;
  let sat = 0, tot = 0;
  for (let f = 0; f < n; f++) for (let j = 0; j < nu; j++) {
    const v = q[f * nu + j], lo = rng[2 * j] + 0.02, hi = rng[2 * j + 1] - 0.02;
    if (v <= lo || v >= hi) sat++;
    tot++;
  }
  // h/root/yaw-Sprünge
  let hMin = Infinity, hMax = -Infinity, hJmp = 0, yawJmp = 0, rootJmp = 0;
  for (let f = 0; f < n; f++) {
    if (h[f] < hMin) hMin = h[f];
    if (h[f] > hMax) hMax = h[f];
    if (f > 0) {
      hJmp = Math.max(hJmp, Math.abs(h[f] - h[f - 1]));
      yawJmp = Math.max(yawJmp, Math.abs(yaw[f] - yaw[f - 1]));
      rootJmp = Math.max(rootJmp, Math.hypot(root[2 * f] - root[2 * (f - 1)], root[2 * f + 1] - root[2 * (f - 1) + 1]));
    }
  }
  const row = {
    name, n, fps,
    rate_p50: pc(0.5), rate_p95: pc(0.95), rate_max: rates[rates.length - 1],
    sat_pct: (100 * sat / tot),
    hMin, hMax, hJmp, yawJmp, rootJmp,
  };
  console.log('  ' + name.padEnd(22) +
    ' | Raten rad/s p50=' + row.rate_p50.toFixed(1) + ' p95=' + row.rate_p95.toFixed(1) + ' max=' + row.rate_max.toFixed(1) +
    ' | Klemme ' + row.sat_pct.toFixed(1) + ' %' +
    ' | h ' + row.hMin.toFixed(2) + '-' + row.hMax.toFixed(2) + ' (Δmax ' + row.hJmp.toFixed(2) + ')' +
    ' | yawΔmax ' + row.yawJmp.toFixed(2) + ' rootΔmax ' + row.rootJmp.toFixed(3));
  return row;
}

// ── PHYSIK-FAHRTEST: q_ref an die Aktoren (idealer Tracker) ──
function driveTest(name, motion, seconds = 5) {
  const { q, h, n, fps } = motion;
  const CTRL_DT = 0.02;
  const substeps = Math.max(1, Math.round(CTRL_DT / sim.timestep));
  sim.reset();
  const keyCtrl = sim.keyCtrl;
  let upzMin = 1, hMin = Infinity, hMax = -Infinity, fallT = -1;
  let sqErr = 0, sqN = 0;
  const bq = new Float64Array(4), p3 = new Float64Array(3), ref = new Float64Array(nu), qq = new Float64Array(nu);
  const steps = Math.round(seconds / CTRL_DT);
  for (let s = 0; s <= steps; s++) {
    const t = s * CTRL_DT;
    const tf = (t * fps) % n;
    const i0 = Math.floor(tf), i1 = (i0 + 1) % n, u = tf - i0;
    const blend = Math.min(1, t / 0.6);
    for (let j = 0; j < nu; j++) {
      const target = q[i0 * nu + j] * (1 - u) + q[i1 * nu + j] * u;
      ref[j] = keyCtrl[j] * (1 - blend) + target * blend;
    }
    for (let j = 0; j < nu; j++) sim.ctrl[j] = ref[j];
    sim.stepN(substeps);
    // Messung
    sim.baseQuat(bq);
    const x = bq[1], y = bq[2];
    const upz = 1 - 2 * (x * x + y * y);
    sim.basePos(p3);
    upzMin = Math.min(upzMin, upz);
    hMin = Math.min(hMin, p3[2]);
    hMax = Math.max(hMax, p3[2]);
    if (fallT < 0 && (upz < 0.5 || p3[2] < 0.35)) fallT = t;
    sim.jointPositions(qq);
    for (let j = 0; j < nu; j++) { const d = qq[j] - ref[j]; sqErr += d * d; sqN++; }
  }
  const rms = Math.sqrt(sqErr / Math.max(1, sqN));
  const alive = fallT < 0;
  const verdict = alive ? 'ÜBERLEBT ' + seconds + ' s' : 'STURZ bei t=' + fallT.toFixed(2) + ' s';
  console.log('  ' + name.padEnd(22) + ' → ' + verdict +
    ' | upzMin ' + upzMin.toFixed(2) + ' | Basis-h ' + (Number.isFinite(hMin) ? hMin.toFixed(2) : 'NaN') + '-' + (Number.isFinite(hMax) ? hMax.toFixed(2) : 'NaN') +
    ' | Track-RMS ' + rms.toFixed(3) + ' rad');
  return { alive, fallT, upzMin, hMin, hMax, rms };
}

// ══ A) GLB-Referenz (synthetischer Mixamo-Walk, 30 FPS, cm) ══
console.log('\n■ A) Timeline-Statistik');
let statsGLB = null, driveGLB = null;
{
  const buf = walkClip({ duration: 3.0, fps: 30 });
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const clip = new GlbClip(ab);
  const motion = retargetToRobot(clip, sim, () => {});
  statsGLB = motionStats('GLB (synth-Walk)', motion);
  driveGLB = driveTest('GLB (synth-Walk)', motion, 4);
}

// ══ B) ARDY: echte Generierung (fp32, App-Codepfad) ═════════
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
console.log('\n■ B) ARDY-Generierung (App-Codepfad, fp32)');

const cases = [
  { prompt: 'a person walks forward at a steady pace', seed: 7 },
  { prompt: 'a person walks forward at a steady pace', seed: 42 },
  { prompt: 'a person dances energetically', seed: 7 },
];
const rows = [];
for (const c of cases) {
  const out = await rt.generate({ prompt: c.prompt, seconds: 5, seed: c.seed });
  const clip = new ArdyClip(out);
  const motion = retargetToRobot(clip, sim, () => {});
  const nm = 'ARDY „' + c.prompt.slice(10, 21) + '” #' + c.seed;
  const st = motionStats(nm, motion);
  const dr = driveTest(nm, motion, 5);
  rows.push({ c, st, dr, motion });
}

// ══ C) Physik-Filter-Prototyp (v2.28.5-Logik vorweggenommen) ══
// Zero-Phase-EMA (vor+rück) + Rate-Limiter je Kanal, yaw unwrap+limit.
function physFilter(motion, opts = {}) {
  const { q, h, root, yaw, n, fps } = motion;
  const nu2 = q.length / n;
  const dt = 1 / fps;
  const R = (opts.rateMax ?? 8) * dt;      // max Δq je Frame
  const A = opts.alpha ?? 0.35;
  const q2 = new Float32Array(q.length);
  q2.set(q);
  // 2 Durchgänge EMA (vorwärts, rückwärts) → zero-phase
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      for (let j = 0; j < nu2; j++) {
        const a = q2[f * nu2 + j], b = q2[(f + 1) * nu2 + j];
        const d = Math.max(-R, Math.min(R, b - a)); // Rate begrenzen
        q2[(f + 1) * nu2 + j] = a + d;
      }
    }
  }
  // glatte EMA ohne Klemme zusätzlich (für Zittern zwischen den Raten)
  const q3 = new Float32Array(q.length);
  q3.set(q2);
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      for (let j = 0; j < nu2; j++) {
        q3[(f + 1) * nu2 + j] = q3[f * nu2 + j] + (q3[(f + 1) * nu2 + j] - q3[f * nu2 + j]) * A;
      }
    }
  }
  // yaw: unwrap → EMA → zurück in (−π, π]-Kompatibilität lassen (Task wrapAngle selbst)
  const yaw2 = new Float32Array(n);
  let unw = yaw[0];
  yaw2[0] = yaw[0];
  for (let f = 1; f < n; f++) {
    let d = yaw[f] - yaw[f - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unw += d;
    yaw2[f] = unw;
  }
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      const d = Math.max(-2.5 * dt, Math.min(2.5 * dt, yaw2[f + 1] - yaw2[f]));
      yaw2[f + 1] = yaw2[f] + d * 0.6 + (yaw2[f + 1] - yaw2[f]) * 0.4;
    }
  }
  // h + root EMA (zero-phase)
  const h2 = new Float32Array(h);
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      h2[f + 1] = h2[f] + (h2[f + 1] - h2[f]) * 0.4;
    }
  }
  const root2 = new Float32Array(root.length);
  root2.set(root);
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let i = 0; i < n - 1; i++) {
      const f = fwd ? i : n - 2 - i;
      root2[2 * (f + 1)] = root2[2 * f] + (root2[2 * (f + 1)] - root2[2 * f]) * 0.5;
      root2[2 * (f + 1) + 1] = root2[2 * f + 1] + (root2[2 * (f + 1) + 1] - root2[2 * f + 1]) * 0.5;
    }
  }
  return { q: q3, h: h2, root: root2, yaw: yaw2, n, fps, nu: nu2 };
}

console.log('\n■ C) Physik-Filter-Prototyp (Rate-Klemme 8 rad/s + zero-phase EMA)');
{
  const buf = walkClip({ duration: 3.0, fps: 30 });
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const mGLB = retargetToRobot(new GlbClip(ab), sim, () => {});
  console.log('  GLB unverändert (Referenz p95=' + statsGLB.rate_p95.toFixed(1) + ')');
  for (const r of rows) {
    const before = r.st;
    const fm = physFilter(r.motion);
    const fake = { q: fm.q, h: fm.h, root: fm.root, yaw: fm.yaw, n: fm.n, fps: fm.fps };
    // Statistik auf gefilterter Timeline
    const dt = 1 / fm.fps;
    const rates = [];
    for (let f = 0; f < fm.n - 1; f++) {
      let mx = 0;
      for (let j = 0; j < fm.q.length / fm.n; j++) {
        const d = Math.abs(fm.q[(f + 1) * (fm.q.length / fm.n) + j] - fm.q[f * (fm.q.length / fm.n) + j]) / dt;
        if (d > mx) mx = d;
      }
      rates.push(mx);
    }
    rates.sort((a, b) => a - b);
    const pc = (p) => rates[Math.min(rates.length - 1, Math.floor(p * rates.length))];
    let yawJmp = 0;
    for (let f = 1; f < fm.n; f++) yawJmp = Math.max(yawJmp, Math.abs(fm.yaw[f] - fm.yaw[f - 1]));
    console.log('  ' + r.c.prompt.slice(10, 21) + ' #' + r.c.seed + ': p50 ' + before.rate_p50.toFixed(1) + '→' + pc(0.5).toFixed(1) +
      ' · p95 ' + before.rate_p95.toFixed(1) + '→' + pc(0.95).toFixed(1) +
      ' · max ' + before.rate_max.toFixed(1) + '→' + rates[rates.length - 1].toFixed(1) +
      ' · yawΔmax ' + before.yawJmp.toFixed(2) + '→' + yawJmp.toFixed(2));
  }
}

// ══ Bilanz ══════════════════════════════════════════════════
console.log('\n■ BILANZ');
console.log('  GLB-Fahrtest: ' + (driveGLB.alive ? 'übertand' : 'GESTÜRZT') + ', RMS ' + driveGLB.rms.toFixed(3));
for (const r of rows) {
  console.log('  ' + r.c.prompt.slice(10, 21) + ' #' + r.c.seed + ': ' + (r.dr.alive ? 'übertand' : 'GESTÜRZT bei ' + r.dr.fallT.toFixed(2) + ' s') +
    ', RMS ' + r.dr.rms.toFixed(3) + ', Raten-p95 ' + r.st.rate_p95.toFixed(1) + ' rad/s, Klemme ' + r.st.sat_pct.toFixed(1) + ' %');
}
process.exit(0);
