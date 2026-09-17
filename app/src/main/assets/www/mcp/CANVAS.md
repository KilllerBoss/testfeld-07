# CANVAS.md — NETZ-CANVAS (v2.20.0 · LOGIK-VERBINDER + LINKMANY + JEDER PORT SICHTBAR)

Der **Netz-Canvas** ist ein Node-Editor im Trainrobot: Architekturen aus Policy-Karten
und **Logik-Verbindern** bauen, mit Kabeln verdrahten, **live auf dem Roboter ausführen**
und **je Karte trainieren**. Du (Gemini) hast vollen Zugriff über 5 Werkzeuge:

| Werkzeug | Zweck |
|---|---|
| `canvasBuild` | ⭐ **GANZE Architektur in EINEM Aufruf** (Karten + Logik + Kabel + Belohnungen + run/train) — BEVORZUGT! |
| `canvasGraph` | Graph lesen (`cmd:"state"` — JEDER Port einzeln mit frei/belegt) + Einzel-Änderungen (add/link/linkMany/unlink/remove/config/clear/import) |
| `canvasReward` | Belohnung/Bestrafung je Karten-ID (global oder eigene Formel) |
| `canvasRun` | Canvas ausführen (Modus CANVAS) oder Canvas-Training an/aus |
| `canvasUI` | Eigene UI-Elemente (Buttons/Slider/Joystick/Code) als Ein-/Ausgänge |

**SO BAUST DU (v2.20.0):** Wenn der Nutzer eine Architektur beschreibt („Router mit 4
Experten“, „Soft-MoE in Canvas“), rufst du **EINMAL** `canvasBuild` mit dem KOMPLETTEN
Plan auf — nicht beschreiben, nicht nachfragen, nicht Karte für Karte, und NIEMALS nur
Training starten ohne gebaute Architektur. Port-Zahlen für die Kabel holst du vorher
via `canvasGraph {cmd:"state"}` — es listet **JEDEN Port EINZELN** (Name + frei/belegt).
Fehler einzelner Kabel brechen den Plan NICHT ab — das TOOL-ERGEBNIS listet sie, du
setzt sie dann in EINEM `canvasGraph {cmd:"linkMany"}`-Aufruf nach.

---

## 0) Bedienung (v2.18.0: VOLLBILD + Multi-Touch · v2.20.0: Stapelverbindung)

Das Canvas öffnet als **VOLLBILD-Overlay** (drei Punkte, ⛶-los — die App läuft nativ
im Immersive Mode, das Overlay füllt also den ganzen Bildschirm):

- **1 Finger** auf leerer Fläche = Fläche verschieben · auf Kartenkopf = Karte ziehen ·
  auf Port = Kabel antippen/z ziehen
- **LANG DRÜCKEN (≥½ s) auf eine Seite einer Karte** = alle **FREIEN Ports dieser Seite**
  werden ausgewählt (leuchten gelb, Banner oben zeigt die Anzahl) — dann auf eine
  Seite einer **ANDEREN** Karte lang drücken: die freien Ports werden **paarweise
  verbunden** (oben→unten), Überzählige bleiben frei. Gleiche Seite nochmal lang
  drücken = Auswahl aufheben, Hintergrund drücken = verwerfen. EINGANG lädt
  AUSGANG als Gegenstück ein (Ausgang→Eingang verbindet, Eingang→Eingang meldet Fehler)
- **2 Finger** = **Pinch-Zoomen** (um den Finger-Mittelpunkt, 0,22×–2,4×) und
  **gleichzeitig Verschieben** — der Welt-Punkt unter den Fingern bleibt unter den Fingern
- **Zoom-Buttons** `−` / `+` zoomen um die Fläche-Mitte, `⤢` passt alle Karten ein,
  Mausrad zoomt um den Cursor (Desktop/Emulator)
- io/out-Karten mit vielen Ports (bis 70) ordnen die Ports in **SPALTEN à 20** —
  nichts scrollt mehr, jeder Port bleibt antippbar (v2.20.0-Fix: vorher wurden die
  unteren Ports in einer scrollbaren Liste unantippbar)
- Die **UI-Elemente** (canvasUI: Buttons/Slider/Joystick/Gauge) schweben als Leiste
  ÜBER dem Vollbild-Canvas und bleiben dort immer bedienbar — auch im CANVAS-Modus
- Schließen: `×` oben rechts (Graph bleibt je Roboter gespeichert)

## 1) Aufbau des Graphen

Der Canvas hat pro Roboter EIGENEN Stand (G1/MicroDuck/Drohne trennen ihre Graphen).
Zwei feste Knoten existieren immer:

