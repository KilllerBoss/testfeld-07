// ═══════════════════════════════════════════════════════════
// appearance.js — AUSSEHEN-EDITOR (v2.14.0)
// Gemini kann Farben UND Material (Glanz/Metallic) je TEIL ändern.
// Ein „Teil" wird über Material-Namen, Body-Namen oder Geom-Namen
// adressiert (Menagerie-Konvention: z. B. jaw_material, top_head_shell).
// Nur RENDERING — die Physik (Masse, Kontakte) bleibt unangetastet.
// Persistiert je Roboter (localStorage), wirkt nach Neustart weiter.
// ═══════════════════════════════════════════════════════════

const LS_PREFIX = 'tr_look_v1_';

/** Spec laden: { all: {color, shine, metal} | null, parts: [{part, color, shine, metal}] } */
export function loadAppearance(robotId) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PREFIX + robotId) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    return sanitizeAppearance(raw);
  } catch (e) { return null; }
}

export function saveAppearance(robotId, spec) {
  try {
    const s = sanitizeAppearance(spec);
    if (!s.parts.length && !s.all) localStorage.removeItem(LS_PREFIX + robotId);
    else localStorage.setItem(LS_PREFIX + robotId, JSON.stringify(s));
    return s;
  } catch (e) { return sanitizeAppearance(spec); }
}

export function clearAppearance(robotId) {
  try { localStorage.removeItem(LS_PREFIX + robotId); } catch (e) { /* egal */ }
}

/** Hex '#rrggbb' → [r,g,b] 0..1 oder null (dann unverändert). */
export function hexToRgb(c) {
  if (typeof c !== 'string') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const _num01 = (v) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
  if (!Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
};

/** Spec hart validieren (KEINE Ausnahme-Objekte aus der KI durchlassen). */
export function sanitizeAppearance(raw) {
  const out = { all: null, parts: [] };
  if (!raw || typeof raw !== 'object') return out;
  const one = (o) => {
    if (!o || typeof o !== 'object') return null;
    const r = {};
    if (o.color !== undefined && o.color !== null) {
      const rgb = hexToRgb(o.color);
      if (rgb) r.color = rgb;
    }
    const sh = o.shine !== undefined ? _num01(o.shine) : null;
    if (sh !== null) r.shine = sh;
    const me = o.metal !== undefined ? _num01(o.metal) : null;
    if (me !== null) r.metal = me;
    return Object.keys(r).length ? r : null;
  };
  out.all = one(raw.all);
  if (Array.isArray(raw.parts)) {
    for (const p of raw.parts.slice(0, 16)) {
      if (!p || typeof p.part !== 'string' || !p.part.trim()) continue;
      const st = one(p);
      if (st) out.parts.push({ part: p.part.trim().toLowerCase().slice(0, 40), ...st });
    }
  }
  return out;
}

/**
 * Teil-Katalog der aktuellen Simulation (für Gemini-Auswahl):
 * Material-Namen + Body-Namen, die Geoms tragen. {materials:[], bodies:[]}
 */
export function partCatalog(sim) {
  const mod = sim.model;
  const mats = new Set(), bodies = new Set();
  for (let g = 0; g < sim.ngeom; g++) {
    const mi = mod.geom_matid ? mod.geom_matid[g] : -1;
    if (mi >= 0) {
      const nm = sim._mjApi.mj_id2name(mod, 14 /* mjOBJ_MATERIAL */, mi);
      if (nm) mats.add(nm);
    }
    const b = mod.geom_bodyid[g];
    if (b > 0) {
      const bn = sim._mjApi.mj_id2name(mod, 1 /* mjOBJ_BODY */, b);
      if (bn) bodies.add(bn);
    }
  }
  return { materials: [...mats].sort(), bodies: [...bodies].sort() };
}

/**
 * Spec auflösen → Map geomIndex → Stil {color:[r,g,b], shine, metal}.
 * Priorität: parts (geom-Name > body-Name > material-Name) über all.
 */
export function resolveAppearance(sim, spec) {
  const map = new Map();
  if (!spec) return map;
  const mod = sim.model;
  const s = spec; // bereits sanitized
  const push = (g, style) => {
    const prev = map.get(g) || {};
    map.set(g, Object.assign(prev, style));
  };
  // Namens-Caches (nur einmal je Sim auflösen)
  if (!sim._lookCache || sim._lookCacheSim !== sim) {
    const geomName = [], bodyName = [], matName = [];
    for (let g = 0; g < sim.ngeom; g++) {
      geomName.push((sim._mjApi.mj_id2name(mod, 5 /* GEOM */, g) || '').toLowerCase());
      const b = mod.geom_bodyid[g];
      bodyName.push(b > 0 ? (sim._mjApi.mj_id2name(mod, 1, b) || '').toLowerCase() : '');
      const mi = mod.geom_matid ? mod.geom_matid[g] : -1;
      matName.push(mi >= 0 ? (sim._mjApi.mj_id2name(mod, 14, mi) || '').toLowerCase() : '');
    }
    sim._lookCache = { geomName, bodyName, matName };
    sim._lookCacheSim = sim;
  }
  const C = sim._lookCache;
  const styleOf = (st) => {
    const o = {};
    if (st.color) o.color = st.color;
    if (st.shine !== undefined) o.rough = 1 - 0.82 * st.shine;  // shine 0..1 → rough 1..0.18
    if (st.metal !== undefined) o.metal = st.metal;
    return o;
  };
  if (s.all) {
    const all = styleOf(s.all);
    for (let g = 0; g < sim.ngeom; g++) push(g, all);
  }
  for (const p of s.parts) {
    const nm = p.part;
    let hit = 0;
    for (let g = 0; g < sim.ngeom; g++) {
      if (C.geomName[g] === nm || C.bodyName[g] === nm || C.matName[g] === nm) {
        push(g, styleOf(p));
        hit++;
      }
    }
    if (!hit) p._unmatched = true; else p._unmatched = false;
  }
  return map;
}
