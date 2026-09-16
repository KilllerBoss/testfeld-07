// ═══════════════════════════════════════════════════════════
// rewardx.js — KOMPLEXE BELohnungsTERME (v2.14.0)
// Gemini kann über den KI-Trainer (applyConfig → rWx) eigene
// Ziel-/Bedingungsterme zuschalten — über die festen rW-Gewichte
// hinaus, ohne dass ein Plugin geschrieben werden muss.
//
// Format (cfg.rWx):
//   { on: 0|1, terms: [ { kind, w, hard, ...params } ] }
//
// Terme (alle mit w = Gewicht, hard = optional bei Verletzung Abbruch):
//   goTo      {x, y, tol}    — dorthin bewegen (Fortschritt + Halt-Bonus)
//   stayNear  {x, y, r}      — im Umkreis r bleiben (Strafe für Überschuss)
//   heightBand{zMin, zMax}   — Basis-Höhe im Band halten (Ducken/Hüpfen)
//   faceYaw   {yaw}          — Blickrichtung yaw (rad) halten
//   paceMax   {v}            — nicht schneller als v (m/s)
//   paceMin   {v}            — mindestens v (m/s)
//   uprightMin{up}           — Aufrecht (upz) mindestens up (z. B. Kopfneigung)
//   symmetric                — L/R-Aktions-Antisymmetrie (Gangs-Formung)
//
// Alle Terme sind deterministisch, NaN-sicher und hart geklemmt.
// ═══════════════════════════════════════════════════════════

export const RWX_KINDS = ['goTo', 'stayNear', 'heightBand', 'faceYaw', 'paceMax', 'paceMin', 'uprightMin', 'symmetric'];

/** Einen Term hart validieren/klemmen → null wenn unbrauchbar. */
export function sanitizeTerm(t) {
  if (!t || typeof t !== 'object') return null;
  const kind = RWX_KINDS.includes(t.kind) ? t.kind : null;
  if (!kind) return null;
  const num = (v, lo, hi, dflt) => {
    const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
    if (!Number.isFinite(x)) return dflt;
    return Math.min(hi, Math.max(lo, x));
  };
  const out = { kind, w: num(t.w, 0, 5, kind === 'goTo' ? 0.5 : 0.2), hard: !!t.hard };
  if (kind === 'goTo' || kind === 'stayNear') {
    out.x = num(t.x, -12, 12, 0);
    out.y = num(t.y, -12, 12, 0);
    if (kind === 'goTo') out.tol = num(t.tol, 0.1, 3, 0.4);
    else out.r = num(t.r, 0.2, 6, 1.5);
  } else if (kind === 'heightBand') {
    const a = num(t.zMin, 0.02, 2, 0.05), b = num(t.zMax, 0.05, 3, 0.4);
    out.zMin = Math.min(a, b); out.zMax = Math.max(a, b);
  } else if (kind === 'faceYaw') {
    // yaw auf (−π, π] normalisieren
    out.yaw = num(t.yaw, -7, 7, 0);
    while (out.yaw > Math.PI) out.yaw -= 2 * Math.PI;
    while (out.yaw <= -Math.PI) out.yaw += 2 * Math.PI;
  } else if (kind === 'paceMax' || kind === 'paceMin') {
    out.v = num(t.v, 0.02, 4, kind === 'paceMax' ? 0.3 : 0.1);
  } else if (kind === 'uprightMin') {
    out.up = num(t.up, -1, 0.98, 0.8);
  }
  // symmetric: keine Zusatzparameter
  return out;
}

/** Ganze rWx-Spec validieren → {on, terms} (immer dieses Format). */
export function sanitizeRwx(raw) {
  const out = { on: 0, terms: [] };
  if (!raw || typeof raw !== 'object') return out;
  out.on = (raw.on === 1 || raw.on === true || raw.on === '1') ? 1 : 0;
  if (Array.isArray(raw.terms)) {
    for (const t of raw.terms.slice(0, 8)) {
      const s = sanitizeTerm(t);
      if (s) out.terms.push(s);
    }
  }
  return out;
}

const _angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/**
 * Terme bewerten. task muss ein Feld _rwxState tragen (reset() initialisiert):
 * { prevGoTo: Map-artiges Array je goTo-Term mit letzter Distanz }
 * Rückgabe: { r, done } — r = Summe aller Term-Beiträge, done nur wenn ein
 * hard-Term verletzt ist.
 */
export function rewardTerms(sim, terms, state) {
  let r = 0, hardHit = false;
  if (!terms || !terms.length) return { r, done: false };
  const st = state || {};
  if (!st.d) st.d = []; // distanzen je goTo-Term (fortlaufend)
  sim.basePos(st.p || (st.p = new Float64Array(3)));
  sim.baseQuat(st.q || (st.q = new Float64Array(4)));
  sim.baseVelWorld(st.v || (st.v = new Float64Array(3)));
  const q = st.q, w = q[0], x = q[1], y = q[2], z = q[3];
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const speed = Math.hypot(st.v[0], st.v[1]);
  const upz = 1 - 2 * (x * x + y * y);
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const wgt = t.w || 0;
    if (wgt <= 0) continue;
    if (t.kind === 'goTo') {
      const d = Math.hypot(st.p[0] - t.x, st.p[1] - t.y);
      const prev = (st.d[i] !== undefined) ? st.d[i] : d;
      st.d[i] = d;
      r += wgt * (prev - d);                      // Fortschritt (Annäherung +)
      if (d < t.tol) r += wgt * 0.02;             // Halt-Bonus im Zielkreis
    } else if (t.kind === 'stayNear') {
      const d = Math.hypot(st.p[0] - t.x, st.p[1] - t.y);
      const ex = Math.max(0, d - t.r);
      const pen = wgt * ex;
      r -= pen;
      if (t.hard && ex > 0.5) hardHit = true;
    } else if (t.kind === 'heightBand') {
      const hz = st.p[2];
      const ex = hz < t.zMin ? (t.zMin - hz) : (hz > t.zMax ? (hz - t.zMax) : 0);
      r -= wgt * ex * ex;
      if (t.hard && ex > 0.25) hardHit = true;
    } else if (t.kind === 'faceYaw') {
      const e = Math.abs(_angDiff(yaw, t.yaw));
      r -= wgt * e;
      if (t.hard && e > 1.4) hardHit = true;
    } else if (t.kind === 'paceMax') {
      const ex = Math.max(0, speed - t.v);
      r -= wgt * ex;
      if (t.hard && ex > 0.8) hardHit = true;
    } else if (t.kind === 'paceMin') {
      const ex = Math.max(0, t.v - speed);
      r -= wgt * ex;
    } else if (t.kind === 'uprightMin') {
      const ex = Math.max(0, t.up - upz);
      r -= wgt * ex;
      if (t.hard && ex > 0.5) hardHit = true;
    } else if (t.kind === 'symmetric') {
      // L/R-Paare der letzten Aktion: links + rechts soll Antisymmetrie bilden
      if (task && task.lastAct && task._symPairs) {
        let s = 0;
        for (const [li, ri] of task._symPairs) s += task.lastAct[li] + task.lastAct[ri];
        r -= wgt * s * s;
      }
    }
  }
  return { r, done: hardHit };
}

/** Reset je Episode (Terme-Distanz-State leeren). */
export function resetTermState(task) {
  if (task) task._rwxState = { d: [] };
}
