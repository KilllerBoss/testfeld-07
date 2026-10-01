// ═══════════════════════════════════════════════════════════
// feld/gemini.js — KI-SETUP MIT GEMINI (v3.7.0)
//
// Nutzer: „füge Gemini API hinzu, damit es alles für mich einstellt."
//
// Der Nutzer tippt einen Wunsch in natürlichem Deutsch („mach sie
// schneller wendig, schubser stärker, nach sturz weiter üben") —
// Gemini bekommt den Wunsch + die KOMPLETTE aktuelle Konfiguration
// + eine strenge Feld-/Bereichs-Beschreibung und antwortet NUR mit
// einem JSON-Objekt. applySetup() validiert JEDE Zahl (Klemmen),
// jeden Schalter (bool-Koercion) und jede Auswahl (Enums), schreibt
// die Werte IN-PLACE in die live gebundenen Modelle (rew/schubser/
// ground/phone — wirken SOFORT, wie bei den Handreglern) und liefert
// eine deutsche Änderungsliste für die Statuszeile.
//
// Transport: native Brücke TrainrobotAI (APK — HTTPS ohne WebView-
// CORS-Unwägbarkeiten, Content-Type JSON fix), Browser-Fallback:
// fetch ohne Extra-Header (kein Preflight). Eingebetteter Schlüssel
// als Standard, in der Karte jederzeit ersetzbar (localStorage,
// gleicher Speicher wie der Alt-Trainer tr_ai_key_v1).
//
// Modell: „Auto" = ListModels-Discovery (neuestes Flash, 7-Tage-Cache),
// Fallback-Kette statisch. Alles andere sind feste Namen.
// ═══════════════════════════════════════════════════════════

import { VERSION, APP_NAME } from './version.js';
import { RW_FIELDS } from './rewards.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Nutzer-Schlüssel (Google AI Studio, AQ.-Format) — Standard, in der Karte
// jederzeit ersetzbar (localStorage tr_ai_key_v1, geteilt mit Alt-Trainer).
// GITHUB PUSH PROTECTION: der echte Schlüssel liegt NICHT im Git-Repo.
// Er wird beim Build aus dem Actions-Secret GEMINI_API_KEY in die
// (gitignorierte) Datei js/feld/aiconfig.js geschrieben. Ohne diese Datei
// gilt der in der KI-SETUP-Karte eingetragene Schlüssel.
let EMBEDDED_KEY = '';
try { ({ EMBEDDED_AI_KEY: EMBEDDED_KEY } = await import('./aiconfig.js')); } catch (e) { /* kein Build-Key eingebettet */ }
const LS_KEY = 'tr_ai_key_v1';
const LS_MODELS = 'feld_ai_models_v1';
const MODEL_TTL = 7 * 24 * 3600e3;
// Fallback-Kette, falls ListModels blockiert ist (neueste zuerst).
// v3.7.1-ERKENNTNIS (Echt-Test): „gemini-2.5-flash" ist für NEUE Schlüssel
// ABGESCHALTET („no longer available to new users. Please update your code
// to use models/gemini-3.8-flash“) — die Kette führt deshalb 3.8-flash.
const MODEL_CHAIN = ['gemini-3.8-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

export const DEFAULT_WISH = 'Optimiere die Trainingskonfiguration für stabiles, sicheres Gehen der Ente (zuerst Balance, dann Tempo), ohne dass sie oft fällt.';

export function getApiKey() {
  try {
    const k = (localStorage.getItem(LS_KEY) || '').trim();
    if (k) return k;
  } catch (e) { /* kein Storage */ }
  return EMBEDDED_KEY;
}
export function setApiKey(k) {
  const v = (k || '').trim();
  try {
    if (v) localStorage.setItem(LS_KEY, v);
    else localStorage.removeItem(LS_KEY);
  } catch (e) { /* egal */ }
  return getApiKey();
}

// ── Transport (APK: Java-Brücke, Browser: fetch) ───────────
let _seq = 0;
const _pending = new Map();

export function initGemTransport() {
  if (typeof window === 'undefined') return;
  window.__gemReply = (id, code, body, err) => {
    const p = _pending.get(id);
    if (!p) return;
    _pending.delete(id);
    clearTimeout(p.t);
    if (err) p.reject(new Error(err));
    else p.resolve({ code, body });
  };
}

function http(url, method, body) {
  const bridge = (typeof window !== 'undefined') && window.TrainrobotAI;
  if (bridge && typeof bridge.available === 'function' && bridge.available()) {
    const id = 'gem' + (++_seq);
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, t: 0 };
      _pending.set(id, entry);
      entry.t = setTimeout(() => {
        if (_pending.has(id)) { _pending.delete(id); reject(new Error('Zeitüberschreitung der KI-Anfrage (60 s)')); }
      }, 60000);
      try { bridge.request(url, method, body || '', id); }
      catch (e) { _pending.delete(id); clearTimeout(entry.t); reject(e); }
    });
  }
  if (typeof fetch !== 'function') return Promise.reject(new Error('Kein Transport (Brücke fehlt, kein fetch)'));
  // Browser: bewusst ohne Extra-Header (kein CORS-Preflight)
  return fetch(url, { method, body: method === 'POST' ? body : undefined })
    .then((r) => r.text().then((t) => ({ code: r.status, body: t })));
}

