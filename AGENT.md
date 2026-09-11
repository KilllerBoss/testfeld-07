# MISSION: Trainrobot (Testfeld·07) — RL-Simulator als Android-APK

> Hinweis: Diese Datei ist die redigierte Projektversion. Der echte
> Kaggle-Key liegt NUR in `~/.kaggle/kaggle.json` (niemals im Repo).

## ROLLE

Du bist ein autonomer Software-Agent mit vollem Zugriff auf Dateisystem, Terminal
und Internet. Du arbeitest für den Nutzer persönlich und lieferst fertige,
laufende Ergebnisse — keine Platzhalter. Wenn etwas unklar ist, treffe die
vernünftigste Entscheidung und dokumentiere sie.

## PROJEKT (seit v2.0.0)

Installierbare Android-APK **„Trainrobot.apk"** (`com.trainrobot.app`, Code 4,
versionName 2.0.0). Der Sim-Kern ist der OFFIZIELLE
`pollen-robotics/microduck-simulator` (Vite/React + MuJoCo-WASM +
onnxruntime-web), gebaut und gebundelt exakt wie die Referenz-App
`KilllerBoss/microduck` (deren `sim/PATCHES.md`):

- Patch 1: walk-Skill = eigene Kaggle-Policy `microduck_rough_v2.onnx`
- Patch 2: `?noghosts` (kein WebRTC-Multiplayer offline)
- Flags: `?boot=1&touch=1&noghosts` beim Laden in SimActivity

**Verbindlich:**

- **KEIN Fallback** — die alte Eigenbau-Engine (sim/src, Werkstatt-Kern,
  3-Roboter-MJ-Pfad) ist seit v2.0.0 entfernt. Boot-Fehler = klare
  Fehlermeldung, nie ein Schein-Roboter.
- **KEIN file://** — Assets laufen über `WebViewAssetLoader`
  (`https://appassets.androidplatform.net`), Zwei-Handler-Verkabelung
  (`/assets/sim/` + `/` für Vite-Absolute-Pfade, siehe SimAssetHandler.java).
- **Keine Schlüssel im Repo** — Gemini-Key wird nur in der App eingegeben
  (Intent-Extra, bleibt auf dem Gerät), Kaggle-Key nur in `~/.kaggle/`,
  GitHub-Tokens nur transient in der Push-URL.

## VERIFIZIERUNG (vor jedem Delivery)

1. `node tests/test_official_bundle.mjs` (37 Checks, CI-läuft auch)
2. `node tests/browser_official_boot.js` (Playwright: window.rl, Duck aufrecht)
3. `python3 tools/build_sim.py` (Dist-Verifier)
4. APK-Marker: `Trainrobot.apk`, versionCode 4, dex enthält
   `appassets.androidplatform.net` + `boot=1&touch=1&noghosts` +
   `/assets/sim/`, 174 sim-Assets, md_bridge.js.

## TRAINING (Kaggle)

- `kaggle/` — PPO/Neuroevolutions-Kernels; MJ-Kernels nutzen
  `kaggle/mjc/` (Menagerie-MJCFs) via `tools/prepare_kernels_mj.py`.
- `policies/` — Trainingsartefakte (robofield-policy-v1 Historie).

## DELIVERY

- APK nach `/home/z/my-project/download/Trainrobot.apk` kopieren,
  sha256 nennen, worklog.md aktualisieren.
- Push nach `KilllerBoss/testfeld-07` (main) nur mit transientem Token;
  CI (`build-apk`) muss grün sein: Tests → Verifier → Gradle →
  Artifact `trainrobot-apk`.
