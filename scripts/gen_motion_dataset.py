#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════
# gen_motion_dataset.py — Trainrobot Basis-Motion-Datensatz (v1.0.0)
#
# Erzeugt prozedural (CPU, deterministisch — KEIN CUDA nötig) die
# Basis-Animationen fürs RL-Training als LEHRER (Belohnungs-Referenz):
#   - app/motionclips.json   : App-natives Format für ALLE 3 Roboter
#                              inkl. KOMMANDO-TRACK (= Joystick-/Button-
#                              Spur pro Frame!) — Antwort auf die Frage:
#                              „Wo zeigt der Joystick, welcher Button?"
#   - ardy_g1/*.csv          : 36-Spalten-QPOS-CSV im EXAKTEN NVIDIA-ARDY-
#                              Format (root xyz + quat wxyz + 29 DoF) —
#                              direkt importierbar per ".csv (ARDY)".
#   - ardy_g1/*.cmd.csv      : 7-Spalten-Kommandospur je Frame.
#
# ARDY-kompatibel = gleiche Spaltenzahl/Reihenfolge/Konvention (z hoch,
# x vorwärts, Quat w-first). Wer ECHTE ARDY-Clips (Text→Motion, GPU)
# will: kaggle_notebook_ardy.ipynb im Datensatz nutzen und die CSVs
# in ardy_g1/ ergänzen — gleiche Konvention, kein Retargeting.
# ═══════════════════════════════════════════════════════════════
import json, math, os, shutil

OUT = os.path.join(os.path.dirname(__file__), "..", "dataset")
FPS = 30.0

# ── Referenz-Posen (aus den Modell-Keyframes entnommen) ─────────
G1_JOINTS = ["left_hip_pitch_joint","left_hip_roll_joint","left_hip_yaw_joint","left_knee_joint","left_ankle_pitch_joint","left_ankle_roll_joint",
             "right_hip_pitch_joint","right_hip_roll_joint","right_hip_yaw_joint","right_knee_joint","right_ankle_pitch_joint","right_ankle_roll_joint",
             "waist_yaw_joint","waist_roll_joint","waist_pitch_joint",
             "left_shoulder_pitch_joint","left_shoulder_roll_joint","left_shoulder_yaw_joint","left_elbow_joint","left_wrist_roll_joint","left_wrist_pitch_joint","left_wrist_yaw_joint",
             "right_shoulder_pitch_joint","right_shoulder_roll_joint","right_shoulder_yaw_joint","right_elbow_joint","right_wrist_roll_joint","right_wrist_pitch_joint","right_wrist_yaw_joint"]
G1_STAND = [0.0]*12 + [0.0,0.0,0.0] + [0.2,0.2,0.0,1.28,0.0,0.0,0.0] + [0.2,-0.2,0.0,1.28,0.0,0.0,0.0]
G1_H_STAND = 0.79
G1_H_LIE = 0.30
G1_H_CROUCH = 0.55

DUCK_JOINTS = ["left_hip_yaw","left_hip_roll","left_hip_pitch","left_knee","left_ankle","neck_pitch","head_pitch","head_yaw","head_roll",
               "right_hip_yaw","right_hip_roll","right_hip_pitch","right_knee","right_ankle"]
D_STAND = [-0.087266,-0.457924,-0.00494,0.452984,0.349066, 0.349066,0.0,0.0,0.0, 0.087266,0.457924,0.00494,-0.452984,-0.349066]
D_H_STAND = 0.12
D_H_SIT = 0.065
D_H_LIE = 0.045

def clamp(x, a, b): return max(a, min(b, x))
def smooth(u): return u*u*(3-2*u)  # smoothstep
def lerp(a, b, u): return a + (b-a)*u

