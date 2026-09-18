#!/usr/bin/env python3
# v2.26.0: initArdy-Neubau (eigenes ARDY-Sheet: Download-Button, Live-%,
# Stop, Live-Prompt, Trainings-Prozent) + btnArdy/ardyClose-Verdrahtung
# + Trainings-Prozent-Update in der Hauptschleife.
import io, re, sys

P = 'app/src/main/assets/www/js/main.js'
s = io.open(P, encoding='utf-8').read()

NEW_INIT = r'''function initArdy() {
  const chipsEl = document.getElementById('ardyChips');
  const promptEl = document.getElementById('ardyPrompt');
  const genBtn = document.getElementById('ardyGenerate');
  const barEl = document.getElementById('ardyBar');
  const fillEl = document.getElementById('ardyBarFill');
  const statusEl = document.getElementById('ardyStatus');
  const durEl = document.getElementById('ardyDur');
  const seedEl = document.getElementById('ardySeed');
  const cfgEl = document.getElementById('ardyCfg');
  const epEl = document.getElementById('ardyEp');
  // v2.26.0: eigenes Panel — Modell-Download, Live-%, Stop, Trainings-%
  const dlBtn = document.getElementById('ardyDl');
  const dlPctEl = document.getElementById('ardyDlPct');
  const pctEl = document.getElementById('ardyPct');
  const genEl = document.getElementById('ardyGen');
  const stopBtn = document.getElementById('ardyStop');
  const liveEl = document.getElementById('ardyLive');
  const goalEl = document.getElementById('ardyTrainGoal');
  const trainInfoEl = document.getElementById('ardyTrainInfo');
  if (!chipsEl || !genBtn) return;

  const setBar = (pct) => {
    if (pct === null) { barEl.classList.add('hidden'); fillEl.style.width = '0%'; return; }
    barEl.classList.remove('hidden');
    fillEl.style.width = Math.round(pct * 100) + '%';
  };
  const fmtMB = (n) => (n / 1048576).toFixed(0) + ' MB';
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ── Trainings-Ziel (Schritte) — persistent, default 1.000.000 ──
  S.ardyTrainGoal = parseInt(localStorage.getItem('tr_tgoal') || '1000000', 10) || 1000000;
  if (goalEl) {
    goalEl.value = S.ardyTrainGoal;
    goalEl.addEventListener('change', () => {
      const v = parseInt(goalEl.value, 10);
      if (Number.isFinite(v) && v >= 10000) {
        S.ardyTrainGoal = v;
        localStorage.setItem('tr_tgoal', String(v));
        ui.toast('Trainings-Ziel: ' + fmtInt(v) + ' Schritte');
      } else { goalEl.value = S.ardyTrainGoal; }
    });
  }

  // ── Modell-Download: Gesamt-Prozent über gewichtete Stufen ──
  const DL_W = { ort: 3, manifest: 0.2, tokenizer: 1.5, text_encoder: 22, denoiser: 56, decoder: 38 };
  let dlState = {};
  const dlPercent = (p) => {
    if (p && p.stage in DL_W) dlState[p.stage] = { got: p.completed, total: p.total };
    let done = 0, all = 0;
    for (const st of Object.keys(DL_W)) {
      all += DL_W[st];
      const stt = dlState[st];
      if (stt) done += DL_W[st] * (stt.total > 1 ? Math.min(1, stt.got / stt.total) : (stt.got >= 1 ? 1 : 0));
    }
    return all ? done / all : 0;
  };

  for (const a of BASIS_ANIMS) {
    const chip = document.createElement('button');
    chip.className = 'ardy-chip';
    chip.textContent = a.label;
    chip.title = a.prompt;
    chip.addEventListener('click', () => {
      controls.buzz();
      promptEl.value = a.prompt;
      runArdy(a.prompt, a.label);
    });
    chipsEl.appendChild(chip);
  }

  (async () => {
    try {
      const caps = await ardyCapabilities();
      epEl.textContent = caps.webgpu ? (caps.shaderF16 ? 'WebGPU · fp16' : 'WebGPU · fp32') : 'CPU (WASM) — langsam';
    } catch (e) { epEl.textContent = '—'; }
  })();

  async function ensureRuntime(mode) {
    if (S.ardyRuntime) return S.ardyRuntime;
    const downloading = mode === 'dl';
    statusEl.textContent = downloading
      ? 'Download läuft … (~650 MB, einmalig — danach offline)'
      : 'Lade ARDY … (Modell wird einmalig geladen und gecacht)';
    const rt = await loadArdyRuntime({
      onProgress: (p) => {
        if (p.stage === 'denoising') {
          statusEl.textContent = 'Denoising ' + p.completed + '/' + p.total + ' (Fenster)';
          setBar(p.completed / p.total);
        } else if (p.stage === 'decoding') {
          statusEl.textContent = 'Decodieren … Frame ' + (p.frame || 0);
          setBar(0.97);
        } else if (p.stage === 'encoding-text') {
          statusEl.textContent = 'Text kodieren …';
        } else if (p.stage === 'manifest' && p.total <= 1) {
          statusEl.textContent = 'Manifest …';
        } else {
          const dp = dlPercent(p);
          if (downloading && dlPctEl) dlPctEl.textContent = Math.round(dp * 100) + ' %';
          if (p.stage === 'denoiser' || p.stage === 'text_encoder' || p.stage === 'decoder' || p.stage === 'tokenizer' || p.stage === 'ort' || p.stage === 'manifest') {
            if (p.total > 1) {
              statusEl.textContent = 'Download ' + Math.round(dp * 100) + ' % — ' + p.stage + ' ' + fmtMB(p.completed) + ' / ' + fmtMB(p.total);
              setBar(dp);
            } else if (p.message) {
              statusEl.textContent = p.stage + ': ' + p.message;
            }
          }
        }
      },
    });
    S.ardyRuntime = rt;
    dlState = {};
    if (dlPctEl) dlPctEl.textContent = '100 %';
    if (dlBtn) { dlBtn.textContent = '✓ Modell bereit'; dlBtn.disabled = true; }
    statusEl.textContent = 'ARDY Mini bereit (' + rt.epName.toUpperCase() + ' · ' + rt.fps + ' FPS · ' + rt.jointNames.length + ' Gelenke) — ab jetzt offline nutzbar.';
    log('ARDY Mini geladen (' + rt.epName + ') — Modell intsuc/Llama-3-ARDY-Mini-Core40-Browser, läuft ab jetzt auf dem Gerät', 'ok');
    return rt;
  }

  async function runArdy(promptRaw, label) {
    if (S.ardyBusy) { ui.toast('Generierung läuft schon', true); return; }
    const prompt = deToEn(promptRaw || promptEl.value || '').trim();
    if (!prompt) { ui.toast('Prompt eingeben oder Chip wählen', true); return; }
    promptEl.value = prompt;
    if (!S.sim) { ui.toast('Roboter lädt noch — kurz warten', true); return; }
    if (S.robotId !== 'g1') {
      ui.toast('ARDY Mini erzeugt humanoides Motion — bitte zuerst den G1 wählen', true, 4000);
      log('ARDY-Mini abgelehnt: cskel27 → G1-Retargeting, anderer Roboter aktiv', 'warn');
      return;
    }
    S.ardyBusy = true;
    genBtn.disabled = true;
    const oldLabel = genBtn.textContent;
    genBtn.textContent = '…';
    if (stopBtn) stopBtn.disabled = false;
    if (pctEl) pctEl.textContent = '0 %';
    S.ardyAbort = new AbortController();
    try {
      const rt = await ensureRuntime();
      const seedRaw = seedEl.value.trim();
      const seed = seedRaw ? (Number.isFinite(parseInt(seedRaw, 10)) ? parseInt(seedRaw, 10) : seedRaw) : undefined;
      const cfg = parseFloat(cfgEl.value);
      const seconds = parseFloat(durEl.value) || 5;
      const liveOn = liveEl ? !!liveEl.checked : false;
      log('ARDY Mini: „' + prompt + '“ — ' + seconds + ' s' + (seed !== undefined ? ' · Seed ' + seed : '') + (Number.isFinite(cfg) ? ' · CFG ' + cfg : '') + (liveOn ? ' · LIVE-Steuerung an' : ''));
      const out = await rt.generate({
        prompt, seconds,
        seed, cfgWeight: Number.isFinite(cfg) ? cfg : undefined,
        signal: S.ardyAbort.signal,
        // v2.26.0: LIVE — Prompt-Feld wird an jedem Fensteranfang gelesen;
        // eine Änderung lenkt die laufende Bewegung sofort um.
        getLivePrompt: liveOn ? () => deToEn(promptEl.value || '').trim() : undefined,
        onProgress: (p) => {
          if (p.stage === 'denoising') {
            const frac = p.total > 0 ? p.completed / p.total : 0;
            statusEl.textContent = 'Denoising ' + p.completed + '/' + p.total;
            setBar(frac);
            if (pctEl) pctEl.textContent = Math.round(frac * 100) + ' %';
            if (genEl) genEl.textContent = 'Fenster ' + Math.ceil(p.completed / Math.max(1, p.total / Math.max(1, Math.ceil(seconds * rt.fps / 16)))) + '/' + Math.ceil(seconds * rt.fps / 16);
          } else if (p.stage === 'decoding') {
            statusEl.textContent = 'Decodieren … Frame ' + (p.frame || 0);
            setBar(0.97);
            if (pctEl) pctEl.textContent = '99 %';
          } else if (p.stage === 'encoding-text') {
            statusEl.textContent = 'Text kodieren … (Live-Prompt möglich)';
          }
        },
      });
      log('ARDY Mini: ' + out.frameCount + ' Frames @ ' + out.fps + ' FPS (' + out.duration.toFixed(1) + ' s)' + (out.promptsLive ? ' · Live umgelenkt auf „' + out.promptsLive + '“' : '') + ' — Retargeting cskel27 → G1 …');
      statusEl.textContent = 'Retargeting auf G1 …';
      const clip = new ArdyClip(out);
      const motion = retargetToG1(clip, S.sim, (m) => log('  ' + m));
      const name = (label ? 'ARDY · ' + label : 'ARDY · ' + prompt.slice(0, 24)) + ' (KI)';
      const packed = packMotion(motion);
      const rec = {
        id: 'ardy_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name,
        size: out.frameCount * 27 * 3 * 4,
        glb: null,               // keine Mesh-Datei → nie Re-Retarget
        animIndex: 0,
        src: 'ardy',             // auf dem Gerät generiert
        prompt: out.promptsLive || prompt,
        seed: out.seed,
        motion: packed,
        motionByRobot: { g1: packed }, // v2.15.0-Konvention
      };
      await putClip(rec);
      await refreshClipList();
      await activateClip(rec);
      statusEl.textContent = 'Fertig: „' + name + '“ — ' + out.duration.toFixed(1) + ' s als Referenz aktiv.';
      setBar(null);
      if (pctEl) pctEl.textContent = '100 %';
      if (genEl) genEl.textContent = 'fertig';
      ui.toast('KI-Bewegung bereit: ' + name);
      log('ARDY-Mini-Bewegung „' + name + '“ gespeichert und aktiviert — ' + motion.n + ' Frames × ' + motion.nu + ' Gelenke', 'ok');
    } catch (err) {
      console.error(err);
      const aborted = err && err.name === 'AbortError';
      const msg = err && err.message ? err.message : String(err);
      statusEl.textContent = aborted ? 'Abgebrochen — Modell bleibt geladen, nichts gespeichert.' : 'Fehler: ' + msg;
      setBar(null);
      if (pctEl) pctEl.textContent = '—';
      if (genEl) genEl.textContent = 'bereit';
      if (!aborted) {
        log('ARDY-Mini-Fehler: ' + msg, 'err');
        ui.toast('ARDY Mini fehlgeschlagen: ' + msg, true, 5000);
      } else {
        log('ARDY-Mini-Generierung abgebrochen (Stop)', 'warn');
      }
    } finally {
      S.ardyBusy = false;
      S.ardyAbort = null;
      genBtn.disabled = false;
      genBtn.textContent = oldLabel;
      if (stopBtn) stopBtn.disabled = true;
    }
  }

  genBtn.addEventListener('click', () => { controls.buzz(); runArdy(); });
  promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); controls.buzz(); runArdy(); } });
  if (stopBtn) stopBtn.addEventListener('click', () => {
    controls.buzz();
    if (S.ardyAbort) { S.ardyAbort.abort(); ui.toast('ARDY-Generierung gestoppt'); }
  });
  if (dlBtn) dlBtn.addEventListener('click', async () => {
    controls.buzz();
    if (S.ardyBusy) { ui.toast('Generierung läuft schon', true); return; }
    if (S.ardyRuntime) { ui.toast('Modell ist schon geladen'); return; }
    dlBtn.disabled = true;
    const old = dlBtn.textContent;
    dlBtn.textContent = '…';
    try { await ensureRuntime('dl'); }
    catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      statusEl.textContent = 'Download-Fehler: ' + msg;
      if (dlPctEl) dlPctEl.textContent = '—';
      setBar(null);
      log('ARDY-Download-Fehler: ' + msg, 'err');
      ui.toast('Modell-Download fehlgeschlagen: ' + msg, true, 5000);
    } finally {
      dlBtn.disabled = !!S.ardyRuntime;
      dlBtn.textContent = S.ardyRuntime ? '✓ Modell bereit' : old;
    }
  });
  document.getElementById('ardyCacheClear').addEventListener('click', async () => {
    controls.buzz();
    await clearArdyCache();
    S.ardyRuntime = null;
    if (dlBtn) { dlBtn.textContent = '⬇ Modell herunterladen'; dlBtn.disabled = false; }
    if (dlPctEl) dlPctEl.textContent = '—';
    statusEl.textContent = 'Cache gelöscht — Modell wird beim nächsten Einsatz neu geladen.';
    ui.toast('ARDY-Cache gelöscht');
  });
}'''

