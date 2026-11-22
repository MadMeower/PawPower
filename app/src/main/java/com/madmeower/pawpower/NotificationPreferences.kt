package com.madmeower.pawpower

import android.app.Application
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class AlertMetric(val key: String, val label: String, val unit: String, val min: Double, val max: Double)
val alertMetrics = listOf(
    AlertMetric("battery_voltage", "Voltage", "V", 0.0, 1000.0),
    AlertMetric("battery_soc", "State of charge", "%", 0.0, 100.0),
    AlertMetric("battery_temperature_c", "Temperature", "°F", -148.0, 302.0),
    AlertMetric("battery_current", "Amps", "A", -2000.0, 2000.0)
)
val alertLabels = linkedMapOf(
    "low_voltage" to "Low voltage", "low_soc" to "Low state of charge",
    "low_temp" to "Low temperature", "high_temp" to "High temperature",
    "danger_temp" to "Danger high temperature", "charging" to "Battery charging",
    "full" to "Battery full", "custom_1" to "Custom level 1",
    "custom_2" to "Custom level 2", "custom_3" to "Custom level 3"
)
fun alertThresholdToWire(metric: String, value: Double): Double =
    if (metric == "battery_temperature_c") kotlin.math.round((value - 32) / 1.8 * 1_000_000) / 1_000_000 else value
fun alertThresholdFromWire(metric: String, value: Double): Double =
    if (metric == "battery_temperature_c") kotlin.math.round((value * 1.8 + 32) * 1_000_000) / 1_000_000 else value