class Clip:
    """Ein Motion-Clip: Frames von q, h, root(x,y), yaw, cmd. baseQ aus yaw (+ roll/pitch=0)."""
    def __init__(self, robot, skill, label, kind, nu):
        self.robot, self.skill, self.label, self.kind, self.nu = robot, skill, label, kind, nu
        self.q, self.h, self.xy, self.yaw, self.cmd = [], [], [], [], []
    def add(self, q, h, x, y, yawr, cmd):
        self.q.append([round(v, 5) for v in q]); self.h.append(round(h, 4))
        self.xy.append([round(x, 4), round(y, 4)]); self.yaw.append(round(yawr, 5))
        self.cmd.append([round(c, 4) for c in cmd])
    @property
    def n(self): return len(self.q)
    def mean_speed(self):
        if self.n < 2: return 0.0
        d = sum(math.hypot(self.xy[i][0]-self.xy[i-1][0], self.xy[i][1]-self.xy[i-1][1]) for i in range(1, self.n))
        return d / (self.n-1) * FPS
    def to_dict(self):
        return {"id": f"{self.robot}_{self.skill}", "robot": self.robot, "skill": self.skill, "label": self.label,
                "kind": self.kind, "fps": FPS, "n": self.n, "duration": round(self.n/FPS, 3),
                "meanSpeed": round(self.mean_speed(), 4),
                "q": self.q, "h": self.h, "root": self.xy, "yaw": self.yaw,
                "baseQ": [[round(math.cos(y/2), 5), 0.0, 0.0, round(math.sin(y/2), 5)] for y in self.yaw],
                "cmd": self.cmd}

# ── Beiner: G1 ──────────────────────────────────────────────────
def g1_walk_clip(skill, label, v, wy, side, dur=4.0, f=1.4):
    """Generischer G1-Gang: vor/rück/seit + drehen (side: 0=vor,1=seit)."""
    c = Clip("g1", skill, label, "loop", 29)
    n = int(dur*FPS)
    for i in range(n):
        t = i/FPS; ph = 2*math.pi*f*t
        q = list(G1_STAND)
        s1, s2 = math.sin(ph), math.sin(ph+math.pi)
        amp = 0.32 if abs(v) > 0.05 else 0.14   # auf der Stelle kleinere Schritte
        q[0] = 0.10 + amp*s1; q[6] = 0.10 + amp*s2                       # hip_pitch L/R
        q[3] = 0.25 + 0.30*max(0.0, math.sin(ph+0.5)); q[9] = 0.25 + 0.30*max(0.0, math.sin(ph+math.pi+0.5))  # knee
        q[4] = -0.6*q[0]; q[10] = -0.6*q[6]                              # ankle_pitch
        if side == 1:  # seitwärts: hip_roll gegenphasig
            q[1] = 0.10*s1; q[7] = 0.10*s2
        q[12] = 0.10*s2                                                  # waist_yaw gegenrotierend
        q[15] = 0.2 + 0.25*s2; q[24] = 0.2 + 0.25*s1                     # Arme gegenphasig
        q[18] = 1.28 + 0.15*s1; q[27] = 1.28 + 0.15*s2                   # elbow
        z = G1_H_STAND - 0.015 + 0.012*math.sin(2*ph)
        yawr = wy*t if abs(wy) > 1e-9 else 0.0
        yawr = clamp(yawr, -math.pi, math.pi) if skill.startswith("turn") else yawr
        vx = v*math.cos(yawr); vy = v*math.sin(yawr)
        if side == 1 and abs(v) > 0.05:  # Seitwärts in Weltkoordinaten
            x = v*t*math.cos(yawr + math.pi/2*side*0)  # Bleib einfach: Welt-quer
            x, y = 0.0, v*t
        else:
            x = v*t*math.cos(yawr); y = v*t*math.sin(yawr)
        if skill.startswith("turn"): x = y = 0.0
        cmd = [v, 0.0, wy, 0, 0, 0, 0]
        c.add(q, z, x, y, yawr, cmd)
    return c

def g1_static(skill, label, q_target, h_target, dur_in, dur_hold, cmd_in=None, cmd_hold=None, dur_out=None, q_out=None, h_out=None):
    """Einmaliger Wechsel stand→Zielpose, halten, (optional zurück)."""
    c = Clip("g1", skill, label, "once", 29)
    n1, n2 = int(dur_in*FPS), int(dur_hold*FPS)
    n3 = int((dur_out or 0)*FPS)
    cmd_in = cmd_in or [0,0,0,0,0,0,0]; cmd_hold = cmd_hold or cmd_in
    for i in range(n1):
        u = smooth((i+1)/n1)
        q = [lerp(a, b, u) for a, b in zip(G1_STAND, q_target)]
        cmd = list(cmd_in)
        c.add(q, lerp(G1_H_STAND, h_target, u), 0, 0, 0, cmd)
    for i in range(n2):
        c.add(list(q_target), h_target, 0, 0, 0, cmd_hold)
    for i in range(n3):
        u = smooth((i+1)/n3)
        q = [lerp(a, b, u) for a, b in zip(q_target, q_out or G1_STAND)]
        c.add(q, lerp(h_target, h_out or G1_H_STAND, u), 0, 0, 0, [0,0,0,0,0,0,0])
    return c

