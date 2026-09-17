package io.gpxtoign.core.layout

import io.gpxtoign.core.geo.Bounds
import io.gpxtoign.core.geo.L93
import io.gpxtoign.core.geo.Lambert93
import io.gpxtoign.core.gpx.GpxFile
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Physical page description. Defaults describe A4 printed at 1:25000. */
data class PaperSpec(
    val widthMm: Double = 210.0,
    val heightMm: Double = 297.0,
    /** Unprintable safety border most consumer printers need. */
    val safeMarginMm: Double = 5.0,
    /** Strip reserved at the foot of the page for scale bar, north arrow and page numbers. */
    val footerMm: Double = 10.0,
    val scaleDenominator: Int = 25_000,
) {
    val mapWidthMm get() = widthMm - 2 * safeMarginMm
    val mapHeightMm get() = heightMm - 2 * safeMarginMm - footerMm

    /** Ground width of the map area, in metres. 200 mm at 1:25000 is 5000 m. */
    val mapWidthM get() = mapWidthMm * scaleDenominator / 1000.0
    val mapHeightM get() = mapHeightMm * scaleDenominator / 1000.0

    fun metresPerMm() = scaleDenominator / 1000.0
}

data class LayoutOptions(
    /** Minimum clearance between the trace and the printed page edge, in metres. */
    val marginM: Double = 500.0,
    /** Search a rotation angle that minimises the page count instead of printing north-up. */
    val allowRotation: Boolean = true,
    val angleStepDeg: Double = 1.0,
    /** Maximum spacing between consecutive sample points, in metres. */
    val densifyM: Double = 50.0,
)

/** One printable page, expressed in the job's rotated page frame. */
data class MapPage(
    val number: Int,
    val rect: Rect,
    val neighbours: Neighbours,
)

/** Page numbers continuing off each edge, for the "suite page N" footer hints. */
data class Neighbours(
    val up: List<Int> = emptyList(),
    val down: List<Int> = emptyList(),
    val left: List<Int> = emptyList(),
    val right: List<Int> = emptyList(),
)

/**
 * A complete page plan.
 *
 * [angleRad] is the bearing, clockwise from Lambert-93 grid north, that page-up points to.
 * Every page shares it, so the whole booklet prints portrait with one consistent north.
 */
class Layout(
    val angleRad: Double,
    val paper: PaperSpec,
    val marginM: Double,
    val pages: List<MapPage>,
    val trackBounds: Bounds,
    val samples: List<L93>,
) {
    private val cosA = cos(angleRad)
    private val sinA = sin(angleRad)

    /** Lambert-93 position of a point given in the page frame. */
    fun toL93(u: Double, v: Double) = L93(u * cosA + v * sinA, -u * sinA + v * cosA)

    /** Page-frame position of a Lambert-93 point. */
    fun toPage(p: L93): Pair<Double, Double> =
        Pair(p.x * cosA - p.y * sinA, p.x * sinA + p.y * cosA)

    /** Grid-north direction expressed in the page frame, as a unit vector. */
    fun northOnPage(): Pair<Double, Double> = Pair(-sinA, cosA)

    val angleDeg get() = Math.toDegrees(angleRad)
}

object PageLayout {

    fun plan(files: List<GpxFile>, paper: PaperSpec, options: LayoutOptions): Layout {
        val (samples, segmentStart) = sample(files, options.densifyM)
        require(samples.isNotEmpty()) { "no track points to lay out" }

        val effectiveW = paper.mapWidthM - 2 * options.marginM
        val effectiveH = paper.mapHeightM - 2 * options.marginM
        require(effectiveW > 0 && effectiveH > 0) {
            "a %.0f m margin leaves no room on a %.0f x %.0f m page".format(
                options.marginM, paper.mapWidthM, paper.mapHeightM,
            )
        }

        val angles = if (options.allowRotation) {
            val step = options.angleStepDeg.coerceAtLeast(0.1)
            val count = ceil(180.0 / step).toInt()
            (0 until count).map { Math.toRadians(it * step) }
        } else {
            listOf(0.0)
        }

        // Pass 1: the cheap sequential cover for every angle, to shortlist the good ones.
        val scored = angles.map { a ->
            val cover = coverFor(samples, segmentStart, a, effectiveW, effectiveH)
            a to cover.refine(cover.sequential()).size
        }
        val bestCount = scored.minOf { it.second }
        val shortlist = scored.filter { it.second <= bestCount + 1 }
            .sortedWith(compareBy({ it.second }, { it.first }))
            .take(SHORTLIST)

        // Pass 2: the expensive max-coverage cover, only on the shortlist.
        var best: Pair<Double, List<Rect>>? = null
        for ((candidateAngle, _) in shortlist) {
            val cover = coverFor(samples, segmentStart, candidateAngle, effectiveW, effectiveH)
            val rects = cover.solve(thorough = true)
            check(cover.coversAll(rects)) { "internal error: page plan misses part of the track" }
            val incumbent = best
            if (incumbent == null || rects.size < incumbent.second.size) {
                best = candidateAngle to rects
            }
        }
        var (angle, rects) = best!!

        // Pass 3: randomised restarts on the winning angle, in case a different tie-break
        // sheds one more page.
        if (rects.size > 1) {
            val cover = coverFor(samples, segmentStart, angle, effectiveW, effectiveH)
            val improved = cover.solve(thorough = true, restarts = RESTARTS)
            if (improved.size < rects.size) {
                check(cover.coversAll(improved)) { "internal error: restart plan misses the track" }
                rects = improved
            }
        }

        val ordered = order(samples, segmentStart, angle, rects, options.marginM)
        val pages = withNeighbours(ordered, paper)
        return Layout(
            angleRad = angle,
            paper = paper,
            marginM = options.marginM,
            pages = pages,
            trackBounds = Bounds.of(samples),
            samples = samples,
        )
    }

