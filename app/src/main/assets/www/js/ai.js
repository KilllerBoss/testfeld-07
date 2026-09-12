// ═══════════════════════════════════════════════════════════
// ai.js — KI-TRAINER (Gemini). Der Nutzer sagt in natürlicher
// Sprache, was sein Roboter lernen soll; die KI passt die
// Trainingskonfiguration an (Belohnungen, Zieltempo, PPO-
// Hyperparameter, Motion-/Hover-Task) oder erklärt sie.
// Transport: native Brücke (TrainrobotAI, APK) sonst fetch
// (Browser). Schlüssel fest eingebettet — Nutzer-Wunsch
// „Benutze immer". Keine physics-Fallbacks: Fehler klar melden.
// ═══════════════════════════════════════════════════════════

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const API_KEY = 'AQ.Ab8RN6Lu6QU8a1X9fk201_fhWku_ZOobtSO4aHM8X1xhGLWwNw';

const LS_MODELS = 'tr_ai_models_v1';
const LS_CHAT = 'tr_ai_chat_v1';
const MODEL_TTL = 7 * 24 * 3600e3;

// Statische Notnagel-Kette, falls ListModels blockiert ist
// (gelistete Modelle haben immer Vorrang — Discovery vor Ort).
const DEFAULT_FAST = ['gemini-3.5-flash-lite', 'gemini-3-flash-lite', 'gemini-2.5-flash-lite'];
const DEFAULT_SMART = ['gemini-3.8-flash', 'gemini-3-flash', 'gemini-2.5-flash'];

// ── Transport (APK: Java-Bridge, Browser: fetch) ────────────
let _seq = 0;
const _pending = new Map();

export function initAITransport() {
  window.__aiReply = (id, code, body, err) => {
    const p = _pending.get(id);
    if (!p) return;
    _pending.delete(id);
    clearTimeout(p.t);
    if (err) p.reject(new Error(err));
    else p.resolve({ code, body });
  };
}

function _http(url, method, body) {
  const bridge = typeof window !== 'undefined' && window.TrainrobotAI;
  if (bridge && bridge.available()) {
    const id = 'ai' + (++_seq);
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
  // Browser: bewusst OHNE Header (kein CORS-Preflight), Key im Query
  return fetch(url, { method, body: method === 'POST' ? body : undefined })
    .then(r => r.text().then(t => ({ code: r.status, body: t })));
}

function _errText(code, body) {
  let msg = body;
  try { msg = JSON.parse(body).error.message || body; } catch (e) { /* Rohtext */ }
  if (code === 403) return 'Zugriff verweigert (403): ' + msg;
  if (code === 401 || /API key not valid|API_KEY_INVALID/i.test(msg)) return 'KI-Schlüssel ungültig oder abgelaufen. Bitte neuen Schlüssel hinterlegen.';
  if (code === 429) return 'KI-Limit erreicht (429) — kurz warten und erneut senden.';
  if (code === 404) return 'Modell nicht gefunden (404): ' + msg;
  if (code >= 500) return 'KI-Dienst gestört (' + code + '). Später erneut versuchen.';
  if (code === 0) return 'Kein Internet: Der KI-Trainer braucht einmalige Verbindung (Rest der App bleibt offline).';
  return 'KI-Fehler (' + code + '): ' + msg;
}

// ── Modell-Erkennung ────────────────────────────────────────
let _models = null;

function _verScore(name) {
  const m = /gemini(\d+)(?:\.(\d+))?/.exec(name);
  if (!m) return -1;
  return parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2], 10) : 0) - (/exp/.test(name) ? 0.5 : 0);
}

