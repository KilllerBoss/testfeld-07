package com.trainrobot.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;

/**
 * Asset-Handler fuer die gebundelte 3D-Simulation (assets/sim/ = Vite-dist
 * des offiziellen microduck-simulator). Portierung der Referenz-App
 * (MicroDuck SimAssetHandler.kt) mit ZWEI entscheidenden Korrekturen:
 *
 * 1. BASIS-PFAD: Der Handler bekommt vom WebViewAssetLoader nur den Pfad
 *    NACH dem registrierten Praefix. Die Referenz registrierte "/assets/"
 *    und oeffnete dann "sim/" + suffix -> "sim/sim/…" -> immer null ->
 *    ALLE Requests fielen aufs Netz -> Sim bootete im Geraet nie.
 *    Wir registrieren "/assets/sim/" und oeffnen "sim/" + suffix (korrekt).
 *
 * 2. ABSOLUTE PFADE: Der Vite-Build referenziert Assets host-absolut
 *    ("/bundle/index-*.js", "/policies/*.onnx", "/robot/mjlab/*.glb",
 *    "/assets/*.webp"). Ein zweiter Root-Handler mappt genau diese auf
 *    "sim" + Pfad. So wird der Dist exakt so ausgeliefert wie von einem
 *    Webserver an der Domain-Wurzel — nichts faellt ins Netz.
 *
 * Korrekte MIME-Types (application/wasm fuer MuJoCo/onnxruntime!) damit
 * instantiateStreaming funktioniert.
 */
public class SimAssetHandler implements WebViewAssetLoader.PathHandler {
    private final AssetManager am;
    private final String baseDir;

    /** @param baseDir Asset-Verzeichnis als Basis, z. B. "sim" — immer ohne
     *  fuehrenden/abschliessenden Slash. */
    public SimAssetHandler(Context ctx, String baseDir) {
        this.am = ctx.getAssets();
        this.baseDir = baseDir.replaceAll("^/+|/+$", "");
    }

    @Override
    public WebResourceResponse handle(String path) {
        String clean = path == null ? "" : path;
        while (clean.startsWith("/")) clean = clean.substring(1);
        if (clean.isEmpty() || clean.contains("..")) return null;
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (java.io.InputStream input = am.open(baseDir + "/" + clean)) {
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = input.read(chunk)) > 0) buf.write(chunk, 0, n);
            }
            WebResourceResponse resp = new WebResourceResponse(
                    mimeFor(clean), null, new ByteArrayInputStream(buf.toByteArray()));
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            resp.setResponseHeaders(headers);
            return resp;
        } catch (Exception e) {
            return null;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".onnx")) return "application/octet-stream";
        if (p.endsWith(".glb")) return "model/gltf-binary";
        if (p.endsWith(".gltf")) return "model/gltf+json";
        if (p.endsWith(".stl")) return "application/octet-stream";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ogg") || p.endsWith(".oga")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".xml")) return "application/xml";
        return "application/octet-stream";
    }
}
