# Testfeld·07 — MuJoCo-Spiegel (pip mujoco) für Kaggle-Training.
#
# Die Kernels nutzen DIESELBEN MJCF-Modelle wie die App (echter Microduck +
# Menagerie WidowX 250 / ROBOTIS OP3) und spiegeln die On-Device-Geister
# (sim/src/mjc.js) exakt:
#   DuckMj/GhostDuck      obs 61 = gyro3 + projGrav3 + qerr14 + qvel14 + lastAct14 + cmd13
#   ArmMj/GhostArm        obs 16 = qerr6 + qvel6 + ballDir3 + grip1,  act 7
#   HumanoidMj/GhostHum   obs 46 = projGrav3 + qerr20 + qvel20 + cmd3, act 20
# 50-Hz-Regelung: 4 Substeps à 5 ms (DECIMATION 4).
import json
import math

import numpy as np

DUCK_DEFAULT_POSE = np.array([
    0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
    0.3490658503988659, 0.3490658503988659, 0, 0,
    0, 0.08726646259971647, 0.457924, 0.004940, -0.452984,
], dtype=np.float64)

ARM_HOME = [0, -0.96, 1.16, 0, -0.3, 0]
ARM_RANGE = [(-3.14, 3.14), (-1.885, 1.99), (-2.147, 1.606),
             (-3.14, 3.14), (-1.745, 2.147), (-3.14, 3.14)]
GRIP_OPEN, GRIP_CLOSED = 0.015, 0.036
ARM_BALL = (0.28, 0.12, 0.05)
ARM_JOINTS = ['waist', 'shoulder', 'elbow', 'forearm_roll', 'wrist_angle', 'wrist_rotate']

HUM_HOME = np.array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, 0.9, 0.52, 0,
                     0, 0, -0.5, 0.9, 0.52, 0], dtype=np.float64)
HUM_BALL = (0.5, 0.3, 0.05)


def _i0(v):
    return int(v[0]) if hasattr(v, '__len__') else int(v)


def _proj_grav(xquat):
    """R^T · (0,0,−1) — identisch zu mjc.js projGrav (wxyz-Quaternion)."""
    w, x, y, z = xquat
    return np.array([-(2 * (x * z - w * y)), -(2 * (w * x + y * z)), -(1 - 2 * (x * x + y * y))])


def _clamp(v, a, b):
    return a if v < a else (b if v > b else v)


class GhostDuckMj:
    """Spiegel zu GhostDuck in mjc.js."""
    OBS, ACT, DEC = 61, 14, 4

    def __init__(self, model):
        import mujoco
        self.mj = mujoco
        self.model = model
        self.data = mujoco.MjData(model)
        self.names = ['left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
                      'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll',
                      'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle']
        self.qadr = [_i0(model.jnt(n).qposadr) for n in self.names]
        self.dofadr = [_i0(model.jnt(n).dofadr) for n in self.names]
        sen = model.sensor('imu_ang_vel')
        self.gyroAdr = _i0(sen.adr)
        self.trunkId = model.body('trunk_base').id
        self.reset()

    def reset(self):
        self.mj.mj_resetDataKeyframe(self.model, self.data, 0)
        self.mj.mj_forward(self.model, self.data)
        self.steps = 0
        self.fit = 0.0
        self.done = False
        self.fallen = False
        self.lastAction = np.zeros(14)

    def get_obs(self):
        d = self.data
        obs = np.zeros(self.OBS, dtype=np.float64)
        i = 0
        obs[i:i + 3] = d.sensordata[self.gyroAdr:self.gyroAdr + 3]
        i += 3
        obs[i:i + 3] = _proj_grav(d.body(self.trunkId).xquat)
        i += 3
        for j in range(14):
            obs[i + j] = d.qpos[self.qadr[j]] - DUCK_DEFAULT_POSE[j]
        i += 14
        for j in range(14):
            obs[i + j] = d.qvel[self.dofadr[j]]
        i += 14
        obs[i:i + 14] = self.lastAction
        i += 14
        # cmd 13 = 0 (Trainings-Command neutral, wie mjc.js)
        return obs

    def step(self, act):
        d = self.data
        for j in range(14):
            a = float(np.clip(act[j], -1, 1))
            self.lastAction[j] = a
            d.ctrl[j] = DUCK_DEFAULT_POSE[j] + a
        for _ in range(self.DEC):
            self.mj.mj_step(self.model, d)
            self.steps += 1
        if not np.all(np.isfinite(d.qpos)):
            # Numerischer Ausreißer (QACC-Warnung): sauber zurücksetzen
            self.mj.mj_resetDataKeyframe(self.model, d, 0)
            self.mj.mj_forward(self.model, self.data)
            self.fallen = True
            self.done = True
            return self.done
        g = _proj_grav(d.body(self.trunkId).xquat)
        self.fallen = (g[2] > -0.5) or (d.qpos[2] < 0.02)
        self.fit = d.qpos[0] - (-0.6) - (1.0 if self.fallen else 0.0)
        if self.fallen or self.steps >= 300:
            self.done = True
        return self.done


