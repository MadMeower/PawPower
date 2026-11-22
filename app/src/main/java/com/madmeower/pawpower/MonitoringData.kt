package com.madmeower.pawpower

import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class DeviceReading(
    val name: String,
    val receivedAt: Long,
    val ageSeconds: Long,
    val values: Map<String, Double?>
)

data class ReadingSnapshot(
    val devices: List<DeviceReading?>,
    val fetchedElapsed: Long,
    val batteryEstimate: BatteryEstimate? = null,
    val equipment: Map<String,EquipmentStatus> = emptyMap()
)

fun readingAgeSeconds(serverAge: Long, elapsedSinceFetchMs: Long): Long =
    serverAge.coerceAtLeast(0) + elapsedSinceFetchMs.coerceAtLeast(0) / 1000

class MonitoringException(message: String) : IOException(message)

object MonitoringData {
    suspend fun fetch(context: Context): ReadingSnapshot = withContext(Dispatchers.IO) {
        val credentials = try {
            PhoneCredentials.read(context)
        } catch (_: Exception) {
            throw MonitoringException("Saved connection could not be read. Open setup to reconnect.")
        } ?: throw MonitoringException("Connect this phone in setup to view your readings.")
        val connection = URL("https://your-server.example/api.php?action=read")
            .openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Authorization", "Bearer " + credentials.appToken)
            connection.setRequestProperty("Accept", "application/json")
            when (connection.responseCode) {
                200 -> Unit
                401 -> throw MonitoringException("Saved app token was rejected. Open setup to update it.")
                else -> throw MonitoringException("Server unavailable. Try refreshing shortly.")
            }
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (output.size() <= 32768) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 32769 - output.size()))
                    if (count == -1) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            if (bytes.size > 32768) throw MonitoringException("Unexpected server response.")
            val json = JSONObject(String(bytes, Charsets.UTF_8))
            val devices = json.getJSONObject("devices")
            val result = listOf("pawpower", "tracer").map { id ->
                if (devices.isNull(id)) null else {
                    val device = devices.getJSONObject(id)
                    val values = device.getJSONObject("readings")
                    DeviceReading(
                        name = if (id == "pawpower") "PawPower" else "Tracer",
                        receivedAt = device.getLong("received_at"),
                        ageSeconds = device.getLong("age_seconds").coerceAtLeast(0),
                        values = fields.associateWith { field ->
                            (values.opt(field) as? Number)?.toDouble()?.takeIf { it.isFinite() }
                        }
                    )
                }
            }
            var equipment: Map<String,EquipmentStatus> = emptyMap()
            val estimate = try {
                val latest = PawServer.json(context, "history.php?latest=1", limit = 32768)
                equipment = parseEquipmentStatus(latest.optJSONObject("equipment"))
                val values = latest.getJSONObject("readings")
                fun number(key: String) = (values.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
                (latest.opt("age_seconds") as? Number)?.toLong()?.takeIf { it >= 0 }?.let { age ->
                    BatteryEstimate(age, number("battery_current"), number("battery_capacity_ah"),
                        number("battery_remaining_ah"), number("shunt_remaining_minutes"))
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) { null }
            ReadingSnapshot(result, SystemClock.elapsedRealtime(), estimate, equipment).also { snapshot ->
                runCatching { PawWidgetStore.save(context, snapshot); PawPowerWidget.updateAll(context) }
            }
        } catch (error: MonitoringException) {
            throw error
        } catch (_: IOException) {
            throw MonitoringException("Cannot reach PawPower. Check your internet connection.")
        } catch (_: Exception) {
            throw MonitoringException("Could not understand the server readings.")
        } finally {
            connection.disconnect()
        }
    }

    private val fields = listOf(
        "battery_voltage", "battery_current", "battery_soc", "battery_temperature_c",
        "controller_temperature_c", "solar_watts", "solar_voltage", "solar_current",
        "charge_kwh_today", "discharge_kwh_today", "solar_kwh_today"
    )
}
