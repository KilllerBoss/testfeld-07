// ═══════════════════════════════════════════════════════════
// ghost_ground_v2281_test.mjs — v2.28.1 BODEN-REPARATUR + OVERLAY:
//   ▸ retarget.js groundSrcPosFrame/groundSrcPosTrack (Reparatur alter Clips)
//   ▸ Migration end-to-end: retargetToG1 → srcPos absichtlich gesunken →
//     packMotion → unpackMotion → groundSrcPosTrack → geerdet (min Fuß-z ≥ 0)
//   ▸ render3d Overlay: placeSourceGhostAt setzt die Gruppe so, dass die
//     RELATIVE Hüfte exakt auf dem Geist-Anker landet (Skeleton reitet auf
//     dem Geist — nichts ist mehr auseinander)
//   ▸ Verdrahtungs-Pins: activateClip-Reparatur, ARDY-Standard (joy/folgt),
//     Kollaps-Warnung, Render-Loop-Overlay
// Usage: node scripts/ghost_ground_v2281_test.mjs
// ═══════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('file:')) {
    const p = path.resolve(WWW, decodeURIComponent(url.split('?')[0]));
    const buf = await readFile(p);
    return { ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8') };
  }
  return realFetch(url);
};

const { initEngine, fetchModelIntoFS, writeWorldFile, RobotSim } = await import(path.join(WWW, 'js/engine.js'));
await initEngine(() => {}, { wasmBinary: await readFile(path.join(WWW, 'vendor/mujoco.wasm')) });
const { getRobot } = await import(path.join(WWW, 'js/robots.js'));
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { findFootGeoms, groundSrcPosFrame, groundSrcPosTrack, retargetToG1 } = await import(path.join(WWW, 'js/retarget.js'));
const { ArdyClip } = await import(path.join(WWW, 'js/ardyclip.js'));
const { packMotion, unpackMotion } = await import(path.join(WWW, 'js/glbstore.js'));
const { Renderer3D } = await import(path.join(WWW, 'js/render3d.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + msg + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FEHLER: ' + msg + (extra ? ' — ' + extra : '')); }
};

const cfg = getRobot('g1');
await fetchModelIntoFS('models/' + cfg.dir);
writeWorldFile(cfg.dir, 'welt_ghost281.xml', buildWorldXML(cfg, 'flach', 1, null));
const sim = new RobotSim(cfg, 'welt_ghost281.xml');

console.log('\n[1] groundSrcPosFrame: Einzelframe-Erdung (Füße + Fallback)');
{
  // 3 Rollen, Füße bei −0.25 → Frame wird um 0.25 angehoben
  const roles = ['hips', 'leftFoot', 'rightFoot'];
  const sp = new Float32Array(3 * 3);
  sp[0] = 0; sp[1] = 0; sp[2] = 0.9;      // hips
  sp[3] = 0.1; sp[4] = 0; sp[5] = -0.25;  // leftFoot z = −0.25
  sp[6] = -0.1; sp[7] = 0; sp[8] = -0.1;  // rightFoot z = −0.1
  const dz = groundSrcPosFrame(sp, 0, 3, 1, 2);
  ok(dz > 0.249 && dz < 0.251, 'Lift = tiefer Fußpunkt', 'dz=' + dz.toFixed(3));
  ok(sp[5] > -1e-6 && sp[8] > 0.14, 'beide Füße danach ≥ 0', sp[5].toFixed(3) + '/' + sp[8].toFixed(3));
  ok(sp[2] > 1.14, 'Hüfte mitgehoben', 'z=' + sp[2].toFixed(3));
  // Fallback: Fuß-Rollen NaN → alle Rollen proben
  const sp2 = new Float32Array(3 * 3);
  sp2[0] = 0; sp2[1] = 0; sp2[2] = 0.5;
  sp2[3] = NaN; sp2[4] = 0; sp2[5] = NaN;
  sp2[6] = 0; sp2[7] = 0; sp2[8] = -0.4;
  const dz2 = groundSrcPosFrame(sp2, 0, 3, -1, -1); // Indizes unbekannt → Fallback
  ok(dz2 > 0.399 && dz2 < 0.401, 'Fallback über alle Rollen (NaN-sicher)', 'dz=' + dz2.toFixed(3));
  // Sprung: beide Füße über 0 → KEIN Eingriff
  const sp3 = new Float32Array(3 * 3);
  sp3[2] = 1.2; sp3[5] = 0.3; sp3[8] = 0.25;
  const dz3 = groundSrcPosFrame(sp3, 0, 3, 1, 2);
  ok(dz3 === 0, 'Sprung bleibt unangetastet', 'dz=' + dz3);
}