- **`io` — SENSOREN · EINGÄNGE (links)**: JEDER Beobachtungskanal der aktiven Aufgabe
  als EIGENER Ausgangsport, plus 2 Extra-Ports **Stick X** und **Stick Y**
  (Joystick der App, −1…1). Port 0…obsDim−1 sind die Kanäle (Namen siehe
  `cmd:"state"` → `nodes[portNamen]`), obsDim = Stick X, obsDim+1 = Stick Y.
- **`out` — AKTUATOREN · AUSGÄNGE (rechts)**: JEDER Aktuator als EIGENER Eingangsport
  (Namen = Aktuator-Namen aus dem Modell). Ein Port ohne Kabel hält die
  **Keyframe-/Ruhe-Pose**. Zwei Senken-Modi (per `config {node:"out", sink:…}`):
  - `residual` (Standard): Wert −1…1 → `tanh(w) × actSpan` um die Ruhepose — genau die
    Semantik der App-Policies (am G1/MicroDuck also "Δ zur Standpose").
  - `direct`: Rohwert als Reglersoll (auf ctrlrange geklemmt) — z. B. Rotoren.
    Drohne: Residuum bezieht sich auf die Hover-Schubleistung.

Dazwischen deine Knoten:

| Typ | Bedeutung | Ports |
|---|---|---|
| `policy` | Policy-Karte = eigenes MLP + EIGENES PPO | nIn Eingänge, nOut Ausgänge |
| `logic` | **Logik/Verbinder (v2.20.0)** — KEIN Netz, reine Signalverarbeitung | nIn Eingänge, nOut Ausgänge (1–16 je Seite) |
| `ui` | UI-Element als Ein-/Ausgang | button/toggle/slider/joy = Eingang (1–2 Ausgänge), gauge/light = Ausgang (1 Eingang), code = beides |
| `const` | Konstante(n) | Werte als Ausgänge |

**Wertfluss**: io/ui/const → (Logik) → Karten → (Logik) → out. KARTE → KARTE ist erlaubt
(so baut man Router/Hierarchien), Rückkopplung (Zyklen) werden abgelehnt.
Jeder Eingang hat genau EIN Kabel (neues Kabel ersetzt das alte), jeder Ausgang ebenfalls.

## 0c) Logik-Karten (Verbinder, v2.20.0)

`canvasGraph {cmd:"add", type:"logic", op:"add", nIn:2, nOut:1}` oder in canvasBuild:
`{"name":"Mischer","logic":"add","nIn":2,"nOut":1}`.

- **KEIN MLP, kein Training** — reiner Signal-Verbinder zwischen Kabeln.
- Operator `op`: `+` (add) · `−` (sub) · `×` (mul) · `÷` (div) · `min` · `max` ·
  `abs` (|in0|) · `neg` (−in0, unär).
- Rechenregel: `Ergebnis = ((in0 ⊗ in1) ⊗ in2) …` — der Operator wird über ALLE
  verkabelten Eingänge gefaltet (nicht verkabelte Eingänge zählen 0).
  `÷` durch 0 ergibt **0** (kein Infinity), NaN/±∞ werden zu 0, Ergebnis auf ±1e6 geklemmt.
- **JEDER Ausgang trägt dasselbe Ergebnis** — nOut > 1 = Verteiler (Fan-out ohne
  zusätzliche Kabelkreuzungen).
- Anwendungen: Stick + Slider mischen (add), Gegenrichtung (neg), Signale skalieren
  (mul), Differenz zweier Sensoren (sub), Begrenzer (min/max) — und als Sanity-Gate
  zwischen Router und Aktuatoren.
- Logik-Karten zählen NICHT als Policy-Karten (Eigenlimit 16, Ein-/Ausgänge je 1–16),
  erscheinen rosa/rosa im Canvas und werden in topologischer Reihenfolge mit den
  Policy-Karten ausgewertet.

## 0b) ⭐ canvasBuild — ganze Architektur, EIN Aufruf (v2.19.0)

