package com.madmeower.pawpower

import android.view.LayoutInflater
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/** Inflates the actual transparent widget over an example wallpaper. No network or scheduled work. */
@Preview(showBackground = true, widthDp = 280, heightDp = 400)
@Composable
fun PawPowerWidgetPreview() {
    Column(
        Modifier.fillMaxSize().background(Brush.linearGradient(
            listOf(Color(0xFF182B45), Color(0xFF50394D), Color(0xFF9A6655))
        )).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Transparent widget · examples", color = Color.White, fontSize = 14.sp)
        Text("Wide · 2 × 1", color = Color.White, fontSize = 12.sp)
        WidgetExample(68.0, 842.0, width = 150, height = 70)
        Text("Tall · 1 × 2", color = Color.White, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            WidgetExample(100.0, 12500.0, width = 56, height = 160, tall = true)
            WidgetExample(15.0, -320.0, width = 56, height = 160, tall = true)
            WidgetExample(68.0, 842.0, stale = true, width = 56, height = 160, tall = true)
        }
    }
}

@Composable
private fun WidgetExample(soc: Double, watts: Double, stale: Boolean = false,
    width: Int = 232, height: Int = 80, tall: Boolean = false) {
    AndroidView(
        modifier = Modifier.width(width.dp).height(height.dp),
        factory = { context ->
            LayoutInflater.from(context).inflate(if (tall) R.layout.pawpower_widget_tall else R.layout.pawpower_widget, null).apply {
                findViewById<TextView>(R.id.widget_soc).apply {
                    text = "${soc.toInt()}%"
                    setTextColor(if (stale) DashboardColors.neutral else DashboardColors.stateOfCharge(soc))
                }
                findViewById<TextView>(R.id.widget_watts).apply {
                    text = widgetWattsText(watts)
                    setTextColor(if (stale) DashboardColors.neutral
                        else if (watts > 0) DashboardColors.charging else DashboardColors.discharging)
                }
            }
        }
    )
}
