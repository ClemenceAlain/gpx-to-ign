package io.gpxtoign.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import io.gpxtoign.app.ui.AppText
import io.gpxtoign.app.ui.AppSlider
import io.gpxtoign.app.ui.Chevron
import io.gpxtoign.app.ui.LocalAppColors
import io.gpxtoign.app.ui.PrimaryButton
import io.gpxtoign.app.ui.RowSeparator
import io.gpxtoign.app.ui.Section
import io.gpxtoign.app.ui.SectionFootnote
import io.gpxtoign.app.ui.SectionHeader
import io.gpxtoign.app.ui.SegmentedControl
import io.gpxtoign.app.ui.SettingsRow
import io.gpxtoign.app.ui.TextFieldRow
import io.gpxtoign.core.tiles.MapSource
import kotlin.math.roundToInt

/** What the screen shows about the background job, free of any WorkManager types. */
sealed interface JobUi {
    data class Running(val done: Int, val total: Int, val label: String) : JobUi
    data class Done(
        val pages: Int,
        val bytes: Long,
        val missing: Int,
        val fileName: String?,
    ) : JobUi

    data class Failed(val message: String) : JobUi
}

/** Everything the screen can do, so the layout itself stays free of Android plumbing. */
data class ScreenActions(
    val addFiles: () -> Unit = {},
    val clearFiles: () -> Unit = {},
    val update: ((JobSettings) -> JobSettings) -> Unit = {},
    val generate: () -> Unit = {},
    val openResult: () -> Unit = {},
)

/**
 * The whole screen, as a pure function of [state] and [job].
 *
 * Keeping it free of view models and launchers is what lets the rendered previews in
 * `ScreenPreviews` stand in for a device this project has no way to run.
 */
@Composable
fun ScreenContent(
    state: UiState,
    sources: List<MapSource>,
    actions: ScreenActions,
    job: JobUi? = null,
    insets: PaddingValues = PaddingValues(0.dp),
) {
    val colors = LocalAppColors.current
    var showAdvanced by remember { mutableStateOf(false) }

    Box(
        Modifier
            .fillMaxSize()
            .background(colors.groupedBackground),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(top = insets.calculateTopPadding()),
        ) {
            Header()

            SectionHeader("Traces")
            Section {
                state.files.forEach { file ->
                    SettingsRow(title = file.name, subtitle = "${file.points} points")
                    RowSeparator()
                }
                SettingsRow(
                    title = "Ajouter des traces GPX",
                    titleColor = colors.accent,
                    onClick = actions.addFiles,
                )
                if (state.files.isNotEmpty()) {
                    RowSeparator()
                    SettingsRow(
                        title = "Tout effacer",
                        titleColor = colors.danger,
                        onClick = actions.clearFiles,
                    )
                }
            }
            state.error?.let { SectionFootnote(it) }

            if (state.files.isNotEmpty()) {
                SectionHeader("Mise en page")
                Section {
                    SettingsRow(title = "Marge autour de la trace") {
                        Value("${state.settings.marginM.roundToInt()} m")
                    }
                    AppSlider(
                        value = state.settings.marginM.toFloat(),
                        onValueChange = { value ->
                            actions.update { it.copy(marginM = (value / 50).roundToInt() * 50.0) }
                        },
                        valueRange = 100f..2000f,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
                    )
                    RowSeparator()
                    SettingsRow(title = "Pivoter les cartes") {
                        AppSwitch(state.settings.allowRotation) { value ->
                            actions.update { it.copy(allowRotation = value) }
                        }
                    }
                    RowSeparator()
                    SettingsRow(title = "Plan d'ensemble") {
                        AppSwitch(state.settings.includeIndexPage) { value ->
                            actions.update { it.copy(includeIndexPage = value) }
                        }
                    }
                    RowSeparator()
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            "Qualité d'impression",
                            style = AppText.body,
                            color = colors.label,
                            modifier = Modifier.padding(bottom = 10.dp),
                        )
                        SegmentedControl(
                            options = PrintQuality.entries.map { it.label },
                            selectedIndex = state.settings.quality.ordinal,
                            onSelect = { index ->
                                actions.update {
                                    it.copy(jpegQuality = PrintQuality.entries[index].jpeg)
                                }
                            },
                        )
                    }
                }
                SectionFootnote(
                    "La rotation cherche l'orientation qui tient sur le moins de pages. " +
                        "Une flèche indique le nord sur chaque carte.",
                )

                SectionHeader("Source")
                Section {
                    SettingsRow(
                        title = "Réglages avancés",
                        onClick = { showAdvanced = !showAdvanced },
                    ) { Chevron(expanded = showAdvanced) }
                    AnimatedVisibility(showAdvanced) {
                        Column {
                            RowSeparator()
                            Box(Modifier.padding(16.dp)) {
                                SegmentedControl(
                                    options = sources.map { it.label },
                                    selectedIndex = sources
                                        .indexOfFirst { it.id == state.settings.sourceId }
                                        .coerceAtLeast(0),
                                    onSelect = { index ->
                                        val source = sources[index]
                                        actions.update {
                                            it.copy(
                                                sourceId = source.id,
                                                apiKey = source.apiKey.orEmpty(),
                                            )
                                        }
                                    },
                                )
                            }
                            RowSeparator()
                            TextFieldRow(
                                title = "Clé IGN",
                                value = state.settings.apiKey,
                                placeholder = "aucune",
                                onValueChange = { value ->
                                    actions.update { it.copy(apiKey = value) }
                                },
                            )
                            RowSeparator()
                            TextFieldRow(
                                title = "Titre",
                                value = state.settings.title.orEmpty(),
                                placeholder = "pied de page",
                                onValueChange = { value ->
                                    actions.update { it.copy(title = value.ifBlank { null }) }
                                },
                            )
                        }
                    }
                }

                SectionHeader("Aperçu")
                PlanSummary(state, actions)
            }

            job?.let {
                Spacer(Modifier.height(28.dp))
                JobSection(it, actions)
            }

            Spacer(Modifier.height(40.dp + insets.calculateBottomPadding()))
        }
    }
}

