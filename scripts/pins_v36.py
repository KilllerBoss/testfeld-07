#!/usr/bin/env python3
# pins_v36.py — Version-Pins aller Suiten auf Feld v3.6.0 (versionCode 106) erweitern
# Bewährtes Muster (pins_v35.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = [
    'feld_test.mjs', 'feld_cmd_test.mjs', 'feld_schubser_test.mjs',
    'feld_ground_phone_test.mjs', 'feld_live_v33_test.mjs', 'feld_v340_test.mjs',
    'feld_v350_test.mjs',
    'ardy_probe_test.mjs', 'ardy_retry_test.mjs', 'ardy_mirror_test.mjs',
    'ardy_ghost_only_test.mjs', 'ardy_smooth_test.mjs',
    'src_skeleton_test.mjs', 'physics_filter_test.mjs',
    'motionset_v2230_test.mjs', 'ui_v2260_test.mjs', 'ui_v2270_test.mjs',
]

PAIR_LEFT_GRADLE = r"gradle\.includes\('versionCode 105'\) && gradle\.includes\('versionName \"3\.5\.0\"'\)"
PAIR_LEFT_GRADLESRC = r"gradleSrc\.includes\('versionCode 105'\) && gradleSrc\.includes\('versionName \"3\.5\.0\"'\)"

def bare_rules():
    """Bare-Erweiterungen — mit Lookahead/Lookbehind-Guards gegen &&-Paare."""
    out = []
    for var in ('gradle', 'gradleSrc', 'grad'):
        v = re.escape(var)
        out.append((
            re.compile(r"\b%s\.includes\('versionCode 105'\)(?!\s*&&\s*%s\.includes\('versionName \"3\.5\.0\"'\))" % (v, v)),
            lambda m, var=var: "%s.includes('versionCode 105') || %s.includes('versionCode 106')" % (var, var),
        ))
        out.append((
            re.compile(r"(?<!%s\.includes\('versionCode 105'\) && )%s\.includes\('versionName \"3\.5\.0\"'\)(?!\s*&&\s*%s)" % (v, v, v)),
            lambda m, var=var: "%s.includes('versionName \"3.5.0\"') || %s.includes('versionName \"3.6.0\"')" % (var, var),
        ))
        out.append((
            re.compile(r"/versionCode 105/\.test\(%s\)(?!\s*&&)" % v),
            lambda m, var=var: "/versionCode 105/.test(%s) || /versionCode 106/.test(%s)" % (var, var),
        ))
        out.append((
            re.compile(r"(?<!/versionCode 105/\.test\(%s\) && )/versionName \"3\\\.5\\\.0\"/\.test\(%s\)(?!\s*&&)" % (v, v)),
            lambda m, var=var: "/versionName \"3\\.5\\.0\"/.test(%s) || /versionName \"3\\.6\\.0\"/.test(%s)" % (var, var),
        ))
    out.append((
        re.compile(r"\|\| VERSION === '3\.5\.0'"),
        lambda m: "|| VERSION === '3.5.0' || VERSION === '3.6.0'",
    ))
    out.append((
        re.compile(r"\|\| VERSION_CODE === 105\b"),
        lambda m: "|| VERSION_CODE === 105 || VERSION_CODE === 106",
    ))
    return out

BARES = bare_rules()

PAIRS = [
    (PAIR_LEFT_GRADLE,
     "(gradle.includes('versionCode 105') && gradle.includes('versionName \"3.5.0\"') || (gradle.includes('versionCode 106') && gradle.includes('versionName \"3.6.0\"')))"),
    (PAIR_LEFT_GRADLESRC,
     "(gradleSrc.includes('versionCode 105') && gradleSrc.includes('versionName \"3.5.0\"') || (gradleSrc.includes('versionCode 106') && gradleSrc.includes('versionName \"3.6.0\"')))"),
    (r"\(VERSION === '3\.5\.0' && VERSION_CODE === 105\)",
     "((VERSION === '3.5.0' && VERSION_CODE === 105) || (VERSION === '3.6.0' && VERSION_CODE === 106))"),
    (r"vjs\.includes\(\"export const VERSION = '3\.5\.0';\"\)",
     "vjs.includes(\"export const VERSION = '3.5.0';\") || vjs.includes(\"export const VERSION = '3.6.0';\")"),
    (r"vjs\.includes\('export const VERSION_CODE = 105;'\)",
     "vjs.includes('export const VERSION_CODE = 105;') || vjs.includes('export const VERSION_CODE = 106;')"),
    (r"\(/versionCode 105/\.test\(gradle\) && /versionName \"3\\\.5\\\.0\"/\.test\(gradle\)\)",
     "((/versionCode 105/.test(gradle) && /versionName \"3\\.5\\.0\"/.test(gradle)) || (/versionCode 106/.test(gradle) && /versionName \"3\\.6\\.0\"/.test(gradle)))"),
    (r"\(/versionCode 105/\.test\(grad\) && /versionName \"3\\\.5\\\.0\"/\.test\(grad\)\)",
     "((/versionCode 105/.test(grad) && /versionName \"3\\.5\\.0\"/.test(grad)) || (/versionCode 106/.test(grad) && /versionName \"3\\.6\\.0\"/.test(grad)))"),
]

total = 0
for f in FILES:
    p = os.path.join(ROOT, f)
    if not os.path.exists(p):
        print('FEHLT:', f)
        continue
    s = io.open(p, encoding='utf-8').read()
    orig = s
    n = 0
    for pat, rep in BARES:
        s, c = pat.subn(rep, s)
        n += c
    for pat, rep in PAIRS:
        s2, c = re.subn(pat, lambda m, r=rep: r, s)
        s, n = s2, n + c
    if s != orig:
        io.open(p, 'w', encoding='utf-8').write(s)
        total += n
        print('%-28s %d Pins erweitert' % (f, n))
    else:
        print('%-28s unverändert' % f)
print('GESAMT:', total, 'Pin-Erweiterungen')
