package com.trainrobot.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

/**
 * Trainrobot — Einstieg (Portierung der Referenz-App-MainActivity, ohne
 * Bruecken-Modus): Startet die on-device 3D-Simulation und übergibt optional
 * Gemini-Key + Mission für den High-Level-Autopiloten.
 */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        CheckBox geminiToggle = findViewById(R.id.geminiToggle);
        EditText geminiKey = findViewById(R.id.geminiKey);
        EditText mission = findViewById(R.id.mission);
        TextView status = findViewById(R.id.status);

        findViewById(R.id.btnSim).setOnClickListener(v -> {
            Intent i = new Intent(this, SimActivity.class)
                    .putExtra("gemini_key",
                            geminiToggle.isChecked() ? geminiKey.getText().toString().trim() : "")
                    .putExtra("mission", mission.getText().toString().trim())
                    .putExtra("gemini_model", "gemini-2.0-flash");
            startActivity(i);
        });

        status.setText("Bereit. Die 3D-Simulation läuft komplett offline auf dem Gerät "
                + "(MuJoCo-WASM-Physik + trainierte Policy @ 50 Hz). Kein Fallback vorhanden — "
                + "bei Boot-Problemen erscheint eine klare Fehlermeldung.");
    }
}
