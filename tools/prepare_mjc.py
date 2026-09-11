#!/usr/bin/env python3
"""Testfeld·07 — MuJoCo-Asset-Vorbereitung (echter Physics-Kern wie im HF-Space).

Erzeugt aus den Original-Assets des Spaces pollen-robotics/microduck-simulator:
  - gestrippte MJCF (Kollisions-Meshes behalten, Visuals entfernt, Boden/Wände/
    Ball/STAND-Keyframe injiziert — identisch zu game.js buildPhysicsXml)
  - Kollisions-Meshes (.stl) für die VFS
  - 9 fertige ONNX-Policies (Werksmodelle)
  - @mujoco/mujoco 3.11.0 (mujoco.js + mujoco.wasm) und onnxruntime-web 1.27.0
Layout: app/src/main/assets/mjc/... (liegen neben index.html, offline in der APK).
"""
import pathlib
import shutil
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
REF = ROOT.parent / "reference" / "microduck"
PKG = ROOT.parent / "reference" / "pkg"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT = ASSETS / "mjc"

TIMESTEP = "0.005"
ARENA_HALF = 1.5
SPAWN_X, SPAWN_Y = -1.5 + 1.5 * 0.6, 0.0  # = -0.6 (2. Reihe von hinten, Mitte)
BALL_PARK = "50 0 0.05"
BALL_R = 0.05
DEFAULT_POSE = [
    0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
    0.3490658503988659, 0.3490658503988659, 0, 0,
    0, 0.08726646259971647, 0.457924, 0.004940, -0.452984,
]
POLICIES = [
    "BEST_alpha_walking.onnx", "BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx",
    "BEST_roller.onnx", "BEST_roller_crouch.onnx", "roulade.onnx",
    "alpha_ground_pick.onnx", "ball_kick_left.onnx", "ball_kick_right.onnx",
]


def prep_xml(src: pathlib.Path, dst: pathlib.Path) -> list:
    """Visual-Geoms/Meshes strippen, Szene injizieren — Reihenfolge und Werte
    exakt wie game.js buildPhysicsXml. Rückgabe: benötigte Mesh-Dateien."""
    tree = ET.parse(src)
    root = tree.getroot()
    # 1) Visual-Geoms raus (Dynamik-neutral: contype=0 conaffinity=0)
    for g in list(root.iter("geom")):
        if g.get("class") == "visual":
            g.getparent() if hasattr(g, "getparent") else None
    # ElementTree kennt getparent() nicht → über Eltern-Map arbeiten
    parent_map = {c: p for p in root.iter() for c in p}
    for g in [g for g in root.iter("geom") if g.get("class") == "visual"]:
        parent_map[g].remove(g)
    # 2) Ungenutzte Mesh-Assets raus
    used = {g.get("mesh") for g in root.iter("geom") if g.get("mesh")}
    meshes_elem = root.find("asset")
    need_files = []
    for m in list(meshes_elem.findall("mesh")):
        name = m.get("name") or (m.get("file", "").removesuffix(".stl"))
        if name not in used:
            meshes_elem.remove(m)
        else:
            need_files.append(m.get("file") or (name + ".stl"))
    # 3) Szene injizieren (Reihenfolge wie game.js)
    def el(tag, attrs):
        e = ET.Element(tag)
        for k, v in attrs.items():
            e.set(k, str(v))
        return e

    root.append(el("option", {"timestep": TIMESTEP}))
    wb = root.find("worldbody")
    wb.append(el("geom", {"name": "floor", "type": "plane", "size": "0 0 0.05", "pos": "0 0 0"}))
    ht, hh = 0.05 / 2, 0.25 / 2
    off, span = ARENA_HALF + ht, ARENA_HALF + 0.05
    for name, pos, size in [
        ("wall_px", f"{off} 0 {hh}", f"{ht} {span} {hh}"),
        ("wall_nx", f"{-off} 0 {hh}", f"{ht} {span} {hh}"),
        ("wall_py", f"0 {off} {hh}", f"{span} {ht} {hh}"),
        ("wall_ny", f"0 {-off} {hh}", f"{span} {ht} {hh}"),
    ]:
        wb.append(el("geom", {"name": name, "type": "box", "pos": pos, "size": size}))
    ball = el("body", {"name": "ball", "pos": BALL_PARK})
    ball.append(el("freejoint", {"name": "ball_freejoint"}))
    ball.append(el("geom", {
        "name": "ball_geom", "type": "sphere", "size": str(BALL_R), "mass": "0.03",
        "friction": "0.4 0.01 0.003", "solref": "0.03 0.4", "condim": "6",
    }))
    wb.append(ball)
    # STAND-Keyframe: Freejoint + alle Joints in Dokument-Reihenfolge + Ball
    pose_by_name = dict(zip(
        ["left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
         "neck_pitch", "head_pitch", "head_yaw", "head_roll",
         "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle"],
        DEFAULT_POSE))
    qpos_joints = " ".join(
        str(pose_by_name.get(j.get("name"), 0)) for j in root.iter("joint")
        if j.get("name") in pose_by_name or True)
    #Alle body>joint in Doku-Reihenfolge (Ball-Joint ist <freejoint>, nicht <joint>)
    qpos_joints = " ".join(
        str(pose_by_name.get(j.get("name"), 0))
        for b in wb.findall("body") for j in b.findall("joint"))
    kf = ET.Element("keyframe")
    kf.append(el("key", {
        "name": "STAND",
        "qpos": f"{SPAWN_X} {SPAWN_Y} 0.12 1 0 0 0 {qpos_joints} {BALL_PARK} 1 0 0 0",
        "ctrl": " ".join(str(v) for v in DEFAULT_POSE),
    }))
    root.append(kf)
    ET.indent(tree, space="  ")
    tree.write(dst, encoding="unicode", xml_declaration=False)
    return sorted(set(need_files))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "meshes").mkdir(exist_ok=True)
    (OUT / "policies").mkdir(exist_ok=True)

    all_files = set()
    for src, dst_name in [
        (REF / "robot/mjlab/robot_allcollisions.xml", "duck_legs.xml"),
        (REF / "robot/mjlab/robot_allcollisions_rollers.xml", "duck_rollers.xml"),
    ]:
        dst = OUT / dst_name
        need = prep_xml(src, dst)
        print(f"  {dst.name}: {dst.stat().st_size} B, {len(need)} Kollisions-Meshes")
        all_files.update(need)

    for f in sorted(all_files):
        shutil.copyfile(REF / "robot/mjlab/meshes" / f, OUT / "meshes" / f)
    print(f"  Meshes kopiert: {len(all_files)}")

    for p in POLICIES:
        shutil.copyfile(REF / "policies" / p, OUT / "policies" / p)
    print(f"  Policies kopiert: {len(POLICIES)} ({sum((OUT/'policies'/p).stat().st_size for p in POLICIES)//1024} KB)")

    for src, dst in [
        (PKG / "mujoco311/mujoco.wasm", OUT / "mujoco.wasm"),
        (PKG / "ort127/ort-wasm-simd-threaded.wasm", OUT / "ort-wasm-simd-threaded.wasm"),
    ]:
        shutil.copyfile(src, dst)
        print(f"  {dst.name}: {dst.stat().st_size // 1024} KB")
    # mujoco.js/ort.min.js als Roh-Glues werden NICHT kopiert — der Build
    # (build_sim.py) erzeugt daraus mujoco.wrapped.js / ort.glue.js / ort.global.js.
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"OK: {OUT} ({total / 1048576:.1f} MB gesamt)")


if __name__ == "__main__":
    main()
