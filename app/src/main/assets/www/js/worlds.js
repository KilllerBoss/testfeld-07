// ═══════════════════════════════════════════════════════════
// worlds.js — Welten-Generator (v2.7.0)
// Fertige Welten (Testfeld, Parkour, Treppen, Hügel) + SEEDBASIERTER
// Zufallsgenerator. Jede Welt ist prozedurales MJCF-XML und skaliert
// ihre Hindernisse auf die Robotergröße (zTarget = Standhöhe).
// Quelle der Terrain-Ideen: Unitree-Mujoco-Terrain-Tool + MuJoCo-
// Playground/Microduck-Terrain (Stufen, Hänge, Kopfsteinpflaster) —
// hier kompakt als ein Datei-Generator nachgebaut.
// ═══════════════════════════════════════════════════════════

export const WORLDS = [
  { id: 'testfeld', name: 'Testfeld', desc: 'Klassiker: Rampe, Treppe, Tor, Säulen, schiefe Platte' },
  { id: 'flach', name: 'Flach', desc: 'Nur Boden — Gehen sauber lernen' },
  { id: 'parkour', name: 'Parkour', desc: 'Tore, Säulen, Rampen, Plattformen — Hindernislauf' },
  { id: 'treppen', name: 'Treppen', desc: 'Auf- & Abwärtstreppen mit Podest' },
  { id: 'huegel', name: 'Hügel', desc: 'Unregelmäßiger Kopfsteinboden (Terrain)' },
  { id: 'zufall', name: 'Zufall', desc: 'Neu würfeln: gemischte Hinderniswelt mit Seed' },
  { id: 'ki', name: 'KI-WELT', desc: 'Von Gemini gebaute Welt (setWorld): eigene Objekte + Farben' },
];

export function getWorld(id) {
  return WORLDS.find(w => w.id === id) || WORLDS[0];
}

// Deterministischer PRNG (mulberry32) — gleicher Seed ⇒ gleiche Welt
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLR = {
  floor: '0.07 0.08 0.11 1',
  obs: '0.10 0.115 0.145 1',
  mark: '0.95 0.52 0.10 1',
  teal: '0.22 0.62 0.66 1',
};

// Eine Box mit Positions-/Größenangabe (Meter, vor Skalierung s)
function box(id, x, y, z, hx, hy, hz, opts = {}) {
  const s = opts.scale || 1;
  const e = opts.euler ? ` euler="${opts.euler}"` : '';
  const c = opts.color || CLR.obs;
  const fr = opts.friction ? ` friction="${opts.friction}"` : '';
  const soft = opts.soft ? ' solref="0.04 1"' : '';
  return `    <body name="w_${id}" pos="${(x * s).toFixed(3)} ${(y * s).toFixed(3)} ${(z * s).toFixed(3)}"${e}>\n` +
    `      <geom name="w_${id}_g" type="box" size="${(hx * s).toFixed(3)} ${(hy * s).toFixed(3)} ${(hz * s).toFixed(3)}" rgba="${c}" condim="3"${fr}${soft}/>\n    </body>\n`;
}

function cyl(id, x, y, z, r, h, opts = {}) {
  const s = opts.scale || 1;
  const c = opts.color || CLR.obs;
  return `    <body name="w_${id}" pos="${(x * s).toFixed(3)} ${(y * s).toFixed(3)} ${(z * s).toFixed(3)}">\n` +
    `      <geom name="w_${id}_g" type="cylinder" size="${(r * s).toFixed(3)} ${(h * s).toFixed(3)}" rgba="${c}" condim="3"/>\n    </body>\n`;
}