fun alertThresholdText(metric: String, wireValue: Double): String {
    val value = alertThresholdFromWire(metric, wireValue)
    return if (metric == "battery_temperature_c") java.math.BigDecimal.valueOf(value)
        .setScale(1, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    else value.toString()
}

data class AlertRule(
    val id: String, val metric: String, val direction: String,
    val threshold: String, val enabled: Boolean, val name: String = ""
)
data class AlertPreferences(
    val revision: String, val enabled: Boolean, val delay: String, val rules: List<AlertRule>
) {
    fun validationError(): String? {
        val seconds = delay.toIntOrNull()
        if (seconds == null || seconds !in 30..600) return "Confirmation delay must be 30–600 seconds."
        if (rules.map { it.id }.toSet() != alertLabels.keys || rules.size != 10)
            return "Unexpected rules from the server."
        for (rule in rules) {
            if (rule.id.startsWith("custom_") && (rule.name.codePointCount(0, rule.name.length) > 32 ||
                    rule.name.toByteArray(Charsets.UTF_8).size > 64 || rule.name.any { it.code < 32 || it.code == 127 }))
                return "Alert names must be one line, up to 32 characters (64 UTF-8 bytes)."
            val metric = alertMetrics.find { it.key == rule.metric } ?: return "Unknown reading type."
            val threshold = rule.threshold.toDoubleOrNull()
            if (threshold == null || !threshold.isFinite() || threshold < metric.min || threshold > metric.max)
                return "${alertLabels[rule.id]} must be between ${metric.min} and ${metric.max} ${metric.unit}."
        }
        fun value(id: String) = rules.first { it.id == id }.threshold.toDouble()
        if (value("low_temp") >= value("high_temp") || value("high_temp") >= value("danger_temp"))
            return "Temperatures must increase: low, high, then danger high."
        if (value("low_soc") >= value("full")) return "Low SOC must be below the full level."
        return null
    }
    fun json(): JSONObject = JSONObject().put("revision", revision).put("enabled", enabled)
        .put("preferences", JSONObject().put("version", 1).put("delay", delay.toInt())
            .put("rules", JSONArray().apply {
                rules.forEach { rule -> put(JSONObject().put("id", rule.id).put("metric", rule.metric)
                    .put("direction", rule.direction).put("threshold", alertThresholdToWire(rule.metric, rule.threshold.toDouble()))
                    .put("enabled", rule.enabled).apply {
                        if (rule.id.startsWith("custom_")) put("name", rule.name.trim())
                    }) }
            }))
    companion object {
        fun parse(json: JSONObject): AlertPreferences {
            val prefs = json.getJSONObject("preferences")
            require(prefs.getInt("version") == 1)
            val array = prefs.getJSONArray("rules")
            return AlertPreferences(json.getString("revision"), json.getBoolean("enabled"),
                prefs.getInt("delay").toString(), (0 until array.length()).map { index ->
                    val rule = array.getJSONObject(index)
                    AlertRule(rule.getString("id"), rule.getString("metric"), rule.getString("direction"),
                        alertThresholdText(rule.getString("metric"), rule.getDouble("threshold")), rule.getBoolean("enabled"), rule.optString("name", ""))
                }).also { require(it.validationError() == null) }
        }
    }
}

object NotificationPreferencesData {
    suspend fun request(context: Context, update: AlertPreferences? = null): AlertPreferences =
        withContext(Dispatchers.IO) {
            val credentials = PhoneCredentials.read(context)
                ?: throw MonitoringException("Connect this phone in connection setup first.")
            val connection = URL("https://your-server.example/notification-preferences.php")
                .openConnection() as HttpsURLConnection
            try {
                connection.requestMethod = if (update == null) "GET" else "POST"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 15_000
                connection.setRequestProperty("Authorization", "Bearer " + credentials.appToken)
                connection.setRequestProperty("Accept", "application/json")
                if (update != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(update.json().toString().toByteArray(Charsets.UTF_8)) }
                }
                when (connection.responseCode) {
                    200 -> Unit
                    401 -> throw MonitoringException("Saved app token was rejected. Open connection setup.")
                    404 -> throw MonitoringException("Upload the new notification server files first.")
                    409 -> throw MonitoringException("Preferences changed elsewhere. Reload them before saving again.")
                    400 -> throw MonitoringException("Server rejected these levels. Check the values and temperature order.")
                    else -> throw MonitoringException("Notification server unavailable. Try again shortly.")
                }
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(1024)
                    while (output.size() < 8193) {
                        val count = input.read(buffer, 0, minOf(buffer.size, 8193 - output.size()))
                        if (count == -1) break
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                if (bytes.size > 8192) throw MonitoringException("Unexpected server response.")
                AlertPreferences.parse(JSONObject(String(bytes, Charsets.UTF_8)))
            } finally { connection.disconnect() }
        }
}

class NotificationPreferencesViewModel(application: Application) : AndroidViewModel(application) {
    var draft by mutableStateOf<AlertPreferences?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf("Loading notification preferences…")
        private set
    var dirty by mutableStateOf(false)
        private set
    private var saved: AlertPreferences? = null
    fun edit(value: AlertPreferences) {
        if (busy) return
        draft = value
        dirty = value != saved
        message = if (dirty) "Unsaved changes" else "Saved on server"
    }
    fun load() = request(null)
    fun save() {
        val current = draft ?: return
        current.validationError()?.let { message = it; return }
        request(current)
    }
    private fun request(update: AlertPreferences?) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val result = NotificationPreferencesData.request(getApplication(), update)
                if (update != null && update.rules.filter { it.id.startsWith("custom_") }.any { desired ->
                        result.rules.firstOrNull { it.id == desired.id }?.name?.trim() != desired.name.trim()
                    }) throw MonitoringException("Server did not save the alert names. Upload the updated notification server files, then reload before retrying.")
                saved = result; draft = result; dirty = false
                message = if (update == null) "Loaded from server" else "Saved. Display syncs within about 30 seconds."
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: MonitoringException) {
                message = error.message ?: "Could not update notification preferences."
            } catch (_: Exception) {
                message = "Could not reach or read notification preferences. Your changes are still here."
            } finally { busy = false }
        }
    }
}