console.log('\n[2] groundSrcPosTrack: ganze Spur reparieren (Zählung)');
{
  const roles = ['hips', 'leftFoot', 'rightFoot'];
  const FR = 5;
  const sp = new Float32Array(FR * 3 * 3);
  for (let f = 0; f < FR; f++) {
    const o = f * 9;
    sp[o + 2] = 0.9 - f * 0.1;   // hips sinkt 0.9 → 0.5
    sp[o + 5] = -0.05 - f * 0.1; // leftFoot sinkt unter 0 ab Frame 1
    sp[o + 8] = 0.02 - f * 0.1;  // rightFoot
  }
  const lifted = groundSrcPosTrack(sp, FR, roles);
  ok(lifted === 5, 'alle 5 Frames angehoben', 'lifted=' + lifted);
  let minZ = Infinity;
  for (let f = 0; f < FR; f++) for (const gi of [1, 2]) minZ = Math.min(minZ, sp[(f * 3 + gi) * 3 + 2]);
  ok(minZ > -1e-6, 'danach kein Fuß unter 0', 'minZ=' + minZ.toFixed(4));
}

console.log('\n[3] Migration end-to-end: retarget → gesunken → pack/unpack → Reparatur');
{
  // Synthetisches ARDY-Skelett (wie v2.28.0-Test), OHNE Sinken generiert
  const names = ['Hips', 'Spine', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
  const J = names.length, FR = 12;
  const joints = new Float32Array(FR * J * 3);
  const base = {
    Hips: [0, 0.6, 0], Spine: [0, 0.75, 0], Head: [0, 0.9, 0],
    LeftUpLeg: [0.1, 0.55, 0], LeftLeg: [0.1, 0.3, 0], LeftFoot: [0.1, 0.06, 0],
    RightUpLeg: [-0.1, 0.55, 0], RightLeg: [-0.1, 0.3, 0], RightFoot: [-0.1, 0.06, 0],
    LeftArm: [0.25, 0.72, 0], LeftForeArm: [0.35, 0.6, 0],
    RightArm: [-0.25, 0.72, 0], RightForeArm: [-0.35, 0.6, 0],
  };
  for (let f = 0; f < FR; f++) for (let j = 0; j < J; j++) {
    const b = base[names[j]];
    joints[(f * J + j) * 3] = b[0];
    joints[(f * J + j) * 3 + 1] = b[1];
    joints[(f * J + j) * 3 + 2] = b[2];
  }
  const idR = new Float32Array(FR * J * 9);
  for (let i = 0; i < FR * J; i++) idR[i * 9] = idR[i * 9 + 4] = idR[i * 9 + 8] = 1;
  const aclip = new ArdyClip({ frameCount: FR, fps: 20, joints, globalRotations: idR, jointNames: names, parents: [-1, 0, 1, 0, 3, 4, 0, 6, 7, 2, 9, 2, 11], prompt: 'migration', seed: 1 });
  const motion = retargetToG1(aclip, sim, () => {});
  // ALTERN (wie ein v2.27.1-Bestand): Skeleton um 0.4 m absinken
  for (let i = 2; i < motion.srcPos.length; i += 3) motion.srcPos[i] -= 0.4;
  const packed = packMotion(motion);
  const m2 = unpackMotion(packed);
  ok(m2.srcPos instanceof Float32Array && m2.srcJoints.length === motion.srcJoints.length, 'pack/unpack erhält srcPos + srcJoints');
  let minZOld = Infinity;
  for (let i = 2; i < m2.srcPos.length; i += 3) minZOld = Math.min(minZOld, m2.srcPos[i]);
  ok(minZOld < -0.3, 'alter Bestand ist gesunken (Simulations-Pfad)', 'minZ=' + minZOld.toFixed(3));
  const lifted = groundSrcPosTrack(m2.srcPos, m2.n, m2.srcJoints);
  let minZNew = Infinity;
  const fiL = m2.srcJoints.indexOf('leftFoot'), fiR = m2.srcJoints.indexOf('rightFoot');
  for (let f = 0; f < m2.n; f++) for (const fi of [fiL, fiR]) minZNew = Math.min(minZNew, m2.srcPos[(f * m2.srcJoints.length + fi) * 3 + 2]);
  ok(lifted === m2.n, 'Reparatur hebt alle Frames', 'lifted=' + lifted + '/' + m2.n);
  ok(minZNew > -1e-6, 'Füße danach AUF dem Boden', 'minZ=' + minZNew.toFixed(4));
}

console.log('\n[4] render3d Overlay: placeSourceGhostAt reitet exakt auf dem Anker');
{
  // Stub: nur die für placeSourceGhostAt/updateSourceGhost nötigen Felder
  const roles = ['hips', 'spine', 'leftFoot', 'rightFoot'];
  const FR = 4, J = roles.length;
  const srcPos = new Float32Array(FR * J * 3);
  for (let f = 0; f < FR; f++) {
    const o = f * J * 3;
    srcPos[o] = 0.3 * f; srcPos[o + 1] = 0.1 * f; srcPos[o + 2] = 0.9; // Hüfte wandert
    srcPos[o + 3] = 0.3 * f; srcPos[o + 4] = 0.1 * f; srcPos[o + 5] = 1.3; // spine
    srcPos[o + 6] = 0.3 * f + 0.1; srcPos[o + 7] = 0.1 * f; srcPos[o + 8] = 0.0;
    srcPos[o + 9] = 0.3 * f - 0.1; srcPos[o + 10] = 0.1 * f; srcPos[o + 11] = 0.02;
  }
  const motion = { srcPos, srcJoints: roles.slice(), fps: 20 };
  const groups = [];
  const stub = {
    sourceGhost: { position: { set: (x, y, z) => groups.push([x, y, z]) }, visible: true },
    _srcMotion: motion,
    _srcIdx: { hips: 0 },
    _srcOrigin: [srcPos[0], srcPos[1]],
    _srcRelative: false,
  };
  const proto = Renderer3D.prototype;
  // Frame 2 mit wandernder Hüfte (0.6, 0.2): Anker (2.5, −1.0)
  proto.placeSourceGhostAt.call(stub, 2, 2.5, -1.0);
  ok(stub._srcRelative === true, 'Overlay schaltet relative Darstellung ein');
  ok(groups.length === 1, 'Gruppe wurde positioniert');
  const [gx, gy] = groups[0];
  // Erwartung: group = Anker − (Hüfte(fr) − Ursprung) = 2.5 − 0.6, −1.0 − 0.2
  ok(Math.abs(gx - 1.9) < 1e-6 && Math.abs(gy - (-1.2)) < 1e-6, 'Gruppe kompensiert die Hüfte-Bahn', 'group=' + gx.toFixed(3) + ',' + gy.toFixed(3));
  // Und die RELATIVE Hüfte landet exakt auf dem Anker:
  const relHx = srcPos[2 * J * 3] - stub._srcOrigin[0];
  ok(Math.abs(gx + relHx - 2.5) < 1e-6 && Math.abs(gy + (srcPos[2 * J * 3 + 1] - stub._srcOrigin[1]) + 1.0) < 1e-6, 'Hüfte des Skeletons sitzt Millimeter-genau auf dem Geist-Anker');
  // setSourceGhostRelative schaltet zurück
  proto.setSourceGhostRelative.call(stub, false);
  ok(stub._srcRelative === false, 'GLB-Pfad: absolut (Mesh-konsistent)');
}

console.log('\n[5] Verdrahtungs-Pins (main.js / render3d.js)');
{
  const mainJs = await readFile(path.join(WWW, 'js/main.js'), 'utf8');
  const r3dJs = await readFile(path.join(WWW, 'js/render3d.js'), 'utf8');
  const retJs = await readFile(path.join(WWW, 'js/retarget.js'), 'utf8');
  ok(mainJs.includes('groundSrcPosTrack(S.motionClip.srcPos'), 'activateClip: Boden-Reparatur beim Aktivieren');
  ok(mainJs.includes("rec.ctrl = 'joy';\n      await putClip(rec).catch(() => {});") || (mainJs.includes("if (rec.src === 'ardy') {") && mainJs.includes("rec.ctrl = 'joy'")), 'ARDY-Standard: Steuerung joy');
  ok(mainJs.includes("S.refMode = 'folgt';") && mainJs.includes("tr_refmode_v1', 'folgt'"), 'ARDY-Standard: refMode folgt (Geist lenken)');
  ok(mainJs.includes("if (rec.src === 'ardy') S.motionClip.srcOverlay = true;"), 'ARDY-OVERLAY-Tag am Clip');
  ok(mainJs.includes('r3d.placeSourceGhostAt(fr, rr[0], rr[1])'), 'Render-Loop: Overlay-Platzierung am Geist-Anker');
  ok(mainJs.includes('r3d.updateSourceGhost(fr); // v2.28.1'), 'Render-Loop: updateSourceGhost NACH Anker-Wahl');
  ok(mainJs.includes('Bewegung kollabiert'), 'Kollaps-Warnung bei kollabierter Generierung');
  ok(mainJs.includes("const VERSION = '2.28.4';"), 'VERSION 2.28.4');
  ok(mainJs.includes('groundSrcPosTrack, ardyMotionQuality } from'), 'Import der Reparatur-Helfer (+ v2.28.3 Versuchs-Qualität)');
  ok(retJs.includes('export function groundSrcPosFrame') && retJs.includes('export function groundSrcPosTrack'), 'retarget.js: Reparatur-Helfer exportiert');
  ok(r3dJs.includes('placeSourceGhostAt(frame, x, y)') && r3dJs.includes('_srcRelative'), 'render3d: Overlay-API');
  ok(r3dJs.includes('this._srcOrigin = [motion.srcPos[0], motion.srcPos[1]]'), 'render3d: Overlay-Ursprung (Frame-0-Hüfte)');
}

console.log('\n[6] Geist bleibt auf dem Boden (groundGhost-Interaktion unangetastet)');
{
  const feet = findFootGeoms(sim);
  ok(feet.length >= 2, 'Fuß-Geoms vorhanden', String(feet.length));
  const ghost = sim.makeGhostData();
  const q = new Float32Array(sim.nu);
  sim.setGhostPose(ghost, q, 0, 0.55, 0, 0, 0, null); // tief (Ducklage)
  const lift = sim.groundGhost(ghost, feet);
  const zAfter = Math.min(...feet.map(fg => ghost.xpos[3 * fg.body + 2] + fg.lowZ));
  ok(lift > 0 && zAfter > -0.015, 'gesunkener Geist wird angehoben (v2.28.0 unverändert)', 'lift=' + lift.toFixed(3) + ' footZ=' + zAfter.toFixed(3));
}

console.log('\n═══ ERGEBNIS: ' + pass + ' OK · ' + fail + ' FEHLER ═══');
process.exit(fail ? 1 : 0);
