// ═══════════════════════════════════════════════════════════
// agent.js — KI-AGENT-Fähigkeiten: Die KI darf eigene Buttons
// anlegen/belegen, den Joystick ummappen und Aktionen ausführen.
// ALLES deklarativ + hart validiert (keine Freitext-Logik, kein
// eval): Vollzugriff auf die App-Primitiven, aber nichts kann
// die Physik sprengen oder die App abstürzen.
//   Buttons:  reset | push | cmd (Autofahrten) | mode | clip | macro
//   Joystick: maxV, maxW, invertX/Y, deadzone, expo
// Persistenz: localStorage (tr_ai_ui_v1 / tr_ai_joy_v1 / tr_push_v1)
// ═══════════════════════════════════════════════════════════

export const MAX_BUTTONS = 12;
export const MAX_MACRO_STEPS = 6;
export const ACTION_TYPES = ['reset', 'push', 'cmd', 'mode', 'clip', 'macro'];

const LS_UI = 'tr_ai_ui_v1';
const LS_JOY = 'tr_ai_joy_v1';
const LS_PUSH = 'tr_push_v1';

const _num = (v, lo, hi, dflt) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
};

function _sanitizeLabel(s, dflt) {
  if (typeof s !== 'string') return dflt;
  const t = s.replace(/[<>&"']/g, '').trim().slice(0, 20);
  return t || dflt;
}

// ── Buttons ─────────────────────────────────────────────────
export function loadButtons() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_UI) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_BUTTONS).map(validateButtonDef).filter(Boolean);
  } catch (e) { return []; }
}
export function saveButtons(list) {
  try { localStorage.setItem(LS_UI, JSON.stringify(list.slice(0, MAX_BUTTONS))); } catch (e) { /* voll */ }
}

/** Validiert eine Button-Definition hart; null = verwerfen. */
export function validateButtonDef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const act = _validateAction(raw.action);
  if (!act) return null;
  return {
    id: (typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(raw.id)) ? raw.id : ('ab' + Math.random().toString(36).slice(2, 8)),
    label: _sanitizeLabel(raw.label, act.type === 'macro' ? 'Makro' : act.type.toUpperCase()),
    action: act,
  };
}

/** Validiert eine einzelne Aktion (auch Makro-Schritte); null = verwerfen. */
export function _validateAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type;
  if (type === 'reset') return { type: 'reset' };
  if (type === 'push') {
    const dir = ['auto', 'fwd', 'back', 'left', 'right'].includes(raw.dir) ? raw.dir : 'auto';
    return { type: 'push', dir, strength: _num(raw.strength, 0.5, 10, 3) };
  }
  if (type === 'cmd') {
    return {
      type: 'cmd',
      vx: _num(raw.vx, -2, 3, 0.5),
      yaw: _num(raw.yaw, -3, 3, 0),
      ms: Math.round(_num(raw.ms, 300, 60000, 10000)),
    };
  }
  if (type === 'mode') {
    return { type: 'mode', mode: raw.mode === 'policy' ? 'policy' : 'manuell' };
  }
  if (type === 'clip') {
    return { type: 'clip', index: Math.round(_num(raw.index, 0, 7, 0)) };
  }
  if (type === 'macro') {
    const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_MACRO_STEPS) : [];
    const clean = [];
    for (const st of steps) {
      if (!st || typeof st !== 'object') continue;
      if (st.waitMs !== undefined) {
        clean.push({ waitMs: Math.round(_num(st.waitMs, 50, 5000, 500)) });
        continue;
      }
      const sub = _validateAction(st);
      if (sub) clean.push(sub);
      if (clean.length >= MAX_MACRO_STEPS) break;
    }
    if (!clean.length) return null;
    return { type: 'macro', steps: clean };
  }
  return null;
}

export function addButton(def) {
  const list = loadButtons();
  const clean = validateButtonDef(def);
  if (!clean) return { ok: false, reason: 'Ungültige Button-Definition' };
  if (list.length >= MAX_BUTTONS) return { ok: false, reason: `Button-Leiste voll (max ${MAX_BUTTONS})` };
  if (list.some(b => b.id === clean.id)) clean.id = clean.id.slice(0, 18) + '_' + Math.random().toString(36).slice(2, 5);
  list.push(clean);
  saveButtons(list);
  return { ok: true, button: clean, list };
}

export function removeButton(id) {
  const list = loadButtons();
  const idx = list.findIndex(b => b.id === id);
  if (idx < 0) return { ok: false, reason: 'Button nicht gefunden' };
  list.splice(idx, 1);
  saveButtons(list);
  return { ok: true, list };
}

// ── Joystick-Belegung ───────────────────────────────────────
export const DEFAULT_JOY = { maxV: 1.0, maxW: 1.0, invertX: false, invertY: false, deadzone: 0.08, expo: 0.4 };

export function loadJoyMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_JOY) || 'null');
    return raw ? validateJoyMap(raw) : Object.assign({}, DEFAULT_JOY);
  } catch (e) { return Object.assign({}, DEFAULT_JOY); }
}
export function saveJoyMap(m) {
  try { localStorage.setItem(LS_JOY, JSON.stringify(m)); } catch (e) { /* voll */ }
}
export function validateJoyMap(raw) {
  const m = Object.assign({}, DEFAULT_JOY);
  if (!raw || typeof raw !== 'object') return m;
  m.maxV = _num(raw.maxV, 0.1, 3, DEFAULT_JOY.maxV);
  m.maxW = _num(raw.maxW, 0.1, 4, DEFAULT_JOY.maxW);
  m.invertX = !!raw.invertX;
  m.invertY = !!raw.invertY;
  m.deadzone = _num(raw.deadzone, 0, 0.5, DEFAULT_JOY.deadzone);
  m.expo = _num(raw.expo, 0, 1, DEFAULT_JOY.expo);
  return m;
}

// ── Schubs-Stärke (v2.5.0: Δv-basiert — 1,0 ≈ 1 m/s Geschwindigkeitssprung) ──
export function loadPushStrength() { return _num(parseFloat(localStorage.getItem(LS_PUSH)), 0.5, 10, 3); }
export function savePushStrength(v) {
  const x = _num(v, 0.5, 10, 3);
  try { localStorage.setItem(LS_PUSH, String(x)); } catch (e) { /* voll */ }
  return x;
}
