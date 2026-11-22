package com.madmeower.pawpower

import kotlin.math.abs
import kotlin.math.roundToLong

data class BatteryEstimate(val ageSeconds: Long, val amps: Double?, val capacityAh: Double?,
    val remainingAh: Double?, val shuntMinutes: Double?)

fun batteryTimeEstimate(data: BatteryEstimate?, elapsedMs: Long): String {
    if (data == null || readingAgeSeconds(data.ageSeconds, elapsedMs) >= 300)
        return "Time estimate unavailable"
    val amps = data.amps?.takeIf { it.isFinite() } ?: return "Time estimate unavailable"
    if (abs(amps) <= 0.15) return "Time estimate · Idle"
    val charging = amps > 0
    val remaining = data.remainingAh?.takeIf { it.isFinite() && it >= 0 }
    val capacity = data.capacityAh?.takeIf { it.isFinite() && it in 1.0..10000.0 }
    val minutes = if (charging) {
        if (remaining == null || capacity == null || remaining > capacity) null
        else (capacity - remaining) / amps * 60
    } else {
        data.shuntMinutes?.takeIf { it.isFinite() && it in 0.0..525600.0 }
            ?: remaining?.let { it / -amps * 60 }
    }
    if (minutes == null || !minutes.isFinite() || minutes < 0) return "Time estimate unavailable"
    val direction = if (charging) "full" else "empty"
    if (minutes > 525600) return "Estimated time to $direction · > 1 year"
    val rounded = minutes.roundToLong()
    return "Estimated time to $direction · ${rounded / 60}h ${rounded % 60}m"
}
