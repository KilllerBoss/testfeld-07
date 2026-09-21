#!/usr/bin/env python3
# pins_2289.py — erweitert die Versions-Pins aller Testsuiten auf 2.28.9 / versionCode 50
import re, pathlib

S = pathlib.Path('/home/z/my-project/scripts')
edits = {
    'ghost_ground_v2281_test.mjs': [
        ("mainJs.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.5-2.28.8'",
         "mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.5-2.28.9'"),
    ],
    'motionset_v2230_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.8';\")) && mainJs.includes('initTeacherUI();'",
         "|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\")) && mainJs.includes('initTeacherUI();'"),
        ("|| gradle.includes('versionCode 49')) && gradle.includes('applicationId \"com.lertrain.app\"')",
         "|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50')) && gradle.includes('applicationId \"com.lertrain.app\"')"),
    ],
    'qpos_v2220_test.mjs': [
        ("main.includes(\"VERSION = '2.28.8'\"), 'VERSION (>= 2.22.0-Pin)'",
         "main.includes(\"VERSION = '2.28.8'\") || main.includes(\"VERSION = '2.28.9'\"), 'VERSION (>= 2.22.0-Pin)'"),
    ],
    'ui_v2270_test.mjs': [
        ("mainSrc.includes(\"const VERSION = '2.28.8'\"));",
         "mainSrc.includes(\"const VERSION = '2.28.8'\") || mainSrc.includes(\"const VERSION = '2.28.9'\"));"),
        ("(gradleSrc.includes('versionCode 49') && gradleSrc.includes('versionName \"2.28.8\"')));",
         "(gradleSrc.includes('versionCode 49') && gradleSrc.includes('versionName \"2.28.8\"')) || (gradleSrc.includes('versionCode 50') && gradleSrc.includes('versionName \"2.28.9\"')));"),
    ],
    'src_skeleton_test.mjs': [
        ("ok(/const VERSION = '2\\.28\\.7'/.test(main) || /const VERSION = '2\\.28\\.8'/.test(main), \"main.js VERSION 2.28.7/2.28.8\");",
         "ok(/const VERSION = '2\\.28\\.7'/.test(main) || /const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main), \"main.js VERSION 2.28.7-2.28.9\");"),
        ("ok(/versionCode 48/.test(grad) || /versionCode 49/.test(grad), 'build.gradle versionCode 48/49');",
         "ok(/versionCode 48/.test(grad) || /versionCode 49/.test(grad) || /versionCode 50/.test(grad), 'build.gradle versionCode 48-50');"),
        ("ok(/versionName \"2\\.28\\.7\"/.test(grad) || /versionName \"2\\.28\\.8\"/.test(grad), 'build.gradle versionName 2.28.7/2.28.8');",
         "ok(/versionName \"2\\.28\\.7\"/.test(grad) || /versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.9');"),
        ("ok(/const VERSION = '2\\.28\\.8'/.test(main), \"main.js VERSION '2.28.8'\");",
         "ok(/const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main), \"main.js VERSION '2.28.8'/'2.28.9'\");"),
        ("ok(/versionCode 49/.test(grad), 'build.gradle versionCode 49');",
         "ok(/versionCode 49/.test(grad) || /versionCode 50/.test(grad), 'build.gradle versionCode 49/50');"),
        ("ok(/versionName \"2\\.28\\.8\"/.test(grad), 'build.gradle versionName 2.28.8');",
         "ok(/versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad), 'build.gradle versionName 2.28.8/2.28.9');"),
    ],
    'ui_v2260_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.8';\")) && mainJs.includes('getLivePrompt:')",
         "|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\")) && mainJs.includes('getLivePrompt:')"),
        ("|| gradle.includes('versionCode 49')) && gradle.includes('applicationId \"com.lertrain.app\"')",
         "|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50')) && gradle.includes('applicationId \"com.lertrain.app\"')"),
    ],
    'physics_filter_test.mjs': [
        ("main.includes(\"const VERSION = '2.28.8'\"), 'main.js VERSION 2.28.5-2.28.8'",
         "main.includes(\"const VERSION = '2.28.8'\") || main.includes(\"const VERSION = '2.28.9'\"), 'main.js VERSION 2.28.5-2.28.9'"),
        ("grad.includes('versionCode 48') || grad.includes('versionCode 49'), 'build.gradle versionCode 46-49'",
         "grad.includes('versionCode 48') || grad.includes('versionCode 49') || grad.includes('versionCode 50'), 'build.gradle versionCode 46-50'"),
        ("grad.includes('versionName \"2.28.8\"'), 'build.gradle versionName 2.28.5-2.28.8'",
         "grad.includes('versionName \"2.28.8\"') || grad.includes('versionName \"2.28.9\"'), 'build.gradle versionName 2.28.5-2.28.9'"),
    ],
    'ardy_probe_test.mjs': [
        ("mainSrc.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.6-2.28.8'",
         "mainSrc.includes(\"const VERSION = '2.28.8';\") || mainSrc.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.6-2.28.9'"),
        ("(gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')));",
         "(gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')) || (gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')));"),
    ],
    'ardy_retry_test.mjs': [
        ("mainJs.includes(\"const VERSION = '2.28.8';\"), 'VERSION 2.28.5-2.28.8'",
         "mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.5-2.28.9'"),
        ("(gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')), 'versionCode 46-49 / versionName 2.28.5-2.28.8'",
         "(gradle.includes('versionCode 49') && gradle.includes('versionName \"2.28.8\"')) || (gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')), 'versionCode 46-50 / versionName 2.28.5-2.28.9'"),
    ],
}

for fname, pairs in edits.items():
    p = S / fname
    txt = p.read_text(encoding='utf-8')
    for old, new in pairs:
        if old not in txt:
            print(f'⚠ NICHT GEFUNDEN in {fname}: {old[:70]}…')
            continue
        txt = txt.replace(old, new, 1)
    p.write_text(txt, encoding='utf-8')
    print(f'✓ {fname}')
print('fertig')
