#!/usr/bin/env python3
# patch_v2281_tests.py — Pins der Bestandstests auf 2.28.1 / versionCode 42
import io, re

def rw(path, pairs):
    with io.open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    orig = src
    for old, new in pairs:
        if old not in src:
            print('  (übersprungen, nicht gefunden: %s...)' % old[:80])
            continue
        src = src.replace(old, new)
    if src != orig:
        with io.open(path, 'w', encoding='utf-8') as f:
            f.write(src)
        print('OK: ' + path)
    else:
        print('UNVERÄNDERT: ' + path)

S = '/home/z/my-project/scripts/'

# ui_v2270_test.mjs: Pins 2.28.0/41 → 2.28.1/42
rw(S + 'ui_v2270_test.mjs', [
    ("check('VERSION 2.28.0 in main.js', mainSrc.includes(\"const VERSION = '2.28.0'\"));",
     "check('VERSION 2.28.1 in main.js', mainSrc.includes(\"const VERSION = '2.28.1'\"));"),
    ("check('versionCode 41 / versionName 2.28.0', gradleSrc.includes('versionCode 41') && gradleSrc.includes('versionName \"2.28.0\"'));",
     "check('versionCode 42 / versionName 2.28.1', gradleSrc.includes('versionCode 42') && gradleSrc.includes('versionName \"2.28.1\"'));"),
])

# ui_v2260_test.mjs: lockere Pins erweitern
rw(S + 'ui_v2260_test.mjs', [
    ("mainJs.includes(\"const VERSION = '2.28.0';\") && mainJs.includes('getLivePrompt:')",
     "mainJs.includes(\"const VERSION = '2.28.0';\") || mainJs.includes(\"const VERSION = '2.28.1';\")) && mainJs.includes('getLivePrompt:')"),
    ("gradle.includes('versionCode 41')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
     "gradle.includes('versionCode 41') || gradle.includes('versionCode 42')) && gradle.includes('applicationId \"com.lertrain.app\"'));"),
])

# motionset_v2230_test.mjs: lockere Pins erweitern
rw(S + 'motionset_v2230_test.mjs', [
    ("mainJs.includes(\"const VERSION = '2.28.0';\")) && mainJs.includes('initTeacherUI();')",
     "mainJs.includes(\"const VERSION = '2.28.0';\") || mainJs.includes(\"const VERSION = '2.28.1';\")) && mainJs.includes('initTeacherUI();')"),
    ("gradle.includes('versionCode 41')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
     "gradle.includes('versionCode 41') || gradle.includes('versionCode 42')) && gradle.includes('applicationId \"com.lertrain.app\"'));"),
])

# qpos_v2220_test.mjs: lockere Pins erweitern
rw(S + 'qpos_v2220_test.mjs', [
    ("main.includes(\"VERSION = '2.28.0'\"), 'VERSION (>= 2.22.0-Pin)');",
     "main.includes(\"VERSION = '2.28.0'\") || main.includes(\"VERSION = '2.28.1'\"), 'VERSION (>= 2.22.0-Pin)');"),
])
print('Test-Pins aktualisiert.')
