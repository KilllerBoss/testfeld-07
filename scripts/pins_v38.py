#!/usr/bin/env python3
# pins_v38.py — Version-Pins aller Suiten auf Feld v3.8.0 (versionCode 108) erweitern
# Bewährtes Muster (pins_v37.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
# Neu in v38: Laufzeit-Check „Snapshot trägt App+Version“ (feld_v370) wird auf 3.8.0 erweitert.
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = [
    'feld_test.mjs', 'feld_cmd_test.mjs', 'feld_schubser_test.mjs',
    'feld_ground_phone_test.mjs', 'feld_live_v33_test.mjs', 'feld_v340_test.mjs',
    'feld_v350_test.mjs', 'feld_v360_test.mjs', 'feld_v370_test.mjs',
    'ardy_probe_test.mjs', 'ardy_retry_test.mjs', 'ardy_mirror_test.mjs',
    'ardy_ghost_only_test.mjs', 'ardy_smooth_test.mjs',
    'src_skeleton_test.mjs', 'physics_filter_test.mjs',
    'motionset_v2230_test.mjs', 'ui_v2260_test.mjs', 'ui_v2270_test.mjs',
]

PAIR_LEFT_GRADLE = r"gradle\.includes\('versionCode 107'\) && gradle\.includes\('versionName \"3\.7\.0\"'\)"
PAIR_LEFT_GRADLESRC = r"gradleSrc\.includes\('versionCode 107'\) && gradleSrc\.includes\('versionName \"3\.7\.0\"'\)"
PAIR_LEFT_GRAD = r"grad\.includes\('versionCode 107'\) && grad\.includes\('versionName \"3\.7\.0\"'\)"

def bare_rules():
    """Bare-Erweiterungen — mit Lookahead/Lookbehind-Guards gegen &&-Paare."""
    out = []
    for var in ('gradle', 'gradleSrc', 'grad', 'gr', 'g'):
        v = re.escape(var)
        out.append((
            re.compile(r"\b%s\.includes\('versionCode 107'\)(?!\s*&&\s*%s\.includes\('versionName \"3\.7\.0\"'\))" % (v, v)),
            lambda m, var=var: "%s.includes('versionCode 107') || %s.includes('versionCode 108')" % (var, var),
        ))
        out.append((
            re.compile(r"(?<!%s\.includes\('versionCode 107'\) && )%s\.includes\('versionName \"3\.7\.0\"'\)(?!\s*&&\s*%s\.includes\('versionCode 108'\))" % (v, v, v)),
            lambda m, var=var: "%s.includes('versionName \"3.7.0\"') || %s.includes('versionName \"3.8.0\"')" % (var, var),
        ))
        out.append((
            re.compile(r"/versionCode 107/\.test\(%s\)(?!\s*&&)" % v),
            lambda m, var=var: "/versionCode 107/.test(%s) || /versionCode 108/.test(%s)" % (var, var),
        ))
        out.append((
            re.compile(r"(?<!/versionCode 107/\.test\(%s\) && )/versionName \"3\\\.7\\\.0\"/\.test\(%s\)(?!\s*&&)" % (v, v)),
            lambda m, var=var: "/versionName \"3\\.7\\.0\"/.test(%s) || /versionName \"3\\.8\\.0\"/.test(%s)" % (var, var),
        ))
    out.append((
        re.compile(r"\|\| VERSION === '3\.7\.0'"),
        lambda m: "|| VERSION === '3.7.0' || VERSION === '3.8.0'",
    ))
    out.append((
        re.compile(r"\|\| VERSION_CODE === 107\b"),
        lambda m: "|| VERSION_CODE === 107 || VERSION_CODE === 108",
    ))
    # Laufzeit-Snapshot-Check (echte Ausführung): „Feld 3.7.0“ auch als 3.8.0 gelten lassen
    out.append((
        re.compile(r"snap\.app\.startsWith\('Feld 3\.7\.0'\)"),
        lambda m: "snap.app.startsWith('Feld 3.7.0') || snap.app.startsWith('Feld 3.8.0')",
    ))
    return out

BARES = bare_rules()

PAIRS = [
    (PAIR_LEFT_GRADLE,
     "(gradle.includes('versionCode 107') && gradle.includes('versionName \"3.7.0\"') || (gradle.includes('versionCode 108') && gradle.includes('versionName \"3.8.0\"')))"),
    (PAIR_LEFT_GRADLESRC,
     "(gradleSrc.includes('versionCode 107') && gradleSrc.includes('versionName \"3.7.0\"') || (gradleSrc.includes('versionCode 108') && gradleSrc.includes('versionName \"3.8.0\"')))"),
    (PAIR_LEFT_GRAD,
     "(grad.includes('versionCode 107') && grad.includes('versionName \"3.7.0\"') || (grad.includes('versionCode 108') && grad.includes('versionName \"3.8.0\"')))"),
    (r"\(VERSION === '3\.7\.0' && VERSION_CODE === 107\)",
     "((VERSION === '3.7.0' && VERSION_CODE === 107) || (VERSION === '3.8.0' && VERSION_CODE === 108))"),
    (r"vj?s\.includes\(\"export const VERSION = '3\.7\.0';\"\)",
     None),  # Sonderfall unten — Variablenname dynamisch
    (r"vj?s\.includes\('export const VERSION_CODE = 107;'\)",
     None),  # Sonderfall unten
    (r"\(/versionCode 107/\.test\(gradle\) && /versionName \"3\\\.7\\\.0\"/\.test\(gradle\)\)",
     "((/versionCode 107/.test(gradle) && /versionName \"3\\.7\\.0\"/.test(gradle)) || (/versionCode 108/.test(gradle) && /versionName \"3\\.8\\.0\"/.test(gradle)))"),
    (r"\(/versionCode 107/\.test\(grad\) && /versionName \"3\\\.7\\\.0\"/\.test\(grad\)\)",
     "((/versionCode 107/.test(grad) && /versionName \"3\\.7\\.0\"/.test(grad)) || (/versionCode 108/.test(grad) && /versionName \"3\\.8\\.0\"/.test(grad)))"),
]

def special_vjs(s):
    """vj/vjs-Varianten der includes-Paare (Variablenname dynamisch)."""
    n = 0
    for var in ('vjs', 'vj'):
        v = re.escape(var)
        p1 = r"%s\.includes\(\"export const VERSION = '3\.7\.0';\"\)(?!\s*\|\|)" % v
        r1 = "%s.includes(\"export const VERSION = '3.7.0';\") || %s.includes(\"export const VERSION = '3.8.0';\")" % (var, var)
        s, c = re.subn(p1, lambda m, r=r1: r, s)
        n += c
        p2 = r"%s\.includes\('export const VERSION_CODE = 107;'\)(?!\s*\|\|)" % v
        r2 = "%s.includes('export const VERSION_CODE = 107;') || %s.includes('export const VERSION_CODE = 108;')" % (var, var)
        s, c = re.subn(p2, lambda m, r=r2: r, s)
        n += c
    return s, n

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
        if rep is None:
            continue
        s2, c = re.subn(pat, lambda m, r=rep: r, s)
        s, n = s2, n + c
    s, c = special_vjs(s)
    n += c
    if s != orig:
        io.open(p, 'w', encoding='utf-8').write(s)
        total += n
        print('%-28s %d Pins erweitert' % (f, n))
    else:
        print('%-28s unverändert' % f)
print('GESAMT:', total, 'Pin-Erweiterungen')
