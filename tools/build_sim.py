#!/usr/bin/env python3
"""Testfeld·07 — Sim-Build: inlined alle Module in EINE assets/index.html
(komplette Sim in einer Datei, offline-fähig — Vorgabe AGENT.md).
Erzeugt zusätzlich download/testfeld07-preview.html für den Desktop-Test."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "sim" / "src"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
DOWNLOAD = ROOT.parent / "download"

JS_ORDER = ["rng.js", "nn.js", "envs.js", "console.js", "render.js", "views.js", "ui.js", "app.js"]

def main():
    template = (ROOT / "sim" / "template.html").read_text(encoding="utf-8")
    css = (ROOT / "sim" / "style.css").read_text(encoding="utf-8")
    js_parts = []
    for name in JS_ORDER:
        code = (SRC / name).read_text(encoding="utf-8")
        js_parts.append(f"/* ======== {name} ======== */\n{code}")
    js = "\n\n".join(js_parts)
    # Eingebaute Champions (Werks-Policies, z. B. von Kaggle) injizieren
    builtin_dir = ROOT / "policies" / "builtin"
    builtin = {}
    if builtin_dir.is_dir():
        for f in sorted(builtin_dir.glob("*.json")):
            try:
                import json as _json
                p = _json.loads(f.read_text(encoding="utf-8"))
                if isinstance(p, dict) and p.get("format") == "robofield-policy-v1":
                    builtin[p.get("robot", f.stem)] = p
            except Exception as e:
                print(f"WARN: builtin-Policy {f.name} übersprungen: {e}")
    js += ("\n\n/* ======== eingebaute Champions ======== */\n"
           + "TF07.BUILTIN_POLICIES = " + repr(builtin).replace("'", '"') + ";\n")
    if builtin:
        for r, p in builtin.items():
            print(f"  eingebaut: {r} (gen {p.get('gen')}, fit {round(p.get('fit',0),1)}, src {p.get('src')})")
    # </script> im JS-Code würde das Inline-Script brechen — absichern:
    assert "</script" not in js.lower(), "JS enthält </script> — nicht inline-fähig"
    html = template.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
    ASSETS.mkdir(parents=True, exist_ok=True)
    out1 = ASSETS / "index.html"
    out1.write_text(html, encoding="utf-8")
    DOWNLOAD.mkdir(parents=True, exist_ok=True)
    out2 = DOWNLOAD / "testfeld07-preview.html"
    out2.write_text(html, encoding="utf-8")
    print(f"OK: {out1} ({out1.stat().st_size/1024:.1f} KB)")
    print(f"OK: {out2} ({out2.stat().st_size/1024:.1f} KB)")

if __name__ == "__main__":
    main()
