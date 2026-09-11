package com.testfeld07.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Testfeld·07 — WebView-Host.
 * Lädt assets/index.html (komplette Sim, offline), Vollbild-Immersive,
 * Landscape, JS-Brücke für Policy-Export/Import in die App-Dokumente.
 */
public class MainActivity extends Activity {

    private WebView web;
    private static final int REQ_IMPORT = 4707;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        WebView.setWebContentsDebuggingEnabled(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> cb,
                                             WebChromeClient.FileChooserParams params) {
                // Datei-Import (Policy-JSON) über Systemdialog
                try {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    startActivityForResult(i, REQ_IMPORT);
                } catch (Exception e) {
                    toast("Kein Dateidialog verfügbar: " + e.getMessage());
                }
                return true; // wir liefern über onActivityResult via JS-Push
            }
        });

        setContentView(web);
        hideSystemBars();
        web.loadUrl("file:///android_asset/index.html");
    }

    private void hideSystemBars() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT && resultCode == RESULT_OK && data != null && data.getData() != null) {
            try {
                StringBuilder sb = new StringBuilder();
                InputStream in = getContentResolver().openInputStream(data.getData());
                BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
                r.close();
                String json = sb.toString().replace("\\", "\\\\").replace("'", "\\'")
                        .replace("\n", "\\n").replace("\r", "");
                web.evaluateJavascript(
                        "window.TF07 && TF07.inst && TF07.inst.importPolicyText('" + json + "', 'import.json');",
                        null);
            } catch (Exception e) {
                toast("Import fehlgeschlagen: " + e.getMessage());
            }
        }
    }

    private File docsDir() {
        return new File(getExternalFilesDir(null), "Dokumente");
    }

    private void toast(String m) {
        Toast.makeText(this, m, Toast.LENGTH_SHORT).show();
    }

    /** JS-Brücke — die Konsole der App ruft diese Methoden. */
    private class Bridge {

        /** v1.1-Fix: JS übergibt teils "mjc/…", teils relativ — normalisieren,
         * damit NIE doppelt präfixiert wird ("mjc/mjc/…" → Asset-Load still tot). */
        private String relAsset(String path) {
            String p = path == null ? "" : path;
            while (p.startsWith("/")) p = p.substring(1);
            if (p.startsWith("mjc/")) p = p.substring(4);
            return p;
        }

        @JavascriptInterface
        public String readAssetBase64(String path) {
            // MuJoCo/ORT-WASM + MJCF-Meshes aus assets/ (offline, kein fetch auf file://)
            try {
                InputStream in = getAssets().open("mjc/" + relAsset(path));
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                in.close();
                return android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public String readAssetText(String path) {
            try {
                InputStream in = getAssets().open("mjc/" + relAsset(path));
                BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
                r.close();
                return sb.toString();
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public void exportFile(String name, String content) {
            try {
                File dir = docsDir();
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                FileOutputStream out = new FileOutputStream(f);
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.close();
                toast("Gespeichert: " + f.getAbsolutePath());
            } catch (Exception e) {
                toast("Export fehlgeschlagen: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public String importPolicy(String name) {
            try {
                File f = new File(docsDir(), name);
                if (!f.exists()) return null;
                BufferedReader r = new BufferedReader(new InputStreamReader(
                        new java.io.FileInputStream(f), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
                r.close();
                return sb.toString();
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public void toast(String msg) {
            toast(msg);
        }
    }

    @Override
    public void onBackPressed() {
        // Konsole zu? Sonst nichts tun (keine Navigation in der Sim).
    }
}
