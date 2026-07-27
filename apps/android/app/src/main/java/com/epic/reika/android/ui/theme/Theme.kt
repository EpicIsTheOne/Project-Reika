package com.epic.reika.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = ReikaMagenta,
    secondary = ReikaCyan,
    tertiary = ReikaViolet,
    background = Ink900,
    surface = Ink800,
    surfaceVariant = Ink700,
    onPrimary = TextPrimary,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onSurfaceVariant = TextMuted,
)

private val LightColorScheme = lightColorScheme(
    primary = ReikaMagenta,
    secondary = ReikaCyan,
    tertiary = ReikaViolet,
    background = LightSurface,
    surface = LightSurface,
    onBackground = LightInk,
    onSurface = LightInk,
)

@Composable
fun ReikaTheme(
    darkTheme: Boolean = true, // dark-theme-first per the Android brief
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
