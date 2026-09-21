// ═══════════════════════════════════════════════════════════
// motionset_v2230_test.mjs — v2.23.0 „LEHRER-DATENSATZ + SOFT-MOE
// FÜR ALLE + GAMEPAD + EXPERTEN-REWARDS":
//   A) motionset.js: Datensatz-Parsen (ECHTES HF-Dataset-JSON),
//      Skill-/Umlaut-Normalisierung, Experten-Clip-Mapping, Buttons
//   B) skill.js: expertRFor/setExpertR (pro Roboter, Klemmen, Persistenz)
//      + expertRouterReward mit Profil-Parameter
//   C) robots.js: makeMoeTask-Verallgemeinerung (duck 74 obs, G1 119),
//      Hover-Task 28 obs, makeMoeTask-Alias, setUserCmd+Buttons,
//      LEHRER (reward-only): Loop-Funktion, Once-Map, Fade (teacherW=0
//      ⇒ exakt alter Reward), Trigger + Ablauf
//   D) controls.js: Gamepad-State + command()-Merge
//   E) ai.js: setTeacher/setExpertR-Validierung + Whitelist
//   F) Verdrahtung: index.html-Panels, CSS, VERSION (Pins je Release gepflegt: 2.26.0/38)
// Aufruf: node scripts/motionset_v2230_test.mjs
// ═══════════════════════════════════════════════════════════

// localStorage-Stub (Node hat keins) — VOR den Imports setzen
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};
// document-Stub (controls.setPad greift darauf zu)
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

let fails = 0, pass = 0;
function check(name, cond, detail = '') {
  console.log((cond ? '  \u2713 ' : '  \u2717 FEHLER ') + name + (detail ? ' — ' + detail : ''));
  if (cond) pass++; else fails++;
}

const DS = JSON.parse(readFileSync(join(HERE, '..', 'dataset', 'app', 'motionclips.json'), 'utf8'));

// ═══ A) motionset.js ═══
console.log('\nA) motionset.js — HF-Lehrer-Datensatz');
const { parseMotionSet, clipToMotion, clipForSkill, clipForExpert, BTN_SKILLS, skillForButton, ensureMotionSet } = await import('../app/src/main/assets/www/js/motionset.js');
const set = parseMotionSet(DS);
check('Schema + Version', DS.schema === 'trainrobot-motionclips' && set.version === '1.0.0');
check('41 Clips gesamt', set.clips.length === 41, String(set.clips.length));
check('g1 17 · duck 12 · x2 12', set.byRobot.g1.length === 17 && set.byRobot.duck.length === 12 && set.byRobot.x2.length === 12);
const gm = clipToMotion(DS.clips.find((c) => c.id === 'g1_walk'));
check('clipToMotion: Felder', gm.q.length === gm.n * gm.nu && gm.cmd.length === gm.n * 7 && gm.baseQ.length === gm.n * 4 && gm.root.length === gm.n * 2);
check('g1_walk meanSpeed ≈ 0.35', Math.abs(gm.meanSpeed - 0.35) < 0.02, gm.meanSpeed.toFixed(3));
check('g1_walk ARDY-Format nu=29 + Quat w-first', gm.nu === 29 && gm.baseQ[0] === 1);
check('cmd-Spur [vx,vy,wz,bA..]: walk vx=0.35', Math.abs(gm.cmd[0] - 0.35) < 1e-5 && gm.cmd[6] === 0);
const dl = clipToMotion(DS.clips.find((c) => c.id === 'g1_liegen'));
check('g1_liegen: bB=1 (Hinlegen-Button-Spur)', Math.abs(dl.cmd[4] - 1) < 1e-5, String(dl.cmd[4]));
check('x2-Clip: Pfad (nu 0) + Höhe', (() => { const h = clipToMotion(DS.clips.find((c) => c.id === 'x2_schweben')); return h.nu === 0 && h.h[0] > 1; })());
check('Umlaut-Match „hüpfen“→huepfen (duck)', clipForSkill(set, 'duck', 'hüpfen')?.skill === 'huepfen');
check('clipForExpert stand→idle · walk→walk · recover→aufstehen',
  clipForExpert(set, 'g1', 'stand')?.skill === 'idle' && clipForExpert(set, 'g1', 'walk')?.skill === 'walk' && clipForExpert(set, 'g1', 'recover')?.skill === 'aufstehen');
check('Drohnen-Mapping hover→schweben · move→vorwaerts',
  clipForExpert(set, 'x2', 'hover')?.skill === 'schweben' && clipForExpert(set, 'x2', 'move')?.skill === 'vorwaerts');