function errText(code, body) {
  let msg = body;
  try { msg = JSON.parse(body).error.message || body; } catch (e) { /* Rohtext */ }
  if (code === 403) return 'Zugriff verweigert (403): ' + msg;
  if (/location is not supported/i.test(msg)) return 'Diese Netz-Region wird von Google blockiert („User location is not supported“) — anderes Netz/ohne VPN versuchen (in Deutschland funktioniert die KI).';
  if (code === 401 || /API key not valid|API_KEY_INVALID/i.test(msg)) return 'Gemini-Schlüssel ungültig oder abgelaufen — neuen Schlüssel in der KI-SETUP-Karte eintragen.';
  if (code === 429) return 'KI-Limit erreicht (429) — kurz warten und erneut versuchen.';
  if (code === 404) return 'Modell nicht gefunden (404): ' + msg;
  if (code >= 500) return 'KI-Dienst gestört (' + code + '). Später erneut versuchen.';
  if (code === 0) return 'Kein Internet: Die KI braucht einmalig Verbindung (Rest der App bleibt offline).';
  return 'KI-Fehler (' + code + '): ' + msg;
}

// ── Modell-Wahl ─────────────────────────────────────────────
let _modelP = null;
export function autoModel(force = false) {
  if (!force && _modelP) return _modelP;
  _modelP = (async () => {
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(LS_MODELS) || 'null');
        if (c && c.t && Date.now() - c.t < MODEL_TTL && c.model) return c.model;
      } catch (e) { /* neu entdecken */ }
    }
    let model = MODEL_CHAIN[0];
    try {
      const url = API_BASE + '/models?pageSize=200&key=' + encodeURIComponent(getApiKey());
      const { code, body } = await http(url, 'GET', '');
      if (code === 200) {
        const list = (JSON.parse(body).models || [])
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => /flash/.test(n) && !/embed|imagen|veo|tts|audio|image|live|thinking|exp/.test(n));
        const score = (n) => { const m = /gemini(\d+)(?:\.(\d+))?/.exec(n); return m ? parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2], 10) : 0) : -1; };
        let best = null, bs = -1;
        for (const n of list) { const s = score(n); if (s > bs) { bs = s; best = n; } }
        if (best) model = best;
      }
    } catch (e) { /* Fallback-Kette */ }
    try { localStorage.setItem(LS_MODELS, JSON.stringify({ model, t: Date.now() })); } catch (e) { /* egal */ }
    return model;
  })();
  _modelP.catch(() => { _modelP = null; });
  return _modelP;
}

// ── Zustand-Snapshot (an die KI) ────────────────────────────
const pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o[k]; return r; };
const REW_KEYS = RW_FIELDS.map((r) => r[0]);

