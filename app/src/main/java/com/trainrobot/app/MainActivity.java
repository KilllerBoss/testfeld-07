package com.trainrobot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
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
