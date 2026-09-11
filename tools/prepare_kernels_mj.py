#!/usr/bin/env python3
"""Testfeld·07 — MuJoCo-Kaggle-Kernel (pip mujoco, gleiche MJCFs wie die App).

Erzeugt kernel_mj_duck / kernel_mj_arm / kernel_mj_op3: selbstständige
Script-Dateien, die
  1. mujoco==3.11.0 (die Version aus dem HF-Space) installieren,
  2. die Physik-Meshes von öffentlichen Quellen laden (HF-Space / Menagerie),
  3. die vorbereitete MJCF (eingebettet, identisch zu app/src/main/assets/mjc/)
     kompilieren und
  4. Neuroevolution auf DEMSELBEN Physikkern wie das Gerät fahren,
  5. den Champion als robofield-policy-v1 JSON ausgeben.
"""
import base64
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
KAGGLE = ROOT / "kaggle"
MJC = ROOT / "app" / "src" / "main" / "assets" / "mjc"
USER = "rudolfbewer"

MESH_URLS = {
    "duck": ("https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/main/app/public/robot/mjlab/meshes/",
             ["bottom_head_shell.stl", "hip_l.stl", "jaw.stl", "leg.stl", "np_f970.stl",
              "power_support.stl", "sole_left.stl", "sole_right.stl", "top_head_shell.stl", "tire.stl"]),
    "arm": ("https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/trossen_wx250s/assets/",
            ["wx250s_1_base.stl", "wx250s_2_shoulder.stl", "wx250s_3_upper_arm.stl",
             "wx250s_4_upper_forearm.stl", "wx250s_5_lower_forearm.stl", "wx250s_6_wrist.stl",
             "wx250s_7_gripper.stl", "wx250s_8_gripper_prop.stl", "wx250s_9_gripper_bar.stl",
             "wx250s_10_gripper_finger.stl"]),
    "op3": ("https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/robotis_op3/assets/simplified_convex/",
            ["body.stl", "body_sub1.stl", "body_sub2.stl", "body_sub3.stl", "body_sub4.stl",
             "h1.stl", "h2.stl", "h2_sub1.stl", "h2_sub2.stl",
             "ll1.stl", "ll2.stl", "ll3.stl", "ll4.stl", "ll5.stl", "ll6.stl",
             "rl1.stl", "rl2.stl", "rl3.stl", "rl4.stl", "rl5.stl", "rl6.stl",
             "la1.stl", "la2.stl", "la3.stl", "ra1.stl", "ra2.stl", "ra3.stl"]),
}
OP3_RENAME = {"body": "body", "body_sub1": "body_sub1", "body_sub2": "body_sub2",
              "body_sub3": "body_sub3", "body_sub4": "body_sub4"}

HEADER = '''# Testfeld·07 — MuJoCo-Training auf Kaggle ({label})
# Gleicher Physikkern wie die App: mujoco 3.11.0 + die vorbereitete MJCF
# (Menagerie/HF-Space) + Neuroevolution wie On-Device (Ghost-Spiegel).
# Ausgabe: robofield-policy-v1 Champion-JSON (Kaggle-Output).
import base64, io, math, os, subprocess, sys, zipfile
import numpy as np

def _ensure(pkg, ver=None):
    try:
        __import__(pkg)
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q'] + ([pkg + '==' + ver] if ver else [pkg]), check=True)

_ensure('mujoco', '3.11.0')
import mujoco

print('mujoco', mujoco.__version__, flush=True)
'''

