package com.madmeower.pawpower

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection

/**
 * WorkManager persists only the job, never the bearer credential or FCM token.
 * Each execution reads current credentials and asks Firebase for the latest token.
 */
class PhoneRegistrationWorker(context: Context, parameters: WorkerParameters) :
    Worker(context, parameters) {

    override fun doWork(): Result {
        val credentials = try {
            PhoneCredentials.read(applicationContext)
        } catch (_: Exception) {
            return failure("Unable to read saved app token. Save it again on this phone.")
        } ?: return failure("Enter your PawPower app token to register this phone.")

        val fcmToken = try {
            Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
        } catch (_: Exception) {
            return Result.retry()
        }

        val connection = URL(REGISTER_URL).openConnection() as HttpsURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer " + credentials.appToken)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            val payload = JSONObject()
                .put("installation_id", credentials.installationId)
                .put("fcm_token", fcmToken).toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
            when (connection.responseCode) {
                200 -> {
                    // Limit response size; never surface raw server text or credentials.
                    val reply = connection.inputStream.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(1024)
                        while (output.size() <= 8192) {
                            val count = input.read(buffer, 0, minOf(buffer.size, 8193 - output.size()))
                            if (count == -1) break
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    }
                    if (reply.size > 8192 || !JSONObject(String(reply, Charsets.UTF_8)).optBoolean("ok")) {
                        failure("Unexpected registration response. Check the backend.")
                    } else {
                        WidgetSubscriptionWorker.enqueue(applicationContext, force = true)
                        Result.success(message("Phone registered. Ready for a server push test."))
                    }
                }
                401 -> failure("App token rejected. Check the app_token from the server configuration.")
                409 -> failure("The server already has five phones. Remove an old registration on the server.")
                408, 429 -> Result.retry()
                in 500..599 -> Result.retry()
                else -> failure("Registration was rejected. Check the backend API configuration.")
            }
        } catch (_: IOException) {
            Result.retry()
        } catch (_: Exception) {
            failure("Unexpected registration response. Check the backend.")
        } finally {
            connection.disconnect()
        }
    }

    private fun failure(text: String) = Result.failure(message(text))

    companion object {
        private const val REGISTER_URL = "https://your-server.example/api.php?action=register"
        private const val WORK_NAME = "pawpower-phone-registration"
        const val MESSAGE = "registration_message"

        private fun message(text: String) = Data.Builder().putString(MESSAGE, text).build()

        fun enqueue(context: Context): UUID {
            val request = OneTimeWorkRequestBuilder<PhoneRegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // Serial work ensures an older in-flight registration cannot overwrite a newer one.
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request
            )
            return request.id
        }
    }
}
