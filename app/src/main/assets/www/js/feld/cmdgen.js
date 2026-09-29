// ═══════════════════════════════════════════════════════════
// feld/cmdgen.js — TRAININGSEINSATZ DER JOYSTICKS (Befehls-Generator)
//
// Der Nutzer entscheidet JE KANAL, wie der Joystick im Training
// eingesetzt wird — und sieht denselben Einsatz live im FELD:
//
//   aus       — Kanal liefert nichts (0) → Task-Zufallsplaner gilt
//   manuell   — nur die echte Hand (Konsole greift durch)
//   fix       — fester Wert (z. B. immer nach vorne)
//   sprung    — aktiviert sich ZUFÄLLIG mit zufälliger Richtung
//               (Sprung auf neuen Wert, Pause, wieder Sprung)
//   fluessig  — zufällige Ziele, die GLATT angefahren werden
//               (kritisch gedämpfte Glättung → flüssige Bewegungen)
//   schlange  — Schlangenlinien: Sinus mit zufälliger Frequenz,
//               Amplitude, Phase + langsamem Drift
//
// KERNIDEE (Nutzer): „Der Roboter soll sich nicht ein paar
// Positionen merken, sondern verstehen lernen." — der Generator
// macht die Befehlsverläufe im Training VIELFÄLTIG (Vielfalt =
// Verstehen): die Policy muss Kommandos AUS DER BEOBACHTUNG in
// Bewegung übersetzen, statt Episodenpfade zu memorieren.
//
// Die Ausgabe ist eine „virtuelle Hand": Sie schreibt die Werte in
// die Konsole (drive/head), sodass ALLE bestehenden Wege gelten —
// setUserCmd (Skill-Hinweis), Konsole→goTo/faceYaw, LAYA — und die
// Sticks im Overlay die generierten Befehle sichtbar bewegen.
// Eine echte Hand (Berührung) gewinnt immer gegen die virtuelle.
//
// Deterministisch über RNG (Seed) → Node-Tests.
// ═══════════════════════════════════════════════════════════

export const CMD_MODES = ['aus', 'manuell', 'fix', 'sprung', 'fluessig', 'schlange'];

export const CMD_MODE_LABELS = {
  aus: 'Aus',
  manuell: 'Manuell',
  fix: 'Fix',
  sprung: 'Zufallssprünge',
  fluessig: 'Flüssig',
  schlange: 'Schlangelinien',
};

/** Auto-Modi = Generator liefert Werte (echte Hand nur bei 'manuell'). */
export const CMD_AUTO = { fix: 1, sprung: 1, fluessig: 1, schlange: 1 };

const clamp1 = (v) => Math.min(1, Math.max(-1, v));
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Kanal-Parameter (Defaults). */
export function chanDefaults() {
  return {
    mode: 'aus',
    amp: 0.6,     // Amplitude (Anteil des Joystick-Wegs)
    fixX: 0.0,    // Fix-Wert X (seitlich / drehen)
    fixY: 0.6,    // Fix-Wert Y (vor/zurück; +Y = vorwärts → vx>0)
    holdS: 2.0,   // sprung: mittlere Dauer aktiv/pause (s)
    prob: 0.6,    // sprung: Anteil aktiv (0…1)
    tauS: 0.9,    // fluessig: Glättungszeitkonstante (s)
    retargetS: 1.6, // fluessig: mittlerer Abstand neuer Ziele (s)
    freqHz: 0.35, // schlange: Grundfrequenz (Hz)
  };
}

export class CmdGen {
  /**
   * @param opts { seed, drive: chan, head: chan }
   */
  constructor(opts = {}) {
    this.seed = opts.seed || 20260929;
    this.drive = Object.assign(chanDefaults(), opts.drive || {});
    this.head = Object.assign(chanDefaults(), opts.head || {});
    this.sanitize();
    this.reset();
  }

  sanitize() {
    const s = (c) => {
      if (!CMD_MODES.includes(c.mode)) c.mode = 'aus';
      c.amp = Math.min(1, Math.max(0, fin(c.amp, 0.6)));
      c.fixX = clamp1(fin(c.fixX, 0));
      c.fixY = clamp1(fin(c.fixY, 0.6));
      c.holdS = Math.min(10, Math.max(0.3, fin(c.holdS, 2)));
      c.prob = Math.min(1, Math.max(0, fin(c.prob, 0.6)));
      c.tauS = Math.min(3, Math.max(0.1, fin(c.tauS, 0.9)));
      c.retargetS = Math.min(6, Math.max(0.3, fin(c.retargetS, 1.6)));
      c.freqHz = Math.min(1.5, Math.max(0.05, fin(c.freqHz, 0.35)));
    };
    s(this.drive); s(this.head);
  }

  /** Mindestens ein Kanal generiert (Training soll setUserCmd füttern)? */
  active() {
    const a = (c) => !!CMD_AUTO[c.mode];
    return a(this.drive) || a(this.head);
  }

