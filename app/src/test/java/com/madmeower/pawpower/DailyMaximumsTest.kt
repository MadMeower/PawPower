package com.madmeower.pawpower

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class DailyMaximumsTest {
    private fun day(date: String, watts: Double) = HistoryDay(date, null, null, null, 0, 0,
        mapOf("solar_watts" to watts), "", "")

    @Test fun maximumsFollowServerCalendarAndSelectedDevice() {
        val yesterday = day("2026-11-16", 100.0)
        val today = day("2026-11-17", 200.0)
        val tracer = day("2026-11-17", 800.0)
        val snapshot = HistorySnapshot(Instant.parse("2026-11-17T04:59:59Z").epochSecond, 1000,
            mapOf("pawpower" to DeviceHistory(listOf(today, yesterday), emptyList()),
                "tracer" to DeviceHistory(listOf(tracer), emptyList())))
        assertEquals(yesterday, todayHistoryDay(snapshot, "pawpower", 1000))
        assertEquals(today, todayHistoryDay(snapshot, "pawpower", 3000))
        assertEquals(tracer, todayHistoryDay(snapshot, "tracer", 3000))
    }

    @Test fun yesterdayNeverAppearsAsTodaysMaximum() {
        val snapshot = HistorySnapshot(Instant.parse("2026-11-17T12:00:00Z").epochSecond, 0,
            mapOf("pawpower" to DeviceHistory(listOf(day("2026-11-16", 500.0)), emptyList())))
        assertNull(todayHistoryDay(snapshot, "pawpower", 0))
        assertNull(todayHistoryDay(snapshot, "tracer", 0))
        assertNull(todayHistoryDay(null, "pawpower", 0))
    }
}
