# Testfeld·07 — Robotik-Sandbox als Android-APK

Offline-Robotersimulator für Android (WebView + eigene WebGL-Engine), inspiriert
vom Hugging-Face-Space [`pollen-robotics/microduck-simulator`](https://huggingface.co/spaces/pollen-robotics/microduck-simulator)
(übernommen: INK/Orange-Palette, BIOS-Werkstattkonsole, translucent Geister,
Arcade-Props, Chase-Cam — Eigenbau-Physik statt MuJoCo-WASM, siehe Phase 2 unten).

**Drei Roboter:**

| Roboter | Typ | Aufgabe | obs→act |
|---|---|---|---|
| **MICRODUCK** | 2-Rad-Roller, 9 Strahl-Sensoren | Zielsuche zwischen 12 Hindernis-Zylindern | 12→2 |
| **ARMBOT** | 4-Achsen-Greifarm | Ball greifen, zur Abgabezone tragen | 15→5 |
| **HUMANOID** | Pendel-Balance-Läufer | Prozeduraler Gang, aufrecht bleiben, Ziele erreichen | 10→5 |

**RL sichtbar im Gerät:** Neuroevolution, Population 40, MLP 2×32 tanh,
8 translucent Geister parallel in der Arena, bester Kandidat wird Champion.
**Und auf Kaggle:** identische NumPy-Umgebungen (Determinismus bewiesen:
gleicher Seed → gleicher Reward, Abweichung < 5e-15, siehe `tools/check_determinism.py`).

---

## 1. Installation (Samsung Galaxy S26 Ultra oder jedes Android 8+)

### APK selbst bauen (GitHub Actions)
1. Repo forken/pushen → Tab **Actions** → Workflow `build-apk` läuft automatisch.
2. Artifact `testfeld07-release-apk` herunterladen → `app-release.apk`.
3. Auf dem Handy installieren („Unbekannte Apps erlauben" für den Dateimanager).

### Oder lokal bauen
```bash
python3 tools/build_sim.py          # erzeugt app/src/main/assets/index.html
gradle wrapper --gradle-version 8.10.2   # einmalig, braucht lokale Gradle-Installation
./gradlew :app:assembleRelease      # APK liegt in app/build/outputs/apk/release/
```
Die Release-APK ist debug-signiert → direkt installierbar.

### Desktop-Vorschau
`python3 tools/build_sim.py` erzeugt zusätzlich `download/testfeld07-preview.html`
— einfach im Browser öffnen (Chromium empfohlen).

## 2. Steuerung

- **Joystick links**: Roboter fahren (Arm: IK-Ziel, Basis zielt selbst aufs Ball-Azimut)
- **Buttons rechts**: ZIEL / STRAHLEN / GREIFER / HALT / RESET (kontextabhängig)
- **Kamera**: 1 Finger ziehen = Orbit, 2 Finger / Rad = Zoom
- **Farb-Dots**: Enten-Lackierung (sie quackt)
- **TRAIN ▶**: startet 60 Generationen On-Device (Panel oben rechts zeigt
  Fitnesskurve: orange = best, grau = Durchschnitt)
- **KONSOLE**: deutsche Sätze **und** JSON-Protokoll (Details unten)

## 3. Werkstatt-Konsole (Deutsch + JSON)

Die Konsole ist die Fernsteuer-Schnittstelle für Sprachmodelle.

| Deutsch | JSON-Protokoll |
|---|---|
| „trainiere den duck 120 generationen" | `{"cmd":"train","robot":"duck","gens":120}` |
| „stop" | — (oder Training-Button) |
| „roboter humanoid" | `{"cmd":"robot","id":"humanoid"}` |
| „manuell" / „policy" | `{"cmd":"mode","mode":"manual"}` |
| „tag" / „abend" / „nacht" | `{"cmd":"tod","tod":"night"}` |
| „speichere mein-champion" | `{"cmd":"save","name":"mein-champion"}` |
| „lade mein-champion" | `{"cmd":"load","name":"mein-champion"}` |
| „neues ziel" | `{"cmd":"target"}` |
| „reset" / „status" / „export" | `{"cmd":"reset"}` / `{"cmd":"status"}` / `{"cmd":"export"}` |
| Policy-JSON einfach einfügen | `{"cmd":"import","policy":{...}}` |

Roboter-IDs: `duck`, `arm`, `humanoid` (auch „entchen", „greifarm", „läufer"…).
Mehrere JSON-Befehle: als Array `[ {...}, {...} ]`.

## 4. Policy-Austauschformat (verbindlich)

```json
{
  "format": "robofield-policy-v1",
  "robot": "duck",
  "arch": [12, 32, 32, 2],
  "weights": [ [...], [...], [...], [...], [...], [...] ],
  "gen": 200,
  "fit": 123.4,
  "src": "kaggle"
}
```
`weights` = 6 flache Tensoren in der Reihenfolge **W1 (32×obs), b1 (32),
W2 (32×32), b2 (32), W3 (act×32), b3 (act)**, row-major, y = tanh(W·x + b).
Gewichtssummen: duck 1538, arm 2437, humanoid 1762.

Export: Konsole `export` → Datei landet via Android-Bridge in
`Android/data/com.testfeld07.app/files/Dokumente/` (oder Browser-Download).
Import: Datei-Dialog (Konsole `import`), JSON in Konsole einfügen, oder
`/Dokumente` und Konsole `lade <name>`.

## 5. Training auf Kaggle

Vorbereitung (einmalig):
```bash
mkdir -p ~/.kaggle && cp kaggle.json.example ~/.kaggle/kaggle.json
# ~/.kaggle/kaggle.json mit den echten Zugangsdaten füllen, dann:
chmod 600 ~/.kaggle/kaggle.json
pip install kaggle
kaggle kernels list --mine     # Verifikation
```

Training anstoßen (200 Generationen duck ≈ 3–6 min auf Kaggle-CPU):
```bash
python3 tools/prepare_kernels.py                       # Kernel-Verzeichnisse bauen
kaggle kernels push -p kaggle/kernel_duck
kaggle kernels status rudolfbewer/testfeld07-duck      # pollen (~60 s Abstand)
kaggle kernels output rudolfbewer/testfeld07-duck -p out/
```
`out/policy.json` → Konsole der App: Datei importieren (oder JSON einfügen) →
Champion ersetzt. `out/fitness.csv` enthält die Kurve (gen, best, avg).

Lokal geht es genauso (dieselben Skripte):
```bash
cd kaggle && python3 train_duck.py --gens 200     # ≈ 3–4 min, CPU reicht
```

Sicherheit: Der Kaggle-Key liegt NUR in `~/.kaggle/kaggle.json` (ist in
`.gitignore`). Im Repo liegt nur `kaggle.json.example` mit Platzhaltern.
**Nach einem Leak: kaggle.com → Settings → API → „Expire Token".**

## 6. Gemini-Anbindung

Die Konsole hat einen **GEMINI**-Button: Aufgabe eintippen → Button drücken.
Beim ersten Mal fragt die App nach deinem Gemini-API-Key (wird nur lokal im
localStorage gespeichert, nie ins Repo/APK geschrieben).

Gemini bekommt ein System-Prompt, das **ausschließlich** JSON-Kommandos des
Protokolls liefert; die Konsole führt sie direkt aus.

Beispiel-Aufgaben:
- „Trainiere den Duck 150 Generationen und dann den Greifarm 80."
- „Es soll Nacht werden und der Humanoid soll übernehmen."
- „Welche Roboter gibt es? Trainiere alle je 50 Generationen."
- „Speichere den aktuellen Champion als nacht-laeufer."

API-Key besorgen: [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Hinweis: Der Aufruf braucht Internet — die Sandbox selbst bleibt komplett offline.
Für Server/Agent-Nutzung außerhalb der App gilt dasselbe Protokoll: Gemini das
System-Prompt aus `sim/src/app.js` (Konstante `GEMINI_SYS`) geben und die
Antwortzeilen in die Konsole füttern.

## 7. Neuen Roboter hinzufügen (Muster)

1. **Env** in `sim/src/envs.js`: Klasse mit `reset(seed)`, `step(...)` →
   `{reward, done}`, `getObs()` — deterministisch aus dem Seed, keine
   DOM-Abhängigkeit. In `TF.makeEnv` + `TF.EP_LEN` + `TF.nn.ARCHS`
   (`[obs, 32, 32, act]`) + `ACT_LIMITS` eintragen.
2. **3D-View** in `sim/src/views.js`: `<Name>Rig(lib, {ghost})` mit
   `update(env)` + `root`-Node; in `app.js` (`worlds`-Aufbau) registrieren.
3. **Buttons** in `sim/src/ui.js` (`BTN_DEFS`) ergänzen.
4. **Kaggle-Spiegel**: Env als `XEnvScalar` in `kaggle/robofield_envs.py`
   (Operation für Operation wie JS!) und als `XEnvBatch` in
   `kaggle/trainer.py`; `ARCHS`/`EP` in `robofield_common.py` erweitern.
5. **Beweisen**: `python3 tools/check_determinism.py` (Fall ergänzen) und
   den Batch-Check (Ende von `kaggle/trainer.py`-Tests) laufen lassen —
   Differenz muss < 1e-6 sein (real ~1e-15).
6. `train_<robot>.py` + `tools/prepare_kernels.py` erweitern → pushen.

## 8. Projektstruktur

```
app/                     Android-Projekt (Gradle, 0 Abhängigkeiten)
  src/main/assets/index.html   ← die KOMPLETTE Sim (eine Datei, offline)
  src/main/java/.../MainActivity.java  (WebView, Immersive, JS-Brücke)
sim/src/                 Sim-Quellcode (Module, werden zu index.html gebaut)
  rng.js nn.js envs.js console.js render.js views.js ui.js app.js
kaggle/                  NumPy-Spiegel + Trainer + Kernel-Pakete
  kernel_duck/ kernel_arm/ kernel_humanoid/
tools/                   build_sim.py, check_determinism.py, prepare_kernels.py
tests/                   Node-Tests (Konsole, NN, Envs, Stresstest, Mirror)
policies/                versionierte Champion-Policies (Datum/Generation im Namen)
.github/workflows/       build-apk.yml (APK-Artifact bei jedem Push)
```

## 9. Phase 2 (geplant, nicht gebaut): MuJoCo via NDK/JNI

Ablösung der JS-Approximationen durch echte Dynamik:
1. MuJoCo 3.x mit NDK cross-kompilieren (`mujoco/build` → `libmujoco.so`).
2. JNI-Brücke (`MjStep.step(mjcf, qpos, ctrl)`), MJCF-Modelle für die 3 Roboter
   (`assets/mjcf/*.xml`), RL-Obs aus `qpos/qvel` wie beim microduck-Space
   (61D-Obs-Muster).
3. Schrittweise Ablösung pro Roboter: erst Duck (Roller trivial), dann Arm
   (Kontakte am Greifer), dann Humanoid (echte Fußkontakte). Die
   Neuroevolution/Policy-Struktur bleibt unverändert — nur `step()` tauscht.
