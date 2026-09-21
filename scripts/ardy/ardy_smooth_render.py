# ardy_smooth_render.py — Beweisbild für v2.28.11 „PLAYBACK-GLÄTTUNG"
# Panel 1: Anzeige-Sampling 60 Hz — Nearest-Frame-Treppen (alt) vs. Lerp/Slerp (neu)
# Panel 2: BEFUND — Physik-Referenz (sampleRef, t = phase·fps) zeitgestreckt vs. Anzeige (t = phase·n)
import json, math
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

HERE = '/home/z/my-project/scripts/ardy'
d = json.load(open(HERE + '/smooth_proof_dump.json'))
ph = d['trace']['phase']; fl = d['trace']['floor']; it = d['trace']['interp']
n, fps = d['n'], d['fps']
t = [p * n / fps for p in ph]  # Sekunden (Loop = n/fps)

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12.5, 4.6), constrained_layout=True)

# ── Panel 1: Treppen vs. Interpolation (Gelenk 0, erste 2 s)
t1s = [x for x in t if x <= 2.0]
i1 = len(t1s)
ax1.plot(t1s, fl[:i1], '-', color='#c62828', lw=2.0, label='Alt: Nearest-Frame (Treppen, v2.28.10)')
ax1.plot(t1s, it[:i1], '-', color='#2e7d32', lw=1.8, label='Neu: Lerp/Slerp (v2.28.11)')
# 20-Hz-Clip-Frames als Punkte
frame_pts = []
for f in range(int(2.0 * fps) + 1):
    k = round(f / fps / (n / fps) * 240)
    k = min(k, 240)
    frame_pts.append((f / fps, fl[k]))
ax1.scatter([p[0] for p in frame_pts], [p[1] for p in frame_pts], s=22, color='#455a64', zorder=3, label='20-Hz-Clip-Frames')
ax1.set_xlabel('Zeit (s)')
ax1.set_ylabel('Gelenkwinkel (rad)')
ax1.set_title('Geist-Anzeige 60 Hz — „Zittern" (Treppen) → glatt\nmax Sprung %.1f mm → %.1f mm (Faktor %.1f)' % (
    d['xpos']['floor'] * 1000, d['xpos']['interp'] * 1000, d['q']['factor']), fontsize=10.5)
ax1.legend(fontsize=8.5, loc='upper right')
ax1.grid(alpha=0.25)

# ── Panel 2: DESYNC-Befund (Referenz-Skala phase·fps vs. Anzeige phase·n)
disp_idx = [p * n for p in ph]
ref_idx = [(p * fps) % n for p in ph]
ax2.plot(t, disp_idx, '-', color='#1565c0', lw=1.8, label='Anzeige/Geist (t = phase·n) — volle Motion')
ax2.plot(t, ref_idx, '-', color='#e65100', lw=1.8, label='Physik-Referenz (t = phase·fps) — nur %.1f s Material' % (fps / fps))
ax2.axvspan(0, fps / fps, color='#e65100', alpha=0.06)
ax2.set_xlabel('Zeit (s)')
ax2.set_ylabel('effektiver Clip-Frame-Index')
ax2.set_title('BEFUND (unverändert): Referenz zeitgestreckt (Faktor %.1f)\n+ Loop-Naht-Sprung %.3f rad — Policy-Semantik, nächste Iteration' % (n / fps, d['desync']['refJump']), fontsize=10.5)
ax2.legend(fontsize=8.5, loc='upper right')
ax2.grid(alpha=0.25)

fig.suptitle('v2.28.11 PLAYBACK-GLÄTTUNG (Geist = rohe ARDY-Ausgabe, jetzt interpoliert wie im HF-Space)', fontsize=12, y=1.02)
fig.savefig('/home/z/my-project/download/ardy_smooth_proof.png', dpi=150, bbox_inches='tight')
print('ok -> /home/z/my-project/download/ardy_smooth_proof.png')
