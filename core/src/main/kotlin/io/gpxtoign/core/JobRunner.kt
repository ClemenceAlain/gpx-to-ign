package io.gpxtoign.core

import io.gpxtoign.core.geo.Bounds
import io.gpxtoign.core.geo.TileGrid
import io.gpxtoign.core.geo.TileId
import io.gpxtoign.core.gpx.GpxFile
import io.gpxtoign.core.layout.Layout
import io.gpxtoign.core.layout.LayoutOptions
import io.gpxtoign.core.layout.MapPage
import io.gpxtoign.core.layout.PageLayout
import io.gpxtoign.core.layout.PaperSpec
import io.gpxtoign.core.layout.Rect
import io.gpxtoign.core.pdf.PageDecor
import io.gpxtoign.core.pdf.PdfDocument
import io.gpxtoign.core.pdf.PdfPage
import io.gpxtoign.core.pdf.mm
import io.gpxtoign.core.render.ImageCodec
import io.gpxtoign.core.render.MapRenderer
import io.gpxtoign.core.tiles.MapSource
import io.gpxtoign.core.tiles.TileFetcher
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.roundToInt

data class JobOptions(
    val paper: PaperSpec = PaperSpec(),
    val layout: LayoutOptions = LayoutOptions(),
    val source: MapSource = MapSource.SCAN25,
    val jpegQuality: Int = 85,
    val includeIndexPage: Boolean = true,
    val title: String? = null,
)

data class JobProgress(val done: Int, val total: Int, val label: String)

data class JobEstimate(val pages: Int, val tiles: Int, val approximateBytes: Long, val angleDeg: Double)

data class JobResult(
    val pages: Int,
    val angleDeg: Double,
    val bytesDownloaded: Long,
    val missingTiles: List<TileId>,
    val entries: List<String>,
)

