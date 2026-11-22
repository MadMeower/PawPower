package com.madmeower.pawpower

import kotlin.math.max
import kotlin.math.min

data class GraphWindow(val start: Double, val end: Double) {
    val span: Double get() = end - start
    fun transformed(zoom: Double, panFraction: Double, anchor: Double, latest: Double): GraphWindow {
        val width = (span / zoom.coerceIn(0.1, 10.0)).coerceIn(300.0, 86400.0)
        val right = end - (span - width) * (1 - anchor.coerceIn(0.0, 1.0)) - panFraction * width
        val clamped = right.coerceIn(latest - 86400 + width, latest)
        return GraphWindow(clamped - width, clamped)
    }
}
fun graphSegments(points: List<HistoryPoint>, field: Int, window: GraphWindow): List<List<Pair<Long, Double>>> {
    val result = mutableListOf<List<Pair<Long, Double>>>()
    var current = mutableListOf<Pair<Long, Double>>()
    var last: Long? = null
    for (point in points) {
        if (point.time < window.start || point.time > window.end) continue
        val value = point.values.getOrNull(field)?.takeIf { it.isFinite() }
        if (value == null || (last != null && point.time - last > 90)) {
            if (current.isNotEmpty()) result.add(current)
            current = mutableListOf()
        }
        if (value != null) current.add(point.time to value)
        last = point.time
    }
    if (current.isNotEmpty()) result.add(current)
    return result
}
fun nearestGraphReading(points: List<HistoryPoint>, field: Int, window: GraphWindow, time: Double): HistoryPoint? =
    points.asSequence().filter { it.time >= window.start && it.time <= window.end &&
        it.values.getOrNull(field)?.isFinite() == true }
        .minByOrNull { kotlin.math.abs(it.time - time) }

fun graphCursorReading(points: List<HistoryPoint>, field: Int, window: GraphWindow, fraction: Double): HistoryPoint? =
    nearestGraphReading(points, field, window, window.start +
        (if (fraction.isFinite()) fraction.coerceIn(0.0, 1.0) else 0.5) * window.span)

fun graphSeriesBounds(points: List<HistoryPoint>, field: Int): Pair<Double, Double> =
    graphBounds(listOf(points.mapNotNull { point ->
        point.values.getOrNull(field)?.takeIf { it.isFinite() }?.let { point.time to it }
    }))

fun graphBounds(segments: List<List<Pair<Long, Double>>>): Pair<Double, Double> {
    val values = segments.flatten().map { it.second }
    val lo = values.minOrNull() ?: 0.0
    val hi = values.maxOrNull() ?: 1.0
    val pad = max((hi - lo) * 0.1, max(1.0, max(kotlin.math.abs(lo), kotlin.math.abs(hi)) * 0.02))
    return min(lo - pad, hi - 0.5) to max(hi + pad, lo + 0.5)
}
