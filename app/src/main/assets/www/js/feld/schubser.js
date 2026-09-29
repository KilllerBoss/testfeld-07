// ═══════════════════════════════════════════════════════════
// feld/schubser.js — AUTOSCHUBSER (v3.2.0)
//
// Nutzer wörtlich: „Du hast autoschupser vergessen. Ich will bei
// Belohnungssystem einstellen können ob Schubser kommen, wie oft
// und wie stark (beim Training)."
//
// AUTOSCHUBSER = zufällige Stör-Impulse WÄHREND DES TRAININGS — die
// Policy lernt, Stöße wegzuregeln (Störungs-Robustheit), statt nur
// die wenigen unge störten Simulator-Pfade auswendig zu lernen.
// Der Roboter „versteht" Balancieren unter Störungen, statt sich
// Positionen zu merken.
//
// Regler (Belohnungs-Tab, Karte SCHUBSER):
//   on        — ob Schubser kommen (an/aus)
//   sMin/sMax — WIE OFT: Intervall in Sekunden (gleichverteilt)
//   vMin/vMax — WIE STARK: Geschwindigkeitssprung Δv in m/s
//   dir       — Richtung: auto (zufällig) · fwd/back/left/right —
//               gleiche Semantik wie engine.pushRandom (Impuls-Richtung
//               relativ zur Blickrichtung)
//   grow      — Curriculum „Stärke wächst mit Erfolg": Δv ×
//               (0,4 + 0,6 · Erfolgs-EMA) — bei Stürzen wird es
//               automatisch leichter, wenn die Ente standhält, schwerer
//   live      — auch im POLICY-Betrieb schubsen (zusehen, wie die Ente
//               reagiert); Default AUS (Nutzer: „beim Training")
//
// Technik (bewährtes Muster wie rW): Der Task liest cfg.schubser JE
// reward()-Aufruf — Regler wirken SOFORT, ohne Neustart. _schubNext
// zählt RL-Schritte (0,2 s Simzeit je Schritt = substeps 10 ×
// CTRL_DT 0,02), frisches Intervall je Episode (reset()). Das Modell
// wird VOM feld.js an cfg gebunden und in-place mutiert (Autosave/
// Import ändern dieselbe Instanz). Deterministisch mit RNG (Tests).
// ═══════════════════════════════════════════════════════════

import { clamp } from '../math.js';

/** Ein Regelzyklus in Simzeit (Sekunden) — FeldTrainer: substeps 10 × timestep 0.002 = CTRL_DT */
export const SCHUB_STEP_S = 0.02;

export const SCHUB_DIRS = ['auto', 'fwd', 'back', 'left', 'right'];
export const SCHUB_DIR_LABELS = {
  auto: 'Zufällig (auto)', fwd: 'Nach vorn', back: 'Nach hinten',
  left: 'Nach links', right: 'Nach rechts',
};

export const SCHUB_DEFAULTS = {
  on: 0, sMin: 3, sMax: 8, vMin: 0.4, vMax: 1.8,
  dir: 'auto', grow: 0, live: 0,
};

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class SchubModel {
  constructor(src) {
    Object.assign(this, SCHUB_DEFAULTS);
    this.last = null;   // letzter Schubs { dv, dir, t } — Anzeige (nicht serialisiert)
    this.count = 0;     // Schubser gesamt — Anzeige (nicht serialisiert)
    if (src) this.setFrom(src);
    this.sanitize();
  }
  /** In-place übernehmen (Autosave/Import behalten die cfg-Bindung). */
  setFrom(src) {
    if (!src) return this;
    this.on = fin(src.on, this.on);
    this.sMin = fin(src.sMin, this.sMin);
    this.sMax = fin(src.sMax, this.sMax);
    this.vMin = fin(src.vMin, this.vMin);
    this.vMax = fin(src.vMax, this.vMax);
    this.dir = SCHUB_DIRS.includes(src.dir) ? src.dir : this.dir;
    this.grow = fin(src.grow, this.grow);
    this.live = fin(src.live, this.live);
    return this;
  }
  sanitize() {
    this.on = this.on ? 1 : 0;
    this.grow = this.grow ? 1 : 0;
    this.live = this.live ? 1 : 0;
    this.sMin = clamp(fin(this.sMin, 3), 0.5, 60);
    this.sMax = clamp(fin(this.sMax, 8), this.sMin, 60);
    this.vMin = clamp(fin(this.vMin, 0.4), 0, 8);
    this.vMax = clamp(fin(this.vMax, 1.8), this.vMin, 10);
    if (!SCHUB_DIRS.includes(this.dir)) this.dir = 'auto';
    return this;
  }
  /** Effektivstärke eines Schubs (grow-Curriculum: Erfolg 0..1). */
  strength(baseDv, suc) {
    if (!this.grow) return baseDv;
    const s = clamp(fin(suc, 0.5), 0, 1);
    return baseDv * (0.4 + 0.6 * s);
  }
  toJSON() {
    return { on: this.on, sMin: this.sMin, sMax: this.sMax, vMin: this.vMin, vMax: this.vMax, dir: this.dir, grow: this.grow, live: this.live };
  }
  static fromJSON(src) { return new SchubModel(src); }
}

