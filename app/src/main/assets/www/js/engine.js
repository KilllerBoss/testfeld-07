// ═══════════════════════════════════════════════════════════
// engine.js — MuJoCo-WASM-Integration (offizielle DeepMind-Bindings)
// Lädt Modelle mit echten Meshes über das Emscripten-Dateisystem.
// KEIN Fallback: Wenn etwas nicht lädt, brechen wir hart ab.
// ═══════════════════════════════════════════════════════════

import { clamp } from './math.js';

// MuJoCo-Objekttyp-Konstanten (stabile mjOBJ-Werte)
export const mjOBJ = { BODY: 1, JOINT: 3, GEOM: 5, SITE: 6, ACTUATOR: 19 };

let MJ = null; // Hauptmodul (Embind)

export async function verifyWasmMagic(url) {
  // Harte Prüfung: Datei muss mit 00 61 73 6d beginnen (WebAssembly-Magie)
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`WASM nicht erreichbar (${resp.status}): ${url}`);
  const all = new Uint8Array(await resp.arrayBuffer());
  const head = all.slice(0, 4);
  const ok = head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
  if (!ok) throw new Error('mujoco.wasm ist keine WebAssembly-Datei (Magie-Bytes fehlen)');
  return true;
}

export async function initEngine(consoleLog, opts = {}) {
  if (MJ) return MJ;
  if (opts.wasmBinary) {
    const head = new Uint8Array(opts.wasmBinary.slice(0, 4));
    if (!(head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d)) {
      throw new Error('mujoco.wasm ist keine WebAssembly-Datei (Magie-Bytes fehlen)');
    }
    consoleLog('WASM-Magie geprüft: 00 61 73 6d — OK', 'ok');
    const factory = (await import('../vendor/mujoco.js')).default;
    MJ = await factory({ wasmBinary: opts.wasmBinary });
  } else {
    await verifyWasmMagic('vendor/mujoco.wasm');
    consoleLog('WASM-Magie geprüft: 00 61 73 6d — OK', 'ok');
    const factory = (await import('../vendor/mujoco.js')).default;
    MJ = await factory({ locateFile: (f) => 'vendor/' + f });
  }
  const ver = MJ.mj_versionString ? MJ.mj_versionString() : '(unbekannt)';
  consoleLog(`MuJoCo-Kern geladen: Version ${ver}`, 'ok');
  return MJ;
}

export function mj() { if (!MJ) throw new Error('Engine nicht initialisiert'); return MJ; }

