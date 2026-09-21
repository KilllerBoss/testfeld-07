# ═══════════════════════════════════════════════════════════
# bump_v2288.py — Versions-Bump v2.28.8 / versionCode 49
# ═══════════════════════════════════════════════════════════
import io

p = 'app/build.gradle'
s = io.open(p, encoding='utf-8').read()
assert 'versionCode 48' in s and 'versionName "2.28.7"' in s
s = s.replace('versionCode 48', 'versionCode 49').replace('versionName "2.28.7"', 'versionName "2.28.8"')
io.open(p, 'w', encoding='utf-8').write(s)

p = 'app/src/main/assets/www/js/main.js'
s = io.open(p, encoding='utf-8').read()
old = "const VERSION = '2.28.7'; // v2.28.7:"
new = (
    "const VERSION = '2.28.8'; "
    "// v2.28.8: KNOCHENLÄNGEN-TRANSFER — Nutzer (Screenshot): „G1 ist falsch gemappt an das Skelett, "
    "er ist nicht an dem Skelett, sondern etwas innen. Als wäre es nicht Skelett sondern Exoskelett“ — "
    "das grüne Lehrer-Skelett trug weiter MENSCHEN-Proportionen (cskel27 ≈ 1,7 m), der G1 ist kompakter: "
    "Wirbelsäulen-Kugeln über dem Kopf, Schultern breiter, Arme/Beine außerhalb der Roboter-Gliedmaßen. "
    "Fix: reproportionSrcPos baut srcPos entlang der cskel27-Hierarchie neu auf — RICHTUNGEN aus den "
    "Lehrer-Daten (Pose/Winkel exakt erhalten), LÄNGEN vom Roboter (Nullpose-Distanzen der G1-Körper-"
    "Ursprünge: Hüftbreite/Oberschenkel/Unterschenkel aus hip/knee/ankle-Körpern, Wirbelsäule = Becken→"
    "Torso verteilt, Kopf per mj_id2name, Arme aus Schulter/Ellbogen/Handgelenk-Körpern; Zehen/Hände "
    "proportional zum Glied-Faktor). Danach Neuerdung der Füße — die Skelett-Hüfte landet automatisch "
    "auf der Bein-Reichweite des Roboters. srcRig-Marker (persistiert in glbstore) überspringt den "
    "uniformen Höhen-Fit; Legacy-13-Clips behalten ihn. Nur Anzeige-Pfad, IK/Physik unangetastet. "
    "Beweis: ardy_skeleton_fit_diag.mjs — Skelett-Gelenke sitzen nach dem Transfer am G1 (max Abstand "
    "Kopf/Schulter/Ellbogen/Hand/Knie/Knöchel < 0,2 m statt vorher > 0,3 m). v2.28.7:"
)
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK: build.gradle 49/2.28.8, main.js VERSION 2.28.8')
