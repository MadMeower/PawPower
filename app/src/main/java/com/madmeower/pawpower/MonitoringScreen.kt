package com.madmeower.pawpower

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.madmeower.pawpower.ui.theme.PawPowerTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

@Composable
fun MonitoringScreen(
    model: MonitoringViewModel,
    historyModel: HistoryViewModel,
    modifier: Modifier = Modifier,
    onOpenSetup: () -> Unit,
    onOpenHistory: () -> Unit = {},
    onOpenBatterySettings: () -> Unit = {},
    onOpenGame: () -> Unit = {},
    onOpenLogs: (Boolean) -> Unit = {}
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(SystemClock.elapsedRealtime()) }
    val pages = rememberPagerState(pageCount = { 2 })
    val fahrenheit = true

    LaunchedEffect(lifecycle, model, historyModel) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch {
                while (true) {
                    model.refresh()
                    delay(30_000)
                }
            }
            launch {
                while (true) {
                    historyModel.refresh()
                    delay(60_000)
                }
            }
            launch {
                while (true) {
                    now = SystemClock.elapsedRealtime()
                    delay(1000)
                }
            }
        }
    }
    HorizontalPager(state = pages, modifier = modifier.fillMaxSize()) { page ->
    Dashboard(
        snapshot = model.snapshot,
        error = model.error,
        loading = model.loading,
        now = now,
        solar = page == 1,
        fahrenheit = fahrenheit,
        onSolarChange = { selected -> scope.launch { pages.animateScrollToPage(if (selected) 1 else 0) } },
        onRefresh = {
            scope.launch { model.refresh() }
            scope.launch { historyModel.refresh() }
        },
        history = historyModel.snapshot,
        historyError = historyModel.error,
        historyLoading = historyModel.loading,
        onOpenSetup = onOpenSetup,
        onOpenHistory = onOpenHistory,
        onOpenGame = onOpenGame,
        onOpenLogs = onOpenLogs,
        onOpenBatterySettings = onOpenBatterySettings,
        modifier = Modifier.fillMaxSize()
    )
    }
}

private data class Metric(val label: String, val value: Double?, val unit: String, val note: String)