def g1_huepfen(dur=3.0, f=2.0):
    c = Clip("g1", "huepfen", "Hüpfen (beidbeinig)", "loop", 29)
    n = int(dur*FPS)
    for i in range(n):
        t = i/FPS; ph = 2*math.pi*f*t
        q = list(G1_STAND)
        duck_ = max(0.0, math.sin(ph))*0.45
        q[0] = -0.5*duck_; q[6] = -0.5*duck_
        q[3] = 0.2 + 0.55*duck_; q[9] = 0.2 + 0.55*duck_
        q[4] = 0.4*duck_; q[10] = 0.4*duck_
        q[15] = 0.2+0.3*duck_; q[24] = 0.2+0.3*duck_
        z = G1_H_STAND - 0.05 + 0.05*max(0.0, math.sin(ph))
        c.add(q, z, 0, 0, 0, [0,0,0,1,0,0,0])
    return c

def g1_sprung(weit=False):
    skill = "weitsprung" if weit else "sprung"
    label = "Weitsprung" if weit else "Sprung (vertikal)"
    c = Clip("g1", skill, label, "once", 29)
    def seg(qk, z, x, cmd, n):
        for i in range(n): c.add(list(qk), z, x, 0, 0, cmd)
    # 1) Antreten (0.35 s)
    n1 = int(0.35*FPS)
    qc = list(G1_STAND); qc[0] = qc[6] = -0.9; qc[3] = qc[9] = 1.4; qc[4] = qc[10] = -0.5; qc[15] = qc[24] = -0.4
    for i in range(n1):
        u = smooth((i+1)/n1)
        c.add([lerp(a,b,u) for a,b in zip(G1_STAND, qc)], lerp(G1_H_STAND, G1_H_CROUCH, u), 0, 0, 0, [0.3,0,0,1,0,0,0])
    # 2) Absprung + Flug (0.5 s): Beine strecken, z-Parabel, vx-Impuls
    n2 = int(0.5*FPS); vimp = 1.4 if weit else 0.0
    for i in range(n2):
        u = (i+1)/n2
        stretch = list(G1_STAND)
        z = G1_H_CROUCH + (0.20 if weit else 0.16)*math.sin(math.pi*u)
        x = vimp*(u - math.sin(2*math.pi*u)/(2*math.pi))
        cmd = [1.2,0,0,1,0,0,0] if weit else [0,0,0,1,0,0,0]
        c.add(stretch, z, x, 0, 0, cmd)
    # 3) Landen + Stabilisieren (0.7 s)
    n3 = int(0.7*FPS)
    for i in range(n3):
        u = smooth((i+1)/n3)
        q = [lerp(a,b,u) for a,b in zip(qc, G1_STAND)]
        c.add(q, lerp(G1_H_CROUCH, G1_H_STAND, u), vimp, 0, 0, [0,0,0,0,0,0,0])
    return c

