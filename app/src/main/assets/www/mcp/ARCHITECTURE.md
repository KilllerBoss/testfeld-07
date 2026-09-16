# ARCHITECTURE — Policy-Netze

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
