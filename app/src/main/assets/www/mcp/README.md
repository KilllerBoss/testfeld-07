# TRAINROBOT Wissensbasis (Art-MCP) — Index

Du (KI-Trainer) kannst diese Dokumente per Werkzeug `readDoc {doc:"NAME"}` lesen.
Sie sind die EINZIGE verlässliche Quelle für Schnittstellen — rate nicht.

| Dokument | Inhalt |
|---|---|
| ROBOTS | Alle 3 Roboter: Aktuatoren, obs-Aufbau (Kanal für Kanal), actions, Sensoren, AUSSEHEN-Teile |
| WORLD | Welten: Presets + KI-WELT (setWorld — Objekt-Typen, Regeln, Spawn-Freiheit) |
| ARCHITECTURE | Policy-Netz (MLP + Soft-MoE 2–8 Experten), Parameterzahl, was konfigurierbar ist |
| REWARDS | rW-Felder, rWx-Zielterme (v2.14.0), expertR, DR-Felder, Abbruch |
| TRAINING | PPO-Ablauf, Tempo-Slider, Domain Randomization, Curriculum, Grenzen (Handy) |
| CONTROL | Trainings-Steuerung, Szenarien, Buttons/Makros, Kamera, Aussehen, WELT, UI, ⭐ MOTION-KI (motionKi), ★ ARDY-BRÜCKE (v2.22.0 — Text→Motion als Lehrer ohne eigenes CUDA) |
| CANVAS | NETZ-CANVAS (v2.20.0): ⭐ canvasBuild (ganze Architektur in 1 Aufruf), LOGIK-Verbinder (+ − × ÷ min max abs neg), linkMany (viele Kabel in 1 Aufruf), JEDER Port sichtbar (frei/belegt), Karten bauen/verbinden, Router-Architekturen, Belohnung je Karte, UI-Elemente als Ein-/Ausgänge (canvasBuild/canvasGraph/canvasReward/canvasRun/canvasUI) |

## App-Version v2.23.0 (Kurzstand)