def g1_liegen_aufstehen():
    LIE = list(G1_STAND)
    LIE[0] = LIE[6] = -1.45; LIE[1] = LIE[7] = 0.15           # Hüfte gebeugt
    LIE[3] = LIE[9] = 1.50; LIE[4] = LIE[10] = 0.25           # Knie angezogen
    LIE[14] = -0.35                                            # waist_pitch
    LIE[16] = LIE[25] = 1.1                                    # Schulter seitlich
    clips = []
    clips.append(g1_static("liegen", "Hinlegen (Rücken)", LIE, G1_H_LIE, 1.4, 2.0,
                           cmd_in=[0,0,0,0,1,0,0], cmd_hold=[0,0,0,0,1,0,0]))
    clips.append(g1_static("aufstehen", "Aufstehen", G1_STAND, G1_H_STAND, 2.6, 0.5,
                           dur_out=0.0, cmd_in=[0,0,0,0,0,1,0]))
    # Aufstehen STARTET liegend: ersten Teil manuell umgekehrt aufbauen
    c = Clip("g1", "aufstehen", "Aufstehen (von Rücken)", "once", 29)
    n1 = int(2.6*FPS)
    for i in range(n1):
        u = smooth((i+1)/n1)
        q = [lerp(a, b, u) for a, b in zip(LIE, G1_STAND)]
        c.add(q, lerp(G1_H_LIE, G1_H_STAND, u), 0, 0, 0, [0,0,0,0,0,1,0])
    for i in range(int(0.5*FPS)):
        c.add(list(G1_STAND), G1_H_STAND, 0, 0, 0, [0,0,0,0,0,0,0])
    clips[-1] = c
    return clips

def g1_extra():
    out = []
    # Ducken (halten)
    CR = list(G1_STAND); CR[0]=CR[6]=-0.9; CR[3]=CR[9]=1.45; CR[4]=CR[10]=-0.55; CR[14]=-0.2
    out.append(g1_static("ducken", "Ducken/Hocke", CR, G1_H_CROUCH, 1.0, 2.0, cmd_in=[0,0,0,0,0,0,0]))
    # Winken (Loop 3 s)
    c = Clip("g1", "winken", "Winken (rechter Arm)", "loop", 29)
    for i in range(int(3.0*FPS)):
        t = i/FPS; q = list(G1_STAND)
        q[25] = 1.6 + 0.25*math.sin(2*math.pi*1.6*t)   # R Schulter_roll
        q[27] = 1.6 + 0.30*math.sin(2*math.pi*1.6*t+0.7)  # R elbow
        c.add(q, G1_H_STAND, 0, 0, 0, [0,0,0,0,0,0,0])
    out.append(c)
    # Fußkick (einmalig)
    c = Clip("g1", "fusskick", "Fußkick", "once", 29)
    n = int(1.2*FPS)
    for i in range(n):
        t = i/FPS; u = t/1.2
        k = math.sin(math.pi*clamp(u*1.4, 0, 1))
        q = list(G1_STAND); q[6] = -0.9*k; q[9] = 1.2*k*(1-0.5*clamp(u*2-0.5,0,1)); q[10] = 0.5*k
        c.add(q, G1_H_STAND - 0.02*k, 0, 0, 0, [0,0,0,0,0,0,0])
    out.append(c)
    # Stopp/Bremsen
    c = Clip("g1", "stopp", "Stopp/Bremsen", "once", 29)
    for i in range(int(0.9*FPS)):
        u = smooth((i+1)/int(0.9*FPS))
        q = list(G1_STAND); q[0] = q[6] = -0.25*u
        c.add(q, G1_H_STAND, 0.4*(1-u), 0, 0, [0,0,0,0,0,0,1])
    out.append(c)
    return out

# ── Beiner: MicroDuck ───────────────────────────────────────────
def duck_gait(skill, label, v, wy, dur=4.0, f=2.2):
    c = Clip("duck", skill, label, "loop", 14)
    n = int(dur*FPS)
    for i in range(n):
        t = i/FPS; ph = 2*math.pi*f*t
        s1, s2 = math.sin(ph), math.sin(ph+math.pi)
        q = list(D_STAND)
        q[2] = D_STAND[2] + 0.22*s1; q[11] = D_STAND[11] + 0.22*s2          # hip_pitch
        q[3] = D_STAND[3] - 0.18*max(0.0, s1); q[12] = D_STAND[12] - 0.18*max(0.0, s2)
        q[1] = D_STAND[1] - 0.10*s1; q[10] = D_STAND[10] - 0.10*s2          # roll (watscheln)
        q[4] = D_STAND[4] - 0.20*s1; q[13] = D_STAND[13] - 0.20*s2
        q[5] = D_STAND[5] + 0.15*s1                                          # neck bob
        yawr = wy*t
        cmd = [v, 0.0, wy, 0,0,0,0]
        if skill.startswith("turn"): c.add(q, D_H_STAND-0.01, 0, 0, clamp(wy*t, -math.pi, math.pi), cmd)
        else: c.add(q, D_H_STAND-0.008+0.006*abs(s1), v*t*math.cos(yawr), v*t*math.sin(yawr), yawr, cmd)
    return c

