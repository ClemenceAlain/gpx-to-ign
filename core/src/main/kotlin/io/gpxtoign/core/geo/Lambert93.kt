package io.gpxtoign.core.geo

import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/** A WGS84 position as read from a GPX file. */
data class LatLon(val lat: Double, val lon: Double)

/** A position in Lambert-93 (EPSG:2154) metres: [x] eastings, [y] northings. */
data class L93(val x: Double, val y: Double)

/**
 * Lambert conformal conic 2SP (EPSG method 9802) for RGF93 / Lambert-93, EPSG:2154.
 *
 * RGF93 and WGS84 agree to within about a metre, which is well under the 2.5 m pixel of
 * the SCAN25 raster, so GPX WGS84 coordinates are fed in directly without a datum shift.
 */
object Lambert93 {
    private const val A = 6378137.0
    private const val INV_F = 298.257222101
    private val E = sqrt(2.0 / INV_F - 1.0 / (INV_F * INV_F))

    private const val LAT0 = 46.5
    private const val LON0 = 3.0
    private const val LAT1 = 44.0
    private const val LAT2 = 49.0
    private const val X0 = 700_000.0
    private const val Y0 = 6_600_000.0

    private val n: Double
    private val bigF: Double
    private val r0: Double

    init {
        val p1 = Math.toRadians(LAT1)
        val p2 = Math.toRadians(LAT2)
        val m1 = m(p1)
        val m2 = m(p2)
        val t1 = t(p1)
        val t2 = t(p2)
        n = (ln(m1) - ln(m2)) / (ln(t1) - ln(t2))
        bigF = m1 / (n * t1.pow(n))
        r0 = A * bigF * t(Math.toRadians(LAT0)).pow(n)
    }

    private fun m(phi: Double): Double {
        val s = sin(phi)
        return cos(phi) / sqrt(1.0 - E * E * s * s)
    }

    private fun t(phi: Double): Double {
        val s = sin(phi)
        return tan(Math.PI / 4.0 - phi / 2.0) / ((1.0 - E * s) / (1.0 + E * s)).pow(E / 2.0)
    }

    fun forward(p: LatLon): L93 = forward(p.lat, p.lon)

    fun forward(lat: Double, lon: Double): L93 {
        val phi = Math.toRadians(lat)
        val r = A * bigF * t(phi).pow(n)
        val theta = n * Math.toRadians(normaliseLon(lon - LON0))
        return L93(X0 + r * sin(theta), Y0 + r0 - r * cos(theta))
    }

    fun inverse(p: L93): LatLon = inverse(p.x, p.y)

    fun inverse(x: Double, y: Double): LatLon {
        val dx = x - X0
        val dy = r0 - (y - Y0)
        val r = hypot(dx, dy) * sign(n)
        val theta = atan2(dx, dy)
        val tv = (r / (A * bigF)).pow(1.0 / n)

        // Snyder 7-9: iterate on the conformal latitude until it settles.
        var phi = Math.PI / 2.0 - 2.0 * atan(tv)
        repeat(12) {
            val s = sin(phi)
            val next = Math.PI / 2.0 -
                2.0 * atan(tv * ((1.0 - E * s) / (1.0 + E * s)).pow(E / 2.0))
            if (abs(next - phi) < 1e-13) return@repeat
            phi = next
        }
        return LatLon(Math.toDegrees(phi), normaliseLon(LON0 + Math.toDegrees(theta / n)))
    }

    /** Extent of the SCAN25 Lambert-93 layer, in L93 metres. Traces outside it have no map. */
    val coverage = Bounds(minX = 0.0, minY = 6_000_000.0, maxX = 1_300_000.0, maxY = 7_150_000.0)

    private fun normaliseLon(lon: Double): Double {
        var l = lon
        while (l > 180.0) l -= 360.0
        while (l < -180.0) l += 360.0
        return l
    }
}

/** An axis-aligned box in L93 metres. */
data class Bounds(val minX: Double, val minY: Double, val maxX: Double, val maxY: Double) {
    val width get() = maxX - minX
    val height get() = maxY - minY
    val centerX get() = (minX + maxX) / 2.0
    val centerY get() = (minY + maxY) / 2.0

    operator fun contains(p: L93) = p.x in minX..maxX && p.y in minY..maxY

    fun expand(by: Double) = Bounds(minX - by, minY - by, maxX + by, maxY + by)

    companion object {
        fun of(points: Iterable<L93>): Bounds {
            var nx = Double.MAX_VALUE
            var ny = Double.MAX_VALUE
            var xx = -Double.MAX_VALUE
            var xy = -Double.MAX_VALUE
            for (p in points) {
                if (p.x < nx) nx = p.x
                if (p.y < ny) ny = p.y
                if (p.x > xx) xx = p.x
                if (p.y > xy) xy = p.y
            }
            require(nx <= xx) { "cannot bound an empty point set" }
            return Bounds(nx, ny, xx, xy)
        }
    }
}
