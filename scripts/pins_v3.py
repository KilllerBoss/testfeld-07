#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════
# pins_v3.py — Version-Pins auf die neue App „Feld" v3.0.0 erweitern
#
# Die bestehenden Suiten pinen die Alte-App-Identität (com.lertrain.app,
# versionCode-Kette bis 52, Label LerTrain). Die neue App ist de.feld.app /
# versionCode 100 / 3.0.0 — die Pins bekommen OR-Felder (bewährtes Muster
# aus pins_22811.py), damit Bestand UND neue App geprüft bleiben.
# main.js VERSION bleibt bewusst 2.28.11 (die alte UI bleibt eingefroren im
# Repo, wird aber nicht mehr geladen) — Pins darauf bleiben grün.
# ═══════════════════════════════════════════════════════════
import re, sys

EDITS = [
    # ui_v2260_test.mjs: Kette + applicationId + Manifest-Label
    ('scripts/ui_v2260_test.mjs', [
        ("gradle.includes('versionCode 52')) && gradle.includes('applicationId \"com.lertrain.app\"'))",
         "gradle.includes('versionCode 52') || gradle.includes('versionCode 100')) && (gradle.includes('applicationId \"com.lertrain.app\"') || gradle.includes('applicationId \"de.feld.app\"')))",
        ),
        ("check('build.gradle: applicationId com.lertrain.app (EIGENE App)', gradle.includes('applicationId \"com.lertrain.app\"'));",
         "check('build.gradle: applicationId com.lertrain.app (EIGENE App)', gradle.includes('applicationId \"com.lertrain.app\"') || gradle.includes('applicationId \"de.feld.app\"'));"),
        ("check('Manifest: android:label=\"LerTrain\"', manifestXml.includes('android:label=\"LerTrain\"'));",
         "check('Manifest: android:label=\"LerTrain\"', manifestXml.includes('android:label=\"LerTrain\"') || manifestXml.includes('android:label=\"Feld\"'));"),
    ]),
    # ui_v2270_test.mjs: versionCode/versionName-Kette
    ('scripts/ui_v2270_test.mjs', [
        ("(gradleSrc.includes('versionCode 52') && gradleSrc.includes('versionName \"2.28.11\"')));",
         "(gradleSrc.includes('versionCode 52') && gradleSrc.includes('versionName \"2.28.11\"')) || (gradleSrc.includes('versionCode 100') && gradleSrc.includes('versionName \"3.0.0\"')));"),
    ]),
    # motionset_v2230_test.mjs: Kette + applicationId
    ('scripts/motionset_v2230_test.mjs', [
        ("gradle.includes('versionCode 52')) && gradle.includes('applicationId \"com.lertrain.app\"'));",
         "gradle.includes('versionCode 52') || gradle.includes('versionCode 100')) && (gradle.includes('applicationId \"com.lertrain.app\"') || gradle.includes('applicationId \"de.feld.app\"')));"),
    ]),
    # qpos_v2220_test.mjs: Regex-Kette (3[4-9]|4[0-9]|5[0-2]) + applicationId
    ('scripts/qpos_v2220_test.mjs', [
        ("ok(gradle.includes('applicationId \"com.lertrain.app\"') && /versionCode (3[4-9]|4[0-9]|5[0-2])/.test(gradle), 'build.gradle (>= 34-Pin, LerTrain-Package)');",
         "ok((gradle.includes('applicationId \"com.lertrain.app\"') || gradle.includes('applicationId \"de.feld.app\"')) && /versionCode (3[4-9]|4[0-9]|5[0-2]|100)/.test(gradle), 'build.gradle (>= 34-Pin, LerTrain/Feld-Package)');"),
    ]),
]

total = 0
for path, pairs in EDITS:
    src = open(path).read()
    for old, new in pairs:
        if old in src:
            src = src.replace(old, new)
            print(f'  ✓ {path}: Pin erweitert ({old[:52]}…)')
            total += 1
        elif new in src:
            print(f'  · {path}: Pin bereits gesetzt')
        else:
            print(f'  ✗ {path}: Muster NICHT gefunden: {old[:80]}')
            sys.exit(1)
    open(path, 'w').write(src)
print(f'\n{total} Pins auf Feld v3.0.0 erweitert.')
