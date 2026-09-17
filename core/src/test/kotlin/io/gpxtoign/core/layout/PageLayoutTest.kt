package io.gpxtoign.core.layout

import io.gpxtoign.core.geo.Lambert93
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.min
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PageLayoutTest {

    private val paper = PaperSpec()
    private val options = LayoutOptions()

    /** 200 x 277 mm of map at 1:25000. */
    @Test
    fun `a default A4 page covers 5000 by 6925 metres`() {
        assertEquals(5000.0, paper.mapWidthM, 1e-9)
        assertEquals(6925.0, paper.mapHeightM, 1e-9)
    }

    @Test
    fun `every sample sits at least one margin inside some page`() {
        val layout = PageLayout.plan(listOf(Tracks.line(6_000.0, 18_000.0)), paper, options)
        assertCoveredWithMargin(layout)
    }

    @Test
    fun `north-up covers a north-south track along the tall page axis`() {
        val layout = PageLayout.plan(
            listOf(Tracks.line(0.0, 20_000.0)), paper, options.copy(allowRotation = false),
        )
        assertEquals(ceil(20_000.0 / 5_925.0).toInt(), layout.pages.size)
        assertEquals(0.0, layout.angleDeg, 1e-9)
        assertCoveredWithMargin(layout)
    }

    @Test
    fun `north-up covers an east-west track along the short page axis`() {
        val layout = PageLayout.plan(
            listOf(Tracks.line(20_000.0, 0.0)), paper, options.copy(allowRotation = false),
        )
        assertEquals(ceil(20_000.0 / 4_000.0).toInt(), layout.pages.size)
        assertCoveredWithMargin(layout)
    }

    /**
     * A page can swallow a straight run as long as its own diagonal, so the best rotation
     * for a straight track is the one that lays it corner to corner: hypot(4000, 5925).
     */
    @Test
    fun `rotation packs a straight track along the page diagonal`() {
        val diagonal = hypot(4_000.0, 5_925.0)
        for (bearing in listOf(0.0, 20.0, 45.0, 90.0, 137.0)) {
            val a = Math.toRadians(bearing)
            val track = listOf(Tracks.line(20_000.0 * sin(a), 20_000.0 * cos(a)))
            val rotated = PageLayout.plan(track, paper, options)
            val northUp = PageLayout.plan(track, paper, options.copy(allowRotation = false))
            assertEquals(
                ceil(20_000.0 / diagonal).toInt(), rotated.pages.size,
                "bearing $bearing",
            )
            assertTrue(rotated.pages.size <= northUp.pages.size, "bearing $bearing")
            assertCoveredWithMargin(rotated)
        }
    }

    @Test
    fun `rotation saves pages on an east-west track`() {
        val track = listOf(Tracks.line(20_000.0, 0.0))
        val northUp = PageLayout.plan(track, paper, options.copy(allowRotation = false))
        val rotated = PageLayout.plan(track, paper, options)
        assertEquals(5, northUp.pages.size)
        assertEquals(3, rotated.pages.size)
        assertCoveredWithMargin(rotated)
    }

    @Test
    fun `an out-and-back does not pay for the return leg`() {
        val out = (0..100).map { 0.0 to 20_000.0 * it / 100 }
        val back = (0..100).map { 120.0 to 20_000.0 * (100 - it) / 100 }
        val layout = PageLayout.plan(listOf(Tracks.of(out + back)), paper, options)
        val oneWay = PageLayout.plan(listOf(Tracks.line(0.0, 20_000.0)), paper, options)
        // The return leg runs 120 m from the outbound one, so it must ride the same pages.
        assertEquals(oneWay.pages.size, layout.pages.size)
        assertCoveredWithMargin(layout)
    }

    @Test
    fun `a loop reuses pages on both sides`() {
        val r = 6_000.0
        val ring = (0..359).map { d ->
            val a = Math.toRadians(d.toDouble())
            r * kotlin.math.sin(a) to r * kotlin.math.cos(a)
        }
        val layout = PageLayout.plan(listOf(Tracks.of(ring)), paper, options)
        // A 12 km wide ring cannot fit one 4000 x 5925 effective page, but four is plenty.
        assertTrue(layout.pages.size in 2..6, "got ${layout.pages.size} pages")
        assertCoveredWithMargin(layout)
    }

    @Test
    fun `a bigger margin can cost more pages and never fewer`() {
        val track = listOf(Tracks.line(0.0, 20_000.0))
        val small = PageLayout.plan(track, paper, options.copy(marginM = 250.0))
        val large = PageLayout.plan(track, paper, options.copy(marginM = 1_500.0))
        assertTrue(large.pages.size >= small.pages.size)
        assertCoveredWithMargin(small)
        assertCoveredWithMargin(large)
    }

    @Test
    fun `pages are numbered in the order the walk meets them`() {
        val layout = PageLayout.plan(listOf(Tracks.line(0.0, 20_000.0)), paper, options)
        assertEquals(layout.pages.indices.map { it + 1 }, layout.pages.map { it.number })
        val firstHit = layout.pages.map { page ->
            layout.samples.indexOfFirst { s ->
                val (u, v) = layout.toPage(s)
                page.rect.contains(u, v)
            }
        }
        assertEquals(firstHit.sorted(), firstHit)
    }

    @Test
    fun `neighbours point at the page that continues the walk`() {
        val layout = PageLayout.plan(
            listOf(Tracks.line(0.0, 20_000.0)), paper, options.copy(allowRotation = false),
        )
        val first = layout.pages.first()
        assertEquals(listOf(2), first.neighbours.up)
        assertTrue(first.neighbours.down.isEmpty())
        assertTrue(first.neighbours.left.isEmpty() && first.neighbours.right.isEmpty())
        assertEquals(listOf(layout.pages.size - 1), layout.pages.last().neighbours.down)
    }

    @Test
    fun `each neighbour is announced on exactly one edge`() {
        val diagonal = Tracks.line(14_000.0, 14_000.0)
        for (rotation in listOf(true, false)) {
            val layout = PageLayout.plan(
                listOf(diagonal), paper, options.copy(allowRotation = rotation),
            )
            for (page in layout.pages) {
                val listed = page.neighbours.up + page.neighbours.down +
                    page.neighbours.left + page.neighbours.right
                assertEquals(listed.distinct(), listed, "page ${page.number} repeats a neighbour")
                assertTrue(listed.none { it == page.number }, "page ${page.number} lists itself")
                assertTrue(listed.all { it in 1..layout.pages.size })
            }
        }
    }

    @Test
    fun `the north arrow direction matches the chosen rotation`() {
        val layout = PageLayout.plan(listOf(Tracks.line(20_000.0, 0.0)), paper, options)
        val (nu, nv) = layout.northOnPage()
        // Grid north on the page must be the page-frame image of the L93 +y axis.
        val origin = layout.toPage(Lambert93.forward(45.0, 5.0))
        val north = layout.toPage(
            io.gpxtoign.core.geo.L93(
                Lambert93.forward(45.0, 5.0).x,
                Lambert93.forward(45.0, 5.0).y + 1000.0,
            ),
        )
        assertEquals(nu, (north.first - origin.first) / 1000.0, 1e-9)
        assertEquals(nv, (north.second - origin.second) / 1000.0, 1e-9)
    }

    private fun assertCoveredWithMargin(layout: Layout) {
        val margin = layout.marginM
        for (s in layout.samples) {
            val (u, v) = layout.toPage(s)
            val clearance = layout.pages.maxOf { page ->
                val r = page.rect
                if (!r.contains(u, v)) {
                    -1.0
                } else {
                    min(min(u - r.uMin, r.uMax - u), min(v - r.vMin, r.vMax - v))
                }
            }
            assertTrue(
                clearance >= margin - 1e-6,
                "a sample is only ${"%.1f".format(clearance)} m from the page edge, want $margin",
            )
        }
    }
}
