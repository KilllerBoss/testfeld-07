#!/usr/bin/env python3
"""Baut die drei Kaggle-Kernel-Verzeichnisse.

Kaggle führt bei Script-Kerneln NUR die code_file aus — deshalb werden
robofield_common.py + robofield_envs.py + trainer.py + train_<robot>.py
zu EINER self-contained Datei zusammengebacken (Imports werden entfernt).
Private Kernel, CPU reicht, Internet aus."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
KAGGLE = ROOT / "kaggle"
USER = "rudolfbewer"

MODULES = ["robofield_common.py", "robofield_envs.py", "trainer.py"]
DROP_STARTS = ("from robofield_common import", "from robofield_envs import",
               "from trainer import", "import numpy as np", "import math")

def strip_imports(src):
    """Entfernt Modul-Importe (auch mehrzeilig in Klammern) — alles ist
    danach in EINER Datei; der Header liefert math/numpy."""
    out = []
    skip_paren = False
    for line in src.splitlines():
        if skip_paren:
            if ")" in line:
                skip_paren = False
            continue
        st = line.lstrip()
        if st.startswith(DROP_STARTS):
            if "(" in line and ")" not in line:
                skip_paren = True
            continue
        out.append(line)
    return "\n".join(out)

def build(robot):
    parts = [
        "# " + "=" * 74,
        "# Testfeld·07 — SELF-CONTAINED Kaggle-Kernel: " + robot.upper(),
        "# Automatisch gebaut von tools/prepare_kernels.py — NICHT von Hand editieren.",
        "# Quelle: kaggle/robofield_common.py, robofield_envs.py, trainer.py,",
        "#         train_" + robot + ".py",
        "# " + "=" * 74,
        "",
        "import math",
        "import json",
        "import sys",
        "import numpy as np",
        "",
    ]
    for m in MODULES:
        src = (KAGGLE / m).read_text(encoding="utf-8")
        parts.append("# ---- aus " + m + " ----")
        parts.append(strip_imports(src))
        parts.append("")
    wrapper = (KAGGLE / f"train_{robot}.py").read_text(encoding="utf-8")
    wrapper = strip_imports(wrapper)
    wrapper = re.sub(r"\n{3,}", "\n\n", wrapper)
    parts.append("# ---- train_" + robot + ".py (Hauptteil) ----")
    parts.append(wrapper)
    out = KAGGLE / f"kernel_{robot}" / f"train_{robot}.py"
    out.write_text("\n".join(parts), encoding="utf-8")
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
    (KAGGLE / f"kernel_{robot}" / "kernel-metadata.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8")
    print(f"OK: {out} ({out.stat().st_size/1024:.1f} KB, self-contained)")

if __name__ == "__main__":
    for robot in ["duck", "arm", "humanoid"]:
        build(robot)
