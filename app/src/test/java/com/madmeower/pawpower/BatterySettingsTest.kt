package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test
class BatterySettingsTest {
    private val defaults=listOf(1120.0,95.0,93.0,56.8,54.0,125.0,140.0,48.0,50.8,49.0,1.0,2.0,5.0,1.0,45.0,40.0,20.0,25.0)
    @Test fun validProfileAndFahrenheitConversion() {
        assertNull(batterySettingsError(defaults))
        assertEquals("113",batterySettingText(14,45.0))
        assertEquals(45.0,batterySettingWire(14,"113")!!,0.00001)
        assertEquals("56.8",batterySettingText(3,56.8))
        assertNull(batterySettingWire(3,"NaN"))
    }
    @Test fun rejectsInvalidProtectionProfiles() {
        for((index,value) in listOf(1 to 101.0,2 to 95.0,7 to 55.0,8 to 48.1,10 to 0.5,12 to 1.0,15 to 46.0,17 to 19.0,5 to -1.0)) {
            assertNotNull("Index $index",batterySettingsError(defaults.toMutableList().also{it[index]=value}))
        }
        assertNotNull(batterySettingsError(defaults.dropLast(1)))
    }
}