@Composable
private fun Header() {
    val colors = LocalAppColors.current
    Column(Modifier.padding(start = 32.dp, end = 32.dp, top = 28.dp)) {
        Text("Cartes IGN", style = AppText.largeTitle, color = colors.label)
        Text(
            "Des traces GPX vers des pages A4 au 1:25000, prêtes à imprimer.",
            style = AppText.subheadline,
            color = colors.secondaryLabel,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
private fun PlanSummary(state: UiState, actions: ScreenActions) {
    val colors = LocalAppColors.current
    val estimate = state.estimate

    if (estimate == null) {
        Section {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(22.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(
                    Modifier.size(18.dp),
                    color = colors.accent,
                    strokeWidth = 2.dp,
                )
                Text(
                    "Calcul du découpage",
                    style = AppText.body,
                    color = colors.secondaryLabel,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
        }
        return
    }

    Section {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 22.dp, bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("${estimate.pages}", style = AppText.figure, color = colors.accent)
            Text(
                if (estimate.pages > 1) "pages A4 au 1:25000" else "page A4 au 1:25000",
                style = AppText.subheadline,
                color = colors.secondaryLabel,
            )
        }
        RowSeparator()
        SettingsRow(title = "Rotation des cartes") {
            Value("${((360 - estimate.angleDeg) % 360).roundToInt()}°")
        }
        RowSeparator()
        SettingsRow(title = "Taille du PDF") {
            Value("≈ %.0f Mo".format(estimate.approximatePdfBytes / 1e6))
        }
        RowSeparator()
        SettingsRow(title = "Téléchargement") {
            Value("%.0f Mo".format(estimate.approximateBytes / 1e6))
        }
    }
    SectionFootnote(
        "${estimate.tiles} tuiles IGN" +
            if (state.planning) " · recalcul en cours" else ". Préférez le Wi-Fi.",
    )
    Spacer(Modifier.height(24.dp))
    PrimaryButton(
        text = "Générer le PDF",
        onClick = actions.generate,
        enabled = !state.planning,
    )
    SectionFootnote(
        "Android demande où enregistrer le PDF. Le dossier Téléchargements est le plus " +
            "simple à retrouver ensuite.",
    )
}

@Composable
private fun JobSection(job: JobUi, actions: ScreenActions) {
    val colors = LocalAppColors.current
    when (job) {
        is JobUi.Running -> {
            SectionHeader("En cours")
            Section {
                Column(Modifier.padding(16.dp)) {
                    Text(job.label, style = AppText.body, color = colors.label)
                    LinearProgressIndicator(
                        progress = {
                            if (job.total > 0) job.done.toFloat() / job.total else 0f
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 14.dp)
                            .height(4.dp),
                        color = colors.accent,
                        trackColor = colors.fill,
                        strokeCap = StrokeCap.Round,
                        gapSize = 0.dp,
                        drawStopIndicator = {},
                    )
                }
            }
        }
        is JobUi.Done -> {
            SectionHeader("Terminé")
            Section {
                SettingsRow(
                    title = "PDF de ${job.pages} page${if (job.pages > 1) "s" else ""} enregistré",
                    subtitle = job.fileName,
                    titleColor = colors.success,
                )
                RowSeparator()
                SettingsRow(
                    title = "Ouvrir le PDF",
                    titleColor = colors.accent,
                    onClick = actions.openResult,
                )
            }
            SectionFootnote(
                buildString {
                    append("%.0f Mo téléchargés.".format(job.bytes / 1e6))
                    if (job.missing > 0) {
                        val plural = if (job.missing > 1) "s" else ""
                        append(" ${job.missing} tuile$plural manquante$plural, imprimée$plural en blanc.")
                    }
                },
            )
        }
        is JobUi.Failed -> {
            SectionHeader("Échec")
            Section { SettingsRow(title = job.message, titleColor = colors.danger) }
        }
    }
}

@Composable
private fun Value(text: String) {
    Text(text, style = AppText.body, color = LocalAppColors.current.secondaryLabel)
}

@Composable
private fun AppSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val colors = LocalAppColors.current
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.White,
            checkedTrackColor = colors.success,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = Color.White,
            uncheckedTrackColor = colors.fill,
            uncheckedBorderColor = Color.Transparent,
        ),
    )
}
