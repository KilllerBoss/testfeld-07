// ═══════════════════════════════════════════════════════════
// plugins.js — v2.7.0 WERKSTATT: Mods/Plugins in JavaScript.
//
// Die KI (Gemini) schreibt EIGENEN Code mit ROHEM Zugriff auf die
// Simulation: qpos/qvel/ctrl-Views, Teleport (placeBaseFull), Schubse,
// Reset, Konfig-Patches, Physik-Hooks (onStep/onAct/onReward/onReset/
// onFrame), eigene UI-Chips, eigener Speicher. Der Nutzer wollte genau
// das: „Gemini soll selbst neues schreiben können … rohen Zugriff
// haben um die App zu erweitern — Art mods oder plugins."
//
// Wie es läuft:
//   1. Plugin-Code = selbständiges JS, das mit dem Objekt `api` läuft
//      (new Function('api', code) — Syntax wird beim Install geprüft).
//   2. Der Code registriert Hooks (api.onStep …) und gibt optional eine
//      Aufräum-Funktion (Disposer) zurück.
//   3. Hooks werden NIE werfen gelassen: Ein Fehler deaktiviert das
//      Plugin sofort + Meldung in Konsole/Toast (nie stille Endlosfehler).
//   4. Plugins bleiben in localStorage persistiert und werden beim Boot
//      wieder aktiviert. ★-Plugins sind mitgelieferte Beispiele.
//
// Grenzen (bewusst): KEINE Endlosschleifen-Überwachung im Hook-Body —
// Code-Limit 24 000 Zeichen, Liste auf 24 Plugins, Fehler → aus.
// ═══════════════════════════════════════════════════════════

const LS_PLUGINS = 'tr_plugins_v1';
export const MAX_PLUGIN_CODE = 24000;

export function loadPluginList() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_PLUGINS) || '[]');
    return Array.isArray(list) ? list.filter(p => p && p.id && typeof p.code === 'string') : [];
  } catch (e) { return []; }
}

export function persistPlugins(list) {
  try { localStorage.setItem(LS_PLUGINS, JSON.stringify(list.slice(0, 24))); } catch (e) { /* Speicher voll */ }
}

/** Kompiliert Plugin-Code (Syntax-Check). Wirft bei Fehlern. */
export function compilePlugin(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('Plugin-Code ist leer');
  if (code.length > MAX_PLUGIN_CODE) throw new Error('Plugin zu groß (' + code.length + ' > ' + MAX_PLUGIN_CODE + ' Zeichen)');
  return new Function('api', '"use strict";\n' + code);
}

/**
 * Plugin-Host: verwaltet Liste + laufende Instanzen + Hook-Feuerung.
 * onReward kann eine Zahl (Bonus) oder {bonus, done} zurückgeben und
 * formt so Trainingsaufgaben um — ohne die App neu zu bauen.
 */
export class PluginHost {
  constructor() {
    this.plugins = loadPluginList();
    this._inst = new Map(); // id → { step:[], frame:[], reset:[], act:[], reward:[], dispose }
    this._apiFactory = null;
    this.onError = null;    // (id, name, error) → UI-Meldung (main.js)
  }

  setApiFactory(fn) { this._apiFactory = fn; }
  get list() { return this.plugins; }

  /** Hook-Behälter je Plugin (auch vom api-Objekt genutzt). */
  hooks(id) {
    let inst = this._inst.get(id);
    if (!inst) { inst = { step: [], frame: [], reset: [], act: [], reward: [], dispose: null }; this._inst.set(id, inst); }
    return inst;
  }

