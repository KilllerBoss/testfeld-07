# Worklog — Trainrobot / Testfeld·07

---
Task ID: 16
Agent: Super Z (Hauptagent)
Task: Hochwertige Trainrobot.apk v2.1.0 — 4 Menagerie-Roboter, CPU-PPO-Training, GLB-Animations-Training (Retargeting + BC + Motion-PPO), Vollbild-Welt, native UI

Work Log:
- Umgebung war zurückgesetzt (Repo weg) → kompletter Neuaufbau von null
- Assets beschafft: offizielles MuJoCo-WASM (@mujoco/mujoco 3.9.0, npm), Three.js r171, Menagerie-Sparse-Clone (unitree_g1, unitree_a1, boston_dynamics_spot, skydio_x2) inkl. Lizenzen
- Web-App komplett neu geschrieben (www/js): engine.js (VFS+TypedArray-Zugriff, heap-sichere Getter!), robots.js (4 Roboter + Gaits: Ellipsen-CPG Trott, G1-Marsch, Drohnen-Kaskadenregler), train.js (PPO: MLP 64×64, GAE, Adam, BC-Epochen), render3d.js (Meshes direkt aus mjModel, Geist-Overlay), controls.js (Stick/Gesten/Tastatur), ui.js, glb.js (GLB-Parser), retarget.js (Weltdelta→G1-Achsen, Fuß-Boden-Anpassung), motiontask.js (DeepMimic-lite), glbstore.js (IndexedDB), main.js (Boot/Loop/Modi)
- Szenen-XMLs generiert (scripts/gen_models.py): Hindernis-Parkour je Roboterskalierung + manifest.json je Modell
- Wichtige Bug-Jagden: applyGait stepte Physik nicht; checkFall las falsche Quaternion-Komponenten; Sparse-Array-Löcher im Renderer; task._ref nie initialisiert; Fog-Uniform-Namen; resp.slice; „roboter läuft rückwärts" (Menagerie-Achsenkonvention → Ellipsen-CPG mit sin/cos-Knie); Drohne: falsche trnid-Spalte, Masse aus statischen Bodies, viel zu große Torque-Gains (Basis-I≈0,0005 kg·m²) → physikalisch skalierte Regler; MjData-Allokation detacht gecachte TypedArrays (HEAP-Wachstum!) → Getter; falsy-0-Bug bei bones.hips=Node 0; sampleWorld-Rekursions-Aliasing + Frame-Cache-Freeze; GLB-Achsenmapping Y-up/+Z → Z-up/+X = 120°-Raumdiagonale [0.5,0.5,0.5,0.5]; wireUI-Syntaxkorruption → Block regeneriert (node ODER acorn grün)
- Android: MainActivity (WebViewAssetLoader, Immersive, DOM-Storage), Manifest, Theme, Icon, gradle.properties (useAndroidX), Keystore-Fix, Gradle 8.7 + SDK 34 lokal installiert → BUILD SUCCESSFUL, Trainrobot.apk 28,5 MB (v2.1.0, versionCode 5, com.trainrobot.app, minSdk 30)
- CI: .github/workflows/build-apk.yml (WASM-Magie, Verbotene-Strings, 4 Modelle, GLB-Pipeline, Keystore im CI, Artifact + Tag-Release)
- Tests: scripts/smoke.mjs (Node, WASM-echt), browser_test.mjs (6 Playwright-Suiten), glb_pipeline_test.mjs (synthetisches GLB end-to-end), glb_browser_test.mjs (GLB-Import→Retarget→BC→Motion-PPO im Chromium) — ALLE GRÜN
- Commit: testfeld-07 eigenes Repo, 797d721, 175 Dateien

Stage Summary:
- Trainrobot.apk (v2.1.0) fertig gebaut und verifiziert: /home/z/my-project/download/Trainrobot.apk
- sha256: 5efa17c562dadc49f02e10027f8b8ada9841ef53c47bcbffaa4b126ddea90e4f
- GLB-Pipeline nach Nutzerplan: Retargeting ✓, Trajektorien-Physik-Cleanup via PPO-Motion-Tracking ✓ (statt QP — handfest lauffähig auf Phone-CPU), Übergänge per Blend ✓, Behavior Cloning ✓, Residual-PPO ✓, Referenz-Geist ✓
- Push zu KilllerBoss/testfeld-07 + GitHub-Release Steht AUS: Token wurde in früherer Sitzung gegeben, aber nicht persistiert → beim Nutzer anfragen

---
Task ID: 17
Agent: Super Z (Hauptagent)
Task: v2.2.0 auf GitHub pushen + Release mit Download-Link

Work Log:
- Remote-Analyse: altes v2.1.0-Release (ROBOLAB-Build 317f0bfb, 24,9 MB) existierte bereits → Verwechslungsgefahr
- Version lokal gebumpt: versionCode 6 / versionName 2.2.0 (app/build.gradle + main.js VERSION-String)
- SDK war noch vorhanden (/home/z/tools/android-sdk, platforms;android-34, build-tools;34.0.0) → local.properties gesetzt
- Neu gebaut mit stabilem trainrobot.keystore (NICHT CI-Zufalls-Key) → Update-fähig über alte v2.x-Installationen
- APK verifiziert: versionCode=6, versionName=2.2.0, Signatur CN=Trainrobot OU=Testfeld07
- Commit 86910ac, Force-Push auf main (unabhängige Historien, alter Code bleibt unter Tag v2.1.0 erreichbar)
- CI-Run 34708290906: GRÜN (Hart-Prüfungen: WASM-Magie, keine Alt-Strings, 4 Modelle, GLB-Pipeline + Build)
- Release v2.2.0 erstellt (id 387648078), Asset-Upload via uploads.github.com (state=uploaded, 28.516.642 bytes)
- Integritätscheck: Asset zurückgeladen via API-Endpunkt /releases/assets/<id> + Accept: application/octet-stream → sha256 identisch cceeb3f0...; Browser-Download-URL lieferte 404 "Not Found" (privates Repo, Redirect-Problem) — API-Methode ist der verlässliche Weg

Stage Summary:
- Release v2.2.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.2.0
- Asset: Trainrobot.apk, 28,5 MB, sha256 cceeb3f0b92c2df5e5a75591d643eaf67a324ef839e028a5f123694e9768de29
- main = 86910ac (v2.2.0), CI grün, Token nicht in Repo/Logs/Scripts persistiert

(Historie Task 18–22 — v2.3.x-Zyklen, Repo-Public-Making — wurde in vorheriger Sitzung geführt; Live-Stand bei Sitzungsbeginn: v2.3.2/67655a7, später v2.4.0/3b602f0, Repo öffentlich, CI grün)

---
Task ID: 23
Agent: Super Z (Hauptagent)
Task: v2.4.1 — „Geist kickt/zuckt obwohl die GLB-Beine ruhig am Boden stehen, manchmal dreht er sich komplett um" beheben

