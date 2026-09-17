import { useCallback, useState } from 'react'
import { SCAN25 } from '@gpx-to-ign/core'
import { CacheTileStore } from '../platform/cacheTileStore.js'
import { renderSinglePagePdf } from '../skeleton.js'

type Phase = 'idle' | 'running' | 'done' | 'failed'

/**
 * The walking skeleton's UI: pick a GPX, get one A4 page of SCAN25 as a PDF.
 *
 * Deliberately thin. It exists to print the ruler test, not to be the app; the real screen
 * comes with the layout port.
 */
export function App(): React.JSX.Element {
  const [gpx, setGpx] = useState<{ name: string; text: string } | null>(null)
  const [apiKey, setApiKey] = useState(SCAN25.apiKey ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')

  const onFile = useCallback(async (file: File | undefined) => {
    if (file === undefined) return
    setGpx({ name: file.name, text: await file.text() })
    setStatus('')
    setPhase('idle')
  }, [])

  const run = useCallback(async () => {
    if (gpx === null) return
    setPhase('running')
    setStatus('Téléchargement des tuiles…')
    try {
      const result = await renderSinglePagePdf(gpx.text, {
        apiKey,
        cache: new CacheTileStore(),
        onProgress: (done, total) => setStatus(`Rendu ${done} / ${total} blocs`),
      })
      const blob = new Blob([result.pdf.slice().buffer as ArrayBuffer], {
        type: 'application/pdf',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = gpx.name.replace(/\.gpx$/i, '') + '.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setPhase('done')
      setStatus(
        `PDF de ${(result.pdf.length / 1_048_576).toFixed(2)} Mo · ` +
          `${result.tilesDownloaded} tuiles téléchargées, ${result.tilesFromCache} en cache` +
          (result.missingTiles > 0 ? ` · ${result.missingTiles} tuiles manquantes` : ''),
      )
    } catch (e) {
      setPhase('failed')
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }, [gpx, apiKey])

  return (
    <main>
      <h1>gpx-to-ign</h1>
      <p className="lede">Une page A4 au 1:25000, à partir d’une trace GPX.</p>

      <section>
        <label className="row">
          <span>Trace</span>
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            data-testid="gpx"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <label className="row">
          <span>Clé IGN</span>
          <input
            type="text"
            value={apiKey}
            data-testid="apikey"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </section>

      <button data-testid="run" disabled={gpx === null || phase === 'running'} onClick={() => void run()}>
        {phase === 'running' ? 'En cours…' : 'Générer le PDF'}
      </button>
      <p className="status" data-testid="status" data-phase={phase}>
        {status}
      </p>
    </main>
  )
}
