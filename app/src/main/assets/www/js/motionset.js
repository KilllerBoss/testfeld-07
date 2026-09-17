// ═══════════════════════════════════════════════════════════
// motionset.js — v2.23.0 „LEHRER-DATENSATZ": Basis-Motion-Clips
// von HuggingFace per AUTO-DOWNLOAD, als BELohnungs-LEHRER.
//
//   https://huggingface.co/datasets/KillerBoss/trainrobot-motionclips
//   (Spiegel: Kaggle rudolfbewer/trainrobot-motionclips)
//
// GRUNDSATZ (Nutzer): Die Animation dient NIEMALS als Policy-Input —
// sie ist NUR Belohnungssystem. Der Beobachtungsraum enthält sie nie;
// das Lehrer-Gewicht ist live auf 0 fadbar → „Animation weg" ändert
// KEIN Verhalten (die Policy sah sie ohnehin nie als Eingang).
//
// Format (schema trainrobot-motionclips, v1.0.0): Clips mit
//   q[n·nu] · h[n] · root[2n] · yaw[n] · baseQ[4n] · cmd[n·7]
//   cmd = [vx, vy, wz, bA, bB, bC, bD]  ← die JOYSTICK-/BUTTON-SPUR
//   (bA Hüpfen · bB Hinlegen · bC Aufstehen · bD Stopp) — beim
//   Generieren bekannt, später 1:1 auf das Gamepad mappbar.
// ═══════════════════════════════════════════════════════════

const HF_URL = 'https://huggingface.co/datasets/KillerBoss/trainrobot-motionclips/resolve/main/app/motionclips.json';
const CACHE_NAME = 'trainrobot-motionset-v1';

// Skill-Ordung der Expertennamen (skill.js-Namensfamilie) → Datensatz-Skill
const EXPERT_CLIP = {
  stand: 'idle', balance: 'idle', idle: 'idle', hover: 'schweben',
  walk: 'walk', move: 'vorwaerts', laufen: 'laufen',
  turn: 'turn_l', drehen: 'turn_l',
  recover: 'aufstehen', aufstehen: 'aufstehen', descend: 'sinken', sinken: 'sinken',
  climb: 'steigen', steigen: 'steigen',
};

/**
 * Datensatz laden (Cache-API zuerst, sonst HF-Fetch).
 * @returns {Promise<{version:string, clips:Array, byRobot:Object}>}
 */
