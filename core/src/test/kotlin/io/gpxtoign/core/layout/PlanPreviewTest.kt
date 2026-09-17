package io.gpxtoign.core.layout

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PlanPreviewTest {

    private val options = LayoutOptions(angleStepDeg = 15.0)

    private fun planOf(vararg files: io.gpxtoign.core.gpx.GpxFile) =
        PageLayout.plan(files.toList(), PaperSpec(), options)

    @Test
    fun `the bounds hold every page, with air around them`() {
        val layout = planOf(Tracks.line(4_000.0, 18_000.0))
        val preview = PlanPreview.of(layout)
        val block = layout.pagesBounds()

        assertTrue(preview.pages.isNotEmpty())
        for (page in preview.pages) {
            assertTrue(
                preview.bounds.contains(page.rect.uMin, page.rect.vMin) &&
                    preview.bounds.contains(page.rect.uMax, page.rect.vMax),
                "page ${page.number} sticks out of the preview bounds",
            )
        }
        assertTrue(preview.bounds.width > block.width)
        assertTrue(preview.bounds.height > block.height)
    }

    @Test
    fun `each leg stays its own polyline, so nothing joins two traces`() {
        val first = Tracks.line(0.0, 6_000.0)
        val second = Tracks.of(20_000.0 to 0.0, 20_000.0 to 6_000.0)
        val preview = PlanPreview.of(planOf(first, second))

        assertEquals(2, preview.tracks.size)
    }

    @Test
    fun `thinning drops samples the canvas could not tell apart, and keeps the ends`() {
        val layout = planOf(Tracks.line(0.0, 20_000.0))
        val coarse = PlanPreview.of(layout, widthPx = 40)
        val fine = PlanPreview.of(layout, widthPx = 4_000)

        assertTrue(
            coarse.tracks[0].size < fine.tracks[0].size,
            "a 40 px preview kept as many points as a 4000 px one",
        )
        val (u, v) = layout.toPage(layout.samples.last())
        val end = coarse.tracks[0].last()
        assertEquals(u, end.u, 1e-6)
        assertEquals(v, end.v, 1e-6)
    }

    @Test
    fun `north is a unit vector in the page frame`() {
        val preview = PlanPreview.of(planOf(Tracks.line(9_000.0, 9_000.0)))
        val length = kotlin.math.hypot(preview.north.u, preview.north.v)
        assertEquals(1.0, length, 1e-9)
    }
}
