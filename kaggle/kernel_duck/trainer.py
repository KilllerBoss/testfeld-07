# Testfeld·07 — Vektorisierter Neuroevolution-Trainer (Kaggle/lokal)
#
# Spiegelt das On-Device-Training der App: Population 40, MLP 2×32 tanh,
# Bewertung batchweise mit 8 parallelen Geistern pro Arena (gleicher Seed),
# Elite 8 + Turnier(3)-Crossover + Gauß-Mutation.
# Die Umgebungen nutzen pro Kandidat einen eigenen Mulberry32-Strom —
# identisch zur JS-Env (Beweis via tools/check_determinism.py).
import math
import numpy as np

from robofield_common import (Mulberry32, ARCHS, DT, ARENA_HALF, RAY_LEN,
                             N_RAYS, RAY_SPREAD, DUCK_R, WHEEL_R, WHEEL_B,
                             W_MAX, N_OBS, EP, ARM, HUM, clamp)
from robofield_common import forward_batch


# ============================ MICRODUCK (Batch) ============================
class DuckEnvBatch:
    def __init__(self, seed, n):
        self.n = n
        self.reset(seed)

    def reset(self, seed):
        n = self.n
        base = Mulberry32(seed & 0xFFFFFFFF)
        # Hindernisse: identisch für alle (gleicher Seed → gleicher Strom)
        self.obs = []  # (x, z, r, h)
        for _ in range(N_OBS):
            while True:
                x = base.uniform(-8.5, 8.5)
                z = base.uniform(-8.5, 8.5)
                if math.sqrt(x * x + z * z) >= 2.5:
                    break
            r = base.uniform(0.35, 0.85)
            h = base.uniform(0.8, 1.4)
            self.obs.append((x, z, r, h))
        ox = np.array([o[0] for o in self.obs])
        oz = np.array([o[1] for o in self.obs])
        orr = np.array([o[2] for o in self.obs])
        self.ox, self.oz, self.orr = ox, oz, orr
        # pro Kandidat eigener Strom (wie in der App) — WICHTIG: der Strom
        # konsumiert die Hindernis-Ziehungen genau wie die JS-Env, damit die
        # Position im Strom (Heading, Ziele) exakt übereinstimmt.
        self.rngs = []
        for _ in range(n):
            rg = Mulberry32(seed & 0xFFFFFFFF)
            for _ in range(N_OBS):
                while True:
                    x = rg.uniform(-8.5, 8.5)
                    z = rg.uniform(-8.5, 8.5)
                    if math.sqrt(x * x + z * z) >= 2.5:
                        break
                rg.uniform(0.35, 0.85)
                rg.uniform(0.8, 1.4)
            self.rngs.append(rg)
        self.x = np.zeros(n)
        self.z = np.zeros(n)
        self.heading = np.array([rg.uniform(-math.pi, math.pi) for rg in self.rngs])
        self.tx = np.zeros(n)
        self.tz = np.zeros(n)
        for k in range(n):
            self._new_target(k)
        self.dist = np.hypot(self.tx - self.x, self.tz - self.z)
        self.fit = np.zeros(n)
        self.steps = 0
        self.reached = np.zeros(n, dtype=int)
        self.done = np.zeros(n, dtype=bool)

    def _new_target(self, k):
        rg = self.rngs[k]
        x, z = self.x[k], self.z[k]
        while True:
            tx = rg.uniform(-8.5, 8.5)
            tz = rg.uniform(-8.5, 8.5)
            if math.sqrt((tx - x) ** 2 + (tz - z) ** 2) <= 3.0:
                continue
            ok = True
            for (ox, oz, orr, _h) in self.obs:
                if math.sqrt((tx - ox) ** 2 + (tz - oz) ** 2) <= orr + 0.6:
                    ok = False
                    break
            if ok:
                self.tx[k], self.tz[k] = tx, tz
                return

    def get_obs(self):
        n, M = self.n, len(self.obs)
        obs = np.empty((n, 12))
        # Strahlen (Vektorisierung der exakten JS-Geometrie)
        offs = (np.arange(N_RAYS) - 4) / 4 * RAY_SPREAD
        ang = self.heading[:, None] + offs[None, :]
        dx = np.cos(ang)
        dz = np.sin(ang)
        px = self.x[:, None]
        pz = self.z[:, None]
        t_min = np.full((n, N_RAYS), RAY_LEN)
        # Wände
        with np.errstate(divide="ignore", invalid="ignore"):
            for d, p, half in ((dx, px, ARENA_HALF), (dz, pz, ARENA_HALF)):
                t = (half - p) / d
                m = (d > 1e-12) & (t >= 0)
                t_min = np.where(m & (t < t_min), t, t_min)
                t = (-half - p) / d
                m = (d < -1e-12) & (t >= 0)
                t_min = np.where(m & (t < t_min), t, t_min)
        # Zylinder (aufgebläht um DUCK_R)
        rx = self.ox[None, None, :] - px[:, :, None]
        rz = self.oz[None, None, :] - pz[:, :, None]
        to = rx * dx[:, :, None] + rz * dz[:, :, None]
        c2 = rx * rx + rz * rz - to * to
        rr = self.orr[None, None, :] + DUCK_R
        valid = (to > 0) & (c2 < rr * rr)
        th = to - np.sqrt(np.maximum(rr * rr - c2, 0.0))
        th = np.where(valid & (th >= 0), th, np.inf)
        t_min = np.minimum(t_min, th.min(axis=2))
        obs[:, :N_RAYS] = np.clip(t_min / RAY_LEN, 0.0, 1.0)
        # Ziel-Sin/Cos + Distanz
        ddx = self.tx - self.x
        ddz = self.tz - self.z
        d = np.maximum(np.hypot(ddx, ddz), 1e-9)
        nx, nz = ddx / d, ddz / d
        fx, fz = np.cos(self.heading), np.sin(self.heading)
        obs[:, 9] = np.clip(fx * nz - fz * nx, -1.0, 1.0)
        obs[:, 10] = np.clip(fx * nx + fz * nz, -1.0, 1.0)
        obs[:, 11] = np.clip(self.dist / 12, 0.0, 1.0)
        return obs

    def step(self, acts):
        n = self.n
        a0 = np.clip(acts[:, 0], -1, 1)
        a1 = np.clip(acts[:, 1], -1, 1)
        prev = self.dist.copy()
        vl, vr = a0 * W_MAX, a1 * W_MAX
        v = WHEEL_R * (vl + vr) / 2
        w = WHEEL_R * (vl - vr) / (2 * WHEEL_B)
        self.heading += w * DT
        self.x += np.cos(self.heading) * v * DT
        self.z += np.sin(self.heading) * v * DT
        # Kollision: Zylinder + Wände (Vektorisierung der JS-Rückstoßlogik)
        coll = np.zeros(n, dtype=bool)
        for (ox, oz, orr, _h) in self.obs:
            ddx = self.x - ox
            ddz = self.z - oz
            d = np.hypot(ddx, ddz)
            min_d = orr + DUCK_R
            hit = d < min_d
            d_safe = np.where(hit & (d < 1e-9), 1.0, np.where(hit, d, 1.0))
            self.x = np.where(hit, ox + ddx / d_safe * min_d, self.x)
            self.z = np.where(hit, oz + ddz / d_safe * min_d, self.z)
            coll |= hit
        lim = ARENA_HALF - 0.3
        for cond in (self.x > lim, self.x < -lim, self.z > lim, self.z < -lim):
            self.x = np.where(self.x > lim, lim, self.x)
            self.x = np.where(self.x < -lim, -lim, self.x)
            self.z = np.where(self.z > lim, lim, self.z)
            self.z = np.where(self.z < -lim, -lim, self.z)
            coll |= cond
        self.dist = np.hypot(self.tx - self.x, self.tz - self.z)
        r = 5.0 * (prev - self.dist) - 0.1 * coll
        reach = self.dist < 0.5
        r = r + 25.0 * reach
        for k in np.where(reach & ~self.done)[0]:
            self.reached[k] += 1
            self._new_target(int(k))
        self.dist = np.hypot(self.tx - self.x, self.tz - self.z)
        self.fit += r
        self.steps += 1
        newly_done = self.steps >= EP["duck"]
        return r, newly_done


