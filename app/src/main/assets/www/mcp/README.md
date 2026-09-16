# TRAINROBOT Wissensbasis (Art-MCP) — Index

Du (KI-Trainer) kannst diese Dokumente per Werkzeug `readDoc {doc:"NAME"}` lesen.
Sie sind die EINZIGE verlässliche Quelle für Schnittstellen — rate nicht.

| Dokument | Inhalt |
|---|---|
| ROBOTS | Alle 3 Roboter: Aktuatoren, obs-Aufbau (Kanal für Kanal), actions, Sensoren, AUSSEHEN-Teile |
| WORLD | Welten: Presets + KI-WELT (setWorld — Objekt-Typen, Regeln, Spawn-Freiheit) |
| ARCHITECTURE | Policy-Netz (MLP + Soft-MoE 2–8 Experten), Parameterzahl, was konfigurierbar ist |
| REWARDS | rW-Felder, rWx-Zielterme (v2.14.0), expertR, DR-Felder, Abbruch |
| CONTROL | Steuerung, Buttons, Makros, Szenarien, Sturz-Verhalten, FPV, setAppearance, setUI |
| TRAINING | PPO-Ablauf, Tempo-Slider, Domain Randomization, Curriculum, Grenzen (Handy) |

## App-Version v2.14.0 (Kurzstand)
- 3 Roboter: **MicroDuck** (Soft-MoE, 74 obs / 14 act, 2–8 Experten per setMoE), G1 (29 act, GLB-Tracking), X2 (Drohne)
- **Neu v2.14.0**: setAppearance (Farben + Glanz/Metallik je Teil, nur Rendering) · setWorld (KI-WELT: Objekte
  bauen/löschen, replace/add) · setUI (App-Designs + eigene Vorschlags-Chips) · setMoE (Expertenanzahl 2–8) ·
  rWx-Komplexterme (goTo/stayNear/heightBand/faceYaw/paceMax/paceMin/uprightMin, optional hard) ·
  Tempo-SLIDER 1–16 statt MAX (UI-Freeze behoben) · Live-Kurven (Tempo+Loss) · Policy-Export mit Metadaten ·
  Roboter-Entfernung: A1, Spot, Go2 raus (APK deutlich kleiner)

## Eiserne Regeln
1. Physik > Balance > Aufgabe > Stil — niemals andersrum.
2. Kamera/FPV ist NIE ein Policy-Eingang (nur Anzeige für den Nutzer).
3. Architektur-Änderungen (setMoE) = neu trainieren; versprich keine instantanen Ergebnisse.
4. Handy-CPU: kleine Netze, kleine Schritte, ehrliche Erwartungen.
