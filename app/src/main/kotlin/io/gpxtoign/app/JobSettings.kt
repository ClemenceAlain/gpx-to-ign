package io.gpxtoign.app

import io.gpxtoign.core.JobOptions
import io.gpxtoign.core.layout.LayoutOptions
import io.gpxtoign.core.tiles.MapSource

/**
 * Print quality presets.
 *
 * SCAN25 is continuous-tone, so JPEG quality is the only size lever both encoders expose.
 * Even [COMPACT] holds up against the original under a 3x magnifier; [FINE] exists for
 * anyone who would rather not think about it.
 */
enum class PrintQuality(val label: String, val jpeg: Int) {
    COMPACT("Compacte", 60),
    STANDARD("Standard", 72),
    FINE("Fine", 85),
    ;

    companion object {
        fun of(jpeg: Int) = entries.minByOrNull { kotlin.math.abs(it.jpeg - jpeg) } ?: STANDARD
    }
}

/** Everything the user can tune, in a form that survives a trip through WorkManager data. */
data class JobSettings(
    val marginM: Double = 500.0,
    val allowRotation: Boolean = true,
    val sourceId: String = MapSource.SCAN25.id,
    val apiKey: String = MapSource.SCAN25.apiKey.orEmpty(),
    val includeIndexPage: Boolean = true,
    val jpegQuality: Int = PrintQuality.STANDARD.jpeg,
    val title: String? = null,
) {
    val source: MapSource
        get() = (MapSource.all.firstOrNull { it.id == sourceId } ?: MapSource.SCAN25)
            .let { if (apiKey.isBlank()) it.copy(apiKey = null) else it.copy(apiKey = apiKey) }

    val quality: PrintQuality get() = PrintQuality.of(jpegQuality)

    fun toJobOptions() = JobOptions(
        layout = LayoutOptions(marginM = marginM, allowRotation = allowRotation),
        source = source,
        jpegQuality = jpegQuality,
        includeIndexPage = includeIndexPage,
        title = title,
    )
}
