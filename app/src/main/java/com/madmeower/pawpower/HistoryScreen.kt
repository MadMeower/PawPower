package com.madmeower.pawpower

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

fun historyNumber(value: Double?, unit: String): String =
    value?.let { String.format(Locale.getDefault(), "%.2f %s", it, unit) } ?: "—"

@Composable
fun HistoryScreen(model: HistoryViewModel, modifier: Modifier = Modifier, onBack: () -> Unit) {
    var solar by rememberSaveable { mutableStateOf(false) }
    var graphs by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { model.refresh(); delay(60_000) }
        }
    }
    val history = model.snapshot?.devices?.get(if (solar) "tracer" else "pawpower")
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("History & daily maxes", style = MaterialTheme.typography.headlineMedium)
            Row {
                TextButton(onClick = onBack) { Text("Back") }
                TextButton(onClick = { scope.launch { model.refresh() } }, enabled = !model.loading) {
                    Text(if (model.loading) "Loading…" else "Refresh")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterChip(!solar, { solar = false }, { Text("Shunt") })
                FilterChip(solar, { solar = true }, { Text("Tracer") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterChip(!graphs, { graphs = false }, { Text("Daily totals") })
                FilterChip(graphs, { graphs = true }, { Text("Zoomable graphs") })
            }
            Text("Stored on your server even while the app is closed. Dates use Michigan time. Peaks use saved device records where available, otherwise upload samples. Energy may cover only part of a day.",
                style = MaterialTheme.typography.bodySmall)
            model.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (history?.days.isNullOrEmpty()) Text("No history yet. Install the updated server files and device upload packages; collection begins with their first snapshots.")
        }
        if (graphs) item { HistoryGraphCard(model.snapshot, if (solar) "tracer" else "pawpower") }
        if (!graphs) items(history?.days.orEmpty(), key = { it.date }) { day ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(day.date, style = MaterialTheme.typography.titleLarge)
                    if (solar) {
                        Text("Solar generated: " + historyNumber(day.solar, "kWh"))
                        Text("Peak solar: " + historyNumber(day.peaks["solar_watts"], "W"))
                    } else {
                        Text("Charged: " + historyNumber(day.charge, "kWh"))
                        Text("Discharged: " + historyNumber(day.discharge, "kWh"))
                        Text("Peak charging: " + historyNumber(day.peaks["charge_watts"], "W") +
                            " · " + historyNumber(day.peaks["charge_amps"], "A"))
                        Text("Peak discharging: " + historyNumber(day.peaks["discharge_watts"], "W") +
                            " · " + historyNumber(day.peaks["discharge_amps"], "A"))
                    }
                    Text("Max battery temperature: " + historyNumber(day.peaks["battery_temperature_c"]?.let { it * 1.8 + 32 }, "°F"))
                    if (solar) Text("Max controller temperature: " +
                        historyNumber(day.peaks["controller_temperature_c"]?.let { it * 1.8 + 32 }, "°F"))
                    Text("Observed coverage: " + historyNumber((if (solar) day.solarSeconds else day.seconds) / 3600.0, "h") +
                        " · " + (if ((if (solar) day.solarSource else day.chargeSource) == "device") "Device energy total" else "Integrated observed samples"),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
