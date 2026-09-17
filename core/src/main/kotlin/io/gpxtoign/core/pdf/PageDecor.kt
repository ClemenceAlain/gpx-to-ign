package io.gpxtoign.core.pdf

import io.gpxtoign.core.layout.Layout
import io.gpxtoign.core.layout.MapPage
import io.gpxtoign.core.layout.PaperSpec
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.roundToInt

/** Millimetres to PostScript points. */
internal fun mm(value: Double) = value * 72.0 / 25.4

/**
 * Everything printed on top of the map: the Lambert-93 kilometre grid, a north arrow that
 * accounts for the page rotation, the scale bar, the page number and the neighbour hints.
 *
 * The GPX trace itself is deliberately never drawn — it only decided where the pages go.
 */
class PageDecor(
    private val layout: Layout,
    private val paper: PaperSpec,
    private val attribution: String,
    private val title: String?,
) {
    private val mapX = mm(paper.safeMarginMm)
    private val mapY = mm(paper.safeMarginMm + paper.footerMm)
    private val mapW = mm(paper.mapWidthMm)
    private val mapH = mm(paper.mapHeightMm)

    /** Ground metres per PostScript point at the printing scale. */
    private val metresPerPt = paper.scaleDenominator * 25.4 / 72.0 / 1000.0

    fun draw(canvas: PdfPage, page: MapPage, total: Int) {
        val rect = page.rect
        fun toPt(u: Double, v: Double) = Pair(
            mapX + (u - rect.uMin) / metresPerPt,
            mapY + (v - rect.vMin) / metresPerPt,
        )

        drawKilometreGrid(canvas, page, ::toPt)
        canvas.setStroke(0.0, 0.0, 0.0)
        canvas.setLineWidth(0.6)
        canvas.strokeRect(mapX, mapY, mapW, mapH)

        drawNorthArrow(canvas)
        drawNeighbourTabs(canvas, page)
        drawFooter(canvas, page, total)
    }

    // --- kilometre grid ----------------------------------------------------------------

    private fun drawKilometreGrid(
        canvas: PdfPage, page: MapPage, toPt: (Double, Double) -> Pair<Double, Double>,
    ) {
        val rect = page.rect
        val corners = listOf(
            layout.toL93(rect.uMin, rect.vMin), layout.toL93(rect.uMax, rect.vMin),
            layout.toL93(rect.uMin, rect.vMax), layout.toL93(rect.uMax, rect.vMax),
        )
        val xMin = corners.minOf { it.x }
        val xMax = corners.maxOf { it.x }
        val yMin = corners.minOf { it.y }
        val yMax = corners.maxOf { it.y }
        val reach = hypot(rect.width, rect.height)

        canvas.setStroke(0.15, 0.35, 0.75)
        canvas.setLineWidth(0.3)
        canvas.setFill(0.15, 0.35, 0.75)

        for (km in ceil(xMin / GRID_M).toInt()..floor(xMax / GRID_M).toInt()) {
            val x = km * GRID_M
            val mid = (yMin + yMax) / 2.0
            drawGridLine(canvas, toPt, x, mid - reach, x, mid + reach, "${km}")
        }
        for (km in ceil(yMin / GRID_M).toInt()..floor(yMax / GRID_M).toInt()) {
            val y = km * GRID_M
            val mid = (xMin + xMax) / 2.0
            drawGridLine(canvas, toPt, mid - reach, y, mid + reach, y, "${km}")
        }
    }

    private fun drawGridLine(
        canvas: PdfPage, toPt: (Double, Double) -> Pair<Double, Double>,
        x1: Double, y1: Double, x2: Double, y2: Double, label: String,
    ) {
        val (u1, v1) = layout.toPage(io.gpxtoign.core.geo.L93(x1, y1))
        val (u2, v2) = layout.toPage(io.gpxtoign.core.geo.L93(x2, y2))
        val (px1, py1) = toPt(u1, v1)
        val (px2, py2) = toPt(u2, v2)
        val clipped = Segments.clip(px1, py1, px2, py2, mapX, mapY, mapX + mapW, mapY + mapH)
            ?: return
        canvas.line(clipped[0], clipped[1], clipped[2], clipped[3])
        // Label at whichever end sits lower on the page, nudged inside the frame.
        val (lx, ly) = if (clipped[1] <= clipped[3]) {
            clipped[0] to clipped[1]
        } else {
            clipped[2] to clipped[3]
        }
        val tx = lx.coerceIn(mapX + 1.0, mapX + mapW - mm(7.0))
        val ty = ly.coerceIn(mapY + 1.0, mapY + mapH - mm(4.0))
        val width = canvas.textWidth(label, 5.0) + 2.0
        canvas.setFill(1.0, 1.0, 1.0)
        canvas.fillRect(tx, ty, width, 6.5)
        canvas.setFill(0.15, 0.35, 0.75)
        canvas.text(tx + 1.0, ty + 1.5, 5.0, label)
    }

    // --- overlays ----------------------------------------------------------------------

    private fun drawNorthArrow(canvas: PdfPage) {
        val boxW = mm(13.0)
        val boxH = mm(17.0)
        val x = mapX + mapW - boxW - mm(2.0)
        val y = mapY + mapH - boxH - mm(2.0)

        canvas.setFill(1.0, 1.0, 1.0)
        canvas.fillRect(x, y, boxW, boxH)
        canvas.setStroke(0.0, 0.0, 0.0)
        canvas.setLineWidth(0.5)
        canvas.strokeRect(x, y, boxW, boxH)

        val cx = x + boxW / 2.0
        val cy = y + mm(7.5)
        val (nu, nv) = layout.northOnPage()
        val len = mm(5.5)
        val tipX = cx + nu * len
        val tipY = cy + nv * len
        val tailX = cx - nu * len
        val tailY = cy - nv * len
        // Perpendicular, for the arrow head.
        val px = -nv * mm(1.8)
        val py = nu * mm(1.8)

        canvas.setLineWidth(0.8)
        canvas.line(tailX, tailY, tipX, tipY)
        canvas.setFill(0.0, 0.0, 0.0)
        canvas.fillPolygon(
            listOf(
                tipX to tipY,
                tipX - nu * mm(3.5) + px to tipY - nv * mm(3.5) + py,
                tipX - nu * mm(3.5) - px to tipY - nv * mm(3.5) - py,
            ),
        )
        canvas.textCentered(cx, y + mm(1.5), 7.0, "N", bold = true)
        val rotation = ((360.0 - layout.angleDeg) % 360.0).roundToInt()
        canvas.textCentered(cx, y + boxH - mm(3.0), 5.0, "$rotation°")
    }

    /**
     * White tabs on each edge naming the page that carries the map on. The arrow is a
     * triangle rather than a glyph, because WinAnsi encoding has no arrow characters.
     */
    private fun drawNeighbourTabs(canvas: PdfPage, page: MapPage) {
        fun tab(numbers: List<Int>, x: Double, y: Double, dirX: Double, dirY: Double) {
            if (numbers.isEmpty()) return
            val label = "p. " + numbers.joinToString(", ")
            val arrow = mm(3.0)
            val w = canvas.textWidth(label, 7.0, bold = true) + arrow + mm(3.0)
            val h = mm(4.5)
            canvas.setFill(1.0, 1.0, 1.0)
            canvas.fillRect(x - w / 2, y - h / 2, w, h)
            canvas.setStroke(0.0, 0.0, 0.0)
            canvas.setLineWidth(0.4)
            canvas.strokeRect(x - w / 2, y - h / 2, w, h)

            val ax = x - w / 2 + mm(1.0) + arrow / 2
            val half = arrow / 2
            canvas.setFill(0.0, 0.0, 0.0)
            canvas.fillPolygon(
                listOf(
                    ax + dirX * half to y + dirY * half,
                    ax - dirX * half - dirY * half to y - dirY * half + dirX * half,
                    ax - dirX * half + dirY * half to y - dirY * half - dirX * half,
                ),
            )
            canvas.text(x - w / 2 + mm(1.0) + arrow + mm(1.0), y - mm(1.1), 7.0, label, bold = true)
        }
        val cx = mapX + mapW / 2
        val cy = mapY + mapH / 2
        tab(page.neighbours.up, cx, mapY + mapH - mm(3.0), 0.0, 1.0)
        tab(page.neighbours.down, cx, mapY + mm(3.0), 0.0, -1.0)
        tab(page.neighbours.left, mapX + mm(16.0), cy, -1.0, 0.0)
        tab(page.neighbours.right, mapX + mapW - mm(16.0), cy, 1.0, 0.0)
    }

    private fun drawFooter(canvas: PdfPage, page: MapPage, total: Int) {
        val baseline = mm(paper.safeMarginMm + 1.5)
        canvas.setFill(0.0, 0.0, 0.0)
        canvas.text(mapX, baseline + mm(5.0), 9.0, "Page ${page.number} / $total", bold = true)
        title?.let {
            canvas.text(
                mapX + canvas.textWidth("Page ${page.number} / $total  ", 9.0, bold = true),
                baseline + mm(5.0), 8.0, it,
            )
        }
        canvas.textRight(
            mapX + mapW, baseline + mm(5.0), 7.0,
            "1:${paper.scaleDenominator} · $attribution · grille Lambert-93 (1 km)",
        )
        drawScaleBar(canvas, mapX, baseline)
    }

    private fun drawScaleBar(canvas: PdfPage, x: Double, y: Double) {
        val totalM = 1000.0
        val segments = 5
        val barW = totalM / metresPerPt
        val segW = barW / segments
        val h = mm(1.4)
        for (i in 0 until segments) {
            if (i % 2 == 0) canvas.setFill(0.0, 0.0, 0.0) else canvas.setFill(1.0, 1.0, 1.0)
            canvas.fillRect(x + i * segW, y, segW, h)
        }
        canvas.setStroke(0.0, 0.0, 0.0)
        canvas.setLineWidth(0.4)
        canvas.strokeRect(x, y, barW, h)
        canvas.setFill(0.0, 0.0, 0.0)
        canvas.text(x, y - mm(2.6), 6.0, "0")
        canvas.textRight(x + barW, y - mm(2.6), 6.0, "1 km")
    }

    private companion object {
        const val GRID_M = 1000.0
    }
}
