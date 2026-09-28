// ═══════════════════════════════════════════════════════════
// feld/console.js — STEUERKONSOLE: 4 Buttons + 2 Joysticks
//
// Links  = Bewegung      (Y vor/zurück, X seitlich)
// Rechts = Kopfrichtung  (X = drehen/wenden, Y = Ziel-Blick)
//
// Die Konsole ist eine REINE Eingabeschicht: Sie hält die
// Analogen Werte + Button-Drücke und Meldet sie; die Kopplung an
// Task (setUserCmd) und Belohnungssystem (goTo/faceYaw-Terme mit
// source:'console') macht feld.js — dort ist beides bekannt.
//
// Kopplung an das Belohnungssystem (Belohnungsseite aktivierbar):
//   „Ziel folgen"  — linker Joystick-Fahrtwunsch setzt einen
//                    Zielpunkt vor dem Roboter (goTo-Term)
//   „Blick folgen" — rechter Joystick-X verschiebt den Ziel-Blick
//                    relativ zur Roboter-Richtung (faceYaw-Term)
// ═══════════════════════════════════════════════════════════

export const BUTTONS = [
  { id: 'a', label: 'HÜPFEN' },
  { id: 'b', label: 'LIEGEN' },
  { id: 'c', label: 'AUFSTEHEN' },
  { id: 'd', label: 'STOPP' },
];

export class Console {
  constructor(container, opts = {}) {
    this.el = container;
    this.onButton = opts.onButton || null;   // (index, pressed) — NUR bei neuem Druck
    this.drive = { x: 0, y: 0 };             // linker Joystick (−1…1)
    this.head = { x: 0, y: 0 };              // rechter Joystick (−1…1)
    this.buttons = [0, 0, 0, 0];             // Momentaufnahme
    this.driveActive = false;                // „Steuerung übernimmt Kommandos"
    this.goalFollow = opts.goalFollow !== false;  // Konsole → goTo
    this.headFollow = opts.headFollow !== false;  // Konsole → faceYaw
    this._goalTimer = 0;
    // DOM nur im Browser aufbauen (Node-Tests reichen die Logik-API)
    if (typeof document !== 'undefined' && container) this._build();
  }

  _build() {
    this.el.innerHTML = '';
    const pad = (cls, label) => {
      const d = document.createElement('div');
      d.className = 'pad ' + cls;
      d.innerHTML = '<div class="pad-base"><div class="pad-stick"></div></div>'
        + '<div class="pad-lbl">' + label + '</div>';
      return d;
    };
    this.padL = pad('pad-l', 'BEWEGUNG');
    this.padR = pad('pad-r', 'KOPF');
    this.el.appendChild(this.padL);
    // Button-Säule zwischen den Pads
    const col = document.createElement('div');
    col.className = 'btn-col';
    this._btnEls = [];
    BUTTONS.forEach((b, i) => {
      const bt = document.createElement('button');
      bt.className = 'cbtn';
      bt.textContent = b.label;
      bt.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.buttons[i] = 1;
        bt.classList.add('on');
        this.onButton && this.onButton(i, true);
      });
      const up = () => { this.buttons[i] = 0; bt.classList.remove('on'); };
      bt.addEventListener('pointerup', up);
      bt.addEventListener('pointercancel', up);
      bt.addEventListener('pointerleave', up);
      col.appendChild(bt);
      this._btnEls.push(bt);
    });
    this.el.appendChild(col);
    this.el.appendChild(this.padR);
    this._wirePad(this.padL, this.drive);
    this._wirePad(this.padR, this.head);
  }

  _wirePad(padEl, store) {
    const base = padEl.querySelector('.pad-base');
    const stick = padEl.querySelector('.pad-stick');
    let pid = null;
    const set = (e) => {
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2);
      let dy = (e.clientY - cy) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      store.x = dx; store.y = dy;
      stick.style.transform = 'translate(' + (dx * 36).toFixed(1) + 'px,' + (dy * 36).toFixed(1) + 'px)';
    };
    const clear = () => {
      pid = null; store.x = 0; store.y = 0;
      stick.style.transform = 'translate(0,0)';
    };
    base.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; base.setPointerCapture(pid); set(e); });
    base.addEventListener('pointermove', (e) => { if (pid === e.pointerId) set(e); });
    base.addEventListener('pointerup', () => clear());
    base.addEventListener('pointercancel', () => clear());
  }

  /** Aktuelle Kommandos (roh, −1…1-Bereich der Joysticks). */
  commands() {
    // vx = vorwärts (Joystick hoch = −y), vy = seitwärts, wz = drehen
    // (rechts = +x → negative Drehung, wie ein Lenkrad)
    return { vx: -this.drive.y, vy: this.drive.x, wz: -this.head.x };
  }

  /** Hardware-/Tastatur-Zuführung (Feld-Tests ohne Touch). */
  setAnalog(dx, dy, hx, hy) {
    this.drive.x = dx; this.drive.y = dy; this.head.x = hx; this.head.y = hy;
  }

  press(i) { // programmatisch (Tests); ruft onButton
    this.buttons[i] = 1;
    if (this._btnEls) this._btnEls[i].classList.add('on');
    this.onButton && this.onButton(i, true);
    this.buttons[i] = 0;
    if (this._btnEls) this._btnEls[i].classList.remove('on');
  }

  toJSON() {
    return { driveActive: this.driveActive, goalFollow: this.goalFollow, headFollow: this.headFollow };
  }
  static fromJSON(src, container, opts) {
    const c = new Console(container, opts);
    if (src) {
      c.driveActive = !!src.driveActive;
      c.goalFollow = src.goalFollow !== false;
      c.headFollow = src.headFollow !== false;
    }
    return c;
  }
}
