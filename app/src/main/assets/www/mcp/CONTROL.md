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

## ⭐ MOTION-KI (v2.21.0) — die trainierte Motion animiert, du steuerst bei Bedarf
MotionBrick-/AI4Animation-artiger Wiedergabe-Modus (Werkzeug `motionKi`) für
fertig trainierte Motion-Policies mit aktiver GLB-Referenz:

- `motionKi {on:true}` — schaltet die Wiedergabe ein (Referenz wechselt automatisch
  auf **FOLGT** — der Lehrer hängt am Roboter, kein Bahn-Zwang) → danach in den
  **Modus POLICY** wechseln: die trainierte Policy ANIMIERT den Roboter (Stil/Phase
  kommen aus dem Clip), der Nutzer greift bei Bedarf ein.
- **STEUER-MIX** `mix` 0…1: mischt Stick-Kommando und Clip-Tempo in die Befehl-Kanäle.
  `0` = nur Clip (autonome Wiedergabe — der Roboter geht/fliegt im gelernten Stil,
  ohne Eingriff) · `0,7` (Standard) = Stick führt, der Clip gibt Stil und Grundtempo
  vor · `1` = nur Stick (volle Steuerung).
- **GEIST-PAUSE** `{paused:true}` — die Referenzzeit friert ein: der Geist hält die
  Pose, die Policy hält sie nach → der Roboter „stoppt" IM STIL der Motion.
  `{paused:false}` läuft weiter.
- **CLIP-WECHSEL** `{nextClip:true}` — springt zum nächsten Clip mit Variante für den
  aktiven Roboter (Policy-Wechsel via gespeicherten Clip-Policies bleibt erhalten).
- Drohne: der Flugbahn-Autopilot bleibt aktiv — der Mix mischt Stick in vx/yaw
  (Höhe weiter von der Bahn geführt).
- Nutzer-UI: GLB-Bereich → Zeile „MOTION-KI" (AN/AUS-Chip, Steuer-Mix-Slider,
  ⏸ GEIST, ⏭ CLIP). Status: `observe` → `motionKi`.
- Grenzen: braucht aktive GLB-Referenz + trainierte Motion-Policy (v2.16+-Policies
  verstehen die Befehl-Kanäle dank ANIM-DROPOUT am besten). Aktivierter
  Steuer-Chip „Joystick"/„Buttons" überschreibt den Mix (volle Stick-Führung).

---

## ★ ARDY-BRÜCKE (v2.22.0) — NEUE Bewegungen aus TEXT, ohne eigenes CUDA

NVIDIA **ARDY** (Text→Motion, SIGGRAPH 2026, `github.com/nv-tlabs/ardy`) erzeugt
**Unitree-G1-Bewegungen aus Text-Prompts** und exportiert sie als **MuJoCo-QPOS-CSV**
(36 Spalten: root xyz + Quaternion wxyz + 29 Gelenke). ARDY braucht eine CUDA-GPU —
aber NICHT auf dem Handy: das Notebook **`scripts/ardy_colab.ipynb`** (im GitHub-Repo)
läuft auf einer **kostenlosen Colab-GPU (T4)**: Prompt rein → CSV raus → herunterladen.

**Import in der App (nur G1):** GLB-Bewegung → **„.csv (ARDY)“** → CSV wählen.
Das App-G1-Skelett ist mit ARDYs G1-XML **Gelenk-für-Gelenk identisch** (Name und
Reihenfolge) — das Mapping ist 1:1, es wird nichts retargetet. Der CSV-Clip erscheint
mit Zusatz „(ARDY)“ in der Clip-Liste und ist ein **VOLLWERTIGER Lehrer**:

- Geist/Lehrer rendert die Pose direkt aus `clip.q` (`setGhostPose`)
- **BC vortrainieren** + **PPO-Motion-Tracking** wie bei GLB-Clips
- Referenz-Modi STELLE/FREI/FOLGT, Steuerung Keine/Joystick/Buttons je Clip
- ⭐ **MOTION-KI-Wiedergabe** (Werkzeug `motionKi`) — Steuer-Mix, Geist-Pause, Clip-Wechsel
- Tempo/meanSpeed/Lokomotion werden aus der Bahn berechnet (G1-Checkpoints = 25 fps)

**CSV-Anforderungen:** `--model g1` bei der ARDY-Generierung (Core-Modelle haben ein
anderes Skelett!), Zeilen pro Frame, kein Header, ≥ 2 Frames. Zusätzliche Spalten
jenseits von 36 werden toleriert. Fehlermeldungen nennen Zeile/Spalte.

**Für Gemini:** „Ich will X als Bewegung/Lehrer, habe aber kein CUDA“ → auf das
Colab-Notebook verweisen (Schritte stehen im Notebook), danach die importierte
Referenz wie einen GLB-Clip behandeln (Referenz antippen → BC → PPO → MOTION-KI).
Ein eigener ARDY-Import per Werkzeug ist absichtlich NICHT nötig — der Import ist
eine Nutzer-UI-Aktion (Dateizugriff), das Training danach ist dein Job.


## ⭐ LEHRER-DATENSATZ + GAMEPAD (v2.23.0)

**LEHRER (setTeacher {on, weight 0…1})**: Basis-Motion-Datensatz (41 Clips, HF-Auto-Download) als IMITATIONS-Belohnung. Die Animation ist NIE Policy-Eingang; weight 0 = Animation „weg" ohne Verhaltenssprung (Curriculum: hoch starten → Richtung 0 faden). Panel „GLB-BEWEGUNG → LEHRER": Chip AN/AUS, Gewicht-Slider, ⟳ NEU LADEN.

**GAMEPAD (Button im Steuerungs-Block)**: linker Stick = vor/seit (vy neu steuerbar!), rechter Stick = drehen (Drohne: hoch/runter = steigen/sinken), A = Hüpfen/Sprung, B = Hinlegen (Drohne sinken), C = Aufstehen (Drohne steigen), D = Stopp. Buttons triggern LEHRER-Once-Clips + Router-Hinweise. Physische Gamepads automatisch (Gamepad-API: Axes 0–3, Buttons 0–3).

**Datensatz-Kommando-Spur**: Jeder Clip-Frame trägt [vx, vy, wz, bA, bB, bC, bD] — die Joystick-/Button-Stellung beim Generieren. App-Buttons senden dieselbe Semantik → späteres Mapping 1:1 (nächstes Kommando / Skill-Auslöser).