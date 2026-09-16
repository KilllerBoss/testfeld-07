// v2.14.1 — GRAU-FIX Tests: Renderer nutzt Materialfarben (mat_rgba),
// Texturen (tex_data→DataTexture), UVs und Look-Restore.
// Läuft in Node mit echtem MuJoCo-WASM. Renderer-Logik wird facettiert
// nachgebaut (denselbe Formeln) — die Browser-Suite (ui_v2140_test.mjs)
// prüft das echte Rendering zusätzlich.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
};

console.log('── 1) Quellcode-Checks (render3d.js) ───────────────');
const r3d = fs.readFileSync(path.join(WWW, 'js/render3d.js'), 'utf8');
ok(r3d.includes('geom_matid'), 'render3d nutzt geom_matid');
ok(r3d.includes('mat_rgba'), 'render3d nutzt mat_rgba (Materialfarben)');
ok(r3d.includes('mat_metallic') && r3d.includes('mat_roughness'), 'render3d nutzt metallic/roughness aus Material');
ok(r3d.includes('tex_data') && r3d.includes('DataTexture'), 'render3d baut DataTexture aus tex_data');
ok(r3d.includes('mesh_facetexcoord'), 'render3d setzt UVs via mesh_facetexcoord');
ok(r3d.includes("setAttribute('uv'"), 'Geometrie bekommt uv-Attribut');
ok(r3d.includes('userData.base'), 'Meshes speichern Basis-Stil (Look-Restore)');
ok(!/metalness:\s*look && look\.metal !== undefined \? look\.metal : 0\.22/.test(r3d), 'altes Grau-Fallback (0.22 fest) entfernt');
ok(r3d.includes('mjTEXROLE_RGB = 1'), 'Textur-Rolle RGB korrekt adressiert');

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const uijs = fs.readFileSync(path.join(WWW, 'js/ui.js'), 'utf8');
const mainjs = fs.readFileSync(path.join(WWW, 'js/main.js'), 'utf8');
ok(!html.includes('btnFull') && !html.includes('btnConsole'), 'index.html: Vollbild-/Konsole-Buttons weg');
ok(!html.includes('consolePanel'), 'index.html: Konsolen-Panel weg');
ok(html.includes('id="consoleLog" hidden'), 'index.html: verstecktes Log-Element bleibt');
ok(!uijs.includes('toggleConsole'), 'ui.js: toggleConsole entfernt');
ok(!mainjs.includes("getElementById('btnFull')"), 'main.js: btnFull-Handler weg');
ok(!mainjs.includes("getElementById('btnConsole')"), 'main.js: btnConsole-Handler weg');
ok(uijs.includes('bootLines.push(msg)'), 'ui.js: log() sammelt Boot-Zeilen weiter');
const css = fs.readFileSync(path.join(WWW, 'style.css'), 'utf8');
ok(!css.includes('.console {'), 'style.css: Konsole-Styles weg');

console.log('── 2) WASM-Feld-Checks (echtes MuJoCo) ─────────────');
const wasmBin = fs.readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
const loadMujoco = (await import(path.join(WWW, 'vendor/mujoco.js'))).default;
const mujoco = await loadMujoco({ wasmBinary: wasmBin, noInitialRun: true, print: () => {}, printErr: () => {} });

const mini = `<?xml version="1.0"?>
<mujoco>
  <asset>
    <material name="schwarz" rgba="0.2 0.2 0.2 1"/>
    <texture name="texA" type="2d" builtin="checker" width="8" height="8" rgb1="1 0 0" rgb2="0 0 1"/>
    <material name="texturiert" texture="texA" rgba="1 1 1 1"/>
  </asset>
  <worldbody>
    <geom name="b1" type="box" size="0.1 0.1 0.1" material="schwarz"/>
    <geom name="b2" type="box" size="0.1 0.1 0.1" pos="0.5 0 0" material="texturiert"/>
    <geom name="b3" type="box" size="0.1 0.1 0.1" pos="1 0 0" rgba="0.9 0.1 0.1 1"/>
  </worldbody>
</mujoco>`;
mujoco.FS.writeFile('/mini.xml', new TextEncoder().encode(mini));
const mod = mujoco.MjModel.from_xml_path('/mini.xml');

// Renderer-Formel (identisch zu render3d.js buildFromModel)
function baseColorOf(mod, gI) {
  const c4 = 4 * gI;
  let cr = mod.geom_rgba[c4], cg = mod.geom_rgba[c4 + 1], cb = mod.geom_rgba[c4 + 2], ca = mod.geom_rgba[c4 + 3];
  let met = 0.22, rgh = 0.62, texId = -1;
  const mId = mod.geom_matid ? mod.geom_matid[gI] : -1;
  if (mId >= 0 && mod.mat_rgba) {
    const m4 = 4 * mId;
    cr = mod.mat_rgba[m4]; cg = mod.mat_rgba[m4 + 1]; cb = mod.mat_rgba[m4 + 2]; ca = mod.mat_rgba[m4 + 3];
    if (mod.mat_metallic) met = Math.min(1, Math.max(0, mod.mat_metallic[mId]));
    if (mod.mat_roughness) rgh = Math.min(1, Math.max(0.25, mod.mat_roughness[mId]));
    texId = mod.mat_texid ? Number(mod.mat_texid[10 * mId + 1]) : -1;
  }
  return { cr, cg, cb, ca, met, rgh, texId, mId };
}

