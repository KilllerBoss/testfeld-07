#!/usr/bin/env python3
# pins_v33.py — Version-Pins aller Suiten auf Feld v3.3.0 (versionCode 103) erweitern
# Bewährtes Muster (pins_v32.py): OR-Ketten erweitern, Bedingungen bleiben abwärtskompatibel.
import os, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
changed = 0

# 1) Paar-Ketten: (versionCode 102 && versionName "3.2.0") → + (103 && "3.3.0")
PAIR_PATTERNS = [
    # gradle-Variante
    ("gradle.includes('versionCode 102') && gradle.includes('versionName \"3.2.0\"')",
     "gradle.includes('versionCode 102') && gradle.includes('versionName \"3.2.0\"') || (gradle.includes('versionCode 103') && gradle.includes('versionName \"3.3.0\"'))"),
    # gradleSrc-Variante
    ("gradleSrc.includes('versionCode 102') && gradleSrc.includes('versionName \"3.2.0\"')",
     "gradleSrc.includes('versionCode 102') && gradleSrc.includes('versionName \"3.2.0\"') || (gradleSrc.includes('versionCode 103') && gradleSrc.includes('versionName \"3.3.0\"'))"),
    # grad-Variante (ohne Paar, simple Kette)
    ("|| grad.includes('versionCode 102'),", "|| grad.includes('versionCode 102') || grad.includes('versionCode 103'),"),
    ("|| gradle.includes('versionCode 102'),", "|| gradle.includes('versionCode 102') || gradle.includes('versionCode 103'),"),
    # versionName-Ketten
    ("|| grad.includes('versionName \"3.2.0\"'),", "|| grad.includes('versionName \"3.2.0\"') || grad.includes('versionName \"3.3.0\"'),"),
    ("|| gradle.includes('versionName \"3.2.0\"'),", "|| gradle.includes('versionName \"3.2.0\"') || gradle.includes('versionName \"3.3.0\"'),"),
    # Regex-Ketten versionCode
    ("|102)/.test(gradle)", "|102|103)/.test(gradle)"),
    ("|102)/.test(grad)", "|102|103)/.test(grad)"),
    ("|102)/", "|102|103)/"),  # generisch
    ("|| /versionCode 102/.test(grad)", "|| /versionCode 102/.test(grad) || /versionCode 103/.test(grad)"),
    # Regex-Ketten versionName
    ("/versionName \"3\\.2\\.0\"/.test(grad)", "/versionName \"3\\.2\\.0\"/.test(grad) || /versionName \"3\\.3\\.0\"/.test(grad)"),
    ("&& /versionName \"3\\.2\\.0\"/.test(gradle)", "&& /versionName \"3\\.2\\.0\"/.test(gradle)) || (/versionCode 103/.test(gradle) && /versionName \"3\\.3\\.0\"/.test(gradle"),
    # einfache Kette (versionCode am Stück)
    ("|| gradle.includes('versionCode 102'))", "|| gradle.includes('versionCode 102') || gradle.includes('versionCode 103'))"),
]

for path in glob.glob(os.path.join(ROOT, '*.mjs')):
    if path.endswith('pins_v33.py'):
        continue
    src = open(path, encoding='utf-8').read()
    orig = src
    for old, new in PAIR_PATTERNS:
        if old in src and new not in src:
            src = src.replace(old, new)
    if src != orig:
        open(path, 'w', encoding='utf-8').write(src)
        changed += 1
        print('geändert:', os.path.basename(path))
print(f'{changed} Dateien erweitert')