# ============================= ARMBOT (Batch) =============================
class ArmEnvBatch:
    def __init__(self, seed, n):
        self.n = n
        self.reset(seed)

    def reset(self, seed):
        n = self.n
        self.rngs = [Mulberry32(seed & 0xFFFFFFFF) for _ in range(n)]
        self.q = np.tile(np.array([0.0, 0.35, -0.7, 0.0]), (n, 1))
        self.dq = np.zeros((n, 4))
        self.holding = np.zeros(n, dtype=bool)
        self.fit = np.zeros(n)
        self.steps = 0
        self.delivered = np.zeros(n, dtype=int)
        self.ball = np.zeros((n, 3))
        for k in range(n):
            self._new_ball(k)
        self.ee = np.zeros((n, 3))
        self._fk()
        self.prev_eb = np.linalg.norm(self.ee - self.ball, axis=1)
        self.prev_bd = np.zeros(n)
        self.done = np.zeros(n, dtype=bool)

    def _new_ball(self, k):
        rg = self.rngs[k]
        ang = rg.uniform(-math.pi, math.pi)
        rad = rg.uniform(0.75, 1.05)
        self.ball[k] = (rad * math.cos(ang), ARM["BALL_R"], rad * math.sin(ang))

    def _fk(self):
        t1 = self.q[:, 1]
        t2 = self.q[:, 1] + self.q[:, 2]
        t3 = t2 + self.q[:, 3]
        px = (np.sin(t1) * ARM["L1"] + np.sin(t2) * ARM["L2"]
              + np.sin(t3) * ARM["L3"])
        py = (ARM["HB"] + np.cos(t1) * ARM["L1"] + np.cos(t2) * ARM["L2"]
              + np.cos(t3) * ARM["L3"])
        cx, cz = np.cos(self.q[:, 0]), np.sin(self.q[:, 0])
        self.ee[:, 0] = px * cx
        self.ee[:, 1] = py
        self.ee[:, 2] = px * cz

    def get_obs(self):
        n = self.n
        obs = np.empty((n, 15))
        ranges = np.array([ARM["Q1"], ARM["Q2"], ARM["Q3"], ARM["Q4"]])
        obs[:, 0:4] = self.q / ranges
        obs[:, 4:8] = self.dq / ARM["VMAX"]
        obs[:, 8:11] = (self.ball - self.ee) / 2
        obs[:, 11:14] = self.ee / 2
        obs[:, 14] = self.holding.astype(float)
        return obs

    def step(self, acts):
        n = self.n
        ranges = np.array([ARM["Q1"], ARM["Q2"], ARM["Q3"], ARM["Q4"]])
        self.dq = np.clip(acts[:, :4], -1, 1) * ARM["VMAX"]
        self.q = np.clip(self.q + self.dq * DT, -ranges, ranges)
        grip = np.clip(acts[:, 4], -1, 1) > 0
        self._fk()
        r = np.zeros(n)
        d_eb = np.linalg.norm(self.ee - self.ball, axis=1)
        dz = np.array(ARM["DZ"])
        # Loslassen
        rel = self.holding & ~grip
        if rel.any():
            self.holding &= ~rel
            self.ball[rel, 1] = np.maximum(self.ball[rel, 1], ARM["BALL_R"])
            self.prev_eb[rel] = np.linalg.norm(self.ee[rel] - self.ball[rel], axis=1)
        # Greifen
        grab = ~self.holding & grip & (d_eb < ARM["GRIP_D"])
        if grab.any():
            self.holding |= grab
            r += 2.0 * grab
            d_bd = np.linalg.norm(self.ball[grab] - dz, axis=1)
            self.prev_bd[grab] = d_bd
        # Halten / Annäherung
        hold = self.holding
        if hold.any():
            self.ball[hold, 0] = self.ee[hold, 0]
            self.ball[hold, 1] = self.ee[hold, 1] - 0.06
            self.ball[hold, 2] = self.ee[hold, 2]
            d_bd = np.linalg.norm(self.ball[hold] - dz, axis=1)
            r[hold] += 4.0 * (self.prev_bd[hold] - d_bd)
            self.prev_bd[hold] = d_bd
            deliv = hold & (d_bd < ARM["DELIVER_D"])
            if deliv.any():
                r[deliv] += 25.0
                self.delivered[deliv] += 1
                self.holding &= ~deliv
                for k in np.where(deliv)[0]:
                    self._new_ball(int(k))
                rest = ~self.holding
                self.prev_eb[rest] = np.linalg.norm(self.ee[rest] - self.ball[rest], axis=1)
        free = ~self.holding
        if free.any():
            d_eb2 = np.linalg.norm(self.ee[free] - self.ball[free], axis=1)
            r[free] += 4.0 * (self.prev_eb[free] - d_eb2)
            self.prev_eb[free] = d_eb2
        self.fit += r
        self.steps += 1
        return r, self.steps >= EP["arm"]


