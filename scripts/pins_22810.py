#!/usr/bin/env python3
# pins_22810.py — erweitert die Versions-Pins aller Testsuiten auf 2.28.10 / versionCode 51
import re, pathlib

S = pathlib.Path('/home/z/my-project/scripts')
edits = {
    'ghost_ground_v2281_test.mjs': [
        ("mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.5-2.28.9'",
         "mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.5-2.28.10'"),
    ],
    'motionset_v2230_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\")) && mainJs.includes('initTeacherUI();'",
         "|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\")) && mainJs.includes('initTeacherUI();'"),
        ("|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50')) && gradle.includes('applicationId \"com.lertrain.app\"')",
         "|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50') || gradle.includes('versionCode 51')) && gradle.includes('applicationId \"com.lertrain.app\"')"),
    ],
    'qpos_v2220_test.mjs': [
        ("main.includes(\"VERSION = '2.28.8'\") || main.includes(\"VERSION = '2.28.9'\"), 'VERSION (>= 2.22.0-Pin)'",
         "main.includes(\"VERSION = '2.28.8'\") || main.includes(\"VERSION = '2.28.9'\") || main.includes(\"VERSION = '2.28.10'\"), 'VERSION (>= 2.22.0-Pin)'"),
    ],
    'ui_v2270_test.mjs': [
        ("mainSrc.includes(\"const VERSION = '2.28.8'\") || mainSrc.includes(\"const VERSION = '2.28.9'\"));",
         "mainSrc.includes(\"const VERSION = '2.28.8'\") || mainSrc.includes(\"const VERSION = '2.28.9'\") || mainSrc.includes(\"const VERSION = '2.28.10'\"));"),
        ("(gradleSrc.includes('versionCode 49') && gradleSrc.includes('versionName \"2.28.8\"')) || (gradleSrc.includes('versionCode 50') && gradleSrc.includes('versionName \"2.28.9\"')));",
         "(gradleSrc.includes('versionCode 49') && gradleSrc.includes('versionName \"2.28.8\"')) || (gradleSrc.includes('versionCode 50') && gradleSrc.includes('versionName \"2.28.9\"')) || (gradleSrc.includes('versionCode 51') && gradleSrc.includes('versionName \"2.28.10\"')));"),
    ],
    'src_skeleton_test.mjs': [
        ("ok(/const VERSION = '2\\.28\\.7'/.test(main) || /const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main), \"main.js VERSION 2.28.7-2.28.9\");",
         "ok(/const VERSION = '2\\.28\\.7'/.test(main) || /const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main) || /const VERSION = '2\\.28\\.10'/.test(main), \"main.js VERSION 2.28.7-2.28.10\");"),
        ("ok(/versionCode 48/.test(grad) || /versionCode 49/.test(grad) || /versionCode 50/.test(grad), 'build.gradle versionCode 48-50');",
         "ok(/versionCode 48/.test(grad) || /versionCode 49/.test(grad) || /versionCode 50/.test(grad) || /versionCode 51/.test(grad), 'build.gradle versionCode 48-51');"),
        ("ok(/versionName \"2\\.28\\.7\"/.test(grad) || /versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.9');",
         "ok(/versionName \"2\\.28\\.7\"/.test(grad) || /versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad) || /versionName \"2\\.28\\.10\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.10');"),
        ("ok(/const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main), \"main.js VERSION '2.28.8'/'2.28.9'\");",
         "ok(/const VERSION = '2\\.28\\.8'/.test(main) || /const VERSION = '2\\.28\\.9'/.test(main) || /const VERSION = '2\\.28\\.10'/.test(main), \"main.js VERSION '2.28.8'-'2.28.10'\");"),
        ("ok(/versionCode 49/.test(grad) || /versionCode 50/.test(grad), 'build.gradle versionCode 49/50');",
         "ok(/versionCode 49/.test(grad) || /versionCode 50/.test(grad) || /versionCode 51/.test(grad), 'build.gradle versionCode 49-51');"),
        ("ok(/versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad), 'build.gradle versionName 2.28.8/2.28.9');",
         "ok(/versionName \"2\\.28\\.8\"/.test(grad) || /versionName \"2\\.28\\.9\"/.test(grad) || /versionName \"2\\.28\\.10\"/.test(grad), 'build.gradle versionName 2.28.8-2.28.10');"),
    ],
    'ui_v2260_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\")) && mainJs.includes('getLivePrompt:')",
         "|| mainJs.includes(\"const VERSION = '2.28.8';\") || mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\")) && mainJs.includes('getLivePrompt:')"),
        ("|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50')) && gradle.includes('applicationId \"com.lertrain.app\"')",
         "|| gradle.includes('versionCode 49') || gradle.includes('versionCode 50') || gradle.includes('versionCode 51')) && gradle.includes('applicationId \"com.lertrain.app\"')"),
    ],
    'physics_filter_test.mjs': [
        ("main.includes(\"const VERSION = '2.28.9'\"), 'main.js VERSION 2.28.5-2.28.9');",
         "main.includes(\"const VERSION = '2.28.9'\") || main.includes(\"const VERSION = '2.28.10'\"), 'main.js VERSION 2.28.5-2.28.10');"),
        ("grad.includes('versionCode 50'), 'build.gradle versionCode 46-50');",
         "grad.includes('versionCode 50') || grad.includes('versionCode 51'), 'build.gradle versionCode 46-51');"),
        ("grad.includes('versionName \"2.28.9\"'), 'build.gradle versionName 2.28.5-2.28.9');",
         "grad.includes('versionName \"2.28.9\"') || grad.includes('versionName \"2.28.10\"'), 'build.gradle versionName 2.28.5-2.28.10');"),
    ],
    'ardy_probe_test.mjs': [
        ("mainSrc.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.6-2.28.9');",
         "mainSrc.includes(\"const VERSION = '2.28.9';\") || mainSrc.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.6-2.28.10');"),
        ("(gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')));",
         "(gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')));"),
    ],
    'ardy_retry_test.mjs': [
        ("mainJs.includes(\"const VERSION = '2.28.9';\"), 'VERSION 2.28.5-2.28.9');",
         "mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.5-2.28.10');"),
        ("(gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')), 'versionCode 46-50 / versionName 2.28.5-2.28.9');",
         "(gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')), 'versionCode 46-51 / versionName 2.28.5-2.28.10');"),
    ],
    'ardy_mirror_test.mjs': [
        ("    assert.ok(mainJs.includes(\"const VERSION = '2.28.9';\"));",
         "    assert.ok(mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\"));"),
        ("    assert.ok(gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"'));",
         "    assert.ok((gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')));"),
    ],
}

applied = 0
for fname, pairs in edits.items():
    p = S / fname
    if not p.exists():
        print('FEHLT:', fname)
        continue
    src = p.read_text(encoding='utf-8')
    for old, new in pairs:
        if old in src:
            src = src.replace(old, new, 1)
            applied += 1
        elif new in src:
            print('bereits ok:', fname, '→', new[:60])
        else:
            print('NICHT GEFUNDEN in', fname, ':', old[:70])
    p.write_text(src, encoding='utf-8')
print('angewendet:', applied)