def duck_static(skill, label, q_t, h_t, din, dhold, cmd_in):
    c = Clip("duck", skill, label, "once", 14)
    n1, n2 = int(din*FPS), int(dhold*FPS)
    for i in range(n1):
        u = smooth((i+1)/n1)
        c.add([lerp(a,b,u) for a,b in zip(D_STAND, q_t)], lerp(D_H_STAND, h_t, u), 0, 0, 0, cmd_in)
    for i in range(n2): c.add(list(q_t), h_t, 0, 0, 0, cmd_in)
    return c

def duck_extra():
    out = []
    SIT = list(D_STAND)
    SIT[2] = SIT[11] = -0.6; SIT[3] = SIT[12] = 0.95; SIT[4] = SIT[13] = 0.55
    out.append(duck_static("sitzen", "Hinsetzen", SIT, D_H_SIT, 1.2, 2.0, [0,0,0,0,0,0,0]))
    LIE = [0.0]*14
    out.append(duck_static("liegen", "Hinliegen", LIE, D_H_LIE, 1.4, 2.0, [0,0,0,0,1,0,0]))
    c = Clip("duck", "aufstehen", "Aufstehen", "once", 14)
    n = int(1.8*FPS)
    for i in range(n):
        u = smooth((i+1)/n)
        c.add([lerp(a,b,u) for a,b in zip(LIE, D_STAND)], lerp(D_H_LIE, D_H_STAND, u), 0, 0, 0, [0,0,0,0,0,1,0])
    out.append(c)
    # Hüpfen (beidbeinig, synchron)
    c = Clip("duck", "huepfen", "Hüpfen", "loop", 14)
    for i in range(int(3.0*FPS)):
        t = i/FPS; ph = 2*math.pi*2.5*t
        d = max(0.0, math.sin(ph))
        q = list(D_STAND)
        q[2] = D_STAND[2] - 0.30*d; q[11] = D_STAND[11] - 0.30*d
        q[3] = D_STAND[3] + 0.35*d; q[12] = D_STAND[12] + 0.35*d
        q[5] = D_STAND[5] - 0.3*d
        c.add(q, D_H_STAND - 0.03 + 0.025*d, 0, 0, 0, [0,0,0,1,0,0,0])
    out.append(c)
    # Flattern (head/neck, Spass-Loop)
    c = Clip("duck", "flattern", "Flattern (Kopf/Hals)", "loop", 14)
    for i in range(int(2.5*FPS)):
        t = i/FPS; ph = 2*math.pi*3.0*t
        q = list(D_STAND)
        q[5] = D_STAND[5] + 0.20*math.sin(ph); q[6] = 0.25*math.sin(ph+0.5)
        q[7] = 0.30*math.sin(ph); q[8] = 0.20*math.sin(ph+0.9)
        c.add(q, D_H_STAND, 0, 0, 0, [0,0,0,0,0,0,0])
    out.append(c)
    # Stopp
    c = Clip("duck", "stopp", "Stopp", "once", 14)
    for i in range(int(0.8*FPS)):
        u = smooth((i+1)/int(0.8*FPS))
        q = list(D_STAND); q[2] = D_STAND[2]-0.12*u; q[3] = D_STAND[3]+0.1*u
        c.add(q, D_H_STAND-0.005*u, 0.15*(1-u), 0, 0, [0,0,0,0,0,0,1])
    out.append(c)
    return out

# ── Drohne: X2 (Pfad-Lehrer: root/h/yaw; q leer, baseQ=yaw) ─────
def x2_clip(skill, label, kind, dur, fn):
    c = Clip("x2", skill, label, kind, 0)
    n = int(dur*FPS)
    for i in range(n):
        t = i/FPS
        x, y, z, yawr, cmd = fn(t, dur)
        c.q.append([]); c.h.append(round(z, 4)); c.xy.append([round(x,4), round(y,4)])
        c.yaw.append(round(yawr, 5)); c.cmd.append([round(v,4) for v in cmd])
    return c