export async function ensureModels(force = false) {
  if (_models && !force) return _models;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(LS_MODELS) || 'null');
      if (c && c.t && Date.now() - c.t < MODEL_TTL && c.fast && c.smart) { _models = c; return c; }
    } catch (e) { /* neu entdecken */ }
  }
  try {
    const url = `${API_BASE}/models?pageSize=200&key=${encodeURIComponent(API_KEY)}`;
    const { code, body } = await _http(url, 'GET', '');
    if (code !== 200) throw new Error(_errText(code, body));
    const list = (JSON.parse(body).models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
    const usable = list.filter(n => /flash/.test(n) && !/embed|imagen|veo|tts|audio|image|live|thinking|pro/.test(n));
    const pick = (names, lite) => {
      const cands = usable.filter(n => (lite ? /lite/.test(n) : !/lite/.test(n)));
      const pool = cands.length ? cands : usable;
      let best = null, bs = -1;
      for (const n of pool) { const s = _verScore(n); if (s > bs) { bs = s; best = n; } }
      return best;
    };
    const fast = pick(usable, true) || DEFAULT_FAST[0];
    const smart = pick(usable, false) || fast;
    if (fast && smart) {
      _models = { fast, smart, t: Date.now(), src: 'list' };
      try { localStorage.setItem(LS_MODELS, JSON.stringify(_models)); } catch (e) { /* egal */ }
      return _models;
    }
    throw new Error('Keine passenden Flash-Modelle gefunden');
  } catch (e) {
    // Discovery blockiert → statische Kette (wird bei Nutzung verifiziert)
    _models = { fast: DEFAULT_FAST[0], smart: DEFAULT_SMART[0], t: Date.now(), src: 'default' };
    return _models;
  }
}

export function currentModels() { return _models; }

// ── System-Prompt ───────────────────────────────────────────
export function buildSystemPrompt(ctx) {
  const cfgJson = JSON.stringify(ctx.current, null, 1);
  return `Du bist der KI-Trainer der App TRAINROBOT (Testfeld·07): eine Offline-MuJoCo-Simulation mit PPO-Policy-Training auf dem Smartphone. Vier Roboter: Unitree A1 (Quadruped), Boston Dynamics Spot (Quadruped), Unitree G1 (Humanoid, 29 Gelenke, optional GLB-Motion-Tracking), Skydio X2 (Drohne).

AKTIVER ROBOTER: ${ctx.robotName} (id=${ctx.robot}, Aufgabe: ${ctx.taskKind}).
Aktuelle Trainingskonfiguration (Werte, die du ändern kannst):
${cfgJson}

BEDEUTUNG DER FELDER
- rW.vel: Bestrafung des Geschwindigkeitsfehlers |v_fahrt − v_soll|. Höher = Policy hält Tempo genauer (zu hoch = zögerlich).
- rW.yaw: Bestrafung des Drehfehlers. rW.up: Belohnung für Aufrechtsein. rW.alive: Grundbelohnung pro Schritt. rW.energy: Bestrafung des Aktionsaufwands (höher = sparsamere, ruhigere Bewegung).
- cmd.vx: geforderte Zielgeschwindigkeiten [min,max] in m/s (schneller laufen = max erhöhen). cmd.yaw: geforderte Drehraten [min,max] in rad/s. Bei der Drohne: cmd.alt = geforderte Höhen [min,max] in m.
- actSpan: Aktionsamplitude um die Ruhepose (Bewegungsumfang der Policy).
- done: Abbruchkriterien (upMin = Aufrecht-Grenze, zMin/zMax = Körperhöhe min/max in m).
- motionR (G1 + GLB-Animation): pose = Posen-Treue zur Referenz, height = Höhen-Treue, up = Aufrecht, base = Grundbetrag, energy = Aktionsaufwand, poseScale/hScale = Toleranzskalen, upMin/hMin/hMax = Abbruch.
- hoverR (Drohne): alt = Höhenfehler, vel = Vorwärtsfehler, tilt = Neigung, vz = Sinkflug, base, energy, zMin/upMin/xyMax = Abbruch.
- ppo: lr = Lernrate, gamma = Diskontfaktor, lam = GAE, clip = Clip-Ratio, epochs = Epochen pro Update, mb = Minibatch-Größe, T = Rollout-Länge (wirkt beim nächsten Trainingsstart), cV = Wert-Fehlergewicht, cE = Entropie-Bonus (höher = mehr Erkundung), maxGrad = Gradient-Clip.

ANTWORTFORMAT — NUR dieses JSON (keine Markdown-Fences, kein Text außerhalb):
{
  "antwort": "<kurze Erklärung auf Deutsch, max. 4 Sätze, konkret und ehrlich>",
  "resetTraining": <true, wenn die Änderungen so groß sind, dass die alte Policy neu lernen sollte — sonst false>,
  "patch": {
    "rW": {"vel":0.25,"yaw":0.06,"up":0.1,"alive":0.05,"energy":0.00015},
    "cmd": {"vx":[-0.6,1.0],"yaw":[-1.2,1.2],"alt":[0.4,2.2]},
    "done": {"upMin":0.45,"zMin":0.12,"zMax":1.5},
    "actSpan": 0.55,
    "motionR": {"pose":0.72,"height":0.2,"up":0.08,"base":0.03,"energy":0.00005,"poseScale":0.35,"hScale":0.09,"upMin":0.5,"hMin":0.55,"hMax":1.4},
    "hoverR": {"alt":0.3,"vel":0.2,"tilt":0.1,"vz":0.3,"base":0.02,"energy":0.0001,"zMin":0.1,"upMin":0.4,"xyMax":12},
    "ppo": {"lr":0.0003,"gamma":0.99,"lam":0.95,"clip":0.2,"epochs":4,"mb":256,"T":1024,"cV":0.5,"cE":0.005,"maxGrad":0.5}
  }
}

REGELN
- Nur Felder in "patch" aufnehmen, die du wirklich änderst. patch darf ganz fehlen, wenn es nur eine Frage ist.
- Kleine Schritte: Werte höchstens um Faktor ~3 pro Antwort ändern, Physik-Grenzen der aktuellen Werte respektieren.
- Der Nutzer will z. B. „schneller laufen" → cmd.vx-Max erhöhen, ggf. rW.energy leicht senken; „ruhiger/sanfter" → rW.energy erhöhen; „besser GLB-Tracking" → motionR.pose erhöhen; „ausgefallenere Bewegungen" → ppo.cE leicht erhöhen; „trainiert langsam/instabil" → ppo.lr senken bzw. clip verringern.
- Sei ehrlich bei Grenzen (Handy-CPU, offene Regler) — keine Versprechen, die die Physik nicht halten kann.
- Antwortsprache: Deutsch.`;
}