# ============================ HUMANOID (Batch) ============================
class HumanoidEnvBatch:
    def __init__(self, seed, n):
        self.n = n
        self.reset(seed)

    def reset(self, seed):
        n = self.n
        self.rngs = [Mulberry32(seed & 0xFFFFFFFF) for _ in range(n)]
        self.px = np.zeros(n)
        self.pz = np.zeros(n)
        self.vx = np.zeros(n)
        self.x = np.zeros(n)
        self.s = np.full(n, -0.1)
        self.tau = np.zeros(n)
        self.side = np.ones(n, dtype=int)
        self.lean = np.zeros(n)
        self.hip_l = np.full(n, -0.2)
        self.knee_l = np.full(n, 0.1)
        self.hip_r = np.full(n, 0.2)
        self.knee_r = np.full(n, 0.1)
        self.fit = np.zeros(n)
        self.steps = 0
        self.reached = np.zeros(n, dtype=int)
        self.fallen = np.zeros(n, dtype=bool)
        self.done = np.zeros(n, dtype=bool)
        self.tx = np.zeros(n)
        self.tz = np.zeros(n)
        self.dir_x = np.ones(n)
        self.dir_z = np.zeros(n)
        self.target_dist = np.zeros(n)
        for k in range(n):
            self._new_target(int(k))
        self.rel = self.x - (self.s + self.lean * 0.3)

    def _new_target(self, k):
        rg = self.rngs[k]
        ang = rg.uniform(-math.pi, math.pi)
        d = rg.uniform(4, 8)
        self.tx[k] = self.px[k] + math.cos(ang) * d
        self.tz[k] = self.pz[k] + math.sin(ang) * d
        self.dir_x[k] = math.cos(ang)
        self.dir_z[k] = math.sin(ang)
        self.target_dist[k] = d

    def get_obs(self):
        n = self.n
        obs = np.empty((n, 10))
        t = 2 * np.pi * self.tau
        obs[:, 0] = np.clip(self.rel / 0.3, -1.5, 1.5)
        obs[:, 1] = self.vx / 1.5
        obs[:, 2] = np.sin(t)
        obs[:, 3] = np.cos(t)
        obs[:, 4] = self.hip_l / 0.8
        obs[:, 5] = self.knee_l / 0.6
        obs[:, 6] = self.hip_r / 0.8
        obs[:, 7] = self.knee_r / 0.6
        obs[:, 8] = self.lean / HUM["LEAN"]
        obs[:, 9] = np.clip(self.target_dist / 8, 0.0, 1.5)
        return obs

    def step(self, acts):
        n = self.n
        alive = ~self.done
        if not alive.any():
            self.steps += 1
            return np.zeros(n), self.done
        a = np.clip(acts, -1, 1)
        # Gefallene Kandidaten sind terminiert (wie in der JS-Env) —
        # Physik und Reward für sie einfrieren:
        def z(vec):
            return np.where(alive, vec, 0.0)
        lean_t = z(a[:, 0]) * HUM["LEAN"]
        hip_lt = z(a[:, 1]) * 0.8
        knee_lt = 0.6 * np.clip((z(a[:, 2]) + 1) / 2, 0, 1)
        hip_rt = z(a[:, 3]) * 0.8
        knee_rt = 0.6 * np.clip((z(a[:, 4]) + 1) / 2, 0, 1)
        k1 = min(1, 8 * DT)
        k2 = min(1, 10 * DT)
        self.lean += (lean_t - self.lean) * k1 * alive
        self.hip_l += (hip_lt - self.hip_l) * k2 * alive
        self.knee_l += (knee_lt - self.knee_l) * k2 * alive
        self.hip_r += (hip_rt - self.hip_r) * k2 * alive
        self.knee_r += (knee_rt - self.knee_r) * k2 * alive

        wrap = (self.tau >= 1) & alive
        if wrap.any():
            self.tau[wrap] -= 1
            self.side[wrap] *= -1
            swing_hip = np.where(self.side == 1, z(a[:, 3]), z(a[:, 1]))
            sl = 0.15 + 0.30 * np.clip((swing_hip + 1) / 2, 0, 1)
            self.s[wrap] = self.x[wrap] + 0.35 * self.vx[wrap] + 0.5 * sl[wrap]
        self.tau += (DT / HUM["STEP_T"]) * alive
        s_eff = self.s + self.lean * 0.3
        w2 = HUM["G"] / HUM["H"]
        ax = w2 * (self.x - s_eff) * alive
        self.vx += ax * DT
        self.x += self.vx * DT
        self.rel = self.x - s_eff
        self.px += self.dir_x * self.vx * DT
        self.pz += self.dir_z * self.vx * DT
        self.target_dist -= self.vx * DT

        r = z(1.4 * self.vx + 0.4 - 0.6 * np.abs(self.rel))
        fall = ((np.abs(self.rel) > 0.42) | (np.abs(self.vx) > 2.2)) & alive
        r -= 40.0 * fall
        self.fallen |= fall
        reach = (~fall) & (self.target_dist < 0.6) & alive
        r += 25.0 * reach
        for k in np.where(reach)[0]:
            self.reached[k] += 1
            self._new_target(int(k))
        self.fit += r
        self.steps += 1
        newly = (self.steps >= EP["humanoid"]) & alive
        self.done |= fall | newly
        return r, self.done


