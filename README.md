# Trainrobot (Testfeld·07) — RL-Trainingssimulator als Android-APK

Offline-3D-Robotersimulator für Android. Der Sim-Kern ist der **offizielle
[`pollen-robotics/microduck-simulator`](https://huggingface.co/spaces/pollen-robotics/microduck-simulator)**
(Vite/React, MuJoCo-WASM-Physik, three.js, onnxruntime-web) — gebaut und
gebundelt **exakt wie die Referenz-App
[`KilllerBoss/microduck`](https://github.com/KilllerBoss/microduck)**.

**Kein Fallback, keine Eigenbau-Physik:** Die App startet direkt in die echte
MuJoCo-Simulation. Ein Fallback-Motor existiert nicht mehr (seit v2.0.0
komplett entfernt); falls der Sim-Boot fehlschlägt, erscheint eine klare
Fehlermeldung — nie ein Schein-Roboter.

## Was in der App läuft

| Bestandteil | Beschreibung |
|---|---|
| **3D-Simulation** | Offizieller microduck-simulator, offline in der WebView. MuJoCo-WASM @ 50 Hz (timestep 5 ms, decimation 4), 3-m-Arena mit Props. |
| **Walk-Skill** | Eigene Kaggle-Policy `microduck_rough_v2.onnx` (obs 61 → act 14, 5000 Iterationen Rough-Velocity) — Patch 1 aus `sim/PATCHES.md` der Referenz. |
| **Skills** | Alle Original-Policies des Space (walk/stand/sitstand/roll/kick/groundpick/roller) per Menü. |
| **Touch-Stick** | Direkte Steuerung (`?touch=1`), Waypoint-Klicks, Gamepad, Tastatur. |
| **Gemini-Autopilot (optional)** | Key in der App eingeben → Subgoal-JSONs @ ~1 Hz via `md_bridge.js` in den Controller injiziert; Touch hat jederzeit Vorrang; `notify` → Benachrichtigung (kein TTS). |

## Warum v2.0.0 das Geräte-Problem endgültig löst

v1.x lud die Sim über `file://` mit einer selbstgebauten Base64-Brücke —
fragil (MIME-, Module-, Streaming-Probleme), plus ein stiller
Werkstatt-Fallback maskierte Fehler. v2.0.0 übernimmt die Verkabelung der
Referenz-App 1:1 und korrigiert dabei zwei dort dokumentierte Fallstricke:

1. **`WebViewAssetLoader` statt `file://`:** Assets werden über
   `https://appassets.androidplatform.net/assets/…` serviert. Relative
   fetches, ES-Module und `instantiateStreaming` funktionieren offline
   (`allowFileAccess=false`).
2. **Zwei-Handler-Verkabelung:** Der Vite-Dist referenziert Assets
   host-absolut (`/bundle/…`, `/policies/…`, `/robot/…`). Handler 1 bedient
   `/assets/sim/**`, Handler 2 (`/`) mappt genau diese absoluten Pfade auf
   den Dist. `sim/sim`-Präfix-Bug der Referenz (alles fiel aufs Netz →
   Sim bootete im Gerät nie) ist behoben — siehe
   `app/src/main/java/com/trainrobot/app/SimAssetHandler.java`.

## Verifizierung (jeder Commit)

- `node tests/test_official_bundle.mjs` — Dist-Integrität, wasm-Magics,
  Patches, Bridge-Vertrag, Verkabelung, Identität (37 Checks).
- `node tests/browser_official_boot.js` — Playwright spiegelt die
  SimActivity-Verkabelung exakt: `window.rl` erscheint, Physik läuft,
  Duck steht aufrecht (z ≈ 0,12), alle Requests lokal bedient.
- `python3 tools/build_sim.py` — Dist-Verifier (CI-safe, kein Netz).
- Offizielle Space-Tests: `npm test` im Space-Repo (8/8 grün).

## Installation (Android 11+)

### APK selbst bauen (GitHub Actions)
1. Push → Tab **Actions** → Workflow `build-apk` → grün.
2. Artifact `trainrobot-apk` herunterladen → **`Trainrobot.apk`**.
3. Installieren („Unbekannte Apps erlauben"). App-Info zeigt **2.0.0 (Code 4)**.

### Oder lokal bauen
```bash
node tests/test_official_bundle.mjs        # Tests
tools/build_apk_local.sh                   # → app/build/outputs/apk/release/Trainrobot.apk
```
Die Release-APK ist debug-signiert → direkt installierbar. Voraussetzung:
Gradle 8.10.2 + SDK 35 (siehe `tools/build_apk_local.sh`, BUILD_ENV-Variable).

## Sim neu bauen (nur bei Bedarf)

Der fertige Dist liegt committet unter `app/src/main/assets/sim/`. Neu bauen:
```bash
git clone https://huggingface.co/spaces/pollen-robotics/microduck-simulator
cd microduck-simulator/app
# LFS-Dateien: https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/main/<pfad>
# (Skript: scripts/fetch_space_lfs.sh in der Sandbox tut das automatisch)
cp <pfad>/microduck_rough_v2.onnx public/policies/
# Patch 1 (constants.js): walk → microduck_rough_v2.onnx
# Patch 2 (ghosts.js):    ?noghosts-Frühausstieg
npm ci && npm run build
python3 ../../tools/build_sim.py --install dist/
```

## Trainings-Spiegel (Kaggle)

- `kaggle/` — PPO/Neuroevolutions-Kernels; MJ-Kernels nutzen die
  Menagerie-MJCFs aus `kaggle/mjc/` (`tools/prepare_kernels_mj.py`).
- `policies/microduck_rough_v2.onnx` — die gebundelte Walk-Policy
  (Sturzrate 12,5 % vs 20,8 % Hersteller-Referenz, siehe Referenz-Repo).

## Repo-Karte

```
app/                  Android-Shell (Java, WebView + WebViewAssetLoader)
  …/trainrobot/app/   MainActivity · SimActivity · SimAssetHandler ·
                      GeminiClient · Notifier
  src/main/assets/    sim/ (offizieller Dist) · md_bridge.js
bridge/md_bridge.js   Single Source of Truth der App-Bridge
tests/                test_official_bundle.mjs · browser_official_boot.js
tools/                build_sim.py (Verifier/Installer) · build_apk_local.sh
kaggle/               Trainings-Kernels + MJCFs (mjc/)
policies/             Trainingsartefakte
```
