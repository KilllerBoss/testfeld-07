// ═══════════════════════════════════════════════════════════
// ui.js — Werkbank-UI: Konsole (BIOS-Stil), Toasts, Roboter-Chips,
// Trainings-Panel mit Belohnungs-Kurve, Statuszeile.
// ═══════════════════════════════════════════════════════════

export class UI {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.bootLines = [];
    this.episodeRewards = [];   // roh
    this.episodeEma = [];       // geglättet
    this._ema = null;
    // v2.14.0: LIVE-KURVEN — Schritte/s + Policy-Loss (zweites Chart)
    this.rateHist = [];
    this.lossHist = [];
  }

  init() {
    this.consoleLogEl = this.$('consoleLog'); // v2.14.1: unsichtbares Log-Element (kein Panel mehr)
    this.toastEl = this.$('toast');
  }

  // ── Log (unsichtbar — war bis v2.14.0 die Konsole) ──────
  // v2.14.1: Panel + Button entfernt (Nutzerwunsch). Meldungen landen
  // weiter im versteckten #consoleLog — Playwright-Tests und Logcat-
  // Fehlersuche lesen ihn mit, im UI stört nichts mehr.
  log(msg, cls = '') {
    this.bootLines.push(msg);
    if (!this.consoleLogEl) return;
    const div = document.createElement('div');
    div.className = cls;
    div.appendChild(document.createTextNode(msg));
    this.consoleLogEl.appendChild(div);
    while (this.consoleLogEl.childElementCount > 220) this.consoleLogEl.firstChild.remove();
  }

  // ── Toast ────────────────────────────────────────────────
  toast(msg, isErr = false, ms = 2200) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle('err', isErr);
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ── Splash ───────────────────────────────────────────────
  splash(statusText, progress = null) {
    const sEl = this.$('splashStatus'), bEl = this.$('splashBar');
    if (!sEl || !bEl) return; // Splash ist schon weg
    if (statusText !== null) sEl.textContent = statusText;
    if (progress !== null) bEl.style.width = Math.round(progress * 100) + '%';
  }
  splashDone() {
    const s = this.$('splash');
    s.classList.add('gone');
    setTimeout(() => s.remove(), 600);
    for (const id of ['topbar', 'robotBar', 'modeBar', 'worldBar', 'statusLine', 'controls']) {
      this.$(id).classList.remove('hidden');
    }
  }

  fail(msg) {
    this.$('failMsg').textContent = msg;
    this.$('failScreen').classList.remove('hidden');
  }

  // ── Roboter-Chips ────────────────────────────────────────
  setRobotActive(id) {
    for (const chip of document.querySelectorAll('.robot-chip')) {
      chip.classList.toggle('active', chip.dataset.robot === id);
      chip.classList.remove('loading');
    }
    this.$('robotTitle').textContent = '';
  }
  setRobotLoading(id) {
    for (const chip of document.querySelectorAll('.robot-chip')) {
      chip.classList.toggle('loading', chip.dataset.robot === id);
    }
  }
  setRobotTitle(cfg) {
    this.$('robotTitle').textContent = '· ' + cfg.longName;
    this.$('trainRobotName').textContent = cfg.longName;
  }
  setDroneMode(isDrone) {
    for (const el of document.querySelectorAll('.drone-only')) {
      el.classList.toggle('hidden', !isDrone);
    }
  }

  // ── Modus ────────────────────────────────────────────────
  setMode(mode) {
    this.$('modeManuell').classList.toggle('active', mode === 'manuell');
    this.$('modePolicy').classList.toggle('active', mode === 'policy');
    const cvChip = this.$('modeCanvas');
    if (cvChip) cvChip.classList.toggle('active', mode === 'canvas');
    this.$('stMode').textContent = mode === 'policy' ? 'POLICY' : mode === 'canvas' ? 'CANVAS' : 'MANUELL';
  }
  policyAvailable(available) {
    this.$('policyHint').classList.toggle('hidden', available);
    if (available) this.$('policyHint').textContent = 'Policy bereit';
  }

  // ── Statuszeile ──────────────────────────────────────────
  status(speed, alt, hz) {
    this.$('stSpeed').textContent = speed.toFixed(2).replace('.', ',') + ' m/s';
    this.$('stAlt').textContent = alt.toFixed(2).replace('.', ',') + ' m';
    this.$('stHz').textContent = Math.round(hz) + ' Hz';
  }

  // ── Trainings-Panel ──────────────────────────────────────
  toggleTrain(force) {
    const sheet = this.$('trainSheet');
    const show = force !== undefined ? force : sheet.classList.contains('hidden');
    sheet.classList.toggle('hidden', !show);
    this.$('btnTrainTop').classList.toggle('lit', show);
    // v2.24.0: Öffnet das Training, weichen KI-Trainer + Konsole — sonst
    // überdeckt die Konsole (z45) bzw. das KI-Sheet (gleicher z, später im
    // DOM) den trainClose-Knopf: „die Tasten blockieren den Schließen-Button”.
    if (show) {
      this.toggleAI(false);
      this.toggleArdy(false); // v2.26.0: ARDY weicht ebenso — kein verdeckter Close-Knopf
      const cp = this.consolePanel; if (cp) cp.classList.add('hidden');
      const bc = this.$('btnConsole'); if (bc) bc.classList.remove('lit');
    }
  }

  // KI-Trainer ──────────────────────────────────────────
  toggleAI(force) {
    const sheet = this.$('aiSheet');
    const show = force !== undefined ? force : sheet.classList.contains('hidden');
    sheet.classList.toggle('hidden', !show);
    this.$('btnAI').classList.toggle('lit', show);
    if (show) {
      this.toggleTrain(false);
      this.toggleArdy(false); // v2.26.0: ARDY weicht ebenso
      const cp = this.consolePanel; if (cp) cp.classList.add('hidden');
      const bc = this.$('btnConsole'); if (bc) bc.classList.remove('lit');
    }
  }

  // ── v2.26.0: ARDY Mini — eigenes Panel (getrennte Steuerung + Prompting).
  // Cross-Close wie überall: öffnet ARDY → Training/KI/Konsole weichen,
  // damit ardyClose nie verdeckt wird.
  toggleArdy(force) {
    const sheet = this.$('ardySheet');
    if (!sheet) return;
    const show = force !== undefined ? force : sheet.classList.contains('hidden');
    sheet.classList.toggle('hidden', !show);
    const btn = this.$('btnArdy'); if (btn) btn.classList.toggle('lit', show);
    if (show) {
      this.toggleTrain(false);
      this.toggleAI(false);
      const cp = this.consolePanel; if (cp) cp.classList.add('hidden');
      const bc = this.$('btnConsole'); if (bc) bc.classList.remove('lit');
    }
  }

  trainStats(stats) {
    this.$('tReward').textContent = stats.reward;
    this.$('tEpisodes').textContent = String(stats.episodes);
    this.$('tSteps').textContent = fmtInt(stats.steps);
    this.$('tRate').textContent = fmtInt(stats.rate) + ' /s';
  }

  pushEpisodeReward(r) {
    this.episodeRewards.push(r);
    this._ema = this._ema === null ? r : this._ema + 0.06 * (r - this._ema);
    this.episodeEma.push(this._ema);
    const cap = 480;
    if (this.episodeRewards.length > cap) { this.episodeRewards.shift(); this.episodeEma.shift(); }
  }
  resetRewards() { this.episodeRewards = []; this.episodeEma = []; this._ema = null; this.rateHist = []; this.lossHist = []; }

  // v2.14.0: Tempo (Schritte/s) + Policy-Loss je Sample (~0,35 s) aufnehmen
  pushRate(rate, loss) {
    this.rateHist.push(rate || 0);
    this.lossHist.push(Number.isFinite(loss) ? loss : null);
    const cap = 240;
    if (this.rateHist.length > cap) this.rateHist.shift();
    if (this.lossHist.length > cap) this.lossHist.shift();
  }

  drawRateChart() {
    const c = this.$('rateChart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(148,180,220,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    const R = this.rateHist, L = this.lossHist;
    if (R.length < 2) {
      ctx.fillStyle = 'rgba(147,164,184,0.5)';
      ctx.font = '12px monospace';
      ctx.fillText('Tempo & Loss — wartet aufs Training …', 14, H / 2 + 4);
      return;
    }
    // Tempo (amber, gefüllte Fläche)
    let hiR = 1;
    for (const v of R) if (v > hiR) hiR = v;
    const X = (i) => 8 + (i / (R.length - 1)) * (W - 16);
    const YR = (v) => H - 6 - (v / hiR) * (H - 20);
    ctx.beginPath();
    ctx.moveTo(X(0), H - 6);
    for (let i = 0; i < R.length; i++) ctx.lineTo(X(i), YR(R[i]));
    ctx.lineTo(X(R.length - 1), H - 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,157,33,0.20)'; ctx.fill();
    ctx.strokeStyle = '#ff9d21'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < R.length; i++) { const x = X(i), y = YR(R[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    // Loss (cyan, normalisiert)
    const Ls = L.filter(v => v !== null && Number.isFinite(v));
    if (Ls.length >= 2) {
      let lo = Infinity, hi = -Infinity;
      for (const v of Ls) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 1e-6) { hi += 0.001; lo -= 0.001; }
      ctx.strokeStyle = '#38d6e0'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < L.length; i++) {
        const v = L[i];
        if (v === null || !Number.isFinite(v)) continue;
        const y = H - 6 - ((v - lo) / (hi - lo)) * (H - 20);
        if (!started) { ctx.moveTo(X(i), y); started = true; } else ctx.lineTo(X(i), y);
      }
      ctx.stroke();
    }
    // Legende
    ctx.fillStyle = 'rgba(147,164,184,0.75)'; ctx.font = '10px monospace';
    ctx.fillText('Tempo ' + Math.round(R[R.length - 1]) + ' /s', 10, 12);
    if (Ls.length) ctx.fillText('Loss ' + Ls[Ls.length - 1].toFixed(3), W - 84, 12);
  }

  drawChart() {
    const c = this.$('rewardChart');
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // Raster
    ctx.strokeStyle = 'rgba(148,180,220,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const R = this.episodeRewards, E = this.episodeEma;
    if (R.length < 2) {
      ctx.fillStyle = 'rgba(147,164,184,0.5)';
      ctx.font = '13px monospace';
      ctx.fillText('Warte auf erste Episoden …', 14, H / 2);
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of R) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    const pad = 8;
    const X = (i) => pad + (i / (R.length - 1)) * (W - 2 * pad);
    const Y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    // Rohe Punkte (dezent)
    ctx.fillStyle = 'rgba(56,214,224,0.28)';
    for (let i = 0; i < R.length; i++) ctx.fillRect(X(i) - 1, Y(R[i]) - 1, 2, 2);
    // EMA-Kurve (amber)
    ctx.strokeStyle = '#ff9d21';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < E.length; i++) {
      const x = X(i), y = Y(E[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Beschriftung min/max
    ctx.fillStyle = 'rgba(147,164,184,0.7)';
    ctx.font = '11px monospace';
    ctx.fillText(hi.toFixed(1).replace('.', ','), 8, 16);
    ctx.fillText(lo.toFixed(1).replace('.', ','), 8, H - 8);
  }
}

export function fmtInt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace('.', ',') + ' Mio.';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'k';
  return String(Math.round(n));
}
