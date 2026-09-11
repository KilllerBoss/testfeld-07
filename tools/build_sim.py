#!/usr/bin/env python3
"""Trainrobot — Sim-Asset-Verifier/Installer.

Seit v2.0.0 ist der Sim-Kern der OFFIZIELLE microduck-simulator
(pollen-robotics/microduck-simulator, Vite/React + MuJoCo-WASM +
onnxruntime-web), gebaut nach sim/PATCHES.md der Referenz-App:

  Patch 1: walk-Skill = microduck_rough_v2.onnx (eigene Kaggle-Policy)
  Patch 2: ?noghosts schaltet Multiplayer ab (offline App)
  Flags:   ?boot=1&touch=1&noghosts beim Laden in SimActivity

Der fertige dist-Build liegt GECOMMITET unter app/src/main/assets/sim/.
Dieses Skript verifiziert die Integrität (CI-safe, kein Netz nötig) und
kann mit --install <dist-dir> einen (neu)gebauten Dist installieren.
"""
import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIM = ROOT / "app" / "src" / "main" / "assets" / "sim"
BRIDGE = ROOT / "app" / "src" / "main" / "assets" / "md_bridge.js"

REQUIRED = [
    "index.html",
    "policies/microduck_rough_v2.onnx",
    "policies/BEST_alpha_walking.onnx",
    "robot/mjlab/microduck.glb",
    "robot/mjlab/robot_allcollisions.xml",
]


def check(cond: bool, msg: str, errors: list) -> None:
    print(("  OK  " if cond else "  FAIL") + " " + msg)
    if not cond:
        errors.append(msg)


def verify() -> int:
    errors: list = []
    print(">> Verifiziere offiziellen Sim-Dist:", SIM)
    for rel in REQUIRED:
        check((SIM / rel).is_file(), f"vorhanden: {rel}", errors)

    wasm = sorted(SIM.rglob("*.wasm"))
    check(any(f.name.startswith("mujoco") for f in wasm), "MuJoCo-WASM vorhanden", errors)
    check(any(f.name.startswith("ort-wasm") for f in wasm), "onnxruntime-WASM vorhanden", errors)
    for f in wasm:
        magic = f.read_bytes()[:4]
        check(magic == b"\x00asm", f"wasm-Magic: {f.name}", errors)

    app_bundles = list((SIM / "bundle").glob("App-*.js"))
    check(bool(app_bundles), "App-Bundle vorhanden", errors)
    if app_bundles:
        src = "".join(p.read_text(encoding="utf-8", errors="ignore") for p in app_bundles)
        check("microduck_rough_v2" in src,
              "Patch 1: walk-Skill = microduck_rough_v2.onnx", errors)
        check("noghosts" in src, "Patch 2: ?noghosts-Multiplayer-Abschaltung", errors)

    check(BRIDGE.is_file(), "md_bridge.js in Assets", errors)
    if BRIDGE.is_file():
        b = BRIDGE.read_text(encoding="utf-8")
        check("addSource" in b and "GeminiSource" in b,
              "Bridge: GeminiSource via rl.controller.addSource", errors)
        check("__mdGetState" in b, "Bridge: __mdGetState", errors)

    print(">> " + ("GRÜN — offizieller Dist intakt" if not errors
                  else f"ROT — {len(errors)} Fehler"))
    return 0 if not errors else 1


def install(src: pathlib.Path) -> int:
    import shutil
    if not (src / "index.html").is_file():
        print("!! Kein index.html in", src, "— ist das ein Vite dist?")
        return 2
    import shutil as _sh
    if SIM.exists():
        _sh.rmtree(SIM)
    shutil.copytree(src, SIM)
    print(">> Dist installiert:", SIM)
    return verify()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--install", metavar="DIST_DIR", help="neuen Vite-dist installieren")
    args = ap.parse_args()
    if args.install:
        sys.exit(install(pathlib.Path(args.install).resolve()))
    sys.exit(verify())