export function buildStateSnap(S) {
  const t = S.trainer || {};
  const snap = {
    app: APP_NAME + ' ' + VERSION,
    mode: S.mode,
    stage: t.stage,
    budget: S.budget,
    level: S.task ? S.task.level : undefined,
    fall: { mode: S.fallMode, winS: S.fallWinS },
    hyper: t.hyper ? pick(t.hyper, ['T', 'gamma', 'lam', 'clip', 'epochs', 'mb', 'lr', 'cV', 'cE']) : undefined,
    tricks: t.tricks ? { on: !!t.tricks.on, autoLr: !!t.tricks.autoLr, autoRollout: !!t.tricks.autoRollout, autoNoise: !!t.tricks.autoNoise } : undefined,
    rew: S.rew ? pick(S.rew, REW_KEYS) : undefined,
    rwx: S.rwx ? { on: !!S.rwx.on, termCount: S.rwx.terms.length } : undefined,
    schubser: S.schubser ? pick(S.schubser, ['on', 'sMin', 'sMax', 'vMin', 'vMax', 'dir', 'grow', 'live']) : undefined,
    ground: S.ground ? pick(S.ground, ['on', 'mode', 'amp', 'freq', 'live']) : undefined,
    phone: S.phone ? pick(S.phone, ['on', 'pushOn', 'groundOn', 'inv', 'sens', 'thr', 'vMax', 'tiltMax']) : undefined,
    cmdgen: S.cmdgen ? { drive: S.cmdgen.drive.mode, head: S.cmdgen.head.mode } : undefined,
    console: S.konsole ? { on: !!S.konsole.driveActive } : undefined,
    policy: { obsDim: S.task ? S.task.obsDim : undefined, actDim: S.task ? S.task.actDim : undefined },
  };
  return snap;
}

// ── Validierungs-Spezifikation ──────────────────────────────
// [min, max, 'int'|'float'] | 'bool' | Enum-Array
const B = 'bool';
export const GEM_SPEC = {
  'training.budget': [5, 150, 'int'],
  'training.level': [1, 5, 'int'],
  'training.fallMode': ['reset', 'ueben'],
  'training.fallWinS': [2, 20, 'float'],
  'training.tricksOn': B, 'training.autoLr': B, 'training.autoRollout': B, 'training.autoNoise': B,
  'hyper.T': [256, 4096, 'int'],
  'hyper.lr': [6e-5, 1.2e-3, 'float'],
  'hyper.clip': [0.05, 0.4, 'float'],
  'hyper.epochs': [1, 8, 'int'],
  'hyper.mb': [64, 1024, 'int'],
  'hyper.gamma': [0.9, 0.999, 'float'],
  'hyper.lam': [0.8, 0.99, 'float'],
  'hyper.cE': [0, 0.02, 'float'],
  'schubser.on': B, 'schubser.grow': B, 'schubser.live': B,
  'schubser.sMin': [0.5, 60, 'float'], 'schubser.sMax': [0.5, 60, 'float'],
  'schubser.vMin': [0, 8, 'float'], 'schubser.vMax': [0, 8, 'float'],
  'schubser.dir': ['auto', 'fwd', 'back', 'left', 'right'],
  'ground.on': B, 'ground.live': B,
  'ground.mode': ['sinus', 'zufall', 'achter', 'drift'],
  'ground.amp': [1, 25, 'float'], 'ground.freq': [0.05, 1.5, 'float'],
  'phone.on': B, 'phone.pushOn': B, 'phone.groundOn': B, 'phone.inv': B,
  'phone.sens': [0.1, 3, 'float'], 'phone.thr': [0.5, 20, 'float'],
  'phone.vMax': [0.2, 4, 'float'], 'phone.tiltMax': [1, 25, 'float'],
  'cmdgen.drive': ['aus', 'manuell', 'fix', 'sprung', 'fluessig', 'schlange'],
  'cmdgen.head': ['aus', 'manuell', 'fix', 'sprung', 'fluessig', 'schlange'],
};
for (const [key, label, lo, hi] of RW_FIELDS) GEM_SPEC['rew.' + key] = [lo, hi, 'float'];

