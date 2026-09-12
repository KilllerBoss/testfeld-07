// ═══════════════════════════════════════════════════════════
// math.js — Quaternion-, Vektor- und Statistik-Helfer (CPU)
// Teil von Trainrobot · Testfeld·07 — keine externen Abhängigkeiten
// ═══════════════════════════════════════════════════════════

export function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export function lerp(a, b, t) { return a + (b - a) * t; }

export function ema(prev, x, alpha) { return prev === null ? x : prev + alpha * (x - prev); }

// Quaternion [w,x,y,z] → Roll/Pitch/Yaw (ZYX, Radiant)
export function quatRPY(q, out) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const sinp = clamp(2 * (w * y - z * x), -1, 1);
  out[0] = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)); // roll
  out[1] = Math.asin(sinp);                                          // pitch
  out[2] = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); // yaw
  return out;
}

// Weltrichtung v (3) um Quaternion q (w,x,y,z) in den Körperrahmen drehen
export function rotWorldToBody(q, vx, vy, vz, out) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  // Konjugierte Quaternion anwenden: v' = q* ⊙ v ⊙ q
  const bx = -x, by = -y, bz = -z;
  // t = q_conj * v  (Quaternion-Multiplikation mit reinem Vektor)
  const tx = w * vx + by * vz - bz * vy;
  const ty = w * vy + bz * vx - bx * vz;
  const tz = w * vz + bx * vy - by * vx;
  const tw = -(bx * vx + by * vy + bz * vz);
  // Ergebnis = t * q
  out[0] = tw * bx + tx * w + ty * bz - tz * by;
  out[1] = tw * by + ty * w + tz * bx - tx * bz;
  out[2] = tw * bz + tz * w + tx * by - ty * bx;
  return out;
}

// Up-Vektor (Körper-z in Welt) aus Quaternion — für Belohnungsformeln
export function upFromQuat(q, out) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  out[0] = 2 * (x * z + w * y);
  out[1] = 2 * (y * z - w * x);
  out[2] = 1 - 2 * (x * x + y * y);
  return out;
}

// Deterministischer Zufall (LCG) für reproduzierbares Training
export class RNG {
  constructor(seed = 0x2f6e2b1) { this.s = seed >>> 0; }
  next() {
    // Numerische Rezepte (Park–Miller), 32 Bit
    let s = this.s;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    this.s = s;
    return s / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n) % n; }
}
