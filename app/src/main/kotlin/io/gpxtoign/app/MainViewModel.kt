package io.gpxtoign.app

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.gpxtoign.core.JobEstimate
import io.gpxtoign.core.JobRunner
import io.gpxtoign.core.gpx.GpxFile
import io.gpxtoign.core.tiles.MapSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class PickedFile(val uri: Uri, val name: String, val points: Int)

data class UiState(
    val files: List<PickedFile> = emptyList(),
    val settings: JobSettings = JobSettings(),
    val planning: Boolean = false,
    val estimate: JobEstimate? = null,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var parsed: List<GpxFile> = emptyList()

    fun addFiles(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(planning = true, error = null) }
            try {
                val context = getApplication<Application>()
                val loaded = withContext(Dispatchers.IO) { GpxLoader.load(context, uris) }
                parsed = parsed + loaded
                val picked = uris.mapIndexed { index, uri ->
                    PickedFile(uri, loaded[index].name, loaded[index].pointCount)
                }
                _state.update { current ->
                    current.copy(
                        files = current.files + picked,
                        settings = current.settings.copy(
                            title = current.settings.title
                                ?: loaded.firstOrNull()?.segments?.firstOrNull()?.name,
                        ),
                    )
                }
                replan()
            } catch (e: Exception) {
                parsed = emptyList()
                _state.update { it.copy(planning = false, files = emptyList(), error = e.message) }
            }
        }
    }

    fun clear() {
        parsed = emptyList()
        _state.value = UiState()
    }

    fun update(transform: (JobSettings) -> JobSettings) {
        _state.update { it.copy(settings = transform(it.settings)) }
        viewModelScope.launch { replan() }
    }

    val sources: List<MapSource> get() = MapSource.all

    private suspend fun replan() {
        if (parsed.isEmpty()) return
        _state.update { it.copy(planning = true, error = null) }
        try {
            val settings = _state.value.settings
            val options = settings.toJobOptions()
            val estimate = withContext(Dispatchers.Default) {
                val runner = JobRunner(NoTiles, AndroidImageCodec())
                runner.estimate(runner.plan(parsed, options), options)
            }
            _state.update { it.copy(planning = false, estimate = estimate) }
        } catch (e: Exception) {
            _state.update { it.copy(planning = false, estimate = null, error = e.message) }
        }
    }

    /** Planning never touches the network; only rendering does. */
    private object NoTiles : io.gpxtoign.core.tiles.TileFetcher {
        override suspend fun fetch(tile: io.gpxtoign.core.geo.TileId) =
            error("planning does not fetch tiles")
    }
}
