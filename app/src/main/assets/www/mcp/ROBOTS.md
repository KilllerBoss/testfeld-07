# ROBOTS — Alle 3 Roboter (obs/actions byte-genau)

Regelrate 50 Hz (CTRL_DT 0.02 s), Physik-Substeps je nach Modell (dt 0.002 → 10 Substeps).
Action = tanh-begrenzte Abweichung von der Keyframe-Pose: ctrl = ref + actSpan·tanh(a·J).

## Unitree G1 (Humanoid, 29 Akt.) — auch GLB-Motion-Tracking
- obs 70: q−ref(29) | dq(29) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd(2) | lastAct(29) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) — mit GLB-Clip: Motion-Task (anderer Aufbau, cmd/Trigger-Kanäle)
- done: upz < 0.6, zMin 0.35; cmd vx −0.3..0.5, yaw ±0.8

## MicroDuck (Pollen Robotics · Hugging Face) — SOFT-MOE, 14 Akt.
- obs 74: q−ref(14) | dq(14) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd.vx(1) | cmd.yaw(1) | lastAct(14) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) | **SOFT-KOMMANDOS(13): vx, vy, wz, skill[4]=balance/walk/turn/recover, style[6]=neutral+5**
- POLICY-Modus: der echte Stick schreibt die Soft-Kommandos (vx auf Level-Band geklemmt, skill-Form geht aus dem Befehl hervor). Der Zufalls-Scheduler pausiert dann.
- Curriculum L1–L5: vxMax 0.10→0.30 m/s, wzMax 0.3→1.0, Aktionsamplitude 0.16→0.35, DR wächst
- Sensoren: IMU (framequat/gyro/velocimeter/accelerometer), Fußkontakte über Kontakt-Geoms
- **Kamera: `<camera name="head_camera">` am Kopf** — wird NUR für das FPV-Rechteck genutzt (setCamera), NICHT als Policy-Eingang. Kein Infrarot-Sensor.

## Skydio X2 (Drohne, 4 Akt.) — Kaskadenregler-Task
- obs 15, act 4 (Rotor-Sollwerte); cmd.alt = Höhe; done: zMin/upMin/xyMax

## AUSSEHEN (setAppearance, v2.14.0) — nur Rendering
- Teile = Material-, Body- oder Geom-Namen des aktiven Modells ({list:true} liefert den Katalog).
- G1: Material-Namen der Menagerie-Geoms; MicroDuck: z. B. jaw_material, top_head_shell_material, noenoeil_material (Schnabel orange!), foot_left/right_material; X2: Basis-Material.
- color "#rrggbb", shine (Glanz 0–1 → Roughness), metal (Metallik 0–1). Physik/Masse bleibt unberührt.

## Kamera/Sensoren (alle)
- Kein Roboter hat einen realen Kamera-Eingang in die Policy. FPV = virtuelle Kamera am Kopf/Torso/Basis, render-only (fpv.js), Vision-Modell-Kanal absichtlich LEER (Canvas → ONNX wäre der künftige Hook).
- IMU-Sensorik geht in die obs (gyro/projGrav), mit DR-Rauschen wenn Störungen an.
