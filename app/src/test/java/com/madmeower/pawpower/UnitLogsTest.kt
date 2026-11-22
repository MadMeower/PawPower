package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
class UnitLogsTest {
 @Test fun sevenCalendarDaysAcrossDst() {
  val days=unitLogDays(Instant.parse("2026-11-03T12:00:00Z"))
  assertEquals(7,days.size);assertEquals("2026-11-03",days.first());assertEquals("2026-10-28",days.last())
 }
 @Test fun valuesAndCsvPreserveUnavailableFieldsAndFahrenheit() {
  val point=UnitLogPoint(1795179600,listOf(null,10.0,900.0,52.0,-1.0,25.0,30.0))
  assertTrue(validUnitLogPoint(point));assertNull(unitLogValue(point,0));assertEquals(77.0,unitLogValue(point,5)!!,0.0001)
  val data=UnitLogSnapshot("tracer","2026-11-20",1795200000,null,true,false,true,true,0,
   listOf(UnitLogEvent(1795179600,10,3)),listOf(point))
  val csv=unitLogCsv(data,true)
  assertTrue(csv.contains("900.00,,10.00,52.00,-1.00,77.00,86.00,partial"))
  assertTrue(unitLogCsv(data,false).contains("CAN bus-off"))
 }
 @Test fun rejectsNonfiniteAndOutOfRangeReadings() {
  val point=UnitLogPoint(1,listOf(90.0,10.0,900.0,52.0,-1.0,25.0,30.0))
  assertTrue(validUnitLogPoint(point))
  assertFalse(validUnitLogPoint(point.copy(values=point.values.mapIndexed { i,v->if(i==2)Double.NaN else v })))
  assertFalse(validUnitLogPoint(point.copy(values=point.values.dropLast(1))))
  assertFalse(validUnitLogPoint(point.copy(values=point.values.mapIndexed { i,v->if(i==5)151.0 else v })))
 }
 @Test fun recoveryAndFaultLabelsAreDistinct() {
  assertTrue(unitEventLabel(20,0x8002).contains("8002"))
  assertTrue(unitEventLabel(20,0).contains("cleared"))
  assertTrue(unitEventLabel(26,5 shl 8).contains("timed out"))
 }
}
