# 3D-Simulation: Build & Patches

Die in der App gebundelte 3D-Umgebung (`app/src/main/assets/sim/`) ist der
fertige Vite-Build des offiziellen **pollen-robotics/microduck-simulator**
(HF-Space: Vite/React, MuJoCo-WASM, three.js, onnxruntime-web) — gebaut
nach der Referenz-App `KilllerBoss/microduck` (deren `sim/PATCHES.md`).

## Patches (gegen upstream `app/`)

### 1. Eigene Policy als Walk-Skill — `src/game/constants.js`

```diff
 export const POLICY_DIR = "./policies";
 export const POLICIES = {
-  walk: `${POLICY_DIR}/BEST_alpha_walking.onnx`,
+  walk: `${POLICY_DIR}/microduck_rough_v2.onnx`,
```

Die eigene, auf Kaggle trainierte Policy (`policies/microduck_rough_v2.onnx`,
5000 Iterationen Rough-Velocity) hat exakt denselben 61D→14D-Vertrag wie die
Referenz (obs `ang_vel3 + proj_grav3 + joint_pos14 + joint_vel14 + last_act14
+ cmd13` → 14 Aktuator-Sollwerte) und läuft direkt in der Sim-Loop
(50 Hz, TIMESTEP 0.005 s, DECIMATION 4).

### 2. Multiplayer deaktivieren — `src/game/ghosts.js`

```diff
 export async function initGhosts(env) {
+  // APP-PATCH: Multiplayer in der Offline-App deaktiviert (kein WebRTC/Netzwerk)
+  if (new URLSearchParams(location.search).has("noghosts")) { …noop… }
```

### 3. URL-Flags der App

Kein Code-Patch — SimActivity lädt die Sim mit:

```
/assets/sim/index.html?boot=1&touch=1&noghosts
```

- `boot=1` überspringt den Title-Screen (eingebauter Test-Hook, `App.jsx`)
- `touch=1` aktiviert die Touch-Steuerung
- `noghosts` schaltet die Ghost-Multiplayer-Session ab (Patch 2)

## Build

```bash
git clone https://huggingface.co/spaces/pollen-robotics/microduck-simulator
cd microduck-simulator/app
# LFS-Dateien per resolve-URL laden (155 Dateien, ~17,6 MB):
# https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/main/<repo-pfad>
cp <pfad>/microduck_rough_v2.onnx public/policies/
# Patches 1+2 anwenden (siehe oben)
npm ci && npm run build
python3 tools/build_sim.py --install /pfad/zu/microduck-simulator/app/dist
```

Der fertige Dist ist committet — der Build ist nur bei Bedarf nötig.

## Android-Verkabelung (Unterschied zur Referenz-App)

Die Referenz-App registrierte den Asset-Handler unter `/assets/` und öffnete
dann `"sim/" + suffix` — effektiv `assets/sim/sim/…` → **jeder** Request
fiel durchs Raster (Handler `null` → Netzwerk-Fallback → offline nie
erfolgreich). Trainrobot korrigiert das (siehe `SimAssetHandler.java`):

1. Handler `/assets/sim/` → öffnet `sim/<suffix>` (das Dokument)
2. Handler `/` → öffnet `sim/<pfad>` für die host-absoluten Vite-Pfade
   (`/bundle/…`, `/policies/…`, `/robot/…`, `/assets/…`)

Der Playwright-Test `tests/browser_official_boot.js` spiegelt exakt diese
Verkabelung und beweist: `window.rl` erscheint, die Physik läuft, der Duck
steht aufrecht — alle Requests lokal bedient.