const LABELS = {
  'training.budget': 'Trainings-Schritte je Bild',
  'training.level': 'Curriculum-Level',
  'training.fallMode': 'Sturz-Verhalten',
  'training.fallWinS': 'Aufsteh-Fenster (s)',
  'training.tricksOn': 'Tricks gesamt',
  'training.autoLr': 'Tricks: automatische Lernrate',
  'training.autoRollout': 'Tricks: automatischer Rollout',
  'training.autoNoise': 'Tricks: automatisches Rauschen',
  'hyper.T': 'PPO-Rollout T',
  'hyper.lr': 'Lernrate',
  'hyper.clip': 'PPO-Clip',
  'hyper.epochs': 'PPO-Epochen',
  'hyper.mb': 'Minibatch',
  'hyper.gamma': 'Gamma',
  'hyper.lam': 'GAE-Lambda',
  'hyper.cE': 'Entropie-Bonus',
  'schubser.on': 'Schubser',
  'schubser.grow': 'Schubser-Stärke wächst mit Erfolg',
  'schubser.live': 'Schubser im POLICY-Betrieb',
  'schubser.sMin': 'Schubser-Intervall von (s)',
  'schubser.sMax': 'Schubser-Intervall bis (s)',
  'schubser.vMin': 'Schubser-Stärke Δv von (m/s)',
  'schubser.vMax': 'Schubser-Stärke Δv bis (m/s)',
  'schubser.dir': 'Schubser-Richtung',
  'ground.on': 'Beweglicher Boden',
  'ground.live': 'Boden im POLICY-Betrieb',
  'ground.mode': 'Boden-Muster',
  'ground.amp': 'Boden-Neigung max (°)',
  'ground.freq': 'Boden-Frequenz (Hz)',
  'phone.on': 'Handy-Sensor',
  'phone.pushOn': 'Handy: Bewegung schubst',
  'phone.groundOn': 'Handy: Neigung bewegt den Boden',
  'phone.inv': 'Handy: Richtung umkehren',
  'phone.sens': 'Handy-Empfindlichkeit',
  'phone.thr': 'Handy-Schwelle (m/s²)',
  'phone.vMax': 'Handy-Schubs max (m/s)',
  'phone.tiltMax': 'Handy-Neigung max (°)',
  'cmdgen.drive': 'Trainingseinsatz Bewegung',
  'cmdgen.head': 'Trainingseinsatz Kopf',
};
const REW_LABELS = {};
for (const [key, label] of RW_FIELDS) REW_LABELS['rew.' + key] = label;
Object.assign(LABELS, REW_LABELS);

const FALL_LABEL = { reset: 'NEUSTART', ueben: 'WEITERÜBEN' };
const fmt = (v) => {
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1000 || (Number.isInteger(v) && Math.abs(v) < 1e15)) return String(v);
    return String(Math.round(v * 1000) / 1000).replace('.', ',');
  }
  return String(v);
};

/** Wert normalisieren: bool-Koercion, Zahlklemmen, Enum-Check. */
function coerce(path, value) {
  const spec = GEM_SPEC[path];
  if (!spec) return { skip: 'unbekannt' };
  if (spec === B) {
    const t = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (t === true || t === 1 || t === '1' || t === 'true' || t === 'ja' || t === 'ein' || t === 'an') return { v: 1 };
    if (t === false || t === 0 || t === '0' || t === 'false' || t === 'nein' || t === 'aus') return { v: 0 };
    return { skip: 'bool' };
  }
  if (Array.isArray(spec)) {
    if (typeof spec[0] === 'string') {
      const s = String(value).trim().toLowerCase();
      return spec.includes(s) ? { v: s } : { skip: 'enum' };
    }
    let n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) return { skip: 'zahl' };
    n = spec[2] === 'int' ? Math.round(n) : n;
    n = Math.max(spec[0], Math.min(spec[1], n));
    return { v: n };
  }
  return { skip: 'unbekannt' };
}

