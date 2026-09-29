#!/usr/bin/env python3
# pins_v35_cleanup.py — Duplikate aus Doppel-Läufen entfernen + Labels auf 3.5.0 bringen
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = [
    'feld_test.mjs', 'feld_cmd_test.mjs', 'feld_schubser_test.mjs',
    'feld_ground_phone_test.mjs', 'feld_live_v33_test.mjs', 'feld_v340_test.mjs',
    'ardy_probe_test.mjs', 'ardy_retry_test.mjs', 'ardy_mirror_test.mjs',
    'ardy_ghost_only_test.mjs', 'ardy_smooth_test.mjs',
    'src_skeleton_test.mjs', 'physics_filter_test.mjs',
    'motionset_v2230_test.mjs', 'ui_v2260_test.mjs', 'ui_v2270_test.mjs',
]

# bekannte 3.5.0-Erweiterungs-Snippets (literal) — X || X+ → X
SNIPPETS = [
    "|| VERSION === '3.5.0'",
    "|| VERSION_CODE === 105",
    "|| (gradle.includes('versionCode 105') && gradle.includes('versionName \"3.5.0\"'))",
    "|| (gradleSrc.includes('versionCode 105') && gradleSrc.includes('versionName \"3.5.0\"'))",
    "|| vjs.includes(\"export const VERSION = '3.5.0';\")",
    "|| vjs.includes('export const VERSION_CODE = 105;')",
    "|| (/versionCode 105/.test(gradle) && /versionName \"3\\.4\\.0\"/.test(gradle))",
    "|| /versionCode 105/.test(grad)",
    "|| /versionCode 105/.test(gradle)",
    "|| /versionCode 105/.test(gradleSrc)",
    "|| grad.includes('versionCode 105')",
    "|| grad.includes('versionName \"3.5.0\"')",
    "|| gradle.includes('versionCode 105')",
    "|| gradle.includes('versionName \"3.5.0\"')",
]

# veraltete Labels (kosmetisch)
LABELS = [
    ("'VERSION = 3.2.0/3.3.0/3.4.0'", "'VERSION = 3.2.0/3.3.0/3.4.0/3.5.0'"),
    ("'VERSION_CODE = 102/103/104'", "'VERSION_CODE = 102/103/104/105'"),
    ("'version.js VERSION = 3.3.0/3.4.0'", "'version.js VERSION = 3.3.0/3.4.0/3.5.0'"),
    ("'version.js VERSION_CODE = 103/104'", "'version.js VERSION_CODE = 103/104/105'"),
    ("'3.2.0/102, 3.3.0/103 oder 3.4.0/104 (Schubser + Boden + Handy in EINEM Release)'",
     "'3.2.0/102, 3.3.0/103, 3.4.0/104 oder 3.5.0/105 (Schubser + Boden + Handy in EINEM Release)'"),
    ("'build.gradle versionCode 48-52 oder 100 (Feld)'", "'build.gradle versionCode 48-52/100-105 (Feld)'"),
    ("'build.gradle versionCode 49-52 oder 100 (Feld)'", "'build.gradle versionCode 49-52/100-105 (Feld)'"),
    ("'build.gradle versionCode 46-52 oder 100 (Feld)'", "'build.gradle versionCode 46-52/100-105 (Feld)'"),
    ("'build.gradle versionName 2.28.5-2.28.11 oder 3.0.0 (Feld)'", "'build.gradle versionName 2.28.5-2.28.11/3.0.0-3.5.0 (Feld)'"),
]

total = 0
for f in FILES:
    p = os.path.join(ROOT, f)
    if not os.path.exists(p):
        continue
    s = io.open(p, encoding='utf-8').read()
    orig = s
    n = 0
    for snip in SNIPPETS:
        pat = re.compile(re.escape(snip) + r"(\s*" + re.escape(snip) + r")+")
        s, c = pat.subn(lambda m, s0=snip: s0, s)
        n += c
    for old, new in LABELS:
        if old in s:
            s = s.replace(old, new)
            n += 1
    if s != orig:
        io.open(p, 'w', encoding='utf-8').write(s)
        total += n
        print('%-28s %d Bereinigungen' % (f, n))
    else:
        print('%-28s sauber' % f)
print('GESAMT:', total)
