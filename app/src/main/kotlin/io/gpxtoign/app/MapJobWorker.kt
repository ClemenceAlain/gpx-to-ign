package io.gpxtoign.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import io.gpxtoign.core.JobRunner
import io.gpxtoign.core.tiles.CachingTileFetcher
import io.gpxtoign.core.tiles.HttpTileFetcher
import java.io.File

/**
 * Downloads tiles and writes the ZIP in the background.
 *
 * It runs as a foreground worker because a long trace can mean several hundred tiles and a
 * few minutes of work, which Android would otherwise kill as soon as the screen locks.
 */
class MapJobWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo("Préparation…", 0, 1)

    override suspend fun doWork(): Result {
        val sources = inputData.getStringArray(KEY_SOURCES)?.map(Uri::parse).orEmpty()
        val destination = inputData.getString(KEY_DESTINATION)?.let(Uri::parse)
            ?: return Result.failure(workDataOf(KEY_ERROR to "no destination chosen"))
        val settings = JobSettings(
            marginM = inputData.getDouble(KEY_MARGIN, 500.0),
            allowRotation = inputData.getBoolean(KEY_ROTATION, true),
            sourceId = inputData.getString(KEY_SOURCE_ID).orEmpty(),
            apiKey = inputData.getString(KEY_API_KEY).orEmpty(),
            includeIndexPage = inputData.getBoolean(KEY_INDEX, true),
            jpegQuality = inputData.getInt(KEY_QUALITY, 85),
            title = inputData.getString(KEY_TITLE),
        )

        return try {
            val files = GpxLoader.load(applicationContext, sources)
            val options = settings.toJobOptions()
            val fetcher = CachingTileFetcher(
                HttpTileFetcher(options.source),
                File(applicationContext.cacheDir, "tiles"),
                options.source,
            )
            val runner = JobRunner(fetcher, AndroidImageCodec())
            val layout = runner.plan(files, options)

            val result = applicationContext.contentResolver.openOutputStream(destination)?.use { out ->
                runner.run(layout, options, out.buffered()) { progress ->
                    setProgressAsync(
                        workDataOf(
                            KEY_DONE to progress.done,
                            KEY_TOTAL to progress.total,
                            KEY_LABEL to progress.label,
                        ),
                    )
                    setForegroundAsync(foregroundInfo(progress.label, progress.done, progress.total))
                }
            } ?: return Result.failure(workDataOf(KEY_ERROR to "the chosen file could not be written"))

            notifyFinished(destination, result.pdfPages)
            Result.success(
                workDataOf(
                    KEY_PAGES to result.pdfPages,
                    KEY_BYTES to result.bytesDownloaded,
                    KEY_MISSING to result.missingTiles.size,
                    KEY_ANGLE to result.angleDeg,
                ),
            )
        } catch (e: Exception) {
            Result.failure(workDataOf(KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        }
    }

    /**
     * A finished job is easy to miss: the download runs for minutes with the screen off, so
     * the result gets its own notification that opens the PDF straight from the shade.
     */
    private fun notifyFinished(destination: Uri, pages: Int) {
        channel(DONE_CHANNEL, NotificationManager.IMPORTANCE_DEFAULT)
        val open = PendingIntent.getActivity(
            applicationContext,
            0,
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(destination, "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(applicationContext, DONE_CHANNEL)
            .setContentTitle("Cartes prêtes")
            .setContentText("$pages page(s) A4 enregistrées. Touchez pour ouvrir le PDF.")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        NotificationManagerCompat.from(applicationContext).let { manager ->
            if (manager.areNotificationsEnabled()) {
                @Suppress("MissingPermission")
                manager.notify(DONE_NOTIFICATION_ID, notification)
            }
        }
    }

    private fun channel(id: String, importance: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(
                    NotificationChannel(
                        id,
                        applicationContext.getString(R.string.notification_channel),
                        importance,
                    ),
                )
        }
    }

    private fun foregroundInfo(label: String, done: Int, total: Int): ForegroundInfo {
        channel(CHANNEL, NotificationManager.IMPORTANCE_LOW)
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setContentTitle(applicationContext.getString(R.string.app_name))
            .setContentText(label)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setProgress(total.coerceAtLeast(1), done, false)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val NAME = "gpx-to-ign-job"
        private const val CHANNEL = "gpx-to-ign"
        private const val DONE_CHANNEL = "gpx-to-ign-done"
        private const val NOTIFICATION_ID = 4231
        private const val DONE_NOTIFICATION_ID = 4232

        const val KEY_SOURCES = "sources"
        const val KEY_DESTINATION = "destination"
        const val KEY_MARGIN = "margin"
        const val KEY_ROTATION = "rotation"
        const val KEY_SOURCE_ID = "sourceId"
        const val KEY_API_KEY = "apiKey"
        const val KEY_INDEX = "index"
        const val KEY_QUALITY = "quality"
        const val KEY_TITLE = "title"

        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"
        const val KEY_LABEL = "label"
        const val KEY_PAGES = "pages"
        const val KEY_BYTES = "bytes"
        const val KEY_MISSING = "missing"
        const val KEY_ANGLE = "angle"
        const val KEY_ERROR = "error"

        fun dataFor(sources: List<Uri>, destination: Uri, settings: JobSettings) = workDataOf(
            KEY_SOURCES to sources.map(Uri::toString).toTypedArray(),
            KEY_DESTINATION to destination.toString(),
            KEY_MARGIN to settings.marginM,
            KEY_ROTATION to settings.allowRotation,
            KEY_SOURCE_ID to settings.sourceId,
            KEY_API_KEY to settings.apiKey,
            KEY_INDEX to settings.includeIndexPage,
            KEY_QUALITY to settings.jpegQuality,
            KEY_TITLE to settings.title,
        )
    }
}
