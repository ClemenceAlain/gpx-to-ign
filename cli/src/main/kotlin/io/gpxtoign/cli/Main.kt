package io.gpxtoign.cli

import io.gpxtoign.core.JobOptions
import io.gpxtoign.core.JobRunner
import io.gpxtoign.core.gpx.GpxParser
import io.gpxtoign.core.layout.LayoutOptions
import io.gpxtoign.core.tiles.CachingTileFetcher
import io.gpxtoign.core.tiles.HttpTileFetcher
import io.gpxtoign.core.tiles.MapSource
import java.io.File
import kotlin.system.exitProcess
import kotlinx.coroutines.runBlocking

private const val USAGE = """
gpx-to-ign — one printable IGN 1:25000 A4 PDF covering one or more GPX traces

usage: gpx-to-ign [options] <trace.gpx> [more.gpx ...]

  -o, --out FILE      output PDF (default: cartes-ign.pdf)
  -m, --margin M      clearance around the trace in metres (default: 500)
      --no-rotation   keep the maps north-up instead of minimising the page count
      --source ID     ${'$'}{sources}
      --key KEY       API key for the map source
      --cache DIR     tile cache directory (default: .tilecache)
      --title TEXT    title printed in the page footer
      --quality N     JPEG quality 1-100 (default: 85)
      --no-index      skip the overview page
      --dry-run       report the page plan and download estimate, then stop
      --explain       list the page count for every candidate rotation angle
"""

fun main(args: Array<String>) = runBlocking {
    if (args.isEmpty() || args.any { it == "-h" || it == "--help" }) {
        println(USAGE.replace("\${sources}", MapSource.all.joinToString("|") { it.id }))
        return@runBlocking
    }

    var out = File("cartes-ign.pdf")
    var margin = 500.0
    var rotation = true
    var source = MapSource.SCAN25
    var key: String? = null
    var cache = File(".tilecache")
    var title: String? = null
    var quality = 85
    var index = true
    var dryRun = false
    var explain = false
    val inputs = mutableListOf<File>()

    var i = 0
    while (i < args.size) {
        when (val arg = args[i]) {
            "-o", "--out" -> out = File(args[++i])
            "-m", "--margin" -> margin = args[++i].toDouble()
            "--no-rotation" -> rotation = false
            "--source" -> {
                val id = args[++i]
                source = MapSource.all.firstOrNull { it.id == id }
                    ?: fail("unknown source '$id'; try ${MapSource.all.joinToString { it.id }}")
            }
            "--key" -> key = args[++i]
            "--cache" -> cache = File(args[++i])
            "--title" -> title = args[++i]
            "--quality" -> quality = args[++i].toInt()
            "--no-index" -> index = false
            "--dry-run" -> dryRun = true
            "--explain" -> explain = true
            else -> {
                if (arg.startsWith("-")) fail("unknown option '$arg'")
                inputs.add(File(arg))
            }
        }
        i++
    }
    if (inputs.isEmpty()) fail("no GPX file given")
    inputs.firstOrNull { !it.isFile }?.let { fail("no such file: $it") }

    val files = inputs.map { file -> file.inputStream().use { GpxParser.parse(file.name, it) } }
    println("read ${files.size} file(s), ${files.sumOf { it.pointCount }} points")

    val resolved = key?.let { source.copy(apiKey = it) } ?: source
    val options = JobOptions(
        layout = LayoutOptions(marginM = margin, allowRotation = rotation),
        source = resolved,
        jpegQuality = quality,
        includeIndexPage = index,
        title = title ?: files.firstOrNull()?.segments?.firstOrNull()?.name,
    )

    val fetcher = CachingTileFetcher(HttpTileFetcher(resolved), cache, resolved)
    val runner = JobRunner(fetcher, AwtImageCodec())

    val layout = runner.plan(files, options)
    val estimate = runner.estimate(layout, options)
    println(
        "plan: ${estimate.pages} A4 page(s), rotation %.0f°, about %d tiles / %.0f MB to download"
            .format(estimate.angleDeg, estimate.tiles, estimate.approximateBytes / 1e6),
    )
    if (explain) {
        println("page count by rotation angle:")
        io.gpxtoign.core.layout.PageLayout.scoreAngles(files, options.paper, options.layout)
            .groupBy { it.second }
            .toSortedMap()
            .forEach { (pages, angles) ->
                println("  $pages pages: ${angles.joinToString(", ") { "%.0f°".format(it.first) }}")
            }
    }
    if (dryRun) return@runBlocking

    val result = out.outputStream().buffered().use { stream ->
        runner.run(layout, options, stream) { println("  ${it.done}/${it.total} ${it.label}") }
    }
    println(
        "wrote $out: ${result.pdfPages} A4 page(s), %.1f MB downloaded"
            .format(result.bytesDownloaded / 1e6),
    )
    if (result.missingTiles.isNotEmpty()) {
        println("warning: ${result.missingTiles.size} tile(s) failed and print blank")
    }
}

private fun fail(message: String): Nothing {
    System.err.println("gpx-to-ign: $message")
    exitProcess(2)
}
