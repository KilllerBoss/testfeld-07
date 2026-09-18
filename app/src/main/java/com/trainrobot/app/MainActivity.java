package com.trainrobot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.OutputStream;

/**
 * Trainrobot · Testfeld·07 — WebView-Host.
 * Lädt die Sim-App ausschließlich über WebViewAssetLoader
 * (https://appassets.androidplatform.net/assets/www/…), damit ES-Module,
 * WASM und fetch() ohne File-URL-Probleme laufen. Volldimm-Immersive,
 * keine Bildschirmabschaltung. Kein externer Netzwerkverkehr nötig.
 */
public class MainActivity extends Activity {

    private WebView webView;

    // Dateimanager-Brücke: <input type="file"> (GLB-Import, Policy-Import)
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 7001;
    // v2.27.0: ARDY-Modell-Import — eigener Dateimanager-Aufruf (Mehrfach-
    // auswahl), Kopie in filesDir/ardy_import/, Auslieferung unter /ardymodel/
    private static final int ARDY_PICK_REQUEST = 7002;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0a0e14"));
        setContentView(webView);

        // immersive sticky full-screen
        final View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                // v2.27.0: ARDY-Modell-Dateien (Dateimanager-Import) aus dem
                // App-Ordner — GLEICHER sicherer Ursprung → kein CORS, kein
                // Hugging-Face-Download mehr nötig.
                .addPathHandler("/ardymodel/", new WebViewAssetLoader.PathHandler() {
                    @Override
                    public WebResourceResponse handle(String path) {
                        String name = sanitizeImportName(path);
                        File f = new File(ardyImportDir(), name);
                        if (path == null || path.contains("..") || path.contains("/") || !f.isFile()) {
                            return notFound();
                        }
                        try {
                            InputStream is = new FileInputStream(f);
                            java.util.Map<String, String> h = new java.util.HashMap<>();
                            h.put("Content-Length", String.valueOf(f.length()));
                            h.put("Cache-Control", "no-store");
                            return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, is);
                        } catch (Exception e) {
                            return notFound();
                        }
                    }
                })
                .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // Policy-Speicher
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);           // nur AssetLoader
        s.setAllowContentAccess(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // Nur interne App-URLs zulassen — nichts nach außen
                return !"appassets.androidplatform.net".equals(u.getHost());
            }
        });

        // Dateimanager für Datei-Inputs (GLB-Animationen, Policy-JSON):
        // ohne onShowFileChooser passiert beim Klick NICHTS.
        // Absichtlich */* statt accept-Filter: viele Dateimanager blenden
        // .glb (ohne registriertes MIME) sonst aus. Validierung macht die App.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (android.content.ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Export-Brücke: Policy/GLB-Metadaten in den Download-Ordner schreiben
        // (blob:<a download> ist in WebViews unzuverlässig)
        webView.addJavascriptInterface(new FileBridge(), "TrainrobotBridge");
        // KI-Trainer-Brücke: HTTPS zu generativelanguage.googleapis.com
        // (deterministisch, ohne WebView-CORS-Unwägbarkeiten)
        webView.addJavascriptInterface(new AIBridge(), "TrainrobotAI");

        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
        }
    }

    private File ardyImportDir() {
        File d = new File(getFilesDir(), "ardy_import");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Dateiname härten: nur ein Pfadsegment, keine Punkt-Tricks. */
    private static String sanitizeImportName(String n) {
        if (n == null) return "";
        String s = n.replace("\\", "_").replace("/", "_");
        while (s.contains("..")) s = s.replace("..", "_");
        if (s.startsWith(".")) s = "_" + s.substring(1);
        return s;
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", null, 404, "Not Found", null,
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    /** Anzeigename einer Content-URI (OpenableColumns, Fallback LastSegment). */
    private String displayName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && c.moveToFirst()) {
                    String n = c.getString(i);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception e) { /* egal */ } finally {
            if (c != null) c.close();
        }
        String p = uri.getLastPathSegment();
        return (p == null || p.isEmpty()) ? "modell.bin" : p;
    }

    private void reportImport(final String name, final long got) {
        final String js = "window.__ardyImportProgress && window.__ardyImportProgress(" +
                org.json.JSONObject.quote(name) + "," + got + ");";
        runOnUiThread(new Runnable() { @Override public void run() { webView.evaluateJavascript(js, null); } });
    }

    /** Kopiert die gewählten Dateien in filesDir/ardy_import/ (1-MiB-Blöcke,
     *  Fortschritt per evaluateJavascript), meldet Fertigstellung an JS. */
    private void copyArdyFiles(final Uri[] uris) {
        new Thread(new Runnable() { @Override public void run() {
            boolean ok = true; String err = ""; int copied = 0;
            File dir = ardyImportDir();
            for (final Uri u : uris) {
                if (u == null) continue;
                final String name = sanitizeImportName(displayName(u));
                try {
                    InputStream is = getContentResolver().openInputStream(u);
                    if (is == null) { ok = false; err = "Datei nicht lesbar: " + name; continue; }
                    File dst = new File(dir, name);
                    FileOutputStream os = new FileOutputStream(dst);
                    byte[] buf = new byte[1 << 20];
                    long got = 0, lastReport = 0; int n;
                    while ((n = is.read(buf)) > 0) {
                        os.write(buf, 0, n); got += n;
                        if (got - lastReport >= (8L << 20)) { lastReport = got; reportImport(name, got); }
                    }
                    os.flush(); os.close(); is.close();
                    reportImport(name, got);
                    copied++;
                } catch (Exception e) {
                    ok = false; err = (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                }
            }
            final boolean fok = ok && copied > 0;
            final String fmsg = fok ? ("Import fertig (" + copied + " Datei" + (copied == 1 ? "" : "en") + ")") : err;
            final String js = "window.__ardyImportDone && window.__ardyImportDone(" + fok + "," +
                    org.json.JSONObject.quote(fmsg) + ");";
            runOnUiThread(new Runnable() { @Override public void run() { webView.evaluateJavascript(js, null); } });
        } }).start();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        // v2.27.0: ARDY-Modell-Import (Dateimanager, Mehrfachauswahl)
        if (requestCode == ARDY_PICK_REQUEST) {
            java.util.List<Uri> uris = new java.util.ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    android.content.ClipData cd = data.getClipData();
                    for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri());
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }
            if (!uris.isEmpty()) copyArdyFiles(uris.toArray(new Uri[0]));
            else {
                final String js = "window.__ardyImportDone && window.__ardyImportDone(false,\"Auswahl abgebrochen\");";
                webView.evaluateJavascript(js, null);
            }
            return;
        }
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                // Mehrfachauswahl (GLB) und Einzelauswahl (JSON) abdecken
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /** JS-Bridge: Dateien (Policy-Export) in MediaStore/Downloads schreiben. */
    private class FileBridge {
        @JavascriptInterface
        public boolean available() { return true; }

        @JavascriptInterface
        public void ardyPickModel() {
            // v2.27.0: Dateimanager öffnen — Nutzer wählt die ARDY-Modell-
            // Dateien (model.json.gz, tokenizer.json.gz, *.onnx.gz / *.onnx).
            // Bewusst */*: .gz/.onnx haben in vielen Managern kein MIME.
            runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, ARDY_PICK_REQUEST);
                } catch (android.content.ActivityNotFoundException e) {
                    final String js = "window.__ardyImportDone && window.__ardyImportDone(false,\"Kein Dateimanager gefunden\");";
                    webView.evaluateJavascript(js, null);
                }
            } });
        }

        @JavascriptInterface
        public String ardyImportList() {
            // Liste der importierten Modell-Dateien als JSON [{name,size}]
            try {
                File dir = ardyImportDir();
                File[] files = dir.listFiles();
                org.json.JSONArray arr = new org.json.JSONArray();
                if (files != null) {
                    for (File f : files) {
                        if (!f.isFile()) continue;
                        org.json.JSONObject o = new org.json.JSONObject();
                        o.put("name", f.getName());
                        o.put("size", f.length());
                        arr.put(o);
                    }
                }
                return arr.toString();
            } catch (Exception e) { return "[]"; }
        }

        @JavascriptInterface
        public boolean ardyImportDelete(String name) {
            try {
                File f = new File(ardyImportDir(), sanitizeImportName(name));
                return f.isFile() && f.delete();
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean saveFile(String name, String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime != null ? mime : "application/octet-stream");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return false;
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) return false;
                os.write(bytes);
                os.flush();
                os.close();
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    /**
     * JS-Brücke für den KI-Trainer: kleine HTTPS-Anfragen an die
     * Gemini-API, Ergebnis per evaluateJavascript zurück in die WebView.
     * Kein Header-Mapping nötig — der Schlüssel liegt im Query-String.
     */
    private class AIBridge {
        @JavascriptInterface
        public boolean available() { return true; }

        @JavascriptInterface
        public void request(final String url, final String method, final String body, final String callbackId) {
            new Thread(new Runnable() {
                @Override public void run() {
                    int code = 0; String resp = ""; String err = null;
                    try {
                        javax.net.ssl.HttpsURLConnection c =
                            (javax.net.ssl.HttpsURLConnection) new java.net.URL(url).openConnection();
                        c.setRequestMethod("GET".equals(method) ? "GET" : "POST");
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(55000);
                        // KRITISCH: Ohne Content-Type interpretiert das Google-API-
                        // Frontend den POST-Body als form-urlencoded-Felder (= Query-
                        // Parameter) → 400 „Unknown name ... Cannot bind query
                        // parameter". JSON muss explizit deklariert werden.
                        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                        c.setRequestProperty("Accept", "application/json");
                        if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                            c.setDoOutput(true);
                            c.setFixedLengthStreamingMode(body.getBytes("UTF-8").length);
                            java.io.OutputStream os = c.getOutputStream();
                            os.write(body.getBytes("UTF-8"));
                            os.flush(); os.close();
                        }
                        code = c.getResponseCode();
                        java.io.InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        if (is != null) {
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                            is.close();
                        }
                        resp = bos.toString("UTF-8");
                    } catch (Exception e) {
                        err = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                    }
                    final int fCode = code; final String fResp = resp; final String fErr = err;
                    final String js = "window.__aiReply && window.__aiReply(" +
                            org.json.JSONObject.quote(callbackId) + "," + fCode + "," +
                            org.json.JSONObject.quote(fResp) + "," +
                            (fErr != null ? org.json.JSONObject.quote(fErr) : "null") + ");";
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            webView.evaluateJavascript(js, null);
                        }
                    });
                }
            }).start();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // SPA: Zurück bewegt nichts in der Historie — Standard (App verlassen)
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            final View decor = getWindow().getDecorView();
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }
}
