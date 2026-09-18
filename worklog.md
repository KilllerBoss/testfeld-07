
---
Task ID: 47
Agent: Super Z (Hauptagent)
Task: v2.25.0-Verifikation (ARDY Mini auf dem Gerät) + Umbenennung App → LerTrain / APK → lertrain.apk + Release

Work Log:
- STAND VERIFIZIERT: ARDY Mini war bereits voll integriert (Commit c034812, versionCode 37 / 2.25.0): ardy.js (690 Zeilen) repliziert 1:1 den Browser-Worker des HF-Spaces intsuc/ardy-mini (ddim.ts + session.ts, Revision c6efb9f) — 10 DDIM-Schritte, CFG 2.0, autoregressive 40-Frame-Fenster mit Root-Rezentrierung, Latent-Re-Quantisierung (64 Stufen), seedbarer PRNG; Modell intsuc/Llama-3-ARDY-Mini-Core40-Browser (~653 MiB fp16) von HF beim ersten Einsatz laden + Cache Storage; ort 1.27.0 via jsDelivr; ardyclip.js (cskel27-Weltposen → Retarget-Clip, Mixamo-Namen über BONE_ALIASES); ardytoken.js (WordPiece); UI: ARDY-MINI-Sektion (16 Basis-Animations-Chips Idle/Gehen/Laufen/Rückwärts/Hüpfen/Springen/…, Prompt-Feld DE/EN, Dauer, Seed, CFG, Cache-löschen, Fortschrittsbalken).
- ALLE ARDY-TESTS GRÜN (lokal ausgeführt): ardy_math_test.mjs 17/17 · ardy_runtime_test.mjs 15/15 · ui_v2250_test.mjs ALLE GRÜN · ardy/ardy_real_onnx_test.mjs 3/3 mit ECHTER ONNX-Inferenz (Text-Encoder → textConditions [1,1,2048]; Decoder-Kontrakt + Output-Layout; Fußkontakt-Summe 35/40) — CWD scripts/ardy nötig (lokales node_modules).
- UMBENENNUNG (Nutzerwunsch „Benenne neue apk und app lertrain.apk"): AndroidManifest android:label="Trainrobot" → "LerTrain" · index.html <title> → "LerTrain · Testfeld·07" · CI build-apk.yml: Trainrobot.apk → lertrain.apk (Build-Schritt, cp, Artefakt, Release-Datei, 5 Stellen) · README.md Release-Name. BEWUSST UNVERÄNDERT: applicationId com.trainrobot.app, Keystore/CN=Trainrobot OU=Testfeld07, JS-Brücken (TrainrobotBridge/TrainrobotAI), settings.gradle rootProject.name — Update-Fähigkeit bleibt vollständig erhalten.
- BUILD lokal: Gradle 8.7 assembleRelease (erster Lauf >8 min Configuration+Assets, APK fertiggestellt; kein zweiter Lauf nötig) → app-release.apk 28.107.505 bytes.
- VERIFIKATION: aapt badging — package com.trainrobot.app, versionCode 37, versionName 2.25.0, application-label 'LerTrain' (alle Locales) · apksigner verify --print-certs — Signer #1 SHA-256 1c0422b9251e47ce99c165a237d4b402667fc98aab40a21fe8f200b53ebee3c4 IDENTISCH mit allen v2.x (CN=Trainrobot, OU=Testfeld07) → update-fähig.
- ABLAGE: download/lertrain.apk (sha256 db37ac0230903020e0e7432723ac7d781695ca80c60f83a0ff4b41540c806ec8) neben der alten download/Trainrobot.apk (v2.24.0).
- RELEASE: Remote origin war nach Umgebungs-Reset weg → neu gesetzt (Token inline); fetch zeigte origin/main c9305c1 (Task 46) → lokaler main (c034812 + Umbenennung 8bf2dcd) FAST-FORWARD gepusht; Tag v2.25.0 gepusht → CI baut Release mit lertrain.apk automatisch.

Stage Summary:
- v2.25.0 / versionCode 37 live: ARDY Mini (HF-Space intsuc/ardy-mini) läuft AUF DEM GERÄT (WebGPU, sonst CPU) — Text→Motion ohne Cloud/Notebook, Ergebnis = normaler Lehrer-Clip (G1, Reward-only). App heißt jetzt LERTRAIN, APK heißt lertrain.apk — gleiche Signatur 1c0422b9…, gleiche Package, überschreibt die alte App per Update.
- Alle 4 ARDY-Testsuiten grün (52 Checks + 3 echte ONNX-Inferenzen); lokales Artefakt geprüft und abgelegt.