// ── Patch validieren (hart klemmen — keine Physik-Explosion) ─
const _num = (v, lo, hi, dflt) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
};
const _clampObj = (src, bounds, dst) => {
  if (!src || typeof src !== 'object') return;
  for (const [k, [lo, hi]] of Object.entries(bounds)) {
    if (src[k] === undefined) continue;
    const val = _num(src[k], lo, hi, dst[k]);
    if (Number.isFinite(val)) dst[k] = val;
  }
};

export function validatePatch(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (raw.rW) { out.rW = {}; _clampObj(raw.rW, { vel: [0, 5], yaw: [0, 5], up: [0, 5], alive: [0, 2], energy: [0, 0.01] }, out.rW); }
  if (raw.cmd) {
    out.cmd = {};
    if (Array.isArray(raw.cmd.vx) && raw.cmd.vx.length === 2) {
      const a = _num(raw.cmd.vx[0], -2, 3, -0.6), b = _num(raw.cmd.vx[1], -2, 3, 1);
      out.cmd.vx = [Math.min(a, b), Math.max(a, b)];
    }
    if (Array.isArray(raw.cmd.yaw) && raw.cmd.yaw.length === 2) {
      const a = _num(raw.cmd.yaw[0], -3, 3, -1.2), b = _num(raw.cmd.yaw[1], -3, 3, 1.2);
      out.cmd.yaw = [Math.min(a, b), Math.max(a, b)];
    }
    if (Array.isArray(raw.cmd.alt) && raw.cmd.alt.length === 2) {
      const a = _num(raw.cmd.alt[0], 0.2, 3, 0.4), b = _num(raw.cmd.alt[1], 0.2, 3, 2.2);
      out.cmd.alt = [Math.min(a, b), Math.max(a, b)];
    }
  }
  if (raw.done) { out.done = {}; _clampObj(raw.done, { upMin: [0.1, 0.9], zMin: [0, 1], zMax: [0.5, 3] }, out.done); }
  if (raw.actSpan !== undefined) out.actSpan = _num(raw.actSpan, 0.05, 1.2, 0.5);
  if (raw.motionR) { out.motionR = {}; _clampObj(raw.motionR, { pose: [0, 2], height: [0, 2], up: [0, 2], base: [0, 0.2], energy: [0, 0.001], poseScale: [0.1, 1], hScale: [0.02, 0.3], upMin: [0.1, 0.95], hMin: [0.2, 1.2], hMax: [0.8, 2] }, out.motionR); }
  if (raw.hoverR) { out.hoverR = {}; _clampObj(raw.hoverR, { alt: [0, 2], vel: [0, 2], tilt: [0, 2], vz: [0, 2], base: [0, 0.2], energy: [0, 0.005], zMin: [0.02, 0.5], upMin: [0.1, 0.9], xyMax: [3, 50] }, out.hoverR); }
  if (raw.ppo) {
    out.ppo = {};
    _clampObj(raw.ppo, {
      lr: [0.00001, 0.003], gamma: [0.8, 0.9999], lam: [0.5, 0.99], clip: [0.05, 0.5],
      epochs: [1, 10], mb: [32, 1024], T: [256, 8192], cV: [0, 2], cE: [0, 0.05], maxGrad: [0.1, 2],
    }, out.ppo);
    // Ganzzahl-Felder — nur wenn tatsächlich gesetzt (sonst NaN-Leichen)
    if (out.ppo.epochs !== undefined) out.ppo.epochs = Math.round(out.ppo.epochs);
    if (out.ppo.mb !== undefined) out.ppo.mb = Math.round(out.ppo.mb);
    if (out.ppo.T !== undefined) out.ppo.T = Math.round(out.ppo.T);
  }
  // Leere Unterobjekte entfernen
  for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
  return out;
}

