package io.gpxtoign.core.tiles

import io.gpxtoign.core.geo.TileId
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

/** Supplies the bytes of one tile, however it likes. */
interface TileFetcher {
    suspend fun fetch(tile: TileId): ByteArray

    /** Bytes pulled over the network so far, for progress and data-usage reporting. */
    val bytesDownloaded: Long get() = 0L
}

class TileFetchException(message: String, cause: Throwable? = null) : IOException(message, cause)

/**
 * Downloads tiles over plain HTTP, with bounded concurrency and exponential backoff.
 *
 * The Géoplateforme throttles aggressive clients, so [concurrency] stays low and a 429 or
 * 5xx is retried rather than failed. [bytesDownloaded] feeds the progress report.
 */
class HttpTileFetcher(
    private val source: MapSource,
    private val concurrency: Int = 6,
    private val attempts: Int = 4,
    private val userAgent: String = DEFAULT_USER_AGENT,
) : TileFetcher {

    private val gate = Semaphore(concurrency)

    @Volatile
    override var bytesDownloaded: Long = 0L
        private set

    override suspend fun fetch(tile: TileId): ByteArray = gate.withPermit {
        var lastError: Exception? = null
        for (attempt in 0 until attempts) {
            if (attempt > 0) delay(BASE_BACKOFF_MS shl (attempt - 1))
            try {
                val bytes = get(source.urlFor(tile))
                bytesDownloaded += bytes.size
                return@withPermit bytes
            } catch (e: RetryableHttpException) {
                lastError = e
            } catch (e: IOException) {
                lastError = e
            }
        }
        throw TileFetchException("tile $tile could not be downloaded", lastError)
    }

    private suspend fun get(url: String): ByteArray = withContext(Dispatchers.IO) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "image/png,image/jpeg,*/*")
        }
        try {
            val code = connection.responseCode
            if (code == 429 || code >= 500) {
                throw RetryableHttpException("HTTP $code")
            }
            if (code != 200) {
                val body = connection.errorStream?.readBytes()?.decodeToString()?.take(200).orEmpty()
                throw TileFetchException("HTTP $code from the map server. $body".trim())
            }
            val bytes = connection.inputStream.use { it.readBytes() }
            val type = connection.contentType.orEmpty()
            if (!type.startsWith("image/")) {
                throw TileFetchException(
                    "map server returned $type instead of an image: " +
                        bytes.decodeToString().take(200),
                )
            }
            bytes
        } finally {
            connection.disconnect()
        }
    }

    private class RetryableHttpException(message: String) : IOException(message)

    companion object {
        const val DEFAULT_USER_AGENT = "gpx-to-ign/1.0 (+https://github.com/ClemenceAlain/gpx-to-ign)"
        private const val BASE_BACKOFF_MS = 400L
    }
}

/**
 * Caches tiles on disk so a second run, or two pages sharing an edge, never re-downloads.
 */
class CachingTileFetcher(
    private val delegate: TileFetcher,
    private val directory: File,
    private val source: MapSource,
) : TileFetcher {

    override val bytesDownloaded: Long get() = delegate.bytesDownloaded

    @Volatile
    var hits: Int = 0
        private set

    @Volatile
    var misses: Int = 0
        private set

    override suspend fun fetch(tile: TileId): ByteArray {
        val file = fileFor(tile)
        if (file.isFile && file.length() > 0) {
            hits++
            return withContext(Dispatchers.IO) { file.readBytes() }
        }
        val bytes = delegate.fetch(tile)
        misses++
        withContext(Dispatchers.IO) {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, file.name + ".part")
            temp.writeBytes(bytes)
            if (!temp.renameTo(file)) temp.delete()
        }
        return bytes
    }

    private fun fileFor(tile: TileId) = File(
        directory,
        "${source.id}/${tile.matrix}/${tile.col}/${tile.row}.${source.fileExtension}",
    )
}
