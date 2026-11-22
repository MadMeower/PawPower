package com.madmeower.pawpower

import kotlin.math.roundToInt

/** Color rules shared with the local PawPower web dashboard. */
internal object DashboardColors {
    val neutral = 0xFF93A6B8.toInt()
    val charging = 0xFF64E5B0.toInt()
    val discharging = 0xFFFF7979.toInt()
    private val stops = arrayOf(
        10.0 to intArrayOf(217, 54, 79),
        20.0 to intArrayOf(255, 79, 87),
        30.0 to intArrayOf(255, 159, 67),
        50.0 to intArrayOf(190, 220, 83),
        90.0 to intArrayOf(66, 239, 133)
    )

    fun batteryFlow(amps: Double?, fresh: Boolean): Int = when {
        !fresh || amps == null || !amps.isFinite() -> neutral
        amps > 0.15 -> charging
        amps < -0.15 -> discharging
        else -> neutral
    }

    fun stateOfCharge(soc: Double?): Int {
        if (soc == null || !soc.isFinite()) return neutral
        val value = soc.coerceIn(0.0, 100.0)
        if (value <= stops.first().first) return rgb(stops.first().second)
        for (index in 1 until stops.size) {
            val (high, b) = stops[index]
            val (low, a) = stops[index - 1]
            if (value <= high) {
                val ratio = (value - low) / (high - low)
                return rgb(IntArray(3) { channel ->
                    (a[channel] + (b[channel] - a[channel]) * ratio).roundToInt()
                })
            }
        }
        return rgb(stops.last().second)
    }

    private fun rgb(channels: IntArray) =
        (0xFF shl 24) or (channels[0] shl 16) or (channels[1] shl 8) or channels[2]
}
