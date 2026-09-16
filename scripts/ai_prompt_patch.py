#!/usr/bin/env python3
"""ai.js Prompt: rWx-Doku, Tool-Enum, WANN-WAS-Erweiterung (unicode-sicher)."""
import io, sys

P = '/home/z/my-project/app/src/main/assets/www/js/ai.js'
src = io.open(P, encoding='utf-8').read()
n0 = src

# 1) rWx-Doku: nach der expertR-Zeile (endet mit „dominiert".) einfügen
anchor = 'expertR.domMin: Router-Gewicht ab dem ein Experte '
i = src.find(anchor)
assert i >= 0, 'expertR-Anker fehlt'
j = src.find('\n', i)
assert j > i
rwx_line = ('\n- rWx (KOMPLEXE TERME, v2.14.0): eigene Ziel-/Bedingungsterme OBEN DRAUF. '
            'patch.rWx = {on:1, terms:[\u2026]}. Term-Arten: {kind:"goTo", x, y, tol} = dorthin bewegen; '
            '{kind:"stayNear", x, y, r} = im Umkreis bleiben; {kind:"heightBand", zMin, zMax} = H\u00f6he im Band; '
            '{kind:"faceYaw", yaw} = Blickrichtung halten; {kind:"paceMax"|"paceMin", v} = Tempo-Deckel/-Mindest; '
            '{kind:"uprightMin", up} = Mindest-Aufrecht. Jeder Term mit w = Gewicht 0\u20135, optional hard:true = Abbruch bei grober Verletzung. '
            'Beispiel: \u201Eer soll zum Turm laufen\u201C \u2192 erst setWorld (Turm bauen), dann applyConfig mit rWx goTo auf die Turm-Koordinate.')
if 'rWx (KOMPLEXE TERME' not in src:
    src = src[:j] + rwx_line + src[j:]

# 2) Tool-Enum in ANTWORTFORMAT
old_enum = '"tool": "addButton|removeButton|mapJoystick|observe|applyConfig|setScenario|setFallMode|readDoc|setCamera|runCode|writePlugin'
new_enum = '"tool": "addButton|removeButton|mapJoystick|observe|applyConfig|setScenario|setFallMode|readDoc|setCamera|setAppearance|setWorld|setUI|setMoE|runCode|writePlugin'
if old_enum in src:
    src = src.replace(old_enum, new_enum)

# 3) WANN-WAS: Zeile erweitern (nach setFallMode-Zeile) um Aussehen/Welt/UI/MoE
wan_anchor = '- Einstellungen/Belohnungen \u2192 applyConfig. Buttons/Joystick \u2192 addButton/mapJoystick. Aufgabe wechseln (Aufstehen/Landen/Gehen) \u2192 setScenario. Sturz-Teleport an/aus \u2192 setFallMode.'
wan_new = wan_anchor + ('\n- AUSSEHEN (\u201Emach die Ente pink\u201C, \u201EChrome-Ente\u201C, \u201EG1 Kopf rot\u201C) \u2192 setAppearance (erst {list:true}). '
                        'WELT (\u201Ebau einen Turm\u201C, \u201Estell einen Ball hin\u201C, \u201Emach die Welt leer\u201C) \u2192 setWorld. '
                        'APP-DESIGN/Schnellstart-Buttons (\u201ENeon-Design\u201C) \u2192 setUI. MicroDuck-Experten (\u201Enur 3 Experten\u201C) \u2192 setMoE (Policy startet neu \u2014 vorher warnen!).')
if 'AUSSEHEN (\u201Emach die Ente pink\u201C' not in src and wan_anchor in src:
    src = src.replace(wan_anchor, wan_new)

# 4) setFallMode-Zeile: „Aufstehen/Landen/Gehen“ bleibt; oben drüber OK.
if src == n0:
    print('WARNUNG: nichts geändert'); sys.exit(1)
io.open(P, 'w', encoding='utf-8').write(src)
print('OK — Prompt-Stellen eingefügt')