class GhostArmMj:
    """Spiegel zu GhostArm in mjc.js (MLP steuert Referenz-Deltas + Greifer)."""
    OBS, ACT, DEC = 16, 7, 4

    def __init__(self, model):
        import mujoco
        self.mj = mujoco
        self.model = model
        self.data = mujoco.MjData(model)
        self.qadr = [_i0(model.jnt(n).qposadr) for n in ARM_JOINTS]
        self.dofadr = [_i0(model.jnt(n).dofadr) for n in ARM_JOINTS]
        self.eeId = _i0(model.body('wx250s/gripper_link').id)
        self.ballAdr = _i0(model.jnt('ball_freejoint').qposadr)
        self.reset()

    def reset(self):
        self.mj.mj_resetDataKeyframe(self.model, self.data, 0)
        a = self.ballAdr
        self.data.qpos[a:a + 3] = ARM_BALL
        self.data.qpos[a + 3] = 1.0
        self.data.qpos[a + 4:a + 7] = 0.0
        self.mj.mj_forward(self.model, self.data)
        self.ref = list(ARM_HOME)
        self.grip = 0
        self.steps = 0
        self.fit = 0.0
        self.done = False

    def ee_pos(self):
        return np.array(self.data.body(self.eeId).xpos, dtype=np.float64)

    def ball_pos(self):
        return np.array(self.data.qpos[self.ballAdr:self.ballAdr + 3], dtype=np.float64)

    def get_obs(self):
        d = self.data
        obs = np.zeros(self.OBS, dtype=np.float64)
        for j in range(6):
            obs[j] = d.qpos[self.qadr[j]] - self.ref[j]
        for j in range(6):
            obs[6 + j] = d.qvel[self.dofadr[j]]
        bd = self.ball_pos() - self.ee_pos()
        obs[12:15] = bd
        obs[15] = self.grip
        return obs

    def step(self, act):
        d = self.data
        for j in range(6):
            a = float(np.clip(act[j], -1, 1))
            lo, hi = ARM_RANGE[j]
            self.ref[j] = _clamp(self.ref[j] + a * 0.3, lo, hi)
            d.ctrl[j] = self.ref[j]
        self.grip = 1 if act[6] > 0 else 0
        d.ctrl[6] = GRIP_CLOSED if self.grip else GRIP_OPEN
        for _ in range(self.DEC):
            self.mj.mj_step(self.model, d)
            self.steps += 1
        if not np.all(np.isfinite(d.qpos)):
            # Numerischer Ausreißer (QACC-Warnung): sauber zurücksetzen
            self.mj.mj_resetDataKeyframe(self.model, d, 0)
            self.mj.mj_forward(self.model, self.data)
            self.fallen = True
            self.done = True
            return self.done
        dist = float(np.linalg.norm(self.ball_pos() - self.ee_pos()))
        holding = self.grip and dist < 0.045 and self.ball_pos()[2] > 0.03
        self.fit = max(0.0, 1 - dist / 0.3) * 3 + ((4 + (self.ball_pos()[2] - 0.05) * 30) if holding else 0.0)
        if self.steps >= 400:
            self.done = True
        return self.done


