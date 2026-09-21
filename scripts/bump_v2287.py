# ═══════════════════════════════════════════════════════════
# bump_v2287.py — Versions-Bump v2.28.7 / versionCode 48
# ═══════════════════════════════════════════════════════════
import io

p = 'app/build.gradle'
s = io.open(p, encoding='utf-8').read()
assert 'versionCode 47' in s and 'versionName "2.28.6"' in s
s = s.replace('versionCode 47', 'versionCode 48').replace('versionName "2.28.6"', 'versionName "2.28.7"')
io.open(p, 'w', encoding='utf-8').write(s)

p = 'app/src/main/assets/www/js/main.js'
s = io.open(p, encoding='utf-8').read()
old = "const VERSION = '2.28.6'; // v2.28.6:"
new = (
    "const VERSION = '2.28.7'; "
    "// v2.28.7: LEHRER-SKELETT IN VOLLER cskel27-ANATOMIE — der Nutzer-Report (mit Referenz-Screenshot "
    "aus der ARDY-Browser-Demo) „der skellet ist falsch“ war korrekt: srcPos trug nur die 13 IK-Rollen "
    "(Stumpf ohne Hände/HandEnd/Thumb1, ohne Zehen, ohne Schultern, Wirbelsäule nur 2 Wirbel, Arme hingen "
    "direkt an „spine“). Jetzt: resolveSrcJoints löst ALLE 27 cskel27-Gelenke (SRC_ROLES/SRC_EDGES = exakte "
    "Eltern-Kind-Hierarchie aus manifest.skeleton), srcPos trägt sie alle, render3d zeichnet die Kette "
    "dynamisch via srcBonePairs (Ahnen-Walk: ALTE 13-Rollen-Clips behalten exakt ihr altes Aussehen). "
    "groundSrcPosFrame hebt jetzt auch ToeBase (tiefster Punkt) auf 0. IK/Physik/Quality UNANGETASTET — "
    "reiner Anzeige-Pfad, bewiesen per ardy_skeleton27_diag.mjs an echtem Modell+Sim: 27/27 Gelenke, "
    "26-Kanten-Baum, Knochen-Drift 0,00 %, Füße geerdet, Legacy-Paare exakt. v2.28.6:"
)
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK: build.gradle 48/2.28.7, main.js VERSION 2.28.7')
