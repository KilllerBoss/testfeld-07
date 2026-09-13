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
  }

  init() {
    this.consolePanel = this.$('consolePanel');
    this.consoleLogEl = this.$('consoleLog');
    this.toastEl = this.$('toast');
  }

  // ── Konsole ──────────────────────────────────────────────
  log(msg, cls = '') {
    const t = (performance.now() / 1000).toFixed(2).padStart(7, ' ');
    const div = document.createElement('div');
    div.className = cls;
    const ts = document.createElement('span');
    ts.className = 't'; ts.textContent = t + 's';
    div.appendChild(ts);
    div.appendChild(document.createTextNode(msg));
    this.consoleLogEl.appendChild(div);
    while (this.consoleLogEl.childElementCount > 220) this.consoleLogEl.firstChild.remove();
    this.consoleLogEl.scrollTop = this.consoleLogEl.scrollHeight;
    this.bootLines.push(msg);
  }

  toggleConsole() {
    this.consolePanel.classList.toggle('hidden');
    this.$('btnConsole').classList.toggle('lit', !this.consolePanel.classList.contains('hidden'));
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
    this.$('stMode').textContent = mode === 'policy' ? 'POLICY' : 'MANUELL';
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
  }

  // ── KI-Trainer ──────────────────────────────────────────
  toggleAI(force) {
    const sheet = this.$('aiSheet');
    const show = force !== undefined ? force : sheet.classList.contains('hidden');
    sheet.classList.toggle('hidden', !show);
    this.$('btnAI').classList.toggle('lit', show);
    if (show) this.toggleTrain(false);
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
  resetRewards() { this.episodeRewards = []; this.episodeEma = []; this._ema = null; }

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