/**
 * Fälligkeit: liefert Basis-Δv (m/s) wenn JETZT geschubst werden soll,
 * sonst 0. _schubNext zählt Regelzyklen (0,02 s) — Intervall gleichverteilt
 * in [sMin, sMax] Sekunden, frisch gewürfelt je Episode und nach jedem
 * Schubs. grow skaliert auf die Erfolgs-EMA (task._schubSuc).
 * @param rng optional deterministischer RNG (Tests); sonst Math.random
 */
export function schubDue(task, rng) {
  const sc = task.cfg && task.cfg.schubser;
  if (!sc || !sc.on) return 0;
  const nxt = () => {
    const s = sc.sMin + (sc.sMax - sc.sMin) * (rng && rng.next ? rng.next() : Math.random());
    return Math.max(1, Math.round(s / SCHUB_STEP_S));
  };
  if (task._schubNext === undefined || task._schubNext === null) {
    task._schubNext = nxt();
    return 0;
  }
  if (--task._schubNext > 0) return 0;
  task._schubNext = nxt();
  const base = sc.vMin + (sc.vMax - sc.vMin) * (rng && rng.next ? rng.next() : Math.random());
  return sc.strength(base, task._schubSuc);
}

/**
 * Anwendung: horizontaler Impuls J = Δv · Gesamtmasse. Richtung wie
 * engine.pushRandom: fwd/back/left/right RELATIV zur Blickrichtung der
 * Basis, auto = absolut zufällig. Hängt Anzeige-Daten an den Task
 * (_schubCount, _schubLast) — das HUD zeigt sie im FELD-Tab.
 */
export function schubApply(task, sim, dv, rng) {
  if (!(dv > 0) || !sim || typeof sim.pushImpulse !== 'function') return null;
  const sc = task.cfg && task.cfg.schubser;
  const dir = sc ? sc.dir : 'auto';
  let rel = null;
  if (dir === 'fwd') rel = 0;
  else if (dir === 'back') rel = Math.PI;
  else if (dir === 'left') rel = Math.PI / 2;
  else if (dir === 'right') rel = -Math.PI / 2;
  let a;
  if (rel === null) {
    a = (rng && rng.next ? rng.next() : Math.random()) * 2 * Math.PI;
  } else {
    const bq = task._bqS || (task._bqS = new Float64Array(4));
    sim.baseQuat(bq);
    const w = bq[0], x = bq[1], y = bq[2], z = bq[3];
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    a = yaw + rel;
  }
  let mass = 0;
  for (let b = 0; b < sim.nbody; b++) mass += sim.model.body_mass[b];
  mass = Math.max(1, mass);
  const J = dv * mass;
  sim.pushImpulse(Math.cos(a) * J, Math.sin(a) * J, 0);
  task._schubCount = (task._schubCount || 0) + 1;
  task._schubLast = { dv, dir, t: task._epLen || 0 };
  return { dv, dir, angle: a, mass };
}
