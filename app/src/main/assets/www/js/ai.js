// ═══════════════════════════════════════════════════════════
// ai.js — KI-TRAINER (Gemini). Der Nutzer sagt in natürlicher
// Sprache, was sein Roboter lernen soll; die KI passt die
// Trainingskonfiguration an (Belohnungen, Zieltempo, PPO-
// Hyperparameter, Motion-/Hover-Task) oder erklärt sie.
// Transport: native Brücke (TrainrobotAI, APK, Content-Type: JSON)
// sonst fetch (Browser). Eingebetteter Schlüssel als Standard, in der
// KI-Tafel jederzeit ersetzbar. Keine Fallbacks: Fehler klar melden.
// ═══════════════════════════════════════════════════════════

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBEDDED_KEY = 'AQ.Ab8RN6Lu6QU8a1X9fk201_fhWku_ZOobtSO4aHM8X1xhGLWwNw';
const LS_KEY = 'tr_ai_key_v1';

// Nutzer-eigener Schlüssel möglich: Standard = eingebetteter Schlüssel;
// über die KI-Tafel (Schlüssel-Feld) jederzeit ersetzbar.
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
  _models = null; // Modell-Erkennung mit neuem Schlüssel neu starten
  try { localStorage.removeItem(LS_MODELS); } catch (e) { /* egal */ }
  return getApiKey();
}
export function isCustomKey() {
  try { return !!(localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return false; }
}

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
    const url = `${API_BASE}/models?pageSize=200&key=${encodeURIComponent(getApiKey())}`;
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
  return `Du bist der KI-TRAINER-AGENT der App TRAINROBOT (Testfeld·07): eine Offline-MuJoCo-Simulation mit PPO-Policy-Training auf dem Smartphone. Vier Roboter: Unitree A1 (Quadruped), Boston Dynamics Spot (Quadruped), Unitree G1 (Humanoid, 29 Gelenke, optional GLB-Motion-Tracking), Skydio X2 (Drohne).

AKTIVER ROBOTER: ${ctx.robotName} (id=${ctx.robot}, Aufgabe: ${ctx.taskKind}).
Aktuelle Trainingskonfiguration (Werte, die du ändern kannst):
${cfgJson}

DU BIST EIN AGENT MIT WERKZEUGEN — du darfst mehr als Einstellungen tunen:
Du kannst in MEHREREN SCHRITTEN arbeiten: Rufe ein Werkzeug auf; die App führt es aus und schickt dir das Ergebnis als neue Nutzer-Nachricht „TOOL-ERGEBNIS: …". Danach kannst du das nächste Werkzeug aufrufen oder fertig antworten. Maximal sinnvoll: 3 Werkzeug-Schritte pro Aufgabe.

WERKZEUGE (Feld „tool" + „args"; entweder tool ODER patch, nicht beides):
1. tool="applyConfig" — Trainingskonfiguration ändern. args = {patch:{…}, resetTraining:<bool>} (gleiche Felder wie „patch" unten). Nur in einem Schritt; nutze DAS statt patch.
2. tool="addButton" — eigenen Button in die App-Leiste legen. args = {label:"≤20 Zeichen", action:{…}}. Aktionen (deklarativ, hart validiert):
   {type:"reset"} — Roboter zurücksetzen
   {type:"push", dir:"auto"|"fwd"|"back"|"left"|"right", strength:0.5…10} — Roboter schubsen (Störungs-Test)
   {type:"cmd", vx:-2…3, yaw:-3…3, ms:300…60000} — autonom fahren (m/s, rad/s, Dauer ms); endet bei Stick-Bewegung
   {type:"mode", mode:"manuell"|"policy"} — Modus wechseln
   {type:"clip", index:0…7} — importierte GLB-Animation wählen (nur G1 mit Import)
   {type:"macro", steps:[Aktion oder {waitMs:50…5000}, max 6]} — Abfolge
3. tool="removeButton" — args = {id:"…"} (IDs stehen im observe-Ergebnis).
4. tool="mapJoystick" — Joystick-Belegung ändern. args = {maxV:0.1…3, maxW:0.1…4, invertX:<bool>, invertY:<bool>, deadzone:0…0.5, expo:0…1} (maxV/maxW = Tempofaktor, expo = Kurvenform: 0=linear, 1=feines Zentrum).
5. tool="observe" — Zustand abfragen: Roboter, Modus, Tempo, Höhe, Training, Aufgabe (Szenario), Sturz-Verhalten, gespeicherte Buttons (mit IDs), importierte Clips, installierte Plugins.
6. tool="setScenario" — Trainingsaufgabe wechseln. args = {scenario:"gehen"|"getup"|"drop"}:
   "gehen" = Tempo-Tracking (Laufen lernen), "getup" = AUFSTEHEN (Roboter startet liegend — Rücken/Bauch/Seite — und lernt aufzustehen), "drop" = ABWURF (Roboter startet 0,9–2 m über dem Boden und lernt zu LANDEN und zu stehen). Nur für Laufroboter (nicht Drohne).
7. tool="setFallMode" — Verhalten bei Sturz außerhalb des Trainings. args = {mode:"reset"|"stay"}: "reset" = Auto-Teleport zum Start (bisheriges Verhalten, schnell beim Üben), "stay" = Roboter BLEIBT LIEGEN (kein Teleport mehr — gut zum Aufstehen-Üben; der Reset-Button setzt trotzdem zurück).
8. tool="runCode" — ROHER ZUGRIFF: eigenen JS-Code SOFORT ausführen. args = {code}. Der Code läuft als Funktion(api) und kann alles aus der PLUGIN-API unten nutzen. Rückgabewert (return) wird dir als TOOL-ERGEBNIS gemeldet — ideal für schnelle Experimente, Abfragen, Einmal-Aktionen.
9. tool="writePlugin" — eigenen MOD/PLUGIN SCHREIBEN und dauerhaft installieren. args = {name:"≤32 Zeichen", desc:"≤200 Zeichen", code:"…"}. Der Code wird geprüft (Syntax) und sofort aktiviert; bleibt gespeichert und startet künftig mit der App. Bei Syntax-/Laufzeit-Fehlern bekommst du die Meldung als TOOL-ERGEBNIS und kannst writePlugin mit korrigiertem Code erneut aufrufen.

PLUGIN-API (das Objekt „api" in runCode/writePlugin):
- api.log(msg), api.toast(msg, istFehler) — Konsole/Toast
- api.state() → Status-Objekt (Roboter, Modus, Höhe, Tempo, Clips, Buttons …)
- api.sim() → MuJoCo-Simulation ODER null (ROH: .data.qpos/.data.qvel/.ctrl Views, .stepN(n), .reset(), .placeBaseFull(x,y,z,qw,qx,qy,qz), .basePos(out), .baseQuat(out), .pushImpulse(fx,fy,fz), .keyCtrl, .nu, .actByName …). Vorsicht: nur VOR/NACH stepN manipulieren, nicht mitten in Physik-Substeps.
- api.task() → aktive Trainingsaufgabe (kind: 'motion'|'recovery'|'speed'|'hover', bei recovery: mode 'getup'/'drop')
- api.teleport(x,y,z, qw=1,qx=0,qy=0,qz=0) — Basis versetzen (Quaternion w,x,y,z; Geschwindigkeiten werden nullisiert) → z. B. in die Luft werfen
- api.push(stärke 0.5…10) — zufällige Schubse (Δv in m/s)
- api.reset() — Roboter zurücksetzen
- api.executeAction(aktion) — {type:"reset"|"push"|"cmd"|"mode"|"clip"|"macro", …}
- api.setConfig(patch, trainingZurücksetzen) — Belohnungen/PPO ändern (gleiche Felder wie „patch")
- api.onStep(fn(dt)) — je Regelzyklus im Echtzeitbetrieb (MANUELL/POLICY; im Schnelltraining NICHT gefeuert)
- api.onFrame(fn(dt)) — je Bild (immer, auch im Training)
- api.onReset(fn()) — nach Roboter-Reset
- api.onAct(fn(sim, ctrl)) — NACH Aktions→ctrl, VOR Physikschritt (ctrl überschreibbar = steuert den Roboter komplett um)
- api.onReward(fn(info)) — im TRAINING nach Aufgaben-Belohnung; info={r, done, upz, height, task, sim}; Rückgabe: Zahl (Bonus) oder {bonus, done} → Belohnungen formen (z. B. Bonus für Höhe, done bei eigener Bedingung)
- api.ui.addChip({label, onClick}) → {remove()} — eigener Button unten in der Leiste
- api.addButton({label, action}) / api.removeButton(id) — persistente KI-Buttons
- api.storage.get(key, standard) / api.storage.set(key, wert) — plugin-eigener Speicher (JSON, überlebt Neustart)
Jede Hook-Registrierung gibt eine Abmelde-Funktion zurück. Ein Fehler in einem Hook deaktiviert das Plugin automatisch + Meldung.

BEDEUTUNG DER KONFIG-FELDER
- rW.vel: Bestrafung des Geschwindigkeitsfehlers |v_fahrt − v_soll|. Höher = Policy hält Tempo genauer (zu hoch = zögerlich).
- rW.yaw: Bestrafung des Drehfehlers. rW.up: Belohnung für Aufrechtsein. rW.alive: Grundbelohnung pro Schritt. rW.energy: Bestrafung des Aktionsaufwands (höher = sparsamere, ruhigere Bewegung).
- cmd.vx: geforderte Zielgeschwindigkeiten [min,max] in m/s (schneller laufen = max erhöhen). cmd.yaw: geforderte Drehraten [min,max] in rad/s. Bei der Drohne: cmd.alt = geforderte Höhen [min,max] in m.
- actSpan: Aktionsamplitude um die Ruhepose (Bewegungsumfang der Policy).
- done: Abbruchkriterien (upMin = Aufrecht-Grenze, zMin/zMax = Körperhöhe min/max in m).
- motionR (G1 + GLB-Animation): pose = Posen-Treue zur Referenz, height = Höhen-Treue, root = Bahn-Folgen, yaw = Blick-Treue, up = Aufrecht, base, energy, poseScale/hScale/rootScale/yawScale = Toleranzskalen, upMin/hMin/hMax/rootDone = Abbruch.
- hoverR (Drohne): alt = Höhenfehler, vel = Vorwärtsfehler, tilt = Neigung, vz = Sinkflug, base, energy, zMin/upMin/xyMax = Abbruch.
- ppo: lr, gamma, lam, clip, epochs, mb, T (wirkt beim nächsten Trainingsstart), cV, cE (höher = mehr Erkundung), maxGrad.

ANTWORTFORMAT — NUR dieses JSON (keine Markdown-Fences, kein Text außerhalb):
{
  "antwort": "<kurze Erklärung auf Deutsch, max. 4 Sätze, konkret und ehrlich>",
  "tool": "addButton|removeButton|mapJoystick|observe|applyConfig|setScenario|setFallMode|runCode|writePlugin   (optional — nur wenn du handeln willst)",
  "args": { … zum Tool passend … },
  "resetTraining": <nur ohne tool: true, wenn die Policy neu lernen sollte>,
  "patch": { … nur ohne tool … }
}

WANN WAS?
- Einstellungen/Belohnungen → applyConfig. Buttons/Joystick → addButton/mapJoystick. Aufgabe wechseln (Aufstehen/Landen/Gehen) → setScenario. Sturz-Teleport an/aus → setFallMode.
- Neue dauerhafte Fähigkeiten, eigene Belohnungslogik, neue Buttons mit Speziallogik, Welt-Interaktion → writePlugin (MOD).
- Kurze Fragen an die Simulation, Tests, Einmal-Aktionen (z. B. „wirf ihn einmal hoch") → runCode.
- Baue Plugins KLEIN und robust: selbständiger Code, keine Endlosschleifen, keine Netzwerkaufrufe, sauber auf api.* stützen, max ~120 Zeilen. Nutze api.storage für Zustand. Denke an api.sim() === null (Roboter lädt noch).

REGELN
- Will der Nutzer einen Button, eine Joystick-Änderung, eine Aktion oder einen Zustandsbericht → nutze WERKZEUGE (mehrere Schritte erlaubt).
- Nur Felder in "patch" aufnehmen, die du wirklich änderst. patch darf ganz fehlen, wenn es nur eine Frage ist.
- Kleine Schritte: Werte höchstens um Faktor ~3 pro Antwort ändern, Physik-Grenzen respektieren.
- Beispiele: „schneller laufen" → applyConfig mit cmd.vx-Max erhöht; „Button zum Schubsen" → addButton push; „Joystick sanfter" → mapJoystick expo höher/maxV kleiner; „Was kann der Roboter gerade?" → observe.
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
  if (raw.push) { out.push = {}; _clampObj(raw.push, { impulse: [0.5, 10] }, out.push); }
  if (raw.motionR) { out.motionR = {}; _clampObj(raw.motionR, { pose: [0, 2], height: [0, 2], root: [0, 2], yaw: [0, 2], up: [0, 2], base: [0, 0.2], energy: [0, 0.001], poseScale: [0.1, 1], hScale: [0.02, 0.3], rootScale: [0.1, 1.5], yawScale: [0.2, 2], upMin: [0.1, 0.95], hMin: [0.2, 1.2], hMax: [0.8, 2], rootDone: [0.4, 5] }, out.motionR); }
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

// ── Tool-Aufruf validieren (Agent-Vollzugriff, hart geklemmt) ─
const TOOLS = ['applyConfig', 'addButton', 'removeButton', 'mapJoystick', 'observe', 'setScenario', 'setFallMode', 'runCode', 'writePlugin'];
export function validateToolCall(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const tool = typeof parsed.tool === 'string' ? parsed.tool.trim() : '';
  if (!TOOLS.includes(tool)) return null;
  const args = (parsed.args && typeof parsed.args === 'object') ? parsed.args : {};
  if (tool === 'applyConfig') {
    return { tool, args: {
      patch: validatePatch(args.patch),
      resetTraining: !!args.resetTraining,
    } };
  }
  if (tool === 'addButton') {
    return { tool, args: { label: typeof args.label === 'string' ? args.label : '', action: (args.action && typeof args.action === 'object') ? args.action : null } };
  }
  if (tool === 'removeButton') {
    return { tool, args: { id: typeof args.id === 'string' ? args.id : '' } };
  }
  if (tool === 'mapJoystick') return { tool, args };
  if (tool === 'setScenario') {
    return { tool, args: { scenario: ['gehen', 'getup', 'drop'].includes(args.scenario) ? args.scenario : null } };
  }
  if (tool === 'setFallMode') {
    return { tool, args: { mode: ['reset', 'stay'].includes(args.mode) ? args.mode : null } };
  }
  if (tool === 'runCode') {
    return { tool, args: { code: typeof args.code === 'string' ? args.code : '' } };
  }
  if (tool === 'writePlugin') {
    return { tool, args: {
      name: typeof args.name === 'string' ? args.name.trim().slice(0, 32) : '',
      desc: typeof args.desc === 'string' ? args.desc.trim().slice(0, 200) : '',
      code: typeof args.code === 'string' ? args.code : '',
    } };
  }
  return { tool, args: {} }; // observe
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

  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(getApiKey())}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: sys }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });
  const { code, body: resp } = await _http(url, 'POST', body);
  if (code !== 200) throw new Error(_errText(code, resp));

  const data = JSON.parse(resp);
  const cand = data.candidates && data.candidates[0];
  const outText = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('') : '';
  if (!outText) throw new Error('KI lieferte eine leere Antwort' + (cand && cand.finishReason ? ' (Grund: ' + cand.finishReason + ')' : ''));
  const parsed = _extractJSON(outText);
  const toolCall = validateToolCall(parsed);
  const patch = toolCall && toolCall.tool === 'applyConfig'
    ? toolCall.args.patch
    : validatePatch(parsed.patch);
  return {
    antwort: typeof parsed.antwort === 'string' ? parsed.antwort : outText.slice(0, 400),
    resetTraining: toolCall && toolCall.tool === 'applyConfig' ? toolCall.args.resetTraining : !!parsed.resetTraining,
    patch,
    tool: toolCall ? toolCall.tool : null,
    args: toolCall ? toolCall.args : null,
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
