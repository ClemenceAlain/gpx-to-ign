package io.gpxtoign.core.render

import io.gpxtoign.core.geo.L93
import io.gpxtoign.core.geo.TileGrid
import io.gpxtoign.core.geo.TileId
import io.gpxtoign.core.layout.Rect
import io.gpxtoign.core.tiles.TileFetcher
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MapRendererTest {

    /** Codec that round-trips the raster verbatim, so tests measure geometry, not JPEG loss. */
    private object RawCodec : ImageCodec {
        override fun decode(bytes: ByteArray): ArgbImage {
            val width = readInt(bytes, 0)
            val height = readInt(bytes, 4)
            val pixels = IntArray(width * height) { readInt(bytes, 8 + it * 4) }
            return ArgbImage(width, height, pixels)
        }

        override fun encodeJpeg(image: ArgbImage, quality: Int): ByteArray {
            val out = ByteArray(8 + image.pixels.size * 4)
            writeInt(out, 0, image.width)
            writeInt(out, 4, image.height)
            image.pixels.forEachIndexed { index, value -> writeInt(out, 8 + index * 4, value) }
            return out
        }

        private fun readInt(b: ByteArray, at: Int) =
            (b[at].toInt() and 0xFF shl 24) or (b[at + 1].toInt() and 0xFF shl 16) or
                (b[at + 2].toInt() and 0xFF shl 8) or (b[at + 3].toInt() and 0xFF)

        private fun writeInt(b: ByteArray, at: Int, value: Int) {
            b[at] = (value ushr 24).toByte(); b[at + 1] = (value ushr 16).toByte()
            b[at + 2] = (value ushr 8).toByte(); b[at + 3] = value.toByte()
        }
    }

    /** Paints each tile a colour derived from its address, so a pixel names its source tile. */
    private class SyntheticTiles : TileFetcher {
        val requested = mutableSetOf<TileId>()
        override suspend fun fetch(tile: TileId): ByteArray {
            synchronized(requested) { requested.add(tile) }
            return RawCodec.encodeJpeg(
                ArgbImage(TileGrid.TILE_PX, TileGrid.TILE_PX, colourOf(tile)), 100,
            )
        }
    }

    @Test
    fun `an unrotated page samples the tiles under it`() = runBlocking {
        val tiles = SyntheticTiles()
        val renderer = MapRenderer(tiles, RawCodec, TileGrid.NATIVE_MATRIX, blockPx = 256)
        // Exactly one tile's worth of ground, aligned to the grid.
        val x0 = 1000 * 640.0
        val y0 = TileGrid.ORIGIN_Y - 8000 * 640.0
        val blocks = renderer.render(Rect(x0, y0 - 640.0, x0 + 640.0, y0), 0.0, 256, 256)

        assertEquals(1, blocks.size)
        val image = RawCodec.decode(blocks.single().jpeg)
        val expected = colourOf(TileId(TileGrid.NATIVE_MATRIX, 1000, 8000))
        assertEquals(expected, image[128, 128])
        assertEquals(expected, image[5, 5])
        assertTrue(renderer.missingTiles.isEmpty())
    }

    @Test
    fun `a rotated page still lands on the right ground`() = runBlocking {
        val renderer = MapRenderer(SyntheticTiles(), RawCodec, TileGrid.NATIVE_MATRIX, blockPx = 128)
        val angle = Math.toRadians(30.0)
        val rect = Rect(500_000.0, 6_500_000.0, 500_640.0, 6_500_640.0)
        val blocks = renderer.render(rect, angle, 256, 256)

        val centre = toL93(rect.centerU, rect.centerV, angle)
        val expected = colourOf(
            TileId(
                TileGrid.NATIVE_MATRIX,
                TileGrid.colOf(centre.x, TileGrid.NATIVE_MATRIX),
                TileGrid.rowOf(centre.y, TileGrid.NATIVE_MATRIX),
            ),
        )
        val block = blocks.first {
            it.x <= 128 && 128 < it.x + it.width && it.y <= 128 && 128 < it.y + it.height
        }
        val image = RawCodec.decode(block.jpeg)
        assertEquals(expected, image[128 - block.x, 128 - block.y])
    }

    @Test
    fun `tiles are fetched once even when several blocks share them`() = runBlocking {
        val tiles = SyntheticTiles()
        val renderer = MapRenderer(tiles, RawCodec, TileGrid.NATIVE_MATRIX, blockPx = 64)
        renderer.render(Rect(500_000.0, 6_500_000.0, 500_320.0, 6_500_320.0), 0.0, 128, 128)
        // 320 m spans at most two tiles each way, however many 64-pixel blocks touch them.
        assertTrue(tiles.requested.size <= 4, "fetched ${tiles.requested.size} tiles")
    }

    @Test
    fun `a tile that never arrives is reported and printed white`() = runBlocking {
        val failing = object : TileFetcher {
            override suspend fun fetch(tile: TileId): ByteArray = error("offline")
        }
        val renderer = MapRenderer(failing, RawCodec, TileGrid.NATIVE_MATRIX, blockPx = 64)
        val blocks = renderer.render(
            Rect(500_000.0, 6_500_000.0, 500_160.0, 6_500_160.0), 0.0, 64, 64,
        )
        assertEquals(ArgbImage.WHITE, RawCodec.decode(blocks.single().jpeg)[32, 32])
        assertTrue(renderer.missingTiles.isNotEmpty())
    }

    private companion object {
        fun colourOf(tile: TileId) =
            0xFF000000.toInt() or ((tile.col and 0xFF) shl 16) or ((tile.row and 0xFF) shl 8)

        fun toL93(u: Double, v: Double, angle: Double): L93 {
            val c = cos(angle)
            val s = sin(angle)
            return L93(u * c + v * s, -u * s + v * c)
        }
    }
}
