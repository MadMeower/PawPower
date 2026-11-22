package com.madmeower.pawpower

import org.junit.Assert.assertEquals
import org.junit.Test

class DashboardColorsTest {
    @Test
    fun dischargeChargeIdleAndStaleUseWebsiteFlowColors() {
        assertEquals(0xFFFF7979.toInt(), DashboardColors.batteryFlow(-8.2, true))
        assertEquals(0xFF64E5B0.toInt(), DashboardColors.batteryFlow(8.2, true))
        for (amps in listOf(-0.15, 0.0, 0.15)) {
            assertEquals(0xFF93A6B8.toInt(), DashboardColors.batteryFlow(amps, true))
        }
        assertEquals(0xFF93A6B8.toInt(), DashboardColors.batteryFlow(-8.2, false))
        assertEquals(0xFF93A6B8.toInt(), DashboardColors.batteryFlow(null, true))
    }

    @Test
    fun socMatchesWebsiteStopsAndInterpolatesBetweenThem() {
        val expected = mapOf(
            10.0 to 0xFFD9364F.toInt(), 20.0 to 0xFFFF4F57.toInt(),
            30.0 to 0xFFFF9F43.toInt(), 50.0 to 0xFFBEDC53.toInt(),
            90.0 to 0xFF42EF85.toInt(), 25.0 to 0xFFFF774D.toInt(),
            70.0 to 0xFF80E66C.toInt()
        )
        expected.forEach { (soc, color) ->
            assertEquals("SOC $soc", color, DashboardColors.stateOfCharge(soc))
        }
        assertEquals(0xFFD9364F.toInt(), DashboardColors.stateOfCharge(-1.0))
        assertEquals(0xFF42EF85.toInt(), DashboardColors.stateOfCharge(101.0))
        assertEquals(0xFF93A6B8.toInt(), DashboardColors.stateOfCharge(Double.NaN))
    }
}
