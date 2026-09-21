# ═══════════════════════════════════════════════════════════
# ardy_fix_render.py — v2.28.9-Beweisbild (Report E):
# Frontansicht (lateral vs. Höhe): das grüne ARDY-Skelett (volle cskel27-
# Anatomie, G1-Gliedmaßen-Längen) sitzt SEITENRICHTIG auf dem G1 —
# links bleibt links (VORHER war das ganze Skelett gespiegelt und
# überkreuzte den Roboter). 4 Frames des idle.
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
d = json.load(open(os.path.join(HERE, 'fix_proof_dump.json')))
roles = d['roles']; edges = d['edges']; idx = {r: i for i, r in enumerate(roles)}
frames = d['frames']

fig, axes = plt.subplots(1, len(frames), figsize=(4.2 * len(frames), 7.2), constrained_layout=True, sharey=True)
for ax, fr_i, f in zip(axes, range(len(frames)), frames):
    arr = d['srcPos'][fr_i]
    p = {r: (arr[idx[r] * 3 + 1], arr[idx[r] * 3 + 2]) for r in roles}  # (lateral, hoch)
    # G1-Körper (grau, Nullpose)
    rj = d['robotJoints']
    ax.scatter([j['pos'][1] for j in rj], [j['pos'][2] for j in rj], s=64, marker='s',
               color='#b9bec7', edgecolors='#4a4f58', linewidths=0.7, zorder=2, label='G1 Körper (Nullpose)')
    # Knochen
    for a, b in edges:
        if a not in p or b not in p:
            continue
        ax.plot([p[a][0], p[b][0]], [p[a][1], p[b][1]], color='#2f9e6e', lw=3.2, solid_capstyle='round', zorder=3, alpha=0.95)
    ax.scatter([p[r][0] for r in roles], [p[r][1] for r in roles], s=42, color='#59e0a8',
               edgecolors='#17493a', linewidths=0.6, zorder=4)
    ax.axvline(0.0, color='#888', lw=0.8, ls='--', alpha=0.6)
    ax.set_aspect('equal')
    ax.set_title('Frame %d' % f, fontsize=10.5)
    ax.set_xlabel('lateral y (m)  —  links = +y', fontsize=9)
    ax.grid(True, alpha=0.22)
axes[0].set_ylabel('Höhe z (m)', fontsize=9)
axes[0].legend(fontsize=8, loc='lower left')
fig.suptitle('v2.28.9 — SEITEN-REPARATUR: ARDY-Skelett (idle, Seed 7) seitenrichtig AUF dem G1 — links = links, keine Überkreuzung, Hände/Beine am Skelett', fontsize=11.5)
out_png = os.path.join(OUT, 'ardy_side_fix.png')
fig.savefig(out_png, dpi=115)
plt.close(fig)
print('geschrieben:', out_png)
