package com.madmeower.pawpower

import org.junit.Assert.*
import org.junit.Test

class DonutEasterEggsTest {
    @Test fun fiveQuickPawTapsRevealDonutAndReset() {
        val taps = PawTapCounter()
        for (time in listOf(0L, 200L, 400L, 600L)) assertFalse(taps.tap(time))
        assertTrue(taps.tap(800))
        assertFalse(taps.tap(900))
    }

    @Test fun isolatedTapsAndClockChangesDoNotAccidentallyTrigger() {
        val taps = PawTapCounter()
        assertFalse(taps.tap(1000))
        assertFalse(taps.tap(3000))
        assertFalse(taps.tap(200))
        assertFalse(taps.tap(400))
        assertFalse(taps.tap(600))
        assertFalse(taps.tap(800))
        assertTrue(taps.tap(1000))
    }

    @Test fun fullBatteryVisitRequiresFreshShuntAndDailyCooldown() {
        val now = 200_000_000L
        assertTrue(shouldDonutVisit(100.0, true, false, 0, now))
        assertFalse(shouldDonutVisit(99.9, true, false, 0, now))
        assertFalse(shouldDonutVisit(100.0, false, false, 0, now))
        assertFalse(shouldDonutVisit(100.0, true, true, 0, now))
        assertFalse(shouldDonutVisit(null, true, false, 0, now))
        assertFalse(shouldDonutVisit(Double.NaN, true, false, 0, now))
        assertFalse(shouldDonutVisit(100.0, true, false, now - 1000, now))
        assertFalse(shouldDonutVisit(100.0, true, false, now + 1000, now))
        assertTrue(shouldDonutVisit(100.0, true, false, now - 86_400_000, now))
    }
}