class GhostHumMj:
    """Spiegel zu GhostHumanoid in mjc.js."""
    OBS, ACT, DEC = 46, 20, 4

    def __init__(self, model):
        import mujoco
        self.mj = mujoco
        self.model = model
        self.data = mujoco.MjData(model)
        self.names = ['head_pan', 'head_tilt', 'l_sho_pitch', 'l_sho_roll', 'l_el',
                      'r_sho_pitch', 'r_sho_roll', 'r_el',
                      'l_hip_yaw', 'l_hip_roll', 'l_hip_pitch', 'l_knee', 'l_ank_pitch', 'l_ank_roll',
                      'r_hip_yaw', 'r_hip_roll', 'r_hip_pitch', 'r_knee', 'r_ank_pitch', 'r_ank_roll']
        self.qadr = [_i0(model.jnt(n).qposadr) for n in self.names]
        self.dofadr = [_i0(model.jnt(n).dofadr) for n in self.names]
        self.trunkId = _i0(model.body('body_link').id)
        self.ballAdr = _i0(model.jnt('ball_freejoint').qposadr)
        self.reset()

    def reset(self):
        self.mj.mj_resetDataKeyframe(self.model, self.data, 0)
        a = self.ballAdr
        self.data.qpos[a:a + 3] = HUM_BALL
        self.data.qpos[a + 3] = 1.0
        self.data.qpos[a + 4:a + 7] = 0.0
        self.mj.mj_forward(self.model, self.data)
        self.steps = 0
        self.fit = 0.0
        self.done = False
        self.fallen = False
        self.x0 = self.data.qpos[0]

    def get_obs(self):
        d = self.data
        obs = np.zeros(self.OBS, dtype=np.float64)
        obs[0:3] = _proj_grav(d.body(self.trunkId).xquat)
        for j in range(20):
            obs[3 + j] = d.qpos[self.qadr[j]] - HUM_HOME[j]
        for j in range(20):
            obs[23 + j] = d.qvel[self.dofadr[j]]
        # cmd = 0 (neutral)
        return obs

    def step(self, act):
        d = self.data
        for j in range(20):
            d.ctrl[j] = HUM_HOME[j] + float(np.clip(act[j], -1, 1)) * 0.5
        for _ in range(self.DEC):
            self.mj.mj_step(self.model, d)
            self.steps += 1
        if not np.all(np.isfinite(d.qpos)):
            # Numerischer Ausreißer (QACC-Warnung): sauber zurücksetzen
            self.mj.mj_resetDataKeyframe(self.model, d, 0)
            self.mj.mj_forward(self.model, self.data)
            self.fallen = True
            self.done = True
            return self.done
        g = _proj_grav(d.body(self.trunkId).xquat)
        self.fallen = (g[2] > -0.5) or (d.qpos[2] < 0.18)
        self.fit = (d.qpos[0] - self.x0) * 10 - (3.0 if self.fallen else 0.0)
        if self.fallen or self.steps >= 600:
            self.done = True
        return self.done


# ============================ Neuroevolution ============================
HIDDEN = 32


def weight_count(obs, act):
    return obs * HIDDEN + HIDDEN + HIDDEN * HIDDEN + HIDDEN + act * HIDDEN + act


