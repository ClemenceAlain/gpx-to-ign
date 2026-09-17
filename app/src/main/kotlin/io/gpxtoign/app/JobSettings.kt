package io.gpxtoign.app

import io.gpxtoign.core.JobOptions
import io.gpxtoign.core.layout.LayoutOptions
import io.gpxtoign.core.tiles.MapSource

/** Everything the user can tune, in a form that survives a trip through WorkManager data. */
data class JobSettings(
    val marginM: Double = 500.0,
    val allowRotation: Boolean = true,
    val sourceId: String = MapSource.SCAN25.id,
    val apiKey: String = MapSource.SCAN25.apiKey.orEmpty(),
    val includeIndexPage: Boolean = true,
    val jpegQuality: Int = 85,
    val title: String? = null,
) {
    val source: MapSource
        get() = (MapSource.all.firstOrNull { it.id == sourceId } ?: MapSource.SCAN25)
            .let { if (apiKey.isBlank()) it.copy(apiKey = null) else it.copy(apiKey = apiKey) }

    fun toJobOptions() = JobOptions(
        layout = LayoutOptions(marginM = marginM, allowRotation = allowRotation),
        source = source,
        jpegQuality = jpegQuality,
        includeIndexPage = includeIndexPage,
        title = title,
    )
}
