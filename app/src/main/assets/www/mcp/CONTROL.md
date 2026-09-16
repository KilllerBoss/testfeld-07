# CONTROL — Steuerung & Betrieb

## POLICY-Modus (Policy an = gelerntes fahren)
- **v2.13.0: Der ECHTE Stick steuert ALLE Speed-Policies** (A1/Spot/Go2/G1/Go2/Duck).
  Vorher kam der Stick hier nie an — Policies fuhren mit dem letzten Trainingskommando weiter.
- MicroDuck: Stick → Soft-Kommandos (vx auf Level-Band geklemmt, z. B. L1 max 0.10 m/s!),
  skill-Form (balance/walk/turn) geht weich aus dem Befehl hervor; Zufalls-Scheduler pausiert.
- Klassische Tasks: Stick → cmd.vx/cmd.yaw, geklemmt auf die Trainings-Bänder.
-Trainingskommando ≠ Stick-Tempo: was der Duck bei L1 maximal kann = 0.10 m/s. Erst Curriculum hoch.

## MANUELL (Gangregler) & KI-Autofahrt
- Watschel-Gang (Duck), Ellipsen-Trott (Quadruped), Marsch (G1), Kaskadenregler (Drohne)
- drive/Buttons {type:"cmd"} = feste Fahrt (vx, yaw, ms), endet bei Stick-Eingriff

## Szenarien (setScenario): gehen | getup (Start liegend) | drop (Start in der Luft)
## Sturz-Verhalten (setFallMode): reset = Teleport | **stay = liegen lassen**
- stay + MicroDuck = echtes Aufstehen-Lernen: nach Sturz 6 s Aufsteh-Fenster IM Training,
  danach startet die nächste Episode aus der Lage (8 s Fenster) statt Sofort-Reset.

## Buttons/Makros (addButton): reset | push (Δv 0.5–10) | cmd | mode | clip | macro (max 6 Schritte)
## FPV-Kamera (setCamera, nur Anzeige)
- Rechteck „ROBOTER-SICHT" oben rechts; Mount = Kopf (Duck: head_camera) sonst Torso/Basis
- fov 40–110°, pitch −20…35°; JEDER 2. Frame gedrosselt
- **NIE ein Policy-Eingang** — obsDim ändert sich nicht; Vision-Modell-Hook bewusst leer (Canvas → ONNX später)
## Schubsen (btnPush / push tool): Δv-basiert, strength = m/s
