#!/usr/bin/env python3
"""v2.14.0: MCP-Dokumente auf 3 Roboter + neue Features umschreiben."""
import io

BASE = '/home/z/my-project/app/src/main/assets/www/mcp/'

# ── ROBOTS.md ──
robots = """# ROBOTS — Alle 3 Roboter (obs/actions byte-genau)

Regelrate 50 Hz (CTRL_DT 0.02 s), Physik-Substeps je nach Modell (dt 0.002 → 10 Substeps).
Action = tanh-begrenzte Abweichung von der Keyframe-Pose: ctrl = ref + actSpan·tanh(a·J).

## Unitree G1 (Humanoid, 29 Akt.) — auch GLB-Motion-Tracking
- obs 70: q−ref(29) | dq(29) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd(2) | lastAct(29) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) — mit GLB-Clip: Motion-Task (anderer Aufbau, cmd/Trigger-Kanäle)
- done: upz < 0.6, zMin 0.35; cmd vx −0.3..0.5, yaw ±0.8

## MicroDuck (Pollen Robotics · Hugging Face) — SOFT-MOE, 14 Akt.
- obs 74: q−ref(14) | dq(14) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd.vx(1) | cmd.yaw(1) | lastAct(14) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) | **SOFT-KOMMANDOS(13): vx, vy, wz, skill[4]=balance/walk/turn/recover, style[6]=neutral+5**
- POLICY-Modus: der echte Stick schreibt die Soft-Kommandos (vx auf Level-Band geklemmt, skill-Form geht aus dem Befehl hervor). Der Zufalls-Scheduler pausiert dann.
- Curriculum L1–L5: vxMax 0.10→0.30 m/s, wzMax 0.3→1.0, Aktionsamplitude 0.16→0.35, DR wächst
- Sensoren: IMU (framequat/gyro/velocimeter/accelerometer), Fußkontakte über Kontakt-Geoms
- **Kamera: `<camera name="head_camera">` am Kopf** — wird NUR für das FPV-Rechteck genutzt (setCamera), NICHT als Policy-Eingang. Kein Infrarot-Sensor.

## Skydio X2 (Drohne, 4 Akt.) — Kaskadenregler-Task
- obs 15, act 4 (Rotor-Sollwerte); cmd.alt = Höhe; done: zMin/upMin/xyMax

## AUSSEHEN (setAppearance, v2.14.0) — nur Rendering
- Teile = Material-, Body- oder Geom-Namen des aktiven Modells ({list:true} liefert den Katalog).
- G1: Material-Namen der Menagerie-Geoms; MicroDuck: z. B. jaw_material, top_head_shell_material, noenoeil_material (Schnabel orange!), foot_left/right_material; X2: Basis-Material.
- color "#rrggbb", shine (Glanz 0–1 → Roughness), metal (Metallik 0–1). Physik/Masse bleibt unberührt.

## Kamera/Sensoren (alle)
- Kein Roboter hat einen realen Kamera-Eingang in die Policy. FPV = virtuelle Kamera am Kopf/Torso/Basis, render-only (fpv.js), Vision-Modell-Kanal absichtlich LEER (Canvas → ONNX wäre der künftige Hook).
- IMU-Sensorik geht in die obs (gyro/projGrav), mit DR-Rauschen wenn Störungen an.
"""
io.open(BASE + 'ROBOTS.md', 'w', encoding='utf-8').write(robots)

# ── WORLD.md (NEU) ──
world = """# WORLD — Welten: Presets + KI-WELT (setWorld, v2.14.0)

## Presets (setWorld {preset:...})
testfeld (Rampe/Treppe/Tor/Säulen) · flach · parkour · treppen · huegel · zufall (Seed)

## KI-WELT — Objekte von Gemini bauen
setWorld {objects:[…], replace:<bool>}:
- replace:true = WELT NEU bauen (nur diese Objekte). replace:false = Objekte HINZUFÜGEN (alte bleiben).
- Objekt: {type, x, y, …} mit Typen:
  - box: {w, l, h} (Halbgrößen ×2), z = optional (default: sitzt auf dem Boden)
  - ball: {r} — rollt! · cyl: {r, h}
  - ramp: Rampe ~18° Neigung · tilt: schiefe Platte ~30° · gate: Tor {h} (2 Pfosten + Querbalken) · stair: 4 Stufen (Richtung über euler[2])
  - color: "#rrggbb" · euler: [rx, ry, rz] rad
- Regeln (hart geklemmt): max 40 Objekte; Spawn (0,0) frei — min. 0,9 m Abstand; x/y −12…12; Farben nur #rrggbb.
- Bei jedem Bau wird die Welt neu kompiliert: Training pausiert, kann mit der gespeicherten Policy fortgesetzt werden (obsDim unverändert).
- TIPP: Koordinaten der Objekte kennst DU (du hast sie gesetzt!) — kombiniere mit rWx-Termen (goTo/stayNear) für Aufgaben wie „läuf zum roten Turm“.
"""
io.open(BASE + 'WORLD.md', 'w', encoding='utf-8').write(world)

