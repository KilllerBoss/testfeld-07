#!/usr/bin/env python3
"""Trainrobot ROBOLAB-Build: baut robo/ (ARMBOT + HUMANOID, MJ-only) zu einer
einzelnen assets/robo/index.html und spiegelt die mjc-Assets in die APK-Assets.

- JS_ORDER ohne envs.js (kein Werkstatt-Kern, kein Fallback)
- Builtin-Champions: robo/policies/*.json (robofield-policy-v1) → TF07.BUILTIN_POLICIES
- TF07.BUILD = {version, id} aus app/build.gradle + Git-Hash
- Kein ORT/ONNX mehr im Robo-Zweig — nur MuJoCo-WASM.
"""
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "robo" / "src"
ROBO = ROOT / "robo"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT_DIR = ASSETS / "robo"
OUT_MJC = OUT_DIR / "mjc"

JS_ORDER = ["rng.js", "nn.js", "console.js", "render.js", "views.js", "ui.js", "mjc.js", "app.js"]


def build_id() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "dev"


def app_version() -> str:
    gradle = (ROOT / "app" / "build.gradle").read_text(encoding="utf-8")
    m = re.search(r'versionName\s+"([^"]+)"', gradle)
    return m.group(1) if m else "0.0.0"


def main():
    template = (ROBO / "template.html").read_text(encoding="utf-8")
    css = (ROBO / "style.css").read_text(encoding="utf-8")

    js_parts = []
    for name in JS_ORDER:
        code = (SRC / name).read_text(encoding="utf-8")
        js_parts.append(f"/* ======== {name} ======== */\n{code}")
    js = "\n\n".join(js_parts)

    # Eingebaute Champions (armmj/op3mj, robofield-policy-v1)
    builtin = {}
    builtin_dir = ROBO / "policies"
    for f in sorted(builtin_dir.glob("*.json")):
        try:
            p = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(p, dict) and p.get("format") == "robofield-policy-v1":
                builtin[p.get("robot", f.stem)] = p
        except Exception as e:
            print(f"WARN: builtin-Policy {f.name} übersprungen: {e}")
    assert builtin, "KEINE Builtin-Champions gefunden — robo/policies prüfen"
    js += ("\n\n/* ======== eingebaute Champions ======== */\n"
           + "TF07.BUILTIN_POLICIES = " + repr(builtin).replace("'", '"') + ";\n")

    ver, gid = app_version(), build_id()
    js += (f"\n\n/* ======== Build-Kennung ======== */\n"
           f"TF07.BUILD = {{ version: '{ver}', id: '{gid}' }};\n")
    print(f"  build: v{ver} · {gid}")
    for r, p in builtin.items():
        print(f"  eingebaut: {r} (gen {p.get('gen')}, fit {round(p.get('fit', 0), 1)}, src {p.get('src')})")

    # Erwartungsprüfungen: kein Duck/ORT/Werkstatt mehr im Robo-Bundle
    low = js.lower()
    for bad in ("duckenv", "armenv", "humanoidenv", "makeenv", "ort.glue", "ort.global",
                "onnxruntime", "inferencesession", "werkstatt-fallback bleibt"):
        assert bad not in low, f"Robo-Bundle enthält '{bad}' — Surgery unvollständig"

    assert "</script" not in js.lower(), "JS enthält </script> — nicht inline-fähig"
    html = template.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"OK: {out} ({out.stat().st_size / 1024:.1f} KB)")

    # mjc-Assets spiegeln (Modelle, Meshes, Manifeste, mujoco.wasm + glue)
    OUT_MJC.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in (ROBO / "mjc").iterdir():
        if f.is_file():
            (OUT_MJC / f.name).write_bytes(f.read_bytes())
            n += 1
    print(f"OK: {n} mjc-Assets → {OUT_MJC}")


if __name__ == "__main__":
    main()