// klassisches Testfeld-Layout (Nachbau des bisherigen testfeld.xml, skaliert)
function testfeldBodies(s) {
  let b = '';
  b += box('ramp_a', 3.4, -1.4, 0.116, 1.30, 0.84, 0.063, { euler: '0 -0.21 0', friction: '0.9' });
  b += box('plat', 6.0, 1.6, 0.147, 0.90, 0.90, 0.147);
  b += box('plat_ramp', 4.55, 1.6, 0.074, 0.95, 0.73, 0.037, { euler: '0 -0.19 0', friction: '0.9' });
  b += box('step0', 0, 4.2, 0.053, 0.85, 0.28, 0.053);
  b += box('step1', 0, 4.75, 0.105, 0.85, 0.28, 0.105);
  b += box('step2', 0, 5.3, 0.158, 0.85, 0.28, 0.158);
  b += box('wall_l', -4.5, -1.1, 0.367, 1.6, 0.09, 0.367);
  b += box('wall_r', -4.5, 1.1, 0.367, 1.6, 0.09, 0.367);
  b += cyl('gate_l', -7, -2.8, 0.525, 0.105, 0.525);
  b += cyl('gate_r', -7, -1.2, 0.525, 0.105, 0.525);
  b += box('gate_top', -7, -2.0, 1.113, 0.08, 0.9, 0.042, { color: CLR.mark });
  b += cyl('pil0', 2.5, 2.5, 0.578, 0.147, 0.578) + cyl('pil0t', 2.5, 2.5, 1.194, 0.152, 0.016, { color: CLR.teal });
  b += cyl('pil1', -2.5, 3.0, 0.578, 0.147, 0.578) + cyl('pil1t', -2.5, 3.0, 1.194, 0.152, 0.016, { color: CLR.teal });
  b += cyl('pil2', -2.0, -3.0, 0.578, 0.147, 0.578) + cyl('pil2t', -2.0, -3.0, 1.194, 0.152, 0.016, { color: CLR.teal });
  b += cyl('pil3', 5.5, -3.0, 0.578, 0.147, 0.578) + cyl('pil3t', 5.5, -3.0, 1.194, 0.152, 0.016, { color: CLR.teal });
  b += box('edge', 7.4, -0.5, 0.095, 0.90, 0.90, 0.053, { euler: '0.35 0 0.4', friction: '0.9' });
  return b;
}

function flachBodies(s) {
  // Startmarkierung (flacher Ring aus 4 niedrigen Platten weit weg)
  let b = '';
  b += box('mark', 3.0, 0, 0.011, 0.5, 0.06, 0.011, { color: CLR.mark });
  return b;
}

function parkourBodies(s, rng) {
  let b = '';
  // Slalom-Tore
  const gates = [[2.2, 1.0], [4.6, -0.6], [7.0, 0.9], [9.4, -0.8]];
  gates.forEach(([x, y], i) => {
    b += cyl(`gate${i}l`, x, y - 0.45, 0.53, 0.09, 0.53);
    b += cyl(`gate${i}r`, x, y + 0.45, 0.53, 0.09, 0.53);
    b += box(`gate${i}t`, x, y, 1.08, 0.07, 0.52, 0.04, { color: CLR.mark });
  });
  // Serpentine aus Säulen
  for (let i = 0; i < 6; i++) {
    const x = 1.5 + i * 1.5, y = (i % 2 ? -2.4 : 2.4);
    b += cyl(`pil${i}`, x, y, 0.55, 0.13, 0.55);
  }
  // Hürden niedrig/breit
  for (let i = 0; i < 3; i++) {
    b += box(`hurd${i}`, 2.8 + i * 2.6, -3.6, 0.05 + 0.05 * i, 0.5, 0.08, 0.05 + 0.05 * i);
  }
  // Rampen-Kombi
  b += box('ramp1', 5.5, 3.4, 0.10, 1.0, 0.7, 0.05, { euler: '0 -0.18 0', friction: '0.9' });
  b += box('plat1', 7.6, 3.4, 0.17, 0.8, 0.7, 0.17);
  b += box('ramp2', 9.3, 3.4, 0.09, 0.85, 0.7, 0.05, { euler: '0 0.2 0', friction: '0.9' });
  // schiefe Platte
  b += box('edge', 1.0, -3.8, 0.08, 0.8, 0.8, 0.045, { euler: '0.3 0 0.5', friction: '0.9' });
  return b;
}

function treppenBodies(s) {
  let b = '';
  // Aufwärts: 5 Stufen + Podest
  const N = 5, sh = 0.055, sd = 0.30, w = 0.9;
  for (let i = 0; i < N; i++) {
    b += box(`up${i}`, 0, 2.0 + i * sd, (i + 1) * sh / 2, w, sd / 2, (i + 1) * sh / 2);
  }
  const top = N * sh;
  b += box('podest', 0, 2.0 + N * sd + 0.8, top / 2, w, 0.8, top / 2);
  // Abwärts dahinter (letzte Stufe endet auf dem Boden → keine 0-Höhen-Box)
  for (let i = 0; i < N; i++) {
    const h = top - (i + 1) * sh;
    if (h < 0.02) break;
    b += box(`dn${i}`, 0, 2.0 + (N + 1) * sd + 0.8 + 0.8 + i * sd, h / 2, w, sd / 2, h / 2);
  }
  // Seitliche Quer-Treppe (rechts hoch, links runter)
  for (let i = 0; i < 4; i++) {
    b += box(`side${i}`, -3.5 + i * sd, -2.6, (i + 1) * sh / 2, sd / 2, 0.8, (i + 1) * sh / 2);
  }
  // Podest-Markierung
  b += box('mark', 0, 2.0 + N * sd + 0.8, top + 0.012, w, 0.8, 0.012, { color: CLR.mark });
  return b;
}

