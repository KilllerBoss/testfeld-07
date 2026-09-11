package com.trainrobot.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * High-Level-Kanal: fragt Gemini (geraeteseitig, vom Telefon) nach
 * strukturierten Subgoal-JSONs auf dem 13D-Interface und liefert:
 *   {"goals":[{"cmd":{"vx","vy","yaw"},"dauer_s":..,"grund":..}],
 *    "notify":..,"stimmung":..}
 * Portierung der Referenz (GeminiClient.kt) auf HttpURLConnection —
 * kein OkHttp/Okio/Kotlin-Rattenschwanz noetig.
 */
public class GeminiClient {
    private final String apiKey;

    public GeminiClient(String apiKey) {
        this.apiKey = apiKey;
    }

    /** Erzeugt ein Subgoal-JSON aus der aktuellen Roboterlage + Mission. */
    public JSONObject requestSubgoal(String model, String mission, String stateLine) throws Exception {
        String sys = "Du bist die High-Level-Steuerung eines kleinen Zweibein-Roboters "
                + "(MicroDuck). Gib NUR ein JSON zurueck, kein Markdown. Schema:\n"
                + "{\"goals\":[{\"cmd\":{\"vx\":-0.4..0.4,\"vy\":-0.3..0.3,\"yaw\":-1.0..1.0},"
                + "\"dauer_s\":2..8,\"grund\":\"kurz\"}],\"notify\":\"max 60 Zeichen\","
                + "\"stimmung\":\"ein Wort\"}\n"
                + "Genau 1-3 Goals, gaengige Geschwindigkeiten, konservativ waehlen.";
        String prompt = sys + "\nMission: " + mission + "\nAktueller Zustand: " + stateLine;

        JSONObject body = new JSONObject()
                .put("contents", new JSONArray().put(new JSONObject().put("parts",
                        new JSONArray().put(new JSONObject().put("text", prompt)))))
                .put("generationConfig", new JSONObject()
                        .put("temperature", 0.4)
                        .put("responseMimeType", "application/json"));

        HttpURLConnection conn = (HttpURLConnection) new URL(
                "https://generativelanguage.googleapis.com/v1beta/models/" + model
                        + ":generateContent?key=" + apiKey).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout((int) TimeUnit.SECONDS.toMillis(12));
        conn.setReadTimeout((int) TimeUnit.SECONDS.toMillis(12));
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int code = conn.getResponseCode();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream()) {
            if (is != null) {
                byte[] chunk = new byte[8192];
                int n;
                while ((n = is.read(chunk)) > 0) buf.write(chunk, 0, n);
            }
        }
        conn.disconnect();
        if (code < 200 || code >= 300) return null;
        JSONObject root = new JSONObject(buf.toString("UTF-8"));
        String text = root.getJSONArray("candidates").getJSONObject(0)
                .getJSONObject("content").getJSONArray("parts").getJSONObject(0)
                .getString("text");
        return normalize(new JSONObject(text));
    }

    /** Erzwingt das Protokoll-Schema (gekappte Ranges). */
    private static JSONObject normalize(JSONObject j) throws Exception {
        JSONArray goals = j.optJSONArray("goals");
        JSONArray out = new JSONArray();
        if (goals != null) {
            for (int i = 0; i < goals.length() && i < 3; i++) {
                JSONObject g = goals.getJSONObject(i);
                JSONObject c = g.optJSONObject("cmd");
                if (c == null) c = new JSONObject();
                out.put(new JSONObject()
                        .put("cmd", new JSONObject()
                                .put("vx", clamp(c.optDouble("vx", 0.0), -0.4, 0.4))
                                .put("vy", clamp(c.optDouble("vy", 0.0), -0.3, 0.3))
                                .put("yaw", clamp(c.optDouble("yaw", 0.0), -1.0, 1.0)))
                        .put("dauer_s", clamp(g.optDouble("dauer_s", 4.0), 1.0, 10.0))
                        .put("grund", g.optString("grund", "")));
            }
        }
        return new JSONObject()
                .put("goals", out)
                .put("notify", j.optString("notify", ""))
                .put("stimmung", j.optString("stimmung", ""));
    }

    private static double clamp(double v, double lo, double hi) {
        if (Double.isNaN(v)) v = 0;
        return Math.max(lo, Math.min(hi, v));
    }
}