- **Neu v2.23.0 — ⭐ LEHRER-DATENSATZ (setTeacher)**: Basis-Motion-Datensatz (41 Clips: idle, gehen, laufen, hüpfen, Sprung, Weitsprung, liegen, aufstehen, drehen, stopp, balance + Duck sitzen/flattern + Drohnen-Pfade) per AUTO-DOWNLOAD von HuggingFace (`KillerBoss/trainrobot-motionclips`, Spiegel auf Kaggle `rudolfbewer/trainrobot-motionclips`). GRUNDSATZ: Die Animation ist NUR Belohnung (Imitation-Reward), NIE Policy-Eingang — Gewicht 0 = Animation „weg", Verhalten bleibt stabil (Obs enthielten sie nie). Jeder Datensatz-Frame trägt eine KOMMANDO-SPUR [vx,vy,wz,Buttons] (= Joystick-/Button-Stellung beim Generieren — später 1:1 aufs Gamepad mappbar). ARDY-G1-QPOS-CSVs im Datensatz sind mit „.csv (ARDY)" importierbar.
- **Neu v2.23.0 — SOFT-MOE FÜR ALLE**: Soft-MoE (Router + 2–8 Experten) jetzt für MicroDuck, G1 UND Skydio X2 (Hover-Task hat einen Soft-Kommandoblock, obsDim 15→28 — alte Drohnen-Policies werden verworfen). G1 nutzt den verallgemeinerten MoE-Task (obsDim 119) mit relativem Curriculum.
- **Neu v2.23.0 — EXPERTEN-REWARDS PRO ROBOTER (setExpertR)**: Router-Bonus/Fehler-Strafe und jedes Experten-Ergebnis (stand/walk/turn/recover bzw. hover/move/turn/descend) individuell je Roboter einstellbar (UI „EXPERTEN → Belohnungen…" + Werkzeug setExpertR; Persistenz tr_expertR_<robot>).
- **Neu v2.23.0 — GAMEPAD**: Controller-Overlay (Button im Steuerungs-Block): linker Stick vor/seit, rechter Stick drehen, A Hüpfen/Sprung · B Hinlegen/Sinken · C Aufstehen/Steigen · D Stopp; physische Gamepads (Gamepad-API) werden automatisch erkannt. Buttons triggern Lehrer-Once-Clips + geben dem Router Skill-Hinweise.
- 3 Roboter: **MicroDuck** (Soft-MoE, 74 obs / 14 act, 2–8 Experten per setMoE), G1 (29 act, GLB-Tracking), X2 (Drohne). v2.15.0: GLB für alle + Referenz-Modi STELLE/FREI/FOLGT + „OHNE ANIM WEITER“; v2.16.0: Policy animations-unabhängig (Aktions-Anker = Keyframe, Kommandogang, ANIM-DROPOUT)
- **NETZ-CANVAS (v2.17.0, Vollbild v2.18.0)**: Node-Editor im Vollbild-Overlay — links ALLE Sensoren einzeln (+ Stick X/Y), rechts ALLE Aktuatoren einzeln, dazwischen Policy-Karten mit frei wählbaren nIn/nOut/Hidden-Layern/Neuronen, Kabel zwischen allen Ports, JEDE Karte mit eigener Belohnung, App-Policies als Karten importierbar + einfrierbar (Router-Architekturen), EIGENE UI-Elemente als Policy-Ein-/Ausgänge, Canvas läuft LIVE als Modus CANVAS, PPO-Training je Karte.
- **Neu v2.22.0 — ★ ARDY-BRÜCKE**: NEUE Bewegungen aus TEXT ohne eigenes CUDA — NVIDIA ARDY (Text→Motion, SIGGRAPH 2026) läuft im Colab-Notebook `scripts/ardy_colab.ipynb` auf einer KOSTENLOSEN Cloud-GPU; die erzeugte G1-QPOS-CSV (36 Spalten, 25 fps) importiert der Nutzer über den Button **„.csv (ARDY)“** (nur G1 — Skelett ist Gelenk-für-Gelenk identisch, 1:1-Mapping, kein Retargeting). Der CSV-Clip ist ein VOLLWERTIGER Lehrer: Geist, BC, PPO-Motion-Tracking, Referenz-Modi, Steuerung je Clip, MOTION-KI-Wiedergabe. Für Gemini: Nutzer auf das Notebook verweisen, dann wie GLB behandeln.
- **Neu v2.21.0 — ⭐ MOTION-KI (motionKi)**: MotionBrick-/AI4Animation-artige Wiedergabe — die FERTIG trainierte Motion-Policy animiert den Roboter (GLB-Stil/Phase in FOLGT-Semantik), der Nutzer steuert bei Bedarf: STEUER-MIX (0 = nur Clip, 1 = nur Stick), ⏸ GEIST-PAUSE (Roboter hält die Pose), ⏭ CLIP-Wechsel; KI-Werkzeug motionKi {on, mix, paused, nextClip}; Drohne: Mix in den Flugbahn-Autopilot.
- **v2.20.0 — LOGIK-VERBINDER + STAPELVERBINDUNG**: (1) Logik-Karten (KEIN Netz): + − × ÷ min max abs neg, nIn/nOut je 1–16, Ergebnis über alle Eingänge gefaltet, ÷/0 = 0, alle Ausgänge = Ergebnis; (2) canvasGraph cmd="state" listet JEDEN Port einzeln (portsList mit Name + frei/belegt, freeIn/freeOut je Karte); (3) cmd="linkMany" setzt viele Kabel in EINEM Aufruf; (4) Nutzer-Geste: LANG DRÜCKEN auf eine Kartenseite wählt alle freien Ports (gelb), nochmal auf einer anderen Karte = paarweise verbinden; (5) io/out-Ports laufen in Spalten à 20 — der frühere Scroll-"Listen"-Bug ist weg. canvasBuild akzeptiert Logik-Karten {logic:"add"…}. ARCHITEKTUREN: IMMER canvasBuild, NIE nur Training starten.
- **v2.23.0**: setTeacher (Lehrer-Belohnung, fadbar) · setExpertR (Experten-/Router-Rewards pro Roboter) · setMoE für ALLE Roboter · Gamepad-Overlay
- **v2.19.0-Bestand — ⭐ canvasBuild**: GANZE Architekturen in EINEM Werkzeug-Aufruf (Karten + Kabel + Belohnungen je Karte + Ausführung/Training) — der empfohlene Weg für „Router mit Experten“-Wünsche; SMART-Modell ist auf **gemini-3.8-flash** gepinnt. Werkzeuge: canvasBuild/canvasGraph/canvasReward/canvasRun/canvasUI — doc "CANVAS" lesen, bevor du baust.
- **v2.14.0-Bestand**: setAppearance · setWorld (KI-WELT) · setUI (Designs + Vorschlags-Chips) · setMoE (2–8 Experten) · rWx-Komplexterme · Tempo-SLIDER 1–16 · Live-Kurven · Policy-Export mit Metadaten

## Eiserne Regeln
1. Physik > Balance > Aufgabe > Stil — niemals andersrum.
2. Kamera/FPV ist NIE ein Policy-Eingang (nur Anzeige für den Nutzer).
3. Architektur-Änderungen (setMoE) = neu trainieren; versprich keine instantanen Ergebnisse.
4. Handy-CPU: kleine Netze, kleine Schritte, ehrliche Erwartungen.