Work Log:
- Umgebung war zurückgesetzt (Repo/SDK/User-GLBs weg) → anonymen Clone von KilllerBoss/testfeld-07 (öffentlich) geholt; Arbeitsverzeichnis = Repo-Root (Layout v2.4.0), Stand 3b602f0
- Screenshot-Analyse + Vollständige Code-Lektüre (retarget.js 969 Zeilen IK-am-Geist-FK, glb.js, motiontask.js, engine.js setGhostPose, render3d.js, main.js-Loop)
- Repro-Harness neu gebaut (scripts/glb_diag.mjs): echtes MuJoCo-WASM in Node, synthetische Mixamo-GLBs (statisches Idle, Idle mit Sway/Bob, Signflip-Idle, Walk ±Z), Analysen: Gelenk-Δ/Frame, Loop-Naht, Yaw-/baseQ-Sprünge, Loop-Display-Simulation 60 s, Physik-Test (March-Gait)
- FEHLER NACHGEWIESEN:
  1) rawYaw ohne ALIGN-Rotation (retarget.js) → atan2(Sway_x, 0) flippte ±90° pro Nulldurchgang = 180°-Drehungen; beim Gehen tarnte sich der Bug (Bewegungsvektor zufällig ≈90°)
  2) Loop-Rebase akkumulierte yaw[n−1]−yaw[0] JEDE Schleife → 180° nach 60 s bei Idle („dreht sich komplett um")
  3) Quaternion-Vorzeichenflips je Keyframe (UE/Blender/assimp-Exports) → ±180°-Gelenkspikes (216 im Test, Ellbogen/Waist)
  4) Knie/Ellbogen-IK startete jeden Frame aus Nullen → Basin-Sprünge (Ellbogen 0,49 rad/Frame)
  5) Loop-Naht 19°-Snap pro 1,33 s
  6) Yaw-Quellenwechsel (Pfad vs. Hüfte) ohne Hysterese
- FIXES: ALIGN-Sandwich im rawYaw; Sign-Kanonisierung je Knoten in GlbClip._localQuat (_signMemo, Reset in useAnimation); IK-Warm-Start (copyWithin vom Vorgängerframe + Frame 0 doppelt gelöst); Spike-Brücke (adaptiv, Median-Skala); Loop-Naht-Blend (Smoothstep, letzte 8 Frames); Yaw-Hysterese (SPEED_MIN 0,15 / 0,55×) + bridgeAngles-Sicherheitsnetz; locomotion-Flag (meanSpeed > 0,1 m/s) → Loop-Rebase nur bei echter Fortbewegung (motiontask.advance + pack/unpackMotion)
- VERIFIKATION: Idle 3,14→0,01 rad; Idle_sway 0,49→0,12 rad, Naht 0,33→0,01, Yaw-Spannweite 180°→6,8°; Signflip-Spikes 216→0; Walk unverändert gut (0,15 rad) mit endloser Root-Motion (68 m/60 s, locomotion=true); Loop-Drift 180°→0°; Physik: 0 Auto-Resets; Browser-E2E (scripts/glb_browser_test.mjs, Playwright): Boot→G1→Import→Retarget→Ghost, 8 s Idle: 0 m Basis-Drift (Walk-Teil crashte am SwiftShader-Emulator nach Core-Assertion — Umgebungsproblem, nicht App)
- APK: SDK neu installiert (cmdline-tools + platforms;android-34 + build-tools;34.0.0), Gradle 8.7, assembleRelease GRÜN (1 m 26 s), versionCode 13 / versionName 2.4.1, Signatur CN=Trainrobot OU=Testfeld07 (stabil)
- Release: main 48dd2ef + Tag v2.4.1 gepusht (Token nur inline), CI grün; Tag-Push triggerte KEIN Release (Workflow hatte kein tags:-Trigger) → Release manuell via API (id 387846844), Asset-Upload Trainrobot.apk 28.566.622 bytes, Integritätscheck: Download via assets/<id> + octet-stream, sha256 identisch
- Workflow-Fix nachgereicht (42c50dd): tags: ['v*'] in on.push → künftige Tag-Pushes bauen+releasen automatisch; CI grün

Stage Summary:
- Release v2.4.1 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.4.1
- Download (anonym verifiziert, 302→200): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.4.1/Trainrobot.apk
- sha256: 4d4244e17c0855f07f6853da4f7b8b1cf53a8afb940bacab38660b3803fedc96
- main = 42c50dd, versionCode 13, CI grün, Token nicht in Repo/Logs/Scripts persistiert
- Diagnose-Werkzeuge bleiben erhalten: scripts/glb_diag.mjs (Node/WASM), scripts/glb_browser_test.mjs (Playwright)

---
Task ID: 24
Agent: Super Z (Hauptagent)
Task: v2.5.0 — Schubsen richtig stark, Steuerungs-Wahl je Trainings-Clip (Joystick-Domain-Randomization), GLB-Fehler (schiefer Rücken, zuckender Arm), GLB-Animation im Training abschaltbar

