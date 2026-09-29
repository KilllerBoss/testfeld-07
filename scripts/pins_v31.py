#!/usr/bin/env python3
# pins_v31.py — Version-Pins aller Suiten auf Feld v3.1.0 (versionCode 101) erweitern
# Bewährtes Muster (pins_v3.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
import os, re, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
changed = 0

# 1) Paar-Ketten: (versionCode 100 && versionName "3.0.0") → + (101 && "3.1.0")
PAIR_PATTERNS = [
    # gradle-Variante
    ("gradle.includes('versionCode 100') && gradle.includes('versionName \"3.0.0\"')",
     "gradle.includes('versionCode 100') && gradle.includes('versionName \"3.0.0\"') || (gradle.includes('versionCode 101') && gradle.includes('versionName \"3.1.0\"'))"),
    # gradleSrc-Variante
    ("gradleSrc.includes('versionCode 100') && gradleSrc.includes('versionName \"3.0.0\"')",
     "gradleSrc.includes('versionCode 100') && gradleSrc.includes('versionName \"3.0.0\"') || (gradleSrc.includes('versionCode 101') && gradleSrc.includes('versionName \"3.1.0\"'))"),
    # grad-Variante (ohne Paar, simple Kette)
    ("|| grad.includes('versionCode 100'),", "|| grad.includes('versionCode 100') || grad.includes('versionCode 101'),"),
    ("|| gradle.includes('versionCode 100'),", "|| gradle.includes('versionCode 100') || gradle.includes('versionCode 101'),"),
    # versionName-Ketten
    ("|| grad.includes('versionName \"3.0.0\"'),", "|| grad.includes('versionName \"3.0.0\"') || grad.includes('versionName \"3.1.0\"'),"),
    ("|| gradle.includes('versionName \"3.0.0\"'),", "|| gradle.includes('versionName \"3.0.0\"') || gradle.includes('versionName \"3.1.0\"'),"),
    # Regex-Ketten versionCode
    ("|100)/.test(gradle)", "|100|101)/.test(gradle)"),
    ("|100)/.test(grad)", "|100|101)/.test(grad)"),
    ("|100)/", "|100|101)/"),  # generisch (canvas/qpos: (3[2-9]|4[0-9]|5[0-2]|100)/.test(…)
    ("|| /versionCode 100/.test(grad)", "|| /versionCode 100/.test(grad) || /versionCode 101/.test(grad)"),
    # Regex-Ketten versionName
    ("/versionName \"3\\.0\\.0\"/.test(grad)", "/versionName \"3\\.0\\.0\"/.test(grad) || /versionName \"3\\.1\\.0\"/.test(grad)"),
    ("&& /versionName \"3\\.0\\.0\"/.test(gradle)", "&& /versionName \"3\\.0\\.0\"/.test(gradle)) || (/versionCode 101/.test(gradle) && /versionName \"3\\.1\\.0\"/.test(gradle"),
    # motionset einfache Kette (versionCode am Stück)
    ("|| gradle.includes('versionCode 100'))", "|| gradle.includes('versionCode 100') || gradle.includes('versionCode 101'))"),
]

for path in glob.glob(os.path.join(ROOT, '*.mjs')):
    if path.endswith('pins_v31.py'):
        continue
    src = open(path, encoding='utf-8').read()
    orig = src
    for old, new in PAIR_PATTERNS:
        if old in src:
            src = src.replace(old, new)
    # feld_test VERSION-Pin direkt umstellen (Feld-Suite gehört zur App)
    if path.endswith('feld_test.mjs'):
        src = src.replace("ok(VERSION === '3.0.0', 'VERSION = 3.0.0');",
                          "ok(VERSION === '3.1.0', 'VERSION = 3.1.0');")
        src = src.replace("// feld_test.mjs — Tests für die neue App „Feld\" v3.0.0",
                          "// feld_test.mjs — Tests für die neue App „Feld\" (≥ v3.1.0)")
    if src != orig:
        open(path, 'w', encoding='utf-8').write(src)
        changed += 1
        print('  angepasst:', os.path.basename(path))

print(f'\n{changed} Suiten auf Feld v3.1.0/101 erweitert.')
