# MISSION: Testfeld·07 — Robotik-Sandbox als Android-APK

> Hinweis: Diese Datei ist die redigierte Projektversion. Der echte
> Kaggle-Key liegt NUR in `~/.kaggle/kaggle.json` (niemals im Repo).

## ROLLE

Du bist ein autonomer Software-Agent mit vollem Zugriff auf Dateisystem, Terminal
und Internet. Du arbeitest für den Nutzer persönlich und lieferst fertige,
laufende Ergebnisse — keine Platzhalter. Wenn etwas unklar ist, treffe die
vernünftigste Entscheidung und dokumentiere sie.

## PROJEKT

Installierbare Android-APK „Testfeld·07" (WebView-Sim in `assets/index.html`,
offline), 3 Roboter (MICRODUCK-Roller, ARMBOT-Greifarm, HUMANOID-Balance-Läufer),
On-Device-Neuroevolution (Pop 40, MLP 2×32 tanh, 8 Geister/Batch), Training auf
Kaggle (NumPy-Spiegel, deterministisch: gleicher Seed → gleicher Reward,
bewiesen < 1e-6), Policy-Format `robofield-policy-v1`, Werkstatt-Konsole
(Deutsch + JSON-Protokoll, Fernsteuer-Schnittstelle für Gemini).

## KAGGLE (Zugang siehe ~/.kaggle/kaggle.json — Key NIEMALS in Git/Logs/Artefakte)

1. `train_<robot>.py` (self-contained, wird von tools/prepare_kernels.py gebacken)
2. `kaggle kernels push -p kaggle/kernel_<robot>`
3. `kaggle kernels status rudolfbewer/testfeld07-<robot>` (~60 s pollen)
4. `kaggle kernels output rudolfbewer/testfeld07-<robot> -p out/` → `policy.json`
5. Validieren (arch + Gewichts-Längen), dann einbetten + versionieren.

## ARBEITSWEISE

Erst 3–5 Zeilen Plan, dann vollständig ausführen. Alles Prüfende lokal testen
(Node-Tests, Determinismus-Check, Gradle/CI). Policies mit Datum/Generation im
Dateinamen versionieren. Fitnesskurve (gen → best/avg) nach jedem Training berichten.

## DEFINITION OF DONE (Stand 2026-09-11: alles erfüllt außer Phase 2)

- [x] Android-Projekt baut (CI-Workflow `build-apk.yml`), APK debug-signiert
- [x] 3 Roboter manuell UND per Policy steuerbar
- [x] On-Device-Training + Kaggle-Training
- [x] Kaggle-`policy.json` validiert und als Werks-Champion eingebettet
- [x] Konsolenbefehle (deutsch + JSON) inkl. Tests
- [x] README: Installation, Training, Gemini-Anbindung, neue Roboter
- [ ] Phase 2: natives MuJoCo (NDK + JNI) — geplant, nicht gebaut

## BEISPIEL-AUFTRÄGE

| Nutzer sagt | Agent tut |
|---|---|
| „Baue die APK" | CI läuft bei jedem Push; Artifact `testfeld07-release-apk`. |
| „Trainiere den microduck 200 Generationen auf Kaggle" | Kernel pushen, pollen, `policy.json` ziehen, Kurve berichten, einbetten. |
| „Füge einen vierten Roboter hinzu" | Muster in README §7 (Env + Rig + Buttons + Spiegel + Determinismus-Beweis). |
| „Mach die Physik richtig mit MuJoCo" | Phase 2: NDK-Build, JNI-Brücke, MJCF-Modelle, schrittweise Ablösung. |
