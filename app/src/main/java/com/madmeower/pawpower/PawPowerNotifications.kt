package com.madmeower.pawpower

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import java.util.concurrent.atomic.AtomicInteger

object PawPowerNotifications {
    const val CHANNEL_ID = "pawpower_alerts"
    private val nextId = AtomicInteger(100)

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "PawPower alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Battery temperature alerts and PawPower test messages"
            }
        )
    }

    fun enabled(context: Context): Boolean {
        val permission = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val channel = context.getSystemService(NotificationManager::class.java)
            .getNotificationChannel(CHANNEL_ID)
        return permission && NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            channel?.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun show(context: Context, title: String, body: String): Boolean {
        createChannel(context)
        if (!enabled(context)) return false
        val tap = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(ContextCompat.getDrawable(context, R.drawable.ic_paw_power)?.toBitmap())
            .setColor(ContextCompat.getColor(context, R.color.pawpower_mint))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        return try {
            NotificationManagerCompat.from(context).notify(nextId.incrementAndGet(), notification)
            true
        } catch (_: SecurityException) {
            false
        }
    }
}
