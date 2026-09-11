#!/usr/bin/env python3
"""Testfeld·07 — Sim-Build: inlined alle Module in EINE assets/index.html
(komplette Sim in einer Datei, offline-fähig — Vorgabe AGENT.md).
Erzeugt zusätzlich download/testfeld07-preview.html für den Desktop-Test."""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "sim" / "src"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
DOWNLOAD = ROOT.parent / "download"


def build_id() -> str:
    """Git-Kurz-Hash als sichtbare Build-Kennung (Badge/BIOS/Konsole)."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "dev"


def app_version() -> str:
    """versionName aus app/build.gradle (eine Quelle der Wahrheit)."""
    gradle = (ROOT / "app" / "build.gradle").read_text(encoding="utf-8")
    m = re.search(r'versionName\s+"([^"]+)"', gradle)
    return m.group(1) if m else "0.0.0"

JS_ORDER = ["rng.js", "nn.js", "envs.js", "console.js", "render.js", "views.js", "ui.js", "mjc.js", "app.js"]

# MuJoCo/ORT-Glue für klassische <script>-Tags aufbereiten (kein ESM in
# der WebView von file:// aus):
MUJOCO_SRC = ROOT.parent / "reference" / "pkg" / "mujoco311" / "mujoco.js"
ORT_SRC = ROOT.parent / "reference" / "pkg" / "ort127" / "ort.min.js"
ORT_MJS_SRC = ROOT.parent / "reference" / "pkg" / "ort127" / "ort-wasm-simd-threaded.mjs"


def wrap_ort_mjs() -> str:
    """ORT-WASM-Glue (ESM) → klassisches Skript mit globaler Factory.
    Top-Level-await/if(isNode)-Block neutralisieren, import.meta ersetzen."""
    code = ORT_MJS_SRC.read_text(encoding="utf-8")
    code = code.replace("import.meta.url", '"https://tf07.invalid/ort.mjs"').replace("import.meta", '{url:"https://tf07.invalid/ort.mjs"}')
    # Node-Zweig mit Top-Level-Await entfernen (im Browser toter Code,
    # aber klassische Scripts verzeugen sonst einen SyntaxError)
    import re as _re
    code = _re.sub(r'if\(isNode\)isPthread=\(await import\("worker_threads"\)\)\.workerData==="em-pthread";', 'if(isNode)throw new Error("TF07: Node-Zweig im Browser?");', code)
    code = _re.sub(r'export default (\w+);', r'globalThis.TF07_ortWasmThreaded = \1;', code)
    code = _re.sub(r'export\{[^}]*\};?', '', code)
    return code + '\n;globalThis.__tf07OrtImport = function () { return Promise.resolve({ default: globalThis.TF07_ortWasmThreaded }); };\n'


def wrap_mujoco_js() -> str:
    code = MUJOCO_SRC.read_text(encoding="utf-8")
    # import.meta ist in klassischen Scripts ein SyntaxError — auch wenn
    # es nie ausgeführt wird. Ersatz: gültige absolute URL (wird nie
    # gefetcht, da wir immer wasmBinary übergeben).
    code = code.replace("import.meta.url", '"https://tf07.invalid/mjc/mujoco.wasm"').replace("import.meta", '{url:"https://tf07.invalid/mjc/mujoco.wasm"}')
    code = code.replace("export default loadMujoco;", "globalThis.TF07_loadMujoco = loadMujoco;")
    return code


def wrap_ort_js() -> str:
    code = ORT_SRC.read_text(encoding="utf-8")
    # Einzige dynamische Import-Stelle auf unseren Hook umleiten (die
    # Factory kommt aus ort.glue.js als klassisches Script — kein ESM,
    # kein Fetch, file://-fest in der WebView)
    old = "await import(/*webpackIgnore:true*/ /*@vite-ignore*/e)"
    if old not in code:
        raise SystemExit("ORT-import-Site nicht gefunden — Bundle-Schema geändert?")
    code = code.replace(old, "await globalThis.__tf07OrtImport(e)")
    code += "\n;globalThis.ort = (typeof ort !== 'undefined') ? ort : globalThis.ort;\n"
    return code

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
    # Sichtbare Build-Kennung: Badge im Topbar (MUJOCO v1.1.0·abc1234),
    # BIOS-Zeile und Konsole („version") lesen TF07.BUILD.
    ver, gid = app_version(), build_id()
    js += (f"\n\n/* ======== Build-Kennung ======== */\n"
           f"TF07.BUILD = {{ version: '{ver}', id: '{gid}' }};\n")
    print(f"  build: v{ver} · {gid}")
    if builtin:
        for r, p in builtin.items():
            print(f"  eingebaut: {r} (gen {p.get('gen')}, fit {round(p.get('fit',0),1)}, src {p.get('src')})")
    # </script> im JS-Code würde das Inline-Script brechen — absichern:
    assert "</script" not in js.lower(), "JS enthält </script> — nicht inline-fähig"
    html = template.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
    ASSETS.mkdir(parents=True, exist_ok=True)
    out1 = ASSETS / "index.html"
    out1.write_text(html, encoding="utf-8")
    # MuJoCo/ORT-Glue in assets/mjc/ (klassische Scripts) — nur wenn Quellen existieren
    if MUJOCO_SRC.exists() and ORT_SRC.exists():
        (ASSETS / "mjc").mkdir(parents=True, exist_ok=True)
        (ASSETS / "mjc" / "mujoco.wrapped.js").write_text(wrap_mujoco_js(), encoding="utf-8")
        (ASSETS / "mjc" / "ort.glue.js").write_text(wrap_ort_mjs(), encoding="utf-8")
        (ASSETS / "mjc" / "ort.global.js").write_text(wrap_ort_js(), encoding="utf-8")
        print(f"  glue: mujoco.wrapped.js ({len(wrap_mujoco_js())//1024} KB), ort.glue.js, ort.global.js")
    DOWNLOAD.mkdir(parents=True, exist_ok=True)
    out2 = DOWNLOAD / "testfeld07-preview.html"
    out2.write_text(html, encoding="utf-8")
    print(f"OK: {out1} ({out1.stat().st_size/1024:.1f} KB)")
    print(f"OK: {out2} ({out2.stat().st_size/1024:.1f} KB)")

if __name__ == "__main__":
    main()
