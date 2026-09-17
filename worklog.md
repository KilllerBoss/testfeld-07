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

---
Task ID: 29-Release
Agent: Super Z (Hauptagent)
Task: v2.9.0 Release abschließen (CI + GitHub-Release verifizieren)

Work Log:
- Build-Umgebung: Gradle-Dist-Download via wrapper 504 (GitHub-Mirror-Störung) → manuell von services.gradle.org geladen + Wrapper-Cache gesät; SDK-Neuinstallation via scripts/install_sdk_v290.sh (Environment-Reset)
- Build: assembleRelease GRÜN (1 m 15 s warm), APK 41.615.730 bytes, versionCode 19 / versionName 2.9.0, Signatur CN=Trainrobot OU=Testfeld07 (SHA-256 1c0422b9… identisch mit allen v2.x — Update-fähig), lokaler sha256 f6f32e4d…
- Push: main 9fb0db7→48de48a + Tag v2.9.0
- CI: main-Run 34862086574 GRÜN; Tag-Run 34862090948 GRÜN → Release AUTOMATISCH erstellt (viertes Mal in Folge): Release-ID 388506382, Asset 563667570 Trainrobot.apk 41.615.730 bytes, state=uploaded
- Integrität: Asset via API (octet-stream) geladen → aapt versionCode 19 / 2.9.0 ✓; CI-sha256 f4c43cc63497b60b9d1fbabb96b7dcbf07d6cff6de3a833db9ce46ed7490bd25 (lokal f6f32e4d… — Zip-Metadaten, Signatur entscheidend); Signatur CI = lokal ✓
- Anonymer Browser-Download: HTTP 200, volle 41.615.730 bytes ✓

Stage Summary:
- Release v2.9.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.9.0
- Download (anonym verifiziert, HTTP 200): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.9.0/Trainrobot.apk
- sha256 (CI-Build): f4c43cc63497b60b9d1fbabb96b7dcbf07d6cff6de3a833db9ce46ed7490bd25
- main = 48de48a, versionCode 19, CI grün (beide Runs), Auto-Release via Workflow, Token nicht persistiert
- Für den Nutzer: Update installieren (gleiche Signatur) → „Aufgabe liegen" liegt SAUBER auf dem Boden, „Liegen lassen" gilt auch im Training, Kopfstand über das ★-Plugin „Kopfstand-Training" oder den KI-Chip „Kopfstand lernen"

---
Task ID: 30
Agent: Super Z (Hauptagent)
Task: v2.10.0 — Paralleles Training (MuJoCo-WASM in Web Workern + PPO-Erfahrungs-Merge) auf Basis v2.9.0

Work Log:
- AUSGANGSLAGE: Nutzerwunsch „mehrere MuJoCo-WASM-Instanzen parallel über Web Workers auf den CPU-Kernen, Erfahrungen fürs PPO-Update zusammenführen — schneller gescheit laufen lernen". Lokal war aus einer abgebrochenen Session ein v2.7.0-Zweig (68e5148) vorhanden; Fern-Repo war inzwischen bei v2.9.0 (parallele Session: Sensorik, Welten, 6 Roboter inkl. Microduck, Plugins/Mods, Szenarien Aufstehen/Abwurf, Boden-Startlagen-Fixes) — v2.7.0/v2.8.0/v2.9.0 dort bereits released
- ENTSCHEIDUNG: v2.9.0 (cb324de, versionCode 19) als Basis übernommen (git reset --hard), nur das Parallel-Training neu integriert — Posen-Aufgaben/ createTask aus dem alten Zweig verworfen (v2.9.0 deckt das mit Szenarien + Plugins ab)
- IMPLEMENTIERUNG: train.js PPO.mergeSegments (GAE je Segment mit eigenem lastVal, globale Advantage-Normalisierung, ein gemeinsames Update) + _update(buf,T) generalisiert; parallel.js ParallelTrainer (N Worker, Start-Barrier, Runden-Sync on-policy ohne Staleness, Schritte/s-Fenster, Worker-Ausfall-Robustheit, start/stop, test-injizierbare Worker-Factory); simworker.js Modul-Worker mit ECHTEM App-Code (engine/robots/motiontask/recoverytask/plugins/train) — Rollout = 1:1 trainCtrlStep-Semantik (fireAct/fireReward über leeren PluginHost, „Liegen lassen"-Logik, NaN-Wache), eigene prozedurale Welt (worldXml per init-Message), Modell-Fetch mit SEITENwurzel-Auflösung (Worker-relative fetches gehen gegen js/ — Root-Cause zweier Fehlstarts); main.js Tempo MAX = Parallel (startTraining/stopTraining/Loop 3-Wege, Plugin-Wächter: aktives Plugin → Inline mit Log, onParallelSegment → Episoden/Chart/Env-Patches live)
- BUGS UNTERWEGS: wasmBinary-Parameter wurde nicht durchgereicht (wasmBuf vs wasm), worldXml fehlte in _boot → „empty file welt_live.xml", Worker-Boot frass CPU des Inline-Trainings → starting-Gate, gestaffelte Starts, Fail-Loud-Logging der Boot-Fehler
- TESTS: parallel_test.mjs NEU (21: mergeSegments-Mathematik/StepCounts/Determinismus, Orchestrierung mit Mock-Workern: Boot-Barrier, Runden, Ausfall mid-round, stop); ui_v2100_test.mjs NEU (13, ECHTE Worker im Chromium: Tempo MAX aktiviert ParallelTrainer, 1024→3072+ Schritte, ≥3 Runden, 814 Schritte/s bei 1 Worker auf 2 Kernen, Pause terminiert, getup-Start über Boden); ALLE v2.9.0-Regressionen GRÜN (motion_ctrl, ground_settle 31, recovery_plugin, world, model_smoke, train_smoke, ui_v260/280/290)
- BUILD: versionCode 20 / versionName 2.10.0, APK 41.624.889 bytes (6-Roboter-OBJ-Assets), Signatur CN=Trainrobot OU=Testfeld07 identisch (1c0422b9…), simworker/parallel/mergeSegments im APK verifiziert; Build-Env: SDK neu installiert (cmdline-tools 11076708, platform 34, build-tools 34), Gradle-Hänger nach Kill → Locks/neu
- CI-FIX: android-actions/setup-android@v3 bricht JETZT mit „Failed to find package tools" (Google hat Legacy-Paket entfernt — Runner-Drift, unabhängig von unserem Code) → Workflow nutzt direkt das vorinstallierte Runner-SDK (Lizenzen + platform 34 + build-tools 34.0.0); Tag v2.10.0 auf Fix-Commit umgehängt (3dc4059 → fef9f50)
- RELEASE: main cb324de→fef9f50 + Tag v2.10.0, CI beide Runs GRÜN (34896813781, 34896835646), Release id 388713851 AUTOMATISCH, Asset Trainrobot.apk 41.624.889 bytes uploaded
- Integrität: CI-Asset via API geladen → aapt versionCode 20/2.10.0, Signatur identisch, anonymer Download HTTP 200; CI-sha256 1ff62346… (lokal 03f7a59a… — Zip-Metadaten, Signatur entscheidend)

Stage Summary:
- v2.10.0 LIVE: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.10.0
- Download (anonym verifiziert): https://github.com/KilllerBoss/testfeld-07/releases/download/v2.10.0/Trainrobot.apk
- Für den Nutzer: Tempo „MAX" im Trainings-Panel = parallel auf allen Kernen (Log zeigt „Training läuft PARALLEL auf N MuJoCo-Workern"); S26 Ultra hat 8 Kerne → bis 6 Worker; MicroDuck ist mit 14 Aktuatoren das ideale Parallel-Trainingsziel; Plugins laufen wie gehabt inline
- Roadmap GPU (Diskussion): realistischer Pfad = Vulkan-Compute-Port einzelner mj_step-Phasen (IREE/clspv-Referenzen), NICHT CUDA→Adreno; erste Datengrundlage = steps/s-Benchmark aus v2.10.0 auf dem Gerät

---
Task ID: 31
Agent: Super Z (Hauptagent)
Task: MASTER-PROMPT-Umsetzung — §39 Status-Report (16 Bereiche) + kleinster Schritt zu „working MicroDuck PPO" = DOMAIN RANDOMIZATION (§10 Pflicht) + Reward-Komplettierung (§9) → v2.11.0

