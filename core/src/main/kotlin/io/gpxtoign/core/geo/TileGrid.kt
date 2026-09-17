package io.gpxtoign.core.geo

import kotlin.math.ceil
import kotlin.math.floor

/** A single WMTS tile address. */
data class TileId(val matrix: Int, val col: Int, val row: Int)

/**
 * The `LAMB93_2.5m` WMTS tile matrix set published by the Géoplateforme.
 *
 * Its top-left corner is (0, 12 000 000) in Lambert-93 metres and level 16 has a scale
 * denominator of 8928.5714, i.e. 8928.5714 x 0.28 mm = exactly 2.5 m per pixel — the
 * native resolution of SCAN25. Each level halves the resolution of the one below it.
 */
object TileGrid {
    const val TILE_PX = 256
    const val ORIGIN_X = 0.0
    const val ORIGIN_Y = 12_000_000.0

    /** Finest level of the matrix set, and the only one we print from. */
    const val NATIVE_MATRIX = 16
    const val NATIVE_RESOLUTION = 2.5

    /** Metres per pixel at [matrix]. */
    fun resolution(matrix: Int): Double = NATIVE_RESOLUTION * (1 shl (NATIVE_MATRIX - matrix))

    /** Ground size of one tile at [matrix], in metres. */
    fun tileSpan(matrix: Int): Double = resolution(matrix) * TILE_PX

    fun colOf(x: Double, matrix: Int): Int = floor((x - ORIGIN_X) / tileSpan(matrix)).toInt()

    fun rowOf(y: Double, matrix: Int): Int = floor((ORIGIN_Y - y) / tileSpan(matrix)).toInt()

    /** L93 position of the top-left pixel of [tile]. */
    fun originOf(tile: TileId): L93 {
        val span = tileSpan(tile.matrix)
        return L93(ORIGIN_X + tile.col * span, ORIGIN_Y - tile.row * span)
    }

    /** Every tile at [matrix] whose footprint intersects [bounds]. */
    fun tilesCovering(bounds: Bounds, matrix: Int): List<TileId> {
        val span = tileSpan(matrix)
        val c0 = floor((bounds.minX - ORIGIN_X) / span).toInt()
        val c1 = ceil((bounds.maxX - ORIGIN_X) / span).toInt() - 1
        val r0 = floor((ORIGIN_Y - bounds.maxY) / span).toInt()
        val r1 = ceil((ORIGIN_Y - bounds.minY) / span).toInt() - 1
        val out = ArrayList<TileId>((c1 - c0 + 1).coerceAtLeast(1) * (r1 - r0 + 1).coerceAtLeast(1))
        for (r in r0..r1) for (c in c0..c1) out.add(TileId(matrix, c, r))
        return out
    }

    /** Coarsest level whose resolution is still finer than [metresPerPixel]. */
    fun matrixFor(metresPerPixel: Double): Int {
        var m = NATIVE_MATRIX
        while (m > 0 && resolution(m - 1) <= metresPerPixel) m--
        return m
    }
}
