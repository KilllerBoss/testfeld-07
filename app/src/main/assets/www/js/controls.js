// ═══════════════════════════════════════════════════════════
// controls.js — Einheitliche Touch-Steuerung für alle Roboter:
// Stick = fahren & drehen, Wischen = Kamera, Prise = Zoom,
// Hoch/Runter (nur Drohne), Reset. Haptisches Feedback inklusive.
// ═══════════════════════════════════════════════════════════

export class Controls {
  constructor() {
    this.stickX = 0;      // rechts(+)/links(−) → drehen
    this.stickY = 0;      // oben(+) → vorwärts
    this.climb = 0;       // Drohne: +1 steigen, −1 sinken
    this.resetRequest = false;

    // ── v2.23.0 GAMEPAD: virtueller Controller-Overlay + physisches Gamepad ──
    // padOn: Overlay sichtbar · pad = linke/rechte Stick-Position + Buttons
    // padBtn = [bA, bB, bC, bD] (0/1) — A Hüpfen/Sprung · B Hinlegen/Sinken ·
    // C Aufstehen/Steigen · D Stopp. Physisches Gamepad (Gamepad-API) wird
    // automatisch eingelesen (Axes 0/1 links, 2/3 rechts, Buttons 0–3).
    this.padOn = false;
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.padBtn = [0, 0, 0, 0];
    this._padGamepadSeen = false;

    // KI-belegbare Joystick-Map (agent.js validiert + persistiert);
    // maxV/maxW skalieren das Tempo, expo formt die Stick-Kurve.
    this.joyMap = { maxV: 1.0, maxW: 1.0, invertX: false, invertY: false, deadzone: 0.08, expo: 0.4 };

    this._joyId = null;
    this._camId = null;
    this._pinch = null;
    this._camYaw = 0.6; this._camPitch = 0.42; this._camDist = 2.6;
    this._keys = {};
  }

  attach(ui, canvas, renderer3d) {
    this.ui = ui;
    this.canvas = canvas;
    this.r3d = renderer3d;
    this._setupJoystick();
    this._setupCanvas();
    this._setupButtons();
    this._setupKeyboard();
    this._setupPad(); // v2.23.0
  }

