# TRAINING — PPO, Tempo-Slider, Curriculum, Grenzen

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
