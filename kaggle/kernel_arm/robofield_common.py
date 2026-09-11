# Testfeld·07 — Gemeinsamer Kern für alle Kaggle-Trainings (NumPy-Spiegel)
#
# M U S S   b i t n a h   i d e n t i s c h   zu sim/src/rng.js + nn.js sein:
#   - mulberry32: exakt dieselben 32-Bit-Integer-Operationen
#   - MLP: gleiche Gewichtsreihenfolge [W1,b1,W2,b2,W3,b3], row-major,
#     y = tanh(W·x + b) — Vektorisiert über die Population (Achse 0 = Kandidat).
# Determinismus: gleicher Seed + gleiche Gewichte → gleicher Reward wie die
# JS-Env der App (Toleranz 1e-6; real ~1e-12, Rest = libm-1-ulp).
import numpy as np

U32 = 0xFFFFFFFF
HIDDEN = 32

ARCHS = {
    "duck": [12, HIDDEN, HIDDEN, 2],
    "arm": [15, HIDDEN, HIDDEN, 5],
    "humanoid": [10, HIDDEN, HIDDEN, 5],
}
ACT_LIMITS = {"duck": 4.0, "arm": 1.6, "humanoid": 1.0}
DT = 1.0 / 30.0
ARENA_HALF = 10.0
RAY_LEN = 4.0
N_RAYS = 9
RAY_SPREAD = 100 * np.pi / 180
DUCK_R = 0.22
WHEEL_R = 0.12
WHEEL_B = 0.14
W_MAX = 4.0
N_OBS = 12
EP = {"duck": 600, "arm": 450, "humanoid": 600}
ARM = dict(L1=0.55, L2=0.45, L3=0.25, HB=0.5, VMAX=1.6,
           Q1=2.9, Q2=1.4, Q3=2.2, Q4=1.6, BALL_R=0.09,
           GRIP_D=0.14, DELIVER_D=0.25)
ARM["DZ"] = (0.75, ARM["BALL_R"], -0.75)
HUM = dict(H=0.85, G=9.81, LEAN=0.12, STEP_T=0.7)


def clamp(x, a, b):
    return np.clip(x, a, b)


def weight_count(obs, act):
    return obs * HIDDEN + HIDDEN + HIDDEN * HIDDEN + HIDDEN + act * HIDDEN + act


def slice_sizes(obs, act):
    return [obs * HIDDEN, HIDDEN, HIDDEN * HIDDEN, HIDDEN, act * HIDDEN, act]


# ---------------- RNG (Spiegel von mulberry32) ----------------
class Mulberry32:
    """Bit-identischer Spiegel zu sim/src/rng.js."""

    def __init__(self, seed):
        self.s = seed & U32

    def next(self):
        s = (self.s + 0x6D2B79F5) & U32
        self.s = s
        t = s
        t = ((t ^ (t >> 15)) * (t | 1)) & U32                      # Math.imul: untere 32 Bit
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & U32)) & U32)) & U32
        t = (t ^ (t >> 14)) & U32
        return t / 4294967296.0

    def uniform(self, a, b):
        return a + (b - a) * self.next()


# ---------------- MLP (Spiegel von nn.forward) ----------------
def unpack(flat, obs, act):
    """flat: (N, L) → [W1 (N,32,obs), b1 (N,32), W2 (N,32,32), b2, W3 (N,act,32), b3]
    Row-major: Zeilen = Ziel-Neuronen (wie im JS-Forward)."""
    s = slice_sizes(obs, act)
    shapes = [(HIDDEN, obs), (HIDDEN,), (HIDDEN, HIDDEN), (HIDDEN,), (act, HIDDEN), (act,)]
    o = 0
    out = []
    for k in range(6):
        seg = flat[:, o:o + s[k]]
        o += s[k]
        if shapes[k]:
            seg = seg.reshape(-1, *shapes[k])
        out.append(seg)
    return out


def forward_batch(flat, obs, act):
    """flat (N,L), obs (N,obs) → (N,act) in [-1,1]."""
    W1, b1, W2, b2, W3, b3 = unpack(flat, obs.shape[1], act)
    h1 = np.tanh(np.einsum("nij,nj->ni", W1, obs) + b1)
    h2 = np.tanh(np.einsum("nij,nj->ni", W2, h1) + b2)
    return np.tanh(np.einsum("nij,nj->ni", W3, h2) + b3)


def forward_single(flat, obs, act):
    """flat (L,), obs (obs,) → (act,) — exakt wie nn.forward in JS."""
    W1, b1, W2, b2, W3, b3 = unpack(flat[None, :], obs.shape[0], act)
    h1 = np.tanh(W1[0] @ obs + b1[0])
    h2 = np.tanh(W2[0] @ h1 + b2[0])
    return np.tanh(W3[0] @ h2 + b3[0])


def init_genome(seed, obs, act):
    """Spiegel von nn.initGenome (Xavier-Grenzen, gleiche Reihenfolge)."""
    rng = Mulberry32(seed & U32)
    sizes = slice_sizes(obs, act)
    pairs = [(obs, HIDDEN), (HIDDEN, 0), (HIDDEN, HIDDEN), (HIDDEN, 0), (HIDDEN, act), (act, 0)]
    flat = np.zeros(weight_count(obs, act))
    off = 0
    for k in range(6):
        fi, fo = pairs[k]
        lim = 0.1 if fo == 0 else np.sqrt(6.0 / (fi + fo))
        for i in range(sizes[k]):
            flat[off + i] = rng.uniform(-lim, lim)
        off += sizes[k]
    return flat


def genome_to_policy_json(flat, robot, gen, fit, src):
    import json
    obs, act = ARCHS[robot][0], ARCHS[robot][3]
    sizes = slice_sizes(obs, act)
    weights, o = [], 0
    for k in range(6):
        weights.append([float(x) for x in flat[o:o + sizes[k]]])
        o += sizes[k]
    return json.dumps({
        "format": "robofield-policy-v1",
        "robot": robot,
        "arch": ARCHS[robot][:],
        "weights": weights,
        "gen": int(gen),
        "fit": float(fit),
        "src": src,
    })
