# ═══════════════════════════════════════════════════════════
# pins_v2287.py — Versions-OR-Ketten aller Suites um 2.28.7/48 erweitern
# ═══════════════════════════════════════════════════════════
import io, sys

EDITS = {
  'scripts/physics_filter_test.mjs': [
    ("ok(main.includes(\"const VERSION = '2.28.5'\") || main.includes(\"const VERSION = '2.28.6'\"), 'main.js VERSION 2.28.5/2.28.6');",
     "ok(main.includes(\"const VERSION = '2.28.5'\") || main.includes(\"const VERSION = '2.28.6'\") || main.includes(\"const VERSION = '2.28.7'\"), 'main.js VERSION 2.28.5/2.28.6/2.28.7');"),
    ("ok(grad.includes('versionCode 46') || grad.includes('versionCode 47'), 'build.gradle versionCode 46/47');",
     "ok(grad.includes('versionCode 46') || grad.includes('versionCode 47') || grad.includes('versionCode 48'), 'build.gradle versionCode 46/47/48');"),
    ("ok(grad.includes('versionName \"2.28.5\"') || grad.includes('versionName \"2.28.6\"'), 'build.gradle versionName 2.28.5/2.28.6');",
     "ok(grad.includes('versionName \"2.28.5\"') || grad.includes('versionName \"2.28.6\"') || grad.includes('versionName \"2.28.7\"'), 'build.gradle versionName 2.28.5/2.28.6/2.28.7');"),
  ],
  'scripts/ardy_mirror_test.mjs': [
    ("assert.ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\"));",
     "assert.ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\") || mainJs.includes(\"const VERSION = '2.28.7';\"));"),
    ("assert.ok((gradle.includes('versionCode 46') && gradle.includes('versionName \"2.28.5\"')) || (gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"')));",
     "assert.ok((gradle.includes('versionCode 46') && gradle.includes('versionName \"2.28.5\"')) || (gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"')) || (gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')));"),
  ],
  'scripts/ardy_retry_test.mjs': [
    ("ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\"), 'VERSION 2.28.5/2.28.6');",
     "ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\") || mainJs.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.5/2.28.6/2.28.7');"),
    ("ok((gradle.includes('versionCode 46') && gradle.includes('versionName \"2.28.5\"')) || (gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"')), 'versionCode 46/47 / versionName 2.28.5/2.28.6');",
     "ok((gradle.includes('versionCode 46') && gradle.includes('versionName \"2.28.5\"')) || (gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"')) || (gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')), 'versionCode 46/47/48 / versionName 2.28.5/2.28.6/2.28.7');"),
  ],
  'scripts/ardy_probe_test.mjs': [
    ("assert.ok(mainSrc.includes(\"const VERSION = '2.28.6';\"), 'VERSION 2.28.6');",
     "assert.ok(mainSrc.includes(\"const VERSION = '2.28.6';\") || mainSrc.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.6/2.28.7');"),
    ("assert.ok(gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"'));",
     "assert.ok((gradle.includes('versionCode 47') && gradle.includes('versionName \"2.28.6\"')) || (gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')));"),
  ],
  'scripts/ghost_ground_v2281_test.mjs': [
    ("ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\"), 'VERSION 2.28.5/2.28.6');",
     "ok(mainJs.includes(\"const VERSION = '2.28.5';\") || mainJs.includes(\"const VERSION = '2.28.6';\") || mainJs.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.5/2.28.6/2.28.7');"),
  ],
  'scripts/qpos_v2220_test.mjs': [
    ("main.includes(\"VERSION = '2.28.6'\"), 'VERSION (>= 2.22.0-Pin)');",
     "main.includes(\"VERSION = '2.28.6'\") || main.includes(\"VERSION = '2.28.7'\"), 'VERSION (>= 2.22.0-Pin)');"),
  ],
  'scripts/ui_v2260_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.6';\")) && mainJs.includes('getLivePrompt:')",
     "mainJs.includes(\"const VERSION = '2.28.6';\") || mainJs.includes(\"const VERSION = '2.28.7';\")) && mainJs.includes('getLivePrompt:')"),
    ("gradle.includes('versionCode 46') || gradle.includes('versionCode 47')) && gradle.includes('applicationId \"com.lertrain.app\"');",
     "gradle.includes('versionCode 46') || gradle.includes('versionCode 47') || gradle.includes('versionCode 48')) && gradle.includes('applicationId \"com.lertrain.app\"');"),
  ],
  'scripts/ui_v2270_test.mjs': [
    ("mainSrc.includes(\"const VERSION = '2.28.6'\"));",
     "mainSrc.includes(\"const VERSION = '2.28.6'\") || mainSrc.includes(\"const VERSION = '2.28.7'\"));"),
    ("(gradleSrc.includes('versionCode 47') && gradleSrc.includes('versionName \"2.28.6\"')));",
     "(gradleSrc.includes('versionCode 47') && gradleSrc.includes('versionName \"2.28.6\"')) || (gradleSrc.includes('versionCode 48') && gradleSrc.includes('versionName \"2.28.7\"')));"),
  ],
}

for fname, pairs in EDITS.items():
    s = io.open(fname, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            print('WARNUNG: nicht gefunden in ' + fname + ': ' + old[:70])
            continue
        s = s.replace(old, new, 1)
    io.open(fname, 'w', encoding='utf-8').write(s)
    print('OK: ' + fname)
print('fertig')
