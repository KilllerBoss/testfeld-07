# ═══════════════════════════════════════════════════════════
# ardy_skeleton27_render.py — v2.28.7-Beweisbild: zeichnet das NEUE
# 27-Gelenk-Lehrer-Skelett (srcPos aus ardy_skeleton27_diag.mjs) in
# drei Ansichten (Front / Seite / 3-4) — zum direkten Vergleich mit
# dem Nutzer-Referenz-Screenshot (ARDY-Browser-Demo, cskel27).
# ═══════════════════════════════════════════════════════════
import json, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.font_manager as fm
for fp in ('/usr/share/fonts/truetype/chinese/NotoSansSC[wght].ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
    try:
        fm.fontManager.addfont(fp)
    except Exception:
        pass
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = '/home/z/my-project/download'
os.makedirs(OUT, exist_ok=True)
dump = json.load(open(os.path.join(HERE, 'skeleton27_dump.json')))

roles = dump['roles']
edges = [(a, b) for a, b in dump['edges']]
nR = len(roles)
idx = {r: i for i, r in enumerate(roles)}
n = dump['n']
src = dump['srcPos']

def frame_pts(f, scale_pos=None):
    arr = scale_pos if scale_pos is not None else src
    return {r: (arr[(f * nR + idx[r]) * 3], arr[(f * nR + idx[r]) * 3 + 1], arr[(f * nR + idx[r]) * 3 + 2]) for r in roles}

def draw(ax, pts, title):
    # Knochen
    for a, b in edges:
        pa, pb = pts[a], pts[b]
        ax.plot([pa[0], pb[0]], [pa[2], pb[2]], color='#2f9e6e', lw=3.2, solid_capstyle='round', zorder=2, alpha=0.85)
    # Gelenke
    xs = [pts[r][0] for r in roles]
    zs = [pts[r][2] for r in roles]
    ax.scatter(xs, zs, s=52, color='#59e0a8', edgecolors='#1f6f4d', linewidths=0.8, zorder=3)
    ax.set_aspect('equal')
    ax.set_title(title, fontsize=11)
    ax.grid(True, alpha=0.25)
    ax.set_xlabel('x (m)', fontsize=9)
    ax.set_ylabel('z — Höhe (m)', fontsize=9)

f0, fM = dump['frames']
for label, f in [('Frame 0', f0), ('Frame %d (Mitte)' % fM, fM)]:
    pts = frame_pts(f)
    fig, axes = plt.subplots(1, 3, figsize=(15, 6.4), constrained_layout=True)
    draw(axes[0], pts, 'FRONT (Blick +y) — idle, Arme hängen')
    draw(axes[1], pts, 'SEITE (Blick +x)')
    draw(axes[2], pts, '3/4-Ansicht (projiziert, wie Referenz-Screenshot)')
    # 3/4: leichte Rotation
    import math
    ang = math.radians(38)
    pts34 = {r: (pts[r][0] * math.cos(ang) + pts[r][1] * math.sin(ang), pts[r][1], pts[r][2]) for r in roles}
    draw(axes[2], pts34, '3/4-PROJEKTION (38°)')
    fig.suptitle('v2.28.7 — ARDY-Lehrer-Skelett: volle cskel27-Anatomie (27 Gelenke, 26 Knochen) — "%s" (Seed %s)' % (dump['prompt'], dump['seed']), fontsize=12)
    out_png = os.path.join(OUT, 'ardy_skeleton27_%s.png' % ('frame0' if f == f0 else 'mitte'))
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
    print('geschrieben:', out_png)

# Zusätzlich: gefittete Variante (wie in der App am Geist)
if dump.get('fitted'):
    pts = frame_pts(f0, dump['fitted']['srcPos'])
    fig, ax = plt.subplots(figsize=(6.4, 6.8), constrained_layout=True)
    draw(ax, pts, 'GEFITTED auf G1-Geist (F=%.3f) — so läuft es in der App' % dump['fitted']['factor'])
    out_png = os.path.join(OUT, 'ardy_skeleton27_gefitted.png')
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
    print('geschrieben:', out_png)
print('fertig')
