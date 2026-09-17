package io.gpxtoign.core.gpx

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GpxParserTest {

    private fun parse(xml: String) = GpxParser.parse("test.gpx", xml.byteInputStream())

    @Test
    fun `reads track segments and keeps their name`() {
        val gpx = parse(
            """
            <gpx version="1.1" creator="test">
              <trk>
                <name>Tour du Mont Blanc</name>
                <trkseg>
                  <trkpt lat="45.90" lon="6.87"><ele>1035</ele></trkpt>
                  <trkpt lat="45.91" lon="6.88"/>
                </trkseg>
                <trkseg>
                  <trkpt lat="45.92" lon="6.89"/>
                </trkseg>
              </trk>
            </gpx>
            """.trimIndent(),
        )
        assertEquals(2, gpx.segments.size)
        assertEquals("Tour du Mont Blanc", gpx.segments[0].name)
        assertEquals(3, gpx.pointCount)
        assertEquals(45.90, gpx.segments[0].points[0].lat, 1e-9)
        assertEquals(6.87, gpx.segments[0].points[0].lon, 1e-9)
    }

    @Test
    fun `reads routes and standalone waypoints`() {
        val gpx = parse(
            """
            <gpx version="1.1">
              <wpt lat="44.0" lon="5.0"><name>Refuge</name></wpt>
              <rte><name>Retour</name><rtept lat="44.1" lon="5.1"/><rtept lat="44.2" lon="5.2"/></rte>
            </gpx>
            """.trimIndent(),
        )
        assertEquals(3, gpx.pointCount)
        assertTrue(gpx.segments.any { it.points.size == 2 })
        assertTrue(gpx.segments.any { it.points.size == 1 })
    }

    @Test
    fun `tolerates namespace prefixes`() {
        val gpx = parse(
            """
            <gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
              <gpx:trk><gpx:trkseg>
                <gpx:trkpt lat="43.5" lon="6.0"/>
                <gpx:trkpt lat="43.6" lon="6.1"/>
              </gpx:trkseg></gpx:trk>
            </gpx:gpx>
            """.trimIndent(),
        )
        assertEquals(2, gpx.pointCount)
    }

    @Test
    fun `rejects a file that is not GPX`() {
        val e = assertThrows(GpxParseException::class.java) {
            parse("<html><body>nope</body></html>")
        }
        assertTrue(e.message!!.contains("gpx"), e.message)
    }

    @Test
    fun `rejects a GPX with no coordinates`() {
        assertThrows(GpxParseException::class.java) {
            parse("""<gpx version="1.1"><metadata><name>empty</name></metadata></gpx>""")
        }
    }

    @Test
    fun `skips points with malformed coordinates`() {
        val gpx = parse(
            """
            <gpx version="1.1"><trk><trkseg>
              <trkpt lat="not-a-number" lon="6.0"/>
              <trkpt lat="200.0" lon="6.0"/>
              <trkpt lat="43.5" lon="6.0"/>
            </trkseg></trk></gpx>
            """.trimIndent(),
        )
        assertEquals(1, gpx.pointCount)
    }
}