@Composable
fun NotificationPreferencesScreen(
    model: NotificationPreferencesViewModel, modifier: Modifier = Modifier,
    onBack: () -> Unit, onSetup: () -> Unit, equipmentModel: EquipmentPreferencesViewModel
) {
    LaunchedEffect(model) { if (model.draft == null) model.load() }
    var confirmReload by remember { mutableStateOf(false) }
    Column(modifier.fillMaxSize().imePadding()
        .verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Notifications", style = MaterialTheme.typography.headlineLarge)
        TextButton(onClick = onBack) { Text("Back to monitoring") }
        Text("Paw Power notifications", style = MaterialTheme.typography.titleLarge)
        val draft = model.draft
        if (draft != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Notifications", Modifier.weight(1f))
                Switch(draft.enabled, { model.edit(draft.copy(enabled = it)) }, enabled = !model.busy)
            }
            OutlinedTextField(draft.delay, { model.edit(draft.copy(delay = it)) },
                label = { Text("Confirmation delay (seconds)") }, singleLine = true,
                enabled = !model.busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth())
            draft.rules.forEach { rule ->
                AlertRuleCard(rule, !model.busy) { changed ->
                    model.edit(draft.copy(rules = draft.rules.map { if (it.id == changed.id) changed else it }))
                }
            }
        }
        Text(model.message, color = if (model.dirty) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface)
        Button(onClick = model::save, enabled = draft != null && model.dirty && !model.busy,
            modifier = Modifier.fillMaxWidth()) { Text(if (model.busy) "Working…" else "Save notification preferences") }
        TextButton(onClick = { if (model.dirty) confirmReload = true else model.load() }, enabled = !model.busy) {
            Text("Reload from server")
        }
        Text("Changes may take up to one minute to apply and confirm.", style = MaterialTheme.typography.bodySmall)
        EquipmentPreferencesCard(equipmentModel)
        TextButton(onClick = onSetup) { Text("Connection & notification permission") }
    }
    if (confirmReload) AlertDialog(onDismissRequest = { confirmReload = false },
        title = { Text("Discard unsaved changes?") }, text = { Text("Reload the latest preferences from the server.") },
        confirmButton = { TextButton(onClick = { confirmReload = false; model.load() }) { Text("Reload") } },
        dismissButton = { TextButton(onClick = { confirmReload = false }) { Text("Keep editing") } })
}

@Composable
private fun AlertRuleCard(rule: AlertRule, editable: Boolean, onChange: (AlertRule) -> Unit) {
    val metric = alertMetrics.first { it.key == rule.metric }
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rule.name.ifBlank { alertLabels[rule.id] ?: rule.id }, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                Switch(rule.enabled, { onChange(rule.copy(enabled = it)) }, enabled = editable)
            }
            if (rule.id.startsWith("custom_")) {
                OutlinedTextField(rule.name, { onChange(rule.copy(name = it)) },
                    label = { Text("Alert name (optional)") }, singleLine = true, enabled = editable,
                    supportingText = { Text("Used as the notification title. Up to 32 characters.") },
                    modifier = Modifier.fillMaxWidth())
                var menu by remember { mutableStateOf(false) }
                Box {
                    TextButton(onClick = { menu = true }, enabled = editable) { Text(metric.label) }
                    DropdownMenu(menu, { menu = false }) {
                        alertMetrics.forEach { choice ->
                            DropdownMenuItem(text = { Text(choice.label) }, onClick = {
                                menu = false
                                onChange(rule.copy(metric = choice.key, threshold = when (choice.key) {
                                    "battery_soc" -> "20"; "battery_voltage" -> "12"
                                    "battery_current" -> "0.5"; else -> "113"
                                }))
                            })
                        }
                    }
                }
                Row {
                    FilterChip(rule.direction == "below", { onChange(rule.copy(direction = "below")) },
                        { Text("At or below") }, enabled = editable)
                    Spacer(Modifier.width(8.dp))
                    FilterChip(rule.direction == "above", { onChange(rule.copy(direction = "above")) },
                        { Text("At or above") }, enabled = editable)
                }
            }
            OutlinedTextField(rule.threshold, { onChange(rule.copy(threshold = it)) },
                label = { Text("${if (rule.direction == "below") "At or below" else "At or above"} (${metric.unit})") },
                singleLine = true, enabled = editable,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth())
        }
    }
}