  buzz(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* egal */ } }

  // ── Joystick ─────────────────────────────────────────────
  _setupJoystick() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const stick = document.getElementById('joyStick');
    const R = () => zone.clientWidth / 2 - 14;

    const setStick = (dx, dy) => { stick.style.transform = `translate(${dx}px, ${dy}px)`; };

    zone.addEventListener('pointerdown', (e) => {
      if (this._joyId !== null) return;
      this._joyId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      zone.classList.add('active'); // v2.14.0: aktive Hervorhebung
      this.buzz(8);
      this._joyMove(e, zone, R, setStick);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joyId) return;
      this._joyMove(e, zone, R, setStick);
    });
    const end = (e) => {
      if (e.pointerId !== this._joyId) return;
      this._joyId = null;
      zone.classList.remove('active');
      this.stickX = 0; this.stickY = 0;
      setStick(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    this._joyTick = () => { /* Wert kommt aus _joyMove */ };
  }

  _joyMove(e, zone, R, setStick) {
    const rect = zone.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    const max = R();
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.stickX = dx / max;
    this.stickY = -dy / max;
    setStick(dx, dy);
  }

  // ── v2.23.0: GAMEPAD-Overlay (Controller-Layout) ──────────
  setPad(on) {
    this.padOn = !!on;
    const el = document.getElementById('padOverlay');
    if (el) { el.classList.toggle('on', this.padOn); el.classList.toggle('hidden', !this.padOn); }
    // v2.24.0: body.pad-on = Leisten weichen; btnPad zeigt den Zustand (.lit)
    // (DOM-safe: setPad wird auch ohne echtes DOM in Tests aufgerufen)
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('pad-on', this.padOn);
    if (typeof document !== 'undefined') { const pb = document.getElementById('btnPad'); if (pb) pb.classList.toggle('lit', this.padOn); }
    if (!this.padOn) {
      this.pad = { lx: 0, ly: 0, rx: 0, ry: 0 };
      this.padBtn = [0, 0, 0, 0];
      document.querySelectorAll('#padOverlay .padStick').forEach((s) => { s.style.transform = 'translate(0px, 0px)'; });
    }
    return this.padOn;
  }

  _setupPad() {
    const root = document.getElementById('padOverlay');
    if (!root) return;
    const stick = (zoneId, stickId, set) => {
      const zone = document.getElementById(zoneId);
      const knob = document.getElementById(stickId);
      let id = null;
      const move = (e) => {
        const rect = zone.getBoundingClientRect();
        const R = rect.width / 2 - 12;
        let dx = e.clientX - (rect.left + rect.width / 2);
        let dy = e.clientY - (rect.top + rect.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        set(dx / R, -dy / R); // oben = +
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      zone.addEventListener('pointerdown', (e) => { if (id !== null) return; id = e.pointerId; zone.setPointerCapture(e.pointerId); this.buzz(6); move(e); });
      zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
      const end = (e) => { if (e.pointerId !== id) return; id = null; set(0, 0); knob.style.transform = 'translate(0px, 0px)'; };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    };
    stick('padLZone', 'padLStick', (x, y) => { this.pad.lx = x; this.pad.ly = y; });
    stick('padRZone', 'padRStick', (x, y) => { this.pad.rx = x; this.pad.ry = y; });
    const btns = [
      ['padBtnA', 0], ['padBtnB', 1], ['padBtnC', 2], ['padBtnD', 3],
    ];
    for (const [bid, i] of btns) {
      const el = document.getElementById(bid);
      if (!el) continue;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.padBtn[i] = 1; el.classList.add('hold'); this.buzz(14); });
      const off = () => { this.padBtn[i] = 0; el.classList.remove('hold'); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', (e) => { if (e.buttons === 0) off(); });
    }
    // v2.24.0: ×-Knopf AUF dem Controller — schließt das Overlay. Er hängt
    // als erster Flex-Item ÜBER den Pad-Tasten und ist damit nie blockiert.
    const pc = document.getElementById('padClose');
    if (pc) pc.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.setPad(false); this.buzz(16); });
  }

  /** Physisches Gamepad einlesen (falls verbunden) — überschreibt Overlay. */
  _pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => Math.abs(v) < 0.12 ? 0 : v;
      this.pad.lx = dz(p.axes[0] || 0); this.pad.ly = -dz(p.axes[1] || 0);
      this.pad.rx = dz(p.axes[2] || 0); this.pad.ry = -dz(p.axes[3] || 0);
      this.padBtn = [0, 1, 2, 3].map((i) => (p.buttons[i] && p.buttons[i].pressed) ? 1 : 0);
      this._padGamepadSeen = true;
      return true;
    }
    return false;
  }

  // ── Kamera-Gesten auf der 3D-Fläche ──────────────────────
  _setupCanvas() {
    const c = this.canvas;
    const pts = new Map();

    c.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        this._pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        this._camYaw -= dx * 0.006;
        this._camPitch = Math.max(0.08, Math.min(1.25, this._camPitch + dy * 0.004));
      }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch) {
          this._camDist = Math.max(0.9, Math.min(14, this._camDist * (this._pinch / d)));
        }
        this._pinch = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) this._pinch = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    // Doppel-Tipp: Kamera zurücksetzen
    let lastTap = 0;
    c.addEventListener('pointerup', (e) => {
      const now = performance.now();
      if (now - lastTap < 280) {
        this._camYaw = 0.6; this._camPitch = 0.42; this._camDist = this.r3d ? this.r3d.camDist : 2.6;
        this.buzz(16);
      }
      lastTap = now;
    });
  }

  // ── Aktions-Buttons ──────────────────────────────────────
  _setupButtons() {
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('hold'); this.buzz(); on(); });
      const end = () => { el.classList.remove('hold'); off(); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', (e) => { if (e.buttons === 0) end(); });
    };
    hold(document.getElementById('btnUp'), () => { this.climb = 1; }, () => { this.climb = 0; });
    hold(document.getElementById('btnDown'), () => { this.climb = -1; }, () => { this.climb = 0; });
    document.getElementById('btnReset').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.resetRequest = true;
      this.buzz(20);
    });
    // SCHUBSEN: kräftiger Ruds gegen den Roboter (Störungs-Robustheit testen)
    const pushBtn = document.getElementById('btnPush');
    if (pushBtn) pushBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.buzz(30);
      if (this.onPush) this.onPush('auto', null);
    });
  }

  // ── Tastatur (Desktop-Entwicklung) ───────────────────────
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._keys[e.key.toLowerCase()] = true;
      if (e.key === ' ') { this.climb = 1; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.key.toLowerCase()] = false;
      if (e.key === ' ') this.climb = 0;
    });
  }

  // Per Frame aufrufen
  tick(dt, renderer3d) {
    const k = this._keys;
    let kx = 0, ky = 0;
    if (k['w'] || k['arrowup']) ky += 1;
    if (k['s'] || k['arrowdown']) ky -= 1;
    if (k['a'] || k['arrowleft']) kx -= 1;
    if (k['d'] || k['arrowright']) kx += 1;
    if (k['q']) this._camYaw += 1.6 * dt;
    if (k['e']) this._camYaw -= 1.6 * dt;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      // Tastatur drosseln auf 80 % (Touch-Stick ist proportional)
      this.stickX = (kx / l) * 0.8; this.stickY = (ky / l) * 0.8;
    } else if (this._joyId === null) {
      this.stickX = 0; this.stickY = 0;
    }
    if (k['r']) this.resetRequest = true;

    if (renderer3d) {
      renderer3d.camYaw = this._camYaw;
      renderer3d.camPitch = this._camPitch;
      renderer3d.camDist = this._camDist;
    }
  }

  consumeReset() {
    const r = this.resetRequest;
    this.resetRequest = false;
    return r;
  }

  // Stick-Wert durch die KI-Map formen (Deadzone → Expo → Invert → Skala)
  _mapAxis(v, invert) {
    const jm = this.joyMap;
    let x = Math.abs(v);
    if (x < jm.deadzone) return 0;
    x = (x - jm.deadzone) / (1 - jm.deadzone);           // Deadzone raus
    x = x * (jm.expo + (1 - jm.expo) * x * x);            // Expo-Kurve (feines Zentrum)
    return (v < 0 ? -x : x) * (invert ? -1 : 1);
  }

  // Einheitlicher Fahrbefehl für alle Roboter (inkl. KI-Map + Tempofaktor)
  // v2.23.0: Gamepad mischt mit — linker Stick: vor/seit, rechter: drehen
  // (+ Drohne: ry = steigen/sinken). Buttons separat via padBtn konsumieren.
  command(cfg) {
    const jm = this.joyMap;
    const gp = this._pollGamepad();
    const sy = this._mapAxis(this.stickY, jm.invertY) + (this.padOn || gp ? this.pad.ly : 0);
    const sx = this._mapAxis(this.stickX, jm.invertX) + (this.padOn || gp ? this.pad.lx : 0);
    const prx = this.padOn || gp ? this.pad.rx : 0;
    const pry = this.padOn || gp ? this.pad.ry : 0;
    if (cfg.drone && Math.abs(pry) > 0.05) this.climb = Math.max(-1, Math.min(1, pry));
    return {
      vx: Math.max(-1, Math.min(1, sy)) * cfg.speedMax * jm.maxV,
      vy: Math.max(-1, Math.min(1, sx)) * cfg.speedMax * jm.maxV, // quer (Gamepad)
      yaw: -this._mapAxis(this.stickX, jm.invertX) * cfg.yawMax * jm.maxW - prx * cfg.yawMax,
      climb: this.climb,
    };
  }
}