/** Einen Pfad in die Live-Modelle schreiben — liefert Änderungstext oder null. */
function setPath(path, value, S) {
  const c = coerce(path, value);
  if (c.skip) return null;
  const v = c.v;
  const label = LABELS[path] || path;
  if (path.startsWith('rew.')) {
    const k = path.slice(4);
    if (!S.rew) return null;
    const old = S.rew[k];
    if (old === v) return null;
    S.rew[k] = v;
    return label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path.startsWith('hyper.')) {
    const k = path.slice(6);
    if (!S.trainer || !S.trainer.hyper) return null;
    const old = S.trainer.hyper[k];
    if (old === v) return null;
    S.trainer.hyper[k] = v;
    return label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path === 'training.budget') {
    const old = S.budget;
    if (old === v) return null;
    S.budget = v;
    return label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path === 'training.level') {
    if (!S.task || typeof S.task.setLevel !== 'function') return null;
    const old = S.task.level;
    if (old === v) return null;
    S.task.setLevel(v, true);
    return label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path === 'training.fallMode') {
    if (S.fallMode === v) return null;
    S.fallMode = v;
    return 'Sturz-Verhalten: ' + FALL_LABEL[v];
  }
  if (path === 'training.fallWinS') {
    const old = S.fallWinS;
    if (old === v) return null;
    S.fallWinS = v;
    return label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path.startsWith('training.')) {
    const k = path.slice(9);
    if (!S.trainer || !S.trainer.tricks) return null;
    const old = S.trainer.tricks[k] ? 1 : 0;
    if (old === v) return null;
    S.trainer.tricks[k] = !!v;
    return label + ': ' + (v ? 'EIN' : 'AUS');
  }
  if (path.startsWith('schubser.')) {
    const k = path.slice(9);
    if (!S.schubser) return null;
    const old = S.schubser[k];
    if (old === v) return null;
    S.schubser[k] = v;
    return typeof v === 'number' && (k === 'on' || k === 'grow' || k === 'live')
      ? label + ': ' + (v ? 'EIN' : 'AUS')
      : label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path.startsWith('ground.')) {
    const k = path.slice(7);
    if (!S.ground) return null;
    const old = S.ground[k];
    if (old === v) return null;
    S.ground[k] = v;
    return k === 'on' || k === 'live' ? label + ': ' + (v ? 'EIN' : 'AUS') : label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path.startsWith('phone.')) {
    const k = path.slice(6);
    if (!S.phone) return null;
    const old = S.phone[k];
    if (old === v) return null;
    S.phone[k] = v;
    return typeof v === 'number' && (k !== 'sens' && k !== 'thr' && k !== 'vMax' && k !== 'tiltMax')
      ? label + ': ' + (v ? 'EIN' : 'AUS')
      : label + ': ' + fmt(old) + ' → ' + fmt(v);
  }
  if (path === 'cmdgen.drive' || path === 'cmdgen.head') {
    const ch = path === 'cmdgen.drive' ? S.cmdgen && S.cmdgen.drive : S.cmdgen && S.cmdgen.head;
    if (!ch) return null;
    if (ch.mode === v) return null;
    ch.mode = v;
    return label + ': ' + v;
  }
  return null;
}

/**
 * KI-Antwort (verschachteltes JSON) validieren + ANWENDEN.
 * @returns { changes: string[], skipped: string[] }
 */
export function applySetup(cfg, S) {
  const changes = [], skipped = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { changes, skipped };
  for (const group of Object.keys(cfg)) {
    const g = cfg[group];
    if (!g || typeof g !== 'object' || Array.isArray(g)) { skipped.push(group); continue; }
    for (const key of Object.keys(g)) {
      const path = group + '.' + key;
      try {
        const line = setPath(path, g[key], S);
        if (line) changes.push(line);
      } catch (e) { skipped.push(path); }
    }
  }
  // Sanitizer der Modelle (Intervall-Ordnung etc.) — in-place, Bindung bleibt
  try { if (S.schubser) S.schubser.sanitize(); } catch (e) { /* egal */ }
  try { if (S.ground) S.ground.sanitize(); } catch (e) { /* egal */ }
  try { if (S.phone) S.phone.sanitize(); } catch (e) { /* egal */ }
  try { if (S.cmdgen) S.cmdgen.sanitize(); } catch (e) { /* egal */ }
  return { changes, skipped };
}

// ── Prompt + Antwort ────────────────────────────────────────
const ENUM_TXT = {
  'training.fallMode': 'reset (Neustart der Runde) | ueben (Weiterüben mit Aufsteh-Fenster)',
  'schubser.dir': 'auto | fwd | back | left | right',
  'ground.mode': 'sinus | zufall | achter | drift',
  'cmdgen.drive': 'aus | manuell | fix | sprung | fluessig | schlange',
  'cmdgen.head': 'aus | manuell | fix | sprung | fluessig | schlange',
};

