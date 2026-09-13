// build_models_v270.mjs — erzeugt:
//  1) models/pollen_microduck/microduck.xml  (robot_walk.xml + Keyframes INIT/STAND + IMU-Sensoren)
//  2) models/<dir>/testfeld.xml für unitree_go2 + pollen_microduck (skalierter Testfeld-Klassiker)
//  3) aktualisiert beide manifest.json
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const MODELS = path.join(WWW, 'models');

// ── 1) microduck.xml ───────────────────────────────────────
{
  let src = await readFile(path.join(ROOT, 'tool-results/microduck_rl_src/src/mjlab_microduck/robot/microduck/robot_walk.xml'), 'utf8');
  src = src.replace('<mujoco model="microduck">', '<mujoco model="microduck">\n  <option cone="elliptic" impratio="100"/>');
  // Positions-Servos steller stellen: upstream kp=0.55 ist für passives
  // STANDEN zu weich (Beine knicken langsam ein, F≪forcerange) — kp=2.2
  // hält die Pose, das Drehmoment-Limit ±0.96 bleibt realistisch.
  src = src.replace('<position kp="0.55" kv="0.0" forcerange="-0.96 0.96" ctrlrange="-10.0 10.0"/>', '<position kp="2.2" kv="0.0" forcerange="-0.96 0.96" ctrlrange="-10.0 10.0"/>');
  // Sensoren: robot_walk.xml hat bereits einen vollständigen Sensor-Block
  // (framequat, gyro×2, velocimeter, accelerometer am IMU-Site) — nichts
  // ergänzen! Nur die Keyframes INIT/STAND anhängen (liegen upstream in
  // scene_walk.xml, wir brauchen sie im Roboter-XML für ALLE Welten).
  const keyframes = `
  <keyframe>
    <key name="INIT" qpos="0 0 0.12 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0" ctrl="0 0 0 0 0 0 0 0 0 0 0 0 0 0"/>
    <key name="STAND" qpos="0 0 0.12 1 0 0 0 0 -0.08726646259971647 -0.457924 -0.004940 0.452984 0.3490658503988659 0.3490658503988659 0 0 0 0.08726646259971647 0.457924 0.004940 -0.452984" ctrl="0 -0.08726646259971647 -0.457924 -0.004940 0.452984 0.3490658503988659 0.3490658503988659 0 0 0 0.08726646259971647 0.457924 0.004940 -0.452984"/>
  </keyframe>`;
  src = src.replace('</mujoco>', keyframes + '\n</mujoco>');
  await writeFile(path.join(MODELS, 'pollen_microduck/microduck.xml'), src);
  console.log('microduck.xml geschrieben:', src.length, 'Bytes');
}

// ── 2) testfeld.xml für go2 + duck (buildWorldXML, testfeld-Preset) ──
// Node-Fetch-Stub für engine-freien Import von worlds.js (pure JS, kein Fetch nötig)
const { buildWorldXML } = await import(path.join(WWW, 'js/worlds.js'));
const { ROBOT_ORDER, getRobot } = await import(path.join(WWW, 'js/robots.js'));
for (const id of ['go2', 'duck']) {
  const cfg = getRobot(id);
  const xml = buildWorldXML(cfg, 'testfeld', 1);
  await writeFile(path.join(MODELS, cfg.dir, 'testfeld.xml'), xml);
  console.log(cfg.dir + '/testfeld.xml geschrieben:', xml.length, 'Bytes (Skala', (cfg.zTarget / 0.75).toFixed(2) + ')');
}

// ── 3) Manifests ──────────────────────────────────────────
import { readdirSync, statSync } from 'node:fs';
function listFiles(dir, base = '') {
  const out = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = base ? base + '/' + f : f;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else if (rel !== 'manifest.json') out.push(rel);
  }
  return out.sort();
}
for (const d of ['unitree_go2', 'pollen_microduck']) {
  const files = listFiles(path.join(MODELS, d));
  const modelXml = d === 'unitree_go2' ? 'go2.xml' : 'microduck.xml';
  await writeFile(path.join(MODELS, d, 'manifest.json'), JSON.stringify({ model_xml: modelXml, scene_xml: 'testfeld.xml', files }, null, 1));
  console.log(d + '/manifest.json:', files.length, 'Dateien');
}
