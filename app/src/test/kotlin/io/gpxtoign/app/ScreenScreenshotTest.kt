package io.gpxtoign.app

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.junit4.createComposeRule
import com.github.takahirom.roborazzi.captureRoboImage
import io.gpxtoign.app.ui.AppTheme
import io.gpxtoign.core.JobOptions
import io.gpxtoign.core.JobRunner
import io.gpxtoign.core.geo.L93
import io.gpxtoign.core.geo.Lambert93
import io.gpxtoign.core.geo.TileId
import io.gpxtoign.core.gpx.GpxFile
import io.gpxtoign.core.gpx.GpxSegment
import io.gpxtoign.core.layout.LayoutOptions
import io.gpxtoign.core.layout.PlanPreview
import io.gpxtoign.core.render.ArgbImage
import io.gpxtoign.core.render.ImageCodec
import io.gpxtoign.core.tiles.MapSource
import io.gpxtoign.core.tiles.TileFetcher
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
@Config(qualifiers = "w411dp-h2600dp-xhdpi", sdk = [34])
class ScreenScreenshotTest {

    @get:Rule
    val compose = createComposeRule()

    private val sources = MapSource.all

    /** A synthetic walk, in Lambert-93 metres, shaped like a loop with a spur. */
    private val mainTrace = trace(
        "tour-du-mont-blanc.gpx",
        listOf(
            0.0 to 0.0, 3_500.0 to 2_000.0, 6_000.0 to 6_500.0, 11_000.0 to 9_000.0,
            15_500.0 to 8_000.0, 18_000.0 to 12_500.0, 14_000.0 to 16_000.0,
            8_500.0 to 15_000.0, 4_000.0 to 11_000.0, 1_500.0 to 5_500.0, 0.0 to 0.0,
        ),
    )

    private val variant = trace(
        "variante-col-de-balme.gpx",
        listOf(11_000.0 to 9_000.0, 13_000.0 to 5_000.0, 16_500.0 to 3_000.0),
    )

    private fun trace(name: String, metres: List<Pair<Double, Double>>) = GpxFile(
        name = name,
        segments = listOf(
            GpxSegment(
                name = name.removeSuffix(".gpx"),
                points = metres.map { (dx, dy) ->
                    Lambert93.inverse(L93(950_000.0 + dx, 6_530_000.0 + dy))
                },
            ),
        ),
    )

    private val empty = UiState()

    private val planned = plannedState()

    /**
     * A real plan, laid out by the real solver, so the preview card on the screenshots is
     * the one the app would draw. Estimating never downloads, hence the stub fetcher.
     */
    private fun plannedState(): UiState {
        val settings = JobSettings(marginM = 500.0, title = "Tour du Mont Blanc")
        // A coarser angle step than the app uses: five times quicker, same shape of answer.
        val options = JobOptions(
            layout = LayoutOptions(marginM = settings.marginM, angleStepDeg = 15.0),
            title = settings.title,
        )
        val runner = JobRunner(NoTiles, NoCodec)
        val layout = runner.plan(listOf(mainTrace, variant), options)
        return UiState(
            files = listOf(
                PickedFile(Uri.EMPTY, "tour-du-mont-blanc.gpx", mainTrace.pointCount),
                PickedFile(Uri.EMPTY, "variante-col-de-balme.gpx", variant.pointCount),
            ),
            settings = settings,
            estimate = runner.estimate(layout, options),
            preview = PlanPreview.of(layout),
        )
    }

    private object NoTiles : TileFetcher {
        override suspend fun fetch(tile: TileId): ByteArray = error("planning never downloads")
    }

    private object NoCodec : ImageCodec {
        override fun decode(bytes: ByteArray) = error("planning never decodes")
        override fun encodeJpeg(image: ArgbImage, quality: Int) = error("planning never encodes")
    }

    private val pages = planned.estimate!!.pages

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
            ScreenContent(
                planned.copy(estimate = null, preview = null, planning = true),
                sources,
                ScreenActions(),
            )
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
                job = JobUi.Running(3, pages, "Page 3 sur $pages"),
            )
        }
    }

    @Test
    fun done() = shoot("5-done") {
        AppTheme(dark = false) {
            ScreenContent(
                planned, sources, ScreenActions(),
                job = JobUi.Done(pages, 112_000_000L, 0, "cartes-ign.pdf"),
            )
        }
    }

    @Test
    fun dark() = shoot("6-dark") {
        AppTheme(dark = true) { ScreenContent(planned, sources, ScreenActions()) }
    }
}
