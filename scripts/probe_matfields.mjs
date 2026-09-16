// Probe: Welche mjModel-Felder (Material/Textur) liefert das WASM-Binding?
// Node-only, lädt echtes MuJoCo-WASM + G1-Modell aus dem www-Ordner.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

const wasmBin = fs.readFileSync(path.join(WWW, 'vendor/mujoco.wasm'));
const loadMujoco = (await import(path.join(WWW, 'vendor/mujoco.js'))).default;
const mujoco = await loadMujoco({ wasmBinary: wasmBin, noInitialRun: true, print: () => {}, printErr: () => {} });

// G1 minimal laden (nur XML, keine Assets nötig für Feldprüfung — aber mesh fehlt dann; nutze testfeld)
const dir = path.join(WWW, 'models/unitree_g1');
const vfs = '/p/';
mujoco.FS.mkdir('/p');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.xml')) continue;
  const data = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  mujoco.FS.writeFile('/p/' + f, data);
}
// Assets für meshes? probe reicht mit Fehler-fall — nutze stattdessen hfield-freies Mini-XML mit material:
const mini = `<?xml version="1.0"?>
<mujoco>
  <asset>
    <material name="schwarz" rgba="0.2 0.2 0.2 1"/>
    <material name="orange" rgba="1 0.45 0.1 1"/>
    <texture name="texA" type="2d" builtin="checker" width="8" height="8" rgb1="1 0 0" rgb2="0 0 1"/>
    <material name="texturiert" texture="texA" rgba="1 1 1 1"/>
  </asset>
  <worldbody>
    <geom name="b1" type="box" size="0.1 0.1 0.1" material="schwarz"/>
    <geom name="b2" type="box" size="0.1 0.1 0.1" pos="0.5 0 0" material="texturiert"/>
    <geom name="b3" type="box" size="0.1 0.1 0.1" pos="1 0 0" rgba="0.9 0.1 0.1 1"/>
  </worldbody>
</mujoco>`;
mujoco.FS.writeFile('/p/mini.xml', new TextEncoder().encode(mini));

const mod = mujoco.MjModel.from_xml_path('/p/mini.xml');
console.log('nmat:', mod.nmat, ' ntex:', mod.ntex);

const want = ['geom_matid', 'geom_dataid', 'mat_texid', 'ntex', 'tex_width', 'tex_height', 'tex_type', 'tex_adr', 'tex_rgb', 'tex_nchannel', 'nmesh'];
for (const f of want) {
  const v = mod[f];
  if (v === undefined) { console.log(f.padEnd(22), '— FEHLT'); continue; }
  if (v && v.length !== undefined) {
    const arr = Array.from(v.slice(0, 16)).map(Number);
    console.log(f.padEnd(22), `len=${v.length} type=${v.constructor.name}`, JSON.stringify(arr));
  } else {
    console.log(f.padEnd(22), '=', v);
  }
}
console.log('--- mat_rgba komplett:', JSON.stringify(Array.from(mod.mat_rgba)));
console.log('--- tex_adr:', JSON.stringify(Array.from(mod.tex_adr).map(Number)));
console.log('--- tex_rgb len:', mod.tex_rgb ? mod.tex_rgb.length : 'KEIN Feld');
if (mod.tex_nchannel) console.log('--- tex_nchannel:', JSON.stringify(Array.from(mod.tex_nchannel).map(Number)));
if (mod.mat_texid) {
  console.log('--- mat_texid (nmat x 10):', JSON.stringify(Array.from(mod.mat_texid.slice(0, mod.nmat * 10)).map(Number)));
}

// ALLE Feldnamen dumpen (tex*/mat*/mesh* interessieren)
let proto = Object.getPrototypeOf(mod);
const names = new Set();
while (proto && proto.constructor.name !== 'Object') {
  for (const n of Object.getOwnPropertyNames(proto)) names.add(n);
  proto = Object.getPrototypeOf(proto);
}
const all = [...names].filter(n => !n.startsWith('_') && !['constructor','clone','delete','isDeleted','deleteLater'].includes(n));
console.log('TEX-Felder:', all.filter(n => n.toLowerCase().includes('tex')).join(', '));
console.log('MAT-Felder:', all.filter(n => n.startsWith('mat_') || n === 'nmat').join(', '));
console.log('MESH-Felder:', all.filter(n => n.startsWith('mesh_')).join(', '));
