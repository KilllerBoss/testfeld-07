# Trainrobot · Testfeld·07

Offline-MuJoCo-Robotersandbox für Android — **Policy-Training komplett auf dem
Smartphone (CPU, ohne CUDA)**.

## Inhalt

- **Drei Roboter** (v2.14.0 — A1/Spot/Go2 wurden entfernt, APK deutlich kleiner),
  alle gleichberechtigt (ungebunden) mit einheitlicher Stick-Steuerung:
  - **MicroDuck** (Pollen Robotics · Hugging Face, Biped, 14 Servos, Soft-MoE-Politik
    mit 2–8 KI-tunbaren Experten, Curriculum L1–L5, FPV-Kopf-Kamera)
  - Unitree **G1** (Humanoid, 29 Aktuatoren, GLB-Motion-Tracking)
  - Skydio **X2** (Quadrocopter, 4 Rotoren, echter Kaskaden-Flugregler)
- **PPO-Policy-Training** (64×64-MLP bzw. Soft-MoE, GAE, Adam) — reines JS/WASM
  auf der CPU, Live-Kurven (Reward + Tempo/Loss), Tempo-Slider 1–16,
  Speichern/Laden/Export/Import (Policy-Datei mit Metadaten).
- **KI-Trainer (Gemini) mit Werkzeugen**: Trainingskonfiguration, Buttons/Makros,
  **setAppearance** (Farben + Glanz/Metallik je Roboter-Teil), **setWorld**
  (KI-Welt mit eigenen Objekten bauen), **setUI** (App-Designs + Vorschlags-Chips),
  **setMoE** (Expertenanzahl), **rWx-Zielterme** (goTo/stayNear/Höhenband/…),
  Plugins (Werkstatt), Art-MCP-Wissbasis (mcp/*.md).
- **GLB-Animations-Training (G1)**: eigene `.glb`-Clips (Mixamo-ähnlich)
  importieren → automatisches Retargeting auf die G1-Kinematik
  (Quaternion-Weltdelta → Gelenkachse, Fuß-Boden-Anpassung) →
  Behavior-Cloning (überwachte Vortrainierung) → PPO-Verfeinerung mit
  Motion-Tracking-Reward (DeepMimic-lite). Referenz-Geist läuft transparent
  in der 3D-Welt mit.
- Vollbild-3D-Welt mit Hindernis-Parkour, deutsche Werkbank-UI,
  keine Pre-Order-Elemente, kein Fallback (Fehler = harter Abbruch).

## Technik

- MuJoCo 3.9.0 als offizielles WASM (`@mujoco/mujoco`, Apache-2.0)
- Three.js (r171) für das Rendering, Modelle direkt aus `mjModel` gebaut
- WebView + `WebViewAssetLoader` (appassets.androidplatform.net), minSdk 30
- Roboter-Modelle: [mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie) (CC-BY 4.0, Lizenzen in `models/`)

## Bauen

```sh
./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

APK-Name im Release: `Trainrobot.apk` (v2.1.0, versionCode 5,
`com.trainrobot.app`).
