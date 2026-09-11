package com.trainrobot.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

/**
 * Trainrobot — Einstieg: Roboterwahl + optionale Gemini-Konfiguration.
 *
 * Roboter (alles echtes MuJoCo-WASM, kein Fallback):
 *   MICRODUCK — offizieller microduck-simulator (HF-Space-Dist)
 *   ARMBOT    — WidowX 250 6DOF (Menagerie, ROBOLAB-Zweig)
 *   HUMANOID  — ROBOTIS OP3 (Menagerie, ROBOLAB-Zweig)
 */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        RadioGroup robotGroup = findViewById(R.id.robotGroup);
        CheckBox geminiToggle = findViewById(R.id.geminiToggle);
        EditText geminiKey = findViewById(R.id.geminiKey);
        EditText mission = findViewById(R.id.mission);
        TextView status = findViewById(R.id.status);

        findViewById(R.id.btnSim).setOnClickListener(v -> {
            int sel = robotGroup.getCheckedRadioButtonId();
            String robot = "duck";
            if (sel == R.id.robotArm) robot = "arm";
            else if (sel == R.id.robotHumanoid) robot = "humanoid";
            Intent i = new Intent(this, SimActivity.class)
                    .putExtra("robot", robot)
                    .putExtra("gemini_key",
                            geminiToggle.isChecked() ? geminiKey.getText().toString().trim() : "")
                    .putExtra("mission", mission.getText().toString().trim())
                    .putExtra("gemini_model", "gemini-2.0-flash");
            startActivity(i);
        });

        status.setText("Bereit. Roboter wählen und starten — alles läuft komplett "
                + "offline auf dem Gerät (MuJoCo-WASM-Physik @ 50 Hz). Kein Fallback "
                + "vorhanden — bei Boot-Problemen erscheint eine klare Fehlermeldung.");
    }
}
