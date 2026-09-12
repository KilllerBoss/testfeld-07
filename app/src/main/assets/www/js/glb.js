// ═══════════════════════════════════════════════════════════
// glb.js — GLB/glTF-Animation-Import (binär, ohne Abhängigkeiten).
// Universell: Mixamo (mit/ohne Präfix), Cartwheel (forge fbx_to_glb),
// Unity/Unreal/VRM-Exports — über Namens-Normalisierung statt exaktem
// Matching. Liest ALLE Animationen (wahlweise), CUBICSPLINE- und
// Interleaved-bufferView-Sampler inklusive. Liefert pro Frame
// WELT-Quaternionen je Knochen (für das Retargeting auf G1).
// ═══════════════════════════════════════════════════════════

// Name normalisieren: klein, nur [a-z0-9] — 'mixamorig:LeftUpLeg',
// 'Upper_Leg_L.001' und 'left up leg' landen auf vergleichbaren Keys.
export function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class GlbClip {
  /**
   * @param {ArrayBuffer} buffer  GLB-Datei
   * @param {number} animIndex    Index der Animation (default 0)
   */
  constructor(buffer, animIndex = 0) {
    const head = new DataView(buffer);
    if (head.getUint32(0, true) !== 0x46546c67) throw new Error('Keine GLB-Datei (Magie fehlt)');
    const version = head.getUint32(4, true);
    if (version !== 2) throw new Error('Nur glTF 2.0 (GLB) unterstützt, Version: ' + version);

    // Chunks lesen
    let off = 12;
    let json = null, bin = null;
    while (off < buffer.byteLength) {
      const len = head.getUint32(off, true);
      const type = head.getUint32(off + 4, true);
      const chunk = new Uint8Array(buffer, off + 8, len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
    if (!json) throw new Error('GLB ohne JSON-Chunk');
    this.gltf = json;
    this.bin = bin;

    // Hierarchie: normalisierter Name → [Knoten], parent-Map
    this.nodes = json.nodes || [];
    this.byName = {};       // erster Treffer (Kompatibilität)
    this.byNameAll = {};    // alle Treffer (Resolver wählt animierten)
    this.parentOf = new Map();
    this.nodes.forEach((n, i) => {
      const key = normName(n.name || ('node' + i));
      if (!key) return;
      if (this.byName[key] === undefined) this.byName[key] = i;
      (this.byNameAll[key] || (this.byNameAll[key] = [])).push(i);
      (n.children || []).forEach(c => this.parentOf.set(c, i));
    });

    // Animationen: Liste + Auswahl
    if (!json.animations || !json.animations.length) throw new Error('GLB ohne Animationen');
    this.mergedFrom = 0;
    this._maybeMergeFragments(); // assimp-FBX-Exporte: 1 Mini-Animation je Knochen → 1 Clip
    this.animations = json.animations.map((a, i) => ({
      index: i,
      name: a.name || ('Animation ' + (i + 1)),
      duration: _animDuration(json, a),
    }));
    this.rotationTracks = new Map();  // nodeIdx → {times, quats (n*4)}
    this.translationTracks = new Map();
    this._decoded = new Map();        // animIndex → {rotationTracks, translationTracks}
    this.useAnimation(animIndex);
  }

  //-andere Animation desselben Clips aktivieren (Kanäle neu dekodieren)
  useAnimation(animIndex = 0) {
    if (animIndex < 0 || animIndex >= this.animations.length) throw new Error('Animation ' + animIndex + ' existiert nicht (' + this.animations.length + ' vorhanden)');
    this.animIndex = animIndex;
    this.anim = this.gltf.animations[animIndex];
    this.name = this.animations[animIndex].name;
    if (this._decoded.has(animIndex)) {
      const d = this._decoded.get(animIndex);
      this.rotationTracks = d.rotationTracks;
      this.translationTracks = d.translationTracks;
    } else {
      const rot = new Map(), tra = new Map();
      for (const ch of this.anim.channels) {
        const target = ch.target || {};
        if (target.path !== 'rotation' && target.path !== 'translation') continue;
        if (target.node === undefined || target.node === null) continue;
        const sampler = this.anim.samplers[ch.sampler];
        const interp = sampler.interpolation || 'LINEAR';
        const times = this._accessorFloat(sampler.input);
        const values = this._accessorFloat(sampler.output);
        // CUBICSPLINE: je Keyframe [inTangens, Wert, outTangens] → Wert extrahieren
        let vals = values, ts = times;
        if (interp === 'CUBICSPLINE') {
          const nComp = target.path === 'rotation' ? 4 : 3;
          const K = times.length;
          const mid = new Float32Array(K * nComp);
          for (let k = 0; k < K; k++) {
            for (let c = 0; c < nComp; c++) mid[k * nComp + c] = values[(3 * k + 1) * nComp + c];
          }
          vals = mid;
        }
        const map = target.path === 'rotation' ? rot : tra;
        map.set(target.node, { times: ts, values: vals, interp });
      }
      this._decoded.set(animIndex, { rotationTracks: rot, translationTracks: tra });
      this.rotationTracks = rot;
      this.translationTracks = tra;
    }
    if (!this.rotationTracks.size) throw new Error('Animation "' + this.name + '" ohne Rotationskanäle');

    // Dauer
    let dur = 0;
    for (const t of this.rotationTracks.values()) dur = Math.max(dur, t.times[t.times.length - 1] || 0);
    this.duration = dur || 1;
    const first = this.rotationTracks.values().next().value;
    this.fpsHint = this.duration > 0 ? Math.min(60, Math.max(15, Math.round(first.times.length / this.duration))) : 30;
    return this;
  }

  // Assimp-FBX-Konvertierungen (Mixamo & Co.) zerlegen einen Take in
  // VIELE Mini-Animationen (je Knochen eine, alle gleiche Dauer, ≤4 Kanäle).
  // Ohne Merge würde nur Fragment 0 gespielt (oft nur der Kopf) — die
  // Figur bliebe praktisch in der Ruhepose. Wir führen alle Fragmente zu
  // EINEM Clip zusammen (Index 0); die Originale bleiben erreichbar.
  _maybeMergeFragments() {
    const anims = this.gltf.animations || [];
    if (anims.length < 3) return false;
    const durs = anims.map(a => _animDuration(this.gltf, a));
    const d0 = durs[0], tol = Math.max(0.05, 0.02 * d0);
    for (const d of durs) if (Math.abs(d - d0) > tol) return false; // echte Multi-Take-Datei
    for (const a of anims) {
      const cn = (a.channels || []).length;
      if (cn === 0 || cn > 4) return false; // echte Clips haben viele Kanäle
    }
    const samplers = [], channels = [];
    for (const a of anims) {
      const base = samplers.length;
      for (const s of a.samplers || []) samplers.push(s);
      for (const ch of a.channels || []) {
        channels.push({ sampler: base + ch.sampler, target: ch.target });
      }
    }
    const merged = { name: 'Vollständig (' + anims.length + ' Fragmente zusammengeführt)', samplers, channels };
    // Fragmente KOMPLETT ersetzen — sie sind Einzelknochen-Trümmer, die
    // als „Animationen" nur Müll-Clips erzeugen würden.
    this.gltf.animations = [merged];
    this.mergedFrom = anims.length;
    return true;
  }

  // Vollständige Vorwärtskinematik: WELT-Position UND WELT-Quaternion je
  // Knoten (inkl. aller animierter Zwischenknoten wie assimp-$-Fragmente).
  // outQ/outP: Map nodeIdx → [x,y,z,w] bzw. [x,y,z] — reine Ausgaben.
  sampleWorldFull(t, wantedNames, outQ, outP) {
    outQ.clear(); outP.clear();
    const needed = new Set();
    for (const name of wantedNames) {
      let idx = this.byName[normName(name)];
      if (idx === undefined) continue;
      while (idx !== undefined && !needed.has(idx)) { needed.add(idx); idx = this.parentOf.get(idx); }
    }
    for (const idx of needed) {
      if (outQ.has(idx)) continue;
      const chain = [];
      let cur = idx;
      while (cur !== undefined && !outQ.has(cur)) { chain.push(cur); cur = this.parentOf.get(cur); }
      chain.reverse();
      for (const node of chain) {
        const parent = this.parentOf.get(node);
        const q = this._localQuat(node, t, [0, 0, 0, 1]);
        const p = this._localTrans(node, t, [0, 0, 0]);
        if (parent === undefined || !outQ.has(parent)) {
          outQ.set(node, q); outP.set(node, p);
        } else {
          const pp = outP.get(parent), pq = outQ.get(parent);
          const wp = quatRot(pq, p, [0, 0, 0]);
          wp[0] += pp[0]; wp[1] += pp[1]; wp[2] += pp[2];
          outP.set(node, wp);
          outQ.set(node, quatMul(pq, q, [0, 0, 0, 1]));
        }
      }
    }
    return { q: outQ, p: outP };
  }

  _accessorFloat(accIdx) {
    const acc = this.gltf.accessors[accIdx];
    const bv = this.gltf.bufferViews[acc.bufferView];
    const compSize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[acc.componentType];
    const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
    const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : nComp * compSize;
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;
    const out = new Float32Array(count * nComp);
    // dv startet bei bin+base → Element-Positionen RELATIV: i*stride + c*compSize
    const dv = new DataView(this.bin.buffer, this.bin.byteOffset + base, this.bin.byteLength - base);
    for (let i = 0; i < count; i++) {
      const el = i * stride;
      for (let c = 0; c < nComp; c++) {
        const p = el + c * compSize;
        out[i * nComp + c] = acc.componentType === 5126 ? dv.getFloat32(p, true)
          : acc.componentType === 5121 ? dv.getUint8(p)
          : acc.componentType === 5123 ? dv.getUint16(p, true)
          : acc.componentType === 5125 ? dv.getUint32(p, true)
          : dv.getFloat32(p, true);
        if (acc.normalized && acc.componentType !== 5126) out[i * nComp + c] = out[i * nComp + c] / (acc.componentType === 5121 ? 255 : 65535) * 2 - 1;
      }
    }
    return out;
  }

  hasNode(name) { return this.byName[normName(name)] !== undefined; }
  nodeId(name) { return this.byName[normName(name)]; }

  // Alle Knoten-Indices zu einem (normalisierten) Namen; animierte bevorzugt.
  nodesFor(name) { return this.byNameAll[normName(name)] || []; }
  // Besten Kandidaten wählen: bevorzugt Knoten mit Rotations-Track.
  bestNodeFor(name) {
    const cands = this.nodesFor(name);
    if (!cands.length) return undefined;
    for (const c of cands) if (this.rotationTracks.has(c)) return c;
    return cands[0];
  }

  // matrix-basierte Nodes (assimp: _$AssimpFbx$_-Zwischenknoten!) einmalig
  // in TRS zerlegen — ohne das kollabiert die FK-Kette, weil _localQuat/
  // _localTrans dann Identität/Null liefern.
  _decompMatrix(nodeIdx) {
    this._mxCache = this._mxCache || new Map();
    if (this._mxCache.has(nodeIdx)) return this._mxCache.get(nodeIdx);
    const m = this.nodes[nodeIdx].matrix; // column-major (glTF)
    const t = [m[12], m[13], m[14]];
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    // Normalisierte Rotationsmatrix (Spalten)
    const m00 = m[0] / sx, m10 = m[1] / sx, m20 = m[2] / sx;
    const m01 = m[4] / sy, m11 = m[5] / sy, m21 = m[6] / sy;
    const m02 = m[8] / sz, m12 = m[9] / sz, m22 = m[10] / sz;
    const tr = m00 + m11 + m22;
    let qx = 0, qy = 0, qz = 0, qw = 1, S;
    if (tr > 0) {
      S = Math.sqrt(tr + 1) * 2; qw = 0.25 * S;
      qx = (m21 - m12) / S; qy = (m02 - m20) / S; qz = (m10 - m01) / S;
    } else if (m00 > m11 && m00 > m22) {
      S = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / S; qx = 0.25 * S;
      qy = (m01 + m10) / S; qz = (m02 + m20) / S;
    } else if (m11 > m22) {
      S = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / S; qy = 0.25 * S;
      qx = (m01 + m10) / S; qz = (m12 + m21) / S;
    } else {
      S = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / S; qz = 0.25 * S;
      qx = (m02 + m20) / S; qy = (m12 + m21) / S;
    }
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    const out = { t, q: [qx / n, qy / n, qz / n, qw / n], s: [sx, sy, sz] };
    this._mxCache.set(nodeIdx, out);
    return out;
  }

  // Lokale Rotation eines Knotens zur Zeit t (Quaternion [x,y,z,w])
  _localQuat(nodeIdx, t, out) {
    const node = this.nodes[nodeIdx];
    const track = this.rotationTracks.get(nodeIdx);
    if (!track) {
      if (node.rotation) { out[0] = node.rotation[0]; out[1] = node.rotation[1]; out[2] = node.rotation[2]; out[3] = node.rotation[3]; return out; }
      if (node.matrix) { const d = this._decompMatrix(nodeIdx); out[0] = d.q[0]; out[1] = d.q[1]; out[2] = d.q[2]; out[3] = d.q[3]; return out; }
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out;
    }
    const { times, values } = track;
    // binäre Suche
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    const t0 = times[lo], t1 = times[hi];
    const a = lo * 4, b = hi * 4;
    if (t1 <= t0 || track.interp === 'STEP') {
      out[0] = values[a]; out[1] = values[a + 1]; out[2] = values[a + 2]; out[3] = values[a + 3];
    } else {
      const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      // Quaternion-Slerp
      let ax = values[a], ay = values[a + 1], az = values[a + 2], aw = values[a + 3];
      let bx = values[b], by = values[b + 1], bz = values[b + 2], bw = values[b + 3];
      let d = ax * bx + ay * by + az * bz + aw * bw;
      if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
      let s0, s1;
      if (d > 0.9995) { s0 = 1 - u; s1 = u; }
      else {
        const th = Math.acos(Math.min(1, d));
        const sth = Math.sin(th);
        s0 = Math.sin((1 - u) * th) / sth; s1 = Math.sin(u * th) / sth;
      }
      out[0] = s0 * ax + s1 * bx; out[1] = s0 * ay + s1 * by; out[2] = s0 * az + s1 * bz; out[3] = s0 * aw + s1 * bw;
    }
    // Normalisieren
    const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    out[0] /= n; out[1] /= n; out[2] /= n; out[3] /= n;
    return out;
  }

  _localTrans(nodeIdx, t, out) {
    const node = this.nodes[nodeIdx];
    const track = this.translationTracks.get(nodeIdx);
    if (!track) {
      if (node.translation) { out[0] = node.translation[0]; out[1] = node.translation[1]; out[2] = node.translation[2]; return out; }
      if (node.matrix) { const d = this._decompMatrix(nodeIdx); out[0] = d.t[0]; out[1] = d.t[1]; out[2] = d.t[2]; return out; }
      out[0] = 0; out[1] = 0; out[2] = 0; return out;
    }
    const { times, values } = track;
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    const a = lo * 3, b = hi * 3;
    const t0 = times[lo], t1 = times[hi];
    if (t1 <= t0) { out[0] = values[a]; out[1] = values[a + 1]; out[2] = values[a + 2]; return out; }
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    out[0] = values[a] * (1 - u) + values[b] * u;
    out[1] = values[a + 1] * (1 - u) + values[b + 1] * u;
    out[2] = values[a + 2] * (1 - u) + values[b + 2] * u;
    return out;
  }

  // Welt-Quaternionen aller relevanten Knoten zur Zeit t berechnen.
  // glTF: q = [x,y,z,w]; world = parentWorld ⊙ local. Iterativ je Kette —
  // keine geteilten Temporäre (Rekursions-Clobbering-Falle).
  sampleWorld(t, wantedNames, outWorld) {
    outWorld.clear(); // Ausgabe-Map ist AUSSCHLIESSLICH Output (kein Frame-Cache!)
    // Alle benötigten Knoten (Ziele + Vorfahren) sammeln
    const needed = new Set();
    for (const name of wantedNames) {
      let idx = this.byName[normName(name)];
      if (idx === undefined) continue;
      while (idx !== undefined && !needed.has(idx)) { needed.add(idx); idx = this.parentOf.get(idx); }
    }
    // Bereits bekannte zuerst (Cache in outWorld)
    for (const idx of needed) {
      if (outWorld.has(idx)) continue;
      // Kette von der Wurzel bis idx aufbauen
      const chain = [];
      let cur = idx;
      while (cur !== undefined && !outWorld.has(cur)) { chain.push(cur); cur = this.parentOf.get(cur); }
      chain.reverse();
      for (const node of chain) {
        const parent = this.parentOf.get(node);
        const local = this._localQuat(node, t, [0, 0, 0, 1]);
        if (parent === undefined || !outWorld.has(parent)) {
          outWorld.set(node, [local[0], local[1], local[2], local[3]]);
        } else {
          const pw = outWorld.get(parent);
          outWorld.set(node, [...quatMul(pw, local, [0, 0, 0, 1])]);
        }
      }
    }
    return outWorld;
  }

  // Hüft-Höhe (Translation) zur Zeit t
  sampleHipsHeight(t, hipsName) {
    const idx = this.byName[normName(hipsName)];
    if (idx === undefined) return 0.8;
    const p = [0, 0, 0];
    this._localTrans(idx, t, p);
    return p[1]; // Y-up: Hüft-Höhe in cm oder m — Retargeting skaliert
  }
}

function _animDuration(json, anim) {
  let dur = 0;
  for (const s of anim.samplers || []) {
    const acc = json.accessors[s.input];
    if (acc && acc.max && acc.max[0] > dur) dur = acc.max[0];
  }
  return dur || 1;
}

// Quaternion-Multiplikation [x,y,z,w]
export function quatMul(a, b, out) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

// Rotiere v mit Quaternion q (vorwärts): v' = q ⊗ v ⊗ q*
// (Standard-Sandwich; t = 2·cross(q_xyz, v), v' = v + w·t + q_xyz × t.
//  WICHTIG: Der zweite Faktor ist die KONJUGIERTE — die frühere Version
//  multiplizierte mit q selbst und spiegelte damit alle großen Rotationen!)
export function quatRot(q, v, out) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}

// Rotiere v mit q⁻¹: v' = q* ⊗ v ⊗ q
export function quatRotInv(q, v, out) {
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}
