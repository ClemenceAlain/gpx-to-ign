package io.gpxtoign.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import io.gpxtoign.core.gpx.GpxFile
import io.gpxtoign.core.gpx.GpxParseException
import io.gpxtoign.core.gpx.GpxParser

/** Reads GPX files that arrive as content URIs, from the picker or from a share intent. */
object GpxLoader {

    fun load(context: Context, uris: List<Uri>): List<GpxFile> = uris.map { uri ->
        val name = displayName(context, uri)
        val stream = context.contentResolver.openInputStream(uri)
            ?: throw GpxParseException("$name: file could not be opened")
        stream.use { GpxParser.parse(name, it) }
    }

    fun displayName(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0 && cursor.moveToFirst()) return cursor.getString(column)
            }
        return uri.lastPathSegment ?: "trace.gpx"
    }
}
