// ═══════════════════════════════════════════════════════════
// qpos.js — v2.22.0 „ARDY-BRÜCKE": NVIDIA-ARDY-QPOS-CSV-Import
// als MOTION-LEHRER (ohne eigenes CUDA — ARDY läuft z. B. auf
// einer kostenlosen Colab-GPU, siehe scripts/ardy_colab.ipynb).
//
// ARDY (NVIDIA, SIGGRAPH 2026 — github.com/nv-tlabs/ardy) generiert
// Text→Motion für das Unitree-G1-Skelett und exportiert per
// `generate.py --model g1 --output …` eine MuJoCo-QPOS-CSV:
//   - eine Zeile pro Frame, KEIN Header, Komma-separiert
//   - 36 Spalten: root_xyz (3) + root_quat w,x,y,z (4) + 29 DoF
//   - Koordinaten: MuJoCo (z hoch, x vorwärts) — wie unsere App
// Das G1 der App (Menagerie unitree_g1/g1.xml) hat EXAKT dieselbe
// Gelenkliste in derselben Reihenfolge (29 Scharniere: Beine 6+6,
// Taille 3, Arme 7+7 — nachgewiesen in qpos_v2220_test.mjs), daher
// ist das Mapping 1:1 und die CSV wird direkt zum Lehrer-Clip:
// Geist, BC, PPO-Motion-Tracking und MOTION-KI funktionieren wie
// mit GLB-Clips — nur OHNE Retargeting.
// ═══════════════════════════════════════════════════════════

// ARDY-G1-Checkpoints sind 25 fps (ARDY-G1-RP-25FPS-Horizon52/8)
export const ARDY_G1_FPS = 25;
// root(7) + 29 DoF = nq des Menagerie-G1
export const ARDY_G1_NQ = 36;
// alg ≥ RT_ALG (retarget.js): CSV-Clips sind NIEMALS re-retargetbar
// (kein GLB vorhanden) — 99 stellt sicher, dass kein Re-Retarget getriggert wird.
const QPOS_ALG = 99;

/**
 * ARDY-QPOS-CSV-Text → Motion-Objekt im Format der App
 * (identisch zu retargetToRobot-Ausgabe, ohne srcPos/srcJoints —
 * der kinematische Geist kommt aus clip.q via setGhostPose).
 *
 * @param {string} text   CSV-Inhalt
 * @param {object} opts   { name?, fps? }
 * @returns {object} motion (q,h,root,yaw,baseQ,fps,n,nu,…)
 * @throws Error mit deutscher, nutzbarer Meldung
 */
export function parseQposCsv(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Die CSV-Datei ist leer.');
  }
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const parts = line.split(',').map((s) => s.trim());
    // Header-Zeile? (nichtnumerisch) → klar ablehnen mit Hinweis
    if (parts.some((p) => p !== '' && !Number.isFinite(+p))) {
      throw new Error(
        'Zeile ' + (li + 1) + ' ist nicht numerisch — das ist keine ARDY-QPOS-CSV. ' +
        'Erzeuge sie mit ARDY: python scripts/generate.py "…" --model g1 --output … (kein Header, 36 Spalten).'
      );
    }
    if (parts.length < ARDY_G1_NQ) {
      throw new Error(
        'Zeile ' + (li + 1) + ' hat nur ' + parts.length + ' Spalten — ARDY-G1-QPOS braucht ' + ARDY_G1_NQ +
        ' (root 3 + Quat 4 + 29 Gelenke). Passen die Modelle? --model g1 verwenden.'
      );
    }
    const row = new Float64Array(ARDY_G1_NQ);
    for (let c = 0; c < ARDY_G1_NQ; c++) row[c] = +parts[c];
    rows.push(row);
  }
  if (rows.length < 2) {
    throw new Error('Zu wenige Frames (' + rows.length + ') — eine Bewegung braucht ≥ 2 Zeilen.');
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let c = 0; c < ARDY_G1_NQ; c++) {
      if (!Number.isFinite(r[c])) {
        throw new Error('Zeile ' + (i + 1) + ', Spalte ' + (c + 1) + ' ist keine gültige Zahl.');
      }
    }
  }

  const n = rows.length;
  const nu = 29;
  const fps = Math.max(1, Math.min(120, +opts.fps || ARDY_G1_FPS));
  const q = new Float32Array(n * nu);
  const h = new Float32Array(n);
  const root = new Float32Array(2 * n);
  const yaw = new Float32Array(n);
  const baseQ = new Float32Array(4 * n);

  const x0 = rows[0][0], y0 = rows[0][1];
  let prevYaw = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    // Gelenkwinkel 1:1 (gleiche Gelenkliste/Reihenfolge wie g1.xml)
    for (let j = 0; j < nu; j++) q[i * nu + j] = r[7 + j];
    // Root: Bahn relativ zum ersten Frame (Szene-Origin), Höhe = pelvis z
    root[2 * i] = r[0] - x0;
    root[2 * i + 1] = r[1] - y0;
    h[i] = r[2];
    // Quat [w,x,y,z] (MuJoCo-Skalarenreihenfolge) → Yaw + Basis-Quat
    const w = r[3], x = r[4], y = r[5], z = r[6];
    const yawi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    // Yaw entfalten (stetige Bahn für Loop-Naht/Interpolation);
    // Frame 0 bleibt im Bereich [-π, π]
    let yw = yawi;
    if (i > 0) {
      let dy = yw - prevYaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      yw = prevYaw + dy;
    }
    yaw[i] = yw;
    prevYaw = yw;
    baseQ[4 * i] = w; baseQ[4 * i + 1] = x; baseQ[4 * i + 2] = y; baseQ[4 * i + 3] = z;
  }

  // Tempo: mittlere horizontale Bahngeschwindigkeit (wie Retarget)
  let dist = 0;
  for (let i = 1; i < n; i++) {
    dist += Math.hypot(root[2 * i] - root[2 * (i - 1)], root[2 * i + 1] - root[2 * (i - 1) + 1]);
  }
  const meanSpeed = (dist / Math.max(1, n - 1)) * fps;

  return {
    name: opts.name || 'ARDY-Motion',
    q, h, root, yaw, baseQ,
    fps, n, nu,
    duration: n / fps,
    mapped: [],            // keine GLB-Knochen — G1 direkt
    mergedFrom: 0,
    alg: QPOS_ALG,         // nie Re-Retarget (kein GLB)
    meanSpeed,
    locomotion: meanSpeed > 0.1,
    robotId: 'g1',         // ARDY-G1-Skelett = App-G1
    src: 'ardy',           // Herkunfts-Badge
  };
}
