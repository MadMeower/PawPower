package com.madmeower.pawpower.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF64E5B0),
    onPrimary = Color(0xFF10251D),
    primaryContainer = Color(0xFF153C31),
    onPrimaryContainer = Color(0xFFB9F9DC),
    secondary = Color(0xFF93A6B8),
    secondaryContainer = Color(0xFF153C31),
    onSecondaryContainer = Color(0xFF64E5B0),
    onSecondary = Color(0xFF0B1119),
    tertiary = Color(0xFFFFD23F),
    background = Color(0xFF0B1119),
    onBackground = Color(0xFFEFF5FC),
    surface = Color(0xFF131E2B),
    onSurface = Color(0xFFEFF5FC),
    surfaceVariant = Color(0xFF203242),
    onSurfaceVariant = Color(0xFF93A6B8),
    outline = Color(0xFF536779),
    outlineVariant = Color(0xFF263748),
    error = Color(0xFFFFBC6B)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF006C49),
    primaryContainer = Color(0xFFB9F9DC),
    secondary = Color(0xFF4A6273),
    background = Color(0xFFF4FAF7),
    surface = Color(0xFFFFFFFF)
)

@Composable
fun PawPowerTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        typography = Typography,
        content = content
    )
}
