package com.madmeower.pawpower

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class HistoryPoint(val time: Long, val values: List<Double?>)
data class HistoryDay(
    val date: String, val charge: Double?, val discharge: Double?, val solar: Double?,
    val seconds: Long, val solarSeconds: Long, val peaks: Map<String, Double?>,
    val chargeSource: String, val solarSource: String
)
data class DeviceHistory(val days: List<HistoryDay>, val points: List<HistoryPoint>)
data class HistorySnapshot(val serverTime: Long, val fetchedElapsed: Long, val devices: Map<String, DeviceHistory>)

object PawServer {
    suspend fun json(context: Context, path: String, body: JSONObject? = null, limit: Int = 4_194_304): JSONObject =
        withContext(Dispatchers.IO) {
            val credentials = PhoneCredentials.read(context)
                ?: throw MonitoringException("Connect this phone in Preferences first.")
            val connection = URL("https://your-server.example/" + path).openConnection() as HttpsURLConnection
            try {
                connection.requestMethod = if (body == null) "GET" else "POST"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 20_000
                connection.setRequestProperty("Authorization", "Bearer " + credentials.appToken)
                connection.setRequestProperty("Accept", "application/json")
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                when (connection.responseCode) {
                    200 -> Unit
                    401 -> throw MonitoringException("Saved app token was rejected. Check connection setup.")
                    404 -> throw MonitoringException("Upload the new server files to enable this feature.")
                    409 -> throw MonitoringException("Settings changed elsewhere. Reload before saving again.")
                    400 -> throw MonitoringException("Server rejected these values. Check the settings.")
                    else -> throw MonitoringException("Server unavailable. Try again shortly.")
                }
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (output.size() <= limit) {
                        val count = input.read(buffer, 0, minOf(buffer.size, limit + 1 - output.size()))
                        if (count == -1) break
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                if (bytes.size > limit) throw MonitoringException("Server response was too large.")
                JSONObject(String(bytes, Charsets.UTF_8))
            } finally { connection.disconnect() }
        }
}

fun todayHistoryDay(snapshot: HistorySnapshot?, device: String, elapsedNow: Long): HistoryDay? {
    snapshot ?: return null
    val serverNow = snapshot.serverTime + (elapsedNow - snapshot.fetchedElapsed).coerceAtLeast(0) / 1000
    val date = java.time.Instant.ofEpochSecond(serverNow).atZone(java.time.ZoneId.of("America/Detroit"))
        .toLocalDate().toString()
    return snapshot.devices[device]?.days?.firstOrNull { it.date == date }
}

object HistoryData {
    suspend fun fetch(context: Context): HistorySnapshot = withContext(Dispatchers.IO) {
        val root = PawServer.json(context, "history.php?hours=24")
        val devices = root.getJSONObject("devices")
        fun number(json: JSONObject, key: String) = (json.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
        HistorySnapshot(root.getLong("server_time"), SystemClock.elapsedRealtime(),
            listOf("pawpower", "tracer").associateWith { id ->
                val source = devices.getJSONObject(id)
                val days = source.getJSONArray("days")
                val points = source.getJSONArray("points")
                DeviceHistory(
                    (0 until days.length()).map { index ->
                        val day = days.getJSONObject(index)
                        val peaks = day.getJSONObject("peaks")
                        HistoryDay(day.getString("date"), number(day, "charge_kwh"), number(day, "discharge_kwh"),
                            number(day, "solar_kwh"), day.optLong("observed_seconds"), day.optLong("solar_observed_seconds"),
                            listOf("charge_watts", "discharge_watts", "charge_amps", "discharge_amps", "solar_watts", "solar_amps",
                                "battery_temperature_c", "controller_temperature_c").associateWith { number(peaks, it) },
                            day.optString("charge_source"), day.optString("solar_source"))
                    },
                    (0 until points.length()).map { index ->
                        val point = points.getJSONArray(index)
                        HistoryPoint(point.getLong(0), (1..6).map { field ->
                            (point.opt(field) as? Number)?.toDouble()?.takeIf { it.isFinite() }
                        })
                    }.sortedBy { it.time })
            })
    }
}

class HistoryViewModel(application: Application) : AndroidViewModel(application) {
    var snapshot by mutableStateOf<HistorySnapshot?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    suspend fun refresh() {
        if (loading) return
        loading = true
        try { snapshot = HistoryData.fetch(getApplication()); error = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: MonitoringException) { error = failure.message }
        catch (_: Exception) { error = "Could not load history. Saved results remain visible; try again." }
        finally { loading = false }
    }
}