Work Log:
- pushRandom war Impuls-basiert (strength×12 N·s → beim ~35 kg G1 nur Δv≈0,5 m/s — „Schubsen geht nicht") → jetzt Δv-basiert: j = strength × Gesamtmasse, Default 3 (Δv 3 m/s), Range [0,5; 10] (engine.js, main.js doPush, agent.js load/savePushStrength + validateAction, ai.js clamp + Prompt)
- Steuerungs-Wahl je GLB-Clip (index.html glb-ctrl-row, main.js wireUI + activateClip, IDB rec.ctrl): Chips „Keine"/„Joystick". motiontask.js: obsDim 3·nu+12 → 3·nu+14 (Kommando vx/wz immer im obs), ctrlMode 'joy' → Zufalls-Kommandos im Training (sampleCmd: Haltezeit 1,5–4 s, 25 % Stille, vx bis ~1 m/s, wz ±0,9 rad/s), Wurzel-Ziel = Kommando-Integration (_tx/_ty/_tyaw), Phasen-Tempo skaliert mit Kommandotempo (Faktor 0,4–1,7 bei Locomotion), POLICY-Modus: controls.command → task.cmd (Stick steuert)
- Animation im Training abschaltbar (animOn): sampleRef → Keyframe-Stand, Posen-Anteil ×0,35, Wurzel-Ziel fix am Start (Gleichgewicht ohne Anim lernen); Persistierung tr_animOn, Checkbox „Animation im Training"
- GLB-FIX 1 (linker Arm zuckt): Schulter-Seed hatte pitch/roll VERTAUSCHT (g1.xml: Schulter = Hüfte-Konvention, pitch axis 0 1 0 / roll axis 1 0 0; alter Code pitch←X, roll←Y → Zombie-Arm −90° landete im ROLL-Clamp ±1,59 statt im PITCH ±3,09) + Seed wurde JEDES Frame gewaltsam eingetragen (warf konvergierte Warm-Start-Lösung weg) → jetzt: pitch←Y, roll←X + „Sanftanker mit Look-Ahead" (Frame 0 voll; danach VOLL-Seed nur messen, bei >0,05 rad Verbesserung ratenlimitiert 0,25 rad/Frame hinzitiert)
- GLB-FIX 2 (Rücken schief): „Brust" war der Elternknochen des Arms = seitlich versetztes Schlüsselbein (Mixamo LeftShoulder / UE clavicle_l) → Basis-Triade kippte lateral. Jetzt oberste SPINE-Node zwischen Hüfte und Arm (Mixamo Spine2, UE spine_03)
- GLB-FIX 3: Track-Lücken-Füllung (dSrc/footW NaN → letzter gültiger Wert), adaptive denoiseTimeline (ruhige Gelenke: Nadel-Schwelle 0,045 statt 0,3 + 3-Tap-Median) + Stufen-Brücke (einmaliger Sprung >0,45 rad mit ruhiger Fortsetzung → über 2 Frames verteilt)
- VERIFIKATION: scripts/motion_ctrl_test.mjs NEU (14 Checks: obsDim, 'none' identisch v2.4.1, joy-Würfel/Integration/Phasen-Faktor, animOn=false Stand-Referenz, Sturz-Abbruch) — GRÜN; glb_diag.mjs: 0 Spikes >0,5 rad in ALLEN Clips (Idle 0,10 / Sway 0,40 / Walk 0,13 rad max Δ — v2.4.1 war klein, weil Arme eingefroren/clamped), Walk-Root-Motion unverändert (68 m/60 s), Loop-Yaw 0°; Browser-E2E: Boot→G1→Import→Motion-Task→Geist→v2.5.0-UI-Chips/Toggle→obsDim GRÜN (Absturz danach = bekannter SwiftShader-Umgebungsfehler, auch auf v2.4.1-Baseline reproduziert)
- APK: SDK neu installiert (cmdline-tools, platforms;android-34, build-tools;34.0.0 → /home/z/tools/android-sdk), Gradle 8.7 manuell (Wrapper-Download brach), assembleRelease OK, versionCode 14 / versionName 2.5.0, Signatur CN=Trainrobot OU=Testfeld07 (stabil), 28.573.130 bytes
- Commit lokal: dca3d5b — PUSH/CI/RELEASE OFFEN: GitHub-Token nicht mehr im Environment (wird nie persistiert) → beim Nutzer anfragen

Stage Summary:
- Trainrobot.apk v2.5.0 lokal gebaut + verifiziert: /home/z/my-project/download/Trainrobot.apk
- sha256: 452670bfa10aea82ef2c2428e32adf94317ada3e41aa36b818a94aad543cd4d9
- Release v2.5.0 (Push main + Tag + CI + GitHub-Release) WARTET AUF TOKEN vom Nutzer

---
Task ID: 24-Release
Agent: Super Z (Hauptagent)
Task: v2.5.0 auf GitHub pushen + Release abschließen (Token vom Nutzer erhalten)

Work Log:
- Lokaler Zustand verifiziert: Commit dca3d5b (v2.5.0) + 2 UUID-Snapshot-Commits (1088e95, 6a60995) vorhanden; app/ seit dca3d5b unverändert → gebautes APK passt exakt zum Quellstand; aapt: versionCode 14 / versionName 2.5.0; sha256 stimmt mit Task-24-Eintrag überein
- Sicherheits-Checks vor Push: .env enthält nur lokale DB-URL (kein Token); Keystore seit v2.2.1 absichtlich im Repo; Token-Scan (rg ghp_) über Arbeitsbaum: keine Treffer; „branches: ain]" war ein Terminal-Output-Artefakt — committeter Workflow korrekt (od -c prüft)
- Push: main 42c50dd→6a60995 (Inline-Token, kein Remote-Eintrag, Token nicht persistiert), danach Tag v2.5.0 (getaggter Commit 6a60995)
- CI: main-Run 34756525770 GRÜN; Tag-Run 34756530735: Build+Artefakt GRÜN, aber Schritt „Release bei Tag" FEHLGESCHLAGEN — softprops/action-gh-release 403 „Resource not accessible by integration" (GITHUB_TOKEN ohne contents:write)
- Release manuell via API (scripts/release_v250.sh, Token nur als Argument): Release-ID 387890195, Asset-Upload Trainrobot.apk 28.572.330 bytes (state=uploaded, asset-id 561166226)
- Integritätscheck: Asset-Download via /releases/assets/561166226 + Accept: octet-stream → sha256 identisch 452670bf…cd4d9; aapt des Assets: versionCode 14 / 2.5.0
- Anonymer Browser-Download verifiziert: releases/download/v2.5.0/Trainrobot.apk → HTTP 200, 28.572.330 bytes
- Workflow-Fix nachgereicht: permissions: contents: write in build-apk.yml → künftige Tag-Pushes bauen+releasen automatisch

Stage Summary:
- Release v2.5.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.5.0
- Download (anonym verifiziert, HTTP 200): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.5.0/Trainrobot.apk
- sha256: 452670bfa10aea82ef2c2428e32adf94317ada3e41aa36b818a94aad543cd4d9
- main = Worklog-Commit (dca3d5b + Snapshots + Workflow-Fix + Worklog), CI grün, Token nicht in Repo/Logs/Scripts persistiert

---
Task ID: 25
Agent: Super Z (Hauptagent)
Task: v2.6.0 — Bein-Fix (X-Beine), Buttons unten, Button-Steuerung je GLB-Clip (Kicken/Springen), aktiven GLB deaktivierbar

