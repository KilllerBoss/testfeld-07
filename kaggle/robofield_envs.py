# Testfeld·07 — Env-Spiegel (NumPy)
#
# Drei Klassen je Roboter:
#   * <X>EnvScalar — Operation für Operation wie sim/src/envs.js (Determinismus-
#     Referenz; wird von tools/check_determinism.py gegen den Node-Lauf geprüft).
#   * <X>EnvBatch  — vektorisiert über N Kandidaten (fürs Training auf Kaggle).
#     Wird gegen die Skalar-Variante verifiziert (gleicher Seed → gleiche Fits).
#
# Formeln sind bewusst 1:1 übernommen (gleiche Reihenfolge, kein hypot, kein atan2
# in der Dynamik), damit JS (double) und NumPy (float64) bis auf libm-1-ulp
# identische Rewards liefern.
import math
import numpy as np

from robofield_common import (Mulberry32, DT, ARENA_HALF, RAY_LEN, N_RAYS,
                             RAY_SPREAD, DUCK_R, WHEEL_R, WHEEL_B, W_MAX,
                             N_OBS, EP, ARM, HUM)


def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


# ============================ MICRODUCK ============================
class DuckEnvScalar:
    N = 12

    def __init__(self, seed):
        self.reset(seed)

    def reset(self, seed):
        rng = Mulberry32(seed & 0xFFFFFFFF)
        self.rng = rng
        self.obsP = []
        for _ in range(self.N):
            while True:
                x = rng.uniform(-8.5, 8.5)
                z = rng.uniform(-8.5, 8.5)
                if math.sqrt(x * x + z * z) >= 2.5:
                    break
            r = rng.uniform(0.35, 0.85)
            h = rng.uniform(0.8, 1.4)
            self.obsP.append((x, z, r, h))
        self.x = 0.0
        self.z = 0.0
        self.heading = rng.uniform(-math.pi, math.pi)
        self.steps = 0
        self.fit = 0.0
        self.reached = 0
        self.rays = [0.0] * N_RAYS
        self._new_target()
        self._update_dist()
        self.prev_dist = self.dist

    def _new_target(self):
        rng = self.rng
        while True:
            tx = rng.uniform(-8.5, 8.5)
            tz = rng.uniform(-8.5, 8.5)
            if math.sqrt((tx - self.x) ** 2 + (tz - self.z) ** 2) <= 3.0:
                continue
            ok = True
            for (ox, oz, orr, _h) in self.obsP:
                if math.sqrt((tx - ox) ** 2 + (tz - oz) ** 2) <= orr + 0.6:
                    ok = False
                    break
            if ok:
                self.tx, self.tz = tx, tz
                return

    def _update_dist(self):
        self.dist = math.sqrt((self.tx - self.x) ** 2 + (self.tz - self.z) ** 2)

    def _compute_rays(self):
        px, pz, half = self.x, self.z, ARENA_HALF
        for i in range(N_RAYS):
            a = self.heading + (i - 4) / 4 * RAY_SPREAD
            dx, dz = math.cos(a), math.sin(a)
            t_min = RAY_LEN
            if dx > 1e-12:
                t = (half - px) / dx
                if 0 <= t < t_min:
                    t_min = t
            if dx < -1e-12:
                t = (-half - px) / dx
                if 0 <= t < t_min:
                    t_min = t
            if dz > 1e-12:
                t = (half - pz) / dz
                if 0 <= t < t_min:
                    t_min = t
            if dz < -1e-12:
                t = (-half - pz) / dz
                if 0 <= t < t_min:
                    t_min = t
            for (ox, oz, orr, _h) in self.obsP:
                rx, rz = ox - px, oz - pz
                to = rx * dx + rz * dz
                if to <= 0:
                    continue
                c2 = rx * rx + rz * rz - to * to
                rr = orr + DUCK_R
                if c2 < rr * rr:
                    th = to - math.sqrt(rr * rr - c2)
                    if 0 <= th < t_min:
                        t_min = th
            self.rays[i] = clamp(t_min / RAY_LEN, 0.0, 1.0)

    def get_obs(self):
        self._compute_rays()
        o = [0.0] * 12
        for i in range(N_RAYS):
            o[i] = self.rays[i]
        dx, dz = self.tx - self.x, self.tz - self.z
        d = max(self.dist, 1e-9)
        nx, nz = dx / d, dz / d
        fx, fz = math.cos(self.heading), math.sin(self.heading)
        o[9] = clamp(fx * nz - fz * nx, -1.0, 1.0)
        o[10] = clamp(fx * nx + fz * nz, -1.0, 1.0)
        o[11] = clamp(self.dist / 12, 0.0, 1.0)
        return o

    def step(self, a0, a1):
        a0 = clamp(a0, -1.0, 1.0)
        a1 = clamp(a1, -1.0, 1.0)
        prev_dist = self.dist
        vl, vr = a0 * W_MAX, a1 * W_MAX
        v = WHEEL_R * (vl + vr) / 2
        w = WHEEL_R * (vl - vr) / (2 * WHEEL_B)
        self.heading += w * DT
        self.x += math.cos(self.heading) * v * DT
        self.z += math.sin(self.heading) * v * DT
        self.collision = False
        for (ox, oz, orr, _h) in self.obsP:
            dx, dz = self.x - ox, self.z - oz
            d = math.sqrt(dx * dx + dz * dz)
            min_d = orr + DUCK_R
            if d < min_d:
                if d < 1e-9:
                    dx, dz, d = 1.0, 0.0, 1.0
                self.x = ox + dx / d * min_d
                self.z = oz + dz / d * min_d
                self.collision = True
        lim = ARENA_HALF - 0.3
        if self.x > lim:
            self.x = lim
            self.collision = True
        if self.x < -lim:
            self.x = -lim
            self.collision = True
        if self.z > lim:
            self.z = lim
            self.collision = True
        if self.z < -lim:
            self.z = -lim
            self.collision = True
        self._update_dist()
        r = 5.0 * (prev_dist - self.dist) + (-0.1 if self.collision else 0.0)
        if self.dist < 0.5:
            r += 25.0
            self.reached += 1
            self._new_target()
            self._update_dist()
        self.fit += r
        self.prev_dist = self.dist
        self.steps += 1
        return r, self.steps >= EP["duck"]


