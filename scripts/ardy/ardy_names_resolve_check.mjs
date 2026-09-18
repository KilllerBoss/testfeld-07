// ═══════════════════════════════════════════════════════════
// ardy_names_resolve_check.mjs — Lösen die 27 ARDY-cskel27-Gelenk-
// namen über normName+BONE_ALIASES/Heuristik auf die 13 GHOST_ROLES
// auf? (Boden-Garantie probt leftFoot/rightFoot über Rollen.)
// Usage: node scripts/ardy/ardy_names_resolve_check.mjs
// ═══════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '../../app/src/main/assets/www');
const manifest = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(path.join(HERE, 'model.json.gz')))));
const names = manifest.skeleton.joint_names;
console.log('■ ARDY cskel27 Gelenke (' + names.length + '):');
console.log('  ' + names.join(', '));

// normName ECHT aus glb.js importieren (kein Nachbau)
const { normName: nn } = await import('file://' + path.join(WWW, 'js/glb.js'));

// BONE_ALIASES + Heuristik statisch aus retarget.js extrahieren
// (retarget.js selbst importiert MuJoCo — zu schwer für diesen Check)
const rSrc = readFileSync(path.join(WWW, 'js/retarget.js'), 'utf8');
const mA = rSrc.match(/const BONE_ALIASES = (\{[\s\S]*?\n\});/);
const BONE_ALIASES = eval('(' + mA[1] + ')');
const mH = rSrc.match(/const HEURISTICS = (\[[\s\S]*?\n\]);/);
const SIDE_L = /(left|\bl([._\- ]|$|\d)|_l([._\- ]|$)|\.l$| l$)/;
const SIDE_R = /(right|\br([._\- ]|$|\d)|_r([._\- ]|$)|\.r$| r$)/;
const HEURISTICS = eval('(' + mH[1] + ')');
const GHOST_ROLES = ['hips', 'spine', 'head', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];
const BAD_NAME = /leaf|twist|roll|proxy|ik$|_ik|target|aim|effector|\$/;

const resolved = {};
const used = new Set();
for (const role of GHOST_ROLES) {
  const aliases = BONE_ALIASES[role] || [];
  let hit = null;
  // 1) Aliase (gleiche Reihenfolge wie resolveBones: exakter normName-Vergleich)
  for (const n of names) {
    if (used.has(n)) continue;
    const k = nn(n);
    if (k && aliases.some((a) => nn(a) === k)) { hit = n; break; }
  }
  // 2) Heuristik (Regex über Roh-Namen)
  if (!hit) {
    for (const [r2, reBody, reSide] of HEURISTICS) {
      if (r2 !== role) continue;
      for (const n of names) {
        if (used.has(n) || BAD_NAME.test(n.toLowerCase())) continue;
        const low = n.toLowerCase();
        if (reBody.test(low) && reSide.test(low)) { hit = n; break; }
      }
      if (hit) break;
    }
  }
  if (hit) used.add(hit);
  resolved[role] = hit;
  console.log('  ' + role.padEnd(14) + ' ← ' + (hit || '✗ NICHT AUFGELÖST'));
}
const missing = GHOST_ROLES.filter((r) => !resolved[r]);
console.log(missing.length ? '✗ FEHLEND: ' + missing.join(', ') : '✓ alle 13 Rollen aufgelöst');
process.exit(missing.length ? 1 : 0);
