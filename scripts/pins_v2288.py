# ═══════════════════════════════════════════════════════════
# pins_v2288.py — Versions-OR-Ketten aller Suites um 2.28.8/49 erweitern
# ═══════════════════════════════════════════════════════════
import io

EDITS = {
  'scripts/physics_filter_test.mjs': [
    ("main.includes(\"const VERSION = '2.28.7'\"), 'main.js VERSION 2.28.5/2.28.6/2.28.7');",
     "main.includes(\"const VERSION = '2.28.7'\") || main.includes(\"const VERSION = '2.28.8'\"), 'main.js VERSION 2.28.5-2.28.8');"),
    ("grad.includes('versionCode 48'), 'build.gradle versionCode 46/47/48');",
     "grad.includes('versionCode 48') || grad.includes('versionCode 49'), 'build.gradle versionCode 46-49');"),
    ("grad.includes('versionName \"2.28.7\"'), 'build.gradle versionName 2.28.5/2.28.6/2.28.7');",
     "grad.includes('versionName \"2.28.7\"') || grad.includes('versionName \"2.28.8\"'), 'build.gradle versionName 2.28.5-2.28.8');"),
  ],
  'scripts/ardy_mirror_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.7';\"));",
     "mainJs.includes(\"const VERSION = '2.28.7';\") || mainJs.includes(\"const VERSION = '2.28.8';\"));"),
    ("(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')));",
     "(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')) || (gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')));"),
  ],
  'scripts/ardy_retry_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.5/2.28.6/2.28.7');",
     "mainJs.includes(\"const VERSION = '2.28.7';\") || mainJs.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.5-2.28.8');"),
    ("(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')), 'versionCode 46/47/48 / versionName 2.28.5/2.28.6/2.28.7');",
     "(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')) || (gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')), 'versionCode 46-49 / versionName 2.28.5-2.28.8');"),
  ],
  'scripts/ardy_probe_test.mjs': [
    ("mainSrc.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.6/2.28.7');",
     "mainSrc.includes(\"const VERSION = '2.28.7';\") || mainSrc.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.6-2.28.8');"),
    ("(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')));",
     "(gradle.includes('versionCode 48') && gradle.includes('versionName \"2.28.7\"')) || (gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')));"),
  ],
  'scripts/ghost_ground_v2281_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.7';\"), 'VERSION 2.28.5/2.28.6/2.28.7');",
     "mainJs.includes(\"const VERSION = '2.28.7';\") || mainJs.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.5-2.28.8');"),
  ],
  'scripts/qpos_v2220_test.mjs': [
    ("main.includes(\"VERSION = '2.28.7'\"), 'VERSION (>= 2.22.0-Pin)');",
     "main.includes(\"VERSION = '2.28.7'\") || main.includes(\"VERSION = '2.28.8'\"), 'VERSION (>= 2.22.0-Pin)');"),
  ],
  'scripts/ui_v2260_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.7';\")) && mainJs.includes('getLivePrompt:')",
     "mainJs.includes(\"const VERSION = '2.28.7';\") || mainJs.includes(\"const VERSION = '2.28.8';\")) && mainJs.includes('getLivePrompt:')"),
    ("gradle.includes('versionCode 48')) && gradle.includes('applicationId \"com.lertrain.app\"');",
     "gradle.includes('versionCode 48') || gradle.includes('versionCode 49')) && gradle.includes('applicationId \"com.lertrain.app\"');"),
  ],
  'scripts/ui_v2270_test.mjs': [
    ("mainSrc.includes(\"const VERSION = '2.28.7'\"));",
     "mainSrc.includes(\"const VERSION = '2.28.7'\") || mainSrc.includes(\"const VERSION = '2.28.8'\"));"),
    ("(gradleSrc.includes('versionCode 48') && gradleSrc.includes('versionName \"2.28.7\"')));",
     "(gradleSrc.includes('versionCode 48') && gradleSrc.includes('versionName \"2.28.7\"')) || (gradleSrc.includes('versionCode 49') && gradleSrc.includes('versionName \"2.28.8\"')));"),
  ],
  'scripts/motionset_v2230_test.mjs': [
    ("mainJs.includes(\"const VERSION = '2.28.7';\")) && mainJs.includes('initTeacherUI();');",
     "mainJs.includes(\"const VERSION = '2.28.7';\") || mainJs.includes(\"const VERSION = '2.28.8';\")) && mainJs.includes('initTeacherUI();');"),
    ("gradle.includes('versionCode 48')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
     "gradle.includes('versionCode 48') || gradle.includes('versionCode 49')) && gradle.includes('applicationId \"com.lertrain.app\"'));"),
  ],
}

for fname, pairs in EDITS.items():
    s = io.open(fname, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            print('WARNUNG: nicht gefunden in ' + fname + ': ' + old[:80])
            continue
        s = s.replace(old, new, 1)
    io.open(fname, 'w', encoding='utf-8').write(s)
    print('OK: ' + fname)
print('fertig')
