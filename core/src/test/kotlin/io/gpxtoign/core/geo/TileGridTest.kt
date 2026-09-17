package io.gpxtoign.core.geo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TileGridTest {

    @Test
    fun `level 16 is the native 2_5 metre SCAN25 resolution`() {
        // ScaleDenominator 8928.5714285714 x 0.28 mm, straight from the GetCapabilities.
        assertEquals(2.5, TileGrid.resolution(16), 1e-9)
        assertEquals(640.0, TileGrid.tileSpan(16), 1e-9)
        assertEquals(5.0, TileGrid.resolution(15), 1e-9)
    }

    @Test
    fun `Col d'Entreves falls in the tile that was fetched by hand`() {
        val p = Lambert93.forward(45.8452, 6.9051)
        assertEquals(1567, TileGrid.colOf(p.x, 16))
        assertEquals(8539, TileGrid.rowOf(p.y, 16))
    }

    @Test
    fun `tile origin is the top-left corner of its own footprint`() {
        val tile = TileId(16, 1567, 8539)
        val o = TileGrid.originOf(tile)
        assertEquals(1567 * 640.0, o.x, 1e-9)
        assertEquals(12_000_000.0 - 8539 * 640.0, o.y, 1e-9)
        assertEquals(1567, TileGrid.colOf(o.x + 1.0, 16))
        assertEquals(8539, TileGrid.rowOf(o.y - 1.0, 16))
    }

    @Test
    fun `tilesCovering returns every tile touching the box and nothing more`() {
        val b = Bounds(1_003_000.0, 6_534_000.0, 1_004_000.0, 6_535_000.0)
        val tiles = TileGrid.tilesCovering(b, 16)
        assertEquals(2 * 2, tiles.size)
        assertTrue(tiles.contains(TileId(16, 1567, 8539)))
        for (t in tiles) {
            val o = TileGrid.originOf(t)
            assertTrue(o.x < b.maxX && o.x + 640 > b.minX)
            assertTrue(o.y > b.minY && o.y - 640 < b.maxY)
        }
    }
}
