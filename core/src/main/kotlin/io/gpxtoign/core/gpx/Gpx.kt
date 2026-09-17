package io.gpxtoign.core.gpx

import io.gpxtoign.core.geo.LatLon

/** One continuous run of points: a `<trkseg>`, a `<rte>`, or a lone `<wpt>`. */
data class GpxSegment(val name: String?, val points: List<LatLon>)

/** Everything we keep from one GPX file. Only the geometry matters for page layout. */
data class GpxFile(val name: String, val segments: List<GpxSegment>) {
    val pointCount: Int get() = segments.sumOf { it.points.size }
}

class GpxParseException(message: String, cause: Throwable? = null) : Exception(message, cause)