@Composable
private fun Dashboard(
    snapshot: ReadingSnapshot?,
    error: String?,
    loading: Boolean,
    now: Long,
    solar: Boolean,
    fahrenheit: Boolean,
    onSolarChange: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onOpenSetup: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenHistory: () -> Unit = {},
    onOpenBatterySettings: () -> Unit = {},
    onOpenGame: () -> Unit = {},
    onOpenLogs: (Boolean) -> Unit = {},
    history: HistorySnapshot? = null,
    historyError: String? = null,
    historyLoading: Boolean = false
) {
    val colors = MaterialTheme.colorScheme
    var menuExpanded by remember { mutableStateOf(false) }
    val device = snapshot?.devices?.getOrNull(if (solar) 1 else 0)
    val age = device?.let { readingAgeSeconds(it.ageSeconds, now - (snapshot?.fetchedElapsed ?: now)) }
    val stale = age != null && age >= 300
    val tone = if (stale || error != null) colors.error else colors.primary
    val equipment = snapshot?.equipment?.get(if (solar) "tracer" else "pawpower")
    val equipmentStale = equipment?.let { equipmentStatusStale(it, now - (snapshot?.fetchedElapsed ?: now)) } ?: true
    val values = device?.values.orEmpty()
    fun temperature(field: String) = values[field]?.let { if (fahrenheit) it * 1.8 + 32 else it }
    val temperatureUnit = if (fahrenheit) "°F" else "°C"
    val voltage = values["battery_voltage"]
    val amps = values["battery_current"]
    val batteryPower = if (voltage != null && amps != null) voltage * amps else null
    val fresh = !stale && error == null && device != null
    val donut = rememberDonutSurprises(values["battery_soc"], fresh, solar)
    val flowTone = Color(DashboardColors.batteryFlow(amps, fresh))
    val socTone = Color(DashboardColors.stateOfCharge(values["battery_soc"]))
        .copy(alpha = if (fresh) 1f else 0.45f)
    val flow = when {
        amps == null -> "Amps unavailable"
        stale || error != null -> "Last reported battery flow"
        amps > 0.15 -> "Charging"
        amps < -0.15 -> "Discharging"
        else -> "No net amps"
    }
    val metrics = if (solar) listOf(
        Metric("TRACER VOLTAGE", values["solar_voltage"], "V", ""),
        Metric("TRACER AMPS", values["solar_current"], "A", ""),
        Metric("BATTERY VOLTAGE", voltage, "V", ""),
        Metric("BATTERY AMPS", amps, "A", ""),
        Metric("BATTERY TEMPERATURE", temperature("battery_temperature_c"), temperatureUnit, ""),
        Metric("CONTROLLER TEMPERATURE", temperature("controller_temperature_c"), temperatureUnit, "")
    ) else listOf(
        Metric("BATTERY VOLTAGE", voltage, "V", ""),
        Metric("BATTERY AMPS", amps, "A", ""),
        Metric("TEMPERATURE", temperature("battery_temperature_c"), temperatureUnit, ""),
        Metric("SNAPSHOT AGE", age?.toDouble(), "s", "")
    )

    Box(
        modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF142A28), colors.background), endY = 650f)
        ),
        contentAlignment = Alignment.TopCenter
    ) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(148.dp),
            state = rememberLazyGridState(),
            modifier = Modifier.widthIn(max = 960.dp).fillMaxSize(),
            contentPadding = PaddingValues(18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        PawLogo(onTap = donut::pawTapped)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("PAW POWER", color = colors.primary, fontSize = 12.sp,
                                fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                            Text("Monitor",
                                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        }
                        Box {
                            TextButton(onClick = { menuExpanded = true }) { Text("Menu") }
                            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                DropdownMenuItem(text = { Text("History & graphs") }, onClick = {
                                    menuExpanded = false; onOpenHistory()
                                })
                                DropdownMenuItem(text = { Text("Unit logs") }, onClick = {
                                    menuExpanded = false; onOpenLogs(solar)
                                })
                                DropdownMenuItem(text = { Text("Paw Ball · Donut") }, onClick = {
                                    menuExpanded = false; onOpenGame()
                                })
                                DropdownMenuItem(text = { Text("Shunt battery settings") }, onClick = {
                                    menuExpanded = false; onOpenBatterySettings()
                                })
                                DropdownMenuItem(text = { Text("Notifications") }, onClick = {
                                    menuExpanded = false; onOpenSetup()
                                })
                            }
                        }
                    }
                    equipment?.let { status ->
                        if (status.active.isNotEmpty()) Surface(color = if (equipmentStale || error != null) colors.surfaceContainerHigh else colors.errorContainer,
                            shape = RoundedCornerShape(14.dp)) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(if (equipmentStale || error != null) "Last reported equipment alerts · stale" else "Equipment alert", fontWeight = FontWeight.Bold)
                                status.active.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                            }
                        } else if (equipmentStale || error != null || !status.known) Text(
                            if (equipmentStale || error != null) "Equipment status is stale" else "Equipment fault status unavailable",
                            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FilterChip(selected = !solar, onClick = { onSolarChange(false) }, label = { Text("Shunt") })
                        FilterChip(selected = solar, onClick = { onSolarChange(true) }, label = { Text("Tracer") })
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(30.dp),
                            color = colors.surface, border = BorderStroke(1.dp, colors.outlineVariant)) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(6.dp).background(tone, RoundedCornerShape(3.dp)))
                                Spacer(Modifier.width(8.dp))
                                Text(when {
                                    error != null -> "Connection interrupted"
                                    stale -> "Stale · ${ageLabel(age ?: 0)} ago"
                                    age != null -> "Received ${ageLabel(age)} ago"
                                    loading -> "Connecting…"
                                    else -> "Waiting for readings"
                                }, fontSize = 12.sp, color = tone)
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = onRefresh, enabled = !loading) {
                            Text(if (loading) "Refreshing…" else "Refresh")
                        }
                    }
                }
            }
            if (error != null) item(span = { GridItemSpan(maxLineSpan) }) {
                Panel {
                    Text(error, color = colors.error)
                    if (snapshot != null) Text("Last downloaded readings remain below.",
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                if (device == null) Panel {
                    Text(if (loading) "Loading your readings…" else "No readings received yet",
                        style = MaterialTheme.typography.titleMedium)
                    Text("This device will appear after its first upload.", color = colors.onSurfaceVariant)
                } else if (solar) Panel {
                    Eyebrow("SOLAR HARVEST")
                    BigValue(values["solar_watts"], "W", tone, 54)
                    if (stale || error != null) Text("Last reported solar power",
                        color = colors.onSurfaceVariant)
                } else Panel {
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                        if (maxWidth >= 560.dp) Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(28.dp)
                        ) {
                            ChargeRing(values["battery_soc"], socTone, onLongPress = donut::socHeld)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                BatteryFlow(flow, batteryPower, flowTone,
                                    if (fresh) batteryTimeEstimate(snapshot?.batteryEstimate, now - (snapshot?.fetchedElapsed ?: now))
                                    else "Time estimate unavailable")
                            }
                        } else Column(
                            Modifier.fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(20.dp)
                        ) {
                            ChargeRing(values["battery_soc"], socTone, onLongPress = donut::socHeld)
                            BatteryFlow(flow, batteryPower, flowTone,
                                    if (fresh) batteryTimeEstimate(snapshot?.batteryEstimate, now - (snapshot?.fetchedElapsed ?: now))
                                    else "Time estimate unavailable")
                        }
                    }
                }
            }
            items(metrics) { metric ->
                Panel {
                    Eyebrow(metric.label)
                    val metricTone = when {
                        !fresh -> colors.onSurfaceVariant
                        metric.label == "BATTERY AMPS" -> flowTone
                        metric.value != null && metric.value < 0 -> Color(DashboardColors.discharging)
                        else -> colors.onSurface
                    }
                    BigValue(metric.value, metric.unit, metricTone, 28)
                    if (metric.note.isNotEmpty()) Text(metric.note, color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Panel {
                    Text(if (solar) "Today's solar harvest" else "Today's total",
                        style = MaterialTheme.typography.titleMedium)
                    if (solar) {
                        BigValue(values["solar_kwh_today"], "kWh", colors.tertiary, 32)
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            Column(Modifier.weight(1f)) {
                                Eyebrow("CHARGED")
                                BigValue(values["charge_kwh_today"], "kWh", colors.primary, 26)
                            }
                            Column(Modifier.weight(1f)) {
                                Eyebrow("DISCHARGED")
                                BigValue(values["discharge_kwh_today"], "kWh", Color(0xFFFF7979), 26)
                            }
                        }
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                val today = todayHistoryDay(history, if (solar) "tracer" else "pawpower", now)
                DailyMaximums(today, solar, historyLoading, historyError)
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Locally grown · Free range electrons",
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    device?.let {
                        Text("Server received: " + DateFormat.getDateTimeInstance().format(Date(it.receivedAt * 1000)),
                            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    }
                    Text("PawPower " + BuildConfig.VERSION_NAME,
                        style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                }
            }
        }
        donut.cameo?.let { mode ->
            DonutOverlay(mode, Modifier.align(Alignment.BottomCenter)) { donut.cameo = null }
        }
    }
}

@Composable
private fun DailyMaximums(day: HistoryDay?, solar: Boolean, loading: Boolean, error: String?) {
    val colors = MaterialTheme.colorScheme
    Panel {
        Text("Today's maximums", style = MaterialTheme.typography.titleMedium)
        if (day == null) {
            Text(when {
                error != null -> "Maximums unavailable"
                loading -> "Loading maximums…"
                else -> "No maximums recorded today"
            }, color = colors.onSurfaceVariant)
        } else {
            val peaks = day.peaks
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                if (solar) {
                    Column(Modifier.weight(1f)) {
                        Eyebrow("SOLAR WATTS")
                        BigValue(peaks["solar_watts"], "W", colors.tertiary, 26)
                    }
                    Column(Modifier.weight(1f)) {
                        Eyebrow("TRACER AMPS")
                        BigValue(peaks["solar_amps"], "A", colors.onSurface, 26)
                    }
                } else {
                    Column(Modifier.weight(1f)) {
                        Eyebrow("CHARGING")
                        BigValue(peaks["charge_watts"], "W", colors.primary, 26)
                        BigValue(peaks["charge_amps"], "A", colors.primary, 22)
                    }
                    Column(Modifier.weight(1f)) {
                        Eyebrow("DISCHARGING")
                        val tone = Color(DashboardColors.discharging)
                        BigValue(peaks["discharge_watts"], "W", tone, 26)
                        BigValue(peaks["discharge_amps"], "A", tone, 22)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f)) {
                    Eyebrow("BATTERY TEMPERATURE")
                    BigValue(peaks["battery_temperature_c"]?.let { it * 1.8 + 32 }, "°F", colors.onSurface, 24)
                }
                if (solar) Column(Modifier.weight(1f)) {
                    Eyebrow("CONTROLLER TEMPERATURE")
                    BigValue(peaks["controller_temperature_c"]?.let { it * 1.8 + 32 }, "°F", colors.onSurface, 24)
                }
            }
            if (error != null) Text("Last downloaded maximums", color = colors.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(24.dp), color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun Eyebrow(text: String) {
    Text(text, fontSize = 11.sp, letterSpacing = 1.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun BigValue(value: Double?, unit: String, color: Color, size: Int) {
    // Separate baselines allow the unit to wrap at larger accessibility font sizes.
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalArrangement = Arrangement.Bottom
    ) {
        Text(value?.let { String.format(Locale.getDefault(), when (unit) { "W", "s" -> "%.0f"; "°F", "°C" -> "%.1f"; else -> "%.2f" }, it) }
            ?: "—", color = color, fontSize = size.sp, fontWeight = FontWeight.SemiBold)
        Text(unit, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 5.dp).align(Alignment.Bottom))
    }
}

@Composable
private fun BatteryFlow(flow: String, power: Double?, tone: Color, estimate: String) {
    Text(flow, color = tone, style = MaterialTheme.typography.titleMedium)
    BigValue(power?.let { abs(it) }, "W", tone, 42)
    Text(estimate, color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun ChargeRing(soc: Double?, color: Color, onLongPress: () -> Unit) {
    val track = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.size(210.dp).pointerInput(onLongPress) {
        detectTapGestures(onLongPress = { onLongPress() })
    }.semantics {
        onLongClick(label = "A visit from Donut") { onLongPress(); true }
        contentDescription = soc?.let { "Battery state of charge ${String.format(Locale.getDefault(), "%.0f", it)} percent" }
            ?: "Battery state of charge unavailable"
    }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(12.dp)) {
            val stroke = 12.dp.toPx()
            drawArc(track, -90f, 360f, false, style = Stroke(stroke))
            if (soc != null) drawArc(color, -90f, (soc.coerceIn(0.0, 100.0) * 3.6).toFloat(),
                false, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(soc?.let { String.format(Locale.getDefault(), "%.0f", it) } ?: "—",
                fontSize = 52.sp, fontWeight = FontWeight.SemiBold, color = color)
            Text("%", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 20.sp)
            Text("STATE OF CHARGE", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
        }
    }
}

@Composable
private fun PawLogo(onTap: () -> Unit) {
    Canvas(Modifier.size(48.dp).clickable(onClickLabel = "Paw Power", onClick = onTap).semantics { contentDescription = "Paw Power" }) {
        val scale = size.width / 64f
        drawRoundRect(Color(0xFF153C31), cornerRadius = androidx.compose.ui.geometry.CornerRadius(18 * scale))
        val mint = Color(0xFF64E5B0)
        listOf(16f to 27f, 26f to 18f, 39f to 18f, 49f to 27f).forEach { (x, y) ->
            drawOval(mint, Offset((x - 5) * scale, (y - 7) * scale), Size(10 * scale, 14 * scale))
        }
        val paw = Path().apply {
            moveTo(20 * scale, 39 * scale)
            cubicTo(24 * scale, 35 * scale, 26 * scale, 29 * scale, 32 * scale, 29 * scale)
            cubicTo(38 * scale, 29 * scale, 40 * scale, 35 * scale, 44 * scale, 39 * scale)
            cubicTo(52 * scale, 48 * scale, 46 * scale, 56 * scale, 38 * scale, 53 * scale)
            cubicTo(34 * scale, 51 * scale, 30 * scale, 51 * scale, 26 * scale, 53 * scale)
            cubicTo(18 * scale, 56 * scale, 12 * scale, 48 * scale, 20 * scale, 39 * scale)
            close()
        }
        drawPath(paw, mint)
        val bolt = Path().apply {
            moveTo(34 * scale, 32 * scale); lineTo(25 * scale, 45 * scale)
            lineTo(32 * scale, 45 * scale); lineTo(30 * scale, 54 * scale)
            lineTo(41 * scale, 39 * scale); lineTo(33 * scale, 39 * scale); close()
        }
        drawPath(bolt, Color(0xFF123128))
    }
}

private fun ageLabel(seconds: Long): String = when {
    seconds < 60 -> "${seconds}s"
    seconds < 3600 -> "${seconds / 60}m"
    seconds < 86400 -> "${seconds / 3600}h ${seconds % 3600 / 60}m"
    else -> "${seconds / 86400}d ${seconds % 86400 / 3600}h"
}

@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable
private fun BatteryDashboardPreview() {
    PawPowerTheme {
        Dashboard(
            snapshot = ReadingSnapshot(listOf(DeviceReading("PawPower", 1794798000, 12,
                mapOf("battery_soc" to 73.0, "battery_voltage" to 52.4, "battery_current" to -8.2,
                    "battery_temperature_c" to 24.0, "charge_kwh_today" to 3.24,
                    "discharge_kwh_today" to 1.18)), null), 0),
            error = null, loading = false, now = 0, solar = false, fahrenheit = true,
            onSolarChange = {}, onRefresh = {}, onOpenSetup = {}
        )
    }
}