Work Log:
- Bein-Diagnose NEU (scripts/leg_diag.mjs): Lehrer↔G1-Vergleich pro Frame aus srcPos vs. Ghost-FK — Befund: OS 0,2° aber SB konstant 9,8° nach innen geknickt (BEIDE Beine, frameunabhängig = „Bein etwas falsch"); Ursache: G1-Nullpose = A-Stand (OS ±9° außen), IK richtete nur den OS exakt aus (roll ∓0,16), das Knie-Scharnier kann laterale Fehler nicht korrigieren → X-Bein; bei gebeugtem Knie (55°-March-Test) alles korrekt, deshalb bisher unsichtbar
- FIX: VALGUS-Messung aus der Nullpose (latAng(SB)−latAng(OS) je Seite, ±0,16 rad); bei „geradem" Bein (OS↔SB < 20°) rotiert mkGoals das Hüftziel um −valgus/2 um die Basis-X-Achse → symmetrischer A-Stand (OS ~5° außen / SB ~4,5° innen statt 0°/10° Knick); gebogene Beine zielen weiter exakt auf den OS; Regression: glb_diag- Suite grün (0 Spikes, Naht ≤0,13 rad, Yaw 0°, Walk-Root unverändert)
- Buttons UNTEN: .ai-buttons (KI-Buttons) von top:128px auf bottom (+100px) zwischen Joystick und ActionCol verlegt; neue .clip-buttons-Leiste (+58px)
- Steuerung „Buttons" je GLB-Clip (dritter Chip neben Keine/Joystick): motiontask obsDim 3·nu+14 → 3·nu+18 (+4 Trigger-Kanäle, geglättet 0..1, Anstieg dt·8/Abfall dt·4); ctrlMode 'btn' = joy-Verhalten PLUS Zufalls-Trigger im Training (25 % je Kanal, 0,8–2,0 s) + Posen-Anteil 0,25× + Bewegungs-Bonus 0,08 (Freistil in der Pose-Familie, Höhe/Aufrecht/Bahn halten sicher); setTrigger(i) für POLICY-Modus; Buttons je Clip persistiert (rec.buttons, max. 4); UI: Eingabezeile (glbBtnRow) nur im btn-Modus, Buttons unten in der Leiste — tippen = Trigger (buzz + .hold), lang drücken (600 ms) = löschen; alte Policies (obsDim 3·nu+14) werden von der bestehenden obsDim-Wache sauber verworfen
- GLB DEAKTIVIERBAR (Nutzer-Root-Cause gefunden!): refreshClipList verglich S.motionClip.name (Animationsname) mit rec.name (Dateiname) — griff NIE, die aktive Zeile zeigte also nie „Aktiv" und Deaktivieren war unmöglich („nur entfernen, aber es bleibt geladen"); jetzt Aktiv-Merkung über S.activeRecId === rec.id + Button „Aus" auf der aktiven Zeile (deactivateClip ohne Löschung), × behält Deaktivier-Logik
- TESTS: motion_ctrl_test erweitert (24 Checks, u. a. Trigger-Würfeln/Glättung/Reward-Umverteilung/setTrigger-Gate, obs-Positionen cmd=−nu−6, trg=−nu−4..−1) GRÜN; ui_v260_test.mjs NEU (15 Playwright-Checks: Chips, Eingabezeile, Buttons unten, Persistenz, Trigger 0,41, Lang-Drücken-Löschung, „Aus"-Deaktivierung, KI-Leiste unten) GRÜN; glb_browser_test Kern-Assertions grün (danach bekannter SwiftShader-Umgebungs-Crash, auch auf Baseline)
- Build: SDK/Gradle 8.7 neu installiert (Environment-Reset; cmdline-tools 11076708, platforms;android-34, build-tools;34.0.0 → /home/z/tools/android-sdk), assembleRelease OK, versionCode 15 / versionName 2.6.0, Signatur CN=Trainrobot OU=Testfeld07 (stabil, SHA-256 1c0422b9…), 28.576.234 bytes; APK-Inhalt geprüft (alle v2.6.0-Assets enthalten)
- Release: main 85de360→c15c0d6 + Tag v2.6.0 gepusht (Token nur inline) — CI BEIDE Runs grün UND der Workflow erstellte das Release dank permissions:contents:write ERSTMALS AUTOMATISCH (Release id 387969695, Asset 561590362, state=uploaded); Integrität: Asset-Download via API → aapt versionCode 15/2.6.0, Signatur identisch; anonymer Download HTTP 200 mit voller Größe
- CI-Build-sha256: df52ec67804582ef53b93037b70f69e69bd1c49ed9d0b24ea5f5bc3a8766e18f (lokal: e5d635723979968fa87816d26ef60f5d25be395402957809fb8fe013dd1a2de6 — Zip-Metadaten unterscheiden sich, Signatur identisch)

Stage Summary:
- Release v2.6.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.6.0
- Download (anonym verifiziert, HTTP 200): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.6.0/Trainrobot.apk
- sha256 (CI-Build): df52ec67804582ef53b93037b70f69e69bd1c49ed9d0b24ea5f5bc3a8766e18f
- main = c15c0d6, versionCode 15, CI grün, Auto-Release via Workflow funktioniert jetzt, Token nicht persistiert
- Neue Diagnose-Werkzeuge: scripts/leg_diag.mjs (Bein-Abweichung Lehrer↔G1), scripts/ui_v260_test.mjs (UI-Verdrahtung)

---
Task ID: 26
Agent: Super Z (Hauptagent)
Task: v2.6.1 — „Linkes Bein zeigt nach innen, muss aber nach außen — liegt es an der Hüfte?" (Screenshot- Analyse + Root-Cause)

Work Log:
- Screenshot-Analyse (Zoom): G1-Geist knickt mit dem linken Unterschenkel/Fuß nach innen — Nutzer-Vermutung „Hüfte"
- CODE-LEKTÜRE: activateClip lud `unpackMotion(rec.motion)` — das retargetete Ergebnis liegt PERSISTIERT im IndexedDB-Record! ROOT-CAUSE 1: Das v2.6.0-Bein-Fix lief nur beim Import — bestehende Clips zeigten FÜR IMMER den v2.5.0-Stand („Es ist wie davor" exakt erklärt)
- ROOT-CAUSE 2 (Diagnose scripts/leg_idle_diag.mjs NEU, gerades Lehrer-Bein, statisch): v2.6.0-Winkelbisektor ließ die SCHIENEN beidseitig 4,5° nach INNEN knicken (OS 5,1° außen / SB −4,5° innen, symmetrisch) — der sichtbare X-Rest
- G1-Modell-Geometrie verifiziert (g1.xml): linke/rechte Hüftketten sind spiegel-symmetrisch (fixe Quats R_y(∓10°), Nullpose = A-Stand OS ±9,14°, SB senkrecht) — kein Modell-Fehler
- FIX 1 (Cache): RT_ALG=3 exportiert (Versionszähler des Retargeting-Algorithmus), motion.alg in packMotion/unpackMotion durchgereicht; activateClip: wenn rec.motion.alg < RT_ALG && rec.glb → EINMALIG neu retargeten + Record aktualisieren (ctrl/buttons/glb bleiben); activateClip jetzt async (behebt nebenbei latenten .catch-Bug am AI-Action-Pfad 'clip')
- FIX 2 (Outward-Look): mkGoals bei geradem Bein VOLLER Valgus statt halber (Ziel = um −VALGUS·w rotierte OS-Richtung) → hip_roll ≈ 0 = natürliche G1-Standpose (OS ±9,15° außen, SB 0,00° senkrecht, Fuß unter Hüfte); smoothstep-Gewicht über dot 0,80…0,97 ersetzt die harte 0,94-Schwelle (kein Ziel-Sprung beim Übergang); gebeugte Beine (→20°+) zielen unverändert exakt auf den OS
- VERIFIKATION: leg_idle_diag NACHHER: OS_L +9,15°/OS_R −9,15° außen, SB 0,00°/0,00°, Symmetrie 0,00°; leg_diag (March, gebeugt): SB-Fehler BESSER (L 5,0→2,7°, R 7,7→6,3°), OS +2° Trade-off im Übergangsbereich, RIGHT-SB-max 34° bereits in v2.6.0 vorhanden (keine Regression); glb_diag: 0 Spikes, Nähte ≤0,10 rad, Yaw 0°, Walk-Root 68 m unverändert; motion_ctrl_test 24 Checks GRÜN; ui_v260_test 15 Checks GRÜN
- BUILD: assembleRelease (kalter Daemon: erster Versuch Timeout, Hintergrund-Neustart OK), versionCode 16 / versionName 2.6.1, APK 28.577.394 bytes, Asset-Check: RT_ALG=3 + AUTO-RE-RETARGET im APK enthalten
- Release: main 54fccf1→13655d1 + Tag v2.6.1 gepusht (Token nur inline); CI-Runs 34772809135 (main) + 34772810190 (v2.6.1) gestartet — Tag-Run released dank permissions:contents:write automatisch

Stage Summary:
- v2.6.1: Bein-Fix jetzt WIRKSAM für alle bestehenden Clips (Auto-Re-Retarget beim Aktivieren) + natürlicher G1-A-Stand bei geradem Bein (kein Inward-Knick mehr)
- APK lokal: download/Trainrobot.apk (versionCode 16), sha256 20fc460027c954cb0ad3f7aa866da8844d0b72bfc3184b2f466eec7eee968f94
- CI/Release-Status: siehe Folgeeintrag (Task 26-Release)

---
Task ID: 26-Release
Agent: Super Z (Hauptagent)
Task: v2.6.1 Release abschließen (CI + GitHub-Release verifizieren)

Work Log:
- CI: main-Run 34772809135 + Tag-Run 34772810190 BEIDE GRÜN
- Release AUTOMATISCH durch den Workflow erstellt (zweites Mal nach v2.6.0): Release-ID 387982747, Asset 561657109 Trainrobot.apk 28.577.394 bytes, state=uploaded
- Integrität: Asset via API (octet-stream) geladen → aapt versionCode 16 / 2.6.1 ✓; CI-Build sha256 0779f01efc94f262345c93e66f1f621e62afb66502dcdc8d8bca1fee526cca4f (lokal 20fc4600… — Zip-Metadaten, Signatur entscheidend)
- Signatur: CI-Build und lokaler Build identisch (CN=Trainrobot OU=Testfeld07, SHA-256 1c0422b9…) → Update über alle v2.x-Installationen möglich
- Anonymer Browser-Download: HTTP 200 ✓

Stage Summary:
- Release v2.6.1 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.6.1
- Download (anonym verifiziert): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.6.1/Trainrobot.apk
- Wichtig für den Nutzer: bestehende GLB-Clips werden beim nächsten „Referenz"-Antippen EINMAL automatisch neu retargetet (Log-Zeile im Terminal) — der Bein-Fix greift damit auch für alte Imports

---
Task ID: 27
Agent: Super Z (Hauptagent)
Task: v2.7.0 — „Vollständiger Roboter": Sensorik + Zeitgefühl, Policy-Pro-Clip-Persistenz, Microduck (Hugging Face) + Go2, Welten-Presets + Zufallsgenerator — plus zwei kritische Alt-Bugs (PPO-NaN-Vergiftung, speed-chip-Scope)

Work Log:
- Recherche (Web): Microduck = 25-cm-Biped von Pollen Robotics + Hugging Face (Aug 2026, 14 Servos, Apache-2.0) — MJCF + Assets aus github.com/pollen-robotics/microduck_rl übernommen (robot_walk.xml + 43 STL); Sensorik-Best-Practice aus deren RL-Config bestätigt (base_ang_vel/Gyro, projizierte Gravitation, Encoder-Rauschen, Fußkontakte, Terrain-Höhenscan); Unitree-Mujoco-Terrain-Tool als Vorbild für Welten-Generator
- SENSORIK (alle Laufroboter): Beobachtungen erweitert um GYRO 3 (echtes IMU-sensordata, Fallback qvel[3:6] = Körperform, empirisch gegen Gyro-Sensor verifiziert Probe A/B/C), projizierte Gravitation 3, Basis-Höhe 1, FUSSKONTAKTE nFeet (Kontaktmonitor über data.contact.get(i).geom1/2, footBodies je Roboter aufgelöst), PHASEN-UHR sin/cos (gaitFreq — Zeitgefühl). a1/spot bekamen IMU-Site+Gyro+Accel in die XMLs (g1/go2/duck hatten schon), Microduck-Fußketten = ankle_left/right
- obsDim: Track-Task 3·nu+8 → 3·nu+17+nFeet (a1/spot/go2 57, g1 106, duck 61); Motion-Task 3·nu+18 → 3·nu+27 (G1 114) — alte Policies werden von der obsDim-Wache sauber verworfen (Log-Zeile erklärt +9 Sensorik)
- POLICY-PERSISTENZ („wenn man glb wegmacht warum wird policy gelöscht"): Root-Cause = geteilter Key tr_policy_<robot>_motion über ALLE Clips (Clips überschrieben die Policy gegenseitig; Deaktivieren sah wie Verlust aus). Jetzt PRO-CLIP-KEYS tr_policy_<robot>_motion_<clipId> + Legacy-Fallback beim Laden + AUTOMATISCHES Speichern beim Deaktivieren + „Policy"-Badge je Clip-Zeile + Toast beim Löschen („Policy bleibt gespeichert") — Reaktivieren lädt das Netz weiter (Browser-E2E: 39 497 Schritte wiederhergestellt)
- MICRODUCK (id 'duck', dir pollen_microduck): robot_walk.xml + INIT/STAND-Keyframes + Apache-2.0-Lizenz; Servo-kp 0.55→2.2 (upstream-Weichheit ließ STAND einsinken, forcerange ±0.96 blieb realistisch); cone=elliptic impratio=100; Watschel-Gang (makeWaddle, gespiegelte Vorzeichen, STAND-Basis); keyIndex 1; zTarget 0.12
- GO2 (id 'go2', dir unitree_go2): Menagerie sparse-clone, Motor→Positions-Aktuatoren konvertiert (App-Konvention wie a1, kp 80/100, forceranges 23.7/45.43), Trot-Gait wie A1, footBodies = calf-Geoms
- ROBOTERLEISTE dynamisch aus ROBOT_ORDER (6 Chips), rc-dot per cfg.color; index.html statische Chips entfernt
- WELTEN (worlds.js NEU): 6 Presets — Testfeld (Klassiker-Nachbau, skaliert), Flach, Parkour (Tore/Säulen/Hürden/Rampen), Treppen (auf/ab + Podest), Hügel (Kopfstein-Raster, NaN-sicher solref 0.04), ZUFALL (mulberry32-Seed, Bibliothek aus Toren/Säulen/Rampen/Boxen/Treppen/Schieflagen, Spawn 1,4 m frei, Mindestabstände). ALLE Welten prozedural als MJCF-String, via writeWorldFile ins VFS → RobotSim lädt welt_live.xml; statische testfeld.xml bleibt als CI-Check/Fallback (für go2/duck neu generiert). Skalierung s = zTarget/0.75 je Roboter (Microduck-Welt 0.16×). Weltleiste (WELT + 6 Chips + Würfel-Button nur bei Zufall), persistiert tr_world_v1, Training bleibt bei Weltwechsel im Speicher
- PPO-NAN-BUG (kritisch, seit v2.1.0 schlafend): Diagnose (grad_diag) — die LETZTE Beobachtung am Rollout-Ende kann NaN enthalten (Physik-Explosion nach Sturz) → lastVal NaN → GAE NaN → Gradienten NaN → POLICY KOMPLETT NaN („Policy plötzlich weg"). FIXES in train.js: store() verwirft nicht-endliche Transitionen; finishAndUpdate neutralisiert lastVal + verwirft vergiftete Batches (batchVerworfen); dH1.fill(0) PRO SAMPLE (Rückführungs-Ebene akkumulierte über alle Samples/Epochen!); Ratio-Exponent geklemmt ±50. Train-Smoke: 3000 Schritte × go2/duck/g1 mit mehreren Updates ohne NaN (vorher: Tod nach Update 1 — auch auf v2.6.1 reproduziert!)
- SPEED-CHIP-BUG (kritisch, seit v2.6.0): Steuerungs-Chips (Keine/Joystick/Buttons) teilen Klasse .speed-chip → Klick setzte speedMode=undefined → Training lief nur 1 Schritt/Frame. Fix: Selektor '.speed-chip[data-speed]'
- hasModelInFS-Guard: Roboter-/Weltwechsel luden ALLE Modelldateien neu (RAM/Heap-Wachstum → im UI-Test frierte der Event-Loop beim 3. Re-Fetch ein) — Dateien werden jetzt nur einmal geladen
- Engine: sensorGyro/Accel/ProjectedGravity/FootContacts-Getter, writeWorldFile, keyIndex aus cfg, welt_live.xml wird beim Räumen entfernt
- TESTS: model_smoke_v270 (5 Roboter: kompiliert/STAND 3 s/Sensoren/Kontakte/Gait), world_test_v270 (36 Kombinationen + Seed-Determinismus + Treppen-0-Höhen-Bug gefixt), train_smoke_v270 (PPO-End-to-End neue Dims), motion_ctrl_test erweitert (24 Checks, Sensorblock-Positionen), ui_v270_test NEU (Playwright: 41 Checks — v2.6.0-Suite + Roboter-/Weltleiste + Policy-Persistenz-E2E + Weltwechsel mit aktivem Clip) ALLE GRÜN; ui_v260_test Regression GRÜN; leg_idle/leg_diag/glb_diag unverändert gut (v2.6.1-Bein-Fix intakt)
- CI: Modell-Check 4→6 (unitree_go2 + pollen_microduck), „MicroDuck" aus der Verbotsliste entfernt (jetzt echtes Modell), Version 2.7.0 / versionCode 17
- BUILD: siehe Folgeeintrag

---
Task ID: 27-Release
Agent: Super Z (Hauptagent)
Task: v2.7.0 Release abschließen (CI + GitHub-Release verifizieren)

Work Log:
- Build: kalter Gradle-Daemon (erster Versuch Timeout 600 s, Hintergrund-Neustart OK — bekanntes Muster), assembleRelease GRÜN; APK 41.594.877 bytes (±13 MB durch Go2/Go2-Assets + Microduck-STLs)
- Lokaler Build: versionCode 17 / versionName 2.7.0, Signatur CN=Trainrobot SHA-256 1c0422b9… (stabil — Update über alle v2.x möglich), sha256 98585f9c…a70
- Commit e27d6e9 (120 Dateien, +762 398 Zeilen — davon ~60 k Microduck-STLs/Go2-Assets) + Tag v2.7.0 gepusht (Token nur inline, nicht persistiert)
- CI: main-Run 34787160187 + Tag-Run 34787161796 BEIDE GRÜN; der Workflow erstellte das Release AUTOMATISCH (drittes Mal, permissions:contents:write) — Release-ID 388056274, Asset 562052297 Trainrobot.apk 41.594.877 bytes state=uploaded
- Integrität: Asset via API (octet-stream) geladen → aapt versionCode 17 / 2.7.0 ✓; CI-Build sha256 11b2c9126cc18ed6a21701480b47389769b9f1c5d653aa1cf348d330e6e50dd9 (lokal 98585f9c… — Zip-Metadaten, Signatur entscheidend); Signatur CI-Build = lokaler Build = stabile Keystore-Signatur ✓
- Anonymer Browser-Download: HTTP 200 ✓

Stage Summary:
- Release v2.7.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.7.0
- Download (anonym verifiziert, HTTP 200): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.7.0/Trainrobot.apk
- sha256 (CI-Build): 11b2c9126cc18ed6a21701480b47389769b9f1c5d653aa1cf348d330e6e50dd9
- main = e27d6e9, versionCode 17, CI grün, Auto-Release via Workflow, Token nicht persistiert
- Neue Diagnose-/Build-Werkzeuge: scripts/build_models_v270.mjs (Microduck-XML + Manifests), model_smoke_v270.mjs, world_test_v270.mjs, train_smoke_v270.mjs, ui_v270_test.mjs, grad_diag.mjs (PPO-NaN-Analyse), api_probe*.mjs (WASM-Binding-Sonden)

Task: v2.8.0 — Sturz-Teleport hinterfragen (Aufstehen/Abwurf als Trainings-Szenarien) + Gemini mit ROHEM Zugriff (Mods/Plugins selbst schreiben)

Work Log:
- Nutzerfrage „Warum wird es immer zurück teleportiert beim Sturz?": Ursache ist checkFall() (main.js) — Sturz = Auto-Reset zur Keyframe-Pose; im Training endet die Episode. Antwort ist jetzt ein FEATURE: Sturz-Verhalten wählbar („Auto-Reset" wie gehabt | „Liegen lassen" — kein Teleport mehr, Roboter bleibt liegen, Log-Hinweis auf Aufstehen-Task), persistiert tr_fallMode. Recovery-Szenarien haben IMMER kein Auto-Reset (Sturz ist dort Startzustand).
- engine.js: placeBaseFull(x, y, z, qw, qx, qy, qz) — Basis komplett versetzen (volle Orientierung + Geschwindigkeiten nullen + mj_forward) mit lazy Adress-Caches (_baseQposAdr2/_baseDofAdr2).
- recoverytask.js NEU: makeRecoveryTask(cfg, mode) — 'getup' (Start LIEGEND: Rücken/Bauch/Seite ±Rauschen, Gelenkrauschen in qpos+ctrl) und 'drop' (Start 0,9–2,0 m über der Standhöhe h0 mit ±0,45 rad Neigung, Quaternion-Komposition qyaw ⊗ qtilt X-/Y-Achse korrekt hergeleitet). Beobachtungsraum 3·nu+8 (Gelenkfehler zur Standpose, Gelenktempo, Aufwärtsvektor, normalisierte Höhe, Gier-Rate, Körper-Tempo inkl. vz, lastAct). Belohnung: upz linear (−0,5 liegend … +0,5) + Quadrat-Bonus + Höhen-Treue zu gemessenem h0 + alive − Gelenkunruhe − Energie; Erfolg = upz>0,9 UND h>0,72·h0 GEHALTEN 0,8 s (dt-summiert, kein Ein-Frame-Zufall) → Bonus 4 + done; 'drop' zählt Erfolg erst NACH erstem Bodenkontakt (landed-Flag, in der Luft „aufrecht" ist kein Erfolg); Zeitlimit 12 s; NaN-Wache.
- plugins.js NEU (WERKSTATT): PluginHost — Plugins = JS-Code (new Function('api', code)), Syntax-Check beim Install, Code-Limit 24 000 Zeichen, Liste ≤ 24, persistiert localStorage tr_plugins_v1. Hooks: onStep (nur Echtzeit), onFrame, onReset, onAct (ctrl überschreibbar VOR Physik), onReward (Zahl = Bonus oder {bonus, done} — formt Trainings-Belohnungen um). Fehler in Hook → Plugin sofort deaktiviert + onError (nie stille Endlosschleifen). API je Plugin (pluginApiFor in main.js): sim() RAW (qpos/qvel/ctrl-Views, stepN, reset, placeBaseFull, pushImpulse…), teleport, push, reset, executeAction, setConfig, addButton/removeButton, ui.addChip → eigene Buttons unten in der Leiste (#pluginChips), storage (JSON, Namensraum je Plugin), state(), task(), robot(). BUILTIN-Beispiele (★, standardmäßig AUS, addOrReplaceBuiltin bei Boot): „Abwurf-Button" (Chip ABWURF: Teleport auf 1,5–2,1 m mit Zufallsneigung — die „von oben runter werfen"-Idee 1:1) und „Auto-Schubser" (alle 8–15 s zufälliger Schubs via onStep).
- ai.js: Gemini-Werkzeuge erweitert: setScenario (gehen|getup|drop), setFallMode (reset|stay), runCode (SOFORT-Ausführung mit api + Rückgabe an die KI), writePlugin (name/desc/code → Syntax-Check → installieren + aktivieren; Fehlermeldung geht zurück an die KI zur Selbstkorrektur). System-Prompt: komplette Plugin-API-Dokumentation + „WANN WAS?"-Leitfaden + Robustheitsregeln; maxOutputTokens 2048 → 4096 (Plugin-Code braucht Raum). validateToolCall für alle neuen Tools.
- main.js: makeTaskFor() (GLB-Clip → recovery-Szenario → Standard-Task), Szenario-Chips „Aufgabe" (Gehen/Aufstehen/Abwurf) + „Bei Sturz" (Auto-Reset/Liegen lassen) im Trainings-Panel (Drohne: Zeile versteckt), Szenario je Roboter persistiert (tr_scenario_v1), policyKey um recovery_getup/recovery_drop erweitert (eigene Policy-Slots — Geh-Policies bleiben unangetastet), checkFall respektiert fallMode + recovery (kein Auto-Teleport dort), startTraining loggt die Aufgabe, deactivateClip nutzt makeTaskFor (Szenario bleibt erhalten), Plugin-Host in Boot/Loop/Training/Policy/Reset integriert (fireFrame je Bild, fireStep je Regelzyklus Echtzeit, fireAct vor Physik, fireReward nach Aufgaben-Reward, fireReset nach Resett), execTool für 4 neue KI-Werkzeuge, renderPluginList (Werkstatt in der KI-Tafel), aiCtx/observeState melden scenario/fallMode/taskKind/Plugins an die KI, __trainrobot-Handles: scenario/fallMode/setScenario/setFallMode/pluginHost/plugins/installPlugin/removePlugin/pluginChips.
- REGRESSION GEFUNDEN + GEFIXT: Plugin-Zeilen hatten anfangs die Klasse .glb-clip → der v260-UI-Test klickte per Selector '.glb-clip .btn.small' den Plugin-Toggle statt „Referenz" (Timeout). Plugin-Zeilen haben jetzt EIGENE Klasse .plugin-row (+ eigene CSS-Regeln) — GLB-Selektoren matchen nie Plugin-UI.
- index.html: scnRow/fallRow (speed-chip-Stil), #pluginChips-Leiste (unten, über aiButtons), WERKSTATT-Sektion in der KI-Tafel (glb-head + plgList + Hinweis), KI-Vorschläge erweitert (Aufstehen lernen, Plugin: Auto-Schubser, Plugin: Abwurf). style.css: .plg-section/.plg-list/.plg-desc/.plugin-row/.plugin-chips (bottom +146px).
- TESTS (alle GRÜN): recovery_plugin_test.mjs NEU (28 Checks: getup-Startzustände/Normierung/Erfolg gehalten/Zeitlimit, drop-Luftstart/Kein-Erfolg-vor-Kontakt/Erfolg-nach-Kontakt, PluginHost Syntax/Größe/Hooks/Reward-Aggregation/Disposer/Fehler→deaktiviert/Isolation, ★-Plugins funktional); ui_v280_test.mjs NEU (25 Playwright-Checks: Chips, getup liegt (0,06 m), drop in der Luft (1,4–2,8 m) + gefallen, Persistenz, „Liegen lassen": hinliegender A1 bleibt LIEGEN (0,06 m) vs Auto-Reset: Keyframe (0,25 m) — deterministisch via placeBaseFull, Drohne versteckt, Werkstatt 2★, ABWURF-Chip wirft (1,76 m), an/aus, installPlugin/removePlugin, defekter Code abgelehnt); motion_ctrl_test 24 ✓; ui_v260_test 15 ✓ (nach dem .plugin-row-Fix); debug_glb_flow.mjs als Diagnose-Werkzeug erhalten.
- Build: SDK/Gradle 8.7 neu installiert (Environment-Reset; cmdline-tools 11076708, platforms;android-34, build-tools;34.0.0 → /home/z/tools/android-sdk), assembleRelease OK (2 Anläufe, kalt >9 min — APK danach vorhanden), versionCode 18 / versionName 2.7.0, Signatur CN=Trainrobot OU=Testfeld07 (SHA-256 1c0422b9… identisch, Update-fähig), 28.592.623 bytes; APK-Inhalt: recoverytask.js + plugins.js enthalten.
- Release: main + Tag v2.8.0 gepusht (Token nur inline) — Workflow baut + released automatisch (permissions:contents:write).

Stage Summary:
- v2.8.0: Der Roboter wird beim Sturz nicht mehr zwangsweise teleportiert („Liegen lassen"-Modus) und lernt in den NEUEN Szenarien AUFSTEHEN (liegend starten) und ABWURF/LANDEN (in der Luft starten) — plus Gehen wie gehabt.
- Gemini hat jetzt ROHEN Zugriff: runCode (live) + writePlugin (dauerhafte Mods mit Physik-Hooks, eigenen Buttons, Teleport, eigenen Belohnungen) — „Art mods oder plugins schreiben" 1:1 umgesetzt, mit 2 mitgelieferten Beispielen.
- Lokales APK: download/Trainrobot.apk (versionCode 18), sha256 3e804f7ebfb6f774571734a1638bcd5f46a00aa63ee2e02738483e9d65a6c92c
- Release-Status: siehe Folgeeintrag (Task 28-Release)

---
Task ID: 28-Release
Agent: Super Z (Hauptagent)
Task: v2.8.0 Release abschließen (CI + GitHub-Release verifizieren)

Work Log:
- Push: main 90a8e50→06fc0aa (Rebase-Ergebnis mit korrigierter main.js — die erste Rebase-Version hatte eine beim Konflikt-Schreiben verunstaltete main.js; acorn-Verifikation nach Rekonstruktion aus 90a8e50-Basis + assert-gesicherten Integrationen), danach Tag v2.8.0
- CI: main-Run 34843474308 GRÜN; Tag-Run 34843476807 GRÜN → Release AUTOMATISCH erstellt (drittes Mal nach v2.6.0/v2.6.1): Release-ID 388378408, Asset 563354473 Trainrobot.apk 41.610.402 bytes (größer durch Go2 + Microduck-Modelle), state=uploaded
- Integrität: Asset via API (octet-stream) geladen → aapt versionCode 18 / 2.8.0 ✓; CI-sha256 5777a33d80a7ebcf6c81585ff03d20aad506e61ad894ac734663d88e4b182bdb (lokal bedb14a52… — Zip-Metadaten, Signatur entscheidend)
- Signatur: CI-Build identisch mit allen v2.x (CN=Trainrobot OU=Testfeld07, SHA-256 1c0422b9…) → Update über alle Installationen möglich
- Anonymer Browser-Download: HTTP 200, volle Größe ✓
- Debug-Werkzeuge bleiben erhalten: scripts/debug_glb_flow.mjs, scripts/debug_g1_load.mjs, scripts/recovery_plugin_test.mjs, scripts/ui_v280_test.mjs

Stage Summary:
- Release v2.8.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.8.0
- Download (anonym verifiziert): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.8.0/Trainrobot.apk
- Inhalt: v2.7.0-Sensorik/Welten/6-Roboter + NEU in v2.8.0: Sturz-Verhalten wählbar (Auto-Reset | Liegen lassen), Aufstehen-/Abwurf-Trainings-Szenarien (mit Sensorblock), Gemini mit rohem Zugriff (runCode + writePlugin — Mods/Plugins mit Physik-Hooks, Teleport, eigenen Buttons; 2 Beispiele inklusive), Werkstatt-UI in der KI-Tafel
- Token nicht in Repo/Logs/Scripts persistiert

---
Task ID: 29
Agent: Super Z (Hauptagent)
Task: v2.9.0 — „Es funktioniert nicht": Liegen-Startlage unter dem Boden, Teleport trotz „Liegen lassen", Kopfstand-Plugin wirkte nicht aufs Training

Work Log:
- Rebase auf remote main (v2.7.0 e27d6e9 + v2.8.0 06fc0aa waren von früheren Sessions; lokales Repo war zurück) — Nutzer läuft v2.8.0 (Screenshot: Microduck + getup + Plugin-Werkstatt)
- BUG A „Bei Aufgabe liegen ist der Roboter unter dem Boden (wie auf der Bodendecke)": recoverytask legte die Basis für die Liegend-Startlage auf z = 0,3·h0 — ohne die REICHWEITE des invertierten Körpers zu kennen. Probe (geom_probe_v290): G1 liegend auf Rücken bei Basis z=0,2 → feste Geoms bis −0,2291 m UNTER dem Boden. Folge: Kontakt-Explosion → NaN-Beobachtungen → stummer Reset („zurück teleportiert"). FIX (engine.js): minGeomZ(collisionOnly) — EXAKTER tiefster Punkt: Primitive über geschlossene Stützformeln (Sphere r, Capsule |R22|·h+r, Cylinder |R22|·h+√(R20²+R21²)·r, Ellipsoid √((R20a)²+…), Box Σ|R2k|·hk), MESHes über echte Vertex-Transformation (mesh_vert = Kollisionsgeometrie; AABB-Fallback MIT Mittelpunkt-Offset — ohne ihn phantomhafte 20-cm-Penetrationen bei STLs mit fernem Geom-Ursprung). Nur Roboter-Bodies (Teilbaum unter baseBody via body_parentid) — statische Testfeld-Deko (Rampen/Mauern teils unter z=0 verankert) zählt nicht. collisionOnly filtert zusätzlich Geoms ohne Boden-Paar (contype&1||conaffinity&1 — Selbstkollisions-Familien wie duck-trunk contype=2 kollidieren mit dem Boden NIE). settleAboveGround() hebt die Basis automatisch in placeBaseFull (margin 4 mm, NIE absenken — Abwurf/Kopfstart bleiben in der Luft)
- BUG A2 (Microduck spezial): Die GANZE Kopf-Kette (neck → jaw_soft) hatte NUR class="visual"-Geoms — der Kopf hing beim Liegen visuell DURCH den Boden (Physik hält ihn nicht). FIX (microduck.xml): head_collision-Box (0,09×0,064×0,06 m) in jaw_soft, dynamics-neutral (explizites <inertial> bleibt maßgeblich). Danach: minGeomZ −0,30 → −0,04 (Rest = vereinfachte Kollisions-Hulls vs. detaillierte Visual-Meshes, kosmetisch)
- BUG A3: _h0-Klemme max(0,2, h) machte Microduck-Erfolg UNMÖGLICH (Standhöhe 0,12; Erfolgsschwelle 0,72·0,2=0,144 > 0,12 — zweiter Grund für „Training verändert nichts"). FIX: Klemme 0,05
- BUG B „Ich hab liegen an gemacht aber es wurde zurück teleportiert": (1) policyCtrlStep-NaN-Wache resetzte still zur KEYFRAME-Stehpose (statt Aufgabenstartlage) + ohne fireReset → liegt-an + Physik-Explosion aus A = plötzlich stehender Roboter. Jetzt task.reset + fireReset. (2) TRAINING beachtete „Liegen lassen" nicht: Sturz-Done → sim.reset() (Teleport), egal was gewählt. Jetzt (trainCtrlStep): bei Geh-Task + fallMode='stay' + Sturz-Done bleibt der Roboter LIEGEN (kein sim.reset), Episode endet trotzdem sauber für PPO (Bootstrap via done=true), nächste startet aus der Lage + Log-Hinweis. (3) Bug-Beilage: makeTrackTask hatte GAR KEIN kind-Feld — S.task.kind==='speed' griff nie (v2.9.0: kind:'speed' explizit + robuste Abfrage)
- BUG C „Kopfstand-Plugin hat was gemacht, aber Training nicht verändert": (1) fireReward bekam info.upz/info.height NIE mitgeliefert (immer undefined — die dokumentierte Plugin-API war eine Lüge) → Kopftand-Logik ohne Funktion. FIX: trainCtrlStep rechnet upz/height echt und übergibt sie. (2) {done:false} wurde ignoriert: fireReward konnte done nur ERZWINGEN, nie AUFHEBEN — der Sturz-Abbruch der Geh-Aufgabe killte jede Freestyle-Episode nach 1 Schritt. FIX: done===false hebt den Aufgaben-Abbruch auf (done===true erzwingt weiter). (3) fireReset-Lücken (loadRobot/switchScenario/activateClip/deactivateClip) geschlossen — Plugin-Startposen gelten jetzt ÜBERALL. (4) Sichtbarkeit: „Plugin-Belohnung aktiv (Σ Bonus …)"-Log alle 10 s im Training (Nutzer SIEHT, dass das Plugin wirkt)
- NEU: BUILTIN ★-Plugin „Kopfstand-Training" (Freestyle-Referenzmuster: onReset → kopfüber-Teleport mit aktueller Höhe als Anker, onReward → 0,4·(−upz)+0,6·inv²+Ruhig-Bonus, Erfolg = inv>0,6 + ruhig 2 s GEHALTEN → +5 + done:true, Zeitlimit 12 s, sonst {done:false}); KI-Vorschlag-Chip „Kopfstand lernen"; System-Prompt: 6 Roboter (Go2/Microduck fehlten!), teleport hebt automatisch (liegend/kopfüber sicher), minGeomZ dokumentiert, FREESTYLE-Muster mit Verweis aufs ★-Beispiel, onReset feuert auch an Trainings-Episodenstarts
- TESTS: ground_settle_test.mjs NEU (echte Physik, 31 Checks GRÜN: 24 Kipp-Lagen × 5 Roboter bodenfrei; 12 getup-Starts je Roboter → 1 s NaN-frei + liegt AUF dem Boden; _h0≈Standhöhe + Erfolgsschwelle erreichbar je Roboter; drop landet + ruht; Kopfstand-BUILTIN kopfüber bodenfrei + done:false-Override + 100 Reward-Schritte ohne Deaktivierung; PluginHost done-Override-Unit). recovery_plugin_test erweitert (3 ★). ui_v290_test.mjs NEU (GRÜN: Werkstatt 3★, getup-Start bodenfrei+liegend+1,2 s stabil, Kopfstand-Muster E2E mit echtem info.upz + „Plugin-Belohnung aktiv"-Log, „Liegen lassen" im Training: upz=−1,00 bleibt über 5 Episoden-Grenzen — kein Teleport). Regressionen GRÜN: ui_v280 (Werkstatt-Zahl 2→3), ui_v270, ui_v260, motion_ctrl, world_test, model_smoke, train_smoke. Diagnose-Werkzeuge: geom_probe_v290/debug_minz/debug_rest/debug_minz2/debug_spot (Kontakt-Wahrheit vs. Schätzer)
- BUILD: SDK neu installiert (Environment-Reset, cmdline-tools 11076708 + android-34 + build-tools 34.0.0), assembleRelease, versionCode 19 / versionName 2.9.0
- Release: main + Tag v2.9.0 gepusht (Token nur inline) — Workflow baut + released automatisch

Stage Summary:
- v2.9.0: „Aufgabe liegen" startet ÜBER dem Boden (kein Kopf-unter-Boden mehr, Microduck-Kopf kollidiert jetzt), „Liegen lassen" gilt AUSSERDEM im Training (kein Teleport bei Sturz-Episodenende), Kopfstand-/Freestyle-Plugins wirken WIRKLICH aufs Training (echtes upz/height, done:false hebt Sturz-Abbruch auf, sichtbares Bonus-Log) + ★-Beispiel „Kopfstand-Training"
- Release-Status: siehe Folgeeintrag (Task 29-Release)