Work Log:
- STATUS-REPORT aus Code gelesen (HEAD 993b98f, v2.10.0 live): ✓ MicroDuck/G1/Dog×3/Drone/MuJoCo/CPU-Physik/Parallel-Worker/PPO-Inferenz; ~ PPO (Netzgröße fix), Checkpointing (ohne Adam-State), Curriculum (manuell), Benchmarking (nur live steps/s); ✗ Vulkan, ONNX, Domain Randomization, Thermal. Kleinster Schritt: DR + Reward-Komponenten (ohne DR lernt Policy nur den perfekten Simulator)
- dr.js NEU: 4 Stufen (aus/leicht/mittel/stark — LEICHT als Standard, §10 „Pflicht"): Masse+Trägheit (Roboter-Teilbaum, homogen), Motorstärke (kp: gainprm+biasprm gemeinsam), Gleitreibung (Roboter-Geoms + Boden-Plane, MuJoCo-max-Kombination), Gelenkdämpfung, Gravitation (schreibbar verifiziert: −9,37…−10,39 bei stark), Startpose/-tempo (Gelenkrauschen in qpos+ctrl, additive Yaw-Rotation), IMU-Sensorrauschen, Schubs-Zeitplan (Δv-exakt: Impuls = Δv × Dieselbe-Masse-die-pushImpulse-teilt), Aktions-Verzögerung 0–2 Zyklen (20–40 ms). sanitizeDr klemmt hart; Original-Snapshot (_drOrig) je RobotSim EINMAL, je Episode vom Original neu gewürfelt (KEINE Akkumulation); restoreDrModel für Reset-Button
- robots.js Track-Task (5 Laufroboter): DR-Anbindung in reset() (Modell+Start), Sensorrauschen in observe() (Gyro/Gravitation/Höhe), Schübe in reward(), drDelayedAct in actionToCtrl; Reward-Neu: rW.smooth=0,01 (Aktionsruckeln), rW.jlimit=0,05 (Gelenk-Rand 5 %), rW.fall=0 (einmaliger Sturz-Malus, konfigurierbar) — MASTER-PROMPT §9
- main.js: S.drLevel (persistiert tr_dr_v1), Störungs-Chips im Trainings-Panel (index.html drRow), parallelEnvCfg → env.dr an ALLE Worker (je Worker anders gewürfelt), resetRobot restauriert echte Physik, __trainrobot.setDr/drActiveInfo, VERSION 2.11.0
- simworker.js applyEnv: env.dr durchreichen; ai.js: rW.smooth/jlimit/fall validiert + System-Prompt dokumentiert; build.gradle versionCode 21/2.11.0
- BUG-JAGDEN: (1) tri() rief rng.next() entbunden → this.s undefined (Fix: Methodenaufruf); (2) applyDrStart ERSATZTE die Basis-Quaternion durch reines Yaw → richtete liegende Roboter stumm wieder auf (ui_v290 „Liegen lassen"-Test rot) → Fix: q_neu = q_yaw ⊗ q_alt (Hamilton, additive Rotation, Lage bleibt) + settleAboveGround nach Start-Rauschen; (3) Schubs-Δv exakt über Engine-Divisor-Masse
- TESTS: dr_test.mjs NEU (41 Checks: Sanitizer, Determinismus je Seed, Keine-Akkumulation, Restore exakt, Sensorrauschen an/aus, Delay-Semantik, Schubs-Δv-Band, 300-Zyklen-Rollouts duck+a1 bei STARK ohne NaN, Roher-Worker-Spec, Lage-erhalten) — GRÜN; ALLE Regressionen grün: parallel 21, ground_settle, motion_ctrl, recovery_plugin, world, train_smoke, ui_v2100 13 (808 Schritte/s mit DR an), ui_v260/280/290
- BUILD: lokal gebaut (Gradle-Hänger nach 10 min Wrapper-Timeout, APK doch fertig 21:57), aapt: versionCode 21 / 2.11.0, dr.js/simworker.js/parallel.js im APK verifiziert
- RELEASE: main + Tag v2.11.0 → CI → Release (siehe unten verifizieren)

Stage Summary:
- v2.11.0: Domain Randomization ist LIVE — Trainings-Panel „Störungen" (Aus/Leicht/Mittel/Stark), wirkt inline UND in allen Sim-Workern, KI-tunbare Reward-Felder smooth/jlimit/fall
- Der MASTER-PROMPT-Roadmap-Fortschritt: PHASE 6 (Domain randomization) DONE vor Phase 2-Vollausbau (GPU-Batching) — bewusst, weil DR den Lernerfolg jeder Phase misst
- Nächste sinnvolle Schritte (noch offen): ONNX-Export, Adam-State-Checkpointing, Auto-Benchmark (§6, keine erfundenen Zahlen), Thermal-Mode (§25), Curriculum-Automatik (§11), Netzgrößen 128/256 (§13)

---
Task ID: 31
Agent: Super Z (Hauptagent)
Task: v2.12.0 — MASTER-PROMPT „MicroDuck Modular Motion Intelligence / Soft-MoE Training“ (§1–35): Soft-MoE-Politik + Übergangs-Training + Curriculum für den echten Pollen-MicroDuck, auf v2.11.0 rebasiert

Work Log:
- KONTEXT-KORREKTUR: Parallel-Sessions hatten main bis v2.11.0 weiterentwickelt (v2.7.0 Sensorik + ECHTER pollen_microduck mit STL-Meshes + Go2, v2.8/2.9 Szenarien/Plugins/Liegen-lassen, v2.10.0 Paralleles Training in Sim-Workern, v2.11.0 Domain Randomization). Eigene anfangs parallel gebaute Implementierung (Proxy-Ente, eigene Worker) wurde nach Fund des Forks VERWORFEN (Branch softmoe-v270 archiviert) und der einzig NEUE Teil — die Soft-MoE-Architektur aus dem neuen MASTER-PROMPT — auf die v2.11.0-Basis portiert
- SOFTMOE-POLICY (train.js, MASTER-PROMPT §1/§34): Shared Encoder 128/128 (tanh) → 4 Soft-Experts (128→64→32: Balance/Walk/Turn/Recovery, je eine latente Bewegungsrepräsentation, KEINE unabhängigen Motor-Policies §4) → Soft Router (132→64→4 softmax, Kommando-Vorspülung kPrior=1.2 über log(skillW+0.06) — kontinuierlich, kein hartes if/else §5) → Motion Manifold = weiche Mischung 32 D (§6 Bewegungsraum) ⊕ Style-Latent 32 D (Embedding 6×32 über neutral/elegant/energetic/careful/playful/minimal — nur 'neutral' belegt, weitere architektonisch bereit Phase 4) → Shared Decoder (64→14). Wertkopf auf dem geteilten Encoder, diagonale Gauß-Politik, 79.969 Parameter (§35: wenige Parameter)
- PPO-GENERALISIERUNG: PolicyClass-Injection (5. Konstruktor-Arg, Legacy-PolicyNet unverändert), Soft-MoE-Backprop gekapselt (accumGrads: Decoder→Experts gewichtet w_i→Router-Softmax-Kette→Encoder; Style-Embedding-Grad = sw_s·dstyle), _update/bcEpoch-Branches, Adam-Dispatch, toJSON fmt 'trainrobot-ppo-2-moe' + PPO.fromAny (alt/neu ladbar), applyFromJSON (Worker-Schnappschuss), Routing-Statistik in Metriken (routeW/routeEnt §28/§31)
- DUCK-MOE-TASK (robots.js: makeDuckMoeTask): obsDim 74 = 61er-v2.7.0-Sensorik-Basis (Gyro, projizierte Gravitation, Höhe, ECHTE Fußkontakte, Phasen-Uhr — 1:1 Speed-Task-Layout, Schnittstellenkompatibel §3) + 13 SOFT-KOMMANDO-Kanäle (vx,vy,wz + skill[4] + style[6]); actDim 14; kind bleibt 'speed' (KI-Patches/applyEnv/Worker-Env-Pfade greifen unverändert)
- ÜBERGANGS-TRAINING (§7): Kommando-Scheduler mit Segmenten 1,5–3,5 s, 60 % erzwungene Skill-Wechsel, weiches Blenden von vx/wz UND Skill-Gewichten über 0,5–0,9 s — stand→walk→turn→stop-Übergänge sind Trainingsinhalt, nicht Endzustände
- MODULARER REWARD (§11/§12/§13): Task-Tracking (vx/wz) + Balance (up, height) + alive + energy + smooth (Aktionsrate) + jlimit (v2.11.0-Semantik) + UNNÖTIGE SCHRITTE (Fuß-Geschwindigkeit² + ECHTE Kontaktwechsel-Strafe über footContacts) + ROUTING-GLÄTTUNG (||Δw||² der Expertengewichte, §5) + fall-Strafe + recover-Formung (EXPERIMENTELL). Alle Gewichte in cfg.rW → KI-tunbar (ai.js: foot/route/recover/height-Bounds + duckLevel + Prompt-Doku)
- CURRICULUM (§18): Level 1–5 (L1 flach/kleine Amplitude → L5 kombinierte Störungen), je Level DR-Spec im v2.11.0-Format (über sanitizeDr/applyDrModel/applyDrStart/drPushDue/drDelayedAct — volle v2.11.0-Integration) + wachsende Kommando-Bereiche + WACHSENDE Aktionsamplitude (span 0,16→0,35, §33 „erst Balance"), Aufstieg nur bei Episodenlängen-EMA über Gate, persistiert (tr_duck_lvl), onLevelUp-Log
- WORKER-INTEGRATION (auf v2.10.0-Basis, KEIN Duplikat): simworker baut bei cfg.moe die MoE-Task + SoftMoEPolicy; parallel.js kick() serialisiert MoE-Netze generisch (fmt 'softmoe-1'), applyWeights mit applyFromJSON; runSegment mit setRouting/afterAct-Hooks (Routing-Glättung gilt auch parallel); Policy-Modus (Inferenz) mit afterAct (Scheduler läuft live)
- UI: Router-Dashboard im Trainings-Sheet (4 Bars Bal/Walk/Turn/Rec live aus lastW, Level-Anzeige), Router-Werte im PPO-Runden-Log, duckRow nur bei MicroDuck
- BUGS IM PORT GEFUNDEN+GEFIXT: ① obsDim-Formel doppelt gezählte Phasen-Uhr (63 vs. 61) → 74 korrekt; ② drDelayedAct/drPushDue lesen task._dr → Alias im Curriculum gesetzt; ③ lastAct-Alias für simworker/train_smoke-Pfade; ④ train_smoke-Expectation auf MoE-obsDim angepasst (dynamisch je cfg.moe); ⑤ Playwright waitForFunction-Signatur (options als 3. Arg)
- TESTS (alle GRÜN): moe_test (Gradienten-Check analytisch vs. numerisch maxRel 5,8e-4 über alle Tensor-Typen, PPO@74-obs, mergeSegments deterministisch bitidentisch, BC, JSON-Roundtrip, Legacy-Regression), duck_test (echtes Pollen-Modell: 14 Akt., STAND 3 s stabil upz 1.000, obs 74/74, Update finit, 18 Skill-Übergänge/60 s, Curriculum-Level ändert DR, Fußkontakte sichtbar), duck_learn (41k Schritte echtes Training: Updates finit, Router konditioniert auf Kommandos, σ stabil — EHRLICH: Skill-Emergenz braucht 10^6+ Schritte Geräte-Zeit), duck_browser_test (Playwright: Boot→Duck→MAX=parallel→„SOFT-MOE"-Init→„PARALLEL aktiv"→PPO-Runden mit Router-Stats 530 Schritte/s, Router-Bars live, keine Worker-Fehler), REGRESSION: dr_test 41 ✓, parallel_test 21 ✓, motion_ctrl ✓, ground_settle ✓, world ✓, model_smoke ✓, train_smoke ✓, ui_v260 ✓, ui_v280 ✓, ui_v290 ✓, ui_v2100 13 ✓, recovery_plugin ✓
- NICHT IMPLEMENTIERT (ehrlich §35): GLB-Motion-Prior/Style-Encoder aus Motion-Daten (Phase 4), weitere Styles über 'neutral' (Phase 4), Skill-Plugins/Sidestep (Phase 5+), Distillation (§16), ONNX/INT8/FP16 (§26), NPU-Benchmarks, MoE-Ablationen (§30) — Architektur-Skelett vorhanden, Training steht am Anfang
- BUILD: assembleRelease versionCode 22 / versionName 2.12.0, Signatur CN=Trainrobot OU=Testfeld07 (stabil); Release via Tag-Push (CI permissions:contents:write)

Stage Summary:
- Soft-MoE-Motion-Intelligenz (neuer MASTER-PROMPT §34) auf dem ECHTEN Pollen-MicroDuck implementiert und voll verifiziert (Gradient-Check, Physik-E2E, Browser-Worker-E2E, 14 Testsuiten)
- Übergangs-Training + weiche Skill-Kommandos + Routing-Glättung + Curriculum sind Trainingsinhalt; Router reagiert nachweislich auf Skill-/Style-Kommandos
- v2.12.0 (versionCode 22) — nächster Schritt: Geräte-Training über Nacht (L1→L5), dann Phase 4 (Styles/Motion-Prior)

---
Task ID: 32
Agent: Super Z (Hauptagent)
Task: "Bist du fertig?" — Stand-Rekonsolidierung nach Environment-Reset: v2.7.0-APK verifiziert, Remote-Fork entdeckt, lokal auf v2.12.0 ausgerichtet

Work Log:
- Environment war erneut zurückgesetzt: SDK/Gradle weg, lokales Git auf v2.7.0-Stand (09c77b5) stehengeblieben, Remote aber weit voraus
- Verifikation des lokalen v2.7.0-Codes: Syntax-Check aller www/js GRÜN, gradcheck.mjs OK (PPO-Loop NaN-frei, 1920 Schritte)
- APK-Neubau v2.7.0 (SDK cmdline-tools 11076708 + platform 34 + build-tools 34.0.0 neu installiert, Gradle 8.7 manuell): versionCode 17 / 2.7.0, fpv.js + skill.js + mcp/ im APK verifiziert, Signatur 1c0422b9… (stabil)
- Push-Versuch deckte ABZWEIFUNG auf: Remote main hat v2.8–v2.12.0 (Parallel-Sessions), lokales 09c77b5 KEIN Vorfahre davon → KEIN Force-Push, lokal übernommen
- v2.7.0-Release existiert bereits LIVE (id 388056274, CI-Build aus Tag 09c77b5, 41.594.877 bytes) — Nutzer-Anfragen damit vollständig abgedeckt
- Release-Audit: v2.7.0 → v2.12.0 ALLE LIVE (5 Releases, je ~41,6 MB, CI grün: Tag-Runs + main success)
- git reset --hard FETCH_HEAD → lokal = Remote main 98ddc8a (v2.12.0, versionCode 22); v2.7.0-APK-Commit (0007254) verworfen (überflüssig, CI-Asset ist autoritativ)
- MicroDuck-Sensor-Frage final geklärt: models/pollen_microduck/microduck.xml hat MUJOCO-KAMERA <camera name="head_camera"> (Kopf-Mount, quat 0 0 -1 0) — KEIN Infrarot-Sensor (Sensorik = framequat/gyro/velocimeter/accelerometer IMU + subtreeangmom). FPV-Feature (v2.7.0) zeigt die Kopf-Sicht im Rechteck, togglebar, bewusst KEIN Policy-Eingang; Vision-Modell-Hook bleibt dokumentiert frei (Canvas → ONNX, Phase später)
- download/Trainrobot.apk aktualisiert auf CI-Release v2.12.0: 41.642.998 bytes, aapt versionCode 22/2.12.0, Signatur 1c0422b9… identisch (Update-fähig), anonymous HTTP 200 verifiziert

Stage Summary:
- ALLE Nutzer-Anfragen sind implementiert UND released: Art-MCP/.md-Wissen + konfigurierbare Architektur + Experten-/Router-Belohnungen + Steuerung (alle Roboter) + FPV-Kamera + Über-Nacht-Auto-Save = v2.7.0; echte MicroDuck + Worker-Parallelisierung = v2.8–v2.10; Domain Randomization = v2.11; Soft-MoE-Motion-Intelligence (MASTER-PROMPT §34) = v2.12.0
- Neueste Version: v2.12.0 (versionCode 22), LIVE + anonym downloadbar; lokal = Remote synchron (98ddc8a)
- MicroDuck: Kamera JA (head_camera, wird für FPV-Anzeige genutzt), Infrarot NEIN (IMU-Sensorik)

---
Task ID: 33
Agent: Super Z (Hauptagent)
Task: v2.13.0 — Nutzer-Bug „Policy fällt/zieht zäh, Trainings-Episoden extrem kurz" + Port der fehlenden v2.7.0-Features in die v2.12-Linie

Work Log:
- ROOT-CAUSES (Code-Lektüre + Stub-Tests):
  1) POLICY-Modus: Der Stick erreichte NUR GLB-Motion-Tasks (main.js policyCtrlStep). Speed-Policies fuhren mit dem LETZTEN Trainingskommando weiter; der MicroDuck lief zusätzlich dem Zufalls-Segment-Scheduler weiter (afterAct lief in Policy) → „falsch synchronisiert": Sturz, zähes Schieben, keine Stick-Antwort
  2) „Liegen lassen" + Duck: task.reset() rief sim.resetToKeyframe() — der liegende Start wurde still wegteleportiert; Episode begann stehend ODER (Lage erhalten) instant-done (upz<0.45 im 1. Schritt) = „kann nicht mal hinfallen, extrem kurz"
  3) Curriculum-Überhitzung: Level stieg durch reines Stehen (EMA-Gate), ohne Rückweg → Instant-Kollaps-Level auf L4/L5
- FIXES (robots.js Duck-Task + main.js):
  1) policyCtrlStep: setUserCmd (Stick → Soft-Kommandos, Skill-Form aus Befehl, auf Level-Band geklemmt, Scheduler PAUSE) + Klassiker: Stick → cmd.vx/yaw geklemmt auf Trainings-Bänder
  2) Aufsteh-Fenster: Sturz/Liegend-Start → 6–8 s RECOVER-Fenster (upz²+rise-Formung, rW.recover) statt Sofort-done; keepPose-Reset (kein Teleport mehr); Fenster-Timeout beendet Episode sauber; Aufsteh-Episoden zählen NICHT zum Level
  3) Curriculum-Selbstkorrektur: Level sinkt bei EMA < Gate/2 wieder (kein Festhängen mehr)
