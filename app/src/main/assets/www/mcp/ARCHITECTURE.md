# ARCHITECTURE — Policy-Netze

## Soft-MoE-Policy (MicroDuck, MASTER-PROMPT §34) — FIX, 79.969 Parameter
- Shared Encoder 128/128 (tanh) → 4 Soft-Experts (128→64→32: Balance/Walk/Turn/Recovery)
- Soft Router (132→64→4, softmax; Kommando-Vorspülung kPrior=1.2) — kontinuierlich, KEIN hartes Routing
- Motion Manifold 32 D (weiche Expertenmischung) ⊕ Style-Latent 32 D (6 Styles embeddet, nur „neutral" belegt)
- Shared Decoder (64→14); Value-Kopf auf dem Encoder; diagonale Gauß-Policy
- Routing-Glättung ||Δw||² ist Reward-Bestandteil (rW.route); Routing-Stats in Metriken

## MLP-Policy (A1/Spot/Go2/G1/X2)
- 61er-Basis-obs → hidden 64×64 (tanh) → mu+logstd (actDim) + Value-Kopf, ~6–15k Parameter (je actDim)
- Architektur ist hier NICHT zur Laufzeit umkonfigurierbar (ehrlich: kein setArchitecture in v2.13 —
  die Soft-MoE-Struktur ist nach MASTER-PROMPT §34 fest verdrahtet). Konfigurierbar sind: actSpan,
  cmd-Bänder, done-Grenzen, alle Reward-Gewichte, PPO-Hyperparameter, DR, Curriculum-Level.

## Formate
- Policy-JSON fmt: 'trainrobot-ppo-2-moe' (Soft-MoE) bzw. klassisch; PPO.fromAny lädt alt+neu.
- Worker-Snapshot fmt 'softmoe-1' (Parallel-Training serialisiert MoE-Netze generisch).

## Grenzen (nicht versprechen)
- Keine ONNX/INT8-Distillation (Phase später), kein NPU-Zugriff, kein GPU-Batching (MuJoCo-WASM = CPU).
- Mehr Parameter = langsamer auf dem Handy: „mehr Hirn" kostet Schritte/s — immer abwägen.
