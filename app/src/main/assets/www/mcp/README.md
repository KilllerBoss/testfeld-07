# TRAINROBOT Wissensbasis (Art-MCP) — Index

Du (KI-Trainer) kannst diese Dokumente per Werkzeug `readDoc {doc:"NAME"}` lesen.
Sie sind die EINZIGE verlässliche Quelle für Schnittstellen — rate nicht.

| Dokument | Inhalt |
|---|---|
| ROBOTS | Alle 6 Roboter: Aktuatoren, obs-Aufbau (Kanal für Kanal), actions, Sensoren, Kamera |
| ARCHITECTURE | Policy-Netz (MLP + Soft-MoE), Parameterzahl, was konfigurierbar ist |
| REWARDS | Alle rW-Felder, expertR (Router-/Experten-Belohnungen), DR-Felder, Abbruch |
| CONTROL | Steuerung: Stick→Policy-Modus, Buttons, Makros, Szenarien, Sturz-Verhalten, FPV |
| TRAINING | PPO-Ablauf, Parallel-Worker, Domain Randomization, Curriculum, Grenzen (Handy) |

## App-Version v2.13.0 (Kurzstand)
- 6 Roboter: A1, Spot, Go2, **MicroDuck** (Soft-MoE, 74 obs / 14 act), G1 (29 act, GLB-Tracking), X2 (Drohne)
- Training: PPO auf der Geräte-CPU, Tempo MAX = parallel in Web Workern
- Domain Randomization (Störungen) + MicroDuck-Curriculum L1–L5
- **Neu v2.13.0**: Stick steuert ALLE Speed-Policies im POLICY-Modus (vorher tot),
  Aufsteh-Fenster statt Sofort-Abbruch bei „Liegen lassen", expertR (Router-/Experten-
  Belohnungen, MicroDuck), FPV-Kamera-Rechteck (nur Anzeige), Auto-Save + Wake Lock

## Eiserne Regeln
1. Physik > Balance > Aufgabe > Stil — niemals andersrum.
2. Kamera/FPV ist NIE ein Policy-Eingang (nur Anzeige für den Nutzer).
3. Architektur-Änderungen = neu trainieren; versprich keine instantanen Ergebnisse.
4. Handy-CPU: kleine Netze, kleine Schritte, ehrliche Erwartungen.
