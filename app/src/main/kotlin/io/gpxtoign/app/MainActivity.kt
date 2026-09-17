package io.gpxtoign.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.systemBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import io.gpxtoign.app.ui.AppTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                val model: MainViewModel = viewModel()
                MainScreen(model, sharedUris(intent))
            }
        }
    }

    private fun sharedUris(intent: Intent?): List<Uri> = when (intent?.action) {
        Intent.ACTION_VIEW -> listOfNotNull(intent.data)
        Intent.ACTION_SEND -> listOfNotNull(
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM),
        )
        Intent.ACTION_SEND_MULTIPLE ->
            @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                .orEmpty()
        else -> emptyList()
    }
}

@Composable
private fun MainScreen(model: MainViewModel, shared: List<Uri>) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var consumedShare by remember { mutableStateOf(false) }
    var destination by remember { mutableStateOf<Uri?>(null) }

    if (!consumedShare && shared.isNotEmpty()) {
        consumedShare = true
        model.addFiles(shared)
    }

    val notifications = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    // Asked for on entry, never alongside the save dialog: two activity launches in one click
    // race each other, the prompt wins, and the save dialog never appears.
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val pickGpx = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        uris.forEach { persist(context, it, write = false) }
        model.addFiles(uris)
    }

    val savePdf = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/pdf"),
    ) { uri ->
        if (uri != null) {
            destination = uri
            persist(context, uri, write = true)
            WorkManager.getInstance(context).enqueueUniqueWork(
                MapJobWorker.NAME,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<MapJobWorker>()
                    .setInputData(
                        MapJobWorker.dataFor(state.files.map { it.uri }, uri, state.settings),
                    )
                    .build(),
            )
        }
    }

    val work by WorkManager.getInstance(context)
        .getWorkInfosForUniqueWorkFlow(MapJobWorker.NAME)
        .collectAsStateWithLifecycle(initialValue = emptyList())

    ScreenContent(
        state = state,
        sources = model.sources,
        actions = ScreenActions(
            addFiles = { pickGpx.launch(arrayOf("*/*")) },
            clearFiles = {
                destination = null
                model.clear()
            },
            update = model::update,
            generate = { savePdf.launch("cartes-ign.pdf") },
            openResult = { destination?.let { openPdf(context, it) } },
        ),
        job = work.firstOrNull()?.toJobUi(context, destination),
        insets = WindowInsets.systemBars.asPaddingValues(),
    )
}

private fun WorkInfo.toJobUi(context: Context, destination: Uri?): JobUi? = when (state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING -> JobUi.Running(
        done = progress.getInt(MapJobWorker.KEY_DONE, 0),
        total = progress.getInt(MapJobWorker.KEY_TOTAL, 1),
        label = progress.getString(MapJobWorker.KEY_LABEL) ?: "En attente",
    )
    WorkInfo.State.SUCCEEDED -> JobUi.Done(
        pages = outputData.getInt(MapJobWorker.KEY_PAGES, 0),
        bytes = outputData.getLong(MapJobWorker.KEY_BYTES, 0L),
        missing = outputData.getInt(MapJobWorker.KEY_MISSING, 0),
        fileName = destination?.let { GpxLoader.displayName(context, it) },
    )
    WorkInfo.State.FAILED -> JobUi.Failed(
        outputData.getString(MapJobWorker.KEY_ERROR) ?: "La génération a échoué",
    )
    else -> null
}

/** Hands the finished PDF to whatever app on the phone can display one. */
private fun openPdf(context: Context, uri: Uri) {
    val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/pdf")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { context.startActivity(Intent.createChooser(intent, "Ouvrir le PDF")) }
}

/**
 * Holds on to the document grant past this activity: the ZIP is written by a background
 * worker, which may well outlive the screen that picked the files.
 */
private fun persist(context: Context, uri: Uri, write: Boolean) {
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
        if (write) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0
    runCatching { context.contentResolver.takePersistableUriPermission(uri, flags) }
}