```json
canvasBuild {
  "clear": true,
  "cards": [
    {"name":"Experte Gehen", "nIn":20, "nOut":14, "hidden":[48,32],
     "reward":{"mode":"custom","w":{"vel":1.2,"alive":0.3,"energy":0.002,"fall":2}}},
    {"name":"Experte Drehen", "nIn":20, "nOut":14, "hidden":[48,32],
     "reward":{"mode":"custom","w":{"turn":1.2,"alive":0.3,"fall":2}}},
    {"name":"Experte Gleichgewicht", "nIn":20, "nOut":14, "hidden":[48,32],
     "reward":{"mode":"custom","w":{"up":1.5,"alive":0.3,"fall":3}}},
    {"name":"Experte Aufstehen", "nIn":20, "nOut":14, "hidden":[48,32],
     "reward":{"mode":"custom","w":{"up":2,"alive":0.3,"fall":0}}},
    {"name":"Router", "nIn":20, "nOut":4, "hidden":[48],
     "reward":{"mode":"global","scale":1}},
    {"name":"Mischer", "logic":"add", "nIn":2, "nOut":1}
  ],
  "links": [
    {"from":{"node":"io","port":0},  "to":{"node":"Experte Gehen","port":0}},
    {"from":{"node":"io","port":0},  "to":{"node":"Router","port":0}},
    {"from":{"node":"Router","port":0}, "to":{"node":"Mischer","port":0}},
    {"from":{"node":"io","port":3},  "to":{"node":"Mischer","port":1}},
    {"from":{"node":"Mischer","port":0}, "to":{"node":"out","port":0}}
  ],
  "sink": "residual",
  "train": true
}
```

- `cards`: bestehende Karten mit GLEICHEM Namen werden UMKONFIGURIERT statt doppelt
  angelegt (Architekturwechsel = frisches Netz — steht im Report). Logik-Karten über
  `logic:"<op>"`.
- `links`: `node` ist io / out / Karten-NAME / Karten-ID; `port` 0-basiert.
  Sensor-Port-Zahlen (je Kanal mit Namen + frei/belegt): `canvasGraph {cmd:"state"}`.
- `sink:"residual"` = App-Semantik (tanh × actSpan um Ruhepose), `"direct"` = Rohwert
  (z. B. Drohnen- Rotoren — Drohne: Residuum auf Hover-Schub).
- `train:true` startet Canvas-Training sofort (impliziert Modus CANVAS);
  `run:true` nur ausführen; `run:false` zurück zu MANUELL.
- REPORT im TOOL-ERGEBNIS: Karten (neu/angepasst, LOGIK markiert), Kabel ok /
  FEHLGESCHLAGEN mit Grund, Aktuatoren verkabelt x/y, trainierbare Karten.
  Fehlende Kabel in EINEM Aufruf nachsetzen: `canvasGraph {cmd:"linkMany", links:[…]}`.

### Rezept: SOFT-MOE-ARTIGE ROUTER-ARCHITEKTUR (4 Experten, geringe Latenz)
1. **canvasBuild** wie oben: 4 Experten + Router, kleine Hidden-Schichten ([48,32],
   Router [48]) — kleine Netze = wenig Latenz auf dem Handy-CPU.
2. Experten mit **unterschiedlichen custom-Belohnungen**: Gehen→vel, Drehen→turn,
   Gleichgewicht→up+fall, Aufstehen→up (ohne fall-Malus, der Roboter DARF liegen).
3. `train:true` — Experten lernen parallel (je Karte eigenes PPO).
4. Später: Router trainieren, Experten `trainable:false` (config oder canvasBuild
   erneuter Aufruf mit gleichen Namen + trainable:false — Netze BLEIBEN erhalten).
5. Fortschritt: `canvasGraph {cmd:"state"}` → je Karte steps/lastReward.

## 2) Policy-Karten

`canvasGraph {cmd:"add", type:"policy", nIn:8, nOut:4, hidden:[64,64], name:"Router"}`
- `nIn` 1–64, `nOut` 1–32, `hidden` 1–3 Schichten à 8–256 Neuronen (tanh, linearer Aktionskopf).
- Jede Karte hat ihr **eigenes PPO** (eigene Normalisierung, eigener Puffer T=512, lr 3e-4).
- `trainable:false` = FROZEN: Karte läuft deterministisch mit, lernt NICHT.
- Architekturwechsel (nIn/nOut/hidden) setzt das Netz bewusst zurück.
- `config` ändert auch lr (1e-5…3e-3) und T (128…4096).
- **App-Policy importieren**: `canvasGraph {cmd:"import", node:"<id>"}` lädt die aktuell
  geladene Policy des normalen Trainings (MLP 64×64) in die Karte — Maße müssen zu
  nIn/nOut passen. Damit stellt man "darunter trainierte Policies" in den Canvas.

### Rezept: ROUTER über trainierte Policies
1. Im normalen Training Policies lernen lassen (z. B. Gehen mit Joystick-Steuerung).
2. Canvas öffnen: Karte A anlegen, `nIn/nOut` = Maße der Policy, `cmd:"import"`.
3. Karte A mit io-Sensorik verkabeln ( dieselben Kanäle, die die Aufgabe nutzt) und mit out.
4. Karte A `config {trainable:false}` (einfrieren).
5. Router-Karte R anlegen (z. B. nIn = Sensorik, nOut = 2), R-Ausgänge → freie Eingänge
   von A (A braucht dann nIn + 2 — frisches Netz! Router steuert A über diese Zusatz-Eingänge)
   ODER klassisch: R-Ausgänge → out und A als "Spezialist" parallel (nutze mehrere Karten).