// Kopfstein-Terrain: Raster von Boxen mit Zufallshöhen (wie Microduck-
// Cobble-Terrain, NaN-sicher mit weichem solref)
function huegelBodies(s, rng) {
  let b = '';
  const cell = 0.55, n = 12;
  for (let ix = 0; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      const x = (ix - (n - 1) / 2) * cell, y = (iy - (n - 1) / 2) * cell;
      const r = Math.hypot(x, y);
      if (r < 1.6) continue; // Spawn-Bereich frei
      const h = 0.012 + rng() * 0.05;
      b += box(`cob${ix}_${iy}`, x, y, h / 2, cell / 2 - 0.012, cell / 2 - 0.012, h / 2, { soft: true });
    }
  }
  // zwei Rampen hinein/hinaus
  b += box('ramp_in', 0, 4.6, 0.05, 0.7, 0.7, 0.05, { euler: '0 -0.12 0', friction: '0.9' });
  b += box('ramp_out', -4.6, 0, 0.05, 0.7, 0.7, 0.05, { euler: '0.12 0 0', friction: '0.9' });
  return b;
}

// Zufallswelt: Mischung aus Bibliotheks-Elementen, seeded
function zufallBodies(s, rng) {
  let b = '';
  const elements = [];
  // Bibliothek: [typ, param]
  for (let i = 0; i < 4; i++) elements.push({ t: 'gate' });
  for (let i = 0; i < 6; i++) elements.push({ t: 'pil' });
  for (let i = 0; i < 4; i++) elements.push({ t: 'ramp' });
  for (let i = 0; i < 3; i++) elements.push({ t: 'box' });
  for (let i = 0; i < 3; i++) elements.push({ t: 'stair' });
  for (let i = 0; i < 3; i++) elements.push({ t: 'tilt' });
  const used = [];
  const placed = [];
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k];
    // Position suchen: Ring 2..9 m, Mindestabstand zu anderen
    for (let tries = 0; tries < 30; tries++) {
      const a = rng() * Math.PI * 2;
      const r = 2.0 + rng() * 7.0;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (Math.abs(x) < 1.4 && Math.abs(y) < 1.4) continue; // Spawn
      let ok = true;
      for (const p of placed) if (Math.hypot(p[0] - x, p[1] - y) < 1.5) { ok = false; break; }
      if (!ok) continue;
      placed.push([x, y]);
      const rot = (rng() * 2 - 1) * Math.PI; // Zufallsdrehung um Z
      const ca = Math.cos(rot), sa = Math.sin(rot);
      if (el.t === 'gate') {
        // Tore entlang ihrer Achse drehen: zwei Pfosten ±0.45 quer zur Richtung
        const px = 0.45 * sa, py = 0.45 * -ca; // senkrecht zur Blickrichtung (rotiert um rot)
        b += cyl(`g${k}l`, x - px, y - py, 0.53, 0.09, 0.53);
        b += cyl(`g${k}r`, x + px, y + py, 0.53, 0.09, 0.53);
        b += box(`g${k}t`, x, y, 1.08, 0.07, 0.55, 0.04, { euler: `0 0 ${rot.toFixed(3)}`, color: CLR.mark });
      } else if (el.t === 'pil') {
        b += cyl(`p${k}`, x, y, 0.55, 0.12 + rng() * 0.06, 0.55);
      } else if (el.t === 'ramp') {
        const tilt = (0.14 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1);
        b += box(`r${k}`, x, y, 0.09, 0.95, 0.75, 0.05, { euler: `0 ${(-tilt).toFixed(3)} ${rot.toFixed(3)}`, friction: '0.9' });
      } else if (el.t === 'box') {
        const h = 0.06 + rng() * 0.12;
        b += box(`b${k}`, x, y, h / 2, 0.4 + rng() * 0.35, 0.4 + rng() * 0.35, h / 2, { euler: `0 0 ${rot.toFixed(3)}` });
      } else if (el.t === 'stair') {
        const N = 3, sh = 0.05 + rng() * 0.025, sd = 0.3;
        const dirx = Math.cos(rot), diry = Math.sin(rot);
        for (let i = 0; i < N; i++) {
          const sx = x + dirx * (i * sd * s), sy = y + diry * (i * sd * s);
          b += box(`s${k}_${i}`, sx, sy, (i + 1) * sh / 2, 0.55, 0.6, (i + 1) * sh / 2, { euler: `0 0 ${rot.toFixed(3)}` });
        }
      } else if (el.t === 'tilt') {
        b += box(`t${k}`, x, y, 0.08, 0.8, 0.8, 0.05, { euler: `0.3 0 ${rot.toFixed(3)}`, friction: '0.9' });
      }
      used.push(el);
      break;
    }
  }
  return b;
}

