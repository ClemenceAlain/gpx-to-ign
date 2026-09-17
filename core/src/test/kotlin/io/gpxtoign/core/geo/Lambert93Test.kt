package io.gpxtoign.core.geo

import kotlin.math.abs
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class Lambert93Test {

    /** Reference eastings/northings produced by pyproj (EPSG:4326 -> EPSG:2154). */
    private val references = listOf(
        Triple(LatLon(46.5, 3.0), 700_000.000, 6_600_000.000),
        Triple(LatLon(48.8530, 2.3499), 652_296.973, 6_861_636.359),
        Triple(LatLon(45.8452, 6.9051), 1_002_953.837, 6_534_776.102),
        Triple(LatLon(48.3904, -4.4861), 146_632.979, 6_836_262.327),
        Triple(LatLon(43.7102, 7.2620), 1_043_410.160, 6_299_400.043),
    )

    @Test
    fun `forward projection matches reference coordinates within half a metre`() {
        for ((point, x, y) in references) {
            val got = Lambert93.forward(point)
            assertTrue(abs(got.x - x) < 0.5, "x for $point: got ${got.x}, want $x")
            assertTrue(abs(got.y - y) < 0.5, "y for $point: got ${got.y}, want $y")
        }
    }

    @Test
    fun `inverse round-trips to within a centimetre on the ground`() {
        for ((point, _, _) in references) {
            val back = Lambert93.inverse(Lambert93.forward(point))
            assertTrue(abs(back.lat - point.lat) < 1e-7, "lat for $point: got ${back.lat}")
            assertTrue(abs(back.lon - point.lon) < 1e-7, "lon for $point: got ${back.lon}")
        }
    }

    @Test
    fun `projection origin lands on the false easting and northing`() {
        val p = Lambert93.forward(46.5, 3.0)
        assertEquals(700_000.0, p.x, 1e-6)
        assertEquals(6_600_000.0, p.y, 1e-6)
    }

    @Test
    fun `bounds cover the sampled points`() {
        val b = Bounds.of(references.map { Lambert93.forward(it.first) })
        assertTrue(b.minX < 200_000 && b.maxX > 1_000_000)
        assertTrue(Lambert93.forward(46.5, 3.0) in b.expand(1_000_000.0))
    }
}