BATCH = {"duck": DuckEnvBatch, "arm": ArmEnvBatch, "humanoid": HumanoidEnvBatch}


# ================================ Trainer ================================
def gauss_vec(shape, rng):
    return rng.standard_normal(shape)


def evaluate(robot, pop, seed):
    """Pop (40, L) → fits (40,) — batchweise 8 Geister, wie im Gerät."""
    fits = np.zeros(len(pop))
    for b in range(0, len(pop), 8):
        chunk = pop[b:b + 8]
        env = BATCH[robot](seed, len(chunk))
        for _ in range(EP[robot]):
            acts = forward_batch(np.asarray(chunk), env.get_obs(), ARCHS[robot][3])
            _, done = env.step(acts)
            done_all = bool(done) if isinstance(done, bool) else bool(np.all(done))
            if done_all:
                break
        fits[b:b + len(chunk)] = env.fit
    return fits


def train(robot, gens=120, seed=42, pop_size=40, log_every=10, champion=None, verbose=True):
    obs, act = ARCHS[robot][0], ARCHS[robot][3]
    rng = np.random.default_rng(seed)
    L = obs * 32 + 32 + 32 * 32 + 32 + act * 32 + act
    if champion is not None:
        pop = champion[None, :] + gauss_vec((pop_size, L), rng) * 0.15
        pop[0] = champion
    else:
        pop = rng.uniform(-0.5, 0.5, size=(pop_size, L))
    history = []
    champ_genome = None if champion is None else champion.copy()
    champ_fit = -1e18 if champion is None else float(evaluate(robot, champion[None, :], seed + 1)[0])
    for g in range(gens):
        fits = evaluate(robot, pop, 1000 + g)
        best_i = int(np.argmax(fits))
        best, avg = float(fits[best_i]), float(fits.mean())
        history.append((g, best, avg))
        if verbose and (g % log_every == 0 or g == gens - 1):
            print(f"gen {g:4d}  best {best:10.3f}  avg {avg:10.3f}", flush=True)
        if champ_genome is None or best > champ_fit:
            champ_genome = pop[best_i].copy()
            champ_fit = best
            if verbose:
                print(f"    ★ neuer Champion: {best:.3f}", flush=True)
        order = np.argsort(-fits)
        new_pop = [pop[i].copy() for i in order[:8]]
        while len(new_pop) < pop_size:
            pa = pop[order[rng.integers(0, 3)]]
            pb = pop[order[rng.integers(0, 3)]]
            mask = rng.random(L) < 0.5
            child = np.where(mask, pa, pb)
            mut = gauss_vec(L, rng) * 0.12
            reset_mask = rng.random(L) < 0.06
            child = child + mut
            child[reset_mask] = rng.uniform(-0.5, 0.5, size=int(reset_mask.sum()))
            new_pop.append(child)
        pop = np.array(new_pop)
    return champ_genome, champ_fit, history
