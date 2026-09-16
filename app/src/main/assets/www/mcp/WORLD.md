# WORLD — Welten: Presets + KI-WELT (setWorld, v2.14.0)

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
