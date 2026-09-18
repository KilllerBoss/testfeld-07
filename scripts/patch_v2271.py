# -*- coding: utf-8 -*-
# patch_v2271.py — VERSION/Gradle-Bump + Test-Pins für v2.27.1
def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:70])
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write(s)
    print('OK', path)

OLD_VER_COMMENT = "const VERSION = '2.27.1'; // v2.27.1: Fix \u201eCannot read properties of undefined (reading 'run')\u201c — Session-Key text_encoder→textEncoder + klare Fehlermeldungen. v2.27.0:"

# 1) main.js VERSION
patch('app/src/main/assets/www/js/main.js', [(
    "const VERSION = '2.27.0'; // v2.27.0:",
    OLD_VER_COMMENT,
)])

# 2) build.gradle
patch('app/build.gradle', [(
    'versionCode 39\n        versionName "2.27.0"',
    'versionCode 40\n        versionName "2.27.1"',
)])

# 3) ui_v2270: Pins auf 2.27.1/40
patch('scripts/ui_v2270_test.mjs', [
    ("//   \u25b8 Pins: VERSION 2.27.0, versionCode 39, /ardymodel/-Handler + Bridge",
     "//   \u25b8 Pins: VERSION 2.27.1, versionCode 40, /ardymodel/-Handler + Bridge"),
    ("check('VERSION 2.27.0 in main.js', mainSrc.includes(\"const VERSION = '2.27.0'\"));",
     "check('VERSION 2.27.1 in main.js', mainSrc.includes(\"const VERSION = '2.27.1'\"));"),
    ("check('versionCode 39 / versionName 2.27.0', gradleSrc.includes('versionCode 39') && gradleSrc.includes('versionName \"2.27.0\"'));",
     "check('versionCode 40 / versionName 2.27.1', gradleSrc.includes('versionCode 40') && gradleSrc.includes('versionName \"2.27.1\"'));"),
])

# 4) ui_v2260: lockern (2.27.1 / 40 erlauben)
patch('scripts/ui_v2260_test.mjs', [
    ('mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';")',
     'mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';")'),
    ("(gradle.includes('versionCode 38') || gradle.includes('versionCode 39'))",
     "(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40'))"),
])

# 5) motionset: lockern
patch('scripts/motionset_v2230_test.mjs', [
    ('(mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';"))',
     '(mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';"))'),
    ("(gradle.includes('versionCode 38') || gradle.includes('versionCode 39'))",
     "(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40'))"),
])

print('ALLE PATCHES OK')