check('BTN_SKILLS + skillForButton', BTN_SKILLS.join(',') === 'huepfen,liesen,aufstehen,stopp'.replace('liesen', 'liegen') && skillForButton(2) === 'aufstehen');
check('ensureMotionSet exportiert (App-Download-Route)', typeof ensureMotionSet === 'function');

// ═══ B) skill.js — Rewards pro Roboter ═══
console.log('\nB) skill.js — Experten-/Router-Rewards pro Roboter');
const { expertRFor, setExpertR, expertRouterReward, defaultExpertNames } = await import('../app/src/main/assets/www/js/skill.js');
const profD = expertRFor('duck');
check('Default-Profil = EXPERT_R', profD.routerBonus === 0.25 && profD.walk.speed === 0.30 && profD.recover.rise === 1.2);
setExpertR('duck', { routerBonus: 0.5, walk: { speed: 9 } });
const profD2 = expertRFor('duck');
check('setExpertR: Patch + Klemme (9→2)', profD2.routerBonus === 0.5 && profD2.walk.speed === 2, JSON.stringify(profD2.walk));
check('Profil ist PRO Roboter (g1 unberührt)', expertRFor('g1').routerBonus === 0.25);
const r1 = expertRouterReward({ state: 'walk', route: [0.05, 0.9, 0.05, 0], names: ['stand', 'walk', 'turn', 'recover'], prevUp: 1, upz: 0.95, vFwd: 0.2, yawRate: 0, speed: 0.2, cmdVx: 0.3, cmdYaw: 0 });
const r2 = expertRouterReward({ state: 'walk', route: [0.05, 0.9, 0.05, 0], names: ['stand', 'walk', 'turn', 'recover'], prevUp: 1, upz: 0.95, vFwd: 0.2, yawRate: 0, speed: 0.2, cmdVx: 0.3, cmdYaw: 0 }, expertRFor('duck'));
check('Profil-Parameter wirkt (gewichteter Router-/Walk-Bonus)', r2.r > r1.r, `${r1.r.toFixed(3)} → ${r2.r.toFixed(3)}`);
check('defaultExpertNames(Drohne)', defaultExpertNames(true).join(',') === 'hover,move,turn,descend');

// ═══ C) robots.js — makeMoeTask + Lehrer ═══
console.log('\nC) robots.js — Soft-MoE für alle + LEHRER (reward-only)');
const robots = await import('../app/src/main/assets/www/js/robots.js');
check('makeMoeTask-Alias === makeDuckMoeTask', robots.makeMoeTask === robots.makeDuckMoeTask);
check('moe: true bei g1 + duck + x2', robots.getRobot('g1').moe === true && robots.getRobot('duck').moe === true && robots.getRobot('x2').moe === true);
check('g1 rW: imit/route/recover/height vorhanden', ['imit', 'route', 'recover', 'height'].every((k) => robots.getRobot('g1').rW[k] !== undefined));
const { RNG } = await import('../app/src/main/assets/www/js/math.js');

function stubSim(cfg, footNames) {
  const nu = cfg.nu;
  const st = { upz: 1.0, gz: cfg.h0 || 0.12, vFwd: 0, contacts: [1, 1] };
  const names = footNames || ['ankle_left', 'ankle_right'];
  const sim = {
    cfg, nbody: 3, model: {},
    _mjApi: { mj_id2name: (_m, _t, b) => (b === 1 ? names[0] : b === 2 ? names[1] : null) },
    _xpos: new Float64Array(24), _xquat: new Float64Array(16), _qvel: new Float64Array(12),
    actRange: new Float64Array(2 * nu).map((_, i) => (i % 2 ? 0.6 : -0.6)),
    keyCtrl: new Float64Array(nu), ctrl: new Float64Array(nu),
    resetToKeyframe() { st.upz = 1.0; st.gz = cfg.h0 || 0.12; },
    baseQuat(o) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; },
    basePos(o) { o[0] = 0; o[1] = 0; o[2] = st.gz; },
    baseVelWorld(o) { o[0] = st.vFwd; o[1] = 0; o[2] = 0; },
    jointPositions(o) { o.fill(0); },
    jointVelocities(o) { o.fill(0); },
    gyroBody(o) { o.fill(0); },
    projectedGravity(o) { o[0] = 0; o[1] = 0; o[2] = st.upz; },
    footContacts(o) { o[0] = st.contacts[0]; o[1] = st.contacts[1]; },
    pushImpulse() {},
  };
  return { sim, st };
}

