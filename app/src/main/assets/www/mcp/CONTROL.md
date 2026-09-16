# CONTROL — Steuerung & Betrieb

## POLICY-Modus (Policy an = gelerntes fahren)
- **v2.13.0: Der ECHTE Stick steuert ALLE Speed-Policies** (G1/Duck).
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


## AUSSEHEN (setAppearance, v2.14.0) — nur Rendering, persistiert
- Erst {list:true} → Katalog aus Material-/Body-Namen. Dann {parts:[{part, color:"#rrggbb", shine 0–1, metal 0–1}], all:{...}}.
- Beispiele: „Schnabel orange“ → part noenoeil_material color #ff8c00 · „Chrome-Ente“ → all {metal:1, shine:1} · Reset: {reset:true}.

## APP-LOOK (setUI, v2.14.0)
- theme: standard | neon | amber | ice | wald (Akzentfarben der ganzen App).
- suggestions: [{label ≤20 Zeichen, q ≤120}] ersetzt die Vorschlags-Chips im KI-Chat (max 6) — nimm KONKRETE Kurzbefehle.

## GLB-Referenz (v2.15.0/v2.16.0) — Modi und Animation lösen
- Referenz-Modus (Chips im GLB-Bereich): STELLE = Referenz fix am Startpunkt (Bewegung auf der Stelle) · FREI = Lehrer wandert auf seiner Bahn (Loop) · FOLGT = Lehrer hängt am lebenden Roboter (kein Bahn-Zwang; root/yaw-Belohnung neutral). Joystick/Buttons führen in JEDEM Modus.
- „OHNE ANIM WEITER“ (v2.16.0) = animOn AUS: die Policy trainiert WEITER als KOMMANDOGANG (Netz, Norm-Statistik und Policy-Slot bleiben — NICHTS wird neu angefangen). Das Wurzel-Ziel ist die integrierte Kommando-Strecke (Training: Zufalls-Fahrbefehle, POLICY-Modus: Stick). Der Referenz-Modus bleibt wie gewählt; ohne gewählte Steuerung wird automatisch Joystick aktiviert.
- ENTKOPLUNG (v2.16.0): Der Aktions-Anker ist IMMER die Keyframe-Pose (keyCtrl) — identische Aktions-Semantik mit und ohne Animation. Die Policy ist NICHT mehr an die Animation gebunden. ANIM-DROPOUT: im GLB-Training laufen standardmäßig 20 % der Episoden (MOTION_R.dropP) komplett OHNE Animation — die Policy lernt beide Welten von Anfang an; das spätere Lösen der Animation ist kein Bruch mehr.
- Drohne: GLB-Clip = FLUGBAHN (Autopilot folgt der Route im MANUELL/POLICY-Modus; dieselben 3 Modi). „OHNE ANIM WEITER“ löst den Lehrpfad — die Drohne fliegt auf Stick/Gait.
