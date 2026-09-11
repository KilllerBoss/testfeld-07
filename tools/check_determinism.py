#!/usr/bin/env python3
"""Determinismus-Beweis: JS-Env (Node) vs. NumPy-Spiegel.
Vorgabe AGENT.md: gleicher Seed → gleicher Reward. Toleranz 1e-6 (real ~1e-12)."""
import json
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KAGGLE = os.path.join(ROOT, "kaggle")
CASES = [
    ("duck", 42, 300, 123),
    ("duck", 7, 600, 999),
    ("arm", 42, 300, 123),
    ("arm", 9, 450, 55),
    ("humanoid", 42, 300, 123),
    ("humanoid", 5, 600, 77),
]

def run_js(robot, seed, steps, gseed):
    out = subprocess.run(["node", os.path.join(ROOT, "tests", "mirror_run.js"),
                          robot, str(seed), str(steps), str(gseed)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])

def run_py(robot, seed, steps, gseed):
    out = subprocess.run([sys.executable, os.path.join(KAGGLE, "mirror_run.py"),
                          robot, str(seed), str(steps), str(gseed)],
                         capture_output=True, text=True, check=True,
                         cwd=KAGGLE)
    return json.loads(out.stdout.strip().splitlines()[-1])

fails = 0
print("Roboter    Seed  Steps   |  fit JS            fit Python         |diff|        Reached")
print("-" * 100)
for (robot, seed, steps, gseed) in CASES:
    a = run_js(robot, seed, steps, gseed)
    b = run_py(robot, seed, steps, gseed)
    d = abs(a["fit"] - b["fit"])
    ok = d < 1e-6 and a["steps"] == b["steps"] and a["reached"] == b["reached"]
    od = max(abs(x - y) for x, y in zip(a["obs"], b["obs"]))
    status = "OK " if ok and od < 1e-6 else "FAIL"
    if not (ok and od < 1e-6):
        fails += 1
    print(f"{status} {robot:9s} {seed:4d} {steps:5d} | {a['fit']:17.12f} {b['fit']:17.12f} | {d:.2e}  {a['reached']}  (obsMaxDiff {od:.2e})")
print("-" * 100)
print("ALLE IDENTISCH" if fails == 0 else f"{fails} FEHLER")
sys.exit(1 if fails else 0)
