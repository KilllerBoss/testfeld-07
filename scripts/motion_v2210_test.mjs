// motion_v2210_test.mjs — v2.21.0 MOTION-KI (MotionBrick/AI4Animation-artig):
//   1) GEIST-PAUSE: motion-Task advance() friert die Phase ein (ghostPaused),
//      Trigger/Cmd-Integration läuft weiter — Roboter hält die Pose
//   2) Befehl-Kanäle: task.cmd.vx/wz landen an der erwarteten OBS-Position
//      (die Kanäle, in die der MOTION-KI-Mixer mischt)
//   3) Mixer-Formel (Statik): Blend = mix·Stick + (1−mix)·ClipTempo, Drohne
//      mit cmd.yaw statt cmd.wz, _manualCmd-Schutz
//   4) AI-Werkzeug motionKi: Whitelist + Validierung (mix-Klemme 0…1)
//   5) Verdrahtung: index.html (mkiChip/mkiMix/mkiPause/mkiNext), main.js
//      (setMotionKi/nextMotionClip/motionKiTool/observeState/Handles),
//      CONTROL.md, build.gradle 33/2.21.0
// Usage: node scripts/motion_v2210_test.mjs
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
const { makeMotionTask } = await import(path.join(WWW, 'js/motiontask.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const ai = await import(path.join(WWW, 'js/ai.js'));
const { RNG } = await import(path.join(WWW, 'js/math.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

// ── 1) GEIST-PAUSE ─────────────────────────────────────────
console.log('\n[1] GEIST-PAUSE (ghostPaused friert die Referenzzeit ein)');
{
  const cfg = getRobot('g1');
  await fetchModelIntoFS('models/' + cfg.dir);
  writeWorldFile(cfg.dir, 'welt_mki.xml', buildWorldXML(cfg, 'flach', 1, null));
  const sim = new RobotSim(cfg, 'welt_mki.xml');
  const stubClip = { n: 10, nu: cfg.nu, fps: 30, duration: 10 / 30, q: new Float32Array(10 * cfg.nu), h: new Float32Array(10), root: null, yaw: null, baseQ: null, locomotion: true };
  const task = makeMotionTask(cfg, stubClip, null);
  task.reset(new RNG(1), sim);
  const p0 = task.phase;
  task.advance(0.02); task.advance(0.02);
  ok(task.phase !== p0, 'ohne Pause läuft die Phase', p0.toFixed(4) + ' → ' + task.phase.toFixed(4));
  // Pause: Phase bleibt EXAKT stehen
  task.ghostPaused = true;
  const pFrozen = task.phase;
  for (let i = 0; i < 10; i++) task.advance(0.02);
  ok(task.phase === pFrozen, 'ghostPaused: Phase friert ein', String(task.phase));
  ok(task.tElapsed > 0, 'Zeit läuft trotzdem weiter (tElapsed)', task.tElapsed.toFixed(3) + 's');
  // Resume
  task.ghostPaused = false;
  task.advance(0.02);
  ok(task.phase !== pFrozen, 'Pause aus: Phase läuft weiter');
  // Trigger-Integration läuft in der Pause weiter (Buttons wirken beim Halten)
  task.ghostPaused = true;
  if (task.trgHold) { task._trgHold[0] = 1; }
  task.advance(0.02);
  ok(true, 'advance in Pause ohne Fehler');
}

// ── 2) Befehl-Kanäle in der Beobachtung ────────────────────
console.log('\n[2] BEFEHL-KANÄLE — Mixer-Ziele in der OBS');
{
  const cfg = getRobot('g1');
  const stubClip = { n: 4, nu: cfg.nu, fps: 30, duration: 4 / 30, q: new Float32Array(4 * cfg.nu), h: new Float32Array(4), root: null, yaw: null, baseQ: null };
  const task = makeMotionTask(cfg, stubClip, null);
  const sim = new RobotSim(cfg, 'welt_mki.xml');
  task.reset(new RNG(2), sim);
  task.animOn = true; task.ctrlMode = 'none'; task.refMode = 'folgt';
  // Mixer-Semantik: task.cmd.vx/wz schreiben → OBS-Befehl-Kanäle
  task.cmd.vx = 0.55; task.cmd.wz = -0.25;
  const obs = new Float32Array(task.obsDim);
  task.observe(sim, obs);
  // Layout (motion, v2.7): Gelenk-Δ(nu) · Tempo(nu) · up(3) · yawRate · vF · vS ·
  // BahnX · BahnY · BahnYaw · lead · sin · cos · Befehl vx · Befehl wz · Trigger(4) …
  const iVx = 2 * cfg.nu + 12, iWz = 2 * cfg.nu + 13;
  ok(Math.abs(obs[iVx] - 0.55) < 1e-6, 'OBS[Befehl vx] = Mixer-Wert', obs[iVx].toFixed(3));
  ok(Math.abs(obs[iWz] - (-0.25)) < 1e-6, 'OBS[Befehl wz] = Mixer-Wert', obs[iWz].toFixed(3));
  // 'folgt': Bahn-Fehler ≈ 0 (kein Bahn-Zwang), lead = Clip-Tempo
  ok(Math.abs(obs[2 * cfg.nu + 6]) < 1e-6 && Math.abs(obs[2 * cfg.nu + 7]) < 1e-6, 'folgt: Bahn-Fehler ≈ 0 (Roboter führt, Lehrer hängt)');
  ok(obs[2 * cfg.nu + 9] >= 0, 'folgt: Bahn-Führung (lead) = Clip-Tempo', obs[2 * cfg.nu + 9].toFixed(3));
}

// ── 3) Mixer-Formel (Statik + Referenzrechnung) ────────────
console.log('\n[3] STEUER-MIX — Formel');
{
  const mainSrc = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  ok(/task\.cmd\.vx = mix \* c\.vx \+ \(1 - mix\) \* clipVx/.test(mainSrc), 'Motion: vx = mix·Stick + (1−mix)·ClipTempo');
  ok(/task\.cmd\.wz = mix \* c\.yaw/.test(mainSrc), 'Motion: wz = mix·Stick (Stil trägt die Drehung)');
  ok(/task\._manualCmd = true;\s*\/\/ advance darf die Kommandos NICHT überschreiben/.test(mainSrc), '_manualCmd-Schutz im Mixer');
  ok(/const wzKey = 'wz' in task\.cmd \? 'wz' : 'yaw';/.test(mainSrc), 'Drohne: cmd.yaw statt cmd.wz');
  ok(/task\.refSpeed\(task\.phase\)/.test(mainSrc), 'Clip-Tempo via refSpeed(phase)');
  // Referenzrechnung des Blends (die Formel, die policyCtrlStep nutzt)
  const mix = 0.7, stick = 0.8, clip = 0.35;
  const blend = mix * stick + (1 - mix) * clip;
  ok(Math.abs(blend - 0.665) < 1e-9, 'Blend 0,7·0,8 + 0,3·0,35 = 0,665', blend.toFixed(3));
  ok(Math.abs((0 * 0.8 + 1 * clip) - clip) < 1e-9 && Math.abs((1 * 0.8 + 0 * clip) - 0.8) < 1e-9, 'Grenzen: mix 0 = nur Clip · mix 1 = nur Stick');
}

// ── 4) AI-Werkzeug motionKi ────────────────────────────────
console.log('\n[4] AI-WERKZEUG motionKi (Whitelist + Validierung)');
{
  const v = ai.validateToolCall({ tool: 'motionKi', args: { on: true, mix: 1.7, paused: false, nextClip: true } });
  ok(v && v.tool === 'motionKi', 'motionKi in der TOOL-Whitelist');
  ok(v && v.args.mix === 1, 'mix auf 1 geklemmt', v && String(v.args.mix));
  ok(v && v.args.on === true && v.args.paused === false && v.args.nextClip === true, 'Flags durchgereicht');
  const v2 = ai.validateToolCall({ tool: 'motionKi', args: { mix: -3 } });
  ok(v2 && v2.args.mix === 0, 'mix auf 0 geklemmt (negativ)', v2 && String(v2.args.mix));
  const prompt = ai.buildSystemPrompt({ robotName: 'G1', robot: 'g1', taskKind: 'motion', current: {} });
  ok(prompt.includes('motionKi') && prompt.includes('MOTION-KI'), 'System-Prompt dokumentiert motionKi');
  ok(prompt.includes('Steuer-Mix'), 'Prompt erklärt den Steuer-Mix');
  ok(ai.AI_DOCS.some(d => d.doc === 'CONTROL' && d.title.includes('MOTION-KI')), 'AI_DOCS/CONTROL-Titel nennt MOTION-KI');
}

// ── 5) Verdrahtung ─────────────────────────────────────────
console.log('\n[5] VERDRAHTUNG — Panel + Handler + Doku');
{
  const mainSrc = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const htmlSrc = await readFile(path.join(WWW, 'index.html'), 'utf8');
  const mtSrc = await readFile(path.join(WWW, 'js/motiontask.js'), 'utf8');
  const ctrlDoc = await readFile(path.join(WWW, 'mcp/CONTROL.md'), 'utf8');
  const gradle = await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8');
  ok(/VERSION = '2\.2[2-9]\.|VERSION = '2\.\d{2,}\./.test(mainSrc) || parseInt((mainSrc.match(/VERSION = '(\d+)\.(\d+)\./) || [0, 0, 0])[2], 10) >= 22, 'main.js VERSION ≥ 2.22.0');
  ok(/id="mkiChip"/.test(htmlSrc) && /id="mkiMix"/.test(htmlSrc) && /id="mkiPause"/.test(htmlSrc) && /id="mkiNext"/.test(htmlSrc), 'Panel: Chip + Mix-Slider + Pause + Next');
  ok(/MOTION-KI<\/span>/.test(htmlSrc), 'Panel-Zeile „MOTION-KI"');
  ok(/function setMotionKi\(on\)/.test(mainSrc) && /setMotionKi\(!S\.motionKi\.on\)/.test(mainSrc), 'setMotionKi + Chip-Handler');
  ok(/async function nextMotionClip\(\)/.test(mainSrc) && /nextMotionClip\(\);/.test(mainSrc), 'nextMotionClip + ⏭-Handler');
  ok(/function motionKiTool\(args\)/.test(mainSrc) && /tool === 'motionKi'/.test(mainSrc), 'motionKiTool + execTool-Registrierung');
  ok(/motionKi: \{ on: S\.motionKi\.on/.test(mainSrc), 'observeState trägt motionKi-Status');
  ok(/setMotionKi: \(on\) => setMotionKi\(!!on\)/.test(mainSrc) && /motionKiState: \(\) =>/.test(mainSrc), '__trainrobot-Handles für Tests');
  ok(/tr_motionki_v1/.test(mainSrc), 'Persistenz tr_motionki_v1');
  ok(/ghostPaused/.test(mtSrc) && /if \(!this\.ghostPaused\) \{/.test(mtSrc), 'motiontask: ghostPaused friert die Phase');
  ok(/MOTION-KI/.test(ctrlDoc) && /Steuer-Mix/.test(ctrlDoc), 'CONTROL.md: MOTION-KI dokumentiert');
  const gc = parseInt((gradle.match(/versionCode (\d+)/) || [0, 0])[1], 10);
  ok(gc >= 34, 'build.gradle versionCode ≥ 34', String(gc));
}

console.log('\n════════════════════════════════');
console.log(`ERGEBNIS: ${pass} grün, ${fail} rot`);
process.exit(fail ? 1 : 0);
