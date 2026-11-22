package com.madmeower.pawpower

import org.junit.Assert.*
import org.junit.Test

class AlertPreferencesTest {
    private fun valid(): AlertPreferences {
        val metrics = listOf("battery_voltage", "battery_soc", "battery_temperature_c",
            "battery_temperature_c", "battery_temperature_c", "battery_current",
            "battery_soc", "battery_soc", "battery_soc", "battery_temperature_c")
        val thresholds = listOf("12", "20", "-5", "45", "55", "0.5", "99", "15", "10", "50")
        return AlertPreferences("a".repeat(32), false, "60",
            alertLabels.keys.mapIndexed { i, id ->
                AlertRule(id, metrics[i], if (i in listOf(3,4,5,6,9)) "above" else "below",
                    thresholds[i], false)
            })
    }
    @Test fun fahrenheitInputsPreserveWireThresholds() {
        for (c in listOf(-100.0, -5.0, 0.0, 37.0, 45.0, 55.0, 150.0)) {
            val f = alertThresholdFromWire("battery_temperature_c", c)
            assertEquals(c, alertThresholdToWire("battery_temperature_c", f), 0.000001)
        }
        assertEquals(113.0, alertThresholdFromWire("battery_temperature_c", 45.0), 0.000001)
        assertEquals(13.0, alertThresholdToWire("battery_soc", 13.0), 0.000001)
    }
    @Test fun temperatureThresholdTextRemovesConversionArtifacts() {
        assertEquals("80", alertThresholdText("battery_temperature_c", 26.666667))
        assertEquals("80.5", alertThresholdText("battery_temperature_c", 26.944444))
        assertEquals("-5", alertThresholdText("battery_temperature_c", -20.555556))
        assertEquals("12.345", alertThresholdText("battery_voltage", 12.345))
    }
    @Test fun acceptsNegativeTemperatureAndCustomLevels() {
        assertNull(valid().validationError())
    }
    @Test fun rejectsInvalidSocAndNonFiniteLevels() {
        for (level in listOf("-1", "101", "NaN", "Infinity", "")) {
            val p=valid()
            assertNotNull(p.copy(rules=p.rules.map { if (it.id=="low_soc") it.copy(threshold=level) else it }).validationError())
        }
    }
    @Test fun validatesOptionalCustomNames() {
        val p = valid()
        for (name in listOf("", "Night charge", "Donut 🐾", "x".repeat(32))) {
            assertNull(p.copy(rules=p.rules.map { if(it.id=="custom_1") it.copy(name=name) else it }).validationError())
        }
        for (name in listOf("x".repeat(33), "bad\nname", "🐾".repeat(17))) {
            assertNotNull(p.copy(rules=p.rules.map { if(it.id=="custom_1") it.copy(name=name) else it }).validationError())
        }
    }
    @Test fun enforcesTemperatureOrderAndDelayBounds() {
        val p=valid()
        assertNotNull(p.copy(delay="0").validationError())
        assertNotNull(p.copy(delay="601").validationError())
        assertNotNull(p.copy(rules=p.rules.map { if(it.id=="danger_temp") it.copy(threshold="45") else it }).validationError())
    }
}
