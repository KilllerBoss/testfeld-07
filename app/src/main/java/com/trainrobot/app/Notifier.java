package com.trainrobot.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Kurze App-Benachrichtigungen (kein TTS — Nutzer-Anforderung):
 * Gemini-Notify-Texte + Stimmung landen hier. Portierung der Referenz
 * (Notifier.kt) auf das Framework-API (minSdk 30 -> Notification.Builder
 * mit Channel, kein androidx.core noetig).
 */
public class Notifier {
    public static final String PERMISSION = Manifest.permission.POST_NOTIFICATIONS;
    private final NotificationManager nm;
    private final Context ctx;
    private final String channelId = "trainrobot_notify";
    private int id = 100;

    public Notifier(Context ctx) {
        this.ctx = ctx;
        this.nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(
                channelId, "Trainrobot Status", NotificationManager.IMPORTANCE_DEFAULT));
    }

    public void post(String text, String stimmung) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(PERMISSION)
                != PackageManager.PERMISSION_GRANTED) return;
        Notification n = new Notification.Builder(ctx, channelId)
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentTitle("Trainrobot" + (stimmung != null && !stimmung.isBlank() ? " (" + stimmung + ")" : ""))
                .setContentText(text)
                .setAutoCancel(true)
                .build();
        nm.notify(id++, n);
    }
}
