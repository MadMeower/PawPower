package com.madmeower.pawpower

import org.junit.Assert.assertEquals
import org.junit.Test

class BatteryEstimateTest {
    @Test fun chargingUsesConfiguredCapacityAndNetAmps() {
        assertEquals("Estimated time to full · 2h 30m",
            batteryTimeEstimate(BatteryEstimate(0, 20.0, 200.0, 150.0, 99.0), 0))
    }
    @Test fun dischargingUsesShuntEstimateWithCapacityFallback() {
        assertEquals("Estimated time to empty · 1h 31m",
            batteryTimeEstimate(BatteryEstimate(0, -20.0, 200.0, 150.0, 91.0), 0))
        assertEquals("Estimated time to empty · 7h 30m",
            batteryTimeEstimate(BatteryEstimate(0, -20.0, 200.0, 150.0, null), 0))
    }
    @Test fun staleIdleAndMissingDataDoNotInventDurations() {
        val data = BatteryEstimate(299, 20.0, 200.0, 150.0, null)
        assertEquals("Time estimate unavailable", batteryTimeEstimate(data, 1000))
        assertEquals("Time estimate unavailable", batteryTimeEstimate(data.copy(capacityAh = null), 0))
        assertEquals("Time estimate unavailable", batteryTimeEstimate(data.copy(remainingAh = 201.0), 0))
        assertEquals("Time estimate · Idle", batteryTimeEstimate(data.copy(amps = 0.1), 0))
        assertEquals("Time estimate unavailable", batteryTimeEstimate(null, 0))
    }
}