6. `canvasReward {card:"R", mode:"global"}` (oder eigene Formel), Karten A frozen.
7. `canvasRun {train:true}` — nur R lernt, A läuft stabil weiter.

## 3) Belohnung je Karten-ID

`canvasReward {card:"<id|name>"|"alle", mode, scale, w}`

- `mode:"global"` — Karte bekommt die Aufgaben-Belohnung × `scale` (0…3).
- `mode:"custom"` — eigene Formel aus 6 Gewichten:
  - `alive` 0…0,5 (Grundbetrag je Schritt, Standard 0,3)
  - `up` 0…2 × (aufrecht − 0,7)
  - `vel` 0…2 × min(1, |Vorwärtsfahrt|)
  - `turn` 0…2 × min(1, |Gier-Rate|)
  - `energy` 0…0,01 × Σact² (BESTRAFUNG)
  - `fall` 0…5 (einmalige BESTRAFUNG bei Sturz-Ende)
- Bestrafung = negatives Gewicht? NEIN — Energy/Fall sind automatisch Strafterme,
  alle anderen positive. Werte 0 = Term aus.

## 4) Canvas ausführen / trainieren

- `canvasRun {run:true}` → **Modus CANVAS**: der Graph schreibt die Aktuatoren,
  die Aufgaben-Referenz/Belohnung läuft im Hintergrund weiter (für Training), der
  Roboter reagiert auf die verdrahteten Eingänge (z. B. Stick X → Karte → Aktuatoren).
- `canvasRun {train:true}` → **Canvas-TRAINING**: Rollout + PPO-Update je trainierbarer
  Karte (globaler oder eigener Reward). Tempo = Tempo-Slider im Trainings-Panel (1–16).
  Nicht-trainierbare Karten laufen deterministisch mit. Episoden-Resets wie im
  normalen Training. `{train:false}` pausiert; `{run:false}` zurück zu MANUELL.
- Karten-Fortschritt: `state` zeigt je Karte `steps` und `lastReward`; das UI zeigt
  sie live in der Karten-Fußzeile.

## 5) Eigene UI-Elemente (canvasUI)

`canvasUI {kind:"slider", label:"Tempo"} `→ neues Element + Knoten im Canvas.
- **Eingänge**: `button` (1 solange gedrückt), `toggle` (0/1), `slider` (0…1),
  `joy` (X und Y, −1…1), `code` (eigene JS-Logik).
- **Ausgänge**: `gauge` (Balken + Zahl), `light` (Lampe > 0,5), `code`.
- Die Widgets erscheinen unten in der App-Leiste, sobald der Canvas-Modus läuft —
  der Nutzer bedient sie mit dem Finger, die Werte fließen in die Karten.
- **Code-Element** (io:"in"): gibt je Regelzyklus `nOut` Zahlen zurück:
  ```js
  // Beispiel: Sinusschwingung + Boost bei state.merker
  if (ctx.t > 10) ctx.state.merker = true;
  return [Math.sin(ctx.t * 3), ctx.state.merker ? 1 : 0];
  ```
  `ctx = {t (Sekunden), dt, state (persistenter Speicher)}`. Code wird auf Syntax
  geprüft; Laufzeit-Fehler deaktivieren das Element NICHT, liefern 0 + Meldung.
- Verdrahten wie jede Quelle: `canvasGraph {cmd:"link", from:{node:"<ui-id>", port:0}, to:{node:"n2", port:3}}`.

## 6) Grenzen & Regeln

- Max. 16 Policy-Karten, 16 Logik-Karten (Ein-/Ausgänge je 1–16), 12 UI-Elemente,
  8 Konstanten, 240 Kabel (nIn 1–64, nOut 1–32 je Policy-Karte).
- Kein Parallel-Worker-Training im Canvas (Haupt-Thread) — Tempo-Slider regelt die Last.
- Ein Kabel je Port; Zyklen zwischen Karten werden abgelehnt.
- Der Canvas speichert sich je Roboter automatisch (inkl. gelernter Karten-Netze).
- Plugin-Hooks (onAct/onReward) wirken auch im Canvas-Modus.
- SANFT anfangen: kleine Netze (32/64), kurze Tests (`train:true` → nach ~30 s `state`
  checken), erst dann Architekturen ausbauen.