ASSET_DL = '''
# ---------- Assets: Meshes von öffentlichen Quellen, MJCF eingebettet ----------
import urllib.request

URL_BASE = {url!r}
FILES = {files!r}
RENAME = {rename!r}

os.makedirs('assets', exist_ok=True)
for f in FILES:
    dst = os.path.join('assets', RENAME.get(f[:-4], f) + '.stl')
    if os.path.exists(dst):
        continue
    urllib.request.urlretrieve(URL_BASE + f, dst)
    print('mesh:', dst, os.path.getsize(dst) // 1024, 'KB', flush=True)

XML = base64.b64decode({xml_b64!r}).decode('utf-8')
with open('model.xml', 'w') as fh:
    fh.write(XML)
model = mujoco.MjModel.from_xml_path('model.xml')
print('MJCF kompiliert: nq', model.nq, 'nv', model.nv, 'nu', model.nu, flush=True)
'''

FOOTER = '''
# ---------- Training ----------
champ, champ_fit, history = train(model, Ghost, GENS, seed={seed}, pop_size=40)
policy = genome_to_policy(ROBOT, ARCH, champ, GENS, champ_fit)
with open(OUT, 'w') as fh:
    json.dump(policy, fh)
print('CHAMPION gesichert:', OUT, 'fit', round(champ_fit, 1), 'gen', GENS, flush=True)
'''

CFG = {
    "duck": dict(label="Microduck (HF-Space-Modell)", xml="duck_legs.xml", robot="duckmj",
                 arch=[61, 32, 32, 14], ghost="GhostDuckMj", gens=200, seed=4701, out="robofield-duckmj-kaggle.json"),
    "arm": dict(label="WidowX 250 6DOF (Menagerie)", xml="wx250s.xml", robot="armmj",
                arch=[16, 32, 32, 7], ghost="GhostArmMj", gens=200, seed=4702, out="robofield-armmj-kaggle.json"),
    "op3": dict(label="ROBOTIS OP3 (Menagerie)", xml="op3.xml", robot="op3mj",
                arch=[46, 32, 32, 20], ghost="GhostHumMj", gens=200, seed=4703, out="robofield-op3mj-kaggle.json"),
}

COMMON_SRC = (KAGGLE / "mujoco_common.py").read_text(encoding="utf-8")


def build(key):
    cfg = CFG[key]
    xml_b64 = base64.b64encode((MJC / cfg["xml"]).read_bytes()).decode("ascii")
    url, files = MESH_URLS[key]
    rename = {f[:-4]: "op3c_" + f[:-4] for f in files} if key == "op3" else {}
    src = HEADER.format(label=cfg["label"])
    src += ASSET_DL.format(url=url, files=files, rename=rename, xml_b64=xml_b64)
    # mujoco_common ohne Header-Importzeilen einbetten (NumPy ist da, math/json via Header)
    common = "\n".join(
        ln for ln in COMMON_SRC.splitlines()
        if not ln.startswith(("import json", "import math", "import numpy as np"))
        and not ln.startswith("# Testfeld·07") and not ln.startswith("#") or ln.startswith("# ")
    )
    # Einfacher: komplette Datei, Duplikat-Imports sind harmlos.
    common = COMMON_SRC.split('import json\n', 1)[-1]
    src += "\n\n" + common
    src += f"\n\nGhost = {cfg['ghost']}\nROBOT = '{cfg['robot']}'\nARCH = {cfg['arch']}\n"
    src += f"GENS = {cfg['gens']}\nOUT = '{cfg['out']}'\n"
    src += FOOTER.format(seed=cfg["seed"])

    kdir = KAGGLE / f"kernel_mj_{key}"
    kdir.mkdir(parents=True, exist_ok=True)
    (kdir / "train_mj.py").write_text(src, encoding="utf-8")
    meta = {
        "id": f"{USER}/testfeld07-mj-{key}",
        "title": "Testfeld07-Mj-" + key.capitalize(),
        "code_file": "train_mj.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": "true",
        "enable_gpu": "false",
        "enable_internet": "true",
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
    }
    (kdir / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"{kdir.name}: {len(src) // 1024} KB (+MJCF eingebettet), {len(files)} Mesh-URLs")


def main():
    for key in ("duck", "arm", "op3"):
        build(key)


if __name__ == "__main__":
    main()