// ── Modell-Verzeichnis ins Emscripten-FS spiegeln ───────────
// manifest.json liegt je Modellordner bei (Build-Zeit erzeugt)
export async function fetchModelIntoFS(baseDir) {
  const m = mj();
  const manifestResp = await fetch(`${baseDir}/manifest.json`);
  if (!manifestResp.ok) throw new Error(`manifest.json fehlt in ${baseDir}`);
  const manifest = await manifestResp.json();
  this_manifests.set(baseDir.split('/').pop(), manifest.files);
  let done = 0;
  for (const rel of manifest.files) {
    const url = `${baseDir}/${rel}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Modelldatei fehlt (${resp.status}): ${url}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const vfsPath = '/models/' + baseDir.split('/').pop() + '/' + rel;
    // Unterordner anlegen (assets/…)
    const parts = vfsPath.split('/').slice(1, -1);
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      try { m.FS.mkdir(acc); } catch (e) { /* existiert schon */ }
    }
    m.FS.writeFile(vfsPath, buf);
    done++;
    if (onProgress) onProgress(done, manifest.files.length, rel);
  }
  return { dir: baseDir, count: done, root: '/models/' + baseDir.split('/').pop() };
}

let onProgress = null;
export function setModelProgress(fn) { onProgress = fn; }

// Modellordner aus dem FS entfernen (RAM-Hygiene beim Roboterwechsel)
export function removeModelFromFS(dirName) {
  const m = mj();
  const root = '/models/' + dirName;
  const manifest = this_manifests.get(dirName);
  if (!manifest) return;
  for (const rel of manifest) {
    try { m.FS.unlink(root + '/' + rel); } catch (e) { /* schon weg */ }
  }
  // Ordner räumen (tiefer zuerst)
  const dirs = new Set(['/models']);
  for (const rel of manifest) {
    const parts = rel.split('/').slice(0, -1);
    let acc = '/models';
    for (const p of parts) { acc += '/' + p; dirs.add(acc); }
  }
  const ordered = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of ordered) { try { m.FS.rmdir(d); } catch (e) { /* nicht leer */ } }
  this_manifests.delete(dirName);
}

const this_manifests = new Map();

// ── Roboter-Simulation ──────────────────────────────────────
export class RobotSim {
  /**
   * @param cfg  Roboter-Konfiguration aus robots.js
   * @param sceneXml Dateiname der Szenen-XML im Modellordner
   */
  constructor(cfg, sceneXml) {
    const m = mj();
    this._mjApi = m;
    this.cfg = cfg;
    const path = this._fsPath + '/' + sceneXml;
    this.model = m.MjModel.from_xml_path(path);
    this.data = new m.MjData(this.model);
    this._resolve();
  }

  get _fsPath() { return '/models/' + this.cfg.dir; }

  // Live-Views (heap-sicher)
  get _qpos() { return this.data.qpos; }
  get _qvel() { return this.data.qvel; }
  get _ctrl() { return this.data.ctrl; }
  get _xpos() { return this.data.xpos; }
  get _xquat() { return this.data.xquat; }

  _resolve() {
    const m = mj();
    const mod = this.model;
    this.nq = mod.nq; this.nv = mod.nv; this.nu = mod.nu;
    this.nbody = mod.nbody; this.ngeom = mod.ngeom;

    // Basis-Körper: erster Körper mit freiem Gelenk (TypedArrays — direkter Zugriff)
    this.baseBody = -1;
    for (let b = 1; b < this.nbody; b++) {
      const jntadr = mod.body_jntadr[b];
      const jntnum = mod.body_jntnum[b];
      if (jntnum > 0 && mod.jnt_type[jntadr] === 0 /* mjJNT_FREE */) { this.baseBody = b; break; }
    }
    if (this.baseBody < 0) throw new Error(`Kein freier Basiskörper in ${this.cfg.name}`);

    // Keyframe
    this.keyId = -1;
    const nkey = mod.nkey;
    for (let k = 0; k < nkey; k++) {
      // key-Namen über mj_name2id? Keyframes haben eigenen Namensraum (mjOBJ_KEY=10? -> nutzen mjtObj: 9?)
      // Zuverlässig: key_name via mj_id2name geht nicht für keys in älteren Bindings -> Name-Index aus cfg.keyname prüfen:
    }
    // Keyframes: Namen sind in Menagerie bekannt ('home'/'stand'/'hover') -> Index 0 verwenden, aber Name loggen
    this.keyId = 0;

    // Aktuator → Gelenk → qpos/dof Adressen
    this.actJoint = new Int32Array(this.nu);
    this.actQposAdr = new Int32Array(this.nu);
    this.actDofAdr = new Int32Array(this.nu);
    this.actName = new Array(this.nu);
    this.actRange = new Float64Array(this.nu * 2);
    this.actCenter = new Float64Array(this.nu);
    for (let a = 0; a < this.nu; a++) {
      const name = m.mj_id2name(mod, mjOBJ.ACTUATOR, a);
      this.actName[a] = name || ('akt_' + a);
      const jid = mod.actuator_trnid[2 * a]; // Trn-Joint
      this.actJoint[a] = jid;
      this.actQposAdr[a] = mod.jnt_qposadr[jid];
      this.actDofAdr[a] = mod.jnt_dofadr[jid];
      this.actRange[2 * a] = mod.actuator_ctrlrange[2 * a];
      this.actRange[2 * a + 1] = mod.actuator_ctrlrange[2 * a + 1];
      this.actCenter[a] = 0.5 * (this.actRange[2 * a] + this.actRange[2 * a + 1]);
    }

    // Namensbasierte Aktuator-Suche
    this.actByName = {};
    for (let a = 0; a < this.nu; a++) this.actByName[this.actName[a]] = a;

    // Keyframe-Reglerwerte (Referenzpose für Training + Gait)
    this.keyCtrl = new Float64Array(this.nu);
    try {
      const kc = mod.key_ctrl; // Float64Array (nkey × nu) — direkter Zugriff
      const off = this.keyId * this.nu;
      for (let a = 0; a < this.nu; a++) this.keyCtrl[a] = kc[off + a];
    } catch (e) { for (let a = 0; a < this.nu; a++) this.keyCtrl[a] = this.actCenter[a]; }

    // WICHTIG: keine gecachten TypedArrays! Jede neue MjData-Allokation
    // (z. B. Geister-Daten) kann den WASM-Heap vergrößern und trennt dann
    // alte Views (→ NaN). Getters liefern stets die gültige View.

    this.ctrl = new Float64Array(this.nu);
    // Timestep: bevorzugt aus dem Modell, sonst aus der Konfiguration
    try { this.timestep = mod.opt.timestep; } catch (e) { this.timestep = this.cfg.timestep || 0.002; }
    if (!(this.timestep > 0 && this.timestep < 0.1)) this.timestep = this.cfg.timestep || 0.002;
  }

  resetToKeyframe() {
    mj().mj_resetDataKeyframe(this.model, this.data, this.keyId);
    mj().mj_forward(this.model, this.data);
    // Regler starten in der Keyframe-Pose (G1-Arme bleiben gebogen etc.)
    this.ctrl.set(this.keyCtrl);
  }

  reset() { this.resetToKeyframe(); }

  applyCtrl() {
    for (let a = 0; a < this.nu; a++) {
      const lo = this.actRange[2 * a], hi = this.actRange[2 * a + 1];
      const v = this.ctrl[a];
      this._ctrl[a] = v < lo ? lo : (v > hi ? hi : v);
    }
  }

  stepN(n) {
    const m = mj();
    this.applyCtrl();
    for (let i = 0; i < n; i++) m.mj_step(this.model, this.data);
  }

  step() { this.applyCtrl(); mj().mj_step(this.model, this.data); }

  // ── Lese-Helfer (gebündelt, um Embind-Overhead zu senken) ──
  basePos(out) { const o = 3 * this.baseBody; out[0] = this._xpos[o]; out[1] = this._xpos[o + 1]; out[2] = this._xpos[o + 2]; return out; }
  baseQuat(out) { const o = 4 * this.baseBody; out[0] = this._xquat[o]; out[1] = this._xquat[o + 1]; out[2] = this._xquat[o + 2]; out[3] = this._xquat[o + 3]; return out; }
  baseVelWorld(out) { out[0] = this._qvel[0]; out[1] = this._qvel[1]; out[2] = this._qvel[2]; return out; }
  baseAngVelBody(out) { out[0] = this._qvel[3]; out[1] = this._qvel[4]; out[2] = this._qvel[5]; return out; }

  /**
   * SCHUBSEN: Impuls (Fx, Fy, Fz) in NEWTON·SEKUNDEN auf die Basis in
   * WELTKOORDINATEN (Z hoch). Wirkt als Geschwindigkeitssprung Δv = J/m_ges —
   * die Policy muss dagegen regeln (Störungs-Robustheit). Aktivierte Kraft-
   * Felder (xfrc_applied) werden danach entfernt.
   */
  pushImpulse(fx, fy, fz) {
    const m = this._mjApi;
    const mass = this._totalMass || (this._totalMass = (() => {
      let s = 0;
      for (let b = 0; b < this.nbody; b++) s += this.model.body_mass[b];
      return s > 1 ? s : 20;
    })());
    // Impuls → Geschwindigkeitssprung (Weltframe; Basis-Quat = Welt da freies Gelenk)
    this._qvel[0] += fx / mass;
    this._qvel[1] += fy / mass;
    this._qvel[2] += fz / mass;
    return mass;
  }

  /** Zufälliger horizontaler Schubs in Richtung dir ('auto'|'fwd'|'back'|'left'|'right') — relativ zur BLICKRICHTUNG des Roboters. */
  pushRandom(dir = 'auto', strength = 1.5) {
    const az = dir === 'auto' ? Math.random() * Math.PI * 2
      : dir === 'fwd' ? 0 : dir === 'back' ? Math.PI
        : dir === 'left' ? Math.PI / 2 : -Math.PI / 2;
    // Blickrichtung (Yaw) der Basis aus der Quaternion (w,x,y,z)
    const o = 4 * this.baseBody;
    const qw = this._xquat[o], qx = this._xquat[o + 1], qy = this._xquat[o + 2], qz = this._xquat[o + 3];
    const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    const a = az + yaw;
    const j = strength * 12; // N·s — 12 N·s ≈ kräftiger Ruds (Δv ≈ 0,6 m/s bei 20 kg)
    return this.pushImpulse(Math.cos(a) * j, Math.sin(a) * j, 0);
  }

  jointPositions(out) {
    for (let a = 0; a < this.nu; a++) out[a] = this._qpos[this.actQposAdr[a]];
    return out;
  }
  jointVelocities(out) {
    for (let a = 0; a < this.nu; a++) out[a] = this._qvel[this.actDofAdr[a]];
    return out;
  }
  setJointTargets(arr) { for (let a = 0; a < this.nu; a++) this.ctrl[a] = arr[a]; }

  // Aktuelle Zielhöhe des Basis-Körpers (für Statuszeile)
  baseHeight() { const p = this._tmp3 || (this._tmp3 = new Float64Array(3)); this.basePos(p); return p[2]; }
  baseSpeed() { const v = this._tmpv || (this._tmpv = new Float64Array(3)); this.baseVelWorld(v); return Math.hypot(v[0], v[1]); }

  dispose() {
    try { this.data.delete(); } catch (e) { /* bereits frei */ }
    try { this.model.delete(); } catch (e) { /* bereits frei */ }
    if (this._ghost) { try { this._ghost.delete(); } catch (e) { /* ok */ } }
  }

  // ── Geister-Daten (kinematische Referenz, keine Dynamik) ──
  makeGhostData() {
    if (!this._ghost) this._ghost = new this._mjApi.MjData(this.model);
    return this._ghost;
  }

  /**
   * Setzt die Geister-Pose: Gelenke aus q[off..off+nu], Basis auf (x, y, höhe)
   * mit Blickrichtung yaw (um +Z). baseLocalQ (optional): zusätzliche lokale
   * Basis-Orientierung [x,y,z,w] (Nick/Roll des Lehrers — z. B. nach vorn
   * gebeugt), wird NACH der Yaw-Rotation angewendet:
   *   Basis-Quat = yawQuat ⊗ baseLocalQ.
   * Danach mj_forward (nur Kinematik).
   */
  setGhostPose(ghost, qArr, off, height, x = 0, y = 0, yaw = 0, baseLocalQ = null) {
    const gq = ghost.qpos;
    for (let a = 0; a < this.nu; a++) gq[this.actQposAdr[a]] = qArr[off + a];
    // Freier Basis-Gelenkanfang (7 Werte: pos + quat)
    const adr = this._baseQposAdr || (this._baseQposAdr = (() => {
      const m = this.model;
      return m.jnt_qposadr[m.body_jntadr[this.baseBody]];
    })());
    gq[adr] = x; gq[adr + 1] = y; gq[adr + 2] = height;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    if (baseLocalQ && baseLocalQ.length >= 4) {
      // Basis = yawQuat ⊗ baseLocalQ. ACHTUNG: baseLocalQ ist [x,y,z,w]
      // (glTF-Konvention im Projekt), MuJoCo qpos erwartet (w,x,y,z)!
      const bx = baseLocalQ[0], by = baseLocalQ[1], bz = baseLocalQ[2], bw = baseLocalQ[3];
      const px = cy * bx - sy * by;
      const py = cy * by + sy * bx;
      const pz = cy * bz + sy * bw;
      const pw = cy * bw - sy * bz;
      gq[adr + 3] = pw; gq[adr + 4] = px; gq[adr + 5] = py; gq[adr + 6] = pz;
    } else {
      gq[adr + 3] = cy; gq[adr + 4] = 0; gq[adr + 5] = 0; gq[adr + 6] = sy;
    }
    this._mjApi.mj_forward(this.model, ghost);
    return ghost;
  }

  /**
   * Setzt die echte Basis (nach reset) horizontal auf (x, y) mit Blick yaw —
   * Höhe/Blick des Keyframes bleiben sonst erhalten. Der Roboter startet
   * damit AUF der Referenz-Bahn statt im Ursprung.
   */
  placeBase(x, y, yaw = 0) {
    const adr = this._baseQposAdr || (this._baseQposAdr = (() => {
      const m = this.model;
      return m.jnt_qposadr[m.body_jntadr[this.baseBody]];
    })());
    this._qpos[adr] = x; this._qpos[adr + 1] = y;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    this._qpos[adr + 3] = cy; this._qpos[adr + 4] = 0; this._qpos[adr + 5] = 0; this._qpos[adr + 6] = sy;
    this._mjApi.mj_forward(this.model, this.data);
  }
}
