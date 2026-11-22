package com.madmeower.pawpower

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

private enum class HistorySeries(val label: String, val index: Int, val unit: String, val temperature: Boolean = false) {
    SOC("SOC", 0, "%"), WATTS("Battery watts", 1, "W"), AMPS("Battery amps", 2, "A"),
    SOLAR("Solar watts", 3, "W"), BATTERY_TEMP("Battery temperature", 4, "°F", true),
    CONTROLLER_TEMP("Controller temperature", 5, "°F", true)
}

@Composable
fun HistoryGraphCard(snapshot: HistorySnapshot?, device: String) {
    var seriesName by rememberSaveable(device) { mutableStateOf(if (device == "tracer") "SOLAR" else "SOC") }
    val series = HistorySeries.valueOf(seriesName)
    val available = if (device == "tracer") listOf(HistorySeries.SOLAR, HistorySeries.BATTERY_TEMP, HistorySeries.CONTROLLER_TEMP)
        else listOf(HistorySeries.SOC, HistorySeries.WATTS, HistorySeries.AMPS, HistorySeries.BATTERY_TEMP)
    var span by rememberSaveable { mutableStateOf(21600.0) }
    var savedEnd by rememberSaveable { mutableStateOf(0.0) }
    var follow by rememberSaveable { mutableStateOf(true) }
    var cursorFraction by rememberSaveable(device) { mutableStateOf(0.5) }
    var elapsed by remember { mutableStateOf(SystemClock.elapsedRealtime()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        while (true) { elapsed = SystemClock.elapsedRealtime(); delay(1000) }
    } }
    val latest = (snapshot?.serverTime ?: System.currentTimeMillis() / 1000).toDouble() +
        ((elapsed - (snapshot?.fetchedElapsed ?: elapsed)).coerceAtLeast(0) / 1000)
    val end = if (follow || savedEnd == 0.0) latest else savedEnd.coerceIn(latest - 86400 + span, latest)
    val window = GraphWindow(end - span, end)
    val rawPoints = snapshot?.devices?.get(device)?.points.orEmpty()
    val points = remember(rawPoints, series) {
        rawPoints.map { point -> if (!series.temperature) point else point.copy(values =
            point.values.mapIndexed { i, value -> if (i == series.index) value?.let { it * 1.8 + 32 } else value }) }
    }
    val segments = remember(points, window, series) { graphSegments(points, series.index, window) }
    // Panning changes the time window, not the vertical scale. Include off-screen peaks.
    val bounds = remember(points, series) { graphSeriesBounds(points, series.index) }
    val currentWindow by rememberUpdatedState(window)
    val currentLatest by rememberUpdatedState(latest)
    val latestValid = points.lastOrNull { it.values.getOrNull(series.index) != null }
    val stale = latestValid == null || latest - latestValid.time > 90
    val color = when (series) {
        HistorySeries.SOLAR -> MaterialTheme.colorScheme.tertiary
        HistorySeries.BATTERY_TEMP, HistorySeries.CONTROLLER_TEMP -> Color(0xFFFFAA6B)
        else -> MaterialTheme.colorScheme.primary
    }
    val flowSeries = series == HistorySeries.WATTS || series == HistorySeries.AMPS
    val dischargeColor = Color(DashboardColors.discharging)
    val track = MaterialTheme.colorScheme.outlineVariant
    val markerColor = MaterialTheme.colorScheme.onSurface
    val markerBackground = MaterialTheme.colorScheme.surface
    // Anchor the cursor to the screen, so moving time underneath it updates both time and value.
    val selectedPoint = graphCursorReading(points, series.index, window, cursorFraction)
    val format = remember { SimpleDateFormat("MMM d HH:mm", Locale.getDefault()) }
    val gapColor = MaterialTheme.colorScheme.error.copy(alpha = 0.09f)
    fun applyZoom(factor: Double) {
        val changed = window.transformed(factor, 0.0, 0.5, latest)
        span = changed.span; savedEnd = changed.end; follow = false; cursorFraction = 0.5
    }
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Last 24 hours", style = MaterialTheme.typography.titleLarge)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                available.forEach { choice ->
                    FilterChip(series == choice, { seriesName = choice.name; cursorFraction = 0.5 }, { Text(choice.label) })
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                TextButton(onClick = { applyZoom(2.0) }) { Text("Zoom +") }
                TextButton(onClick = { applyZoom(0.5) }) { Text("Zoom −") }
                TextButton(onClick = { span = 86400.0; follow = true; cursorFraction = 0.5 }) { Text("24h") }
                TextButton(onClick = { follow = true; cursorFraction = 0.5 }) { Text("Latest") }
            }
            Text("Swipe sideways to pan · Pinch to zoom · Tap to mark a reading", style = MaterialTheme.typography.bodySmall)
            if (flowSeries) Text("Green: charging · Red: discharging", style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Scale max · " + historyNumber(bounds.second, series.unit), style = MaterialTheme.typography.labelSmall)
                Text(if (stale) "Stale / no fresh sample" else "Recent sample",
                    color = if (stale) MaterialTheme.colorScheme.error else color, style = MaterialTheme.typography.labelSmall)
            }
            Canvas(Modifier.fillMaxWidth().height(240.dp).semantics {
                contentDescription = series.label + " history graph. Missing readings and gaps over 90 seconds break the line."
                stateDescription = selectedPoint?.let {
                    "Marked reading " + format.format(Date(it.time * 1000)) + ": " +
                        historyNumber(it.values.getOrNull(series.index), series.unit)
                } ?: "No valid readings in this window"
            }.pointerInput(device) {
                // One recognizer owns taps, horizontal pans and pinches. Vertical motion
                // stays unconsumed so the enclosing page can scroll normally.
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    var movement = Offset.Zero
                    var horizontal = false
                    var transformed = false
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.any { it.isConsumed }) break
                        if (event.changes.count { it.pressed } >= 2) {
                            transformed = true
                            val centroid = event.calculateCentroid(useCurrent = false)
                            val pan = event.calculatePan()
                            val changed = currentWindow.transformed(event.calculateZoom().toDouble(),
                                pan.x / size.width.toDouble(), centroid.x / size.width.toDouble(), currentLatest)
                            span = changed.span; savedEnd = changed.end; follow = false; cursorFraction = 0.5
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        } else {
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) {
                                if (!horizontal && !transformed) {
                                    cursorFraction = (change.position.x / size.width).toDouble().coerceIn(0.0, 1.0)
                                    change.consume()
                                }
                                break
                            }
                            if (transformed) {
                                change.consume()
                                continue
                            }
                            val delta = change.position - change.previousPosition
                            movement += delta
                            if (!horizontal && movement.getDistance() > viewConfiguration.touchSlop) {
                                if (abs(movement.y) >= abs(movement.x)) break
                                horizontal = true
                            }
                            if (horizontal) {
                                val changed = currentWindow.transformed(1.0,
                                    delta.x / size.width.toDouble(), 0.5, currentLatest)
                                span = changed.span; savedEnd = changed.end; follow = false
                                change.consume()
                            }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }) {
                fun x(time: Double) = ((time - window.start) / window.span * size.width).toFloat()
                fun y(value: Double) = (size.height - (value - bounds.first) / (bounds.second - bounds.first) * size.height).toFloat()
                for (row in 0..4) drawLine(track, Offset(0f, size.height * row / 4), Offset(size.width, size.height * row / 4), 1f)
                for ((a, b) in points.zipWithNext()) {
                    if (b.time < window.start || a.time > window.end) continue
                    if (b.time - a.time > 90 || a.values[series.index] == null || b.values[series.index] == null) {
                        val left = x(a.time.toDouble()).coerceIn(0f, size.width)
                        val right = x(b.time.toDouble()).coerceIn(0f, size.width)
                        drawRect(gapColor, Offset(left, 0f), Size((right - left).coerceAtLeast(0f), size.height))
                    }
                }
                val last = latestValid?.time?.toDouble() ?: window.start
                if (last + 90 < window.end) {
                    val left = x((last + 90).coerceAtLeast(window.start)).coerceIn(0f, size.width)
                    drawRect(gapColor, Offset(left, 0f), Size(size.width - left, size.height))
                }
                if (bounds.first < 0 && bounds.second > 0)
                    drawLine(track, Offset(0f, y(0.0)), Offset(size.width, y(0.0)), 2f)
                segments.forEach { segment ->
                    val path = Path()
                    segment.forEachIndexed { index, (time, value) ->
                        if (index == 0) path.moveTo(x(time.toDouble()), y(value)) else path.lineTo(x(time.toDouble()), y(value))
                    }
                    if (segment.size == 1) drawCircle(if (flowSeries && segment[0].second < 0) dischargeColor else color,
                        3.dp.toPx(), Offset(x(segment[0].first.toDouble()), y(segment[0].second)))
                    else if (flowSeries) segment.zipWithNext().forEach { (a, b) ->
                        val start = Offset(x(a.first.toDouble()), y(a.second))
                        val finish = Offset(x(b.first.toDouble()), y(b.second))
                        if (a.second * b.second < 0) {
                            val fraction = (-a.second / (b.second - a.second)).toFloat()
                            val zero = start + (finish - start) * fraction
                            drawLine(if (a.second < 0) dischargeColor else color, start, zero, 2.dp.toPx(), StrokeCap.Round)
                            drawLine(if (b.second < 0) dischargeColor else color, zero, finish, 2.dp.toPx(), StrokeCap.Round)
                        } else drawLine(if (a.second < 0 || b.second < 0) dischargeColor else color,
                            start, finish, 2.dp.toPx(), StrokeCap.Round)
                    }
                    else drawPath(path, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
                }
                selectedPoint?.let { point ->
                    val markerX = x(point.time.toDouble()).coerceIn(1.dp.toPx(), size.width - 1.dp.toPx())
                    drawLine(markerColor, Offset(markerX, 0f), Offset(markerX, size.height),
                        strokeWidth = 3.dp.toPx())
                    point.values.getOrNull(series.index)?.let { value ->
                        val center = Offset(markerX, y(value))
                        drawCircle(markerBackground, 8.dp.toPx(), center)
                        drawCircle(if (flowSeries && value < 0) dischargeColor else color,
                            5.dp.toPx(), center)
                        drawCircle(markerColor, 8.dp.toPx(), center, style = Stroke(1.5.dp.toPx()))
                    }
                }
            }
            Text("Scale min · " + historyNumber(bounds.first, series.unit), style = MaterialTheme.typography.labelSmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(format.format(Date((window.start * 1000).toLong())), style = MaterialTheme.typography.labelSmall)
                Text(format.format(Date((window.end * 1000).toLong())), style = MaterialTheme.typography.labelSmall)
            }
            selectedPoint?.let {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Marked reading", style = MaterialTheme.typography.labelSmall)
                    Text(historyNumber(it.values.getOrNull(series.index), series.unit),
                        style = MaterialTheme.typography.headlineSmall, color = color)
                    Text(format.format(Date(it.time * 1000)), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (segments.isEmpty()) Text("No valid samples in this time window.")
            Text("Shaded areas have missing/stale data. Points use server receipt times; source validity limits are 15 seconds for the battery and 120 seconds for Tracer.",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}
