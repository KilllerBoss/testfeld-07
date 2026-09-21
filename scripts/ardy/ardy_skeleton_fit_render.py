# ═══════════════════════════════════════════════════════════
# ardy_skeleton_fit_render.py — v2.28.8-Beweisbild: G1-Körper (grau) +
# ARDY-Lehrer-Skelett VORHER (Menschen-Proportionen, rot gestrichelt =
# das „Exoskelett" des Nutzer-Reports) und NACHHER (Knochenlängen-Transfer,
# grün = sitzt am Roboter).
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
d = json.load(open(os.path.join(HERE, 'skeleton_fit_dump.json')))
roles = d['roles']; edges = d['edges']; idx = {r: i for i, r in enumerate(roles)}
nR = len(roles)

def pts(arr):
    return {r: (arr[(idx[r]) * 3], arr[(idx[r]) * 3 + 1], arr[(idx[r]) * 3 + 2]) for r in roles}

def draw(ax, p, title, color):
    for a, b in edges:
        if a not in p or b not in p:
            continue
        pa, pb = p[a], p[b]
        ax.plot([pa[0], pb[0]], [pa[2], pb[2]], color=color, lw=3.4, solid_capstyle='round', zorder=3, alpha=0.9)
    ax.scatter([p[r][0] for r in roles], [p[r][2] for r in roles], s=52, color=color, edgecolors='black', linewidths=0.6, zorder=4)
    # G1-Körper (grau)
    rj = d['robot']['joints']
    xs = [d['robot']['pelvis'][0]] + [j['pos'][0] for j in rj if j['pos']]
    zs = [d['robot']['pelvis'][2]] + [j['pos'][2] for j in rj if j['pos']]
    ax.scatter(xs, zs, s=90, marker='s', color='#8a8f98', edgecolors='#3c4048', linewidths=0.8, zorder=2, label='G1 Körper (Nullpose)')
    ax.set_aspect('equal'); ax.grid(True, alpha=0.25)
    ax.set_title(title, fontsize=10.5)
    ax.set_xlabel('x (m)', fontsize=9); ax.set_ylabel('z — Höhe (m)', fontsize=9)
    ax.legend(fontsize=8, loc='lower right')

before = pts(d['before']); after = pts(d['after'])
fig, axes = plt.subplots(1, 3, figsize=(16.5, 7), constrained_layout=True)
draw(axes[0], before, 'VORHER — Menschen-Skelett um den G1 („Exoskelett")', '#d9634e')
draw(axes[1], after, 'NACHHER — Knochenlängen-Transfer (sitzt am G1)', '#2f9e6e')
draw(axes[2], after, 'NACHHER — nah (Detail Beine/Arme)', '#2f9e6e')
axes[2].set_xlim(-0.45, 0.45); axes[2].set_ylim(0.0, 1.3)
fig.suptitle('v2.28.8 — KNOCHENLÄNGEN-TRANSFER: Das grüne ARDY-Skelett erhält die G1-Gliedmaßen (Δ ≤ 1,3 cm) — "a person stands still, idle"', fontsize=12)
out_png = os.path.join(OUT, 'ardy_skeleton_fit.png')
fig.savefig(out_png, dpi=110)
plt.close(fig)
print('geschrieben:', out_png)
