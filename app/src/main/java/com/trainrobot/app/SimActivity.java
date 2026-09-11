package com.trainrobot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;

/**
 * Trainrobot — 3D-Simulation in Vollbild-WebView.
 *
 * Zwei Sim-Zweige, beide 100 % MuJoCo-WASM, KEIN Fallback:
 *   MICRODUCK : offizieller microduck-simulator (HF-Space-Dist) unter
 *               /assets/sim/  — onnxruntime-web-Policies @ 50 Hz.
 *   ARMBOT /  : ROBOLAB (Menagerie-Modelle WidowX 250 + ROBOTIS OP3) unter
 *   HUMANOID    /assets/robo/index.html?robot=arm|humanoid — robofield-
 *               policy-v1-Champions direkt auf den MJ-Geistern (nn.js).
 *
 * Assets laufen über https://appassets.androidplatform.net (WebViewAssetLoader),
 * damit relative fetches, ES-Module und WASM offline funktionieren. Kein file://.
 *
 * Die frühere native Kontrollleiste (Autopilot/Reset/Zurück) ist ENTFERNT —
 * Zurück funktioniert über die System-Zurück-Taste. Der Gemini-Autopilot
 * bleibt als Bibliothek (GeminiClient) erhalten, hat aber keine
 * Overlay-Buttons mehr in der Szene.
 */
public class SimActivity extends Activity {
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_sim);

        robot = getIntent().getStringExtra("robot");
        if (robot == null || robot.isEmpty()) robot = DUCK;

        web = findViewById(R.id.simWebView);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setBackgroundColor(0xFF0B0B10);

        // Asset-Hosting ueber https://appassets.androidplatform.net —
        // Handler-Reihenfolge entscheidet: erst die Dokumente unter
        // /assets/sim/ (offizieller Space) und /assets/robo/ (ROBOLAB),
        // danach Root-Handler für die host-absoluten Vite-Pfade
        // (/bundle, /policies, /robot, /assets).
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/sim/", new SimAssetHandler(this, "sim"))
                .addPathHandler("/assets/robo/", new SimAssetHandler(this, "robo"))
                .addPathHandler("/", new SimAssetHandler(this, "sim"))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (DUCK.equals(robot)) pollGameReady(0); // md_bridge fuer den offiziellen Sim
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidHost");

        String url;
        if (!DUCK.equals(robot)) {
            // ROBOLAB-Zweig (Menagerie): eigener Joystick, eigene KONSOLE
            url = "https://appassets.androidplatform.net/assets/robo/index.html?robot=" + robot;
        } else {
            // Offizieller microduck-simulator.
            // ?boot=1: Title-Screen überspringen (eingebauter Test-Hook der Sim)
            // ?touch=1: Touch-Steuerung aktivieren, ?noghosts: kein WebRTC-Multiplayer
            url = "https://appassets.androidplatform.net/assets/sim/index.html?boot=1&touch=1&noghosts";
        }
        web.loadUrl(url);
    }

    private static final String DUCK = "duck";
    private String robot = DUCK;

    /** Wartet darauf, dass window.rl (Game-API des offiziellen Sims) bereit ist,
     *  injiziert dann die md_bridge.js (GeminiSource + getState + notify). */
    private void pollGameReady(int attempt) {
        if (attempt > 120) return; // ~60 s — Sim laeuft auch ohne Bridge weiter
        web.evaluateJavascript("(!!(window.rl && rl.controller))", ready -> {
            if ("true".equals(ready)) injectBridge();
            else web.postDelayed(() -> pollGameReady(attempt + 1), 500);
        });
    }

    private void injectBridge() {
        String js;
        try (java.io.InputStream in = getAssets().open("md_bridge.js");
             java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            js = sb.toString();
        } catch (Exception e) {
            return;
        }
        web.evaluateJavascript(js, null);
    }

    /** Rueckkanal JS -> Java (Fehler-Toast; offizieller Sim kann notify nutzen). */
    private class Bridge {
        @JavascriptInterface
        public void ready(String s) { /* Platzhalter: Vollbild hat keine Statuszeile */ }

        @JavascriptInterface
        public void error(String s) {
            runOnUiThread(() -> Toast.makeText(SimActivity.this, s, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void notify(String text, String stimmung) { /* ohne UI: still */ }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