/** Menschliche Beschreibung aller erlaubten Felder (in den Prompt). */
export function schemaText() {
  const groups = {};
  for (const [path, spec] of Object.entries(GEM_SPEC)) {
    const g = path.split('.')[0];
    (groups[g] = groups[g] || []).push([path, spec]);
  }
  const out = [];
  for (const g of Object.keys(groups)) {
    const lines = [];
    for (const [path, spec] of groups[g]) {
      let d;
      if (spec === B) d = 'true/false';
      else if (Array.isArray(spec) && typeof spec[0] === 'string') d = ENUM_TXT[path] || spec.join(' | ');
      else d = 'Zahl ' + String(spec[0]) + '…' + String(spec[1]) + (spec[2] === 'int' ? ' (ganzzahlig)' : '');
      lines.push('    "' + path.split('.').slice(1).join('.') + '": ' + d);
    }
    out.push('  "' + g + '": {\n' + lines.join(',\n') + '\n  }');
  }
  return out.join(',\n');
}

export function buildPrompt(wish, snap) {
  return [
    'Du bist der Setup-Assistent der Android-Trainings-App „' + APP_NAME + '“ (Roboter-Ente MicroDuck, PPO mit Soft-MoE-Policy, 50 Hz Regelzyklus, Training läuft direkt auf dem Handy).',
    'Der Nutzer wünscht sich: „' + String(wish || DEFAULT_WISH).trim() + '“',
    'Aufgabe: Lege die Trainingskonfiguration fest, die diesen Wunsch gut und ROBUST umsetzt. Bleib bei stabilen, bewährten Werten (kein Überdrehen — zu aggressive Belohnungen oder Störungen lassen die Ente nur fallen). Felder, die nichts zum Wunsch beitragen, lässt du WEG.',
    'Antworte NUR mit einem einzigen JSON-Objekt in genau diesem Schema (alle Felder optional — weglassen erlaubt; kein Markdown, kein Text danach):',
    '{\n' + schemaText() + '\n}',
    'Aktuelle Konfiguration:',
    JSON.stringify(snap),
  ].join('\n');
}

export function gemBody(prompt) {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });
}

/** Antwort-JSON aus Gemini-Text holen (Codezäune, Prosa drumherum). */
export function extractJson(text) {
  if (!text) throw new Error('Leere Antwort der KI');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Antwort enthält kein JSON-Objekt');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch (e) {
    // Nachbesserung: hängende Kommata
    return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
  }
}

/** generateContent-Antwort → Text (alle Parts verkettet). */
export function gemText(respBody) {
  let r;
  try { r = JSON.parse(respBody); } catch (e) { throw new Error('Antwort ist kein JSON: ' + String(respBody).slice(0, 120)); }
  const c = r && r.candidates && r.candidates[0];
  const parts = c && c.content && c.content.parts;
  const text = parts ? parts.map((p) => p.text || '').join('') : '';
  if (!text) {
    const why = (c && c.finishReason) || (r && r.promptFeedback && r.promptFeedback.blockReason) || 'unbekannt';
    throw new Error('KI lieferte keinen Text (Grund: ' + why + ')');
  }
  return text;
}

/**
 * KOMPLETT-DURCHLAUF: Wunsch → Gemini → validiertes Setup anwenden.
 * @returns { changes, skipped, model }
 */
export async function configure(wish, S, opts = {}) {
  const key = getApiKey();
  if (!key) throw new Error('Kein Gemini-Schlüssel gesetzt');
  const model = opts.model && opts.model !== 'auto' ? opts.model : await autoModel(!!opts.forceModel);
  const url = API_BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
  const body = gemBody(buildPrompt(wish, buildStateSnap(S)));
  const { code, body: resp } = await http(url, 'POST', body);
  if (code !== 200) throw new Error(errText(code, resp));
  const cfg = extractJson(gemText(resp));
  const res = applySetup(cfg, S);
  res.model = model;
  return res;
}