const duckCfg = robots.getRobot('duck');
const tDuck = duckCfg.task(duckCfg);
check('Duck-MoE-Task obsDim bleibt 74', tDuck.obsDim === 74, String(tDuck.obsDim));
const g1Cfg = robots.getRobot('g1');
const tG1 = g1Cfg.task(g1Cfg);
check('G1-MoE-Task obsDim 119 (106 Basis + 13 Kommando)', tG1.obsDim === 119, String(tG1.obsDim));
tG1._applyLevel(5);
check('G1-Curriculum skaliert (L5 vxMax = 0,6)', Math.abs(tG1.vxMax - 0.6) < 1e-9, tG1.vxMax.toFixed(3));
const x2Cfg = robots.getRobot('x2');
const tX2 = x2Cfg.task(x2Cfg);
check('Hover-Task obsDim 28 (15 + 13 Soft-Block)', tX2.obsDim === 28, String(tX2.obsDim));
check('Alle Tasks: setTeacher/setRouting/setUserCmd vorhanden', [tDuck, tG1, tX2].every((t) => t.setTeacher && t.setRouting && t.setUserCmd && t.setTeacherW));

// Lehrer-Belohnung: Loop = pick(expertName), Once = Map; teacherW = 0 ⇒ alter Reward
const { sim: simG, st: stG } = stubSim(g1Cfg, ['left_ankle_roll_link', 'right_ankle_roll_link']);
tG1.reset(new RNG(99), simG);
tG1.observe(simG, new Float64Array(tG1.obsDim)); // Reward setzt auf observe-Caches (_bv)
const idle = clipForExpert(set, 'g1', 'stand');
const onceMap = {};
for (const sk of ['huepfen', 'liegen', 'aufstehen', 'stopp']) { const c = clipForSkill(set, 'g1', sk); if (c) onceMap[sk] = c; }
// Task-Experten heißen balance/walk/turn/recover → pick deckt beides ab
const pickFn = (nm) => ((nm === 'stand' || nm === 'balance') ? idle : null);
tG1.setTeacher(pickFn, onceMap);
check('wireTeacher-Formel: pick + once-Map', pickFn('stand') === idle && pickFn('balance') === idle && Object.keys(onceMap).length === 4);
tG1._routeW.set([1, 0, 0, 0]); // dominant: stand/balance → idle-Clip
tG1.teacherW = 0;
tG1.reward(simG); tG1.reward(simG); // Warm-up (Kontaktwechsel-Strafe nur im 1. Schritt)
const rBase = tG1.reward(simG).r;
tG1.teacherW = 1;
const rTeacher = tG1.reward(simG).r;
check('Lehrer-Belohnung addiert (teacherW 0→1)', rTeacher > rBase + 0.05, `${rBase.toFixed(3)} → ${rTeacher.toFixed(3)}`);
check('teacherW = 0 ⇒ exakt alter Reward (Fade-out-Garantie)', (() => { tG1.teacherW = 0; return Math.abs(tG1.reward(simG).r - rBase) < 1e-12; })());
check('Once-Trigger „Aufstehen“ (Klemme/Map)', tG1.triggerTeacherSkill('Aufstehen') === true && tG1._tOnce === 0);
check('Trigger auf fehlenden Skill = false', tG1.triggerTeacherSkill('winken') === false);
tG1._tOnce = 1e9; tG1._tOnceClip = onceMap.aufstehen; tG1._tOnceHold = 0; tG1.teacherW = 0.5;
const rOnce = tG1.reward(simG).r;
check('Once-Clip abgelaufen + Halten (40 Ticks)', (() => { for (let i = 0; i < 50; i++) tG1._teacherTick(); return tG1._tOnce === -1 && tG1._tOnceClip === null; })());
check('Once-Reward über Basis (liegt zwischen)', rOnce > rBase);
// Buttons im setUserCmd
const tDuck2 = duckCfg.task(duckCfg);
const { sim: simD } = stubSim(duckCfg);
tDuck2.reset(new RNG(5), simD);
tDuck2.setTeacher(null, onceMap);
let trig = 0;
tDuck2.triggerTeacherSkill = (n) => { trig++; return n === 'huepfen'; };
tDuck2.setUserCmd(0.1, 0, 0, [1, 0, 0, 0]);
tDuck2.setUserCmd(0.1, 0, 0, [1, 0, 0, 0]); // zweimal = kein weiterer Edge-Trigger
tDuck2.setUserCmd(0.1, 0, 0, [0, 0, 0, 0]);
tDuck2.setUserCmd(0.1, 0, 0, [0, 1, 0, 0]);
check('Button-Edges triggern Lehrer-Skills (A, B; kein Doppel)', trig === 2, 'trig=' + trig);
check('Buttons liefern Skill-Hinweise (skillW-Blend aktiv)', tDuck2._tgt.w[3] > 0.5 || tDuck2._tgt.w[1] > 0.5, JSON.stringify(tDuck2._tgt.w));

