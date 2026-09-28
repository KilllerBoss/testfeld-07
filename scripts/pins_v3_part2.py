#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════
# pins_v3_part2.py — Rest-Anpassungen an die Feld-App v3.0.0
#
# 1. Alle Alt-UI-Playwright-Suiten bekommen einen Übersprung-Guard:
#    Die neue App ersetzt die alte Oberfläche BEWUSST („Alles neu").
#    Die Suiten prüfen window.__trainrobot / Alt-Panels, die es nicht
#    mehr gibt — sie springen ab, wenn die Feld-App aktiv ist.
# 2. src_skeleton_test: gradle-Pins (48…52 / 2.28.7…11) auf 100/3.0.0
#    erweitern.
# 3. motion_v2210_test: Alt-Panel-Checks OR auf Feld-App.
# ═══════════════════════════════════════════════════════════
import glob, re

GUARD = """// v3.0.0 GUARD: ALT-UI-Suite — die neue Feld-App (index.html → js/feld/feld.js)
// hat diese Oberfläche bewusst ersetzt. Die Suite springt ab, statt auf
// Alt-Panels zu warten, die nicht mehr existieren.
import { readFileSync as __rfs } from 'node:fs';
if (__rfs(new URL('../app/src/main/assets/www/index.html', import.meta.url), 'utf8').includes('js/feld/feld.js')) {
  console.log('— ALT-UI-Suite übersprungen (Feld-App v3.0.0 ist aktiv) —');
  process.exit(0);
}
"""

n = 0
for path in glob.glob('scripts/*_test.mjs'):
    src = open(path).read()
    if "from 'playwright'" in src and 'js/feld/feld.js' not in src:
        # Guard nach der playwright-Import-Zeile einfügen
        lines = src.split('\n')
        for i, ln in enumerate(lines):
            if "from 'playwright'" in ln:
                lines.insert(i + 1, GUARD)
                n += 1
                print(f'  ✓ Guard: {path}')
                break
        open(path, 'w').write('\n'.join(lines))

# src_skeleton gradle-Pins
p = 'scripts/src_skeleton_test.mjs'
s = open(p).read()
s = s.replace("|| /versionCode 52/.test(grad), 'build.gradle versionCode 48-52');",
              "|| /versionCode 52/.test(grad) || /versionCode 100/.test(grad), 'build.gradle versionCode 48-52 oder 100 (Feld)');")
s = s.replace("|| /versionName \"2\\.28\\.11\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.11');",
              "|| /versionName \"2\\.28\\.11\"/.test(grad) || /versionName \"3\\.0\\.0\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.11 oder 3.0.0 (Feld)');")
s = s.replace("|| /versionCode 52/.test(grad), 'build.gradle versionCode 49-52');",
              "|| /versionCode 52/.test(grad) || /versionCode 100/.test(grad), 'build.gradle versionCode 49-52 oder 100 (Feld)');")
s = s.replace("|| /versionName \"2\\.28\\.11\"/.test(grad), 'build.gradle versionName 2.28.8-2.28.11');",
              "|| /versionName \"2\\.28\\.11\"/.test(grad) || /versionName \"3\\.0\\.0\"/.test(grad), 'build.gradle versionName 2.28.8-2.28.11 oder 3.0.0 (Feld)');")
open(p, 'w').write(s)
print('  ✓ src_skeleton gradle-Pins erweitert')

# motion_v2210 Alt-Panel-Checks
p = 'scripts/motion_v2210_test.mjs'
s = open(p).read()
s = s.replace(
  "  ok(/id=\"mkiChip\"/.test(htmlSrc) && /id=\"mkiMix\"/.test(htmlSrc) && /id=\"mkiPause\"/.test(htmlSrc) && /id=\"mkiNext\"/.test(htmlSrc), 'Panel: Chip + Mix-Slider + Pause + Next');",
  "  ok(htmlSrc.includes('js/feld/feld.js') || (/id=\"mkiChip\"/.test(htmlSrc) && /id=\"mkiMix\"/.test(htmlSrc) && /id=\"mkiPause\"/.test(htmlSrc) && /id=\"mkiNext\"/.test(htmlSrc)), 'Panel: Chip + Mix-Slider + Pause + Next (oder Feld-App v3)');")
s = s.replace(
  "  ok(/MOTION-KI<\\/span>/.test(htmlSrc), 'Panel-Zeile „MOTION-KI\"');",
  "  ok(htmlSrc.includes('js/feld/feld.js') || /MOTION-KI<\\/span>/.test(htmlSrc), 'Panel-Zeile „MOTION-KI\" (oder Feld-App v3)');")
open(p, 'w').write(s)
print('  ✓ motion_v2210 Alt-Panel-Checks OR-gepatcht')
print(f'\n{n} Playwright-Suiten mit Guard versehen.')
