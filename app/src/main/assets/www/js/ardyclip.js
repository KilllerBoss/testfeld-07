// ═══════════════════════════════════════════════════════════
// ardyclip.js — ARDY-Generierungsergebnis → Retarget-Clip.
//
// Der Decoder von ARDY liefert pro Frame (20 FPS):
//   • posedJoints      — WELT-Positionen aller 27 Gelenke (Meter, Y-up)
//   • globalRotations  — WELT-Rotationen als 3×3-Matrizen (row-major,
//                        M·v, verkettet wie glTF: global = parent·local)
//   • rootPositions    — Weltbahn der Hüfte
//
// Ardychip verpackt das in die Obermenge der GlbClip-Schnittstelle,
// die retargetToG1 braucht (nodes/byName/parentOf/rotationTracks/
// fpsHint/duration/sampleWorldFull) — die Posen werden direkt aus
// den Dekoder-Ausgaben interpoliert (keine FK nötig). Das cskel27-
// Skelett trägt Mixamo-Namen (Hips/Spine/LeftUpLeg/…), die
// BONE_ALIASES von retarget.js lösen es ohne Zusatzarbeit auf.
// ═══════════════════════════════════════════════════════════

import { normName } from './glb.js';

/** 3×3-Rotation (row-major, M·v) → Quaternion [x,y,z,w]. */
export function mat3ToQuat(m) {
  const m00 = m[0], m01 = m[1], m02 = m[2];
  const m10 = m[3], m11 = m[4], m12 = m[5];
  const m20 = m[6], m21 = m[7], m22 = m[8];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s;
    y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  // Kanonisches Vorzeichen (w ≥ 0) gegen Quaternion-Doppelbladchung
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  return [x / len, y / len, z / len, w / len];
}

function quatSlerp(a, b, t, out) {
  let ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  if (d > 0.9995) {
    out[0] = ax + t * (bx - ax); out[1] = ay + t * (by - ay);
    out[2] = az + t * (bz - az); out[3] = aw + t * (bw - aw);
    const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
    return out;
  }
  const th = Math.acos(Math.min(1, Math.max(-1, d)));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  out[0] = wa * ax + wb * bx; out[1] = wa * ay + wb * by;
  out[2] = wa * az + wb * bz; out[3] = wa * aw + wb * bw;
  return out;
}

/**
 * Clip-Adapter für retargetToG1.
 * @param ardyOut Ergebnis von ArdyRuntime.generate()
 */
export class ArdyClip {
  constructor(ardyOut) {
    const names = ardyOut.jointNames;
    this.nodes = names.map((n) => ({ name: n }));
    this.byName = {};
    names.forEach((n, i) => {
      const key = normName(n);
      if (key && this.byName[key] === undefined) this.byName[key] = i;
    });
    this.parentOf = new Map();
    (ardyOut.parents || []).forEach((p, i) => { if (p >= 0) this.parentOf.set(i, p); });
    // Alle Gelenke als animiert markieren (Heuristik-Bonus in resolveBones)
    this.rotationTracks = new Map();
    for (let i = 0; i < names.length; i++) {
      this.rotationTracks.set(i, { times: [0], quats: [0, 0, 0, 1] });
    }
    this.fps = ardyOut.fps || 20;
    this.fpsHint = this.fps;
    this.n = ardyOut.frameCount;
    this.duration = this.n / this.fps;
    this._J = names.length;
    // Welt-Posen je Frame
    this._pos = ardyOut.joints;            // n * J * 3
    this._rotM = ardyOut.globalRotations;  // n * J * 9
    this._quat = new Float32Array(this.n * this._J * 4);
    for (let f = 0; f < this.n; f++) {
      for (let j = 0; j < this._J; j++) {
        const q = mat3ToQuat(this._rotM.subarray((f * this._J + j) * 9, (f * this._J + j) * 9 + 9));
        this._quat.set(q, (f * this._J + j) * 4);
      }
    }
    this.name = 'ARDY: ' + ardyOut.prompt;
    this.prompt = ardyOut.prompt;
    this.seed = ardyOut.seed;
  }

  bestNodeFor(name) { return this.byName[normName(String(name || ''))]; }

  /**
   * Weltpose zur Zeit t (Sekunden) — GlbClip-kompatible Signatur.
   * outQ/outP: Maps nodeIdx → [x,y,z,w] / [x,y,z].
   */
  sampleWorldFull(t, wantedNames, outQ, outP) {
    outQ.clear(); outP.clear();
    const J = this._J;
    // Indexmenge: gewünschte Knoten + deren Elternketten (wie GlbClip)
    const needed = new Set();
    for (const name of wantedNames) {
      let idx = this.byName[normName(name)];
      if (idx === undefined) continue;
      while (idx !== undefined && !needed.has(idx)) { needed.add(idx); idx = this.parentOf.get(idx); }
    }
    const tf = Math.min(this.n - 1, Math.max(0, t * this.fps));
    const f0 = Math.floor(tf);
    const f1 = Math.min(this.n - 1, f0 + 1);
    const fr = tf - f0;
    const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];
    for (const idx of needed) {
      const b0 = f0 * J * 3 + idx * 3, b1 = f1 * J * 3 + idx * 3;
      const p = [
        this._pos[b0] + fr * (this._pos[b1] - this._pos[b0]),
        this._pos[b0 + 1] + fr * (this._pos[b1 + 1] - this._pos[b0 + 1]),
        this._pos[b0 + 2] + fr * (this._pos[b1 + 2] - this._pos[b0 + 2]),
      ];
      qa[0] = this._quat[(f0 * J + idx) * 4]; qa[1] = this._quat[(f0 * J + idx) * 4 + 1]; qa[2] = this._quat[(f0 * J + idx) * 4 + 2]; qa[3] = this._quat[(f0 * J + idx) * 4 + 3];
      qb[0] = this._quat[(f1 * J + idx) * 4]; qb[1] = this._quat[(f1 * J + idx) * 4 + 1]; qb[2] = this._quat[(f1 * J + idx) * 4 + 2]; qb[3] = this._quat[(f1 * J + idx) * 4 + 3];
      outP.set(idx, p);
      outQ.set(idx, quatSlerp(qa, qb, fr, [0, 0, 0, 1]));
    }
    return { q: outQ, p: outP };
  }
}
