package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test
class WidgetFreshnessTest {
    @Test fun cacheAgeSurvivesRebootAndTimeChanges() {
        assertEquals(130L,widgetAge(10,100000,500000,220000,620000))
        assertEquals(130L,widgetAge(10,100000,500000,220000,2000))
        assertEquals(130L,widgetAge(10,100000,500000,90000,620000))
        assertNull(widgetAge(null,0,0,100,100))
    }
    @Test fun netBatteryWattsPreservesDirectionAndMissingValues() {
        assertEquals(840.0, widgetBatteryWatts(52.5, 16.0)!!, 0.0001)
        assertEquals(-315.0, widgetBatteryWatts(52.5, -6.0)!!, 0.0001)
        assertEquals(0.0, widgetBatteryWatts(52.5, 0.0)!!, 0.0001)
        assertNull(widgetBatteryWatts(null, 16.0))
        assertNull(widgetBatteryWatts(52.5, null))
        assertNull(widgetBatteryWatts(Double.NaN, 1.0))
        assertNull(widgetBatteryWatts(Double.MAX_VALUE, 2.0))
    }
    @Test fun wattsTextShowsMagnitudeWithoutSigns() {
        assertEquals("842 W", widgetWattsText(842.0))
        assertEquals("320 W", widgetWattsText(-320.0))
        assertEquals("0 W", widgetWattsText(-0.1))
        assertEquals("— W", widgetWattsText(null))
    }
    @Test fun staleBoundaryMissingAndErrors() {
        assertFalse(widgetIsStale(299,13.0,false))
        assertTrue(widgetIsStale(300,13.0,false))
        assertTrue(widgetIsStale(0,null,false))
        assertTrue(widgetIsStale(0,13.0,true))
    }
}
