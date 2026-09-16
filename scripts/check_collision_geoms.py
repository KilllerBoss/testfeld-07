#!/usr/bin/env python3
"""Check all robot model XMLs: for each body, does it have visual (non-collision) geoms?
Goal: verify it is safe to hide collision-class (group 3) geoms in render3d.js."""
import xml.etree.ElementTree as ET
import os, glob

BASE = "/home/z/my-project/app/src/main/assets/www/models"
FILES = [
    "unitree_g1/testfeld.xml", "unitree_g1/g1.xml", "unitree_g1/g1_with_hands.xml",
    "boston_dynamics_spot/testfeld.xml", "boston_dynamics_spot/spot.xml",
    "unitree_a1/testfeld.xml", "unitree_a1/a1.xml",
    "skydio_x2/testfeld.xml", "skydio_x2/x2.xml",
    "pollen_microduck/testfeld.xml", "pollen_microduck/microduck.xml",
]

def geom_classes(root):
    """Resolve default class inheritance -> geom group per class."""
    classes = {}
    def walk(d, parent=""):
        for dc in d.findall("default"):
            name = dc.get("class", "")  # MuJoCo default classes use 'class' attribute
            g = dc.find("geom")
            grp = g.get("group") if g is not None else None
            classes[name] = {"group": grp, "parent": parent}
            walk(dc, name)
    top = root.find("default")
    if top is not None:
        walk(top)
    def eff_group(cls):
        while cls:
            c = classes.get(cls)
            if not c: return None
            if c["group"] is not None:
                return c["group"]
            cls = c["parent"]
        return None
    return eff_group

ok_all = True
for f in FILES:
    path = os.path.join(BASE, f)
    if not os.path.exists(path):
        print(f"[SKIP] {f}")
        continue
    root = ET.parse(path).getroot()
    eff_group = geom_classes(root)
    wb = root.find("worldbody")
    problem_bodies = []
    total_coll = 0
    for body in wb.iter("body"):
        bname = body.get("name", "?")
        vis, coll = 0, 0
        for g in body.findall("geom"):
            cls = g.get("class")
            grp = g.get("group", eff_group(cls) if cls else None)
            if grp == "3":
                coll += 1
            else:
                vis += 1
        total_coll += coll
        if coll > 0 and vis == 0:
            problem_bodies.append((bname, coll))
    status = "OK" if not problem_bodies else "PROBLEM"
    if problem_bodies:
        ok_all = False
    print(f"[{status}] {f}: collision-geoms={total_coll}, bodies-nur-kollision={len(problem_bodies)}")
    for b, c in problem_bodies:
        print(f"        -> body '{b}' hat {c} Kollisions-Geoms, KEIN visuelles Geom!")

print("\nFAZIT:", "Group-3-Hiding ist SICHER für alle Modelle." if ok_all else "ACHTUNG: es gibt Bodies, deren einzige Geoms Kollisions-Geoms sind!")