/** Turns parsed GPX files into a ZIP of printable A4 PDFs. */
class JobRunner(
    private val fetcher: TileFetcher,
    private val codec: ImageCodec,
) {

    fun plan(files: List<GpxFile>, options: JobOptions): Layout =
        PageLayout.plan(files, options.paper, options.layout)

    /** Rough download size, shown before a job starts so a big trace is not a surprise. */
    fun estimate(layout: Layout, options: JobOptions): JobEstimate {
        val tiles = LinkedHashSet<TileId>()
        for (page in layout.pages) {
            tiles.addAll(TileGrid.tilesCovering(groundBounds(layout, page.rect), TileGrid.NATIVE_MATRIX))
        }
        if (options.includeIndexPage) {
            val (frame, matrix) = overviewFrame(layout, options.paper)
            tiles.addAll(TileGrid.tilesCovering(groundBounds(layout, frame), matrix))
        }
        return JobEstimate(
            pages = layout.pages.size,
            tiles = tiles.size,
            approximateBytes = tiles.size.toLong() * AVERAGE_TILE_BYTES,
            angleDeg = layout.angleDeg,
        )
    }

    suspend fun run(
        files: List<GpxFile>,
        options: JobOptions,
        output: OutputStream,
        onProgress: (JobProgress) -> Unit = {},
    ): JobResult {
        val layout = plan(files, options)
        return run(layout, options, output, onProgress)
    }

    suspend fun run(
        layout: Layout,
        options: JobOptions,
        output: OutputStream,
        onProgress: (JobProgress) -> Unit = {},
    ): JobResult {
        val renderer = MapRenderer(
            fetcher = fetcher,
            codec = codec,
            matrix = TileGrid.NATIVE_MATRIX,
            quality = options.jpegQuality,
        )
        val total = layout.pages.size + if (options.includeIndexPage) 1 else 0
        val entries = mutableListOf<String>()
        val zip = ZipOutputStream(output)
        try {
            if (options.includeIndexPage) {
                onProgress(JobProgress(0, total, "Assemblage du plan d'ensemble"))
                val name = "00-plan-ensemble.pdf"
                zip.putNextEntry(ZipEntry(name))
                zip.write(indexPdf(layout, options))
                zip.closeEntry()
                entries.add(name)
            }
            for (page in layout.pages) {
                onProgress(
                    JobProgress(
                        entries.size, total,
                        "Page ${page.number} sur ${layout.pages.size}",
                    ),
                )
                val name = "page-%02d.pdf".format(page.number)
                zip.putNextEntry(ZipEntry(name))
                zip.write(pagePdf(layout, page, options, renderer))
                zip.closeEntry()
                entries.add(name)
            }
            onProgress(JobProgress(total, total, "Terminé"))
        } finally {
            zip.finish()
        }
        return JobResult(
            pages = layout.pages.size,
            angleDeg = layout.angleDeg,
            bytesDownloaded = fetcher.bytesDownloaded,
            missingTiles = renderer.missingTiles.toList(),
            entries = entries,
        )
    }

    private suspend fun pagePdf(
        layout: Layout, page: MapPage, options: JobOptions, renderer: MapRenderer,
    ): ByteArray {
        val paper = options.paper
        val widthPx = (paper.mapWidthM / TileGrid.NATIVE_RESOLUTION).roundToInt()
        val heightPx = (paper.mapHeightM / TileGrid.NATIVE_RESOLUTION).roundToInt()
        val blocks = renderer.render(page.rect, layout.angleRad, widthPx, heightPx)

        val document = PdfDocument(mm(paper.widthMm), mm(paper.heightMm))
        val canvas = document.addPage()
        placeBlocks(canvas, blocks, paper, widthPx, heightPx)
        PageDecor(layout, paper, options.source.attribution, options.title)
            .draw(canvas, page, layout.pages.size)
        return ByteArrayOutputStream().also { document.writeTo(it) }.toByteArray()
    }

    /**
     * Ground rectangle and tile matrix for the overview page.
     *
     * It deliberately aims at [OVERVIEW_WIDTH_PX] rather than the 2000 pixels a printed page
     * could hold: an index only has to be readable, and one level coarser is four times
     * fewer tiles to download.
     */
    private fun overviewFrame(layout: Layout, paper: PaperSpec): Pair<Rect, Int> {
        val union = layout.pages.map { it.rect }.reduce { a, b -> a.union(b) }
        val framed = fitToPage(union.expand(union.width * 0.04), paper)
        return framed to TileGrid.matrixFor(framed.width / OVERVIEW_WIDTH_PX)
    }

    private suspend fun indexPdf(layout: Layout, options: JobOptions): ByteArray {
        val paper = options.paper
        val (framed, matrix) = overviewFrame(layout, paper)
        val overview = MapRenderer(fetcher, codec, matrix, quality = options.jpegQuality)
        val widthPx = (framed.width / TileGrid.resolution(matrix)).roundToInt().coerceIn(256, 3000)
        val heightPx = (widthPx * framed.height / framed.width).roundToInt().coerceAtLeast(256)
        val blocks = overview.render(framed, layout.angleRad, widthPx, heightPx)

        val document = PdfDocument(mm(paper.widthMm), mm(paper.heightMm))
        val canvas = document.addPage()
        placeBlocks(canvas, blocks, paper, widthPx, heightPx)

        val mapX = mm(paper.safeMarginMm)
        val mapY = mm(paper.safeMarginMm + paper.footerMm)
        val mapW = mm(paper.mapWidthMm)
        val mapH = mm(paper.mapHeightMm)
        val scaleX = mapW / framed.width
        val scaleY = mapH / framed.height

        canvas.setStroke(0.85, 0.1, 0.1)
        canvas.setLineWidth(1.0)
        for (page in layout.pages) {
            val x = mapX + (page.rect.uMin - framed.uMin) * scaleX
            val y = mapY + (page.rect.vMin - framed.vMin) * scaleY
            canvas.strokeRect(x, y, page.rect.width * scaleX, page.rect.height * scaleY)
            val cx = x + page.rect.width * scaleX / 2
            val cy = y + page.rect.height * scaleY / 2
            canvas.setFill(1.0, 1.0, 1.0)
            canvas.fillRect(cx - mm(4.0), cy - mm(3.0), mm(8.0), mm(6.0))
            canvas.setStroke(0.85, 0.1, 0.1)
            canvas.strokeRect(cx - mm(4.0), cy - mm(3.0), mm(8.0), mm(6.0))
            canvas.setFill(0.85, 0.1, 0.1)
            canvas.textCentered(cx, cy - mm(1.8), 12.0, page.number.toString(), bold = true)
        }
        canvas.setStroke(0.0, 0.0, 0.0)
        canvas.setLineWidth(0.6)
        canvas.strokeRect(mapX, mapY, mapW, mapH)

        canvas.setFill(0.0, 0.0, 0.0)
        val baseline = mm(paper.safeMarginMm + 2.5)
        canvas.text(mapX, baseline + mm(4.0), 10.0, "Plan d'ensemble", bold = true)
        options.title?.let {
            canvas.text(mapX + canvas.textWidth("Plan d'ensemble  ", 10.0, bold = true), baseline + mm(4.0), 9.0, it)
        }
        canvas.textRight(
            mapX + mapW, baseline + mm(4.0), 7.5,
            "${layout.pages.size} page${if (layout.pages.size > 1) "s" else ""} A4 à " +
                "1:${paper.scaleDenominator} · " +
                "rotation ${((360.0 - layout.angleDeg) % 360.0).roundToInt()}° · ${options.source.attribution}",
        )
        return ByteArrayOutputStream().also { document.writeTo(it) }.toByteArray()
    }

    private fun placeBlocks(
        canvas: PdfPage,
        blocks: List<io.gpxtoign.core.render.RenderedBlock>,
        paper: PaperSpec,
        widthPx: Int,
        heightPx: Int,
    ) {
        val mapX = mm(paper.safeMarginMm)
        val mapY = mm(paper.safeMarginMm + paper.footerMm)
        val ptPerPxX = mm(paper.mapWidthMm) / widthPx
        val ptPerPxY = mm(paper.mapHeightMm) / heightPx
        for (block in blocks) {
            canvas.drawJpeg(
                jpeg = block.jpeg,
                widthPx = block.width,
                heightPx = block.height,
                x = mapX + block.x * ptPerPxX,
                y = mapY + (heightPx - block.y - block.height) * ptPerPxY,
                w = block.width * ptPerPxX,
                h = block.height * ptPerPxY,
            )
        }
    }

    /** Grows a rectangle until it matches the printable area's aspect ratio. */
    private fun fitToPage(rect: Rect, paper: PaperSpec): Rect {
        val target = paper.mapWidthM / paper.mapHeightM
        val current = rect.width / rect.height
        return if (current > target) {
            val h = rect.width / target
            Rect(rect.uMin, rect.centerV - h / 2, rect.uMax, rect.centerV + h / 2)
        } else {
            val w = rect.height * target
            Rect(rect.centerU - w / 2, rect.vMin, rect.centerU + w / 2, rect.vMax)
        }
    }

    private fun groundBounds(layout: Layout, rect: Rect): Bounds {
        val corners = listOf(
            layout.toL93(rect.uMin, rect.vMin), layout.toL93(rect.uMax, rect.vMin),
            layout.toL93(rect.uMin, rect.vMax), layout.toL93(rect.uMax, rect.vMax),
        )
        return Bounds(
            corners.minOf { it.x }, corners.minOf { it.y },
            corners.maxOf { it.x }, corners.maxOf { it.y },
        )
    }

    private companion object {
        /** Mean SCAN25 PNG tile size measured over a few hundred alpine tiles. */
        const val AVERAGE_TILE_BYTES = 145_000L

        /** Width the overview raster aims for, in pixels. */
        const val OVERVIEW_WIDTH_PX = 1400.0
    }
}
