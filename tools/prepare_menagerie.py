#!/usr/bin/env python3
"""Testfeld·07 — MuJoCo-Menagerie-Assets (fertige Modelle, wie vom Nutzer gefordert).

Quellen (MuJoCo Model Gallery / Menagerie, local sparse clone):
  - trossen_wx250s  → ARMBOT  (WidowX 250 6DOF, 7 Positions-Aktuatoren, Home-Keyframe)
  - robotis_op3     → HUMANOID (ROBOTIS OP3, 20 Positions-Aktuatoren, Freejoint)

Erzeugt in app/src/main/assets/mjc/:
  - wx250s.xml        Arm-MJCF: Originale Dynamik + Werkstatt-Arena (Boden, Wände,
                      Tisch, Ball, Würfel), Textur → rgba (offline), Keyframe home
  - wx250s_*.stl      Original-Kollisions-/Visual-Meshes (klein, ~1,8 MB gesamt)
  - wx250s_visual.json  Visual-Manifest {mesh, body, pos, quat} für den Renderer
  - op3.xml           Humanoid-MJCF: Visual-Geoms gestrippt (Physik = vereinfachte
                      konvexe Meshes wie im Original), + Home-Keyframe + Arena
  - op3c_*.stl        Original simplified_convex-Kollisionsmeshes (~384 KB)
  - op3vis_*.stl      decimierte Visual-Meshes (fast_simplification, ~10 %)
  - op3_visual.json   Visual-Manifest für den Renderer
"""
import json
import pathlib
import shutil
import xml.etree.ElementTree as ET

import numpy as np
import trimesh

ROOT = pathlib.Path(__file__).resolve().parents[1]
MEN = ROOT.parent / "reference" / "menagerie"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT = ASSETS / "mjc"

ARENA_HALF = 1.5
WALL_H = 0.5


