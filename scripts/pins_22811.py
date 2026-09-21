#!/usr/bin/env python3
# pins_22811.py — erweitert die Versions-Pins aller Testsuiten auf 2.28.11 / versionCode 52
import pathlib

S = pathlib.Path('/home/z/my-project/scripts')
edits = {
    'ardy_ghost_only_test.mjs': [
        ("ok(mainJs.includes(\"const VERSION = '2.28.10';\"), \"main.js VERSION '2.28.10'\");",
         "ok(mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\"), \"main.js VERSION '2.28.10'/'2.28.11'\");"),
        ("ok(gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"'), 'build.gradle 51 / 2.28.10');",
         "ok((gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')) || (gradle.includes('versionCode 52') && gradle.includes('versionName \"2.28.11\"')), 'build.gradle 51/2.28.10 oder 52/2.28.11');"),
    ],
    'ardy_retry_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.5-2.28.10');",
         "|| mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\"), 'VERSION 2.28.5-2.28.11');"),
        ("|| (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')), 'versionCode 46-51 / versionName 2.28.5-2.28.10');",
         "|| (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')) || (gradle.includes('versionCode 52') && gradle.includes('versionName \"2.28.11\"')), 'versionCode 46-52 / versionName 2.28.5-2.28.11');"),
    ],
    'physics_filter_test.mjs': [
        ("|| main.includes(\"const VERSION = '2.28.10'\"), 'main.js VERSION 2.28.5-2.28.10');",
         "|| main.includes(\"const VERSION = '2.28.10'\") || main.includes(\"const VERSION = '2.28.11'\"), 'main.js VERSION 2.28.5-2.28.11');"),
        ("|| grad.includes('versionCode 51'), 'build.gradle versionCode 46-51');",
         "|| grad.includes('versionCode 51') || grad.includes('versionCode 52'), 'build.gradle versionCode 46-52');"),
        ("|| grad.includes('versionName \"2.28.10\"'), 'build.gradle versionName 2.28.5-2.28.10');",
         "|| grad.includes('versionName \"2.28.10\"') || grad.includes('versionName \"2.28.11\"'), 'build.gradle versionName 2.28.5-2.28.11');"),
    ],
    'src_skeleton_test.mjs': [
        ("|| /const VERSION = '2\\.28\\.10'/.test(main), \"main.js VERSION 2.28.7-2.28.10\");",
         "|| /const VERSION = '2\\.28\\.10'/.test(main) || /const VERSION = '2\\.28\\.11'/.test(main), \"main.js VERSION 2.28.7-2.28.11\");"),
        ("|| /versionCode 51/.test(grad), 'build.gradle versionCode 48-51');",
         "|| /versionCode 51/.test(grad) || /versionCode 52/.test(grad), 'build.gradle versionCode 48-52');"),
        ("|| /versionName \"2\\.28\\.10\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.10');",
         "|| /versionName \"2\\.28\\.10\"/.test(grad) || /versionName \"2\\.28\\.11\"/.test(grad), 'build.gradle versionName 2.28.7-2.28.11');"),
        ("|| /const VERSION = '2\\.28\\.10'/.test(main), \"main.js VERSION '2.28.8'-'2.28.10'\");",
         "|| /const VERSION = '2\\.28\\.10'/.test(main) || /const VERSION = '2\\.28\\.11'/.test(main), \"main.js VERSION '2.28.8'-'2.28.11'\");"),
        ("|| /versionCode 51/.test(grad), 'build.gradle versionCode 49-51');",
         "|| /versionCode 51/.test(grad) || /versionCode 52/.test(grad), 'build.gradle versionCode 49-52');"),
        ("|| /versionName \"2\\.28\\.10\"/.test(grad), 'build.gradle versionName 2.28.8-2.28.10');",
         "|| /versionName \"2\\.28\\.10\"/.test(grad) || /versionName \"2\\.28\\.11\"/.test(grad), 'build.gradle versionName 2.28.8-2.28.11');"),
    ],
    'qpos_v2220_test.mjs': [
        ("|| main.includes(\"VERSION = '2.28.10'\"), 'VERSION (>= 2.22.0-Pin)');",
         "|| main.includes(\"VERSION = '2.28.10'\") || main.includes(\"VERSION = '2.28.11'\"), 'VERSION (>= 2.22.0-Pin)');"),
        ("/versionCode (3[4-9]|4[0-9]|5[0-1])/.test(gradle), 'build.gradle (>= 34-Pin, LerTrain-Package)');",
         "/versionCode (3[4-9]|4[0-9]|5[0-2])/.test(gradle), 'build.gradle (>= 34-Pin, LerTrain-Package)');"),
    ],
    'ghost_ground_v2281_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.5-2.28.10');",
         "|| mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\"), 'VERSION 2.28.5-2.28.11');"),
    ],
    'ui_v2260_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.10';\")) && mainJs.includes('getLivePrompt:')",
         "|| mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\")) && mainJs.includes('getLivePrompt:')"),
        ("|| gradle.includes('versionCode 51')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
         "|| gradle.includes('versionCode 51') || gradle.includes('versionCode 52')) && gradle.includes('applicationId \"com.lertrain.app\"'));"),
    ],
    'ui_v2270_test.mjs': [
        ("|| mainSrc.includes(\"const VERSION = '2.28.10'\"));",
         "|| mainSrc.includes(\"const VERSION = '2.28.10'\") || mainSrc.includes(\"const VERSION = '2.28.11'\"));"),
        ("|| (gradleSrc.includes('versionCode 51') && gradleSrc.includes('versionName \"2.28.10\"')));",
         "|| (gradleSrc.includes('versionCode 51') && gradleSrc.includes('versionName \"2.28.10\"')) || (gradleSrc.includes('versionCode 52') && gradleSrc.includes('versionName \"2.28.11\"')));"),
    ],
    'motionset_v2230_test.mjs': [
        ("|| mainJs.includes(\"const VERSION = '2.28.10';\")) && mainJs.includes('initTeacherUI();')",
         "|| mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\")) && mainJs.includes('initTeacherUI();')"),
        ("|| gradle.includes('versionCode 51')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
         "|| gradle.includes('versionCode 51') || gradle.includes('versionCode 52')) && gradle.includes('applicationId \"com.lertrain.app\"'));"),
    ],
    'ardy_mirror_test.mjs': [
        ("assert.ok(mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\"));",
         "assert.ok(mainJs.includes(\"const VERSION = '2.28.9';\") || mainJs.includes(\"const VERSION = '2.28.10';\") || mainJs.includes(\"const VERSION = '2.28.11';\"));"),
        ("assert.ok((gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')));",
         "assert.ok((gradle.includes('versionCode 50') && gradle.includes('versionName \"2.28.9\"')) || (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')) || (gradle.includes('versionCode 52') && gradle.includes('versionName \"2.28.11\"')));"),
    ],
    'ardy_probe_test.mjs': [
        ("|| mainSrc.includes(\"const VERSION = '2.28.10';\"), 'VERSION 2.28.6-2.28.10');",
         "|| mainSrc.includes(\"const VERSION = '2.28.10';\") || mainSrc.includes(\"const VERSION = '2.28.11';\"), 'VERSION 2.28.6-2.28.11');"),
        ("|| (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')));",
         "|| (gradle.includes('versionCode 51') && gradle.includes('versionName \"2.28.10\"')) || (gradle.includes('versionCode 52') && gradle.includes('versionName \"2.28.11\"')));"),
    ],
    'canvas_v2200_test.mjs': [
        ("ok(/versionCode (3[2-9]|4[0-9]|5[0-1])/.test(await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8')), 'build.gradle versionCode ≥ 32 (v2.21.0: Pin auf ≥ gelockert)');",
         "ok(/versionCode (3[2-9]|4[0-9]|5[0-2])/.test(await readFile(path.join(ROOT, 'app/build.gradle'), 'utf8')), 'build.gradle versionCode ≥ 32 (v2.21.0: Pin auf ≥ gelockert)');"),
    ],
}

applied = skipped = 0
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
            skipped += 1
        else:
            print('NICHT GEFUNDEN in', fname, ':', old[:80])
    p.write_text(src, encoding='utf-8')
print(f'pins_22811: {applied} Edits angewandt, {skipped} bereits ok')