# ============================= ARMBOT =============================
class ArmEnvScalar:
    def __init__(self, seed):
        self.reset(seed)

    def reset(self, seed):
        rng = Mulberry32(seed & 0xFFFFFFFF)
        self.rng = rng
        self.q = [0.0, 0.35, -0.7, 0.0]
        self.dq = [0.0, 0.0, 0.0, 0.0]
        self.holding = False
        self.steps = 0
        self.fit = 0.0
        self.delivered = 0
        self._new_ball()
        self.fk()
        self.prev_eb = self._d3(self.ee, self.ball)
        self.prev_bd = 0.0

    def _new_ball(self):
        rng = self.rng
        ang = rng.uniform(-math.pi, math.pi)
        rad = rng.uniform(0.75, 1.05)
        self.ball = [rad * math.cos(ang), ARM["BALL_R"], rad * math.sin(ang)]

    @staticmethod
    def _d3(a, b):
        dx, dy, dz = a[0] - b[0], a[1] - b[1], a[2] - b[2]
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    def fk(self):
        t1 = self.q[1]
        t2 = self.q[1] + self.q[2]
        t3 = t2 + self.q[3]
        px = (math.sin(t1) * ARM["L1"] + math.sin(t2) * ARM["L2"]
              + math.sin(t3) * ARM["L3"])
        py = (ARM["HB"] + math.cos(t1) * ARM["L1"] + math.cos(t2) * ARM["L2"]
              + math.cos(t3) * ARM["L3"])
        cx, cz = math.cos(self.q[0]), math.sin(self.q[0])
        self.ee = [px * cx, py, px * cz]

    def get_obs(self):
        o = [0.0] * 15
        ranges = [ARM["Q1"], ARM["Q2"], ARM["Q3"], ARM["Q4"]]
        for i in range(4):
            o[i] = self.q[i] / ranges[i]
            o[4 + i] = self.dq[i] / ARM["VMAX"]
        o[8] = (self.ball[0] - self.ee[0]) / 2
        o[9] = (self.ball[1] - self.ee[1]) / 2
        o[10] = (self.ball[2] - self.ee[2]) / 2
        o[11] = self.ee[0] / 2
        o[12] = self.ee[1] / 2
        o[13] = self.ee[2] / 2
        o[14] = 1.0 if self.holding else 0.0
        return o

    def step(self, a0, a1, a2, a3, a4):
        acts = [a0, a1, a2, a3]
        ranges = [ARM["Q1"], ARM["Q2"], ARM["Q3"], ARM["Q4"]]
        for i in range(4):
            a = clamp(acts[i], -1.0, 1.0)
            self.dq[i] = a * ARM["VMAX"]
            self.q[i] = clamp(self.q[i] + self.dq[i] * DT, -ranges[i], ranges[i])
        grip = clamp(a4, -1.0, 1.0) > 0
        self.fk()
        r = 0.0
        if self.holding and not grip:
            self.holding = False
            if self.ball[1] < ARM["BALL_R"]:
                self.ball[1] = ARM["BALL_R"]
            self.prev_eb = self._d3(self.ee, self.ball)
        elif (not self.holding) and grip and self._d3(self.ee, self.ball) < ARM["GRIP_D"]:
            self.holding = True
            r += 2.0
            self.prev_bd = self._d3(self.ball, ARM["DZ"])
        if self.holding:
            self.ball = [self.ee[0], self.ee[1] - 0.06, self.ee[2]]
            d_bd = self._d3(self.ball, ARM["DZ"])
            r += 4.0 * (self.prev_bd - d_bd)
            self.prev_bd = d_bd
            if d_bd < ARM["DELIVER_D"]:
                r += 25.0
                self.delivered += 1
                self.holding = False
                self._new_ball()
                self.prev_eb = self._d3(self.ee, self.ball)
        else:
            d_eb = self._d3(self.ee, self.ball)
            r += 4.0 * (self.prev_eb - d_eb)
            self.prev_eb = d_eb
        self.fit += r
        self.steps += 1
        return r, self.steps >= EP["arm"]


