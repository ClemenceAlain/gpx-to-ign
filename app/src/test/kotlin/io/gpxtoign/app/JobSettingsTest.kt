package io.gpxtoign.app

import io.gpxtoign.core.tiles.MapSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JobSettingsTest {

    @Test
    fun `defaults print SCAN25 with the shared transitional key`() {
        val source = JobSettings().source
        assertEquals(MapSource.SCAN25.layer, source.layer)
        assertEquals("ign_scan_ws", source.apiKey)
        assertEquals("LAMB93_2.5m", source.tileMatrixSet)
    }

    @Test
    fun `a personal key replaces the shared one`() {
        val source = JobSettings(apiKey = "my-own-key").source
        assertEquals("my-own-key", source.apiKey)
        assertTrue(source.urlFor(io.gpxtoign.core.geo.TileId(16, 1, 2)).contains("apikey=my-own-key"))
    }

    @Test
    fun `a blank key means no key at all, which is what Plan IGN wants`() {
        val source = JobSettings(sourceId = MapSource.PLAN_IGN.id, apiKey = "").source
        assertNull(source.apiKey)
        assertTrue(!source.urlFor(io.gpxtoign.core.geo.TileId(16, 1, 2)).contains("apikey"))
    }

    @Test
    fun `an unknown source id falls back to SCAN25 rather than failing`() {
        assertEquals(MapSource.SCAN25.layer, JobSettings(sourceId = "nope").source.layer)
    }

    @Test
    fun `quality presets round-trip through the raw jpeg number`() {
        for (quality in PrintQuality.entries) {
            assertEquals(quality, JobSettings(jpegQuality = quality.jpeg).quality)
        }
        // A key typed in from an older build still lands on the nearest preset.
        assertEquals(PrintQuality.FINE, JobSettings(jpegQuality = 88).quality)
        assertEquals(PrintQuality.COMPACT, JobSettings(jpegQuality = 55).quality)
    }

    @Test
    fun `the overview is compressed harder than the map pages`() {
        val options = JobSettings(jpegQuality = 72).toJobOptions()
        assertTrue(options.overviewQuality < options.jpegQuality)
        assertTrue(options.overviewQuality >= 45)
        assertTrue(JobSettings(jpegQuality = 45).toJobOptions().overviewQuality >= 45)
    }

    @Test
    fun `settings map onto job options`() {
        val options = JobSettings(
            marginM = 750.0, allowRotation = false, includeIndexPage = false,
            jpegQuality = 70, title = "Vercors",
        ).toJobOptions()
        assertEquals(750.0, options.layout.marginM, 1e-9)
        assertFalse(options.layout.allowRotation)
        assertFalse(options.includeIndexPage)
        assertEquals(70, options.jpegQuality)
        assertEquals("Vercors", options.title)
    }
}
