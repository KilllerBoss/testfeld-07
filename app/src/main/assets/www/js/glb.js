// ═══════════════════════════════════════════════════════════
// glb.js — GLB/glTF-Animation-Import (binär, ohne Abhängigkeiten).
// Liest Knoten-Hierarchie + Rotationskanäle und liefert pro Frame
// WELT-Quaternionen je Knochen (für das Retargeting auf G1).
// ═══════════════════════════════════════════════════════════

export class GlbClip {
  /**
   * @param {ArrayBuffer} buffer  GLB-Datei
   */
  constructor(buffer) {
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

    // Hierarchie: name → node, parent-Map
    this.nodes = json.nodes || [];
    this.byName = {};
    this.parentOf = new Map();
    this.nodes.forEach((n, i) => {
      const key = (n.name || ('node_' + i)).toLowerCase();
      this.byName[key] = i;
      (n.children || []).forEach(c => this.parentOf.set(c, i));
    });

    // Erste Animation nehmen
    if (!json.animations || !json.animations.length) throw new Error('GLB ohne Animationen');
    this.anim = json.animations[0];
    this.name = (json.animations[0].name || 'clip');

    // Sampler dekodieren: je Kanal (node, path) → Zeitreihe
    this.rotationTracks = new Map();  // nodeIdx → {times: Float32Array, quats: Float32Array (n*4)}
    this.translationTracks = new Map();
    for (const ch of this.anim.channels) {
      const target = ch.target || {};
      if (target.path !== 'rotation' && target.path !== 'translation') continue;
      const sampler = this.anim.samplers[ch.sampler];
      const times = this._accessorFloat(sampler.input);
      const values = this._accessorFloat(sampler.output);
      const map = target.path === 'rotation' ? this.rotationTracks : this.translationTracks;
      map.set(target.node, { times, values, interp: sampler.interpolation || 'LINEAR' });
    }
    if (!this.rotationTracks.size) throw new Error('Animation ohne Rotationskanäle');

    // Dauer
    let dur = 0;
    for (const t of this.rotationTracks.values()) dur = Math.max(dur, t.times[t.times.length - 1] || 0);
    this.duration = dur || 1;
    this.fpsHint = this.duration > 0 ? Math.min(60, Math.max(15, Math.round(this.rotationTracks.values().next().value.times.length / this.duration))) : 30;
  }

  _accessorFloat(accIdx) {
    const acc = this.gltf.accessors[accIdx];
    const bv = this.gltf.bufferViews[acc.bufferView];
    const compSize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[acc.componentType];
    const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
    const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;
    const out = new Float32Array(count * nComp);
    const dv = new DataView(this.bin.buffer, this.bin.byteOffset + start, count * nComp * compSize);
    for (let i = 0; i < count * nComp; i++) {
      out[i] = acc.componentType === 5126 ? dv.getFloat32(i * 4, true)
        : acc.componentType === 5121 ? dv.getUint8(i)
        : acc.componentType === 5123 ? dv.getUint16(i * 2, true)
        : dv.getUint32(i * 4, true);
    }
    return out;
  }

  hasNode(name) { return this.byName[name.toLowerCase()] !== undefined; }
  nodeId(name) { return this.byName[name.toLowerCase()]; }

  // Lokale Rotation eines Knotens zur Zeit t (Quaternion [x,y,z,w] wie glTF → wir nutzen [x,y,z,w] durchgängig hier)
  _localQuat(nodeIdx, t, out) {
    const node = this.nodes[nodeIdx];
    const track = this.rotationTracks.get(nodeIdx);
    if (!track) { const r = node.rotation || [0, 0, 0, 1]; out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; out[3] = r[3]; return out; }
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
    if (!track) { const p = node.translation || [0, 0, 0]; out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
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
  // keine geteilten Temperäre (Rekursions-Clobbering-Falle).
  sampleWorld(t, wantedNames, outWorld) {
    outWorld.clear(); // Ausgabe-Map ist AUSSCHLIESSLICH Output (kein Frame-Cache!)
    // Alle benötigten Knoten (Ziele + Vorfahren) sammeln
    const needed = new Set();
    for (const name of wantedNames) {
      let idx = this.byName[name.toLowerCase()];
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
    const idx = this.byName[hipsName.toLowerCase()];
    if (idx === undefined) return 0.8;
    const p = [0, 0, 0];
    this._localTrans(idx, t, p);
    return p[1]; // Mixamo: Y-up, Hüft-Höhe in cm oder m — Retargeting skaliert
  }
}

// Quaternion-Multikation [x,y,z,w]
export function quatMul(a, b, out) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

// Quaternion konjugiert anwenden: v' = q* ⊙ (0,v) ⊙ q  → rotiere v mit q⁻¹
export function quatRotInv(q, v, out) {
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = w * vx + y * vz - z * vy;
  const ty = w * vy + z * vx - x * vz;
  const tz = w * vz + x * vy - y * vx;
  const tw = -(x * vx + y * vy + z * vz);
  out[0] = tw * x + tx * w + ty * z - tz * y;
  out[1] = tw * y + ty * w + tz * x - tx * z;
  out[2] = tw * z + tz * w + tx * y - ty * x;
  return out;
}

// Rotiere v mit Quaternion q (vorwärts)
export function quatRot(q, v, out) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = w * vx + y * vz - z * vy;
  const ty = w * vy + z * vx - x * vz;
  const tz = w * vz + x * vy - y * vx;
  const tw = -(x * vx + y * vy + z * vz);
  out[0] = tw * x + tx * w + ty * z - tz * y;
  out[1] = tw * y + ty * w + tz * x - tx * z;
  out[2] = tw * z + tz * w + tx * y - ty * x;
  return out;
}
