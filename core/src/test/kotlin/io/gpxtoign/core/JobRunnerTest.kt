package io.gpxtoign.core

import io.gpxtoign.core.geo.TileId
import io.gpxtoign.core.layout.Tracks
import io.gpxtoign.core.render.ArgbImage
import io.gpxtoign.core.render.ImageCodec
import io.gpxtoign.core.tiles.TileFetcher
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class JobRunnerTest {

    private object Unused : TileFetcher {
        override suspend fun fetch(tile: TileId): ByteArray = error("estimating never downloads")
    }

    private object UnusedCodec : ImageCodec {
        override fun decode(bytes: ByteArray) = error("unused")
        override fun encodeJpeg(image: ArgbImage, quality: Int) = error("unused")
    }

    private val runner = JobRunner(Unused, UnusedCodec)
    private val track = listOf(Tracks.line(4_000.0, 18_000.0))

    @Test
    fun `the estimate counts the overview page it is going to draw`() {
        val withIndex = JobOptions(includeIndexPage = true)
        val without = JobOptions(includeIndexPage = false)
        val plan = runner.plan(track, withIndex)

        val counted = runner.estimate(plan, withIndex)
        val bare = runner.estimate(plan, without)
        assertTrue(
            counted.tiles > bare.tiles,
            "overview tiles missing: ${counted.tiles} vs ${bare.tiles}",
        )
        assertEquals(plan.pages.size, counted.pages)
        assertEquals(plan.angleDeg, counted.angleDeg, 1e-9)
    }

    @Test
    fun `a wider page load means more tiles and more bytes`() {
        val short = runner.let { it.estimate(it.plan(listOf(Tracks.line(0.0, 5_000.0)), JobOptions()), JobOptions()) }
        val long = runner.let { it.estimate(it.plan(listOf(Tracks.line(0.0, 40_000.0)), JobOptions()), JobOptions()) }
        assertTrue(long.pages > short.pages)
        assertTrue(long.tiles > short.tiles)
        assertTrue(long.approximateBytes > short.approximateBytes)
    }
}