export async function ensureMotionSet(log = () => {}) {
  const cache = (typeof caches !== 'undefined') ? await caches.open(CACHE_NAME) : null;
  let text = null;
  if (cache) {
    const hit = await cache.match(HF_URL);
    if (hit) { try { text = await hit.text(); } catch (e) { /* neu laden */ } }
  }
  let fromCache = !!text;
  if (!text) {
    const res = await fetch(HF_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HuggingFace-Download fehlgeschlagen (HTTP ' + res.status + ')');
    text = await res.text();
    if (cache) { try { await cache.put(HF_URL, new Response(text)); } catch (e) { /* Quota — egal */ } }
  }
  const json = JSON.parse(text);
  if (json.schema !== 'trainrobot-motionclips') throw new Error('Unbekanntes Datensatz-Schema: ' + json.schema);
  const set = parseMotionSet(json);
  set.fromCache = fromCache;
  log(`Lehrer-Datensatz v${set.version}: ${set.clips.length} Clips ${fromCache ? '(Cache)' : '(HuggingFace-Download)'} — G1 ${set.byRobot.g1.length} · MicroDuck ${set.byRobot.duck.length} · X2 ${set.byRobot.x2.length}`);
  return set;
}

/** Leeren (Button „Neu laden"). */
export async function clearMotionSet() {
  if (typeof caches !== 'undefined') { const c = await caches.open(CACHE_NAME); const keys = await c.keys(); for (const k of keys) await c.delete(k); }
}

/** JSON → MotionSet {version, clips, byRobot:{g1:[],duck:[],x2:[]}} (App-Motion-Objekte). */
export function parseMotionSet(json) {
  const byRobot = { g1: [], duck: [], x2: [] };
  const clips = [];
  for (const c of (json.clips || [])) {
    const m = clipToMotion(c);
    if (!m) continue;
    clips.push(m);
    (byRobot[m.robotId] || (byRobot[m.robotId] = [])).push(m);
  }
  return { version: json.version || '1.0.0', clips, byRobot, cmdTrack: json.cmdTrack || null };
}

/** Clip-JSON → Motion-Objekt (identisches Interface zu parseQposCsv-Ausgabe). */
export function clipToMotion(c) {
  if (!c || !Array.isArray(c.q) || c.q.length < 2) return null;
  const n = c.n || c.q.length;
  const nu = c.q[0] ? c.q[0].length : 0;
  const fps = c.fps || 30;
  const q = new Float32Array(n * nu);
  const h = new Float32Array(n);
  const root = new Float32Array(2 * n);
  const yaw = new Float32Array(n);
  const baseQ = new Float32Array(4 * n);
  const cmd = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < nu; j++) q[i * nu + j] = c.q[i][j];
    h[i] = c.h[i];
    root[2 * i] = c.root[i][0]; root[2 * i + 1] = c.root[i][1];
    yaw[i] = c.yaw[i];
    baseQ[4 * i] = c.baseQ[i][0]; baseQ[4 * i + 1] = c.baseQ[i][1];
    baseQ[4 * i + 2] = c.baseQ[i][2]; baseQ[4 * i + 3] = c.baseQ[i][3];
    for (let k = 0; k < 7; k++) cmd[i * 7 + k] = c.cmd[i][k];
  }
  // meanSpeed aus der Bahn
  let dist = 0;
  for (let i = 1; i < n; i++) dist += Math.hypot(root[2 * i] - root[2 * (i - 1)], root[2 * i + 1] - root[2 * (i - 1) + 1]);
  const meanSpeed = (dist / Math.max(1, n - 1)) * fps;
  return {
    id: c.id, skill: c.skill, label: c.label, kind: c.kind || 'loop',
    name: c.label || c.id, q, h, root, yaw, baseQ, cmd,
    fps, n, nu, duration: n / fps, meanSpeed,
    locomotion: meanSpeed > 0.1, robotId: c.robot, src: 'hf-ds', alg: 99,
    mapped: [], mergedFrom: 0,
  };
}

/** Clip per Skill-Namen (robust: lie/lue-Formen normalisiert). */
export function clipForSkill(set, robotId, skill) {
  if (!set || !set.byRobot[robotId]) return null;
  const want = norm(skill);
  const list = set.byRobot[robotId];
  let hit = list.find((c) => norm(c.skill) === want);
  if (!hit && robotId === 'g1' && want === 'sitzen') hit = list.find((c) => norm(c.skill) === 'ducken');
  if (!hit && robotId === 'duck' && want === 'ducken') hit = list.find((c) => norm(c.skill) === 'sitzen');
  if (!hit && want === 'walk') hit = list.find((c) => norm(c.skill) === 'vorwaerts');
  return hit || null;
}

/** Experte (skill.js-Namensfamilie) → Lehrer-Clip. */
export function clipForExpert(set, robotId, expertName) {
  const skill = EXPERT_CLIP[(expertName || '').toLowerCase()];
  return skill ? clipForSkill(set, robotId, skill) : null;
}

/** Buttons (bA..bD) → Skill: 0 Hüpfen · 1 Hinlegen · 2 Aufstehen · 3 Stopp. */
export const BTN_SKILLS = ['huepfen', 'liegen', 'aufstehen', 'stopp'];
export function skillForButton(i) { return BTN_SKILLS[i] || null; }

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ä/g, 'a').replace(/ß/g, 'ss')
    .replace(/ue/g, 'u').replace(/ae/g, 'a').replace(/oe/g, 'o')
    .replace(/[^a-z_]/g, '');
}
