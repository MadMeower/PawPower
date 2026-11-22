package com.madmeower.pawpower

data class WidgetPushSample(val soc: Double?, val watts: Double?, val sampleTime: Long, val ageSeconds: Long)

/** A widget data message is never an alert, including unsupported future versions. */
fun isWidgetPush(data: Map<String, String>): Boolean = data["type"]?.startsWith("pawpower_widget_") == true

fun parseWidgetPush(data: Map<String, String>, installationId: String, nowMillis: Long): WidgetPushSample? {
    if (data["type"] != "pawpower_widget_v1" || data["installation_id"] != installationId) return null
    val sample = data["sample_time"]?.toLongOrNull() ?: return null
    val sent = data["sent_time"]?.toLongOrNull() ?: return null
    val now = nowMillis / 1000
    if (sample !in 1..4_102_444_800L || sent !in 1..4_102_444_800L ||
        sample > sent + 5 || sent > now + 300 || now - sent > 86400) return null
    fun number(key: String, min: Double, max: Double): Double? {
        val raw = data[key] ?: throw IllegalArgumentException()
        if (raw == "null") return null
        return raw.toDoubleOrNull()?.takeIf { it.isFinite() && it in min..max }
            ?: throw IllegalArgumentException()
    }
    return runCatching {
        WidgetPushSample(number("soc", 0.0, 100.0), number("watts", -2_000_000.0, 2_000_000.0),
            sample, maxOf(0L, sent - sample, now - sample))
    }.getOrNull()
}
