#!/usr/bin/env python3
# pins_v32.py — Version-Pins aller Suiten auf Feld v3.2.0 (versionCode 102) erweitern
# Bewährtes Muster (pins_v31.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
import os, re, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
changed = 0

# 1) Paar-Ketten: (versionCode 101 && versionName "3.1.0") → + (102 && "3.2.0")
PAIR_PATTERNS = [
    # gradle-Variante
    ("gradle.includes('versionCode 101') && gradle.includes('versionName \"3.1.0\"')",
     "gradle.includes('versionCode 101') && gradle.includes('versionName \"3.1.0\"') || (gradle.includes('versionCode 102') && gradle.includes('versionName \"3.2.0\"'))"),
    # gradleSrc-Variante
    ("gradleSrc.includes('versionCode 101') && gradleSrc.includes('versionName \"3.1.0\"')",
     "gradleSrc.includes('versionCode 101') && gradleSrc.includes('versionName \"3.1.0\"') || (gradleSrc.includes('versionCode 102') && gradleSrc.includes('versionName \"3.2.0\"'))"),
    # grad-Variante (ohne Paar, simple Kette)
    ("|| grad.includes('versionCode 101'),", "|| grad.includes('versionCode 101') || grad.includes('versionCode 102'),"),
    ("|| gradle.includes('versionCode 101'),", "|| gradle.includes('versionCode 101') || gradle.includes('versionCode 102'),"),
    # versionName-Ketten
    ("|| grad.includes('versionName \"3.1.0\"'),", "|| grad.includes('versionName \"3.1.0\"') || grad.includes('versionName \"3.2.0\"'),"),
    ("|| gradle.includes('versionName \"3.1.0\"'),", "|| gradle.includes('versionName \"3.1.0\"') || gradle.includes('versionName \"3.2.0\"'),"),
    # Regex-Ketten versionCode
    ("|101)/.test(gradle)", "|101|102)/.test(gradle)"),
    ("|101)/.test(grad)", "|101|102)/.test(grad)"),
    ("|101)/", "|101|102)/"),  # generisch
    ("|| /versionCode 101/.test(grad)", "|| /versionCode 101/.test(grad) || /versionCode 102/.test(grad)"),
    # Regex-Ketten versionName
    ("/versionName \"3\\.1\\.0\"/.test(grad)", "/versionName \"3\\.1\\.0\"/.test(grad) || /versionName \"3\\.2\\.0\"/.test(grad)"),
    ("&& /versionName \"3\\.1\\.0\"/.test(gradle)", "&& /versionName \"3\\.1\\.0\"/.test(gradle)) || (/versionCode 102/.test(gradle) && /versionName \"3\\.2\\.0\"/.test(gradle"),
    # motionset einfache Kette (versionCode am Stück)
    ("|| gradle.includes('versionCode 101'))", "|| gradle.includes('versionCode 101') || gradle.includes('versionCode 102'))"),
]

for path in glob.glob(os.path.join(ROOT, '*.mjs')):
    if path.endswith('pins_v32.py'):
        continue
    src = open(path, encoding='utf-8').read()
    orig = src
    for old, new in PAIR_PATTERNS:
        if old in src:
            src = src.replace(old, new)
    # feld_test VERSION-Pin direkt umstellen (Feld-Suite gehört zur App)
    if path.endswith('feld_test.mjs'):
        src = src.replace("ok(VERSION === '3.1.0', 'VERSION = 3.1.0');",
                          "ok(VERSION === '3.2.0', 'VERSION = 3.2.0');")
        src = src.replace("// feld_test.mjs — Tests für die neue App „Feld\" (≥ v3.1.0)",
                          "// feld_test.mjs — Tests für die neue App „Feld\" (≥ v3.2.0)")
        src = src.replace("// feld_test.mjs — Tests für die neue App „Feld\" v3.1.0",
                          "// feld_test.mjs — Tests für die neue App „Feld\" (≥ v3.2.0)")
    if src != orig:
        open(path, 'w', encoding='utf-8').write(src)
        changed += 1
        print('  angepasst:', os.path.basename(path))

print(f'\n{changed} Suiten auf Feld v3.2.0/102 erweitert.')