  reset() {
    // Eigener deterministischer Stream je Instanz
    let s = this.seed >>> 0;
    const rnd = () => {
      // mulberry32
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this._rnd = rnd;
    this._t = 0;
    // Kanal-Zustand: [x, y] je Eintrag
    this._st = {
      drive: this._chanState(),
      head: this._chanState(),
    };
  }

  _chanState() {
    return {
      v: [0, 0],          // aktueller Ausgabewert
      target: [0, 0],     // fluessig: aktuelles Ziel
      phase: [0, 0],      // schlange: Phasenwinkel (rad)
      fMul: [1, 1],       // schlange: Frequenz-Jitter
      ampMul: [1, 1],     // schlange: Amplituden-Jitter
      drift: [0, 0],      // schlange: Drift-Ziel
      jumpV: [0, 0],      // sprung: aktiver Sprungwert
      timer: 0,           // sprung/fluessig: Restzeit im Zustand
      on: false,          // sprung: aktiv?
    };
  }

  /**
   * Ein Zeitschritt (dt in s). Liefert { x, y, hx, hy } — rohe
   * Joystick-Koordinaten (−1…1) der beiden Kanäle.
   */
  tick(dt) {
    dt = Math.min(0.1, Math.max(0, fin(dt, 0.016)));
    this._t += dt;
    const dx = this._chan(this.drive, this._st.drive, dt);
    const dh = this._chan(this.head, this._st.head, dt);
    return { x: dx[0], y: dx[1], hx: dh[0], hy: dh[1] };
  }

  _chan(c, st, dt) {
    const out = [0, 0];
    if (c.mode === 'aus' || c.mode === 'manuell') {
      // nichts liefern (manuell: echte Hand, aus: still)
      return out;
    }
    if (c.mode === 'fix') {
      // Amplitude skaliert den Fix-Wert (Regler bleibt sinnvoll)
      out[0] = clamp1(c.fixX * c.amp);
      out[1] = clamp1(c.fixY * c.amp);
      st.v[0] = out[0]; st.v[1] = out[1];
      return out;
    }
    for (let k = 0; k < 2; k++) {
      if (c.mode === 'sprung') {
        // Zufallssprünge: Zustand würfelt NEU (aktiv mit Chance prob);
        // beim Wechsel springt der Wert — absichtlich OHNE Glättung.
        st.timer -= dt;
        if (st.timer <= 0) {
          st.on = this._rnd() < c.prob;
          st.jumpV[k] = st.on ? this._randDir(c.amp) : 0;
          st.timer = this._expo(c.holdS * (st.on ? 1 : 1.4));
        }
        st.v[k] = st.on ? st.jumpV[k] : 0;
      } else if (c.mode === 'fluessig') {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.target[k] = this._randDir(c.amp);
          st.timer = this._expo(c.retargetS);
        }
        // kritisch gedämpfte Glättung → flüssige Verläufe ohne Überschwinger
        const a = 1 - Math.exp(-dt / c.tauS);
        st.v[k] += (st.target[k] - st.v[k]) * a;
      } else { // schlange
        const f = c.freqHz * st.fMul[k];
        st.phase[k] += 2 * Math.PI * f * dt;
        // langsamer Drift (zweite kleine Sinus-Schwingung, 0,31·f)
        const drift = 0.22 * st.ampMul[k] * Math.sin(2 * Math.PI * 0.31 * f * this._t + st.phase[k] * 0.7);
        st.v[k] = c.amp * st.ampMul[k] * Math.sin(st.phase[k]) + drift;
      }
      out[k] = clamp1(st.v[k]);
    }
    st.v[0] = out[0]; st.v[1] = out[1];
    return out;
  }

  /** Zufälliger Wert im Band [−amp, +amp], Richtung zufällig, Betrag ≥ 25 %. */
  _randDir(amp) {
    const m = amp * (0.25 + 0.75 * this._rnd());
    return (this._rnd() < 0.5 ? -1 : 1) * m;
  }
  /** Exponentiell verteilte Dauer (Mittelwert m) mit 0,25…3-facher Klemme. */
  _expo(m) {
    const u = Math.max(1e-6, this._rnd());
    const e = -Math.log(1 - u); // Exp(1)
    return Math.min(3 * m, Math.max(0.25 * m, m * e));
  }

  toJSON() {
    return { seed: this.seed, drive: Object.assign({}, this.drive), head: Object.assign({}, this.head) };
  }
  static fromJSON(src, seedFallback) {
    const g = new CmdGen({ seed: (src && src.seed) || seedFallback || 20260929 });
    if (src) {
      if (src.drive) Object.assign(g.drive, src.drive);
      if (src.head) Object.assign(g.head, src.head);
      g.sanitize(); g.reset();
    }
    return g;
  }
}