def x2_all():
    out = []
    out.append(x2_clip("starten", "Start (Takeoff)", "once", 2.2,
        lambda t, T: (0,0, 0.3+0.9*smooth(min(1,t/1.6)), 0, [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("schweben", "Schweben (Hover)", "loop", 3.0,
        lambda t, T: (0,0, 1.2+0.02*math.sin(2*math.pi*0.5*t), 0, [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("vorwaerts", "Vorwärtsflug", "loop", 4.0,
        lambda t, T: (1.0*t, 0, 1.2, 0, [1.0,0,0,0,0,0,0]) ))
    out.append(x2_clip("rueckwaerts", "Rückwärtsflug", "loop", 4.0,
        lambda t, T: (-0.6*t, 0, 1.2, 0, [-0.6,0,0,0,0,0,0]) ))
    out.append(x2_clip("seitwaerts", "Seitwärtsflug", "loop", 4.0,
        lambda t, T: (0, 0.6*t, 1.2, 0, [0,0.6,0,0,0,0,0]) ))
    out.append(x2_clip("kreisen", "Kreisflug", "loop", 6.0,
        lambda t, T: (1.5*math.sin(2*math.pi*t/6.0), 1.5*(1-math.cos(2*math.pi*t/6.0)), 1.2,
                      2*math.pi*t/6.0, [0.785,0,1.047,0,0,0,0]) ))
    out.append(x2_clip("steigen", "Steigen", "loop", 2.5,
        lambda t, T: (0,0, 1.2+0.5*t, 0, [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("sinken", "Sinken", "loop", 2.5,
        lambda t, T: (0,0, 1.7-0.5*t, 0, [0,0,0,0,0,0,0]) ))
    # Rolle (Barrel Roll) + Salto: Pfad geradelinig, Höhenbump (Acro — Rotation steckt im Namen, Basis-Quat=yaw)
    out.append(x2_clip("rolle", "Barrel Roll (vorwärts)", "once", 1.6,
        lambda t, T: (1.6*t, 0, 1.2+0.15*math.sin(math.pi*min(1,t/1.2)), 0,
                      [1.6,0,0,0,0,0,0] if t < 1.2 else [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("salto", "Salto (Flip vorwärts)", "once", 1.4,
        lambda t, T: (1.4*t, 0, 1.2+0.35*math.sin(math.pi*min(1,t/1.1)), 0,
                      [1.4,0,0,0,0,0,0] if t < 1.1 else [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("landen", "Landung", "once", 2.2,
        lambda t, T: (0,0, 1.2-0.9*smooth(min(1,t/1.8)), 0, [0,0,0,0,0,0,0]) ))
    out.append(x2_clip("notstopp", "Notstopp", "once", 1.0,
        lambda t, T: (0,0, 1.2-0.02*smooth(min(1,t/0.5)), 0, [0,0,0,0,0,0,1]) ))
    return out

# ── G1-Basisliste (Skill → Clip) ────────────────────────────────
def g1_all():
    out = [
        g1_static("idle", "Stehen/Idle (Atmen)", G1_STAND, G1_H_STAND, 0.8, 3.0, [0,0,0,0,0,0,0]),
        g1_walk_clip("walk", "Gehen vorwärts", 0.35, 0.0, 0),
        g1_walk_clip("walk_back", "Rückwärtsgehen", -0.15, 0.0, 0),
        g1_walk_clip("walk_side", "Seitwärtsgehen (links)", 0.12, 0.0, 1),
        g1_walk_clip("turn_l", "Drehen links", 0.0, 0.7, 0),
        g1_walk_clip("turn_r", "Drehen rechts", 0.0, -0.7, 0),
        g1_walk_clip("laufen", "Laufen (schnell)", 0.55, 0.0, 0, f=1.8),
        g1_huepfen(),
        g1_sprung(False), g1_sprung(True),
    ]
    out += g1_liegen_aufstehen()
    out += g1_extra()
    # Balance (Störung)
    c = Clip("g1", "balance", "Gleichgewicht (Störung)", "loop", 29)
    for i in range(int(3.0*FPS)):
        t = i/FPS
        q = list(G1_STAND)
        q[1] = 0.04*math.sin(2*math.pi*0.7*t); q[7] = -0.04*math.sin(2*math.pi*0.7*t)
        q[14] = 0.06*math.sin(2*math.pi*0.5*t)
        c.add(q, G1_H_STAND+0.004*math.sin(2*math.pi*0.9*t), 0, 0, 0, [0,0,0,0,0,0,0])
    out.append(c)
    return out

def duck_all():
    out = [
        duck_static("idle", "Stehen/Idle", D_STAND, D_H_STAND, 0.8, 3.0, [0,0,0,0,0,0,0]),
        duck_gait("walk", "Watscheln vorwärts", 0.12, 0.0),
        duck_gait("walk_back", "Rückwärts", -0.06, 0.0),
        duck_gait("turn_l", "Drehen links", 0.0, 0.8),
        duck_gait("turn_r", "Drehen rechts", 0.0, -0.8),
    ]
    out += duck_extra()
    # Balance
    c = Clip("duck", "balance", "Gleichgewicht", "loop", 14)
    for i in range(int(3.0*FPS)):
        t = i/FPS
        q = list(D_STAND)
        q[1] = D_STAND[1] - 0.05*math.sin(2*math.pi*0.8*t)
        q[10] = D_STAND[10] + 0.05*math.sin(2*math.pi*0.8*t)
        c.add(q, D_H_STAND+0.002*math.sin(2*math.pi*1.1*t), 0, 0, 0, [0,0,0,0,0,0,0])
    out.append(c)
    return out

# ── Export ──────────────────────────────────────────────────────
def write_ardy_csv(c, path):
    rows = []
    for i in range(c.n):
        row = [c.xy[i][0], c.xy[i][1], c.h[i],
               round(math.cos(c.yaw[i]/2), 6), 0.0, 0.0, round(math.sin(c.yaw[i]/2), 6)]
        row += c.q[i]
        rows.append(",".join(f"{v:.6f}" for v in row))
    open(path, "w").write("\n".join(rows) + "\n")
    with open(path.replace(".csv", ".cmd.csv"), "w") as f:
        f.write("\n".join(",".join(str(v) for v in r) for r in c.cmd) + "\n")

def main():
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "app"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "ardy_g1"), exist_ok=True)
    clips = g1_all() + duck_all() + x2_all()
    # ARDY-CSVs nur für G1 (36 Spalten = ARDY-G1-Konvention)
    for c in clips:
        if c.robot == "g1":
            write_ardy_csv(c, os.path.join(OUT, "ardy_g1", f"{c.skill}.csv"))
    manifest = {"schema": "trainrobot-motionclips", "version": "1.0.0", "created": "2026-09-18",
        "license": "CC0-1.0",
        "description": "Prozedurale Basis-Motion-Clips als LEHRER (Belohnungs-Referenz, NIE Policy-Input). ARDY-G1-QPOS-kompatibel.",
        "cmdTrack": {"format": "[vx, vy, wz, bA, bB, bC, bD]",
                     "bA": "Hüpfen/Sprung", "bB": "Hinlegen", "bC": "Aufstehen", "bD": "Stopp",
                     "unit": "vx/vy m/s, wz rad/s, Buttons 0/1"},
        "robots": {"g1": {"joints": G1_JOINTS, "nq": 36}, "duck": {"joints": DUCK_JOINTS, "nq": 21}, "x2": {"joints": [], "nq": 7}},
        "clips": [{"id": c.to_dict()["id"], "robot": c.robot, "skill": c.skill, "label": c.label,
                   "kind": c.kind, "frames": c.n, "seconds": round(c.n/FPS,2), "meanSpeed": c.to_dict()["meanSpeed"]} for c in clips]}
    json.dump({"schema": "trainrobot-motionclips", "version": "1.0.0", "robots": manifest["robots"],
               "cmdTrack": manifest["cmdTrack"], "clips": [c.to_dict() for c in clips]},
              open(os.path.join(OUT, "app", "motionclips.json"), "w"), ensure_ascii=False)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=1)
    n_by = {}
    for c in clips: n_by[c.robot] = n_by.get(c.robot, 0) + 1
    print(f"OK: {len(clips)} Clips ({n_by}) → {OUT}")
    for c in clips[:6]: print("  ", c.to_dict()["id"], c.n, "Frames", round(c.mean_speed(),3), "m/s")

if __name__ == "__main__":
    main()
