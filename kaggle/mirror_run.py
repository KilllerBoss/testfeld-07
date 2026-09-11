#!/usr/bin/env python3
"""Mirror-Runner (Python): <robot> <seed> <steps> <genomeSeed>
Exakt derselbe Lauf wie tests/mirror_run.js — für den Determinismus-Vergleich."""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from robofield_common import ARCHS, init_genome, forward_single
from robofield_envs import SCALAR

robot, seed, steps, genome_seed = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
env = SCALAR[robot](seed)
n_act = ARCHS[robot][3]
genome = init_genome(genome_seed, ARCHS[robot][0], n_act)
done = False
for _ in range(steps):
    if done:
        break
    a = forward_single(genome, np.array(env.get_obs()), n_act)
    if robot == "duck":
        _, done = env.step(a[0], a[1])
    elif robot == "arm":
        _, done = env.step(a[0], a[1], a[2], a[3], a[4])
    else:
        _, done = env.step(a)
out = {
    "fit": env.fit,
    "steps": env.steps,
    "reached": getattr(env, "reached", getattr(env, "delivered", 0)),
    "obs": [float(x) for x in env.get_obs()],
}
print(json.dumps(out))