def init_genome(rng, obs, act):
    flat = np.zeros(weight_count(obs, act))
    sizes = [obs * HIDDEN, HIDDEN, HIDDEN * HIDDEN, HIDDEN, act * HIDDEN, act]
    fans = [(obs, HIDDEN), (HIDDEN, 0), (HIDDEN, HIDDEN), (HIDDEN, 0), (HIDDEN, act), (act, 0)]
    off = 0
    for k in range(6):
        lim = 0.1 if fans[k][1] == 0 else math.sqrt(6.0 / (fans[k][0] + fans[k][1]))
        flat[off:off + sizes[k]] = rng.uniform(-lim, lim, sizes[k])
        off += sizes[k]
    return flat


def forward(flat, obs, n_act):
    o = obs.shape[0]
    b1 = o * HIDDEN
    w2 = b1 + HIDDEN
    b2 = w2 + HIDDEN * HIDDEN
    w3 = b2 + HIDDEN
    b3 = w3 + n_act * HIDDEN
    h1 = np.tanh(flat[:b1].reshape(HIDDEN, o) @ obs + flat[b1:b1 + HIDDEN])
    h2 = np.tanh(flat[w2:b2].reshape(HIDDEN, HIDDEN) @ h1 + flat[b2:w3])
    return np.tanh(flat[w3:b3].reshape(n_act, HIDDEN) @ h2 + flat[b3:])


def mutate(rng, src, sigma):
    g = src.copy()
    mask = rng.random(len(g)) < 0.06
    g[mask] = rng.uniform(-0.5, 0.5, mask.sum())
    g[~mask] += rng.standard_normal((~mask).sum()) * sigma
    return g


def train(model, GhostClass, gens, seed=1234, pop_size=40, log_every=10):
    """Neuroevolution (40 Individuen, Elite 8, Turnier-3-Crossover)."""
    rng = np.random.default_rng(seed)
    obs, act = GhostClass.OBS, GhostClass.ACT
    pop = [init_genome(rng, obs, act) for _ in range(pop_size)]
    fits = np.zeros(pop_size)
    champ, champ_fit = None, -1e18
    history = []
    for gen in range(gens):
        fits.fill(0.0)
        for b in range(10):  # 10 Batches à 4 (wie On-Device)
            envs = [GhostClass(model) for _ in range(4)]
            genomes = pop[b * 4:(b + 1) * 4]
            for env, g in zip(envs, genomes):
                while not env.done:
                    env.step(forward(g, env.get_obs(), act))
                fits[b * 4 + list(genomes).index(g)] = env.fit
            for env in envs:
                del env
        best_i = int(np.argmax(fits))
        best = float(fits[best_i])
        avg = float(fits.mean())
        history.append({'gen': gen, 'best': best, 'avg': avg})
        if best > champ_fit:
            champ_fit = best
            champ = pop[best_i].copy()
            print(f'[GEN {gen}] NEUER CHAMPION: fit {best:.1f} (avg {avg:.1f})', flush=True)
        elif gen % log_every == 0:
            print(f'[GEN {gen}] best {best:.1f} avg {avg:.1f}', flush=True)
        order = np.argsort(-fits)
        new_pop = [pop[i].copy() for i in order[:8]]
        while len(new_pop) < pop_size:
            pa = pop[order[rng.integers(0, 3)]]
            pb = pop[order[rng.integers(0, 3)]]
            mask = rng.random(len(pa)) < 0.5
            child = np.where(mask, pa, pb)
            new_pop.append(mutate(rng, child, 0.12))
        pop = new_pop
    return champ, champ_fit, history


def genome_to_policy(robot, arch, flat, gen, fit, src='kaggle-mj'):
    o, a = arch[0], arch[3]
    sizes = [o * HIDDEN, HIDDEN, HIDDEN * HIDDEN, HIDDEN, a * HIDDEN, a]
    weights, off = [], 0
    for k in range(6):
        weights.append([float(x) for x in flat[off:off + sizes[k]]])
        off += sizes[k]
    return {
        'format': 'robofield-policy-v1',
        'robot': robot,
        'arch': list(arch),
        'weights': weights,
        'gen': int(gen),
        'fit': float(fit),
        'src': src,
    }