# ============================ HUMANOID ============================
class HumanoidEnvScalar:
    def __init__(self, seed):
        self.reset(seed)

    def _new_target(self):
        rng = self.rng
        ang = rng.uniform(-math.pi, math.pi)
        d = rng.uniform(4, 8)
        self.tx = self.px + math.cos(ang) * d
        self.tz = self.pz + math.sin(ang) * d
        self.dir_x = math.cos(ang)
        self.dir_z = math.sin(ang)
        self.target_dist = d

    def reset(self, seed):
        rng = Mulberry32(seed & 0xFFFFFFFF)
        self.rng = rng
        self.px = 0.0
        self.pz = 0.0
        self.vx = 0.0
        self.x = 0.0
        self.s = -0.02
        self.tau = 0.0
        self.side = 1
        self.lean = 0.0
        self.hip_l, self.knee_l = -0.2, 0.1
        self.hip_r, self.knee_r = 0.2, 0.1
        self.steps = 0
        self.fit = 0.0
        self.reached = 0
        self.fallen = False
        self._new_target()
        self.rel = self.x - (self.s + self.lean * 2.5)

    def get_obs(self):
        o = [0.0] * 10
        t = 2 * math.pi * self.tau
        o[0] = clamp(self.rel / 0.3, -1.5, 1.5)
        o[1] = self.vx / 1.5
        o[2] = math.sin(t)
        o[3] = math.cos(t)
        o[4] = self.hip_l / 0.8
        o[5] = self.knee_l / 0.6
        o[6] = self.hip_r / 0.8
        o[7] = self.knee_r / 0.6
        o[8] = self.lean / HUM["LEAN"]
        o[9] = clamp(self.target_dist / 8, 0.0, 1.5)
        return o

    def step(self, a):
        lean_t = clamp(clamp(a[0], -1, 1), -1, 1) * HUM["LEAN"]
        hip_lt = clamp(a[1], -1, 1) * 0.8
        knee_lt = 0.6 * clamp((clamp(a[2], -1, 1) + 1) / 2, 0, 1)
        hip_rt = clamp(a[3], -1, 1) * 0.8
        knee_rt = 0.6 * clamp((clamp(a[4], -1, 1) + 1) / 2, 0, 1)
        k1 = min(1, 8 * DT)
        k2 = min(1, 10 * DT)
        self.lean += (lean_t - self.lean) * k1
        self.hip_l += (hip_lt - self.hip_l) * k2
        self.knee_l += (knee_lt - self.knee_l) * k2
        self.hip_r += (hip_rt - self.hip_r) * k2
        self.knee_r += (knee_rt - self.knee_r) * k2

        self.tau += DT / HUM["STEP_T"]
        if self.tau >= 1:
            self.tau -= 1
            self.side = -self.side
            swing_hip = a[3] if self.side == 1 else a[1]
            sl = 0.15 + 0.30 * clamp((clamp(swing_hip, -1, 1) + 1) / 2, 0, 1)
            self.s = self.x + 0.29 * self.vx + 0.1 * sl
        s_eff = self.s + self.lean * 2.5
        w2 = HUM["G"] / HUM["H"]
        ax = w2 * (self.x - s_eff)
        self.vx += ax * DT
        self.x += self.vx * DT
        self.rel = self.x - s_eff
        self.px += self.dir_x * self.vx * DT
        self.pz += self.dir_z * self.vx * DT
        self.target_dist -= self.vx * DT

        r = 1.4 * self.vx + 0.4 - 0.6 * abs(self.rel)
        done = False
        if abs(self.rel) > 0.42 or abs(self.vx) > 2.2:
            r -= 40.0
            self.fallen = True
            done = True
        elif self.target_dist < 0.6:
            r += 25.0
            self.reached += 1
            self._new_target()
        self.fit += r
        self.steps += 1
        if not done and self.steps >= EP["humanoid"]:
            done = True
        return r, done


SCALAR = {"duck": DuckEnvScalar, "arm": ArmEnvScalar, "humanoid": HumanoidEnvScalar}
