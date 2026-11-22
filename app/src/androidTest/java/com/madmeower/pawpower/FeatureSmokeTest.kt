package com.madmeower.pawpower

import android.view.View
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.madmeower.pawpower.ui.theme.PawPowerTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Synthetic data only: never reads, writes or registers phone credentials. */
class FeatureSmokeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun classicWidgetInflatesAtTwoByOneSize() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.runOnMainSync {
            val view = RemoteViews(context.packageName, R.layout.pawpower_widget).apply(context, FrameLayout(context))
            val density = context.resources.displayMetrics.density
            val width = (180 * density).toInt()
            val height = (80 * density).toInt()
            view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, width, height)
            assertNotNull(view.findViewById<View>(R.id.widget_soc))
            assertNotNull(view.findViewById<View>(R.id.widget_refresh))
            val status = view.findViewById<View>(R.id.widget_age)
            val rootPosition = IntArray(2); val statusPosition = IntArray(2)
            view.getLocationInWindow(rootPosition); status.getLocationInWindow(statusPosition)
            assertTrue("Widget age must fit", statusPosition[1] - rootPosition[1] + status.height <= height)
        }
    }

    @Test fun graphRendersAndZoomControlsWorkWithGaps() {
        val now = System.currentTimeMillis() / 1000
        val points = listOf(
            HistoryPoint(now - 300, listOf(13.0, -500.0, -10.0, null, 20.0, null)),
            HistoryPoint(now - 270, listOf(14.0, -450.0, -9.0, null, 20.0, null)),
            HistoryPoint(now - 240, List(6) { null }),
            HistoryPoint(now - 30, listOf(15.0, 500.0, 10.0, null, 22.0, null)))
        val snapshot = HistorySnapshot(now, android.os.SystemClock.elapsedRealtime(),
            mapOf("pawpower" to DeviceHistory(emptyList(), points)))
        compose.setContent { PawPowerTheme { HistoryGraphCard(snapshot, "pawpower") } }
        compose.onNodeWithText("Zoom +").performClick()
        compose.onNodeWithText("Zoom −").performClick()
        compose.onNodeWithContentDescription("SOC history graph. Missing readings and gaps over 90 seconds break the line.").assertExists()
    }

    @Test fun gameStartsAndPauses() {
        val model = PawBallViewModel()
        compose.mainClock.autoAdvance = false
        compose.setContent { PawPowerTheme { PawBallScreen(model, onBack = {}) } }
        compose.mainClock.advanceTimeByFrame()
        compose.onNodeWithText("Play", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1200)
        compose.runOnIdle { assertTrue(model.running); assertTrue(model.state.x != 320.0) }
        compose.onNodeWithText("Pause", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.runOnIdle { assertFalse(model.running) }
        compose.onNodeWithText("Paused").assertExists()
    }
}