// ── v2.14.0: KI-WELT — Objekte von Gemini (setWorld-Tool) ──────
// Objekt-Format (hart validiert, siehe sanitizeKiObjects):
//   { type:'box'|'ball'|'cyl'|'ramp'|'tilt'|'gate'|'stair',
//     x, y, [z], size:{x,y,z} | r,h | w,l,h, color:'#rrggbb', euler:[rx,ry,rz] }
// Spawn-Bereich bleibt immer frei (kein Objekt näher als 0,9 m am Ursprung).
export const KI_OBJ_TYPES = ['box', 'ball', 'cyl', 'ramp', 'tilt', 'gate', 'stair'];

const _hexOk = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim());

export function sanitizeKiObjects(raw) {
  const out = [];
  if (!Array.isArray(raw)) return { objects: out, errors: ['objects muss eine Liste sein'] };
  const errors = [];
  const num = (v, lo, hi, dflt) => {
    const x = typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v);
    if (!Number.isFinite(x)) return dflt;
    return Math.min(hi, Math.max(lo, x));
  };
  for (let i = 0; i < Math.min(raw.length, 40); i++) {
    const o = raw[i];
    if (!o || typeof o !== 'object') { errors.push(`#${i}: kein Objekt`); continue; }
    const type = KI_OBJ_TYPES.includes(o.type) ? o.type : null;
    if (!type) { errors.push(`#${i}: unbekannter Typ "${o.type}" (erlaubt: ${KI_OBJ_TYPES.join(', ')})`); continue; }
    const x = num(o.x, -12, 12, 0), y = num(o.y, -12, 12, 0);
    if (Math.hypot(x, y) < 0.9) { errors.push(`#${i}: zu nah am Spawn (min. 0,9 m Abstand)`); continue; }
    const col = _hexOk(o.color) ? o.color.trim() : null;
    const e = Array.isArray(o.euler) ? [num(o.euler[0], -1.2, 1.2, 0), num(o.euler[1], -1.2, 1.2, 0), num(o.euler[2], -3.15, 3.15, 0)] : null;
    const obj = { type, x: +x.toFixed(3), y: +y.toFixed(3), color: col, euler: e };
    if (type === 'ball') {
      obj.r = num(o.r, 0.03, 0.8, 0.12);
      obj.z = num(o.z, obj.r, 3, obj.r);
    } else if (type === 'cyl') {
      obj.r = num(o.r, 0.03, 0.8, 0.1);
      obj.h = num(o.h, 0.05, 2, 0.5);
      obj.z = num(o.z, obj.h / 2, 3, obj.h / 2);
    } else {
      const sx = num(o.w !== undefined ? o.w : (o.size && o.size[0]), 0.05, 2.5, 0.5);
      const sy = num(o.l !== undefined ? o.l : (o.size && o.size[1]), 0.05, 2.5, 0.5);
      const sz = num(o.h !== undefined ? o.h : (o.size && o.size[2]), 0.02, 1.2, 0.1);
      obj.w = sx; obj.l = sy; obj.h = sz;
      obj.z = num(o.z, sz / 2, 3, sz / 2);
    }
    out.push(obj);
  }
  if (Array.isArray(raw) && raw.length > 40) errors.push('maximal 40 Objekte — Rest verworfen');
  return { objects: out, errors };
}

