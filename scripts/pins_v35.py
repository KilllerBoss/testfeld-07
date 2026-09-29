#!/usr/bin/env python3
# pins_v35.py — Version-Pins aller Suiten auf Feld v3.5.0 (versionCode 105) erweitern
# Bewährtes Muster (pins_v34.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
#
# Reihenfolge je Datei:
#   1) HARD — feld_v340-Harte-Pins zu OR-Ketten öffnen
#   2) BARES — Regex mit Guards: trifft NICHT die linke/rechte Seite eines
#      "&&"-Paars (sonst würde &&-Semantik zerschossen)
#   3) PAIRS — Paar-Ausdrücke als Ganzes erweitern (ersetzen zuletzt; ihr
#      neuer Text enthält Bare-Muster, wird aber nicht erneut gescannt)
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

PAIR_LEFT_GRADLE = r"gradle\.includes\('versionCode 104'\) && gradle\.includes\('versionName \"3\.4\.0\"'\)"
PAIR_LEFT_GRADLESRC = r"gradleSrc\.includes\('versionCode 104'\) && gradleSrc\.includes\('versionName \"3\.4\.0\"'\)"

def bare_rules():
    """Bare-Erweiterungen — mit Lookahead/Lookbehind-Guards gegen &&-Paare."""
    out = []
    for var in ('gradle', 'gradleSrc', 'grad'):
        v = re.escape(var)
        # versionCode-Seite: nur wenn kein " && …versionName 3.4.0" folgt
        out.append((
            re.compile(r"\b%s\.includes\('versionCode 104'\)(?!\s*&&\s*%s\.includes\('versionName \"3\.4\.0\"'\))" % (v, v)),
            lambda m, var=var: "%s.includes('versionCode 104') || %s.includes('versionCode 105')" % (var, var),
        ))
        # versionName-Seite: nur wenn kein "versionCode 104 && " vorausgeht (fixe Breite: ein Leerzeichen)
        out.append((
            re.compile(r"(?<!%s\.includes\('versionCode 104'\) && )%s\.includes\('versionName \"3\.4\.0\"'\)(?!\s*&&\s*%s)" % (v, v, v)),
            lambda m, var=var: "%s.includes('versionName \"3.4.0\"') || %s.includes('versionName \"3.5.0\"')" % (var, var),
        ))
        # Regex-Variante /versionCode 104/.test(x) — nur wenn nicht gepaart
        out.append((
            re.compile(r"/versionCode 104/\.test\(%s\)(?!\s*&&)" % v),
            lambda m, var=var: "/versionCode 104/.test(%s) || /versionCode 105/.test(%s)" % (var, var),
        ))
        out.append((
            re.compile(r"(?<!/versionCode 104/\.test\(%s\) && )/versionName \"3\\\.4\\\.0\"/\.test\(%s\)(?!\s*&&)" % (v, v)),
            lambda m, var=var: "/versionName \"3\\.4\\.0\"/.test(%s) || /versionName \"3\\.5\\.0\"/.test(%s)" % (var, var),
        ))
    # VERSION-Vergleiche (einfache ||-Ketten — kein &&-Gemisch in derselben Klammer)
    out.append((
        re.compile(r"\|\| VERSION === '3\.4\.0'"),
        lambda m: "|| VERSION === '3.4.0' || VERSION === '3.5.0'",
    ))
    out.append((
        re.compile(r"\|\| VERSION_CODE === 104\b"),
        lambda m: "|| VERSION_CODE === 104 || VERSION_CODE === 105",
    ))
    return out

BARES = bare_rules()

PAIRS = [
    (PAIR_LEFT_GRADLE,
     "(gradle.includes('versionCode 104') && gradle.includes('versionName \"3.4.0\"') || (gradle.includes('versionCode 105') && gradle.includes('versionName \"3.5.0\"')))"),
    (PAIR_LEFT_GRADLESRC,
     "(gradleSrc.includes('versionCode 104') && gradleSrc.includes('versionName \"3.4.0\"') || (gradleSrc.includes('versionCode 105') && gradleSrc.includes('versionName \"3.5.0\"')))"),
    (r"\(VERSION === '3\.4\.0' && VERSION_CODE === 104\)",
     "((VERSION === '3.4.0' && VERSION_CODE === 104) || (VERSION === '3.5.0' && VERSION_CODE === 105))"),
    (r"vjs\.includes\(\"export const VERSION = '3\.4\.0';\"\)",
     "vjs.includes(\"export const VERSION = '3.4.0';\") || vjs.includes(\"export const VERSION = '3.5.0';\")"),
    (r"vjs\.includes\('export const VERSION_CODE = 104;'\)",
     "vjs.includes('export const VERSION_CODE = 104;') || vjs.includes('export const VERSION_CODE = 105;')"),
    (r"\(/versionCode 104/\.test\(gradle\) && /versionName \"3\\\.4\\\.0\"/\.test\(gradle\)\)",
     "((/versionCode 104/.test(gradle) && /versionName \"3\\.4\\.0\"/.test(gradle)) || (/versionCode 105/.test(gradle) && /versionName \"3\\.5\\.0\"/.test(gradle)))"),
    (r"\(/versionCode 104/\.test\(grad\) && /versionName \"3\\\.4\\\.0\"/\.test\(grad\)\)",
     "((/versionCode 104/.test(grad) && /versionName \"3\\.4\\.0\"/.test(grad)) || (/versionCode 105/.test(grad) && /versionName \"3\\.5\\.0\"/.test(grad)))"),
]

HARD = [
    ("ok(vjs.includes(\"export const VERSION = '3.4.0';\"), 'version.js VERSION = 3.4.0');",
     "ok(vjs.includes(\"export const VERSION = '3.4.0';\") || vjs.includes(\"export const VERSION = '3.5.0';\"), 'version.js VERSION = 3.4.0/3.5.0');"),
    ("ok(vjs.includes('export const VERSION_CODE = 104;'), 'version.js VERSION_CODE = 104');",
     "ok(vjs.includes('export const VERSION_CODE = 104;') || vjs.includes('export const VERSION_CODE = 105;'), 'version.js VERSION_CODE = 104/105');"),
    ("ok(gradle.includes('versionCode 104') && gradle.includes('versionName \"3.4.0\"'), 'build.gradle 104 / 3.4.0');",
     "ok((gradle.includes('versionCode 104') && gradle.includes('versionName \"3.4.0\"')) || (gradle.includes('versionCode 105') && gradle.includes('versionName \"3.5.0\"')), 'build.gradle 104/3.4.0 oder 105/3.5.0');"),
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
    for old, new in HARD:          # 1) harte Pins
        if old in s:
            s = s.replace(old, new)
            n += 1
    for pat, rep in BARES:         # 2) Bare mit Guards (lambda → kein Escape-Problem)
        s, c = pat.subn(rep, s)
        n += c
    for pat, rep in PAIRS:         # 3) Paare als Ganzes
        s2, c = re.subn(pat, lambda m, r=rep: r, s)
        s, n = s2, n + c
    if s != orig:
        io.open(p, 'w', encoding='utf-8').write(s)
        total += n
        print('%-28s %d Pins erweitert' % (f, n))
    else:
        print('%-28s unverändert' % f)
print('GESAMT:', total, 'Pin-Erweiterungen')
