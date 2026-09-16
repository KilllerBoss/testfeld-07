# ROBOTS — Alle 6 Roboter (obs/actions byte-genau)

Regelrate 50 Hz (CTRL_DT 0.02 s), Physik-Substeps je nach Modell (dt 0.002 → 10 Substeps).
Action = tanh-begrenzte Abweichung von der Keyframe-Pose: ctrl = ref + actSpan·tanh(a·J).

## Unitree A1 / Boston Dynamics Spot / Unitree Go2 (Quadruped, je 12 Akt.)
- obs (A1/Go2 46, Spot 46): q−ref(12) | dq(12) | up-Vektor(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd.vx(1) | cmd.yaw(1) | lastAct(12) | gyro(3) | projGrav(3) | height(1) | Fußkontakte(4) | sin/cos Phasen-Uhr(2)
- done: upz < 0.45 | height < zMin | > zMax; cmd-Bänder: A1 vx −0.6..1.0, Spot −0.5..0.9, Go2 −0.6..1.1
- actSpan 0.5–0.55; Fußkörper: *_calf bzw. *_lleg

## Unitree G1 (Humanoid, 29 Akt.) — auch GLB-Motion-Tracking
- obs 70: q−ref(29) | dq(29) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd(2) | lastAct(29) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) — mit GLB-Clip: Motion-Task (anderer Aufbau, cmd/Trigger-Kanäle)
- done: upz < 0.6, zMin 0.35

## MicroDuck (Pollen Robotics · Hugging Face) — SOFT-MOE, 14 Akt.
- obs 74: q−ref(14) | dq(14) | up(3) | yawRate(1) | vFwd(1) | vLat(1) | cmd.vx(1) | cmd.yaw(1) | lastAct(14) | gyro(3) | projGrav(3) | height(1) | Füße(2) | Uhr(2) | **SOFT-KOMMANDOS(13): vx, vy, wz, skill[4]=balance/walk/turn/recover, style[6]=neutral+5**
- POLICY-Modus: der echte Stick schreibt die Soft-Kommandos (vx auf Level-Band geklemmt, skill-Form geht aus dem Befehl hervor). Der Zufalls-Scheduler pausiert dann.
- Curriculum L1–L5: vxMax 0.10→0.30 m/s, wzMax 0.3→1.0, Aktionsamplitude 0.16→0.35, DR wächst
- Sensoren: IMU (framequat/gyro/velocimeter/accelerometer), Fußkontakte über Kontakt-Geoms
- **Kamera: `<camera name="head_camera">` am Kopf** — wird NUR für das FPV-Rechteck genutzt (setCamera), NICHT als Policy-Eingang. Kein Infrarot-Sensor.

## Skydio X2 (Drohne, 4 Akt.) — Kaskadenregler-Task
- obs 15, act 4 (Rotor-Sollwerte); cmd.alt = Höhe; done: zMin/upMin/xyMax

## Kamera/Sensoren (alle)
- Kein Roboter hat einen realen Kamera-Eingang in die Policy. FPV = virtuelle Kamera am Kopf/Torso/Basis, render-only (fpv.js), Vision-Modell-Kanal absichtlich LEER (Canvas → ONNX wäre der künftige Hook).
- IMU-Sensorik geht in die obs (gyro/projGrav), mit DR-Rauschen wenn Störungen an.
