// ═══════════════════════════════════════════════════════════
// skill.js — Skill-/Experten-Belohnungen (v2.13.0, Master-Prompt-Stil):
// Jeder MoE-Experte bekommt seine EIGENE Bewertung, und der ROUTER wird
// belohnt, wenn er im passenden Zustand den passenden Experten wählt.
// Beispiel: Roboter liegt → Router wählt „aufstehen" (recover) → Bonus;
// der Recover-Experte wird belohnt, wenn der Roboter tatsächlich aufragt.
// Funktioniert roboterübergreifend (Beiner + Drohne).
// Die Policy bekommt die Kamera NIE als Eingang — das ist reine Anzeige.
// ═══════════════════════════════════════════════════════════

// Standard-Gewichte (KI-Trainer kann ALLE Felder live ändern).
export const EXPERT_R = {
  on: 1,              // 1 = Skill-Belohnungen aktiv (braucht MoE-Architektur)
  routerBonus: 0.25,  // Router wählt passenden Experten im passenden Zustand
  wrongPenalty: 0.06, // Router wählt klar falschen Experten (weich, kein Chaos)
  domMin: 0.35,       // Mindest-Gewicht, damit ein Experte „dominiert"
  fallenUp: 0.45,     // upz darunter = LIEGEND
  upOk: 0.85,         // upz darüber = aufrecht (dazwischen = aufrichten)
  moveVx: 0.15,       // |v_vorwärts| darüber = Fahren/Gehen (m/s)
  moveWz: 0.45,       // |Gier-Rate| darüber = Drehen (rad/s)
  stand: { up: 0.10, quiet: 0.08 },       // Stand-Experte: aufrecht + ruhig
  walk:  { speed: 0.30 },                 // Walk-Experte: tatsächliche Fahrt
  turn:  { rate: 0.25 },                  // Turn-Experte: tatsächliche Drehung
  recover: { rise: 1.2, uprightOnce: 0.8 }, // Recover: Aufrichten + einmalig oben
};

// Standard-Experten-Namen je Roboterart (KI kann sie umbenennen).
export function defaultExpertNames(drone) {
  return drone ? ['hover', 'move', 'turn', 'descend'] : ['stand', 'walk', 'turn', 'recover'];
}

// Welche Zustände zählen für einen Experten-Namen als „passend"?
const NAME_MATCH = {
  balance: ['stand', 'hover'],
  stand: ['stand', 'hover'],
  idle: ['stand', 'hover'],
  recover: ['fallen', 'rising'],
  aufstehen: ['fallen', 'rising'],
  walk: ['walk'], go: ['walk'], laufen: ['walk'], move: ['move', 'walk'],
  turn: ['turn'], drehen: ['turn'],
  hover: ['hover'], schweben: ['hover'],
  climb: ['climb'], steigen: ['climb'], ascend: ['climb'],
  descend: ['descend'], sinken: ['descend'],
};

// ── Zustands-Klassifikation ─────────────────────────────────
// Beiner (A1/Spot/G1/Go2/MicroDuck): fallen | rising | stand | walk | turn
export function leggedSkillState(upz, vFwd, yawRate) {
  const ER = EXPERT_R;
  if (upz < ER.fallenUp) return 'fallen';
  if (upz < ER.upOk) return 'rising';
  if (Math.abs(yawRate) > ER.moveWz && Math.abs(vFwd) < ER.moveVx) return 'turn';
  if (Math.abs(vFwd) > ER.moveVx || Math.abs(yawRate) > 0.3) return 'walk';
  return 'stand';
}

// Drohne (X2): descend | climb | turn | move | hover
export function droneSkillState(vz, vFwd, yawRate, tiltAbs) {
  const ER = EXPERT_R;
  if (vz < -0.35) return 'descend';
  if (vz > 0.35) return 'climb';
  if (Math.abs(yawRate) > ER.moveWz && Math.abs(vFwd) < ER.moveVx) return 'turn';
  if (Math.abs(vFwd) > ER.moveVx) return 'move';
  if (tiltAbs > 0.35) return 'move';
  return 'hover';
}

/**
 * Router- + Experten-Belohnung für einen Schritt.
 * o: { state, route(Float32Array|null), names(string[]|null),
 *      prevUp, wasFallen, upz, vFwd, yawRate, speed, cmdVx, cmdYaw }
 * → { r, domIdx, domName }  (r = Zusatzbelohnung; Basis-Belohnung unverändert)
 */
export function expertRouterReward(o) {
  const ER = EXPERT_R;
  const out = { r: 0, domIdx: -1, domName: null };
  if (!o.route || !o.names || !o.route.length) return out;

  // Dominanten Experten bestimmen (weiche Mischung → Argmax)
  let domW = 0;
  for (let k = 0; k < o.route.length; k++) {
    if (o.route[k] > domW) { domW = o.route[k]; out.domIdx = k; }
  }
  if (out.domIdx < 0) return out;
  out.domName = o.names[out.domIdx] || null;
  if (!out.domName || domW < ER.domMin) return out;

  // 1) ROUTER-Belohnung: passt der gewählte Experte zum Zustand?
  const match = NAME_MATCH[out.domName.toLowerCase()];
  if (match && match.includes(o.state)) {
    out.r += ER.routerBonus * domW;
  } else {
    // Klar falsch gepaart — aber nur wenn der Zustand überhaupt ein
    // bekannter Skill ist (sonst keine Strafe, um Chaos zu vermeiden).
    const known = Object.values(NAME_MATCH).some(a => a.includes(o.state));
    if (known && match) out.r -= ER.wrongPenalty * domW;
  }

  // 2) EXPERTEN-Ergebnis: was hat der Roboter TATSÄCHLICH getan?
  const nm = out.domName.toLowerCase();
  if ((nm === 'recover' || nm === 'aufstehen')) {
    // Aufrichten: Belohnung für jeden Aufwärts-Fortschritt (×10 pro Schritt),
    // doppelt so viel, solange er noch am Boden ist / sich aufrichtet.
    const rise = Math.max(0, o.upz - o.prevUp);
    out.r += ER.recover.rise * 10 * rise * ((o.state === 'fallen' || o.state === 'rising') ? 2 : 1);
  } else if (nm === 'stand' || nm === 'idle' || nm === 'hover' || nm === 'schweben' || nm === 'balance') {
    // Stehen/Schweben: ruhig UND aufrecht sein
    if (o.state === 'stand' || o.state === 'hover') {
      out.r += ER.stand.quiet * (0.5 - Math.min(0.5, o.speed));
      out.r += ER.stand.up * (o.upz - 0.9);
    }
  } else if (nm === 'walk' || nm === 'go' || nm === 'laufen' || nm === 'move') {
    // Gehen/Fahren: tatsächliche Vorwärtsfahrt zählt (bis zum Befehl)
    if (o.state === 'walk' || o.state === 'move') {
      const cap = Math.max(0.2, Math.abs(o.cmdVx || 0));
      out.r += ER.walk.speed * Math.min(Math.abs(o.vFwd), cap);
    }
  } else if (nm === 'turn' || nm === 'drehen') {
    // Drehen: tatsächliche Gier-Rate zählt
    if (o.state === 'turn') out.r += ER.turn.rate * Math.min(Math.abs(o.yawRate), 2);
  }
  return out;
}
