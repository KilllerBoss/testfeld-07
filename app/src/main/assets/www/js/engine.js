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

/**
 * v2.7.0 — Generierte Welt-XML in den Modellordner schreiben (VFS).
 * Die Welt ist prozedural erzeugt (worlds.js) und includiert das Roboter-
 * XML relativ — deshalb muss sie IM SELBEN Ordner liegen wie das Modell.
 */
export function writeWorldFile(dirName, fileName, xml) {
  const m = mj();
  const path = '/models/' + dirName + '/' + fileName;
  m.FS.writeFile(path, new TextEncoder().encode(xml));
  return path;
}

// Modellordner aus dem FS entfernen (RAM-Hygiene beim Roboterwechsel)
/** v2.7.0: Ist das Modell bereits im Emscripten-FS? (Doppel-Ladungen sparen) */
export function hasModelInFS(dirName) {
  return this_manifests.has(dirName);
}

export function removeModelFromFS(dirName) {
  const m = mj();
  const root = '/models/' + dirName;
  const manifest = this_manifests.get(dirName);
  if (!manifest) return;
  for (const rel of manifest) {
    try { m.FS.unlink(root + '/' + rel); } catch (e) { /* schon weg */ }
  }
  // v2.7.0: generierte Welt-Datei auch räumen (nicht im Manifest)
  try { m.FS.unlink(root + '/welt_live.xml'); } catch (e) { /* schon weg */ }
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

    // v2.9.0: Roboter-Bodies = Teilbaum unter baseBody. Das Testfeld enthält
    // STATISCHE Deko-Bodies (Rampen, Mauern, Stufen — z. T. unterhalb z=0
    // verankert); sie gehören NICHT zur Boden-Freiheit des Roboters.
    this._robotBody = new Uint8Array(this.nbody);
    if (mod.body_parentid) {
      const stack = [this.baseBody];
      while (stack.length) {
        const b = stack.pop();
        this._robotBody[b] = 1;
        for (let c = 1; c < this.nbody; c++) {
          if (!this._robotBody[c] && mod.body_parentid[c] === b) stack.push(c);
        }
      }
    } else {
      this._robotBody.fill(1);
    }

    // Keyframe
    this.keyId = 0;
    const nkey = mod.nkey;
    for (let k = 0; k < nkey; k++) {
      // key-Namen über mj_name2id? Keyframes haben eigenen Namensraum (mjOBJ_KEY=10? -> nutzen mjtObj: 9?)
      // Zuverlässig: key_name via mj_id2name geht nicht für keys in älteren Bindings -> Name-Index aus cfg.keyname prüfen:
    }
    // Keyframes: Index aus cfg (v2.7.0 — z. B. Microduck STAND = Index 1), sonst 0
    this.keyId = this.cfg.keyIndex || 0;

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

    // ── v2.7.0 SENSORIK ────────────────────────────────────
    // Sensoren nach TYP auflösen (mjSENS_GYRO=3, mjSENS_ACCELEROMETER=1):
    // echte IMU-Werte aus sensordata statt gerechneter Zustandsgrößen.
    this._gyroAdr = -1; this._accelAdr = -1;
    try {
      for (let s = 0; s < mod.nsensor; s++) {
        const t = mod.sensor_type[s];
        if (t === 3 && this._gyroAdr < 0) this._gyroAdr = mod.sensor_adr[s];
        else if (t === 1 && this._accelAdr < 0) this._accelAdr = mod.sensor_adr[s];
      }
    } catch (e) { /* keine Sensor-Views */ }

    // Fuß-Geoms auflösen (cfg.footBodies = Body-Namen) → Kontakt-Erkennung
    this.nFeet = 0;
    this._geomFoot = null;
    if (Array.isArray(this.cfg.footBodies) && this.cfg.footBodies.length) {
      this.nFeet = this.cfg.footBodies.length;
      this._geomFoot = new Int32Array(this.ngeom).fill(-1);
      this._footIds = [];
      for (let f = 0; f < this.nFeet; f++) {
        const bid = m.mj_name2id(mod, mjOBJ.BODY, this.cfg.footBodies[f]);
        if (bid < 0) continue;
        this._footIds.push(bid);
        for (let g = 0; g < mod.body_geomnum[bid]; g++) {
          const gid = mod.body_geomadr[bid] + g;
          if (mod.geom_contype[gid] !== 0) this._geomFoot[gid] = f;
        }
      }
    }

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

  // ── v2.7.0 SENSORIK (echte Sensordaten für die Beobachtungen) ──

  /**
   * GYRO (3, Körperform): bevorzugt aus dem echten IMU-Sensor
   * (sensordata), Fallback qvel[3:6] — beide sind Körperform
   * (empirisch gegen den Gyro-Sensor verifiziert, Probe A/B/C).
   */
  gyroBody(out) {
    if (this._gyroAdr >= 0) {
      const sd = this.data.sensordata;
      out[0] = sd[this._gyroAdr]; out[1] = sd[this._gyroAdr + 1]; out[2] = sd[this._gyroAdr + 2];
    } else {
      out[0] = this._qvel[3]; out[1] = this._qvel[4]; out[2] = this._qvel[5];
    }
    return out;
  }

  /**
   * ACCELEROMETER (3, Körperform): echte IMU-Beschleunigung
   * (stehend ≈ (0,0,+9,81) — Proper Acceleration). null, wenn kein
   * Sensor im Modell (Beobachtungsplatz bleibt dann 0).
   */
  accelBody(out) {
    if (this._accelAdr < 0) { out[0] = out[1] = out[2] = 0; return out; }
    const sd = this.data.sensordata;
    out[0] = sd[this._accelAdr]; out[1] = sd[this._accelAdr + 1]; out[2] = sd[this._accelAdr + 2];
    return out;
  }

  /**
   * PROJIZIERTE GRAVITATION (3, normiert): R⁳·(0,0,-1) aus der Basis-
   * Quaternion. Aufrecht = (0,0,-1). Entspricht dem fusionierten
   * Gravitationsvektor, den reale IMU-Estimator liefern.
   */
  projectedGravity(out) {
    const o = 4 * this.baseBody;
    const w = this._xquat[o], x = this._xquat[o + 1], y = this._xquat[o + 2], z = this._xquat[o + 3];
    out[0] = -2 * (x * z + w * y);
    out[1] = -2 * (y * z - w * x);
    out[2] = -(1 - 2 * (x * x + y * y));
    return out;
  }

  /**
   * FUSSKONTAKTE (nFeet binär 0/1): echter Kontaktmonitor — ein Kontakt
   * zählt, wenn einer der Kollisionsgeoms des Fußes an einem Kontakt-
   * Punkt beteiligt ist (Boden ODER Hindernis).
   */
  footContacts(out) {
    if (!this._geomFoot) { out[0] = out[1] = 0; return out; }
    for (let f = 0; f < this.nFeet; f++) out[f] = 0;
    const ncon = this.data.ncon;
    const contact = this.data.contact;
    for (let i = 0; i < ncon; i++) {
      const c = contact.get(i);
      const f1 = this._geomFoot[c.geom1];
      if (f1 >= 0) out[f1] = 1;
      const f2 = this._geomFoot[c.geom2];
      if (f2 >= 0) out[f2] = 1;
    }
    return out;
  }

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

  /**
   * Zufälliger horizontaler Schubs in Richtung dir ('auto'|'fwd'|'back'|'left'|'right') — relativ zur BLICKRICHTUNG des Roboters.
   * v2.5.0: Die Stärke ist ROBOTERUNABHÄNGIG als Geschwindigkeitssprung
   * definiert — Δv = strength m/s (vorher strength×12 N·s, was beim ~35 kg
   * schweren G1 nur Δv ≈ 0,5 m/s ergab — „Schubsen geht nicht").
   * strength 3 ≈ kräftiger Ruck (Δv 3 m/s), strength 10 ≈ Full-Check.
   */
  pushRandom(dir = 'auto', strength = 3) {
    const az = dir === 'auto' ? Math.random() * Math.PI * 2
      : dir === 'fwd' ? 0 : dir === 'back' ? Math.PI
        : dir === 'left' ? Math.PI / 2 : -Math.PI / 2;
    // Blickrichtung (Yaw) der Basis aus der Quaternion (w,x,y,z)
    const o = 4 * this.baseBody;
    const qw = this._xquat[o], qx = this._xquat[o + 1], qy = this._xquat[o + 2], qz = this._xquat[o + 3];
    const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    const a = az + yaw;
    const mass = this._totalMass || (this._totalMass = (() => {
      let s = 0;
      for (let b = 0; b < this.nbody; b++) s += this.model.body_mass[b];
      return s > 1 ? s : 20;
    })());
    const j = strength * mass; // N·s — Impuls = Δv × Gesamtmasse
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
   * v2.28.0 BODEN-GARANTIE für die Geist-ANZEIGE: hängt die Referenz-Pose
   * (z. B. ARDY-Höhendrift über Autoregressions-Fenster) mit Fußpunkten
   * UNTER dem Boden, wird die Basis so weit angehoben, dass der tiefste
   * Fuß bei 0 steht. Nur Anzeige/BC — die trainierte Höhe bleibt clip.h.
   * @param ghost Ergebnis von makeGhostData() NACH setGhostPose
   * @param footGeoms Ergebnis von findFootGeoms(sim) ({body, lowZ})
   * @param tol Toleranz (m) — bis hierhin gilt „steht auf dem Boden“
   * @returns Angehobene Höhe in m (0 = kein Eingriff)
   */
  groundGhost(ghost, footGeoms, tol = 0.015) {
    if (!footGeoms || !footGeoms.length) return 0;
    let lowest = 0;
    for (const fg of footGeoms) {
      const z = ghost.xpos[3 * fg.body + 2] + fg.lowZ;
      if (Number.isFinite(z) && z < lowest) lowest = z;
    }
    if (lowest > -tol) return 0;
    const adr = this._baseQposAdr || (this._baseQposAdr = (() => {
      const m = this.model;
      return m.jnt_qposadr[m.body_jntadr[this.baseBody]];
    })());
    ghost.qpos[adr + 2] -= lowest; // heben (lowest ist negativ)
    this._mjApi.mj_forward(this.model, ghost);
    return -lowest;
  }

  /**
   * Setzt die echte Basis (nach reset) horizontal auf (x, y) mit Blick yaw —
   * Höhe/Blick des Keyframes bleiben sonst erhalten. Der Roboter startet
   * damit AUF der Referenz-Bahn statt im Ursprung.
   */
  placeBase(x, y, yaw = 0) {
    const adr = this._baseQposAdr2 || (this._baseQposAdr2 = this._baseQposAdrOf());
    this._qpos[adr] = x; this._qpos[adr + 1] = y;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    this._qpos[adr + 3] = cy; this._qpos[adr + 4] = 0; this._qpos[adr + 5] = 0; this._qpos[adr + 6] = sy;
    this._mjApi.mj_forward(this.model, this.data);
  }

  _baseQposAdrOf() {
    const m = this.model;
    return m.jnt_qposadr[m.body_jntadr[this.baseBody]];
  }
  _baseDofAdrOf() {
    const m = this.model;
    return m.jnt_dofadr[m.body_jntadr[this.baseBody]];
  }

  /**
   * Basis KOMPLETT versetzen (v2.7.0): Position (x, y, z), volle
   * Orientierung als Quaternion (w, x, y, z — MuJoCo-qpos-Konvention)
   * und Basis-Geschwindigkeiten auf null. Danach mj_forward.
   * Grundlage für die Aufstehen-/Abwurf-Szenarien (recoverytask.js) und
   * für Plugins (api.teleport — „Roboter von oben runter werfen").
   *
   * v2.9.0 BUGFIX „Roboter steht auf der Decke des Bodens": Nach dem
   * Versetzen wird die Basis automatisch so weit ANGEBEBEN, dass kein
   * fester Geom mehr unter der Bodenebene (z=0) hängt. Liegende/gekippte
   * Startposen hingen sonst mit Kopf/Armen IM Boden → Kontakt-Explosion,
   * NaN-Beobachtungen, Stummer Teleport zur Keyframe-Pose.
   */
  placeBaseFull(x, y, z, qw = 1, qx = 0, qy = 0, qz = 0) {
    const adr = this._baseQposAdr2 || (this._baseQposAdr2 = this._baseQposAdrOf());
    this._qpos[adr] = x; this._qpos[adr + 1] = y; this._qpos[adr + 2] = z;
    const n = Math.hypot(qw, qx, qy, qz) || 1;
    this._qpos[adr + 3] = qw / n; this._qpos[adr + 4] = qx / n;
    this._qpos[adr + 5] = qy / n; this._qpos[adr + 6] = qz / n;
    const dadr = this._baseDofAdr2 || (this._baseDofAdr2 = this._baseDofAdrOf());
    for (let i = 0; i < 6; i++) this._qvel[dadr + i] = 0; // freies Gelenk: 6 Dofs
    this._mjApi.mj_forward(this.model, this.data);
    this.settleAboveGround();
  }

  /**
   * v2.9.0: Tiefster Punkt aller Roboter-eigenen festen Geoms (Welt-Z) —
   * EXAKT (keine konservativen Schranken): Primitive über geschlossene
   * Stützformeln, MESHes über echte Vertex-Transformation (mesh_vert =
   * dieselbe Kollisionsgeometrie, die MuJoCo nutzt). Nur Roboter-Bodies
   * (Teilbaum unter baseBody) — die Testfeld-Deko (Rampen/Mauern, teils
   * unterhalb z=0 verankert) zählt nicht.
   *
   * collisionOnly=true (für settleAboveGround): nur Kollisions-Geoms —
   * das ist die PHYSIK-Wahrheit. Vereinfachte Kollisions-Hulls (z. B.
   * Microduck-Gehäuse) lassen die detaillierteren Visual-Meshes um wenige
   * cm überstehen — kosmetisch, von der Physik nicht beeinflussbar.
   * Begründung: liegend/kopfüber gesetzte Roboter hingen vorher mit
   * Kopf/Armen im Boden → Kontakt-Explosion → NaN → stiller Teleport
   * („Roboter steht auf der Decke des Bodens", „wurde zurück teleportiert").
   */
  minGeomZ(collisionOnly = false) {
    const mod = this.model, dat = this.data;
    let minZ = Infinity;
    for (let g = 0; g < this.ngeom; g++) {
      const body = mod.geom_bodyid[g];
      if (body === 0) continue;             // Welt
      if (this._robotBody && !this._robotBody[body]) continue; // Szene-Deko
      // collisionOnly: nur Geoms, die mit dem BODEN (contype/conaffinity 1)
      // kollidieren KÖNNEN (MuJoCo-Paar-Regel: (c1&ca2)||(c2&ca1)). Geoms in
      // Selbstkollisions-Familien (z. B. contype=2) berühren den Boden nie
      // und sinken von der Physik bewusst ignoriert etwas ein.
      if (collisionOnly && !(mod.geom_contype[g] & 1) && !(mod.geom_conaffinity[g] & 1)) continue; // Visual-only / Selbstkollision
      const t = mod.geom_type[g];
      if (t === 0 || t === 1) continue;     // PLANE/HFIELD = Boden selbst
      // Welt-Z-Achse des Geoms = dritte Zeile von geom_xmat (row-major)
      const R20 = dat.geom_xmat[9 * g + 2], R21 = dat.geom_xmat[9 * g + 5], R22 = dat.geom_xmat[9 * g + 8];
      const gz = dat.geom_xpos[3 * g + 2];
      let z;
      if (t === 2) {                                          // SPHERE
        z = gz - mod.geom_size[3 * g];
      } else if (t === 3) {                                   // CAPSULE
        z = gz - (Math.abs(R22) * mod.geom_size[3 * g + 1] + mod.geom_size[3 * g]);
      } else if (t === 4) {                                   // ELLIPSOID
        const a = mod.geom_size[3 * g], b = mod.geom_size[3 * g + 1], c = mod.geom_size[3 * g + 2];
        z = gz - Math.sqrt((R20 * a) * (R20 * a) + (R21 * b) * (R21 * b) + (R22 * c) * (R22 * c));
      } else if (t === 5) {                                   // CYLINDER
        const r = mod.geom_size[3 * g], h = mod.geom_size[3 * g + 1];
        z = gz - (Math.abs(R22) * h + Math.sqrt(R20 * R20 + R21 * R21) * r);
      } else if (t === 6) {                                   // BOX (exakt)
        const s0 = mod.geom_size[3 * g], s1 = mod.geom_size[3 * g + 1], s2 = mod.geom_size[3 * g + 2];
        z = gz - (Math.abs(R20) * s0 + Math.abs(R21) * s1 + Math.abs(R22) * s2);
      } else {
        // MESH (7) & Sonstiges: echte Vertices transformieren — exakt.
        let did = -1;
        try { did = mod.geom_dataid[g]; } catch (e) { /* kein Mesh-Zugriff */ }
        let done = false;
        if (did >= 0 && mod.mesh_vertadr && mod.mesh_vertnum && mod.mesh_vert) {
          const vAdr = mod.mesh_vertadr[did], vNum = mod.mesh_vertnum[did];
          if (vNum > 0 && vNum < 200000) {
            const px = dat.geom_xpos[3 * g], py = dat.geom_xpos[3 * g + 1], pz = dat.geom_xpos[3 * g + 2];
            const R00 = dat.geom_xmat[9 * g], R01 = dat.geom_xmat[9 * g + 1];
            const R10 = dat.geom_xmat[9 * g + 3], R11 = dat.geom_xmat[9 * g + 4];
            let mn = Infinity;
            for (let i = 0; i < vNum; i++) {
              const vx = mod.mesh_vert[3 * (vAdr + i)], vy = mod.mesh_vert[3 * (vAdr + i) + 1], vz = mod.mesh_vert[3 * (vAdr + i) + 2];
              const wz = pz + R20 * vx + R21 * vy + R22 * vz;
              if (wz < mn) mn = wz;
              void px; void py; void R00; void R01; void R10; void R11; // (nur Z nötig)
            }
            if (Number.isFinite(mn)) { z = mn; done = true; }
          }
        }
        if (!done) {
          // Fallback: AABB (Mitte + halbe Größe, lokal) rotieren
          const ab = mod.geom_aabb;
          const cx = ab ? ab[6 * g] : NaN, cy = ab ? ab[6 * g + 1] : NaN, cz = ab ? ab[6 * g + 2] : NaN;
          const hx = ab ? ab[6 * g + 3] : NaN, hy = ab ? ab[6 * g + 4] : NaN, hz2 = ab ? ab[6 * g + 5] : NaN;
          if (Number.isFinite(cx) && Math.abs(cx) < 10 && Math.abs(cy) < 10 && Math.abs(cz) < 10
            && Number.isFinite(hx) && Math.abs(hx) < 10 && Math.abs(hy) < 10 && Math.abs(hz2) < 10) {
            const cWorldZ = gz + R20 * cx + R21 * cy + R22 * cz;
            z = cWorldZ - (Math.abs(R20) * hx + Math.abs(R21) * hy + Math.abs(R22) * hz2);
          } else {
            z = gz - (mod.geom_rbound ? mod.geom_rbound[g] : 0.05);
          }
        }
      }
      if (z < minZ) minZ = z;
    }
    return Number.isFinite(minZ) ? minZ : 0;
  }

  /**
   * Hebt die Basis an, bis der tiefste feste KOLLISIONS-Geom ≥ margin über
   * dem Boden ist (oder schon immer darüber war — dann No-Op). NIEMALS
   * absenken: Abwurf/Kopfstand dürfen in der Luft starten.
   */
  settleAboveGround(margin = 0.004) {
    const minZ = this.minGeomZ(true); // Physik-Wahrheit (Kollision)
    const lift = margin - minZ;
    if (lift > 1e-9) {
      const adr = this._baseQposAdr2 || (this._baseQposAdr2 = this._baseQposAdrOf());
      this._qpos[adr + 2] += lift;
      this._mjApi.mj_forward(this.model, this.data);
      return lift;
    }
    return 0;
  }
}
