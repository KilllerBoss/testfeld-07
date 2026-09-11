#!/usr/bin/env python3
"""Baut die drei Kaggle-Kernel-Verzeichnisse (train_<robot>.py + Spiegel +
kernel-metadata.json). Private Kernel, CPU reicht, Internet aus."""
import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
KAGGLE = ROOT / "kaggle"
USER = "rudolfbewer"

FILES = ["train_duck.py", "train_arm.py", "train_humanoid.py",
         "robofield_common.py", "robofield_envs.py", "trainer.py"]

for robot in ["duck", "arm", "humanoid"]:
    d = KAGGLE / f"kernel_{robot}"
    d.mkdir(exist_ok=True)
    for f in FILES:
        shutil.copy2(KAGGLE / f, d / f)
    meta = {
        "id": f"{USER}/testfeld07-{robot}",
        "title": f"testfeld07-{robot}",
        "code_file": f"train_{robot}.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        "enable_gpu": False,
        "enable_internet": False,
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (d / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"OK: {d}")
