package io.gpxtoign.core.tiles

import io.gpxtoign.core.geo.TileId

/**
 * A WMTS layer to print from.
 *
 * SCAN25 is not open data, so the Géoplateforme serves it from `/private` behind a key.
 * [apiKey] defaults to the shared transitional key IGN published for the migration; it has
 * a limited life, which is why every field here is user-editable in the app.
 */
data class MapSource(
    val id: String,
    val label: String,
    val endpoint: String,
    val apiKey: String?,
    val layer: String,
    val tileMatrixSet: String,
    val format: String,
    val attribution: String,
) {
    val fileExtension: String get() = if (format.endsWith("png")) "png" else "jpg"

    fun urlFor(tile: TileId): String = buildString {
        append(endpoint)
        append(if (endpoint.contains('?')) '&' else '?')
        if (!apiKey.isNullOrBlank()) append("apikey=").append(apiKey).append('&')
        append("SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile")
        append("&LAYER=").append(layer)
        append("&STYLE=normal")
        append("&TILEMATRIXSET=").append(tileMatrixSet)
        append("&TILEMATRIX=").append(tile.matrix)
        append("&TILECOL=").append(tile.col)
        append("&TILEROW=").append(tile.row)
        append("&FORMAT=").append(format)
    }

    companion object {
        /** The default: SCAN25 on the Lambert-93 grid, 2.5 m per pixel at level 16. */
        val SCAN25 = MapSource(
            id = "scan25",
            label = "IGN SCAN25 (1:25000)",
            endpoint = "https://data.geopf.fr/private/wmts",
            apiKey = "ign_scan_ws",
            layer = "GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93",
            tileMatrixSet = "LAMB93_2.5m",
            format = "image/png",
            attribution = "© IGN — SCAN25®",
        )

        /** Keyless fallback so the app still produces something if the SCAN key dies. */
        val PLAN_IGN = MapSource(
            id = "planign",
            label = "Plan IGN (libre, sans clé)",
            endpoint = "https://data.geopf.fr/wmts",
            apiKey = null,
            layer = "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
            tileMatrixSet = "PM",
            format = "image/png",
            attribution = "© IGN — Plan IGN",
        )

        val all = listOf(SCAN25, PLAN_IGN)
    }
}
