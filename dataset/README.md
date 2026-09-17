# Trainrobot Motion-Clips — Basis-Lehrer-Datensatz (v1.0.0)

Prozedural erzeugte Basis-Animationen für **RL-Training als LEHRER** (Belohnungs-Referenz).
**Wichtig:** Die Animation dient NIE als Policy-Input — sie ist **nur Belohnungssystem**
(Imitation-Reward). So kann der Lehrer später komplett entfernt werden, ohne dass die
Policy ihr Verhalten ändert (Beobachtungsraum enthält die Animation nie; Lehrer-Gewicht
wird im Training einfach auf 0 gefadet).

Kein CUDA nötig: alles deterministisch prozedural erzeugt (CPU, 30 fps, CC0-1.0).

## Formate

| Pfad | Inhalt |
|------|--------|
| `app/motionclips.json` | Alle 41 Clips für G1 + MicroDuck + Skydio X2 (App-nativ, inkl. **Kommando-Spur** pro Frame) |
| `ardy_g1/<skill>.csv` | G1-Clips im **exakten NVIDIA-ARDY-QPOS-Format** (36 Spalten: root xyz + quat wxyz + 29 DoF, z hoch, x vorwärts) — direkt in der Trainrobot-App per „.csv (ARDY)" importierbar |
| `ardy_g1/<skill>.cmd.csv` | Kommando-Spur je Frame (7 Spalten, gleiche Framezahl) |
| `kaggle_notebook_ardy.ipynb` | Echte ARDY-Clips (Text→Motion) auf **Kaggle-GPU** erzeugen und als CSV ergänzen |

## Kommando-Spur (= Joystick-/Button-Antwort)

Jeder Frame trägt `[vx, vy, wz, bA, bB, bC, bD]`:

| Kanal | Bedeutung |
|-------|-----------|
| `vx` / `vy` | Soll-Tempo vorwärts / seitwärts (m/s) — linke Stick-Achse |
| `wz` | Soll-Drehrate (rad/s) — rechte Stick-Achse |
| `bA` | Button A = Hüpfen/Sprung (0/1) |
| `bB` | Button B = Hinlegen (0/1) |
| `bC` | Button C = Aufstehen (0/1) |
| `bD` | Button D = Stopp (0/1) |

**Antwort auf die Frage „Weiß der Datensatz, wo der Joystick zeigt / welcher Button
gedrückt ist?": JA — beim Datensatz-Generieren ist die Kommandospur bekannt und wird
mitgespeichert.** Weil die Clips prozedural aus Kommandos erzeugt werden, ist jeder
Frame mit der exakten Stick-/Button-Stellung verknüpft. Später mappen: Der Joystick
in der App erzeugt denselben Kommando-Vektor → Match per nächstem Kommando-Vektor
bzw. Skill-Auslöser. Für echte Mocap-Dateien ohne Spur: kleines Netz lernt offline die
Kommandos aus der Bewegung (Kommando-Regression) — Notebook-Vorlage folgt.

## Basis-Animations-Liste (fürs Training nötig)

**Gemeinsam (Beiner):** idle (Stehen), walk (Gehen vorwärts), walk_back (Rückwärts),
walk_side (Seitwärts), turn_l/turn_r (Drehen), laufen (schnell), huepfen (Hüpfen),
sprung (Vertikalsprung), weitsprung, liegen (Hinlegen), aufstehen, ducken (Hocke),
stopp (Bremsen), balance (Gleichgewicht/Störung)

**MicroDuck zusätzlich:** sitzen (Hinsetzen), flattern (Kopf/Hals-Spiel)

**G1 zusätzlich:** winken (Arm winken), fusskick (Fußkick)

**Skydio X2 (Drohne, Pfad-Lehrer):** starten (Takeoff), schweben (Hover),
vorwaerts, rueckwaerts, seitwaerts, kreisen (Kreisflug), steigen, sinken,
rolle (Barrel Roll), salto (Flip), landen, notstopp

## Nutzung in der App (Auto-Download von HuggingFace)

Die App lädt `app/motionclips.json` automatisch von HuggingFace (Cache im WebView),
bietet sie als **Lehrer-Belohnung** an (Slider „Lehrer-Gewicht", Fade-out auf 0 =
Lehrer weg, Verhalten bleibt) und ordnet sie per Skill den Experten/Router zu.
G1-CSVs zusätzlich manuell importierbar per „.csv (ARDY)"-Button.

## Erweiterung mit echtem ARDY (optional, GPU)

1. `kaggle_notebook_ardy.ipynb` in einem Kaggle-Notebook öffnen (kostenlose GPU)
2. ARDY-Checkpoints laden, Prompts eingeben → QPOS-CSVs erzeugen
3. CSVs in `ardy_g1/` ergänzen (gleiche 36-Spalten-Konvention) und neu hochladen

Lizenz: CC0-1.0 (eigene Erzeugung; ARDY-Konvention-Referenz: NVIDIA ARDY, Apache-2.0).
