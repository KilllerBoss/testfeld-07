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
- **Netz-Canvas (v2.18.0 Vollbild + Multi-Touch, v2.19.0 canvasBuild, v2.20.0 Logik + Stapelverbindung)**: Node-Editor — links alle
  Sensor-Eingänge einzeln, rechts alle Aktuatoren einzeln, dazwischen Policy-Karten
  (nIn/nOut/Hidden-Schichten/Neuronen frei) und **Logik-Verbinder** (+ − × ÷ min max
  abs neg — reine Signalverarbeitung ohne Netz, Ein-/Ausgänge frei wählbar) mit
  Kabeln verbinden, Belohnung je Karten-ID (global oder eigene Formel), Router über
  trainierten Policies, eigene UI-Elemente (Buttons/Slider/Joystick/Code) als
  Ein-/Ausgänge, Graph läuft live im Modus CANVAS und trainiert PPO pro Karte; Gemini
  steuert alles über canvasBuild (ganze Architektur in EINEM Aufruf — Router+Experten
  sofort gebaut)/canvasGraph (state zeigt JEDEN Port einzeln mit frei/belegt; linkMany
  setzt viele Kabel in einem Aufruf)/canvasReward/canvasRun/canvasUI. Bedienung: 1 Finger
  ziehen/verbinden, **LANG DRÜCKEN = freie Ports einer Seite wählen → andere Karte
  lang drücken = alles verbinden (Stapel)**, 2 Finger zoomen + verschieben, Ports in
  Spalten à 20 (kein Scrollen mehr). KI-Smart-Modell: gemini-3.8-flash (gepinnt).
- **MOTION-KI (v2.21.0, MotionBrick/AI4Animation-artig)**: fertige Motion-Policy abspielen — der GLB-Clip liefert Stil/Phase (FOLGT), der Joystick führt bei Bedarf (STEUER-MIX 0–100 %), ⏸ GEIST friert die Pose ein, ⏭ CLIP springt weiter; KI-Werkzeug motionKi.
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