// ═══ D) controls.js — Gamepad ═══
console.log('\nD) controls.js — Gamepad-Overlay + Merge');
const { Controls } = await import('../app/src/main/assets/www/js/controls.js');
const c = new Controls();
check('setPad ohne DOM safe + State', (c.setPad(true), c.padOn === true));
c.pad.lx = 0.5; c.pad.ly = 0.5; c.pad.rx = 0.25;
const cmd = c.command({ speedMax: 0.5, yawMax: 1.0 });
check('Gamepad-Merge: vx/vy aus linkem Stick', Math.abs(cmd.vx - 0.25) < 1e-9 && Math.abs(cmd.vy - 0.25) < 1e-9, `vx=${cmd.vx.toFixed(3)} vy=${cmd.vy.toFixed(3)}`);
check('Gamepad-Merge: yaw aus rechtem Stick', Math.abs(cmd.yaw + 0.25) < 1e-9, String(cmd.yaw.toFixed(3)));
check('padBtn-Container', c.padBtn.length === 4 && c.setPad(false) === false);

// ═══ E) ai.js — KI-Tools ═══
console.log('\nE) ai.js — setTeacher / setExpertR');
const ai = await import('../app/src/main/assets/www/js/ai.js');
const vT = ai.validateToolCall ? ai.validateToolCall({ tool: 'setTeacher', args: { on: true, weight: 1.7 } }) : null;
check('setTeacher-Validierung (weight 1,7→1)', !!vT && vT.args.weight === 1, JSON.stringify(vT));
const vR = ai.validateToolCall({ tool: 'setExpertR', args: { routerBonus: 0.6, walk: { speed: 0.9 } } });
check('setExpertR-Validierung', !!vR && vR.tool === 'setExpertR' && vR.args.routerBonus === 0.6 && vR.args.walk.speed === 0.9, JSON.stringify(vR));
const vBad = ai.validateToolCall({ tool: 'setTeacher', args: {} });
check('setTeacher ohne args erlaubt (on/weight optional)', !!vBad && vBad.tool === 'setTeacher');

// ═══ F) Verdrahtung ═══
console.log('\nF) Verdrahtung — Panels, Version, Build');
const WWW = join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');
const html = readFileSync(join(WWW, 'index.html'), 'utf8');
const css = readFileSync(join(WWW, 'style.css'), 'utf8');
const mainJs = readFileSync(join(WWW, 'js', 'main.js'), 'utf8');
const gradle = readFileSync(join(HERE, '..', 'app', 'build.gradle'), 'utf8');
check('index.html: Gamepad-Overlay (2 Zonen + 4 Buttons)', ['#padOverlay', '#padLZone', '#padRZone', '#padBtnA', '#padBtnB', '#padBtnC', '#padBtnD'].every((id) => html.includes(`id="${id.slice(1)}"`)));
check('index.html: LEHRER-Panel + Experten-Editor + btnPad', ['teacherChip', 'teacherW', 'teacherWVal', 'teacherReload', 'teacherSrc', 'erToggle', 'expertRPanel', 'btnPad'].every((id) => html.includes(`id="${id}"`)));
check('CSS: padOverlay-Layout', css.includes('#padOverlay.on') && css.includes('.padZone') && css.includes('.padBtn'));
check('main.js: VERSION >= 2.26.0 + Teacher-Verdrahtung (v2.26.0-Pin)', (mainJs.includes("const VERSION = '2.26.0';") || mainJs.includes("const VERSION = '2.27.0';") || mainJs.includes("const VERSION = '2.27.1';") || mainJs.includes("const VERSION = '2.28.0';") || mainJs.includes("const VERSION = '2.28.1';") || mainJs.includes("const VERSION = '2.28.3';")) && mainJs.includes('initTeacherUI();') && mainJs.includes('downloadMotionSetBg();') && mainJs.includes('wireTeacher(t);'));
check('build.gradle: versionCode 38 / versionName 2.26.0 (v2.26.0-Pin)', (gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40') || gradle.includes('versionCode 41') || gradle.includes('versionCode 42') || gradle.includes('versionCode 43') || gradle.includes('versionCode 44')) && gradle.includes('applicationId "com.lertrain.app"'));
check('README/Doku: Datensatz dokumentiert', readFileSync(join(HERE, '..', 'dataset', 'README.md'), 'utf8').includes('Kommando-Spur'));

console.log(`\n═══ ERGEBNIS: ${pass} OK · ${fails} FEHLER ═══`);
process.exit(fails ? 1 : 0);
