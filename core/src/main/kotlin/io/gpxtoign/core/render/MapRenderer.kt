package io.gpxtoign.core.render

import io.gpxtoign.core.geo.TileGrid
import io.gpxtoign.core.geo.TileId
import io.gpxtoign.core.layout.Rect
import io.gpxtoign.core.tiles.TileFetcher
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** One finished piece of a page: a JPEG plus where it belongs, in output pixels. */
data class RenderedBlock(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
    val jpeg: ByteArray,
) {
    override fun equals(other: Any?) = this === other
    override fun hashCode() = System.identityHashCode(this)
}

/**
 * Turns a rectangle of the page frame into JPEG blocks by resampling WMTS tiles.
 *
 * The page is built in square blocks rather than one big bitmap: a full 1:25000 A4 map is
 * 2000 x 2770 pixels, and rotating that in one piece would need tens of megabytes on a
 * phone. Blocks keep the working set to a couple of megabytes and let the PDF place each
 * piece at its exact position, so the seams are invisible.
 */
class MapRenderer(
    private val fetcher: TileFetcher,
    private val codec: ImageCodec,
    private val matrix: Int,
    private val blockPx: Int = 512,
    private val quality: Int = 85,
) {
    private val resolution = TileGrid.resolution(matrix)
    private val cache = LinkedHashMap<TileId, ArgbImage>(64, 0.75f, true)

    /** Tiles that never arrived, reported so the job can warn instead of silently whiting out. */
    val missingTiles = LinkedHashSet<TileId>()

    /**
     * @param rect the ground rectangle to draw, in the page frame.
     * @param angleRad rotation of the page frame relative to Lambert-93.
     * @param widthPx output width; the height follows from the rectangle's aspect ratio.
     */
    suspend fun render(
        rect: Rect,
        angleRad: Double,
        widthPx: Int,
        heightPx: Int,
        onProgress: (done: Int, total: Int) -> Unit = { _, _ -> },
    ): List<RenderedBlock> {
        val cols = ceil(widthPx.toDouble() / blockPx).toInt()
        val rows = ceil(heightPx.toDouble() / blockPx).toInt()
        val blocks = ArrayList<RenderedBlock>(cols * rows)
        var done = 0
        for (by in 0 until rows) {
            for (bx in 0 until cols) {
                val x = bx * blockPx
                val y = by * blockPx
                val w = min(blockPx, widthPx - x)
                val h = min(blockPx, heightPx - y)
                blocks.add(renderBlock(rect, angleRad, widthPx, heightPx, x, y, w, h))
                onProgress(++done, cols * rows)
            }
        }
        return blocks
    }

    private suspend fun renderBlock(
        rect: Rect, angleRad: Double, widthPx: Int, heightPx: Int,
        x0: Int, y0: Int, w: Int, h: Int,
    ): RenderedBlock {
        val ca = cos(angleRad)
        val sa = sin(angleRad)
        val stepU = rect.width / widthPx
        val stepV = rect.height / heightPx

        // Source pixel coordinates, in the global grid of the chosen tile matrix.
        fun sourceOf(px: Double, py: Double): Pair<Double, Double> {
            val u = rect.uMin + px * stepU
            val v = rect.vMax - py * stepV
            val x = u * ca + v * sa
            val y = -u * sa + v * ca
            return Pair((x - TileGrid.ORIGIN_X) / resolution, (TileGrid.ORIGIN_Y - y) / resolution)
        }

        var gxMin = Double.MAX_VALUE
        var gxMax = -Double.MAX_VALUE
        var gyMin = Double.MAX_VALUE
        var gyMax = -Double.MAX_VALUE
        for (cx in listOf(x0.toDouble(), (x0 + w).toDouble())) {
            for (cy in listOf(y0.toDouble(), (y0 + h).toDouble())) {
                val (gx, gy) = sourceOf(cx, cy)
                gxMin = min(gxMin, gx); gxMax = max(gxMax, gx)
                gyMin = min(gyMin, gy); gyMax = max(gyMax, gy)
            }
        }
        val mosaic = mosaicFor(gxMin - 2, gyMin - 2, gxMax + 2, gyMax + 2)

        val out = ArgbImage(w, h)
        for (py in 0 until h) {
            for (px in 0 until w) {
                val (gx, gy) = sourceOf(x0 + px + 0.5, y0 + py + 0.5)
                out[px, py] = mosaic.sample(gx, gy)
            }
        }
        return RenderedBlock(x0, y0, w, h, codec.encodeJpeg(out, quality))
    }

    private suspend fun mosaicFor(
        gxMin: Double, gyMin: Double, gxMax: Double, gyMax: Double,
    ): Mosaic = coroutineScope {
        val c0 = floor(gxMin / TileGrid.TILE_PX).toInt()
        val c1 = floor(gxMax / TileGrid.TILE_PX).toInt()
        val r0 = floor(gyMin / TileGrid.TILE_PX).toInt()
        val r1 = floor(gyMax / TileGrid.TILE_PX).toInt()

        val ids = ArrayList<TileId>()
        for (r in r0..r1) for (c in c0..c1) ids.add(TileId(matrix, c, r))

        val pending = ids.filter { it !in cache }
        pending.map { id ->
            async {
                val image = try {
                    codec.decode(fetcher.fetch(id))
                } catch (e: Exception) {
                    synchronized(missingTiles) { missingTiles.add(id) }
                    ArgbImage(TileGrid.TILE_PX, TileGrid.TILE_PX)
                }
                id to image
            }
        }.awaitAll().forEach { (id, image) -> put(id, image) }

        val width = (c1 - c0 + 1) * TileGrid.TILE_PX
        val height = (r1 - r0 + 1) * TileGrid.TILE_PX
        val buffer = ArgbImage(width, height)
        for (r in r0..r1) {
            for (c in c0..c1) {
                val tile = cache[TileId(matrix, c, r)] ?: continue
                blit(tile, buffer, (c - c0) * TileGrid.TILE_PX, (r - r0) * TileGrid.TILE_PX)
            }
        }
        Mosaic(buffer, c0 * TileGrid.TILE_PX.toDouble(), r0 * TileGrid.TILE_PX.toDouble())
    }

    private fun put(id: TileId, image: ArgbImage) {
        cache[id] = image
        while (cache.size > CACHE_TILES) {
            val oldest = cache.keys.iterator()
            oldest.next()
            oldest.remove()
        }
    }

    private fun blit(src: ArgbImage, dst: ArgbImage, atX: Int, atY: Int) {
        val w = min(src.width, dst.width - atX)
        val h = min(src.height, dst.height - atY)
        for (y in 0 until h) {
            System.arraycopy(
                src.pixels, y * src.width,
                dst.pixels, (atY + y) * dst.width + atX,
                w,
            )
        }
    }

    /** A contiguous patch of the source grid, sampled bilinearly so rotated text stays legible. */
    private class Mosaic(val image: ArgbImage, val offsetX: Double, val offsetY: Double) {
        fun sample(gx: Double, gy: Double): Int {
            val fx = gx - offsetX - 0.5
            val fy = gy - offsetY - 0.5
            val x0 = floor(fx).toInt()
            val y0 = floor(fy).toInt()
            val tx = fx - x0
            val ty = fy - y0
            val c00 = pixel(x0, y0)
            val c10 = pixel(x0 + 1, y0)
            val c01 = pixel(x0, y0 + 1)
            val c11 = pixel(x0 + 1, y0 + 1)
            var out = 0xFF shl 24
            for (shift in intArrayOf(16, 8, 0)) {
                val a = (c00 ushr shift) and 0xFF
                val b = (c10 ushr shift) and 0xFF
                val c = (c01 ushr shift) and 0xFF
                val d = (c11 ushr shift) and 0xFF
                val top = a + (b - a) * tx
                val bottom = c + (d - c) * tx
                val value = (top + (bottom - top) * ty).toInt().coerceIn(0, 255)
                out = out or (value shl shift)
            }
            return out
        }

        private fun pixel(x: Int, y: Int): Int =
            if (x < 0 || y < 0 || x >= image.width || y >= image.height) ArgbImage.WHITE
            else image[x, y]
    }

    private companion object {
        const val CACHE_TILES = 64
    }
}