start = s.index('function initArdy() {')
end_marker = "async function onCsvFiles(e) {"
end = s.index(end_marker)
s = s[:start] + NEW_INIT + '\n\n' + s[end:]

# ── btnArdy + ardyClose verdrahten (beim btnTrainTop-Block) ──
anchor = "document.getElementById('btnTrainTop').addEventListener('click', () => { ui.toggleTrain(); controls.buzz(); });"
wire = anchor + "\ndocument.getElementById('btnArdy').addEventListener('click', () => { ui.toggleArdy(); controls.buzz(); });\nconst ardyCloseBtn = document.getElementById('ardyClose'); if (ardyCloseBtn) ardyCloseBtn.addEventListener('click', () => { ui.toggleArdy(false); controls.buzz(); });"
assert anchor in s, 'btnTrainTop-Anchor fehlt'
s = s.replace(anchor, wire, 1)

# ── Trainings-Prozent (0,35-s-Raster) in der Hauptschleife ──
loop_anchor = "ui.pushRate(S.training ? S.stepsPerSec : 0, lm ? lm.piLoss : null);\n      ui.drawRateChart();"
loop_new = loop_anchor + """
      // v2.26.0: ARDY-Panel — Trainings-Prozent LIVE (Schritte / Ziel)
      const as_ = document.getElementById('ardySheet');
      if (as_ && !as_.classList.contains('hidden')) {
        const goal = S.ardyTrainGoal || 1000000;
        const steps = S.trainer ? S.trainer.stepCount : 0;
        const frac = Math.max(0, Math.min(1, steps / goal));
        const tp = document.getElementById('ardyTrainPct');
        if (tp) tp.textContent = (frac * 100).toFixed(1).replace('.', ',') + ' %';
        const tf = document.getElementById('ardyTrainFill');
        if (tf) tf.style.width = (frac * 100).toFixed(2) + '%';
        const ti = document.getElementById('ardyTrainInfo');
        if (ti) ti.textContent = fmtIntD(steps) + ' / ' + fmtIntD(goal) + (S.training ? ' · trainiert' : ' · pausiert');
      }"""
assert loop_anchor in s, 'Loop-Anchor fehlt'
s = s.replace(loop_anchor, loop_new, 1)

# fmtIntD-Helfer (deutsche Tausenderpunkte) neben lastEma ablegen
helper_anchor = 'function lastEma() {'
helper = 'function fmtIntD(n) { return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, \'.\'); }\n\nfunction lastEma() {'
assert helper_anchor in s, 'lastEma-Anchor fehlt'
s = s.replace(helper_anchor, helper, 1)

io.open(P, 'w', encoding='utf-8').write(s)
print('OK — initArdy neu, Verdrahtung + Trainings-% eingebaut')
