// ═══════════════════════════════════════════════════════════
// glbscene.js — Original-3D-Modell als Lehrer-Ghost.
// Baut aus einer GLB-Datei (geparst via GlbClip) eine Three.js-Szene
// MIT Skinning: Knochen-Hierarchie, inverse Bind-Matrizen aus der Datei,
// gewichtete Meshes. Angetrieben wird die Szene vom eigenen
// GlbClip-Sampler (setTime) — dadurch funktionieren auch assimp-Dateien
// mit zusammengeführten Fragment-Animationen.
// Ziel (Nutzerwunsch): Die Animation wird vom ORIGINAL-Modell gezeigt
// („es reicht, wenn sie vom originalen 3D-Modell gemacht wird") — der
// Roboter muss die Bewegung nicht selbst vorführen, er lernt nur davon.
// Alles Best-Effort: Bei fehlenden Meshes/DRACO/etc. wird null
// zurückgegeben und die App zeigt die Skelett-Lehrerfigur.
// ═══════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.js';

export function buildGlbScene(clip) {
  try {
    const g = clip.gltf;
    const nodes = g.nodes || [];
    if (!(g.meshes && g.meshes.length) || !(g.skins && g.skins.length)) return null;

    // ── Knoten-Objekte (Bone wenn Joint, sonst Group) ─────────
    const jointSet = new Set();
    for (const skin of g.skins) for (const j of skin.joints || []) jointSet.add(j);
    const objects = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const o = jointSet.has(i) ? new THREE.Bone() : new THREE.Group();
      o.name = n.name || ('node' + i);
      applyNodeTransform(o, n);
      objects[i] = o;
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const c of n.children || []) {
        if (objects[c] && objects[c].parent === null) objects[i].add(objects[c]);
      }
    }
    const sceneIdx = g.scene || 0;
    const roots = (g.scenes && g.scenes[sceneIdx] && g.scenes[sceneIdx].nodes) || [0];
    const group = new THREE.Group();
    group.name = 'LehrerOriginal';
    for (const r of roots) if (objects[r]) group.add(objects[r]);
    // Joints außerhalb der Szenen-Hierarchie retten (selten, aber möglich)
    for (const j of jointSet) {
      if (objects[j] && objects[j].parent === null) group.add(objects[j]);
    }

    // ── Meshes ────────────────────────────────────────────────────
    const skinnedMeshes = [];
    let meshCount = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.mesh === undefined) continue;
      const meshDef = g.meshes[n.mesh];
      const holder = new THREE.Group();
      holder.name = (n.name || 'mesh') + '_meshes';
      for (const prim of meshDef.primitives || []) {
        const geo = buildGeometry(clip, prim);
        if (!geo) continue;
        const matInfo = g.materials && g.materials[prim.material] || {};
        const pbr = matInfo.pbrMetallicRoughness || {};
        const base = pbr.baseColorFactor || [1, 1, 1, 1];
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(base[0], base[1], base[2]),
          metalness: (pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1) * 0.1,
          roughness: (pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1) * 0.8 + 0.15,
          transparent: base[3] < 0.99, opacity: base[3],
          side: THREE.DoubleSide,
        });
        let meshObj;
        if (n.skin !== undefined) {
          const skinDef = g.skins[n.skin];
          const bones = (skinDef.joints || []).map(j => objects[j]);
          if (bones.some(b => !b)) continue;
          const inverses = readIBMs(clip, skinDef);
          if (!inverses) continue;
          const skeleton = new THREE.Skeleton(bones, inverses);
          meshObj = new THREE.SkinnedMesh(geo, mat);
          meshObj.castShadow = true; meshObj.receiveShadow = false;
          holder.add(meshObj);
          meshObj.bind(skeleton, meshObj.matrixWorld.clone());
          skinnedMeshes.push(meshObj);
        } else {
          meshObj = new THREE.Mesh(geo, mat);
          meshObj.castShadow = true;
          holder.add(meshObj);
        }
        meshCount++;
      }
      if (!holder.children.length) continue;
      objects[i].add(holder);
    }
    if (!meshCount) return null;

    group.updateMatrixWorld(true);
    for (const sm of skinnedMeshes) {
      // BindMatrix auf die Ruhelage fixieren (hierarchisch bereits korrekt)
      sm.bindMatrix.copy(sm.matrixWorld);
      sm.bindMatrixInverse.copy(sm.bindMatrix).invert();
    }

    // ── Animation treiben ─────────────────────────────────────
    const animatedNodes = [];
    for (let i = 0; i < nodes.length; i++) {
      if (clip.rotationTracks.has(i) || clip.translationTracks.has(i)) animatedNodes.push(i);
    }
    const qTmp = [0, 0, 0, 1], pTmp = [0, 0, 0];
    function setTime(t) {
      for (const i of animatedNodes) {
        const o = objects[i];
        clip._localQuat(i, t, qTmp);
        clip._localTrans(i, t, pTmp);
        o.quaternion.set(qTmp[0], qTmp[1], qTmp[2], qTmp[3]);
        o.position.set(pTmp[0], pTmp[1], pTmp[2]);
      }
      group.updateMatrixWorld(true);
      for (const sm of skinnedMeshes) sm.skeleton.update();
    }

    return { group, setTime, meshCount, bones: jointSet.size, skinned: skinnedMeshes.length };
  } catch (e) {
    console.warn('buildGlbScene:', e && e.message);
    return null;
  }
}

