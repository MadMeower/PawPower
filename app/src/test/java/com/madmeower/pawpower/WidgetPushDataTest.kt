package com.madmeower.pawpower

import org.junit.Assert.*
import org.junit.Test

class WidgetPushDataTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private val now = 1_795_360_000L
    private fun message() = mapOf("type" to "pawpower_widget_v1", "installation_id" to id,
        "sample_time" to (now - 30).toString(), "sent_time" to now.toString(),
        "soc" to "68.5", "watts" to "-315")
    @Test fun parsesSignedWattsAndPreservesTransitAge() {
        val result = parseWidgetPush(message(), id, (now + 20) * 1000)!!
        assertEquals(68.5, result.soc!!, 0.001)
        assertEquals(-315.0, result.watts!!, 0.001)
        assertEquals(50L, result.ageSeconds)
    }
    @Test fun missingReadingsStayMissingInsteadOfZero() {
        val result = parseWidgetPush(message() + mapOf("soc" to "null", "watts" to "null"), id, now * 1000)!!
        assertNull(result.soc); assertNull(result.watts)
        assertNull(parseWidgetPush(message() - "watts", id, now * 1000))
    }
    @Test fun rejectsWrongPhoneMalformedValuesAndInvalidTimes() {
        assertNull(parseWidgetPush(message(), "other-installation", now * 1000))
        for (bad in listOf("NaN", "Infinity", "100.01", "-1", ""))
            assertNull(parseWidgetPush(message() + ("soc" to bad), id, now * 1000))
        assertNull(parseWidgetPush(message() + ("watts" to "2000001"), id, now * 1000))
        assertNull(parseWidgetPush(message() + ("sample_time" to (now + 60).toString()), id, now * 1000))
        assertNull(parseWidgetPush(message(), id, (now + 86401) * 1000))
        assertNull(parseWidgetPush(message(), id, (now - 301) * 1000))
    }
    @Test fun telemetryNeverFallsThroughToAlertDisplayEvenForUnknownVersion() {
        assertTrue(isWidgetPush(message()))
        assertTrue(isWidgetPush(mapOf("type" to "pawpower_widget_v2")))
        assertNull(parseWidgetPush(message() + ("type" to "pawpower_widget_v2"), id, now * 1000))
        assertFalse(isWidgetPush(mapOf("kind" to "low_soc", "device" to "pawpower")))
    }
}