function _extractJSON(text) {
  // Direkt parsen, sonst ersten {...}-Block nehmen
  try { return JSON.parse(text); } catch (e) { /* weiter */ }
  const s = text.indexOf('{'), e2 = text.lastIndexOf('}');
  if (s >= 0 && e2 > s) return JSON.parse(text.slice(s, e2 + 1));
  throw new Error('Antwort war kein gültiges JSON');
}

// ── Hauptfunktion: Frage stellen ────────────────────────────
export async function askAI({ text, mode = 'fast', ctx }) {
  const models = await ensureModels();
  const model = mode === 'smart' ? models.smart : models.fast;
  const sys = buildSystemPrompt(ctx);
  const contents = [];
  for (const m of (ctx.history || []).slice(-8)) contents.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] });
  contents.push({ role: 'user', parts: [{ text }] });

  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: sys }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  });
  const { code, body: resp } = await _http(url, 'POST', body);
  if (code !== 200) throw new Error(_errText(code, resp));

  const data = JSON.parse(resp);
  const cand = data.candidates && data.candidates[0];
  const outText = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('') : '';
  if (!outText) throw new Error('KI lieferte eine leere Antwort' + (cand && cand.finishReason ? ' (Grund: ' + cand.finishReason + ')' : ''));
  const parsed = _extractJSON(outText);
  const patch = validatePatch(parsed.patch);
  return {
    antwort: typeof parsed.antwort === 'string' ? parsed.antwort : outText.slice(0, 400),
    resetTraining: !!parsed.resetTraining,
    patch,
    model,
  };
}

// ── Chat-Verlauf persistieren ───────────────────────────────
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_CHAT) || '[]'); } catch (e) { return []; }
}
export function saveHistory(h) {
  try { localStorage.setItem(LS_CHAT, JSON.stringify(h.slice(-40))); } catch (e) { /* egal */ }
}
export function clearHistory() {
  try { localStorage.removeItem(LS_CHAT); } catch (e) { /* egal */ }
}