def cluster_decimate(verts, faces, grid):
    """Vertex-Clustering: Verts auf grid quantisieren, Cluster-Mittelwert als
    neuer Vertex, entartete Faces wegwerfen. Deterministisch, ohne Deps."""
    key = np.floor(verts / grid).astype(np.int64)
    uniq, inverse = np.unique(key, axis=0, return_inverse=True)
    newv = np.zeros((len(uniq), 3))
    cnt = np.bincount(inverse, minlength=len(uniq)).astype(np.float64)
    for a in range(3):
        newv[:, a] = np.bincount(inverse, weights=verts[:, a], minlength=len(uniq)) / cnt
    newf = inverse[faces]
    ok = (newf[:, 0] != newf[:, 1]) & (newf[:, 1] != newf[:, 2]) & (newf[:, 0] != newf[:, 2])
    newf = newf[ok]
    # Nicht referenzierte Verts entfernen
    used = np.unique(newf)
    remap = -np.ones(len(uniq), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return newv[used], remap[newf]


def inject_arena(root: ET.Element, floor_z: float, ball: bool, cube: bool, pedestal: bool, ball_pos=None):
    """Werkstatt-Arena wie bei der Ente: Boden, 4 Wände, optionale Props."""
    world = root.find("worldbody")
    ball_pos = ball_pos or [0.5, 0.3, floor_z + 0.05]
    asset = root.find("asset")
    # Boden + Wände (Farben wie Enten-Arena)
    floor = ET.Element("geom", {
        "name": "floor", "type": "plane", "size": f"{ARENA_HALF + 1} {ARENA_HALF + 1} 0.05",
        "pos": f"0 0 {floor_z}", "rgba": "0.16 0.17 0.20 1", "condim": "3",
    })
    world.insert(0, floor)
    for name, pos, size in [
        ("wallN", f"0 {ARENA_HALF} {floor_z + WALL_H / 2}", f"{ARENA_HALF + 1} 0.02 {WALL_H}"),
        ("wallS", f"0 {-ARENA_HALF} {floor_z + WALL_H / 2}", f"{ARENA_HALF + 1} 0.02 {WALL_H}"),
        ("wallE", f"{ARENA_HALF} 0 {floor_z + WALL_H / 2}", f"0.02 {ARENA_HALF + 1} {WALL_H}"),
        ("wallW", f"{-ARENA_HALF} 0 {floor_z + WALL_H / 2}", f"0.02 {ARENA_HALF + 1} {WALL_H}"),
    ]:
        world.insert(1, ET.Element("geom", {
            "name": name, "type": "box", "pos": pos, "size": size,
            "rgba": "0.20 0.21 0.25 1", "contype": "1", "conaffinity": "1",
        }))
    if pedestal:
        # Tisch für den Arm: Oberkante exakt bei z=0 (Arm-Basis sitzt auf 0)
        world.insert(1, ET.Element("geom", {
            "name": "pedestal", "type": "box", "pos": f"0 0 {floor_z + 0.2}",
            "size": "0.22 0.22 0.2", "rgba": "0.28 0.30 0.36 1",
        }))
    if ball:
        bp = " ".join(str(v) for v in ball_pos)
        world.append(ET.fromstring(
            f'<body name="ball" pos="{bp}">'
            f'<freejoint name="ball_freejoint"/>'
            f'<geom name="ball_geom" type="sphere" size="0.05" rgba="0.95 0.5 0.16 1" '
            f'condim="6" friction="1 0.005 0.0001" mass="0.08"/></body>'))
    if cube:
        world.append(ET.fromstring(
            f'<body name="cube" pos="0.34 0 0.025">'
            f'<freejoint name="cube_freejoint"/>'
            f'<geom name="cube_geom" type="box" size="0.025 0.025 0.025" '
            f'rgba="0.35 0.65 0.95 1" mass="0.05"/></body>'))


def prep_wx250s():
    src = MEN / "trossen_wx250s" / "wx250s.xml"
    tree = ET.parse(src)
    root = tree.getroot()
    # Physik-Takt wie im Space: 5 ms × DECIMATION 4 = 50 Hz Regelung
    opt = root.find("option")
    if opt is not None:
        opt.set("timestep", "0.005")
    # Textur offline ersetzen (PNG bleibt draußen)
    asset = root.find("asset")
    tex = asset.find("texture")
    if tex is not None:
        asset.remove(tex)
    mat = asset.find("material")
    mat.attrib.pop("texture", None)
    mat.set("rgba", "0.13 0.13 0.16 1")
    # Arena: Tisch (Oberkante z=0) + Boden bei −0,4 + Ball/Würfel AUF dem Tisch
    inject_arena(root, floor_z=-0.4, ball=True, cube=True, pedestal=True,
                 ball_pos=[0.28, 0.12, 0.05])
    ET.indent(tree, space="  ")
    xml = ET.tostring(root, encoding="unicode")
    (OUT / "wx250s.xml").write_text(xml, encoding="utf-8")

    # Meshes kopieren (Originale, klein genug) — flache VFS-Namen
    stls = []
    for m in root.iter("mesh"):
        f = m.get("file")
        if f and f not in stls:
            stls.append(f)
    for f in stls:
        shutil.copyfile(MEN / "trossen_wx250s" / "assets" / f, OUT / f)

    # Visual-Manifest: Geoms mit class="visual" → {mesh, body, pos, quat}
    vis = []
    parent_map = {c: p for p in root.iter() for c in p}
    for g in root.iter("geom"):
        if g.get("class") != "visual":
            continue
        body = g
        while body is not None and body.tag != "body":
            body = parent_map.get(body)
        q = [float(x) for x in (g.get("quat") or "1 0 0 0").split()]
        p = [float(x) for x in (g.get("pos") or "0 0 0").split()]
        vis.append({
            "m": g.get("mesh"), "b": body.get("name") if body is not None else None,
            "p": p, "q": q,
        })
    (OUT / "wx250s_visual.json").write_text(json.dumps(vis), encoding="utf-8")
    n = sum((OUT / f).stat().st_size for f in stls)
    print(f"wx250s: {len(stls)} STLs ({n / 1e6:.2f} MB), {len(vis)} Visual-Geoms")


def prep_op3():
    src = MEN / "robotis_op3" / "op3.xml"
    tree = ET.parse(src)
    root = tree.getroot()
    # Physik-Takt wie im Space: 5 ms × DECIMATION 4 = 50 Hz Regelung
    opt = root.find("option")
    if opt is None:
        opt = ET.Element("option")
        root.insert(1, opt)
    opt.set("timestep", "0.005")
    # 1) Visual-Geoms raus (Physik läuft wie im Original auf simplified_convex)
    parent_map = {c: p for p in root.iter() for c in p}
    for g in [g for g in root.iter("geom") if g.get("class") == "visual"]:
        parent_map[g].remove(g)
    # 2) Große Visual-Mesh-Assets raus (nur convex bleibt)
    asset = root.find("asset")
    convex_files = [m.get("file") for m in asset.iter("mesh") if "simplified_convex" in m.get("file", "")]
    big = []
    for m in list(asset.findall("mesh")):
        f = m.get("file") or ""
        if "simplified_convex" not in f:
            big.append(f)
            asset.remove(m)
    # 3) Convex-Dateien flach umbenennen: simplified_convex/x.stl → op3c_x.stl
    for m in asset.iter("mesh"):
        f = m.get("file") or ""
        if f.startswith("simplified_convex/"):
            m.set("file", "op3c_" + f.split("/", 1)[1])
    # 4) Home-Keyframe: stabile Stand-Pose (Grid-Search: hip_pitch −0,5 /
    #    knee 0,9 / ankle_pitch 0,52 — 8 s standfest). Gelenkordnung =
    #    Aktuatorordnung: head2 + arm6 + (leg6 × 2 mit ank_roll).
    # leg = [hip_yaw, hip_roll, hip_pitch, knee, ank_pitch, ank_roll]
    leg = [0, 0, -0.5, 0.9, 0.52, 0]
    joints20 = [0, 0] + [0, 0, 0] * 2 + leg + leg
    assert len(joints20) == 20, len(joints20)
    q20 = " ".join(str(v) for v in joints20)
    nq_ctrl = ('<key name="home" qpos="0 0 0.245 1 0 0 0 ' + q20 +
               '" ctrl="' + q20 + '"/>')
    kf = root.find("keyframe")
    if kf is None:
        kf = ET.SubElement(root, "keyframe")
    kf.append(ET.fromstring(nq_ctrl))
    # 5) Arena: Boden bei 0, Wände, Ball
    inject_arena(root, floor_z=0.0, ball=True, cube=False, pedestal=False)
    ET.indent(tree, space="  ")
    (OUT / "op3.xml").write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")

    for f in convex_files:
        base = f.split("/", 1)[1]
        shutil.copyfile(MEN / "robotis_op3" / "assets" / f, OUT / ("op3c_" + base))

    # 6) Visual-Manifest aus dem ORIGINAL (mit Visual-Geoms)
    orig = ET.parse(src).getroot()
    pmap = {c: p for p in orig.iter() for c in p}
    vis = []
    for g in orig.iter("geom"):
        if g.get("class") != "visual":
            continue
        body = g
        while body is not None and body.tag != "body":
            body = pmap.get(body)
        q = [float(x) for x in (g.get("quat") or "1 0 0 0").split()]
        p = [float(x) for x in (g.get("pos") or "0 0 0").split()]
        vis.append({"m": "op3vis_" + g.get("mesh") + ".stl" if False else g.get("mesh"),
                    "b": body.get("name") if body is not None else None, "p": p, "q": q})
    (OUT / "op3_visual.json").write_text(json.dumps(vis), encoding="utf-8")

    # 7) Visual-Meshes decimieren: Vertex-Clustering auf 2-mm-Gitter
    #    (STL-Koordinaten sind mm — OP3 ~300 mm groß; vorher ~46 MB)
    total_in = total_out = 0
    for f in big:
        fin = MEN / "robotis_op3" / "assets" / f
        mesh = trimesh.load(str(fin), force="mesh")
        v2, f2 = cluster_decimate(np.asarray(mesh.vertices, np.float64),
                                  np.asarray(mesh.faces, np.int64), grid=2.0)
        out = OUT / ("op3vis_" + f)
        trimesh.Trimesh(vertices=v2, faces=f2, process=True).export(str(out))
        total_in += fin.stat().st_size
        total_out += out.stat().st_size
    print(f"op3: {len(convex_files)} Convex-Meshes, {len(big)} Visuals decimiert "
          f"{total_in / 1e6:.1f} MB → {total_out / 1e6:.2f} MB, {len(vis)} Visual-Geoms")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    prep_wx250s()
    prep_op3()
    # Manifest-Namen angleichen: Mesh-Attribut → tatsächlicher Dateiname
    fix_manifest_meshnames()
    # Asset-Index für die VFS-Fütterung (Physik-Meshes, flach in mjc/)
    idx = sorted([p.name for p in OUT.iterdir()
                  if p.suffix == ".stl" and (p.name.startswith("wx250s_") or p.name.startswith("op3c_"))])
    (OUT / "__index.json").write_text(json.dumps(idx), encoding="utf-8")
    print(f"__index.json: {len(idx)} Dateien")


def fix_manifest_meshnames():
    # wx250s: mesh-Attr im XML ist asset-Name (z. B. wx250s_1_base) ohne .stl
    p = OUT / "wx250s_visual.json"
    vis = json.loads(p.read_text(encoding="utf-8"))
    for e in vis:
        if not e["m"].endswith(".stl"):
            e["m"] = e["m"] + ".stl"
    p.write_text(json.dumps(vis), encoding="utf-8")
    # op3: mesh-Attr ist ll1 etc. → op3vis_ll1.stl
    p = OUT / "op3_visual.json"
    vis = json.loads(p.read_text(encoding="utf-8"))
    for e in vis:
        if not e["m"].endswith(".stl"):
            e["m"] = "op3vis_" + e["m"] + ".stl"
    p.write_text(json.dumps(vis), encoding="utf-8")


if __name__ == "__main__":
    main()
