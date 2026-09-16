# TRAINING — PPO, Parallel, Curriculum, Grenzen

## Ablauf
- Rollout 50 Hz → Buffer T (1024–8192) → GAE(γ 0.99, λ 0.95) → PPO-Update (4 Epochen, lr 3e-4, clip 0.2)
- Tempo MAX = ParallelTrainer: N Web Worker (echtes MuJoCo-WASM je Worker, eigene DR-Würfe),
  on-policy Runden-Sync ohne Staleness, mergeSegments + EIN gemeinsames Update im Haupt-Thread
- „Liegen lassen" + MicroDuck: Aufsteh-Fenster (s. REWARDS) — Episoden sind nicht mehr 1 Schritt lang

## Curriculum MicroDuck (duckLevel 1–5, automatisch)
- L1 flach (kein DR, vx 0.10, span 0.16) → L5 kombiniert (starkes DR, vx 0.30, span 0.35)
- Aufstieg: 10 Episoden-Gate, EMA ≥ epMax·(0.5+0.07·L); Abstieg: EMA < Gate/2
- Persistiert (tr_duck_lvl); KI kann duckLevel setzen

## Ehrliche Grenzen (nicht verschweigen)
- Handy-CPU: Duck-Soft-MoE ~400–800 Schritte/s inline (Node-Referenz 985/s) — Skill-Emergenz
  braucht 10^6+ Schritte = Geräte-Zeit/Nächte. Kleine Schritte, Level langsam hoch.
- Kamera ist kein Input; kein ONNX-Export; kein GPU/NPU-Training.
- Nach setArchitecture-ähnlichen Wünschen (nicht verfügbar): ehrlich sagen, dass die
  MoE-Struktur fix ist (§34), und stattdessen Rewards/DR/Curriculum tunen.