    /**
     * Page count for every candidate rotation, cheapest strategy only. Exposed so the CLI
     * can explain why a plan came out at the size it did.
     */
    fun scoreAngles(
        files: List<GpxFile>, paper: PaperSpec, options: LayoutOptions,
    ): List<Pair<Double, Int>> {
        val (samples, segmentStart) = sample(files, options.densifyM)
        val w = paper.mapWidthM - 2 * options.marginM
        val h = paper.mapHeightM - 2 * options.marginM
        val step = options.angleStepDeg.coerceAtLeast(0.1)
        return (0 until ceil(180.0 / step).toInt()).map { index ->
            val angle = Math.toRadians(index * step)
            val cover = coverFor(samples, segmentStart, angle, w, h)
            Math.toDegrees(angle) to cover.solve(thorough = true, restarts = RESTARTS).size
        }
    }

    private fun coverFor(
        samples: List<L93>, segmentStart: IntArray, angle: Double, w: Double, h: Double,
    ): Cover {
        val c = cos(angle)
        val s = sin(angle)
        val n = samples.size
        val u = DoubleArray(n)
        val v = DoubleArray(n)
        for (i in 0 until n) {
            val p = samples[i]
            u[i] = p.x * c - p.y * s
            v[i] = p.x * s + p.y * c
        }
        return Cover(u, v, segmentStart, w, h)
    }

    /** Orders pages along the walk and grows each effective rect back to full page size. */
    private fun order(
        samples: List<L93>, segmentStart: IntArray, angle: Double,
        rects: List<Rect>, margin: Double,
    ): List<Rect> {
        val c = cos(angle)
        val s = sin(angle)
        val firstIndex = IntArray(rects.size) { Int.MAX_VALUE }
        for (i in samples.indices) {
            val p = samples[i]
            val pu = p.x * c - p.y * s
            val pv = p.x * s + p.y * c
            for (r in rects.indices) {
                if (rects[r].contains(pu, pv) && i < firstIndex[r]) firstIndex[r] = i
            }
        }
        return rects.indices
            .sortedWith(compareBy({ firstIndex[it] }, { rects[it].vMin }))
            .map { rects[it].expand(margin) }
    }

    /**
     * Labels each page with the pages that carry the map on, one tab per direction.
     *
     * A neighbour is placed on the single edge its centre lies closest to, so a page sitting
     * diagonally up and to the right is announced once, on the edge it mostly continues.
     */
    private fun withNeighbours(rects: List<Rect>, paper: PaperSpec): List<MapPage> {
        val w = paper.mapWidthM
        val h = paper.mapHeightM
        return rects.mapIndexed { i, r ->
            val up = mutableListOf<Int>()
            val down = mutableListOf<Int>()
            val left = mutableListOf<Int>()
            val right = mutableListOf<Int>()
            for (j in rects.indices) {
                if (j == i) continue
                val du = rects[j].centerU - r.centerU
                val dv = rects[j].centerV - r.centerV
                val ru = abs(du) / w
                val rv = abs(dv) / h
                // So close it shows the same ground, or more than one page away.
                if (max(ru, rv) < TOUCH) continue
                if (max(ru, rv) > REACH || min(ru, rv) > SIDEWAYS) continue
                when {
                    ru >= rv && du > 0 -> right
                    ru >= rv -> left
                    dv > 0 -> up
                    else -> down
                }.add(j + 1)
            }
            MapPage(
                number = i + 1,
                rect = r,
                neighbours = Neighbours(
                    up = up.sorted(), down = down.sorted(),
                    left = left.sorted(), right = right.sorted(),
                ),
            )
        }
    }

    /** Projects every file to Lambert-93 and densifies so no gap exceeds [step] metres. */
    fun sample(files: List<GpxFile>, step: Double): Pair<List<L93>, IntArray> {
        val out = ArrayList<L93>()
        val starts = ArrayList<Int>()
        for (file in files) {
            for (segment in file.segments) {
                if (segment.points.isEmpty()) continue
                starts.add(out.size)
                var previous: L93? = null
                for (point in segment.points) {
                    val p = Lambert93.forward(point)
                    val from = previous
                    if (from != null) {
                        val d = hypot(p.x - from.x, p.y - from.y)
                        if (d > step) {
                            val n = ceil(d / step).toInt()
                            for (k in 1 until n) {
                                val t = k.toDouble() / n
                                out.add(
                                    L93(
                                        from.x + (p.x - from.x) * t,
                                        from.y + (p.y - from.y) * t,
                                    ),
                                )
                            }
                        } else if (d < MIN_SPACING) {
                            continue
                        }
                    }
                    out.add(p)
                    previous = p
                }
            }
        }
        starts.add(out.size)
        return out to starts.toIntArray()
    }

    private const val SHORTLIST = 5
    private const val RESTARTS = 24
    /** Furthest two page centres may sit apart, in page dimensions, to count as adjacent. */
    private const val REACH = 1.15

    /** Allowed drift across the announced direction, in page dimensions. */
    private const val SIDEWAYS = 1.0

    /** Below this centre offset the two pages show the same ground, so neither continues. */
    private const val TOUCH = 0.25
    private const val MIN_SPACING = 5.0
}
