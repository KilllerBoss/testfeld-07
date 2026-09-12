# Trainrobot · Testfeld·07

Offline-MuJoCo-Robotersandbox für Android — **Policy-Training komplett auf dem
Smartphone (CPU, ohne CUDA)**.

## Inhalt

- **Vier offizielle Google-DeepMind-Menagerie-Modelle**, alle gleichberechtigt
  (ungebunden) mit einheitlicher Stick-Steuerung:
  - Unitree **G1** (Humanoid, 29 Aktuatoren)
  - Unitree **A1** (Quadruped, 12)
  - Boston Dynamics **Spot** (Quadruped, 12)
  - Skydio **X2** (Quadrocopter, 4 Rotoren, echter Kaskaden-Flugregler)
- **PPO-Policy-Training** (64×64-MLP, GAE, Adam) — reines JS/WASM auf der CPU,
  Belohnungskurve live, Speichern/Laden/Export/Import.
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
