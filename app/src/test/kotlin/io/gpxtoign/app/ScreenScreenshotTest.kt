package io.gpxtoign.app

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.junit4.createComposeRule
import com.github.takahirom.roborazzi.captureRoboImage
import io.gpxtoign.app.ui.AppTheme
import io.gpxtoign.core.JobEstimate
import io.gpxtoign.core.tiles.MapSource
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders every screen state to PNG on the JVM.
 *
 * There is no device or emulator available to this project, so Robolectric's native
 * graphics mode draws the real Compose tree and Roborazzi writes it out. The files under
 * `build/screenshots` are how the layout actually gets looked at.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h1800dp-xhdpi", sdk = [34])
class ScreenScreenshotTest {

    @get:Rule
    val compose = createComposeRule()

    private val sources = MapSource.all

    private val empty = UiState()

    private val planned = UiState(
        files = listOf(
            PickedFile(Uri.EMPTY, "tour-du-mont-blanc.gpx", 2_480),
            PickedFile(Uri.EMPTY, "variante-col-de-balme.gpx", 610),
        ),
        settings = JobSettings(marginM = 500.0, title = "Tour du Mont Blanc"),
        estimate = JobEstimate(
            pages = 7,
            tiles = 812,
            approximateBytes = 118_000_000L,
            angleDeg = 34.0,
        ),
    )

    private fun shoot(name: String, content: @Composable () -> Unit) {
        compose.setContent(content)
        compose.onRoot().captureRoboImage("build/screenshots/$name.png")
    }

    @Test
    fun empty() = shoot("1-empty") {
        AppTheme(dark = false) { ScreenContent(empty, sources, ScreenActions()) }
    }

    @Test
    fun planning() = shoot("2-planning") {
        AppTheme(dark = false) {
            ScreenContent(planned.copy(estimate = null, planning = true), sources, ScreenActions())
        }
    }

    @Test
    fun planned() = shoot("3-planned") {
        AppTheme(dark = false) { ScreenContent(planned, sources, ScreenActions()) }
    }

    @Test
    fun running() = shoot("4-running") {
        AppTheme(dark = false) {
            ScreenContent(
                planned, sources, ScreenActions(),
                job = JobUi.Running(3, 8, "Page 3 sur 7"),
            )
        }
    }

    @Test
    fun done() = shoot("5-done") {
        AppTheme(dark = false) {
            ScreenContent(
                planned, sources, ScreenActions(),
                job = JobUi.Done(8, 112_000_000L, 0, "cartes-ign.pdf"),
            )
        }
    }

    @Test
    fun dark() = shoot("6-dark") {
        AppTheme(dark = true) { ScreenContent(planned, sources, ScreenActions()) }
    }
}
