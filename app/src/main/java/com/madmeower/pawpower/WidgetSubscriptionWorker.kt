package com.madmeower.pawpower

import android.content.Context
import androidx.work.*
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection

/** Only enrollment/renewal uses HTTPS. Incoming widget pushes render without a network fetch. */
class WidgetSubscriptionWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val credentials = runCatching { PhoneCredentials.read(applicationContext) }.getOrNull()
            ?: return Result.success()
        val enabled = PawPowerWidget.hasWidgets(applicationContext)
        val prefs = applicationContext.getSharedPreferences("widget-subscription", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (!inputData.getBoolean("force", false) && prefs.contains("enabled") &&
            prefs.getBoolean("enabled", false) == enabled && now - prefs.getLong("synced", 0) in 0 until SIX_HOURS)
            return Result.success()
        val token = if (enabled) try {
            Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
        } catch (_: Exception) { return retryBounded() } else null
        val connection = URL("https://your-server.example/widget-subscription.php").openConnection() as HttpsURLConnection
        return try {
            connection.requestMethod = "POST"; connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000; connection.readTimeout = 15_000; connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer " + credentials.appToken)
            connection.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("installation_id", credentials.installationId).put("enabled", enabled)
            if (token != null) body.put("fcm_token", token)
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            when (connection.responseCode) {
                200 -> {
                    val reply = connection.inputStream.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(512)
                        while (output.size() <= 4096) {
                            val count = input.read(buffer, 0, minOf(buffer.size, 4097 - output.size()))
                            if (count == -1) break
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    }
                    if (reply.size > 4096) return Result.failure()
                    val json = JSONObject(String(reply, Charsets.UTF_8))
                    if (!json.optBoolean("ok") || json.opt("enabled") != enabled) return Result.failure()
                    prefs.edit().putBoolean("enabled", enabled).putLong("synced", now).apply()
                    Result.success()
                }
                408, 429, in 500..599 -> retryBounded()
                else -> Result.failure()
            }
        } catch (_: Exception) { retryBounded() } finally { connection.disconnect() }
    }
    private fun retryBounded(): Result = if (runAttemptCount < 3) Result.retry() else Result.failure()
    companion object {
        private const val SIX_HOURS = 6 * 60 * 60 * 1000L
        fun enqueue(context: Context, force: Boolean = false) {
            val request = OneTimeWorkRequestBuilder<WidgetSubscriptionWorker>()
                .setInputData(workDataOf("force" to force))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork("pawpower-widget-subscription",
                ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