function applyNodeTransform(o, n) {
  if (n.matrix) {
    const m = new THREE.Matrix4().fromArray(n.matrix);
    m.decompose(o.position, o.quaternion, o.scale);
    return;
  }
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.set(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]);
  if (n.scale) o.scale.fromArray(n.scale);
}

// Accessor als Float32 lesen (JOINTS/WEIGHTS: RAW ohne sign-Normalisierung)
function readRaw(clip, accIdx) {
  const acc = clip.gltf.accessors[accIdx];
  const bv = clip.gltf.bufferViews[acc.bufferView];
  const compSize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[acc.componentType];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const stride = (bv.byteStride && bv.byteStride > 0) ? bv.byteStride : nComp * compSize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(clip.bin.buffer, clip.bin.byteOffset + base, clip.bin.byteLength - base);
  const out = new Float32Array(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nComp; c++) {
      const p = i * stride + c * compSize;
      out[i * nComp + c] = acc.componentType === 5126 ? dv.getFloat32(p, true)
        : acc.componentType === 5121 ? dv.getUint8(p)
        : acc.componentType === 5123 ? dv.getUint16(p, true)
        : acc.componentType === 5125 ? dv.getUint32(p, true)
        : dv.getFloat32(p, true);
    }
  }
  return { data: out, nComp, count: acc.count, normalized: !!acc.normalized };
}

function readIBMs(clip, skinDef) {
  if (skinDef.inverseBindMatrices === undefined) return null;
  const acc = clip.gltf.accessors[skinDef.inverseBindMatrices];
  if (acc.type !== 'MAT4') return null;
  const { data } = readRaw(clip, skinDef.inverseBindMatrices);
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const m = new THREE.Matrix4();
    m.fromArray(data, i * 16); // glTF & three: column-major
    out.push(m);
  }
  return out;
}

function buildGeometry(clip, prim) {
  const attrs = prim.attributes || {};
  if (attrs.POSITION === undefined) return null;
  const pos = readRaw(clip, attrs.POSITION);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.data, 3));
  if (attrs.NORMAL !== undefined) {
    const nor = readRaw(clip, attrs.NORMAL);
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.data, 3));
  } else {
    geo.computeVertexNormals();
  }
  if (attrs.TEXCOORD_0 !== undefined) {
    const uv = readRaw(clip, attrs.TEXCOORD_0);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.data, 2));
  }
  if (attrs.JOINTS_0 !== undefined && attrs.WEIGHTS_0 !== undefined) {
    const j = readRaw(clip, attrs.JOINTS_0);
    const w = readRaw(clip, attrs.WEIGHTS_0);
    if (j.nComp === 4 && w.nComp === 4) {
      // Gewichte auf Summe 1 normalisieren — deckt float-Gewichte UND
      // normalisierte u8/u16-Rohwerte ab (Verhältnis bleibt erhalten).
      const wn = w.data.slice();
      for (let i = 0; i < w.count; i++) {
        let s = 0;
        for (let c = 0; c < 4; c++) s += wn[i * 4 + c];
        s = s || 1;
        for (let c = 0; c < 4; c++) wn[i * 4 + c] /= s;
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(j.data, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(wn, 4));
    }
  }
  if (prim.indices !== undefined) {
    const idx = readRaw(clip, prim.indices);
    const maxI = pos.count;
    const arr = maxI > 65535 ? new Uint32Array(idx.data) : new Uint16Array(idx.data);
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  } else {
    // nicht-indiziert: 3 Vertices = 1 Dreieck
    const n = pos.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  geo.computeBoundingSphere();
  return geo;
}
