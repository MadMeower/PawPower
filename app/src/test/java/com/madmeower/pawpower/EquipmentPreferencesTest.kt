package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test
class EquipmentPreferencesTest {
    private val prefs=EquipmentPreferences("a".repeat(32),"60",false,false,false,"113",false,"113")
    @Test fun equipmentThresholdValidation() {
        assertNull(prefs.error())
        assertNotNull(prefs.copy(controllerF="NaN").error())
        assertNotNull(prefs.copy(batteryF="303").error())
        assertNotNull(prefs.copy(delay="29").error())
    }
    @Test fun equipmentAgeBecomesStaleWithoutClaimingRecovery() {
        val s=EquipmentStatus(60,true,listOf("CAN bus-off"))
        assertFalse(equipmentStatusStale(s,29000))
        assertTrue(equipmentStatusStale(s,30000))
        assertEquals(listOf("CAN bus-off"),s.active)
    }
}