function kiBodies(objects) {
  let b = '';
  let k = 0;
  const box = (id, x, y, z, hw, hl, hh, col, e, fr) => {
    const et = e ? ` euler="${e[0].toFixed(3)} ${e[1].toFixed(3)} ${e[2].toFixed(3)}"` : '';
    const f = fr ? ' friction="0.9"' : '';
    return `    <body name="ki_${id}" pos="${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}"${et}>\n` +
      `      <geom name="ki_${id}_g" type="box" size="${hw.toFixed(3)} ${hl.toFixed(3)} ${hh.toFixed(3)}" rgba="${col}" condim="3"${f}/>\n    </body>\n`;
  };
  for (const o of objects) {
    const c = o.color || CLR.obs;
    const e = o.euler;
    if (o.type === 'ball') {
      b += `    <body name="ki_b${k}" pos="${o.x.toFixed(3)} ${o.y.toFixed(3)} ${o.z.toFixed(3)}">\n` +
        `      <geom name="ki_b${k}_g" type="sphere" size="${o.r.toFixed(3)}" rgba="${c}" condim="3" friction="0.6"/>\n    </body>\n`;
    } else if (o.type === 'cyl') {
      b += `    <body name="ki_c${k}" pos="${o.x.toFixed(3)} ${o.y.toFixed(3)} ${o.z.toFixed(3)}">\n` +
        `      <geom name="ki_c${k}_g" type="cylinder" size="${o.r.toFixed(3)} ${o.h.toFixed(3)}" rgba="${c}" condim="3"/>\n    </body>\n`;
    } else if (o.type === 'box') {
      b += box(`x${k}`, o.x, o.y, o.z, o.w / 2, o.l / 2, o.h / 2, c, e);
    } else if (o.type === 'ramp' || o.type === 'tilt') {
      const tilt = o.type === 'tilt' ? 0.3 : 0.18;
      const ey = e ? e[1] + tilt : tilt;
      const ee = [e ? e[0] : 0, ey, e ? e[2] : 0];
      b += box(`r${k}`, o.x, o.y, o.z, Math.max(o.w, 0.6) / 2, Math.max(o.l, 0.6) / 2, Math.max(o.h, 0.08) / 2, c, ee, true);
    } else if (o.type === 'gate') {
      // Zwei Pfosten + Querbalken, Ausrichtung über euler-z
      const rot = e ? e[2] : 0;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      const px = 0.45 * sa, py = 0.45 * -ca;
      const ph = Math.max(o.h, 0.5);
      b += box(`g${k}l`, o.x - px, o.y - py, ph / 2, 0.075, 0.075, ph / 2, c, null);
      b += box(`g${k}r`, o.x + px, o.y + py, ph / 2, 0.075, 0.075, ph / 2, c, null);
      b += box(`g${k}t`, o.x, o.y, ph + 0.04, 0.06, 0.55, 0.04, o.color || CLR.mark, e ? [0, 0, rot] : [0, 0, rot]);
    } else if (o.type === 'stair') {
      const N = 4, sh = Math.max(0.03, Math.min(0.08, o.h)), sd = Math.max(0.22, Math.min(0.4, o.l));
      const rot = e ? e[2] : 0;
      const dirx = Math.cos(rot), diry = Math.sin(rot);
      for (let i = 0; i < N; i++) {
        const sx = o.x + dirx * i * sd, sy = o.y + diry * i * sd;
        b += box(`s${k}_${i}`, sx, sy, (i + 1) * sh / 2, Math.max(o.w, 0.4) / 2, sd / 2, (i + 1) * sh / 2, c, rot ? [0, 0, rot] : null);
      }
    }
    k++;
  }
  return b;
}

/**
 * Erzeugt die Welt-Szenen-XML (include des Roboter-XMLs).
 * @param cfg    Roboter-Konfiguration (zTarget skaliert die Hindernisse)
 * @param worldId einer aus WORLDS
 * @param seed   Seed für 'zufall' (default 1)
 * @param kiObjects v2.14.0: für worldId 'ki' — Liste von KI-Objekten
 * @returns MJCF-XML-String
 */
export function buildWorldXML(cfg, worldId, seed = 1, kiObjects = null) {
  const s = (cfg.zTarget || 0.75) / 0.75; // Skala relativ zum G1
  const rng = mulberry32(seed || 1);
  let bodies = '';
  switch (worldId) {
    case 'flach': bodies = flachBodies(s); break;
    case 'parkour': bodies = parkourBodies(s, rng); break;
    case 'treppen': bodies = treppenBodies(s); break;
    case 'huegel': bodies = huegelBodies(s, rng); break;
    case 'zufall': bodies = zufallBodies(s, rng); break;
    case 'ki': bodies = kiBodies(Array.isArray(kiObjects) ? kiObjects : []); break;
    case 'testfeld':
    default: bodies = testfeldBodies(s); break;
  }
  return `<mujoco model="welt_${worldId}">\n` +
    `  <include file="${cfg.modelXml || 'robot.xml'}"/>\n` +
    `  <worldbody>\n` +
    `    <geom name="w_floor" type="plane" size="0 0 0.05" rgba="${CLR.floor}" condim="3" friction="1.0 0.005 0.0001"/>\n` +
    bodies +
    `  </worldbody>\n` +
    `</mujoco>\n`;
}
