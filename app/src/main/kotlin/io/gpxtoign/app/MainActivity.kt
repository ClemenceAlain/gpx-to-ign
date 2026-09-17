package io.gpxtoign.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(model: MainViewModel, shared: List<Uri>) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var consumedShare by remember { mutableStateOf(false) }
    var showAdvanced by remember { mutableStateOf(false) }

    if (!consumedShare && shared.isNotEmpty()) {
        consumedShare = true
        model.addFiles(shared)
    }

    val notifications = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    val pickGpx = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> model.addFiles(uris) }

    val saveZip = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri ->
        if (uri != null) {
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

    Scaffold(topBar = { TopAppBar(title = { Text("GPX vers cartes IGN") }) }) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Choisissez une ou plusieurs traces GPX. L'application calcule le plus petit " +
                    "nombre de pages A4 au 1:25000 qui couvrent la trace avec une marge, " +
                    "puis produit un ZIP de PDF prêts à imprimer.",
                style = MaterialTheme.typography.bodyMedium,
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { pickGpx.launch(arrayOf("*/*")) }) { Text("Ajouter des GPX") }
                if (state.files.isNotEmpty()) {
                    OutlinedButton(onClick = model::clear) { Text("Effacer") }
                }
            }

            state.files.forEach { file ->
                Text("• ${file.name} — ${file.points} points", style = MaterialTheme.typography.bodySmall)
            }

            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            if (state.files.isNotEmpty()) {
                HorizontalDivider()
                Text("Marge autour de la trace : ${state.settings.marginM.roundToInt()} m")
                Slider(
                    value = state.settings.marginM.toFloat(),
                    onValueChange = { value ->
                        model.update { it.copy(marginM = (value / 50).roundToInt() * 50.0) }
                    },
                    valueRange = 100f..2000f,
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = state.settings.allowRotation,
                        onCheckedChange = { value -> model.update { it.copy(allowRotation = value) } },
                    )
                    Spacer(Modifier.fillMaxWidth(0.04f))
                    Text("Faire pivoter les cartes pour réduire le nombre de pages")
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = state.settings.includeIndexPage,
                        onCheckedChange = { value ->
                            model.update { it.copy(includeIndexPage = value) }
                        },
                    )
                    Spacer(Modifier.fillMaxWidth(0.04f))
                    Text("Ajouter un plan d'ensemble")
                }

                OutlinedButton(onClick = { showAdvanced = !showAdvanced }) {
                    Text(if (showAdvanced) "Masquer les réglages avancés" else "Réglages avancés")
                }
                if (showAdvanced) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        model.sources.forEach { source ->
                            FilterChip(
                                selected = state.settings.sourceId == source.id,
                                onClick = {
                                    model.update {
                                        it.copy(
                                            sourceId = source.id,
                                            apiKey = source.apiKey.orEmpty(),
                                        )
                                    }
                                },
                                label = { Text(source.label) },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = state.settings.apiKey,
                        onValueChange = { value -> model.update { it.copy(apiKey = value) } },
                        label = { Text("Clé API IGN") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = state.settings.title.orEmpty(),
                        onValueChange = { value ->
                            model.update { it.copy(title = value.ifBlank { null }) }
                        },
                        label = { Text("Titre imprimé en pied de page") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                HorizontalDivider()
                if (state.planning) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.height(20.dp))
                        Spacer(Modifier.fillMaxWidth(0.04f))
                        Text("Calcul du découpage…")
                    }
                }
                state.estimate?.let { estimate ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(
                                "${estimate.pages} page${if (estimate.pages > 1) "s" else ""} A4",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text("Rotation des cartes : ${((360 - estimate.angleDeg) % 360).roundToInt()}°")
                            Text(
                                "Téléchargement estimé : %.0f Mo (%d tuiles)"
                                    .format(estimate.approximateBytes / 1e6, estimate.tiles),
                            )
                            Text(
                                "Utilisez le Wi-Fi si possible.",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    Button(
                        onClick = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                            saveZip.launch("cartes-ign.zip")
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Générer le ZIP de PDF")
                    }
                }
            }

            work.firstOrNull()?.let { info -> JobStatus(info) }
        }
    }
}

@Composable
private fun JobStatus(info: WorkInfo) {
    HorizontalDivider()
    when (info.state) {
        WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED -> {
            val done = info.progress.getInt(MapJobWorker.KEY_DONE, 0)
            val total = info.progress.getInt(MapJobWorker.KEY_TOTAL, 1)
            val label = info.progress.getString(MapJobWorker.KEY_LABEL) ?: "En attente…"
            Text(label)
            LinearProgressIndicator(
                progress = { if (total > 0) done.toFloat() / total else 0f },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        WorkInfo.State.SUCCEEDED -> {
            val pages = info.outputData.getInt(MapJobWorker.KEY_PAGES, 0)
            val bytes = info.outputData.getLong(MapJobWorker.KEY_BYTES, 0L)
            val missing = info.outputData.getInt(MapJobWorker.KEY_MISSING, 0)
            Text(
                "ZIP écrit : $pages page(s), %.0f Mo téléchargés.".format(bytes / 1e6),
                color = Color(0xFF2E7D32),
            )
            if (missing > 0) {
                Text("$missing tuile(s) manquante(s) : ces zones sont blanches.")
            }
        }
        WorkInfo.State.FAILED -> Text(
            info.outputData.getString(MapJobWorker.KEY_ERROR) ?: "Échec de la génération",
            color = MaterialTheme.colorScheme.error,
        )
        else -> Unit
    }
}