# ── REWARDS.md ──
rewards = io.open(BASE + 'REWARDS.md', encoding='utf-8').read()
rewards = rewards.replace('## Speed-Tasks (A1/Spot/Go2/G1): rW', '## Speed-Tasks (G1, Drohne analog mit hoverR): rW')
rwx = """

## rWx — KOMPLEXE ZIELTERME (v2.14.0, rewardx.js): patch.rWx = {on:1, terms:[…]}
Termbibliothek (max 8, je {kind, w 0–5, hard?, …}):
- goTo {x, y, tol} — Fortschritt zur Annäherung + Halt-Bonus im Zielkreis (w = 0.5 sinnvoll)
- stayNear {x, y, r} — Strafe für Abstand > r; hard = Abbruch bei > r+0.5
- heightBand {zMin, zMax} — Basis-Höhe im Band (Ducken/Hüpfen); hard = Abbruch bei 0.25 Abweichung
- faceYaw {yaw} — Blickrichtung halten (rad)
- paceMax {v} / paceMin {v} — Tempo-Deckel/-Mindest (m/s, horizontal)
- uprightMin {up} — Mindest-Aufrecht (upz)
- hard:true = Episode endet bei grober Verletzung (Constraints), sonst nur Reward-Formung.
Terme wirken ZUSÄTZLICH zur Basis-Belohnung, auf G1 (Speed-Task) UND MicroDuck (Soft-MoE-Task).
Kombiniere mit setWorld: Objekte an bekannten Koordinaten + goTo-Term = Navigations-Aufgabe.
"""
if 'rWx — KOMPLEXE' not in rewards:
    rewards = rewards.replace('## Domain Randomization', rwx + '\n## Domain Randomization')
io.open(BASE + 'REWARDS.md', 'w', encoding='utf-8').write(rewards)

# ── CONTROL.md ──
ctl = io.open(BASE + 'CONTROL.md', encoding='utf-8').read()
ctl = ctl.replace('**(A1/Spot/Go2/G1/Go2/Duck)**', '**(G1/Duck)**').replace('(A1/Spot/Go2/G1/Go2/Duck)', '(G1/Duck)')
ctl += """

## AUSSEHEN (setAppearance, v2.14.0) — nur Rendering, persistiert
- Erst {list:true} → Katalog aus Material-/Body-Namen. Dann {parts:[{part, color:"#rrggbb", shine 0–1, metal 0–1}], all:{...}}.
- Beispiele: „Schnabel orange“ → part noenoeil_material color #ff8c00 · „Chrome-Ente“ → all {metal:1, shine:1} · Reset: {reset:true}.

## APP-LOOK (setUI, v2.14.0)
- theme: standard | neon | amber | ice | wald (Akzentfarben der ganzen App).
- suggestions: [{label ≤20 Zeichen, q ≤120}] ersetzt die Vorschlags-Chips im KI-Chat (max 6) — nimm KONKRETE Kurzbefehle.
"""
io.open(BASE + 'CONTROL.md', 'w', encoding='utf-8').write(ctl)

