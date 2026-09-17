package io.gpxtoign.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The iOS system palette, semantic names and all.
 *
 * Material's own roles do not map cleanly onto the grouped-list look this screen wants —
 * iOS distinguishes the page background from the card sitting on it, which Material treats
 * as one surface — so the colours are kept as their own type and the Material scheme is
 * derived from them for the stock controls.
 */
@Immutable
data class AppColors(
    val groupedBackground: Color,
    val card: Color,
    val cardPressed: Color,
    val label: Color,
    val secondaryLabel: Color,
    val tertiaryLabel: Color,
    val separator: Color,
    val accent: Color,
    val accentSoft: Color,
    val success: Color,
    val danger: Color,
    val fill: Color,
)

private val LightColors = AppColors(
    groupedBackground = Color(0xFFF2F2F7),
    card = Color(0xFFFFFFFF),
    cardPressed = Color(0xFFE5E5EA),
    label = Color(0xFF000000),
    secondaryLabel = Color(0x993C3C43),
    tertiaryLabel = Color(0x4D3C3C43),
    separator = Color(0xFFC6C6C8),
    accent = Color(0xFF007AFF),
    accentSoft = Color(0xFFE8F1FF),
    success = Color(0xFF34C759),
    danger = Color(0xFFFF3B30),
    fill = Color(0xFFE9E9EB),
)

private val DarkColors = AppColors(
    groupedBackground = Color(0xFF000000),
    card = Color(0xFF1C1C1E),
    cardPressed = Color(0xFF2C2C2E),
    label = Color(0xFFFFFFFF),
    secondaryLabel = Color(0x99EBEBF5),
    tertiaryLabel = Color(0x4DEBEBF5),
    separator = Color(0xFF38383A),
    accent = Color(0xFF0A84FF),
    accentSoft = Color(0xFF0A2540),
    success = Color(0xFF30D158),
    danger = Color(0xFFFF453A),
    fill = Color(0xFF2C2C2E),
)

val LocalAppColors = staticCompositionLocalOf { LightColors }

/** The San Francisco text scale, which is what makes the hierarchy read as Apple's. */
object AppText {
    val largeTitle = TextStyle(fontSize = 34.sp, lineHeight = 41.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.37.sp)
    val title3 = TextStyle(fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
    val headline = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val callout = TextStyle(fontSize = 16.sp, lineHeight = 21.sp)
    val subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
    val figure = TextStyle(fontSize = 44.sp, lineHeight = 48.sp, fontWeight = FontWeight.Bold)
}

@Composable
fun AppTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) DarkColors else LightColors
    val scheme = if (dark) {
        darkColorScheme(
            primary = colors.accent,
            onPrimary = Color.White,
            surface = colors.card,
            onSurface = colors.label,
            background = colors.groupedBackground,
            onBackground = colors.label,
            error = colors.danger,
            outline = colors.separator,
            surfaceVariant = colors.fill,
            onSurfaceVariant = colors.secondaryLabel,
        )
    } else {
        lightColorScheme(
            primary = colors.accent,
            onPrimary = Color.White,
            surface = colors.card,
            onSurface = colors.label,
            background = colors.groupedBackground,
            onBackground = colors.label,
            error = colors.danger,
            outline = colors.separator,
            surfaceVariant = colors.fill,
            onSurfaceVariant = colors.secondaryLabel,
        )
    }
    CompositionLocalProvider(LocalAppColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = Typography(
                bodyLarge = AppText.body,
                bodyMedium = AppText.callout,
                bodySmall = AppText.footnote,
                titleLarge = AppText.title3,
                labelLarge = AppText.headline,
            ),
            content = content,
        )
    }
}