  /** Plugin-Code ausführen + Hooks einsammeln. Wirft nie → {ok, error}. */
  install(id) {
    const rec = this.plugins.find(p => p.id === id);
    if (!rec) return { ok: false, error: 'Plugin nicht gefunden' };
    if (!this._apiFactory) return { ok: false, error: 'API noch nicht bereit' };
    this.uninstall(id);
    try {
      const fn = compilePlugin(rec.code);
      const inst = this.hooks(id);
      const api = this._apiFactory(rec);
      const ret = fn(api);
      if (typeof ret === 'function') inst.dispose = ret;
      return { ok: true };
    } catch (e) {
      this.uninstall(id);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  uninstall(id) {
    const inst = this._inst.get(id);
    if (!inst) return;
    if (typeof inst.dispose === 'function') { try { inst.dispose(); } catch (e) { /* egal */ } }
    this._inst.delete(id);
  }

  /** Plugin an/aus. Fehler beim Start → wieder aus + {ok:false, error}. */
  enable(id, on = true) {
    const rec = this.plugins.find(p => p.id === id);
    if (!rec) return { ok: false, error: 'Plugin nicht gefunden' };
    rec.enabled = !!on;
    if (on) {
      const r = this.install(id);
      if (!r.ok) { rec.enabled = false; persistPlugins(this.plugins); return r; }
    } else this.uninstall(id);
    persistPlugins(this.plugins);
    return { ok: true };
  }

  /** Neues Plugin aufnehmen → Record (id generiert). */
  add({ name, desc, code, enabled, builtin }) {
    const rec = {
      id: 'plg_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4).toString(36),
      name: String(name || 'Plugin').slice(0, 32),
      desc: String(desc || '').slice(0, 200),
      code: String(code || ''),
      enabled: false,
      builtin: !!builtin,
      createdAt: Date.now(),
    };
    this.plugins.push(rec);
    persistPlugins(this.plugins);
    if (enabled) this.enable(rec.id, true);
    return rec;
  }

  /** Mitgeliefertes Beispiel: Inhalt aktualisieren oder erstmalig anlegen. */
  addOrReplaceBuiltin(rec) {
    const ex = this.plugins.find(p => p.id === rec.id);
    if (ex) {
      ex.name = rec.name; ex.desc = rec.desc; ex.code = rec.code; ex.builtin = true;
      persistPlugins(this.plugins);
      return ex;
    }
    this.plugins.push({
      id: rec.id, name: rec.name, desc: rec.desc, code: rec.code,
      enabled: !!rec.enabled, builtin: true, createdAt: Date.now(),
    });
    persistPlugins(this.plugins);
    return rec;
  }

  remove(id) {
    this.uninstall(id);
    this.plugins = this.plugins.filter(p => p.id !== id);
    persistPlugins(this.plugins);
  }

  // ── Hook-Feuerung (nie werfen; Fehler → Plugin deaktivieren) ──
  _fail(id, e) {
    this.uninstall(id);
    const rec = this.plugins.find(p => p.id === id);
    if (rec) { rec.enabled = false; persistPlugins(this.plugins); }
    if (this.onError) this.onError(id, rec ? rec.name : id, e);
  }

  fireStep(dt) {
    for (const [id, inst] of this._inst) {
      for (const f of inst.step) { try { f(dt); } catch (e) { this._fail(id, e); return; } }
    }
  }
  fireFrame(dt) {
    for (const [id, inst] of this._inst) {
      for (const f of inst.frame) { try { f(dt); } catch (e) { this._fail(id, e); return; } }
    }
  }
  fireReset() {
    for (const [id, inst] of this._inst) {
      for (const f of inst.reset) { try { f(); } catch (e) { this._fail(id, e); return; } }
    }
  }
  fireAct(sim, ctrl) {
    for (const [id, inst] of this._inst) {
      for (const f of inst.act) { try { f(sim, ctrl); } catch (e) { this._fail(id, e); return; } }
    }
  }
  /**
   * Reward-Hook: summiert Boni / formt done → {r, done}.
   * v2.9.0: {done:false} hebt den Aufgaben-Abbruch für diesen Schritt AUF
   * (Freestyle-Aufgaben wie Kopfstand: der „Sturz"-Abbruch der Geh-Aufgabe
   * würde sonst jede Episode nach 1 Schritt killen — genau deshalb
   * „wirkte das Kopfstand-Plugin nicht aufs Training"). done:true erzwingt
   * weiterhin das Episoden-Ende (Eigenerfolg/Zeitlimit des Plugins).
   */
  fireReward(sim, info) {
    let r = info.r, done = info.done;
    for (const [id, inst] of this._inst) {
      for (const f of inst.reward) {
        try {
          const out = f({ r, done, upz: info.upz, height: info.height, task: info.task, sim });
          if (typeof out === 'number') r += out;
          else if (out && typeof out === 'object') {
            if (typeof out.bonus === 'number' && Number.isFinite(out.bonus)) r += out.bonus;
            if (out.done === true) done = true;
            else if (out.done === false) done = false;
          }
        } catch (e) { this._fail(id, e); return { r, done }; }
      }
    }
    return { r, done };
  }
}

// ── Mitgelieferte Beispiele (★, standardmäßig AUS) ─────────
// Sie zeigen die API und sind gleichzeitig nützlich. Der Abwurf-Button
// setzt die „von oben runter werfen"-Idee des Nutzers 1:1 um.
export const BUILTIN_PLUGINS = [
  {
    id: 'builtin_abwurf',
    name: 'Abwurf-Button',
    desc: 'Button „ABWURF": lässt den Roboter aus ~1,5–2,1 m Höhe mit zufälliger Neigung fallen — Übung für Landen und Aufstehen.',
    enabled: false,
    code: `// ABWURF: Roboter in die Luft versetzen — frei fallen lassen.
const chip = api.ui.addChip({ label: 'ABWURF', onClick: () => {
  const s = api.sim();
  if (!s) { api.toast('Kein Roboter geladen', true); return; }
  const p = [0, 0, 0]; s.basePos(p);
  const yaw = Math.random() * 6.2832;
  const tilt = (Math.random() - 0.5) * 0.9;
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const ct = Math.cos(tilt / 2), st = Math.sin(tilt / 2);
  api.teleport(p[0], p[1], 1.5 + Math.random() * 0.6, cy * ct, cy * st, sy * st, sy * ct);
  api.toast('Abwurf!');
  api.log('Abwurf: Roboter aus ~1,8 m fallen gelassen');
}});
return () => chip.remove();`,
  },
  {
    id: 'builtin_autopush',
    name: 'Auto-Schubser',
    desc: 'Schubst den Roboter alle 8–15 s zufällig — Robustheits-Training, solange eine Policy läuft (auch im MANUELL-Modus).',
    enabled: false,
    code: `// Zufällige Schubse im Takt — die Policy lernt Störungen zu verkraften.
let t = 6 + Math.random() * 6;
const off = api.onStep((dt) => {
  t -= dt;
  if (t <= 0) {
    api.push(1.5 + Math.random() * 3);
    t = 8 + Math.random() * 7;
  }
});
return off;`,
  },
  {
    id: 'builtin_kopfstand',
    name: 'Kopfstand-Training',
    desc: 'FREESTYLE-Aufgabe: Roboter startet kopfüber und lernt, den Kopfstand zu halten. Zeigt das Muster: eigene Startpose (onReset) + eigene Belohnung (onReward) + Aufgaben-Abbruch aufheben ({done:false}).',
    enabled: false,
    code: `// KOPFSTAND-TRAINING (v2.9.0 Referenz-Plugin für Freestyle-Aufgaben)
// Muster: 1) onReset setzt JEDE Episode (auch im Training) kopfüber,
//         2) onReward zahlt für kopfüber + ruhig + lange gehalten,
//         3) {done:false} hebt den „Sturz"-Abbruch der Geh-Aufgabe auf —
//            sonst endet jede Episode nach 1 Schritt und nichts lernt.
const HOLD = 2.0;          // so lange Kopfstand halten (s) → Erfolg
const LIMIT = 12.0;        // Episoden-Zeitlimit (s)
let okT = 0, steps = 0;
function upzOf(s) { const q = [0, 0, 0, 0]; s.baseQuat(q); return 1 - 2 * (q[1] * q[1] + q[2] * q[2]); }
api.onReset(() => {
  const s = api.sim(); if (!s) return;
  okT = 0; steps = 0;
  const p = [0, 0, 0]; s.basePos(p);           // aktuelle Höhe als Startanker
  const yaw = Math.random() * 6.2832;
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const t = Math.PI + (Math.random() - 0.5) * 0.3; // kopfüber, leicht gestreut
  const ct = Math.cos(t / 2), st = Math.sin(t / 2);
  // q = qyaw ⊗ qtilt(X) → (cy·ct, cy·st, sy·st, sy·ct)
  api.teleport(p[0], p[1], Math.max(p[2], 0.15), cy * ct, cy * st, sy * st, sy * ct);
});
api.onReward((info) => {
  const s = api.sim(); if (!s) return null;
  const u = Number.isFinite(info.upz) ? info.upz : upzOf(s); // kopfüber = −1
  const inv = Math.max(0, -u);
  let bonus = 0.4 * (-u) + 0.6 * inv * inv;    // je kopfüberer, desto besser
  const w = [0, 0, 0]; s.baseAngVelBody(w);    // ruhig halten zählt doppelt
  const wild = Math.hypot(w[0], w[1], w[2]);
  bonus += 0.15 * Math.exp(-wild * wild);
  steps++;
  // Erfolg (gehalten) oder Zeitlimit → Episode SAUBER beenden (done:true
  // gewinnt gegen das Aufheben unten). Sonst: Abbruch der Geh-Aufgabe
  // aufheben ({done:false}) — Freestyle läuft weiter.
  if (inv > 0.6 && wild < 1.5) { okT += 0.02; } else okT = 0;
  if (okT >= HOLD) { api.toast('KOPFSTAND gehalten!'); return { bonus: bonus + 5, done: true }; }
  if (steps * 0.02 > LIMIT) return { bonus, done: true };
  return { bonus, done: false };
});
api.log('Kopfstand-Training aktiv — Training starten!');
return () => {};`,
  },
];
