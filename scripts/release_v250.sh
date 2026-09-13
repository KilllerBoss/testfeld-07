#!/bin/bash
# v2.5.0 Release via GitHub-API — Token NUR als $1 (nicht persistiert)
# Usage: ./release_v250.sh <TOKEN>
set -e
TOK="$1"
REPO="KilllerBoss/testfeld-07"
TAG="v2.5.0"
APK="/home/z/my-project/download/Trainrobot.apk"
PAYLOAD="/home/z/my-project/tool-results/release_payload.json"

python3 - "$PAYLOAD" <<'PYEOF'
import json, sys
body = """**Trainrobot.apk v2.5.0** (versionCode 14, signiert CN=Trainrobot OU=Testfeld07 — stables Keystore, Update-fähig über v2.x)

## Neu in v2.5.0

### Richtig stark schubsen 💪
- Schubsen ist jetzt **Δv-basiert** statt impuls-basiert: Default **3 m/s**, Regelbereich **0,5–10 m/s**
- Der Stärke-Regler in der App skaliert mit der Roboter-Masse (G1 ~35 kg) — deutlich spürbare Stöße im Training

### Steuerung je Trainings-Clip wählbar 🎮
- Zu jedem GLB-Clip lässt sich die Steuerung wählen: **„Keine"** (z. B. Idle) oder **„Joystick"** (z. B. Gehen)
- Bei „Joystick".samplet das Training **Zufalls-Kommandos** (Haltezeit 1,5–4 s, 25 % Stille, vx bis ~1 m/s, wz ±0,9 rad/s) — der Roboter lernt, dass der Joystick ihn steuert (Domain-Randomization)
- Zielwurzel = Kommando-Integration, Phasen-Tempo skaliert mit dem Kommandotempo
- Im POLICY-Modus steuert der Stick die gelernte Policy direkt

### GLB-Animation im Training abschaltbar 🔁
- Checkbox „Animation im Training": ausgeschaltet lernt der Robotor **reines Gleichgewicht** (Referenz = Standpose, Wurzel-Ziel fix am Start) — Curriculum: erst GLB-Animation, dann Balance ohne die (balancefreie) Animation

### GLB-Retargeting-Fixes 🩹
- **Linker Arm zuckt nicht mehr** (Zombie-Animation): Schulter-Seed hatte pitch/roll vertauscht + Seed wörgte jede Frame die konvergierte IK-Lösung weg → jetzt korrekte Achsen + „Sanftanker mit Look-Ahead"
- **Rücken nicht mehr schief**: „Brust"-Anker war das seitlich versetzte Schlüsselbein (clavicle) → jetzt oberste Wirbelsäulen-Node (Spine2 / spine_03)
- Track-Lücken-Füllung, adaptive Denoise (Nadel-Schwelle 0,045), Stufen-Brücke für einmalige Sprünge >0,45 rad

### Integrität
- sha256: `452670bfa10aea82ef2c2428e32adf94317ada3e41aa36b818a94aad543cd4d9`
- Download: Datei unten (Trainrobot.apk, 28,6 MB) — minSdk 30 (Android 11+)
"""
payload = {
    "tag_name": "v2.5.0",
    "target_commitish": "main",
    "name": "v2.5.0 — Starkes Schubsen · Steuerungs-Wahl je Clip · GLB-Animation abschaltbar",
    "body": body,
    "draft": False,
    "prerelease": False,
}
open(sys.argv[1], "w").write(json.dumps(payload))
print("payload ok,", len(body), "chars body")
PYEOF

echo "== 1. Release anlegen =="
RESP=$(curl -s -m 30 -X POST \
  -H "Authorization: token $TOK" \
  -H "Accept: application/vnd.github+json" \
  -d @"$PAYLOAD" \
  "https://api.github.com/repos/$REPO/releases")
RID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or '')
import sys as s
if not d.get('id'): s.stderr.write(json.dumps(d)+chr(10)); s.exit(1)")
echo "Release-ID: $RID"

echo "== 2. Asset hochladen =="
UP=$(curl -s -m 300 -X POST \
  -H "Authorization: token $TOK" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"$APK" \
  "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=Trainrobot.apk")
echo "$UP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('asset:', d.get('name'), '| state:', d.get('state'), '| size:', d.get('size'), '| id:', d.get('id'))
sys.exit(0 if d.get('state')=='uploaded' else 1)"
AID=$(echo "$UP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "== 3. Integritaetscheck (Download via API, octet-stream) =="
curl -s -L -m 120 -H "Authorization: token $TOK" -H "Accept: application/octet-stream" \
  "https://api.github.com/repos/$REPO/releases/assets/$AID" -o /home/z/my-project/tool-results/verify_v250.apk
sha256sum /home/z/my-project/tool-results/verify_v250.apk
sha256sum "$APK"