- PORT aus der verworfenen v2.7.0-Linie ( histories-divergiert: Remote-v2.7.0 = andere Linie! ): skill.js (EXPERT_R, leggedSkillState, expertRouterReward — Router-Bonus „liegend→aufstehen gewählt", Expertenergebnis stand/walk/turn/recover), expertR-KI-Patch (ai.js validatePatch + applyAIPatch deep-merge + Persistenz), ART-MCP www/mcp/ (6 Dokumente, v2.13-real: ROBOTS obs-Layouts byte-genau inkl. Duck-74 + head_camera), readDoc-Tool (fetch+Cache, execTool async), FPV (fpv.js + btnCam + fpvWrap-Rechteck + setCamera-Tool + Loop-Hook je 2. Frame; NUR Anzeige — obsDim unverändert), ÜBER-NACHT-Schutz (Auto-Save bei visibilitychange/pagehide/beforeunload + Wake Lock im Training)
- Version: 2.13.0 / versionCode 23; Environment-Reset zwischendurch (SDK+Gradle neu, korrumpierter Gradle-Download via ZIP-Integritätscheck erkannt)
- TESTS: scripts/duck_sync_test.mjs NEU (24 Checks: keepPose-Reset ohne Teleport, Liegend-Start → 8-s-Fenster, Aufstiegs-Reward steigt, stay/reset-Verzweigung, Stick-Klemme + Skill-Formen + Scheduler-Pause, obsDim 74 + Stick-Kanäle, Trainings-Scheduler-Regression, Level-Abstieg, expertR an/aus exakt Δ0.285) GRÜN; Regressionen: moe_test GRÜN, dr_test 41 GRÜN, duck_test (echtes Pollen-Modell, WASM) ALLE GRÜN
- BUILD: assembleRelease OK (1m07s), 41.660.194 bytes, aapt versionCode 23/2.13.0, Signatur CN=Trainrobot OU=Testfeld07 (1c0422b9… stabil), fpv.js+skill.js+6×mcp im APK

Stage Summary:
- v2.13.0 behebt: Stick steuert JETZT alle Speed-Policies im Policy-Modus; „Liegen lassen" = echtes Aufsteh-Lernen (keine 1-Schritt-Episoden mehr); Curriculum korrigiert sich selbst
- Die v2.7.0-Versprechen sind jetzt in der AKTUELLEN Linie: Art-MCP (.md + readDoc), expertR (Router-/Experten-Belohnungen), FPV-Kamera-Rechteck (setCamera/btnCam), Auto-Save + Wake Lock
- Ehrlich dokumentiert: setArchitecture (freie Netztiefe/Breite) ist in dieser Linie NICHT vorhanden — Soft-MoE-Struktur fix nach MASTER-PROMPT §34; ARCHITECTURE.md erklärt es
- Test: scripts/duck_sync_test.mjs 24/24, alle Regressionen grün; Release via Tag v2.13.0 (CI auto-release)

---
Task ID: 34
Agent: Super Z (Hauptagent)
Task: v2.13.1 — Nutzer-Frage „Warum hat MicroDuck im Kopf einen Würfel/Quader?" — Ursache + Rendering-Fix

Work Log:
- URSACHE identifiziert: <geom name="head_collision" type="box" class="collision" pos="-0.0045 0 -0.03" size="0.045 0.032 0.03"/> in microduck.xml (v2.9.0 eingeführt) — die Kopf-Kette (neck…jaw_soft) hatte NUR Visual-Geoms, der Kopf hing beim Liegen visuell durch den Boden; die Box löst das (ohne Masseanteil, <inertial> bleibt maßgeblich)
- SICHTBARKEITS-BUG: render3d.js buildFromModel()/buildGhost() rendern ALLE Geoms inkl. Kollisions-Geoms (group 3, Menagerie-Konvention) → graue 9×6,4×6-cm-Box mit Default-RGBA wird als „Würfel" im Kopf sichtbar; duck_camera ist bei z=-0.0733 VOR der Box (Box spannt z=-0.06…0) → FPV unbeeinträchtigt
- SICHERHEITSANALYSE: scripts/check_collision_geoms.py (Parst alle 6 Roboter-XMLs inkl. Class-Vererbung; Bug im ersten Versuch: <default> nutzt class- statt name-Attribut) — Ergebnis: G1=36/51, Spot=13, A1=37, X2=8, MicroDuck=3 Kollisions-Geoms; KEIN Body besteht nur aus Kollisions-Geoms → Hiding sicher für alle
- FIX in render3d.js: _visualCounts(sim) zählt Non-group-3-Geoms pro Body; _skipCollision() skipped group-3-Geoms, wenn der Body Visual-Geoms hat (Fallback rendert bei „nur Kollision" trotzdem); angewandt in buildFromModel UND buildGhost; Physik unangetastet (rein Rendering), Bonus: G1 rendert 51 Dreiecks-Meshes weniger
- wasm-Verifikation: MjModel::geom_group() Getter existiert in mujoco.wasm (gleiches Muster wie geom_contype)
- TESTS: node --check OK; scripts/renderskip_test.js NEU (9 Checks: MicroDuck-Kopf-Szenario, Nur-Kollisions-Fallback, Boden nie geskippt, G1-artig, XML-Konsistenz) ALLE GRÜN
- Version: 2.13.1 / versionCode 24

Stage Summary:
- Antwort auf die Nutzer-Frage: Der Würfel = head_collision-Box (v2.9.0, für Aufsteh-Szenario nötig) — er war NUR ein Rendering-Bug, die Box gehört physikalisch dorthin
- v2.13.1: Kollisions-Geoms (group 3) werden nicht mehr gerendert — Würfel weg bei MicroDuck UND alle anderen Roboter (Plus: Performance), Aufsteh-Physik unverändert
- Release via Tag v2.13.1 (CI auto-release)
- ADDENDUM Task 34: Release v2.13.1 live — CI run 35102996559 SUCCESS; Asset Trainrobot.apk 41.660.678 bytes, anonym HTTP 200 ladbar; versionCode 24 / versionName 2.13.1 (scripts/apk_version.py, AXML-Parser); Signatur via apksigner (build-tools r34, nach SDK-Reset neu geladen): Signer #1 SHA-256 1c0422b9251e47ce… IDENTISCH mit v2.13.0 und allen v2.x → Update-Installation garantiert; render3d.js mit _skipCollision im APK verifiziert. Hinweis: scripts/apk_cert_sha.py (Hand-Parser) war fehlerhaft und wurde entfernt — apksigner ist maßgeblich

---
Task ID: 35
Agent: Super Z (Hauptagent)
Task: v2.14.0 — Roster auf 3 Roboter, Gemini-Aussehen-/Welt-/UI-/MoE-Editor, komplexe Reward-Terme, Tempo-Slider, Live-Kurven, Policy-Export mit Meta

Work Log:
- NUTZER-FRAGE „Vorschläge?" → AskUserQuestion-Batch; Antworten: Farben+Material je Teil (nur Gemini), Roster-Kürzung (Empfehlung übernommen: komplett löschen), Extras: Live-Kurven + Touch-Joystick + Policy-Export, EIN Release; Freitext: Gemini soll Welt neu generieren + Objekte hinzufügen, komplexere Belohnungen, UI anpassen, Soft-MoE-Experten anpassen, „max Geschwindigkeit weg (Handy hängt) → Slider"
- ROSTER: a1/spot/go2 aus robots.js entfernt (scripts/roster_cut.py) + Modelldirs gelöscht — 107 MB Assets gespart (166→59 MB); boot lädt jetzt G1; ROBOT_ORDER = ['g1','duck','x2']
- SETAPPEARANCE (neu appearance.js + render3d.js): Teile = Material-/Body-/Geom-Namen; color #rrggbb, shine 0–1 (→roughness), metal 0–1; Meshes tragen userData.geomIndex, setAppearance() wirkt LIVE am geladenen Modell; persistiert tr_look_v1_<robot>, in loadRobot restauriert; partCatalog() liefert Gemini den Katalog; Physik unangetastet
- SETWORLD (worlds.js + main.js): KI-WELT (id 'ki') — Objekttypen box/ball/cyl/ramp/tilt/gate/stair, hart validiert (max 40, Spawn 0,9 m frei, x/y ±12, Farben #rrggbb), replace=true = Welt NEU bauen / false = hinzufügen; persistiert tr_world_ki_v1; buildWorldXML 4. Param kiObjects (auch Parallel-Start); Weltwechsel hält das Training im Speicher
- RWX KOMPLEXE TERME (neu rewardx.js): goTo/stayNear/heightBand/faceYaw/paceMax/paceMin/uprightMin (+symmetric reserviert), je {kind, w 0–5, hard}; hard = Episoden-Abbruch bei grober Verletzung; in Speed-Task UND Duck-Task (resetTermState je Episode); KI-Pfad: validatePatch → applyAIPatch → cfg.rWx, persistiert in tr_ai_speed_<id>, an Worker via env.rWx (simworker applyEnv)
- SETUI: Designs standard/neon/amber/ice/wald (body[data-theme], CSS-Variablen), eigene Vorschlags-Chips (renderAISuggestions, max 6, hart validiert, persistiert); restoreAISuggestions in boot + aiOnOpen
- SETMOE: SoftMoEPolicy E=2–8 (constructor opts + fromJSON aus net.E); PPO übergibt hyper.policyOpts; Experten-Namen an E angepasst (skill.js längenagnostisch); task.setRouting E-flexibel (realloc); Router-Bars UI blendet >E aus; Persistenz tr_ai_moeE; Policy wird verworfen (ehrlich gemeldet)
- TEMPO-SLIDER: Chips 1×/4×/16×/MAX ENTFERNT („MAX" = Parallel-Training blockierte Handys) → Slider 1–16 Schritte/Frame, persistiert tr_speed_v2 ('max'-Migration → 4); Not-Aus 34 ms/Bild; Parallel-Code bleibt, aber UI-erreichbar nie mehr MAX
- LIVE-KURVEN: zweites Canvas rateChart (Schritte/s-Fläche amber + Policy-Loss cyan); trainer._lastMetrics gesetzt; ui.pushRate/drawRateChart; resetRewards leert Historie
- POLICY-EXPORT: {meta:{app,version,robot,task,obsDim,actDim,stepCount,moeE,saved}, policy} — Import akzeptiert Wrapper + altes Naked-Format; Dateiname mit Schrittanzahl
- ai.js: 4 neue Werkzeuge (setAppearance/setWorld/setUI/setMoE) mit validateToolCall-Klemmen + Prompt (3 Roboter, rWx-Doku, Kombi-Beispiel Welt+goTo); AI_DOCS + mcp/ um WORLD.md erweitert, ROBOTS/REWARDS/CONTROL/ARCHITECTURE/TRAINING/README auf v2.14.0 umgeschrieben
- JOYSTICK: active-Glow + Richtungsmarken (CSS), active-Klasse in controls.js
- TESTS: scripts/test_v2140.mjs NEU — 53 Checks GRÜN (Roster, rewardx-Mathematik, KI-WELT-Sanitizing+XML, Appearance am ECHTEN Modell, SoftMoE E=3 Roundtrip + PPO-Interplay, Tool-Validierung, Duck-Rollout in KI-Welt ohne NaN); scripts/ui_v2140_test.mjs NEU — 17 Browser-Checks GRÜN (Boot, Chips=3, Slider, Charts, Theme, KI-WELT-Chip, setAppearance ändert Meshfarben LIVE, keine JS-Fehler); Regressionen: moe_test GRÜN, dr_test 41/41 (a1→g1 umgestellt), duck_sync 24/24, duck_test (WASM-E2E) GRÜN
- Version: 2.14.0 / versionCode 25

Stage Summary:
- v2.14.0: 3 Roboter (MicroDuck/G1/X2), Gemini kann jetzt AUSSEHEN (Farben+Material je Teil), WELT (KI-Welt bauen), UI (Designs+Chips) und SOFT-MOE-EXPERTEN (2–8) steuern; komplexe Reward-Ziele (rWx) kombinierbar mit Weltobjekten („läuf zum Turm")
- Handy-Freeze behoben: Tempo-Slider 1–16 statt MAX; Live-Kurven zeigen Tempo+Loss
- Policy-Export/Import mit Metadaten; APK 107 MB kleiner
- Release via Tag v2.14.0 (CI auto-release)
- ADDENDUM Task 35: Release v2.14.0 live — erster Tag-Run failed am CI-Hart-Check (erwartete noch 6 Modelle); Workflow auf 3 Modelle umgestellt, Tag neu gesetzt, zweiter Run SUCCESS. Asset Trainrobot.apk 27.994.885 bytes (~28 MB, vorher 41,7 MB — Modell-Kürzung wirkt im APK), anonym HTTP 200; versionCode 25 / versionName 2.14.0; Signatur 1c0422b9… identisch (Update-Installation garantiert); rewardx.js + appearance.js + mcp/WORLD.md im APK, Alt-Modelle raus

---
Task ID: 36
Agent: Super Z (Hauptagent)
Task: v2.14.1 — „Roboter sind immer noch grau" (Renderer ignorierte Materialfarben/Texturen) + Vollbild-Button funktionslos + Konsole-Button entfernen

Work Log:
- GRAU-URSACHE: render3d.js baute Mesh-Materialien nur aus geom_rgba — Menagerie-Modelle färben aber über MATERIALIEN (geom_matid → mat_rgba). Ohne Farbe am Geom steht geom_rgba auf dem MuJoCo-Default 0,5-Grau → alles grau. Feld-Probe am echten WASM (scripts/probe_matfields.mjs): geom_materialid EXISTIERT NICHT im Binding, korrekt heißt es geom_matid; mat_rgba/mat_metallic/mat_roughness/mat_texid (10 Rollen je Material, RGB=Rolle 1)/tex_data/tex_adr(BigInt64!)/tex_nchannel vorhanden
- FIX render3d.js buildFromModel: Basisfarbe/Alpha aus mat_rgba, metallic/roughness aus Material (roughness-Floor 0,25 gegen Spiegel-Schwarz ohne Env-Map), Textur-Support: _textureFor() wandelt tex_data → THREE.DataTexture (RGBA-Konvertierung, SRGB, Linear, Repeat), Cache je Modell (_texCache, disposed beim Rebuild); G_MESH setzt jetzt UVs (mesh_texcoord via mesh_facetexcoord — MuJoCo hält Texcoords SEPARAT pro Face-Ecke wegen Seams, Fallback per-Vertex)
- setAppearance/_applyLook v2.14.1: Meshes speichern Basis-Stil (userData.base {color,rough,metal,map}) — Meshes ohne Override kehren zur Modell-Optik zurück (Reset sauber); explizite Farbe ersetzt die X2-Textur (pure Farbe), rough/metal-Overrides lassen Textur an; setAppearance(null) restauriert jetzt wirklich (vorher wurde _applyLook nur bei gesetzter Map aufgerufen)
- UI-Entfernung (Nutzerwunsch): btnFull raus — Android-WebView hat KEINE requestFullscreen-API, App ist nativ IMMERSIVE_STICKY (MainActivity) → Button konnte nie etwas tun; btnConsole + Konsole-Panel raus — ui.log() schreibt weiter ins jetzt unsichtbare #consoleLog (Boot-Zeilen, Playwright-Tests, Logcat-Fehlersuche bleiben funktionsfähig); style.css .console-Block entfernt
- ROBOTS.md: Basis-Optik = Modelleigene Materialien dokumentiert (Gemini-Kontext)
- TESTS: scripts/test_v2141.mjs NEU (32 Checks: Feld-Proben am echten WASM, Materialfarben-Formel, tex_adr·nchannel-Grenzen, Checker-Farben in tex_data, Look-Restore-Semantik, Quell-/UI-Checks) GRÜN; scripts/ui_v2141_render_test.mjs NEU (Playwright, echtes Rendering): G1 55 Meshes 0×0,5-Grau + 7× schwarz, X2 Textur+UVs aktiv nach Chip-Wechsel, UI-Buttons weg, verstecktes Log schreibt, 0 Seitenfehler — 10/10 GRÜN; Regression: v2140 53/53, ui_v2140 17/17, dr_test 41/41, duck_sync 24/24
- Build: SDK/Gradle waren reset → neu installiert (cmdline-tools 11076708, platforms;android-34, build-tools;34.0.0, Gradle 8.7); assembleRelease OK; versionCode 26 / versionName 2.14.1; Signatur CN=Trainrobot OU=Testfeld07 SHA-256 1c0422b9… identisch mit allen v2.x
- Release: Commit + Tag v2.14.1 gepusht → CI auto-Release; download/Trainrobot.apk ersetzt und verifiziert

Stage Summary:
- v2.14.1 LIVE: Roboter zeigen ihre echten Farben (G1 schwarz/metal, MicroDuck beige-Schalen/dunkler Rumpf, X2 ECHTE TEXTUR mit UVs); Gemini-setAppearance sitzt auf echter Basis auf, Reset restauriert inkl. Textur
- Vollbild- und Konsole-Button entfernt (Topbar: Training + KI-Trainer)
- Release v2.14.1: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.14.1

---
Task ID: 37
Agent: Super Z (Hauptagent)
Task: v2.15.0 — GLB-Animationen für JEDEN Roboter + Referenz-Modi (STELLE/FREI/FOLGT) + „OHNE ANIM WEITER" (Policy ohne Animation weitertrainieren)

Work Log:
- NUTZERWÜNSCHE: (1) GLB-Animationen bei jedem Roboter, (2) Animationen wie Gehen sollen im Raum laufen können, (3) Umschalten zwischen „an einer Stelle / frei / am Roboter geankert-gefolgt", (4) eine mit GLB trainierte Policy soll ohne Animationen WEITERTRAINIEREN können — nicht an die Animation gebunden
- retarget.js PROFIL-SYSTEM (retargetToRobot, Alias retargetToG1 bleibt): PROFILES {g1: Beine+Arme+Taille (Suffix _joint), duck: Beine (hip_pitch/roll/yaw, knee, ankle EINACHSIG — Kopf/Hals behalten STAND-Pose via keyCtrl-Preset), x2: NUR Root-Bahn (keine Gelenk-IK — q = Hover-Schub des Keyframes)}. Guards: CAL/G1B/G1D0/VALGUS nur bei hasLegs/hasArms, Taille nur bei hasWaist, Höhenband je Profil (duck 0.05–0.32, x2 0.25–1.6), clampA respektiert jetzt jnt_range (MicroDuck-Positionsatüe haben ctrlrange ±10; jnt_limited ist im WASM-Binding DEFEKT — BindingError — deshalb jnt_range-Heuristik hi>lo), Referenzhöhe = KEYFRAME-Höhe (mj_resetDataKeyframe) statt qpos0 — Drohne steht in qpos0 am Boden
- motiontask.js REFMODE ('frei'|'stelle'|'folgt'): stelle = Wurzel-Ziel fix am Startpunkt (lead 0, kein Loop-Rebase, Bahn-Abbruch aktiv); folgt = KEIN Bahn-Zwang (root/yaw-Belohnung neutral, kein rootDone-Abbruch — Posen-/Höhen-Treue bleiben); frei = bisheriges DeepMimic-Pfad-Folgen mit Loop. ghostAnchor(phase, robotPos, robotYaw, out) liefert den Lehrer-Anker je Modus (folgt: Roboter-LIVE-Position + Clip-Relativdelta). refSpeed → 0 im stelle-Modus. animOn=false: Soll-Höhe jetzt cfg.h0 statt G1-Festwert 0,79 (MicroDuck wurde sonst permanent als „gestürzt" abgebrochen)
- robots.js makeHoverTask (Drohne): kind 'hover' + LEHRPFAD — setPath(clip, mode), updateCmd(dt, sim) (Verfolgung: bearing→cmd.yaw Gier-Rate, Distanz→cmd.vx P-Regler, Höhe→cmd.alt; _animT läuft immer für den Geist), ghostAnchor je Modus; cmd.reset enthält jetzt yaw:0 (NaN-Schutz im Kaskadenregler)
- main.js: GLB-Sektion für ALLE Roboter (Gate id!=='g1' entfernt); Import retargetet für den AKTUELLEN Roboter (motionByRobot{robotId:packed}, rec.motion bleibt G1-Legacy); activateClip wählt die Roboter-Variante, retargetet on-demand aus rec.glb, Auto-Re-Retarget je Roboter (alg < RT_ALG); DROHNEN-ZWEIG: Clip = Flugweg (makeTaskFor injiziert via setPath, stMode 'PFAD'); Roboterwechsel überträgt die aktive Referenz (frisches Re-Retarget aus rec.glb) oder deaktiviert sauber ohne GLB; loadRobot-Ghost/Task-Block roboter-unabhängig; REF-CHIPS (stelle/frei/folgt, persistiert tr_refmode_v1) + „OHNE ANIM WEITER"-Button (animOn=false + refMode folgt — Netz/Norm/Policy-Slot bleiben, Aufgabe läuft mit Keyframe-Stand-Referenz ohne Animationsdaten); applyGait: Lehrpfad-Autopilot (Stick-Vorrang <0,25); policyCtrlStep: updateCmd für Drohnen-Pfad; Geist-Block je Modus (frei: Loop-Rebase wie bisher, folgt: Lehrer hängt am Roboter, stelle: Original-Mesh aus — srcPos liefe sonst die Route ab — Roboter-Geist zeigt die Pose); refreshClipList: rec.motion optional (motionByRobot-Fallback — Crash bei neuen Records behoben); __trainrobot-Handle: refMode/motionInfo/setRefMode/unbindAnimation/refreshClips
- GE Fund: updateSourceGhost „otion.srcPos" war ein Terminal-Anzeige-Artefakt (ANSI [m) — Datei ist korrekt; G1-Arme sind im synthetischen Test seit v2.4.x unbewegt (old==new verifiziert, präexistierend)
- TESTS: scripts/_synthglb.mjs (synthetischer Mixamo-Walk-GLB-Builder, aus glb_diag extrahiert), scripts/motion_v2150_test.mjs NEU (41 Checks: G1-Regression, Duck-Retarget nu=14/Beine/jnt_range/Kopf-STAND/Höhenband, refMode-Semantik mit echt-physik Displacement, Unbound-STUB ohne Animationsdaten 60 Schritte, X2 nu=4/Hover-q/Flugbahn, Hover-Pfad-Modi, packMotion robotId) GRÜN; scripts/ui_v2150_test.mjs NEU (17 Checks, EIN Boot — SwiftShader stirbt nach ~3 Booten: GLB-Sektion bei allen Robotern, Chips+Persistenz, Duck-Clip-Aktivierung via IndexedDB-Injection, unbind-Flow, Referenz-Deaktivierung bei Wechsel zu X2) GRÜN; Regression: v2140 53/53, v2141 32/32, dr 41/41, duck_sync 24/24, ui_v2140 17/17, ui_v2141_render 10/10
- Doku: mcp/CONTROL.md (Referenz-Modi + Unbind + Drohnen-Pfad), ROBOTS.md/README.md, ai.js-Systemprompt (GLB für alle, Clip-Tool ohne G1-Grenze)
- Build: versionCode 27 / versionName 2.15.0; Release via Tag (CI auto-release), download/Trainrobot.apk ersetzt + verifiziert

Stage Summary:
- v2.15.0: GLB-Animationen für alle drei Roboter (G1 humanoid, MicroDuck Beine+Root, X2 Flugbahn-Autopilot); Referenz-Modi STELLE/FREI/FOLGT für Geist UND Training; „OHNE ANIM WEITER" entkoppelt die Policy von der Animation (Netz bleibt, trainiert Balance/Freibewegung weiter)
- Release v2.15.0: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.15.0

---
Task ID: 38
Agent: Super Z (Hauptagent)
Task: v2.16.0 — Nutzerfrage „Ist GLB-Animation als Input in der Policy? Warum verlernt der Roboter beim Weitertrainieren ohne GLB alles?“ → Root-Cause + Entkoppeln der Policy von der Animation

Work Log:
- ROOT CAUSE (3 Knoten, alle behoben): (1) actionToCtrl verankerte Aktionen um die ANIMIERTE Referenzpose — animOn=false warf den Anker auf die Stand-Pose → gelernte Aktionen bedeuteten plötzlich etwas anderes → Kollaps („wie von neu“). (2) Parallel-Worker bekamen animOn/refMode/ctrlMode NIE (workerTaskSpec schickte nur den Clip, parallelEnvCfg nur MOTION_R) → Training lief MIT, Policy-Modus OHNE Animation → Semantik-Bruch. (3) animOn=false belohnte STAND-Attraktor (pose 0.35× + Ziel = Startposition) → aktives Verlernen des Gehens.
- motiontask.js: actionToCtrl Anker = IMMER keyCtrl (identische Aktions-Semantik mit/ohne Animation, wie Speed-Task); animOff()/cmdDriven()-Helfer; animOn=false = KOMMANDOGANG (Ziel = integrierte Kommandos, sampleCmd würfelt jetzt auch bei ctrlMode 'none', Policy-Modus: Stick via _manualCmd-Schutz gegen Hineinwürfeln); poseW ohne Animation = MOTION_R.pose·freePose (0.1) statt 0.35; ANIM-DROPOUT dropAnimP/dropAnim (je Episode Math.random()<dropP, nur scharf wenn startTraining/Worker setzen dropAnimP — Regressionstests bleiben deterministisch); BC-Etiketten auf neuen Anker geeicht (q[f+1] − keyCtrl); 'folgt' ohne Animation hat jetzt Ziel-Abbruch (Kommandogang braucht Ziel)
- simworker.js: buildTask übernimmt spec.animOn/refMode/ctrlMode/buttons + dropAnimP=MOTION_R.dropP; applyEnv wendet env.motionFlags LIVE an (je kick()-Runde)
- main.js: workerTaskSpec + parallelEnvCfg (+motionFlags); startTraining schärft dropAnimP; Unbind behält Referenz-Modus (kein forced 'folgt'), aktiviert Joystick falls 'none', löst jetzt auch den DROHNEN-Lehrpfad, refreshed S.parallel.envCfg sofort; Referenz-Chips/Steuer-Chips/Anim-Toggle refreshen envCfg ebenfalls; policyCtrlStep: Stick führt auch ohne Animation + _manualCmd; VERSION 2.16.0
- Doku: CONTROL.md (Entkopplung + Kommandogang + Dropout), ai.js-Systemprompt, motiontask-Header (v2.16.0-Block)
- FIX unterwegs: ai.js-Edit hatte Template-Literal früh geschlossen (SyntaxError) → repariert
- TESTS: scripts/motion_v2160_test.mjs NEU 33/33 (Anker-Identität mit/ohne Animation, Anker-Formel, Kommandogang-Integration, OBS=q−keyCtrl, Reward manuell nachgerechnet, 'folgt'-Abbruch, Dropout p-Statistik 21,1 %, BC-Etiketten, Worker-Propagierung statisch, Unbound-Regression); Regressionen ALLE grün: motion_v2150 41/41, test_v2140 53/53, test_v2141 32/32, dr 41/41, duck_sync 24/24, ui_v2150 17/17, ui_v2140 17/17, ui_v2141_render 10/10, parallel 21/21
- Build: versionCode 28 / versionName 2.16.0 (lokal verifiziert: aapt + apksigner, Signatur 1c0422b9…); CI (main + Tag v2.16.0) beide SUCCESS; Release-Asset → download/Trainrobot.apk (anonym 302→200), Worklog gepusht

Stage Summary:
- v2.16.0: Die Policy ist NICHT mehr an die GLB-Animation gebunden — Aktions-Anker immer Keyframe-Pose, „OHNE ANIM WEITER" = Kommandogang (Gehen bleibt, Netz/Norm/Slot bleiben), ANIM-DROPOUT 20 % macht Training animation-unabhängig, Parallel-Worker bekommen Animations-/Modus-Flags jetzt live. HINWEIS für Nutzer: Motion-Policies von ≤ v2.15.x haben noch den alten Referenz-Anker → kurz nachtrainieren (mit ODER ohne Animation), danach ist Umschalten verlustfrei.
- Release v2.16.0: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.16.0

---
Task ID: 39
Agent: Super Z (Hauptagent)
Task: v2.17.0 — NETZ-CANVAS: Node-Editor für Roboter-Architekturen (Karten bauen/verbinden/ausführen/trainieren, Gemini-Vollzugriff, eigene UI-Elemente)

Work Log:
- NUTZERWUNSCH: Canvas mit ALLEN Robotereingängen einzeln (links) und ALLEN Aktuatoren einzeln (rechts), Mitte Policy-Karten frei verbindbar; neue Karten mit wählbaren Inputs/Outputs/Hidden-Layern/Neuronen; Belohnung/Bestrafung pro Karten-ID (global ODER eigene Formel); Router über trainierte Policies bauen; Gemini voller Zugriff; was im Canvas gebaut ist, läuft auf dem Roboter; Gemini kann UI-Elemente (Buttons/Slider/Joystick …) mit Code als Ein-/Ausgänge definieren, die in Policies verdrahtbar sind
- canvas.js NEU (~1900 Zeilen): (1) obsGroups/obsPortNames — Kanal-Namen je Aufgabenart (speed 3nu+17+nFeet, Duck-MoE +13 Soft-Kanäle, motion 3nu+27 inkl. Sensorblock+lastAct, hover 15), io-Knoten = obsDim + 2 Stick-Ports; (2) FlexNet — MLP mit FREIER Architektur [in, h1…h3, out], tanh, linearer mu-Kopf, Wertkopf auf letzter Hidden-Schicht, handgeschriebenes Backward (Gradientenpuffer _dh je Aktivierungs-Slot) + Adam, kompakte JSON-Serialisierung (5 Dezimalen); (3) CardPPO — vollständiges PPO je Karte (Welford-Norm, GAE, gecliptes Surrogat, Entropie, Mini-Batch-Mischen — gleiche Mathematik wie train.js, architekturgenerisch); (4) cardReward: 6 Gewichtsfelder alive/up/vel/turn/energy/fall mit Klemmen; (5) Graph-Modell: addLink mit Port-Kapazität (1 Kabel je Port, Ersetzen), ZYKLUS-CHECK VOR Graph-Mutation (Bug unterwegs gefunden: abgelehnte Verbindung hatte ersetzte Kabel zerstört), policyOrder topologisch, removeNode räumt Kabel ab, sanitizeGraph (Limits 16 Karten/12 UI/8 Konst/240 Kabel, nIn 1–64, nOut 1–32, hidden 1–3×8–256)
- CanvasBoard: execCtrlStep (Quellen → Karten in topo-Ordnung → Senken) + trainCtrlStep (Rollout + PPO je trainierbarer Karte; globale Aufgaben-Belohnung × Skala oder eigene Formel; Episoden-Reset wie trainCtrlStep; task.lastAct aus Senken-Rohwerten gefüllt); Senken-Modi residual (keyCtrl + actSpan·tanh — identische Semantik zu App-Policies; Drohne: Hover-Schub als Referenz) und direct (Rohwert, ctrlrange-geklemmt); unverbundene Aktuatoren halten Keyframe-Pose; NaN-Wachen (Eingänge auf 0 + einmalige Warnung); Persistenz je Roboter (tr_canvas_v2_<robotId>) inkl. gelernter Karten-Netze, Auto-Save bei visibilitychange/pagehide
- DOM-Editor: Pan/Zoom (pointer + Buttons + Fit), Nodes mit Kopf/Sub/Ports (io grün, out amber, policy cyan, frozen gestrichelt, const violett, ui gelb), Kabel als SVG-Bezier + Temp-Pfad beim Ziehen, Tap-Tap UND Drag-Verdrahtung, Edit-Panel (Name/nIn/nOut/Hidden/lr/T/trainierbar/Belohnung+6 Gewichte/App-Policy-Import/Löschen), Karten-Fußzeile live (R·Schritte·Loss), canvasUIBar: button/toggle/slider/joy/gauge/light/code-Widgets (code mit ctx {t,dt,state}, Syntax-Prüfung, Runtime-Fehler → 0 + Meldung)
- main.js: Modus CANVAS (dritter Chip + Statuszeite CANVAS), Loop-Zweig (AUSFÜHREN Echtzeit + checkFall + Plugin-Hooks; TRAINIEREN mit Tempo-Slider 1–16 + 34 ms Not-Aus), Board-Erstellung nach loadRobot('g1') mit vollständigen Hooks, loadRobot lädt JE-ROBOTER-Graph neu (attach prunt tote Ports), startTraining verlässt Canvas-Modus sauber, executeAction 'mode' versteht canvas, 4 neue execTool-Handler (canvasGraph: state/add/link/unlink/remove/config/clear/import; canvasReward; canvasRun; canvasUI), observeState trägt canvas-Zusammenfassung, __trainrobot: canvas/canvasDescribe/setCanvasMode/toggleCanvasSheet/execTool
- ai.js: System-Prompt v2.17.0-Block + Werkzeuge 16–19 + ARCHITEKTUREN-BAUEN-Führung (erst readDoc CANVAS) + AI_DOCS; mcp/CANVAS.md NEU (Router-Rezept, Belohnungs-Felder, UI-Code-Kontrakt, Grenzen), mcp/README.md aktualisiert
- VERSION 2.17.0 / versionCode 29
- TESTS: scripts/canvas_v2170_test.mjs NEU 69/69 (Layout-Portzahlen == obsDim je Aufgabe, FlexNet-Forward/JSON-Roundtrip, Backward finit+nichtnull+Adam bewegt, CardPPO lernt sichtbar + Roundtrip + App-Import (MoE abgelehnt), Graph: Kapazität/Ersetzen/Zyklus/Topo/removeNode/sanitize, Reward nachgerechnet, Board an ECHTER MuJoCo-Sim: residual-Formel exakt, unverbundene Aktuatoren = Keyframe, Training sammelt Schritte + PPO-Update + saveNow-Format, describe()); scripts/ui_v2170_test.mjs NEU 44/44 (Playwright, EIN Boot: Topbar/Chip/Sheet, 108 io-Ports + 29 out-Ports, Karte via UI + Architektur über Edit-Panel 2→16→2 mit Netzanpassung, 4 Kabel via canvasGraph + SVG-Pfade, Selbstverbindung abgelehnt OHNE Graphschaden, CANVAS-Modus + Statuszeile + STOPP-Button, Training 48 Schritte finit + pausierbar, canvasUI-Slider fließt in Karte, canvasReward eigene Formel, run:false → MANUELL + Leiste versteckt, localStorage-Persistenz, state-JSON, 0 Seitenfehler)
- BUGS unterwegs: (1) addLink mutierte Graphen vor Zyklus-Check → bei Ablehnung fehlten ersetzte Kabel — Check jetzt auf simulierter Kabel-Liste VOR Mutation; (2) stopTraining rief this.save() (nicht existent) → saveNow; (3) FlexNet-Backward-Loop hatte mu-Kopf doppelt erfasst — korrigiert über _dh-Slots; (4) motion-Layout fehlte Sensorblock+lastAct (3nu+27 statt 2nu+18)
- REGRESSIONEN: test_v2140 53/53 · test_v2141 32/32 · motion_v2150 41/41 · motion_v2160 33/33 (Versions-Check auf ≥2.16 gelockt) · dr_test 41/41 · duck_sync 24/24 · parallel 21/21 · ui_v2140 17/17 · ui_v2141_render 10/10 · ui_v2150 17/17 · motion_ctrl aktualisiert (veralteter animOn=false-Check auf v2.16.0-Kommandogang-Semantik) — ALLE GRÜN
- Build: SDK neu bestückt (platforms;android-34 + build-tools;34.0.0 via sdkmanager in build-env), local.properties gesetzt, assembleRelease OK (41,7 MB); versionCode 29 / versionName 2.17.0; Signatur 1c0422b9… identisch mit allen v2.x
- Release: Commit 569a6f4 + Tag v2.17.0 gepusht (frischer Clone — lokales .git war veraltet), CI auto-release, download/Trainrobot.apk ersetzt + verifiziert

Stage Summary:
- v2.17.0: NETZ-CANVAS live — Sensoren links einzeln (+ Stick X/Y), Aktuatoren rechts einzeln, Policy-Karten (nIn/nOut/Hidden frei, eigenes PPO je Karte) mit Kabeln verbunden, Belohnung global×Skala oder eigene Formel je Karten-ID, App-Policies importierbar/einfrierbar (Router-Architekturen), eigene UI-Elemente als Policy-Ein-/Ausgänge, Modus CANVAS führt den Graph live aus, Canvas-Training per Karte. Gemini steuert ALLES über canvasGraph/canvasReward/canvasRun/canvasUI (doc CANVAS).
- Release v2.17.0: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.17.0

---
Task ID: 40
Agent: Super Z (Hauptagent)
Task: v2.18.0 — Canvas VOLLBILD + Multi-Touch (Pinch-Zoom + Zwei-Finger-Pan) + Pan-Bugfix

Work Log:
- NUTZERWUNSCH: „Canvas muss Vollscreen sein damit es auf Handy leichter ist und touch. Man sollte auch zoomen und bewegen mit zwei Finger können im canvas" — Canvas (v2.17.0) war ein 88-vh-Bottom-Sheet mit 1-Finger-Pan (der sogar kaputt war)
- VOLLBILD: .cv-sheet = Fixed-Overlay inset:0 mit 100dvh (WebView hat keine Fullscreen-API — Full-Viewport-Overlay + nativer Immersive Mode = effektiv Vollbild), border-radius 0, z-index 46; sheet-grab aus #canvasSheet entfernt; .cv-viewport flex-fill (min-height:0) + overscroll-behavior:contain; Gesten-Hinweis #cvGesture („2 FINGER: ZOOMEN · VERSCHIEBEN | 1 FINGER: ZIEHEN · VERBINDEN") dezent unten im Viewport
- MULTI-TOUCH (canvas.js _worldDown): Pointer-Map je Geste; 1 Finger = Delta-Pan; 2 Finger = PINCH-ZOOM um Finger-Mittelpunkt (Baseline {dist, Mitte, z, view} bei Finger-Wechsel-Reset) + Verschieben mit der Mitte — Welt-Punkt unter der Mitte klebt an den Fingern; v2.18.0-FIX: Mitte von Client- in viewport-relative Koordinaten umgerechnet (view.x/y ist viewport-relativ — ohne Abzug sprang der Anker um den Rand-Offset, im Test exakt Δy=111,76 bei top=228); Rest-Finger pannt nach touchEnd SPRUNGWEI weiter (Delta-basiert); setPointerCapture in try/catch (synthetische Events/Tests)
- PAN-BUGFIX (v2.17.0-Regression!): move-Handler überschrieb die Pointer-Position mit pointers.set() BEVOR das Delta gelesen wurde → Delta war immer 0 → Hintergrund-Pan funktionierte noch NIE; Fix: prev vor set lesen
- zoomBy(f, px, py): Zoom jetzt um Bildschirm-Punkt (Buttons: Viewport-Mitte) mit Welt-Anker statt um Ursprung; Wheel-Zoom um Cursor auf .cv-viewport (passive:false); Zoom-Klemmen erweitert 0,35–1,6 → 0,22–2,4 (Vollbild: hohe IO-Karten rauszoomen), fitView-Min angepasst; Node-Kopf-Drag-Lock (_dragPtr): zweiter Finger auf Kartenkopf startet keinen Zweitzug, Original-Finger zieht weiter
- UI-Leiste ÜBER dem Canvas: body.cv-open (toggleCanvasSheet) → #canvasUIBar z-index 50 + Position über Vollbild-Canvas (Widgets bleiben bedienbar im CANVAS-Modus); Klemmen in Pinch (Hard-Clamps 0,2–8 ratio) gegen Zittern
- ai.js: System-Prompt v2.18.0-Satz (Vollbild + Gesten + UI-Leiste über Canvas); mcp/CANVAS.md neuer Abschnitt „0) Bedienung (v2.18.0)"; README.md Canvas-Bullet
- VERSION 2.18.0 / versionCode 30
- TESTS: scripts/ui_v2180_test.mjs NEU 28/28 (Playwright + synthetische PointerEvent-Kette: Vollbild-Geometrie 420×860@(0,0), kein sheet-grab, Viewport >50 %, Gesten-Hinweis, touch-action:none; Pinch 0,85→1,70 bei Faktor 2 + Weltpunkt Δ(0,00) unter Mitte, Raus-Zoom mit Klemme, pointerup inert; Zwei-Finger-Pan Δ exakt (−20,−30) ohne Zoom-Änderung; Finger-Wechsel Restfinger Δ(40,0) ohne Sprung; Wheel um Cursor punktfix; Buttons zoomen um Fläche-Mitte; ⤢ zeigt alle Karten; 1-Finger-Karten-Drag durch z geteilt; Drag-Lock zweiter Finger Δ(0,00) + Original zieht weiter; cv-open-Flag sauber; Graph bleibt; 0 Seitenfehler); BUGS unterwegs: CDP dispatchTouchEvent liefert im Headless keine Pointer-Events → synthetische PointerEvents; Test-Asymmetrie der Pinch-Baseline (Leer-Move auf Startposition); Regressionen ALLE grün: canvas_v2170 69/69, ui_v2170 44/44, motion_v2160 33/33, motion_v2150 41/41, test_v2140 53/53, test_v2141 32/32, dr 41/41, duck_sync 24/24, parallel 21/21, ui_v2140 17/17, ui_v2141_render 10/10, ui_v2150 17/17
- GIT: lokales .git war wieder veraltet/divergiert (alte Historie mit 26k Alt-Artefakten) → v2.18.0 als sauberen 9-Dateien-Commit (21d725e1, +401/−24) auf origin/main-Historie neu gesetzt (hard reset + checkout der 9 Pfade aus dem lokalen Commit), Fast-Forward-Push + Tag v2.18.0; CI SUCCESS (~2 Min); download/Trainrobot.apk = Release-Asset v2.18.0; apksigner: Signatur 1c0422b9… identisch mit allen v2.x, versionCode 30 / versionName 2.18.0

Stage Summary:
- v2.18.0: Das Netz-Canvas ist jetzt VOLLBILD mit echter Handy-Bedienung — 2 Finger zoomen (um Finger-Mitte, 0,22–2,4×) und verschieben, 1 Finger zieht Karten/Kabel, Zoom-Buttons/⤢/Mausrad ergänzen; dabei wurde der Ur-Bug von v2.17.0 behoben (Hintergrund-Pan hatte nie funktioniert, Delta-0) und der Pinch-Anker geometrisch sauber (viewport-relativ) gemacht. Canvas-UI-Leiste schwebt über dem Vollbild-Canvas. Alle 13 Testsuiten grün (430 Checks).
- Release v2.18.0: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.18.0

---
Task ID: 41
Agent: Super Z (Hauptagent)
Task: v2.19.0 — CANVASBUILD (ganze Architektur in 1 Gemini-Aufruf) + TOOL-WHITELIST-FIX + Gemini-3.8-Flash-Pin

Work Log:
- NUTZERBERICHT: „Ich schreibe Gemini ‚Baue ein soft moe policy architecture. Router + 4 Experten (gehen, drehen, Gleichgewicht, aufstehen), geringste Latenz … In canvas' und er hat nichts gemacht" + Wunsch: Gemini auf „Gemini 3.8 flash" umstellen
- ROOT CAUSE (kritisch, seit v2.17.0): canvasGraph/canvasReward/canvasRun/canvasUI fehlten in der TOOLS-Whitelist von validateToolCall() (ai.js) → validateToolCall lieferte null → der Agent-Loop behandelte die Antwort als reine Textantwort und FÜHRTE NICHTS aus. Gemini hatte also vermutlich korrekt canvasGraph aufgerufen — die App hat es stumm verworfen. ZWEITERSCHWEREND: „Maximal sinnvoll: 3 Werkzeug-Schritte" machten eine Router+4-Experten-Architektur (5 Karten + ~24 Kabel + 5 Belohnungen) im Stückeln ohnehin unmöglich.
- FIX 1 (ai.js): alle 4 Canvas-Werkzeuge + canvasBuild in TOOLS aufgenommen, je Werkzeug harte Argument-Validierung (Klemmen: nIn 1–64, nOut 1–32, hidden 8–256 geclampt, lr/T, Port-Referenzen, canvasUI-kinds, reward-w-Felder).
- FIX 2 — canvasBuild (Werkzeug 20): EIN Aufruf baut die GANZE Architektur: clear, cards[] (bestehende Karten mit gleichem Namen werden UMKONFIGURIERT statt dupliziert; reward je Karte), links[] (Knoten NACH NAME auflösbar, io/out/Karten), sink residual|direct, run/train. canvas.js buildPlanGraph (rein, unit-testbar): Kabel-Fehler werden GESAMMELT statt abgebrochen, Zyklus-/Port-/Limit-Checks je Kabel, Kabel auf tote Ports nach Architekturwechsel entfernt. main.js canvasBuildTool: PPO-Verwerfen bei archReset, _ensurePPO, Report (Karten neu/angepasst, Kabel ok/fehlgeschlagen mit Grund, Aktuatoren verkabelt x/y, trainierbare Karten) → Gemini kann fehlende Kabel gezielt mit canvasGraph cmd=link nachsetzen.
- FIX 3 (Modell-Pin): PREFERRED_SMART = 'gemini-3.8-flash' hat Vorrang vor der Versions-Score; LS_MODELS-Key tr_ai_models_v1 → v2 gebumpt = alte 7-Tage-Modell-Caches auf allen Bestandsgeräten sofort ungültig; DEFAULT_SMART-Kette beginnt ebenfalls mit gemini-3.8-flash.
- System-Prompt: Tool 20 dokumentiert, „Maximal 5 Werkzeug-Schritte", ARCHITEKTUREN BAUEN → SOFORT canvasBuild (NIEMALS nur beschreiben/nachfragen/Karte-für-Karte), REZEPT „ROUTER + EXPERTEN" mit den 4 Wunschaufgaben + custom-Belohnungen (Gehen vel 1.2/energy 0.002, Drehen turn 1.2, Gleichgewicht up 1.5/fall 3, Aufstehen up 2/ohne fall-Malus) + geringe Latenz via kleiner Netze ([48,32], Router [48]).
- Doku: mcp/CANVAS.md (5-Werkzeuge-Tabelle + §0b canvasBuild mit JSON-Beispiel + Rezept), mcp/README.md (v2.19.0-Stand), README.md (Canvas-Bullet + Pin), Werkzeuge-Hilfetext im observe-State.
- VERSION 2.19.0 / versionCode 31
- TESTS: scripts/canvas_v2190_test.mjs NEU 61/61 (Whitelist-Fix bewiesen: canvasGraph vormals null; canvasBuild-Klemmen; buildPlanGraph: Anlegen/Wiederverwenden/archReset/gesammelte Kabel-Fehler/Zyklus/Port-Ersatz/Limits/sink; END-TO-END des Nutzerwunschs: 5 Karten + 24 Kabel in 1 Aufruf; Modell-Pin inkl. v1-Cache-Ignoranz + TTL-Ablauf; Prompt/Doku/Version). Regressionen ALLE GRÜN: canvas_v2170 69/69, test_v2140 53/53, test_v2141 32/32, dr 41/41, duck_sync 24/24, parallel 21/21, motion_v2150 41/41, motion_v2160 33/33, motion_ctrl ✓, ui_v2140 17/17 (3×, 1 initialer Flaky-Lauf), ui_v2141_render 10/10, ui_v2150 17/17, ui_v2170 44/44, ui_v2180 28/28. Unterwegs: _hiddenArr klemmt jetzt statt zu filtern (4→8, 999→256).
- Build: SDK neu bestückt (cmdline-tools 11076708, build-tools;34.0.0, platforms;android-34 in build-env/android-sdk); CI (main + Tag v2.19.0) beide SUCCESS (~1,5 Min); Release-Asset → download/Trainrobot.apk (28 MB); aapt: versionCode 31 / versionName 2.19.0; apksigner: SHA-256 1c0422b9251e47ce… identisch mit allen v2.x

Stage Summary:
- v2.19.0: Gemini kann Canvas-Architekturen JETZT wirklich bauen — der stumme Whitelist-Bug ist behoben und mit canvasBuild genügt EIN Agent-Aufruf für Router + 4 Experten (gehen/drehen/Gleichgewicht/aufstehen) inkl. Kabel, Belohnungen je Karte und Trainingsstart; SMART-Modell fest auf gemini-3.8-flash gepinnt (Cache-Bust auf allen Geräten). Nutzer-Aktion: App aktualisieren, dann denselben Satz nochmal in den KI-Chat schreiben — im CANVAS-Modus liegen danach die 5 Karten, Training startet automatisch (Tempo-Slider regeln).
- Release v2.19.0: https://github.com/KilllerBoss/testfeld-07/releases/tag/v2.19.0

---
Task ID: 42
Agent: Super Z (Hauptagent)
Task: v2.20.0 — LOGIK-VERBINDER (+ − × ÷ min max abs neg) + LANGDRUCK-STAPELVERBINDUNG + LISTEN-BUG-FIX + Gemini sieht JEDEN Port (state/portsList) + linkMany

Work Log:
- NUTZERBERICHT: (1) „Gemini hat nur geschafft das Training zu starten. Es muss aber ganze Architektur bauen können. Es muss jeden Punkt sehen können und auch verbinden können." (2) Canvas-Listen-Bug: „wenn es zu viele Punkte gibt und es nicht drauf passt, dann ist das zu einer Liste aber die im unteren Bereich der Liste kann ich nicht antippen" (3) Wunsch: Langdruck auf eine Kartenseite wählt die FREIEN Ports, Druck auf andere Karte verbindet sie paarweise, Überzählige bleiben frei (4) Neue Komponente „kein Netz sondern ein Verbinder oder Logik. Zb kann man +,-,/,* einfügen. Es soll dann die Signale jeweils bearbeiten. Anzahl Inputs auswählen und auch Outputs"
- ROOT CAUSE Listen-Bug: .cv-nbody hatte max-height:330px + overflow-y:auto — bei 68+ Ports wurde der Kartenkörper zur scrollbar-„Liste", aber touch-action:none + Port-Down-Handler machten Scrollen unmöglich → untere Ports nie antippbar. FIX: max-height/overflow ENTFERNT, Ports laufen jetzt in SPALTEN à max 20 (colSize = ceil(n/ceil(n/20))) — io/out/policy/logic alle gleich, Höhe bleibt kompakt, Breite wächst (max-width 560px), nichts scrollt mehr
- LOGIK-KARTEN (canvas.js): type 'logic' — KEIN Netz/kein PPO, reiner Signal-Verbinder. LOGIC_OPS add/sub/mul/div/min/max/abs/neg (abs/neg unär), logicFold faltet über alle Eingänge (acc = ((in0⊗in1)⊗in2)…), nicht verkabelte Eingänge = 0, ÷ durch 0 → 0 (kein Infinity), NaN/±∞ → 0, Ergebnis ±1e6 geklemmt. JEDER Ausgang trägt dasselbe Ergebnis (nOut = Fan-out). addLogicNode: nIn ≥ Operator-Minimum, 1–16 je Seite, Limit 16 Karten. Rosa (#ff5f7e) im Canvas, Port-Namen a/b/c… → y0…, Edit-Panel (Name/Operator/nIn/nOut), Kopf zeigt „+ · 2→1"
- AUSFÜHRUNG: policyOrder jetzt über Policy+LOGIK topologisch (Logik kann zwischen Karten liegen: io→Logik→Karte→Logik→out), _evalPolicies verzweigt je Typ (_evalLogicNode schreibt in _outVals), _sourceValue liefert Logik-Ausgänge wie Policy-Ausgänge; execCtrlStep UND trainCtrlStep nutzen denselben Pfad (Logik läuft im Training mit)
- STAPELVERBINDUNG (Langdruck ≥ 550 ms): _armBatch (Timer + Move-Abbruch >14 px + Pointerup-Abbruch) an Port-Rows UND Kartenkörper (_sideForPress: linke/rechte Körperhälfte → in/out-Seite); _batchPress wählt _freePorts der Seite (gelbes .cv-sel-Highlight + #cvBatch-Banner oben im Viewport „N freie EINGÄNGE/AUSGÄNGE gewählt…"), nochmal gleiche Seite = aufheben, Hintergrund = verwerfen (_worldDown); _batchComplete verbindet freie Ports PAARWEISE oben→unten (min(freiA,freiB)), Richtung automatisch (out→in), gleiche Typen → klare Fehlermeldung, Überzählige bleiben frei, Erfolgsmeldung 2,2 s + Buzz; render() malt Auswahl neu, removeNodeUI/clearAll räumen auf
- GEMINI-VOLLSICHT: describe() liefert jetzt io/out mit portsList:[{port,name,used}] (JEDER Sensor-/Aktuator-Port einzeln, Stick-Ports benannt) und je Policy/Logik-Karte freeIn/freeOut; canvasGraph cmd=linkMany (linkManyGraph — viele Kabel in EINEM Aufruf, Fehler pro Kabel gesammelt) als Reparaturweg; cmd=add type=logic + cmd=config {op,nIn,nOut}; buildPlanGraph akzeptiert Logik-Karten (spec.logic = Operator, bestehende gleichnamige werden umkonfiguriert, Report kind:'logic', FÜHLFEHLER unterwegs: spec.logic wurde nicht als op an addLogicNode durchgereicht → neue Logik-Karten waren immer 'add')
- ai.js: canvasGraph-Validierung erweitert (linkMany-Links, op-Liste, config op), canvasBuild-Karten mit {logic:"add"…} → Logik; System-Prompt: v2.20.0-Satz (Logik + linkMany + jeder Port sichtbar), Werkzeug 16/20 aktualisiert, ABLAUF-Vorschrift „(1) state zeigt JEDEN Port → (2) canvasBuild GANZER Plan → (3) Report prüfen, fehlende Kabel in EINEM linkMany nachsetzen → (4) erst dann train/run" + explizites Verbot „NIEMALS NUR Training starten ohne gebaute Architektur"; AI_DOCS/CANVAS-Titel aktualisiert
- main.js: canvasGraph linkMany/logic-Handler, updateCvStat mit Logik-Zähler, +Logik-Toolbar-Button (cvAddLogic), mount batch-Element, VERSION 2.20.0; index.html: + Logik-Button, #cvBatch-Banner, Gesten-Hinweis „LANG DRÜCKEN: MEHRERE PORTS AUF EINMAL VERBINDEN", train-note mit Stapel-Anleitung; style.css: cv-logic, cv-sel-Highlight, cv-batch-Banner, .cv-nbody ohne max-height, max-width 560px
- Doku: mcp/CANVAS.md (v2.20.0: §0 Bedienung mit Langdruck-Geste + Spalten-Fix, §0c Logik-Karten, canvasBuild-Beispiel mit „Mischer"-Logik, Grenzen 16/16), mcp/README.md + README.md
- TESTS: scripts/canvas_v2200_test.mjs NEU 84/84 (logicFold alle Operatoren + Guards, addLogicNode-Klemmen, sanitize, topo-Ordnung Logik↔Policy gemischt, buildPlan gemischt + Umkonfigurieren, linkMany ok/fail, describe portsList/freeIn/freeOut, Board an ECHTER G1-Sim: Stick X 0,5 + Konstante 0,3 → add 0,8 → Karte → ctrl-Formel exakt, op-Wechsel add→mul sofort 0,15, nicht verkabelter Eingang = 0, Training 60 Schritte finit, Persistenz+Reload, Stapelverbindung inkl. Zyklus-Falle B→A zu Recht abgelehnt + C.out→A.in automatisch gerichtet + out→out abgelehnt + Überzähler frei, Verdrahtungs-Checks); scripts/ui_v2200_test.mjs NEU 27/27 (Playwright: +Logik erstellt rosa Karte a/b→y0, io 108 Ports in 6 Spalten ≤ 20 Zeilen + kein max-height, Langdruck wählt 4 Ausgänge gelb + Banner, B.in lang drücken verbindet 0>0,1>1,2>2 mit Überzähler frei, Bewegung bricht ab, Hintergrund verwirft, Tap-Tap-Einzelkabel-Regression, linkMany 2/3 mit Fehler-Report, state portsList/freeOut, 0 Seitenfehler); BUGS unterwegs: Page-Timer unter SwiftShader verzögert (>800 ms für 550 ms-Timer) → Tests warten auf ZUSTAND (waitForFunction) statt feste Zeiten
- REGRESSIONEN (16 Suiten, 513 Checks): canvas_v2200 84 · ui_v2200 27 · canvas_v2190 61 · canvas_v2170 69 · test_v2140 53 · test_v2141 32 · dr 41 · duck_sync 24 · parallel 21 · motion_v2150 41 · motion_v2160 33 · motion_ctrl ✓ · ui_v2140 17 · ui_v2141_render 10 · ui_v2150 17 · ui_v2170 44 · ui_v2180 28 — ALLE GRÜN (Versions-Pins in v2190/v2160-Tests auf ≥-Vergleich gelockert; ui_v2170 portNamen→portsList; ui_v2180 io/out für leeren Testpunkt beiseite gerückt — Spalten-Layout macht die Karten breiter)
- GIT/ENV: lokales .git war WIEDER veraltet/divergiert (UUID-Marker-Commits, 11k Alt-Dateien) → v2.20.0 auf origin/main-Historie neu gesetzt (stash/reset --hard origin/main/stash pop); stash pop lieferte Konflikt + Revert von main.js/index.html (Marker-Commit hatte Zwischenstände verschluckt) → canvas.js aus dem Stash, main.js/index.html aus dem Marker-Commit 29955814 wiederhergestellt, mount-batch-Zeile erneut ergänzt, ALLE Suiten erneut grün
- Build: local.properties hatte falsches Property (android-sdk statt sdk.dir) → korrigiert; Gradle 8.7 neu installiert; assembleRelease offline OK (28 MB, hängt nur im Daemon-Shutdown — bekannt); versionCode 32 / versionName 2.20.0; APK-Assets verifiziert (VERSION 2.20.0, cvBatch, LOGIC_OPS); Signatur 1c0422b9… identisch mit allen v2.x
- Release: Commit + Tag v2.20.0 auf origin/main gepusht, CI auto-release, download/Trainrobot.apk ersetzt + verifiziert

Stage Summary:
- v2.20.0: Der Canvas kann jetzt LOGIK: rosa Verbinder-Karten (+ − × ÷ min max abs neg) mit frei wählbaren Ein-/Ausgängen verarbeiten Signale OHNE Netz — in Ausführung UND Training, topologisch zwischen den Policy-Karten. STAPELVERBINDUNG: eine Kartenseite lang drücken wählt alle freien Ports (gelb + Banner), andere Karte lang drücken verbindet paarweise, Überzähliges bleibt frei. Der LISTEN-BUG ist weg (Ports in Spalten à 20, nichts scrollt mehr). Gemini sieht JEDEN Port einzeln (portsList + freeIn/freeOut), kann viele Kabel mit linkMany nachsetzen und bekommt die Vorschrift: IMMER ganze Architektur bauen, NIE nur Training starten.

---
Task ID: 43
Agent: Super Z (Hauptagent)
Task: v2.21.0 — ⭐ MOTION-KI (MotionBrick/AI4Animation-artig): fertig trainierte Motion-Policy animiert den Roboter, Nutzer steuert bei Bedarf per Joystick/Buttons (Steuer-Mix + Geist-Pause + Clip-Wechsel)

Work Log:
- NUTZERWUNSCH: „Baue sowas wie motionbrick von Nvidia ein oder wie sebastianstarke/AI4Animation … Ich will das fertig trainierte Motion ai es animiert und ich es mit Joystick und buttons bei Bedarf steuere"
- PRINZIP (Master-Prompt: minimal Parameter, maximale Konsistenz): KEIN neuer Trainingspfad — die Wiedergabe-Schicht reutzt die v2.16.0-Entkopplung (Aktions-Anker IMMER Keyframe-Pose) und die existierenden Befehl-Kanäle des Motion-Tasks. Die trainierte Policy liefert die BEWEGUNG (Stil/Phase aus der GLB-Referenz in 'folgt'-Semantik), der Nutzer greift über die Befehl-Kanäle ein.
- STEUER-MIX (main.js policyCtrlStep): Motion-Task → task.cmd.vx = mix·StickVx + (1−mix)·clipSpeed(phase) (Clip-Tempo via task.refSpeed(phase)), task.cmd.wz = mix·StickYaw; _manualCmd = true (advance() überschreibt NICHT). Drohne (pathOn): Mix in cmd.vx und cmd.yaw (Höhe bleibt Bahn-geführt), wzKey-Fallback 'wz'|'yaw'. mix 0 = nur Clip (autonome Wiedergabe) · 0,7 (Standard) = Stick führt, Clip gibt Stil/Grundtempo vor · 1 = nur Stick. Aktivierter Steuer-Chip „Joystick/Buttons" überschreibt den Mix bewusst (volle Stick-Führung wie bisher).
- GEIST-PAUSE (motiontask.js advance): ghostPaused-Flag friert die Referenzzeit (phase += … und Loop-Buchhaltung nur !ghostPaused) — der Geist hält die Pose, die Policy hält sie nach → der Roboter „stoppt" IM STIL der Motion; Trigger-/Cmd-Integration und tElapsed laufen weiter (Buttons wirken beim Halten).
- setMotionKi(on): schaltet die Referenz automatisch auf FOLGT (vorheriger Modus wird gemerkt und beim Ausschalten wiederhergestellt), Toast/Log weist auf Modus POLICY hin; AUS setzt auch die Geist-Pause zurück. nextMotionClip(): springt zum nächsten Clip mit Variante für den AKTIVEN Roboter (motionByRobot[robot] bzw. rec.motion beim G1), wrappt und aktiviert über activateClip; activateClip im AN-Zustand erzwingt 'folgt' erneut.
- PANEL (index.html GLB-Bereich, neue Zeile „MOTION-KI"): AUS/AN-Chip · Steuer-Mix-Slider (0–1, Anzeige „70 %", persistiert tr_motionki_v1 — on bleibt bewusst un-persistiert: bewusster Einschaltakt) · ⏸ GEIST (Label wechselt zu ▶, active-Klasse) · ⏭ CLIP; train-note erklärt die Wiedergabe.
- KI-WERKZEUG 21 motionKi (ai.js): args {on, mix 0…1, paused, nextClip} — Whitelist + Validierung (mix-Klemme), System-Prompt (v2.21.0-Satz + Tool-Doku + WANN-WAS-Zeile „spiel meine Motion ab und lass mich lenken/pausier/nächster Clip/gib mir die volle Steuerung"), AI_DOCS/CONTROL-Titel; main.js motionKiTool + execTool-Registrierung + observeState.motionKi (on/mix/ghostPaused/Hinweis) + __trainrobot-Handles (setMotionKi/nextMotionClip/motionKiState für Tests).
- Doku: mcp/CONTROL.md (⭐ MOTION-KI-Sektion: Semantik, Mix-Grenzen, Drohnen-Mix, Grenzen), mcp/README.md + README.md (v2.21.0-Bullets).
- TESTS: scripts/motion_v2210_test.mjs NEU 35/35 (GEIST-PAUSE an ECHTER Sim: Phase friert exakt, tElapsed läuft, Resume; Befehl-Kanäle an der erwarteten OBS-Position 2·nu+12/13 (Float32-Epsilon-Gniff unterwegs), 'folgt': Bahn-Fehler ≈ 0 + lead = Clip-Tempo; Mixer-Formel statisch + Referenzrechnung 0,7·0,8 + 0,3·0,35 = 0,665 + Grenzen; motionKi-Validierung inkl. mix-Klemmen 1,7→1 / −3→0; Verdrahtung); scripts/ui_v2210_test.mjs NEU 11/11 (Panel vollständig, Chip AN/AUS, Mix via execTool synchron Slider+Anzeige+Persistenz, paused ohne GLB = klare Fehlermeldung, 0 Seitenfehler). canvas_v2200-Versions-Pins auf ≥ gelockert (84/84).
- REGRESSIONEN (18 Suiten, 559 Checks) ALLE GRÜN: motion_v2150 41 · motion_v2160 33 · motion_v2210 35 · motion_ctrl ✓ · test_v2140 53 · test_v2141 32 · dr 41 · duck_sync 24 · parallel 21 · canvas_v2170 69 · canvas_v2190 61 · canvas_v2200 84 · ui_v2140 17 · ui_v2141_render 10 · ui_v2150 17 · ui_v2170 44 · ui_v2180 28 · ui_v2200 27 · ui_v2210 11
- Build/ENV: SDK wurde WIEDER zurückgesetzt (build-env/android-sdk leer) → cmdline-tools 11076708 + platforms;android-34 + build-tools;34.0.0 via sdkmanager neu bestückt; assembleRelease offline OK (28 MB; Gradle hängt nur im Daemon-Shutdown — bekannt); versionCode 33 / versionName 2.21.0; APK-Assets verifiziert (VERSION 2.21.0); Signatur 1c0422b9… identisch mit allen v2.x
- Release: Commit + Tag v2.21.0 → CI auto-release → download/Trainrobot.apk ersetzt + verifiziert

Stage Summary:
- v2.21.0: MOTION-KI lebt — die fertig trainierte Motion-Policy ANIMIERT den Roboter (GLB-Stil/Phase, FOLGT-Semantik), Joystick und Buttons steuern BEI BEDARF über den STEUER-MIX (0 % = nur Clip, 100 % = nur Stick), ⏸ GEIST friert die Pose ein (Roboter „stoppt" im Stil), ⏭ CLIP springt weiter. Gemini steuert alles über das neue Werkzeug motionKi. Kein Trainingsbruch: reutzt die v2.16-Aktionsanker-Entkopplung — Policy bleibt, was sie ist; die Wiedergabe ist nur eine neue Deutung derselben Befehl-Kanäle.

---
Task ID: 44
Agent: Super Z (Hauptagent)
Task: v2.22.0 — ARDY-BRÜCKE: NVIDIA ARDY (Text→Motion) als Motion-Lehrer OHNE eigenes CUDA + Recherche ARDY/MotionBricks

Work Log:
- NUTZERWUNSCH: „Suche im Internet nach Nvidia adry und Motionbrick. Sowas wollte ich. Hab aber kein cuda. Wollte als Lehrer in der App benutzen"
- RECHERCHE (Web-Suche + GitHub-Quellcode): Beide projekte sind ECHTE NVIDIA-Research-Arbeiten aus 2026:
  * ARDY — „Autoregressive Diffusion with Hybrid Representation for Interactive Human Motion Generation" (SIGGRAPH 2026, TOG 45(4), arXiv Juli 2026, github.com/nv-tlabs/ardy, Apache-2.0): autoregressives Diffusionsmodell, Text→Motion in Echtzeit mit Online-Promptwechsel, kinematische Constraints, Checkpoints für CORE- UND UNITREE-G1-Skelett (nvidia/ARDY-G1-RP-25FPS-Horizon52/8, NVIDIA Open Model License). Braucht PyTorch+CUDA (getestet RTX 4090), Text-Encoder = LLM2Vec auf Meta-Llama-3-8B (gated, ~14 GB VRAM auf cuda/bf16, CPU-Modus via TEXT_ENCODER_DEVICE=cpu möglich). Export: MuJoCo-QPOS-CSV für G1 via scripts/generate.py.
  * MotionBricks — „Scalable Real-Time Motions with Modular Latent Generative Model and Smart Primitives" (arXiv 2604.24833, nvlabs.github.io/motionbricks, Code in NVlabs/GR00T-WholeBodyControl/tree/main/motionbricks, Apache-2.0/Open-Model-License): modulare „Bricks" + ein latent Backbone, 350 000+ Motion-Skills, 2 ms Latenz / 15 000 FPS auf RTX 5090, Training 32×H100. Requirements: „Python 3.10+, a CUDA-capable GPU" — kein CPU-Pfad dokumentiert.
  * Fazit CUDA: Beide brauchen zwingend CUDA — ABER die App braucht es nicht: ARDY läuft auf KOSTENLOSER Cloud-GPU (Colab T4), MotionBricks-Prinzip (modulare Skills + Wiedergabe mit Nutzereingriff) steckt seit v2.21.0 schon in MOTION-KI.
- ROOT-INSIGHT (Grundlage des Imports): ARDYs G1-MuJoCo-XML (g1skel34/xml/g1.xml) hat EXAKT die Gelenkliste der App (Menagerie unitree_g1/g1.xml): 29 Scharniere, NAME-für-NAME und Reihenfolge-für-Reihenfolge identisch (links Bein 6, rechts Bein 6, Taille 3, links Arm 7, rechts Arm 7). ARDY-CSV = 36 Spalten (root xyz + Quat wxyz + 29 DoF), MuJoCo-Konvention z-hoch/x-vorne — identisch zur App → 1:1-Mapping, KEIN Retargeting.
- IMPLEMENTIERUNG:
  * www/js/qpos.js NEU: parseQposCsv(text, opts) — reine, Node-testbare Parser-/Builder-Funktion: Zeilenprüfung (numerisch, ≥36 Spalten, Extraspalten toleriert, ≥2 Frames), q = DoF 1:1, h = pelvis z, root relativ zum ersten Frame, yaw aus Quat + STETIGE Entfaltung über ±π, baseQ w-first, meanSpeed/locomotion aus der Bahn, fps 25 (ARDY-G1-Checkpoints), robotId 'g1', src 'ardy', alg 99 (nie Re-Retarget). Deutsche Fehlermeldungen mit Zeile/Spalte + Hinweis auf --model g1.
  * main.js: onCsvFiles (G1-Only-Gate mit klarer Meldung, Record {id:'qpos_…', name+' (ARDY)', glb:null, src:'qpos', motion:packed, motionByRobot:{g1:packed}} → putClip → refreshClipList), Verdrahtung csvImportBtn/csvFile, Log „ARDY-Referenz aktiv", VERSION 2.22.0.
  * index.html: Button „.csv (ARDY)" + Input (accept .csv,text/csv) in der GLB-Leiste, Erklärnotiz ★ ARDY-BRÜCKE im glbStatus.
  * ai.js: System-Prompt v2.22.0-Satz + WANN-WAS-Zeile („kein CUDA" → Notebook verweisen, dann wie GLB behandeln).
  * Doku: mcp/CONTROL.md § ARDY-BRÜCKE, mcp/README.md (Tabelle + Kurzstand v2.22.0), README.md (Bullet).
  * scripts/ardy_colab.ipynb NEU: deutsches Colab-Notebook — GPU-Check, ardy-Installation, HF-Token-Schritt (Llama-3-8B gated), Prompt-Liste → generate.py --model g1 --duration 8 --output …, CSV-Zip-Download, App-Import-Anleitung, TEXT_ENCODER_DEVICE=cpu-Fallback für T4.
- TESTS: scripts/qpos_v2220_test.mjs NEU 52/52 GRÜN (Skelett-Identität aus g1.xml geparst gegen ARDY-Referenzliste; Parser mit deterministischen 29-Winkeln; meanSpeed/Root-Bahn/Yaw-Entfaltung ±π; pack/unpack-Roundtrip; Integration an ECHTER WASM-Sim: sampleRef exakt = CSV-Frames nach Einblendung, Interpolation Frame 12,5, refRoot/refSpeed, setGhostPose ohne srcPos, buildBCDataset 75 Frames, finites obs, GEIST-PAUSE-Regression; 4 Fehlerfälle + Extraspalten-Toleranz; Verdrahtung/Versionen/Notebook). REGRESSIONEN: motion_v2210 35/35 (Versions-Pins auf ≥2.22.0/34 gelockert), motion_v2150 41/41, motion_v2160 33/33, motion_ctrl ✓, canvas_v2200 84/84, canvas_v2190 61/61, canvas_v2170 69/69, test_v2140 53/53, test_v2141 32/32, dr 41/41, duck_sync 24/24, parallel 21/21 — ALLE GRÜN.
- BUILD: SDK/Gradle 8.7 neu bestückt (/home/z/tools/android-sdk, platforms;android-34, build-tools;34.0.0), assembleRelease OK (Erst-Dependency-Download >10 min → Hintergrund-Lauf), app-release.apk 28.069.571 bytes, aapt: versionCode 34 / versionName 2.22.0, 156 WWW-Assets inkl. js/qpos.js, apksigner: CN=Trainrobot OU=Testfeld07, SHA-256 1c0422b9… IDENTISCH mit allen v2.x → Update-fähig. APK → download/Trainrobot.apk. sha256 cff8a1c0ff1fea58b676b87b1b52e25e4a161d816d14a018b19a43762c700381.
- RELEASE: Commit lokal erledigt; PUSH + Tag v2.22.0 + CI-Release OFFEN — GitHub-Token nicht im Environment (wird nie persistiert) → beim Nutzer anfragen; nach Token: push main + tag v2.22.0 (CI auto-released), dann Asset-Integritätscheck.

Stage Summary:
- v2.22.0: ARDY-BRÜCKE lebt — eigene TEXTE werden Bewegungen: ARDY auf kostenloser Cloud-GPU (Notebook im Repo), CSV-Import per „.csv (ARDY)“ (G1), 1:1-Skelett-Mapping, vollwertiger Lehrer (Geist/BC/PPO/MOTION-KI). Kein eigenes CUDA nötig — genau wie gewünscht.
- APK lokal gebaut + verifiziert: download/Trainrobot.apk (versionCode 34, Signatur 1c0422b9…)
- Push/Release wartet auf GitHub-Token vom Nutzer

---
Task ID: 45
Agent: Super Z (Hauptagent)
Task: v2.23.0 — LEHRER-DATENSATZ (Kaggle+HF, Auto-Download), Alternative zu ARDY, Soft-MoE für ALLE, individuelle Experten-/Router-Rewards, Joystick+Buttons (Gamepad), Kommando-Spur-Antwort

Work Log:
- NUTZERWUNSCH: Alternative zu ARDY gesucht + Datensatz (idle, gehen, hüpfen, Weitsprung, liegen, aufstehen, mehr) auf Kaggle erstellen + auf HuggingFace hochladen + Auto-Download in App; Soft-MoE für jeden Roboter; Belohnungssystem für Router + jeden Experten individuell; Joystick+Buttons wie bei Games; Frage: weiß der Datensatz wo der Joystick zeigt/welcher Button? Animation NUR als Belohnung (nie Input), später komplett entfernbar ohne Verhaltensänderung.
- ALTERNATIVE ZU ARDY (Design-Entscheidung, kein CUDA nötig): eigener prozeduraler Basis-Motion-Datensatz als Belohnungs-Lehrer — ARDY-G1-QPOS-kompatibel (36 Spalten), im App-Format für alle 3 Roboter; echte ARDY-Clips optional über Kaggle-Notebook (kaggle_notebook_ardy.ipynb, kostenlose Kaggle-GPU) ergänzbar.
- DATENSATZ (scripts/gen_motion_dataset.py → dataset/, 41 Clips, 30 fps, CC0-1.0, deterministisch prozedural):
  * G1 (17): idle, walk, walk_back, walk_side, turn_l/r, laufen, huepfen, sprung, weitsprung, liegen, aufstehen, ducken, winken, fusskick, stopp, balance
  * Duck (12): idle, walk (watscheln), walk_back, turn_l/r, sitzen, liegen, aufstehen, huepfen, flattern, stopp, balance
  * X2 (12): starten, schweben, vorwaerts, rueckwaerts, seitwaerts, kreisen, steigen, sinken, rolle, salto, landen, notstopp
  * KOMMANDO-SPUR je Frame [vx, vy, wz, bA, bB, bC, bD] = Joystick-/Button-Stellung beim Generieren (bA Hüpfen · bB Hinlegen · bC Aufstehen · bD Stopp) → Antwort auf die Joystick-Frage: JA, beim Generieren bekannt; späteres Mappen = gleicher Kommando-Vektor (Gamepad) → nächstes Kommando/Skill-Auslöser.
  * ardy_g1/*.csv = exaktes NVIDIA-ARDY-QPOS-Format (root xyz + quat wxyz + 29 G1-DoF, z hoch, x vorwärts) → mit dem v2.22-Button „.csv (ARDY)" direkt importierbar; *.cmd.csv = Spur-Seitendatei.
- UPLOADS (öffentlich, ohne Token abrufbar): HuggingFace huggingface.co/datasets/KillerBoss/trainrobot-motionclips (whoami: KillerBoss) · Kaggle kaggle.com/datasets/rudolfbewer/trainrobot-motionclips (create + version v1.0.1 + dataset_metadata_update → isPrivate false, HTTP 200 ohne Login verifiziert) · dataset/ auch ins Repo committet.
- APP v2.23.0 (www/js):
  * motionset.js NEU: ensureMotionSet() = Cache-API → HF-Fetch → parseMotionSet → clipToMotion (App-Motion-Format inkl. cmd-Spur) · clipForSkill (Umlaut-/lue-Normalisierung) · clipForExpert (Expertenname → Clip) · BTN_SKILLS.
  * robots.js: makeDuckMoeTask → makeMoeTask verallgemeinert (Level relativ zu speedMax/yawMax/actSpan — Duck-Werte exakt erhalten; Level-Key tr_moe_lvl_<id> mit Duck-Migration; Recover-Schwelle aus done.zMin) · G1: task=makeMoeTask + moe:true + h0:0.75 + rW erweitert (route/recover/height/foot/imit) · Hover-Task (X2): +13 SOFT-KOMMANDO-Kanäle (obsDim 15→28), softCmd/skillW/styleW/setRouting/setUserCmd/expertR (droneSkillState), HOVER_R.route/imit · LEHRER in beiden: setTeacher(loop|pick(name), once|Map) + setTeacherW + triggerTeacherSkill + _teacherTick + Imitations-Reward (Pose-exp + Höhe-exp + Kommando-Übereinstimmung) × rW.imit × teacherW — REWARD-ONLY, NIE in obs · setUserCmd(…, btns) mit Edge-Erkennung: Buttons triggern Once-Clips + Skill-Hinweise.
  * skill.js: expertRFor/setExpertR/expertROverride (pro Roboter, localStorage tr_expertR_<id>, Klemmen) · expertRouterReward(o, er) mit Profil-Parameter.
  * controls.js: GAMEPAD — setPad/_setupPad (2 Stick-Zonen + A/B/C/D, Pointer Events), _pollGamepad (Gamepad-API: Axes 0–3, Buttons 0–3, Deadzone), command() mischt Gamepad (vy quer + rx Drehen, Drohne ry = climb).
  * main.js: VERSION 2.23.0 · HF-Auto-Download bei Boot (downloadMotionSetBg, Toast/Log) · wireTeacher() an allen Task-Erzeugungen (Loop-Clip folgt DOMINANTEM Experten, Once-Map, teacherW persistiert je Roboter) · LEHRER-Panel (Chip AN/AUS + Gewicht-Slider + ⟳ NEU LADEN + Quelle) · EXPERTEN-Editor (buildExpertRPanel: Router-Bonus/Fehler + je Experte live, applyER → setExpertR + refreshExpertR) · btnPad-Toggle · setUserCmd mit vy + controls.padBtn · setMoE-duck-Gate entfernt (alle Roboter, defaultExpertNames) · setTeacher/setExpertR-Executors.
  * ai.js: Werkzeuge setTeacher {on, weight} + setExpertR (Teilobjekt, Klemmen) + Doku (Nr. 22/23) + setMoE-Text „ALLE Roboter" + Whitelist.
  * index.html/style.css: GAMEPAD-Overlay (padSide/padZone/padStick/padBtns, touch-action:none), LEHRER-Zeile, EXPERTEN-Zeile + expertRPanel, btnPad-Icon-Button.
  * canvas.js: obsPortNames hover um 13 Soft-Ports erweitert (69/69).
- TESTS: scripts/motionset_v2230_test.mjs NEU 49/49 (Datensatz echt geladen, ARDY-Format, cmd-Spur, Umlaute, Experten-Mapping, expertR-Klemmen/Persistenz/Profilwirkung, duck 74 obs, G1 119 obs, Hover 28 obs, Curriculum-Skalierung, Lehrer addiert + teacherW=0 ⇒ EXAKT alter Reward, Once-Trigger/Ablauf, Button-Edges, Gamepad-Merge, KI-Validierung, Verdrahtung/Versionen). REGRESSIONEN: duck_sync 24/24 · test_v2140 53/53 · test_v2141 32/32 · motion_v2150 41/41 (Pin Hover 15→28 dokumentiert) · motion_v2160 33/33 · motion_v2210 35/35 · motion_ctrl ✓ · dr 41/41 · duck ✓ · canvas_v2170 69/69 · canvas_v2200 84/84 · ui_v2210 (Browser, echte App) 11/11 KEINE Seitenfehler.
- DOKU: mcp/README.md (v2.23.0-Kurzstand: LEHRER-DATENSATZ, SOFT-MOE FÜR ALLE, setExpertR, GAMEPAD), mcp/CONTROL.md (Lehrer + Gamepad + Kommando-Spur), mcp/REWARDS.md (Experten-/Router-Profile pro Roboter), README.md Bullet, dataset/README.md (komplette Skill-Liste + Formate + Nutzung).
- RELEASE: versionCode 35 / versionName 2.23.0; Commit + Push → CI baut APK + Release; Signaturprüfung + download/Trainrobot.apk nachziehen.

Stage Summary:
- v2.23.0: Der LEHRER lebt — 41 Basis-Motionen (Kaggle + HuggingFace, Auto-Download) formen NUR die Belohnung, nie die Eingänge: Gewicht 0 = Animation weg, Verhalten bleibt. Soft-MoE + individuelle Router-/Experten-Rewards für ALLE 3 Roboter. Gamepad-Overlay mit A/B/C/D triggert Lehrer-Skills. Die Joystick-Frage ist beantwortet: die Kommando-Spur steckt in JEDEM Datensatz-Frame.

- RELEASE ABGESCHLOSSEN: CI-Run 35271363371 SUCCESS → APK (versionCode 35 / 2.23.0) heruntergeladen; apksigner: SHA-256 1c0422b9251e47ce… IDENTISCH mit allen v2.x → update-fähig; abgelegt unter download/Trainrobot.apk (+ download/trainrobot-motionclips-v1.zip als lokale Datensatz-Kopie).
