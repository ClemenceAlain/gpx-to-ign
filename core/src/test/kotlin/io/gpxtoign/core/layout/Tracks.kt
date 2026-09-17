package io.gpxtoign.core.layout

import io.gpxtoign.core.geo.L93
import io.gpxtoign.core.geo.Lambert93
import io.gpxtoign.core.gpx.GpxFile
import io.gpxtoign.core.gpx.GpxSegment

/** Builds a synthetic GPX from Lambert-93 metres so tests can reason in ground distance. */
object Tracks {
    private const val BASE_X = 900_000.0
    private const val BASE_Y = 6_400_000.0

    fun of(vararg offsets: Pair<Double, Double>): GpxFile = of(offsets.toList())

    fun of(offsets: List<Pair<Double, Double>>): GpxFile = GpxFile(
        name = "synthetic.gpx",
        segments = listOf(
            GpxSegment(
                name = null,
                points = offsets.map { (dx, dy) ->
                    Lambert93.inverse(L93(BASE_X + dx, BASE_Y + dy))
                },
            ),
        ),
    )

    fun line(dx: Double, dy: Double, steps: Int = 200): GpxFile =
        of((0..steps).map { i -> dx * i / steps to dy * i / steps })
}