# ── ARCHITECTURE.md ──
arch = """# ARCHITECTURE — Policy-Netze

## Soft-MoE-Policy (MicroDuck, MASTER-PROMPT §34) — v2.14.0: Experten 2–8 (setMoE)
- Shared Encoder 128/128 (tanh) → E Soft-Experts (128→64→32; Standard E=4: Balance/Walk/Turn/Recovery, 79.969 Parameter)
- Soft Router (132→64→E, softmax; Kommando-Vorspülung kPrior=1.2) — kontinuierlich, KEIN hartes Routing
- Motion Manifold 32 D (weiche Expertenmischung) ⊕ Style-Latent 32 D (6 Styles embeddet, nur „neutral“ belegt)
- Shared Decoder (64→14); Value-Kopf auf dem Encoder; diagonale Gauß-Policy
- Routing-Glättung ||Δw||² ist Reward-Bestandteil (rW.route); Router-Bars im Trainings-Panel zeigen max. 4 an
- setMoE {experts:2–8}: Architektur-Änderung → Policy wird NEU aufgesetzt (ehrlich warnen!). Experten >4 heißen experte5… — für sie gibt es KEINE Spezial-Belohnung (expertR matcht nur bekannte Namen).
- Persistenz: moeE wird gespeichert (tr_ai_moeE) und beim nächsten Training genutzt; Policy-Speicher mit anderem E passt nicht (Format-Änderung = Neulernen).

## MLP-Policy (G1/X2)
- 61er/15er-obs → hidden 64×64 (tanh) → mu+logstd (actDim) + Value-Kopf, ~6–15k Parameter (je actDim)
- Konfigurierbar: actSpan, cmd-Bänder, done-Grenzen, alle Reward-Gewichte (rW/hoverR/rWx), PPO-Hyperparameter, DR, Szenarien.

## Formate
- Policy-Export: {meta:{app,version,robot,task,obsDim,actDim,stepCount,moeE}, policy:{…}} — Import akzeptiert auch das alte Naked-Format.
- Policy-JSON fmt: 'trainrobot-ppo-2-moe' (Soft-MoE, net.E gespeichert) bzw. 'trainrobot-ppo-1'; PPO.fromAny lädt alt+neu.
- Worker-Snapshot fmt 'softmoe-1' (serialisiert MoE-Netze generisch, inkl. E).

## Grenzen (nicht versprechen)
- Keine ONNX/INT8-Distillation (Phase später), kein NPU-Zugriff, kein GPU-Batching (MuJoCo-WASM = CPU).
- Mehr Parameter = langsamer auf dem Handy: „mehr Hirn“ kostet Schritte/s — immer abwägen.
"""
io.open(BASE + 'ARCHITECTURE.md', 'w', encoding='utf-8').write(arch)

# ── TRAINING.md ──
training = """# TRAINING — PPO, Tempo-Slider, Curriculum, Grenzen

## Ablauf
- Rollout 50 Hz → Buffer T (1024–8192) → GAE(γ 0.99, λ 0.95) → PPO-Update (4 Epochen, lr 3e-4, clip 0.2)
- TEMPO-SLIDER (v2.14.0): 1–16 Umweltschritte pro Bild, persistiert. Ersetzt die Chips 1×/4×/16×/MAX —
  „MAX“ (Parallel-Training über Web Worker) wurde ENTFERNT, weil es auf Handys das UI blockiert hat.
  Not-Aus: max ~2 Frames Budget pro Bild. Live-Kurven zeigen Schritte/s + Policy-Loss (2. Chart).
- „Liegen lassen“ + MicroDuck: Aufsteh-Fenster (s. REWARDS) — Episoden sind nicht mehr 1 Schritt lang

## Curriculum MicroDuck (duckLevel 1–5, automatisch)
- L1 flach (kein DR, vx 0.10, span 0.16) → L5 kombiniert (starkes DR, vx 0.30, span 0.35)
- Aufstieg: 10 Episoden-Gate, EMA ≥ epMax·(0.5+0.07·L); Abstieg: EMA < Gate/2
- Persistiert (tr_duck_lvl); KI kann duckLevel setzen

## Ehrliche Grenzen (nicht verschweigen)
- Handy-CPU: Duck-Soft-MoE ~400–800 Schritte/s inline — Skill-Emergenz braucht 10^6+ Schritte = Geräte-Zeit/Nächte.
- Kamera ist kein Input; kein ONNX-Export; kein GPU/NPU-Training; kein Parallel-Training mehr (bewusst entfernt).
"""
io.open(BASE + 'TRAINING.md', 'w', encoding='utf-8').write(training)

# ── README.md ──
readme = """# TRAINROBOT Wissensbasis (Art-MCP) — Index

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
"""
io.open(BASE + 'README.md', 'w', encoding='utf-8').write(readme)
print('MCP-Docs aktualisiert (6 Dateien + WORLD.md neu)')
