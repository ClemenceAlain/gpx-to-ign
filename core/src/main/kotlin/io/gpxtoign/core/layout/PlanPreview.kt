package io.gpxtoign.core.layout

import io.gpxtoign.core.geo.L93
import kotlin.math.abs
import kotlin.math.max

/** A point in the page frame: metres on the ground, page-up positive. */
data class PagePoint(val u: Double, val v: Double)

/**
 * The page plan as something a screen can draw: the page footprints and the trace, both in
 * the page frame, inside a rectangle with a little air around the pages.
 *
 * This is what the user validates, in place of an overview page in the PDF. Building it
 * never touches the network — the plan is already solved offline — so it can follow the
 * margin slider live, which a rendered map page never could. That also means there is no
 * map under it: it shows where the pages fall, not what is on them.
 */
class PlanPreview(
    /** Everything worth drawing, in the page frame. */
    val bounds: Rect,
    val pages: List<MapPage>,
    /** One polyline per track leg, thinned to what [of]'s pixel budget can show. */
    val tracks: List<List<PagePoint>>,
    val angleDeg: Double,
    /** Grid north expressed in the page frame, as a unit vector. */
    val north: PagePoint,
) {
    companion object {
        /** Air left around the block of pages, as a fraction of its longer side. */
        private const val AIR = 0.04

        /**
         * @param widthPx roughly how many pixels wide the preview will be drawn. It only
         *   decides how hard the trace is thinned: two samples landing inside the same
         *   pixel cannot both show, so only the first is kept.
         */
        fun of(layout: Layout, widthPx: Int = 720): PlanPreview {
            val block = layout.pagesBounds()
            val bounds = block.expand(max(block.width, block.height) * AIR)
            val tolerance = bounds.width / widthPx.coerceAtLeast(1)
            val north = layout.northOnPage()
            return PlanPreview(
                bounds = bounds,
                pages = layout.pages,
                tracks = layout.trackSegments().map { thin(it, layout, tolerance) },
                angleDeg = layout.angleDeg,
                north = PagePoint(north.first, north.second),
            )
        }

        private fun thin(leg: List<L93>, layout: Layout, tolerance: Double): List<PagePoint> {
            val out = ArrayList<PagePoint>()
            for (i in leg.indices) {
                val (u, v) = layout.toPage(leg[i])
                val last = out.lastOrNull()
                val moved = last == null ||
                    abs(u - last.u) > tolerance || abs(v - last.v) > tolerance
                // The last point always goes in, so a leg never stops short of where it ends.
                if (moved) out.add(PagePoint(u, v)) else if (i == leg.lastIndex && out.size > 1) {
                    out[out.size - 1] = PagePoint(u, v)
                }
            }
            return out
        }
    }
}