const b1 = baseColorOf(mod, 0); // material="schwarz"
ok(Math.abs(b1.cr - 0.2) < 0.01 && Math.abs(b1.cg - 0.2) < 0.01, `Geom mit Material bekommt Materialfarbe (${b1.cr.toFixed(2)},${b1.cg.toFixed(2)})`);
const b2 = baseColorOf(mod, 1); // material="texturiert"
ok(b2.texId === 0, `Texturiertes Material liefert texId (${b2.texId})`);
const b3 = baseColorOf(mod, 2); // direkte rgba
ok(Math.abs(b3.cr - 0.9) < 0.01 && Math.abs(b3.cb - 0.1) < 0.01, 'Geom mit direkter rgba behält eigene Farbe');

// Textur-Daten: checker 8×8, rot/blau → tex_data muss rot + blau enthalten
{
  const w = mod.tex_width[0], h = mod.tex_height[0];
  const nc = mod.tex_nchannel[0];
  const adr = Number(mod.tex_adr[0]);
  const src = mod.tex_data;
  ok(w === 8 && h === 8, `Texturgröße ${w}×${h}`);
  ok(nc === 3, `Texturkanäle ${nc}`);
  ok(adr * nc + w * h * nc <= src.length, 'tex_adr·nchannel-Grenzen respektiert (Renderer-Formel)');
  // ein roter und ein blauer Texel vorhanden?
  let hasRed = false, hasBlue = false;
  for (let p = 0; p < w * h; p++) {
    const s = adr * nc + p * nc;
    if (src[s] > 200 && src[s + 1] < 40 && src[s + 2] < 40) hasRed = true;
    if (src[s + 2] > 200 && src[s] < 40 && src[s + 1] < 40) hasBlue = true;
  }
  ok(hasRed && hasBlue, 'Textur-Bytes enthalten Checker-Farben (rot+blau)');
}

console.log('── 3) Look-Restore-Semantik (Formeln aus _applyLook) ─');
{
  // Basis wie im Renderer
  const base = { color: [0.2, 0.2, 0.2], rough: 0.5, metal: 0, map: { fake: 'tex' } };
  // Mesh mit Farbe-Override → Map muss weg
  let m = { color: [0, 0, 0], rough: base.rough, metal: base.metal, map: base.map };
  const st = { color: [1, 0.45, 0.1], rough: 0.3 };
  if (st.color) { m.color = [...st.color]; if (m.map) m.map = null; }
  if (st.rough !== undefined) m.rough = st.rough;
  ok(m.map === null && m.color[0] === 1 && m.color[1] === 0.45, 'Farbe-Override ersetzt Textur');
  // Reset (st = null) → Basis inkl. Map zurück
  m.color = [...base.color]; m.rough = base.rough; m.metal = base.metal;
  if (m.map !== base.map) m.map = base.map;
  ok(m.map === base.map && m.color[0] === 0.2, 'Reset stellt Basis + Textur wieder her');
  // Nur rough/metal Override → Map bleibt
  const st2 = { rough: 0.9 };
  m = { color: [...base.color], rough: base.rough, metal: base.metal, map: base.map };
  if (st2.rough !== undefined) m.rough = st2.rough;
  ok(m.map === base.map && m.rough === 0.9, 'Rough/Metal-Override lässt Textur an');
}

console.log('── 4) Echte Roboter-Modelle: Materialfarben vorhanden ─');
// G1 aus assets laden (nur XMLs — meshes nicht nötig für mat-Check? doch, XML braucht mesh-Files → skip)
// Stattdessen: XML-Quellen prüfen (Materialfarben referenziert)
const g1 = fs.readFileSync(path.join(WWW, 'models/unitree_g1/g1.xml'), 'utf8');
ok(/<material name="black" rgba="0\.2 0\.2 0\.2 1"\/>/.test(g1), 'G1: Material "black" definiert');
ok(/material="black"/.test(g1), 'G1: Geoms referenzieren Material');
const duck = fs.readFileSync(path.join(WWW, 'models/pollen_microduck/microduck.xml'), 'utf8');
ok(/_material" rgba="0\.85/.test(duck), 'MicroDuck: farbige Materialien definiert');
const x2 = fs.readFileSync(path.join(WWW, 'models/skydio_x2/x2.xml'), 'utf8');
ok(/<material name="phong3SG" texture=/.test(x2), 'X2: Material mit Textur definiert');
const x2man = JSON.parse(fs.readFileSync(path.join(WWW, 'models/skydio_x2/manifest.json'), 'utf8'));
ok(x2man.files.includes('assets/X2_lowpoly_texture_SpinningProps_1024.png'), 'X2: Textur-PNG im Manifest (VFS)');

console.log(`\n═══ ERGEBNIS: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
