# Testfeld·07 — Kaggle-Training: HUMANOID
# Läuft auf Kaggle (CPU reicht) und lokal. Ergebnis: policy.json
# (robofield-policy-v1) im Kernel-Output.
#
# Lokal:  python train_duck.py --gens 120 --seed 42
# Kaggle: GENS unten anpassen oder via Parameter-Args setzen.
import json
import sys

import numpy as np

from robofield_common import genome_to_policy_json
from trainer import train

GENS = 200      # Zielvorgabe des Nutzers: erst 200 Generationen
SEED = 42
OUT = "policy.json"


def main():
    gens = GENS
    args = sys.argv[1:]
    if "--gens" in args:
        gens = int(args[args.index("--gens") + 1])
    print(f"== TESTFELD·07 Training: HUMANOID, {gens} Generationen, Pop 40, MLP 2×32 tanh ==", flush=True)
    champ, fit, history = train("humanoid", gens=gens, seed=SEED)
    js = genome_to_policy_json(champ, "humanoid", gens, fit, "kaggle")
    with open(OUT, "w") as f:
        f.write(js)
    # Fitnesskurve als CSV beilegen (Gen, best, avg)
    with open("fitness.csv", "w") as f:
        f.write("gen,best,avg\n")
        for (g, b, a) in history:
            f.write(f"{g},{b},{a}\n")
    print(f"FERTIG: fit={fit:.3f} nach {gens} Generationen → {OUT}", flush=True)
    # Kurz-Validierung gegen das App-Archiv
    p = json.loads(js)
    assert p["arch"] == [10, 32, 32, 5] and len(p["weights"]) == 6
    print(f"Validierung: arch {p['arch']}, 6 Tensoren — OK", flush=True)


if __name__ == "__main__":
    main()
