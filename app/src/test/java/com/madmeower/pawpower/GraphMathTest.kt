package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test

class GraphMathTest {
    @Test fun gapsAndNullsBreakLines() {
        fun p(t:Long,v:Double?)=HistoryPoint(t,listOf(v))
        val points=listOf(p(0,1.0),p(30,2.0),p(60,null),p(90,3.0),p(300,4.0))
        val segments=graphSegments(points,0,GraphWindow(0.0,600.0))
        assertEquals(listOf(2,1,1),segments.map { it.size })
    }
    @Test fun zoomAndPanStayInRetainedWindow() {
        val w=GraphWindow(0.0,86400.0)
        val z=w.transformed(2.0,0.0,0.5,86400.0)
        assertEquals(43200.0,z.span,0.01)
        assertEquals(21600.0,z.start,0.01)
        val p=z.transformed(1.0,-100.0,0.5,86400.0)
        assertEquals(86400.0,p.end,0.01)
        assertTrue(w.transformed(100.0,0.0,0.5,86400.0).span>=300)
    }
    @Test fun markerFindsARealVisibleReadingEvenWithSparseData() {
        val a = HistoryPoint(100, listOf(10.0))
        val missing = HistoryPoint(400, listOf(null))
        val b = HistoryPoint(700, listOf(20.0))
        val outside = HistoryPoint(1200, listOf(30.0))
        val points = listOf(a, missing, b, outside)
        val window = GraphWindow(0.0, 1000.0)
        assertEquals(b, nearestGraphReading(points, 0, window, 500.0))
        assertEquals(a, nearestGraphReading(points, 0, window, 200.0))
        assertEquals(b, nearestGraphReading(points, 0, window, 999.0))
        assertNull(nearestGraphReading(listOf(missing), 0, window, 400.0))
        assertNull(nearestGraphReading(points, 1, window, 500.0))
        assertNull(nearestGraphReading(points, 0, GraphWindow(800.0, 1000.0), 900.0))
    }
    @Test fun verticalScaleIncludesPeaksOutsideTheVisibleWindow() {
        val points = listOf(HistoryPoint(0, listOf(-800.0)), HistoryPoint(30, listOf(1500.0)),
            HistoryPoint(60, listOf(10.0)), HistoryPoint(90, listOf(20.0)),
            HistoryPoint(120, listOf(Double.NaN)), HistoryPoint(150, listOf(null)))
        val bounds = graphSeriesBounds(points, 0)
        val visible = graphSegments(points, 0, GraphWindow(60.0, 100.0))
        assertEquals(listOf(10.0, 20.0), visible.flatten().map { it.second })
        assertTrue(bounds.first < -800.0)
        assertTrue(bounds.second > 1500.0)
        assertTrue(bounds.first.isFinite() && bounds.second.isFinite())
        val empty = graphSeriesBounds(points, 1)
        assertTrue(empty.first.isFinite() && empty.second > empty.first)
    }
    @Test fun panningUnderACursorUpdatesTimestampAndWattsTogether() {
        val points = listOf(HistoryPoint(250, listOf(25.0)), HistoryPoint(500, listOf(50.0)),
            HistoryPoint(550, listOf(55.0)), HistoryPoint(800, listOf(80.0)))
        val first = GraphWindow(0.0, 1000.0)
        val panned = GraphWindow(300.0, 1300.0)
        assertEquals(HistoryPoint(500, listOf(50.0)), graphCursorReading(points, 0, first, 0.5))
        assertEquals(HistoryPoint(800, listOf(80.0)), graphCursorReading(points, 0, panned, 0.5))
        assertEquals(HistoryPoint(250, listOf(25.0)), graphCursorReading(points, 0, first, 0.25))
        assertEquals(HistoryPoint(550, listOf(55.0)), graphCursorReading(points, 0, panned, 0.25))
    }
    @Test fun constantAndNegativeValuesHaveUsableBounds() {
        val (low,high)=graphBounds(listOf(listOf(1L to -20.0,2L to -20.0)))
        assertTrue(low < -20 && high > -20)
    }
}
