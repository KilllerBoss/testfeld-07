# -*- coding: utf-8 -*-
# patch_v2280.py — VERSION/Gradle-Bump + Test-Pins für v2.28.0 (Geist lenken + Boden-Garantie)
def patch(path, pairs, must=True):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            if must:
                raise AssertionError((path, old[:70]))
            continue
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write(s)
    print('OK', path)

# 1) main.js VERSION
patch('app/src/main/assets/www/js/main.js', [(
    "const VERSION = '2.27.1'; // v2.27.1:",
    "const VERSION = '2.28.0'; // v2.28.0: GEIST LENKEN (Stick f\u00fchrt die Referenz in JEDEM Modus \u2014 Geist = Trainingsziel) + BODEN-GARANTIE (Geist/Skeleton werden auf den Boden gehoben, nie mehr im Boden). v2.27.1:",
)])

# 2) build.gradle
patch('app/build.gradle', [(
    'versionCode 40\n        versionName "2.27.1"',
    'versionCode 41\n        versionName "2.28.0"',
)])

# 3) ui_v2270: Pins lockern (2.28.0/41 akzeptieren)
patch('scripts/ui_v2270_test.mjs', [
    ("check('VERSION 2.27.1 in main.js', mainSrc.includes(\"const VERSION = '2.27.1'\"));",
     "check('VERSION 2.28.0 in main.js', mainSrc.includes(\"const VERSION = '2.28.0'\"));"),
    ("check('versionCode 40 / versionName 2.27.1', gradleSrc.includes('versionCode 40') && gradleSrc.includes('versionName \"2.27.1\"'));",
     "check('versionCode 41 / versionName 2.28.0', gradleSrc.includes('versionCode 41') && gradleSrc.includes('versionName \"2.28.0\"'));"),
])

# 4) ui_v2260: lockern (2.28.0 / 41 erlauben)
patch('scripts/ui_v2260_test.mjs', [
    ('mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';")',
     'mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';") || mainJs.includes("const VERSION = \'2.28.0\';")'),
    ("(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40'))",
     "(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40') || gradle.includes('versionCode 41'))"),
])

# 5) motionset: lockern
patch('scripts/motionset_v2230_test.mjs', [
    ('(mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';"))',
     '(mainJs.includes("const VERSION = \'2.26.0\';") || mainJs.includes("const VERSION = \'2.27.0\';") || mainJs.includes("const VERSION = \'2.27.1\';") || mainJs.includes("const VERSION = \'2.28.0\';"))'),
    ("(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40'))",
     "(gradle.includes('versionCode 38') || gradle.includes('versionCode 39') || gradle.includes('versionCode 40') || gradle.includes('versionCode 41'))"),
])

print('ALLE PATCHES OK')
