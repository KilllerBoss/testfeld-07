package com.trainrobot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Trainrobot — 3D-Simulation mit dem virtuellen Roboter.
 *
 * 1:1-Portierung der Referenz-App (MicroDuck SimActivity.kt): Der Nutzer
 * startet den offiziellen microduck-simulator (bundled Vite-Build) in einer
 * WebView. Assets werden ueber https://appassets.androidplatform.net/assets/
 * serviert (WebViewAssetLoader + SimAssetHandler), damit relative fetches,
 * ES-Module und WASM offline funktionieren. Kein file://, kein Fallback.
 *
 * Low-Level : onnxruntime-web (WebView) @ 50 Hz auf MuJoCo-WASM  [im Sim-Bundle]
 * High-Level: GeminiClient erzeugt @ ~1 Hz Subgoal-JSONs und injiziert sie
 *             per JS-Source in den Controller der Simulation (Nutzer-Eingabe
 *             und Waypoint-Klicks haben jederzeit Vorrang).
 * Feedback  : "notify" -> App-Benachrichtigung (kein TTS).
 */
public class SimActivity extends Activity {
    private WebView web;
    private TextView statusView;
    private Button autopilotBtn;
    private Notifier notifier;

    private final java.util.concurrent.ExecutorService pool = Executors.newFixedThreadPool(2);
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger subgoalCount = new AtomicInteger(0);
    private final AtomicReference<String> lastStateLine = new AtomicReference<>("boote …");
    private final AtomicReference<String> lastNotify = new AtomicReference<>("");
    private String geminiModel = "gemini-2.0-flash";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_sim);
        notifier = new Notifier(this);

        statusView = findViewById(R.id.simStatus);
        autopilotBtn = findViewById(R.id.btnAutopilot);
        String gm = getIntent().getStringExtra("gemini_model");
        if (gm != null && !gm.trim().isEmpty()) geminiModel = gm;

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
        // (relative fetches der Sim sowie ES-Module/WASM funktionieren so offline;
        //  korrektes MIME fuer .wasm/.onnx/.glb wird von unserem Handler gesetzt).
        // Handler-Reihenfolge entscheidet: erst das Dokument unter
        // /assets/sim/, danach ein Root-Handler fuer die host-absoluten
        // Vite-Pfade (/bundle, /policies, /robot, /assets). Siehe
        // SimAssetHandler-Doku: die Referenz-App hatte hier den
        // "sim/sim"-Bug (alles fiel aufs Netz -> Sim bootete nie).
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/sim/", new SimAssetHandler(this, "sim"))
                .addPathHandler("/", new SimAssetHandler(this, "sim"))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pollGameReady(0);
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidHost");

        // ?boot=1: Title-Screen ueberspringen (eingebauter Test-Hook der Sim)
        // ?touch=1: Touch-Steuerung aktivieren, ?noghosts: kein WebRTC-Multiplayer
        web.loadUrl("https://appassets.androidplatform.net/assets/sim/index.html?boot=1&touch=1&noghosts");

        autopilotBtn.setOnClickListener(v -> {
            if (running.get()) stopAutopilot(); else startAutopilot();
        });
        findViewById(R.id.btnSimReset).setOnClickListener(v ->
                web.evaluateJavascript("window.rl && rl.resetSim ? rl.resetSim() : null", null));
        findViewById(R.id.btnSimBack).setOnClickListener(v -> finish());
    }

    /** Wartet darauf, dass window.rl (Game-API der Sim) bereit ist, injiziert dann die Bridge. */
    private void pollGameReady(int attempt) {
        if (attempt > 120) { // ~60 s
            statusView.setText(getString(R.string.boot_failed));
            return;
        }
        web.evaluateJavascript("(!!(window.rl && rl.controller))", ready -> {
            if ("true".equals(ready)) injectBridge();
            else web.postDelayed(() -> pollGameReady(attempt + 1), 500);
        });
    }

    /** JS-Bridge: GeminiSource (Subgoal-Queue) + getState + notify-Rueckkanal.
     *  Liegt als Asset (assets/md_bridge.js) — wartbar und versionierbar. */
    private void injectBridge() {
        String js;
        try (java.io.InputStream in = getAssets().open("md_bridge.js");
             java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            js = sb.toString();
        } catch (Exception e) {
            statusView.setText(getString(R.string.bridge_missing));
            return;
        }
        web.evaluateJavascript(js, null);
        statusView.setText(getString(R.string.sim_ready));
    }

    private void startAutopilot() {
        String key = getIntent().getStringExtra("gemini_key");
        if (key == null || key.trim().isEmpty()) {
            Toast.makeText(this, getString(R.string.no_key_toast), Toast.LENGTH_LONG).show();
            return;
        }
        running.set(true);
        autopilotBtn.setText(getString(R.string.autopilot_stop));
        String mission = getIntent().getStringExtra("mission");
        if (mission == null || mission.trim().isEmpty()) {
            mission = "Erkunde langsam die Arena, wechsle ab zwischen Gehen, Drehen und Pausen.";
        }
        GeminiClient gem = new GeminiClient(key);
        final String missionF = mission;
        pool.execute(() -> {
            while (running.get()) {
                try {
                    String state = lastStateLine.get();
                    org.json.JSONObject sg = gem.requestSubgoal(geminiModel, missionF, state);
                    if (sg != null && running.get()) {
                        subgoalCount.incrementAndGet();
                        runOnUiThread(() -> web.evaluateJavascript(
                                "window.__mdBridge && (function(){var s=rl.controller.sources.find(function(x){return x.id==='gemini';}); if(s){s.setSubgoal("
                                        + sg + "); window.__mdGeminiActiveFlag=true;}})()", null));
                        String notify = sg.optString("notify", "");
                        String stim = sg.optString("stimmung", "");
                        if (!notify.trim().isEmpty() && !notify.equals(lastNotify.get())) {
                            lastNotify.set(notify);
                            notifier.post(notify, stim);
                            runOnUiThread(() -> ((TextView) findViewById(R.id.simNotify))
                                    .setText(notify + " [" + stim + "]"));
                        }
                    }
                } catch (Throwable ignored) {}
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
            }
        });
        pool.execute(() -> {
            while (running.get()) {
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__mdGetState ? window.__mdGetState() : 'null'", state -> {
                            String line = state == null ? "null" : state.trim();
                            if (line.startsWith("\"") && line.endsWith("\"") && line.length() >= 2) {
                                line = line.substring(1, line.length() - 1);
                            }
                            if (!"null".equals(line) && !line.isEmpty()) {
                                lastStateLine.set(line.replace("\\\"", "\"").replace("\\\\", "\\"));
                            }
                            statusView.setText("Autopilot aktiv · Subgoals: " + subgoalCount.get()
                                    + "\n" + lastStateLine.get());
                        }));
                try { Thread.sleep(1200); } catch (InterruptedException e) { return; }
            }
        });
    }

    private void stopAutopilot() {
        running.set(false);
        autopilotBtn.setText(getString(R.string.autopilot_start));
        web.evaluateJavascript(
                "(function(){var s=rl.controller.sources.find(function(x){return x.id==='gemini';}); if(s){s.queue.length=0; s.command.fill(0); window.__mdGeminiActiveFlag=false;}})()",
                null);
        statusView.setText("Autopilot gestoppt. Sim läuft manuell weiter (Touch-Stick).");
    }

    /** Rueckkanal JS -> Kotlin/Java. */
    private class Bridge {
        @JavascriptInterface
        public void ready(String s) {
            runOnUiThread(() -> statusView.setText("3D-Sim & Bridge bereit (" + s + ")"));
        }

        @JavascriptInterface
        public void error(String s) {
            runOnUiThread(() -> Toast.makeText(SimActivity.this, s, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void notify(String text, String stimmung) {
            notifier.post(text, stimmung);
        }
    }

    @Override
    protected void onDestroy() {
        running.set(false);
        pool.shutdownNow();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
