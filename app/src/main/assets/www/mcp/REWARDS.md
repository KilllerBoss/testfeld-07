# REWARDS — Felder (KI-tunbar via applyConfig/patch)

## Speed-Tasks (G1, Drohne analog mit hoverR): rW = { vel, yaw, up, alive, energy, smooth, jlimit, fall }
- vel/yaw = Tracking-Fehler |v−v_soll|, |yawRate−wz_soll|; up = Aufrecht (upz−0.7); alive = Grundbonus
- energy = Σ a²; smooth = Σ Δa² (Ruckeln); jlimit = Anschlag-Nähe; fall = einmaliger Sturz-Malus

## MicroDuck (Soft-MoE) zusätzlich: height, foot, route, recover
- height = (gz−0.12)²; foot = Fuß-Geschwindigkeit² + 0.5·Kontaktwechsel („keine unnötigen Schritte")
- route = ||Δw||² der Router-Gewichte (§5 Routing-Glättung); recover = upz²-Formung im Aufsteh-Fenster

## expertR — Router-/Experten-Belohnungen (v2.13.0, skill.js, MicroDuck)
Zweistufige Gutschrift (Master-Prompt):
1) ROUTER-Bonus: dominanter Experte (Gewicht ≥ domMin) passt zum Zustand (z. B. upz < 0.45 =
   „fallen" → Experte „recover" gewählt → +routerBonus·domW). Klar falsch = sanfter Abzug (wrongPenalty).
2) EXPERTEN-Ergebnis: der Experte wird bezahlt, WAS REAL PASSIERT:
   - stand/balance: ruhig (0.5−speed) + aufrecht (upz−0.9)
   - walk: echte Fahrt min(|vFwd|, max(0.2, cmdVx))
   - turn: echte Drehung min(|yawRate|, 2)
   - recover: 10·rise·1.2 pro Schritt Aufricht-Fortschritt (×2 am Boden) — aufstehen zählt, wenn er WIRKLICH aufragt
Felder: on, routerBonus 0…2, wrongPenalty 0…1, domMin 0.05…0.95, stand.up/quiet, walk.speed,
turn.rate, recover.rise/uprightOnce (alle geklemmt, siehe ai.js validatePatch).
Zustands-Klassifikation: fallen (<0.45) | rising (<0.85) | turn | walk | stand (Beiner);
descend/climb/turn/move/hover (Drohne).

## Abbruch & Curriculum (MicroDuck)
- done: upz < 0.45 | gz < 0.045 | gz > 0.45 — ABER: Sturz/Liegend-Start startet jetzt ein
  AUFSGEH-FENSTER (recoverOnFall bei „Liegen lassen", 6–8 s) statt Sofort-Abbruch.
  Fenster-Ende = Episode-Ende; Wieder-oben (upz > 0.85 & gz > 0.065) = normal weiter.
- Aufsteh-Episoden zählen NICHT zum Curriculum-Aufstieg; Level steigt bei EMA ≥ epMax·(0.5+0.07·L),
  sinkt wieder bei EMA < Gate/2 (Selbstkorrektur gegen Instant-Kollaps-Level).



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

## Domain Randomization (v2.11.0, Störungs-Chips; beim Duck = Curriculum-DR)
Masse, Motorstärke, Reibung, Dämpfung, Gravitation, Startpose/-Tempo, IMU-Rauschen,
Schübe (Δv-exakt), Aktions-Verzögerung 0–2 Zyklen. Jede Episode neu gewürfelt, kein Akkumulieren.


## EXPERTEN-/ROUTER-REWARDS PRO ROBOTER (v2.23.0)

Jeder Roboter (g1/duck/x2) hat ein EIGENES Profil: Router (routerBonus für passenden Experten, wrongPenalty für klaren Fehlgriff) + je Experte ein Ergebnis-Bonus (stand: up/quiet · walk: speed · turn: rate · recover: rise/uprightOnce; Drohne analog hover/move/turn/descend). UI: Trainings-Panel → GLB-BEWEGUNG → EXPERTEN → „Belohnungen…". Werkzeug: setExpertR mit Teilobjekt (nur geänderte Felder). Klemmen: Zahlen 0…2/0…3, Persistenz tr_expertR_<robot>. Wirkt sofort (Cache-Refresh). Zusätzlich rW.imit (Gewicht des Lehrers in der Basis-Belohnung, 0,6 Standard) × Lehrer-Slider.