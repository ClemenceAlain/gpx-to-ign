package io.gpxtoign.core.gpx

import io.gpxtoign.core.geo.LatLon
import java.io.InputStream
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.SAXException
import org.xml.sax.helpers.DefaultHandler

/**
 * Streaming GPX reader built on SAX, which both the JVM and Android ship.
 *
 * Only `lat`/`lon` are kept: elevation, time and extensions play no part in page layout.
 * `<trkseg>`, `<rte>` and standalone `<wpt>` each become a [GpxSegment] so that pages can
 * later be ordered along the walk.
 */
object GpxParser {

    fun parse(name: String, input: InputStream): GpxFile {
        val handler = Handler()
        try {
            val factory = SAXParserFactory.newInstance().apply {
                isNamespaceAware = false
                runCatching {
                    setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                }
            }
            factory.newSAXParser().parse(input, handler)
        } catch (e: SAXException) {
            throw GpxParseException("${name}: not valid XML (${e.message})", e)
        }
        if (!handler.sawGpxRoot) {
            throw GpxParseException("$name: no <gpx> root element — is this really a GPX file?")
        }
        val segments = handler.segments.filter { it.points.isNotEmpty() }
        if (segments.isEmpty()) {
            throw GpxParseException("$name: contains no track, route or waypoint coordinates")
        }
        return GpxFile(name, segments)
    }

    private class Handler : DefaultHandler() {
        val segments = mutableListOf<GpxSegment>()
        var sawGpxRoot = false

        private var current: MutableList<LatLon>? = null
        private var currentName: String? = null
        private var pendingName: String? = null
        private val loneWaypoints = mutableListOf<LatLon>()
        private var text = StringBuilder()
        private var capturingName = false
        private var depth = 0
        private var nameDepth = -1

        override fun startElement(uri: String?, local: String?, qName: String, attrs: Attributes) {
            depth++
            when (qName.substringAfter(':').lowercase()) {
                "gpx" -> sawGpxRoot = true
                "trk", "rte" -> {
                    pendingName = null
                    nameDepth = depth
                }
                "trkseg" -> current = mutableListOf()
                "name" -> {
                    if (depth == nameDepth + 1) {
                        capturingName = true
                        text = StringBuilder()
                    }
                }
                "trkpt", "rtept" -> {
                    val p = readPoint(attrs) ?: return
                    if (qName.endsWith("rtept", ignoreCase = true) && current == null) {
                        current = mutableListOf()
                    }
                    current?.add(p) ?: loneWaypoints.add(p)
                }
                "wpt" -> readPoint(attrs)?.let { loneWaypoints.add(it) }
            }
        }

        override fun characters(ch: CharArray, start: Int, length: Int) {
            if (capturingName) text.appendRange(ch, start, start + length)
        }

        override fun endElement(uri: String?, local: String?, qName: String) {
            when (qName.substringAfter(':').lowercase()) {
                "name" -> if (capturingName) {
                    capturingName = false
                    pendingName = text.toString().trim().ifEmpty { null }
                    currentName = pendingName
                }
                "trkseg" -> flush()
                "trk" -> { flush(); nameDepth = -1 }
                "rte" -> { flush(); nameDepth = -1 }
            }
            depth--
        }

        override fun endDocument() {
            flush()
            // Waypoints carry no ordering, so each stands alone rather than forming a leg.
            loneWaypoints.forEach { segments.add(GpxSegment(null, listOf(it))) }
        }

        private fun flush() {
            val pts = current ?: return
            current = null
            if (pts.isNotEmpty()) segments.add(GpxSegment(currentName ?: pendingName, pts))
        }

        private fun readPoint(attrs: Attributes): LatLon? {
            val lat = attrs.getValue("lat")?.toDoubleOrNull() ?: return null
            val lon = attrs.getValue("lon")?.toDoubleOrNull() ?: return null
            if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
            return LatLon(lat, lon)
        }
    }
}
