package com.madmeower.pawpower

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.SizeF
import android.os.Bundle
import android.os.SystemClock
import android.util.AtomicFile
import android.widget.RemoteViews
import androidx.work.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit

data class WidgetCache(
    val soc: Double?, val watts: Double?, val batteryAge: Long?,
    val fetchedWall: Long, val fetchedElapsed: Long, val failed: Boolean, val sampleTime: Long = 0
)
fun widgetAge(sourceAge: Long?, cachedWall: Long, cachedElapsed: Long, wall: Long, elapsed: Long): Long? {
    if (sourceAge == null) return null
    // Wall time covers reboots; monotonic time covers ordinary clock adjustments.
    if (wall < cachedWall - 60_000 && elapsed < cachedElapsed) return Long.MAX_VALUE / 1000
    return sourceAge.coerceAtLeast(0) + maxOf((wall - cachedWall).coerceAtLeast(0),
        (elapsed - cachedElapsed).coerceAtLeast(0)) / 1000
}
fun widgetIsStale(age: Long?, value: Double?, failed: Boolean): Boolean = failed || value == null || age == null || age >= 300

fun widgetBatteryWatts(volts: Double?, amps: Double?): Double? =
    if (volts == null || amps == null) null else (volts * amps).takeIf { it.isFinite() }

fun widgetWattsText(watts: Double?): String {
    if (watts == null || !watts.isFinite()) return "— W"
    return String.format(Locale.getDefault(), "%.0f W", kotlin.math.abs(watts))
}

object PawWidgetStore {
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "widget-readings.json"))
    @Synchronized fun read(context: Context): WidgetCache? = runCatching {
        val json = file(context).openRead().use { JSONObject(it.bufferedReader().readText()) }
        fun number(key: String) = (json.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
        fun age(key: String) = (json.opt(key) as? Number)?.toLong()
        // Older caches contain Tracer solar watts; never display them as net battery power.
        WidgetCache(number("soc"), if (json.optInt("version") == 2) number("watts") else null, age("battery_age"),
            json.getLong("wall"), json.getLong("elapsed"), json.optBoolean("failed"), json.optLong("sample_time"))
    }.getOrNull()
    @Synchronized fun save(context: Context, snapshot: ReadingSnapshot) {
        val battery = snapshot.devices.getOrNull(0)
        if (battery != null && battery.receivedAt < (read(context)?.sampleTime ?: 0)) return
        val watts = widgetBatteryWatts(battery?.values?.get("battery_voltage"), battery?.values?.get("battery_current"))
        val body = JSONObject().put("version", 2).put("soc", battery?.values?.get("battery_soc") ?: JSONObject.NULL)
            .put("watts", watts ?: JSONObject.NULL)
            .put("battery_age", battery?.ageSeconds ?: JSONObject.NULL)
            .put("sample_time", battery?.receivedAt ?: 0)
            .put("wall", System.currentTimeMillis()).put("elapsed", SystemClock.elapsedRealtime()).put("failed", false)
        write(context, body)
    }
    @Synchronized fun savePush(context: Context, sample: WidgetPushSample): Boolean {
        if (sample.sampleTime < (read(context)?.sampleTime ?: 0)) return false
        write(context, JSONObject().put("version", 2).put("soc", sample.soc ?: JSONObject.NULL)
            .put("watts", sample.watts ?: JSONObject.NULL).put("battery_age", sample.ageSeconds)
            .put("sample_time", sample.sampleTime).put("wall", System.currentTimeMillis())
            .put("elapsed", SystemClock.elapsedRealtime()).put("failed", false))
        return true
    }
    @Synchronized fun fail(context: Context) {
        val existing = read(context) ?: return
        write(context, JSONObject().put("version", 2).put("soc", existing.soc ?: JSONObject.NULL)
            .put("watts", existing.watts ?: JSONObject.NULL).put("battery_age", existing.batteryAge ?: JSONObject.NULL)
            .put("wall", existing.fetchedWall)
            .put("elapsed", existing.fetchedElapsed).put("sample_time", existing.sampleTime).put("failed", true))
    }
    private fun write(context: Context, json: JSONObject) {
        val atomic = file(context); val output = atomic.startWrite()
        try { output.write(json.toString().toByteArray(Charsets.UTF_8)); atomic.finishWrite(output) }
        catch (failure: Exception) { atomic.failWrite(output); throw failure }
    }
}

class PawPowerWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        schedule(context)
        PhoneRegistrationWorker.enqueue(context)
        renderAsync(context)
    }
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        renderAsync(context)
    }
    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(MANUAL)
        WorkManager.getInstance(context).cancelUniqueWork(EXPIRY)
        WidgetSubscriptionWorker.enqueue(context, force = true)
    }
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == REFRESH) {
            WorkManager.getInstance(context).enqueueUniqueWork(MANUAL, ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<PawWidgetWorker>().setConstraints(network()).build())
            renderAsync(context)
        }
    }
    private fun renderAsync(context: Context) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch { try { runCatching { updateAll(context.applicationContext) } } finally { pending.finish() } }
    }
    companion object {
        private const val PERIODIC = "pawpower-widget-periodic"
        private const val MANUAL = "pawpower-widget-manual"
        private const val EXPIRY = "pawpower-widget-expiry"
        private const val REFRESH = "com.madmeower.pawpower.REFRESH_WIDGET"
        fun hasWidgets(context: Context): Boolean = AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, PawPowerWidget::class.java)).isNotEmpty()
        private fun network() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<PawWidgetWorker>(15, TimeUnit.MINUTES).setConstraints(network()).build())
        }
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, PawPowerWidget::class.java))
            if (ids.isEmpty()) return
            val cache = PawWidgetStore.read(context)
            val now = System.currentTimeMillis(); val elapsed = SystemClock.elapsedRealtime()
            val batteryAge = cache?.let { widgetAge(it.batteryAge, it.fetchedWall, it.fetchedElapsed, now, elapsed) }
            val stale = widgetIsStale(batteryAge, cache?.soc, cache?.failed == true) ||
                widgetIsStale(batteryAge, cache?.watts, cache?.failed == true)
            fun createViews(layout: Int): RemoteViews {
            val views = RemoteViews(context.packageName, layout)
            val socText = cache?.soc?.let { String.format(Locale.getDefault(), "%.0f%%", it) } ?: "—%"
            val wattsText = widgetWattsText(cache?.watts)
            views.setTextViewText(R.id.widget_soc, socText)
            views.setTextColor(R.id.widget_soc, if (stale) DashboardColors.neutral else DashboardColors.stateOfCharge(cache?.soc))
            views.setTextViewText(R.id.widget_watts, wattsText)
            views.setTextColor(R.id.widget_watts, when {
                stale -> DashboardColors.neutral
                (cache?.watts ?: 0.0) >= 0.5 -> DashboardColors.charging
                (cache?.watts ?: 0.0) <= -0.5 -> DashboardColors.discharging
                else -> DashboardColors.neutral
            })
            views.setContentDescription(R.id.widget_root,
                "Battery $socText, $wattsText. " + when {
                    cache?.watts == null -> ""
                    cache.watts >= 0.5 -> "Charging. "
                    cache.watts <= -0.5 -> "Discharging. "
                    else -> "No net power. "
                } + when {
                    cache == null -> "Open app to connect."
                    cache.failed -> "Refresh failed; saved reading."
                    stale -> "Stale reading."
                    else -> "Reading age ${batteryAge ?: 0} seconds."
                } + " Tap to open PawPower.")
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            return views
            }
            // One deferred repaint when cached readings expire; no ticking launcher timer.
            if (!stale && batteryAge != null) {
                WorkManager.getInstance(context).enqueueUniqueWork(EXPIRY, ExistingWorkPolicy.REPLACE,
                    OneTimeWorkRequestBuilder<WidgetExpiryWorker>()
                        .setInitialDelay((300 - batteryAge).coerceAtLeast(1), TimeUnit.SECONDS).build())
            }
            for (id in ids) {
                val views = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    RemoteViews(mapOf(
                        SizeF(40f, 40f) to createViews(R.layout.pawpower_widget),
                        SizeF(40f, 100f) to createViews(R.layout.pawpower_widget_tall),
                        SizeF(110f, 40f) to createViews(R.layout.pawpower_widget)
                    ))
                } else {
                    val options = manager.getAppWidgetOptions(id)
                    val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
                    val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 56)
                    createViews(if (width < 110 && height >= 100) R.layout.pawpower_widget_tall else R.layout.pawpower_widget)
                }
                manager.updateAppWidget(id, views)
            }
        }
    }
}

class PawWidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!PawPowerWidget.hasWidgets(applicationContext)) return Result.success()
        WidgetSubscriptionWorker.enqueue(applicationContext)
        val cache = withContext(Dispatchers.IO) { PawWidgetStore.read(applicationContext) }
        if (cache != null && !cache.failed && System.currentTimeMillis() - cache.fetchedWall in 0..29_999) {
            withContext(Dispatchers.IO) { PawPowerWidget.updateAll(applicationContext) }
            return Result.success()
        }
        return try {
            MonitoringData.fetch(applicationContext)
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            withContext(Dispatchers.IO) {
                runCatching { PawWidgetStore.fail(applicationContext); PawPowerWidget.updateAll(applicationContext) }
            }
            if (runAttemptCount < 3) Result.retry() else Result.success()
        }
    }
}
