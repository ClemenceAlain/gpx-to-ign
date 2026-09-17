import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  A4_25K,
  ALL_SOURCES,
  DEFAULT_LAYOUT_OPTIONS,
  SCAN25,
  parseGpx,
  pointCount,
  sourceById,
  type GpxFile,
  type JobEstimate,
  type JobOptions,
} from '@gpx-to-ign/core'
import { isNative, nativePdfTarget, onSharedGpx } from '../platform/native.js'
import { keepAwake, pickPdfTarget } from '../platform/savePdf.js'
import type { JobMessage } from '../worker/jobProtocol.js'
import { QUALITY_PRESETS, loadSettings, saveSettings, type Settings } from '../platform/settings.js'
import { PlanPreviewMap } from './PlanPreviewMap.js'
import { usePlan } from './usePlan.js'
import {
  AppSlider,
  AppSwitch,
  Chevron,
  Disclosure,
  PrimaryButton,
  RowSeparator,
  Section,
  SectionFootnote,
  SectionHeader,
  SegmentedControl,
  SettingsRow,
  TextFieldRow,
} from './components.js'

type Job =
  | {
      readonly kind: 'running'
      readonly done: number
      readonly total: number
      readonly label: string
    }
  | {
      readonly kind: 'done'
      readonly pages: number
      readonly bytes: number
      readonly missing: number
      readonly fileName: string | null
    }
  | { readonly kind: 'failed'; readonly message: string }

interface LoadedFile {
  readonly gpx: GpxFile
  readonly points: number
}

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} Mo`
}

export function App(): React.JSX.Element {
  const [files, setFiles] = useState<LoadedFile[]>([])
  // Read once, lazily. Loading in an effect instead lost every setting on a remount: the
  // save effect wrote the defaults first, and the next mount read those back.
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const controls = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLElement>(null)

  /**
   * Publishes the controls column's height, so the preview column beside it can match.
   * CSS grid can stretch the shorter column but has no way to cap the taller one, and the
   * preview looked absurd running a screen and a half past the settings it belongs to.
   */
  useEffect(() => {
    const column = controls.current
    const root = screen.current
    if (column === null || root === null) return
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--controls-height', `${column.offsetHeight}px`)
    })
    observer.observe(column)
    return () => observer.disconnect()
  }, [])

  useEffect(() => saveSettings(settings), [settings])

  const source = useMemo(
    () => ({
      ...(sourceById(settings.sourceId) ?? SCAN25),
      apiKey: settings.apiKey || null,
    }),
    [settings.sourceId, settings.apiKey],
  )

  const gpxFiles = useMemo(() => files.map((f) => f.gpx), [files])

  /**
   * Only what reaches the paper. The title and the key are drawn or sent but change no
   * rectangle and no tile, so typing in either must not throw away a plan.
   */
  const planned = usePlan({
    files: gpxFiles,
    marginM: settings.marginM,
    allowRotation: settings.allowRotation,
    source,
    jpegQuality: settings.jpegQuality,
    includeIndexPage: settings.includeIndexPage,
  })

  const jobOptions = useMemo<JobOptions>(
    () => ({
      paper: A4_25K,
      layout: {
        ...DEFAULT_LAYOUT_OPTIONS,
        marginM: settings.marginM,
        allowRotation: settings.allowRotation,
      },
      source,
      jpegQuality: settings.jpegQuality,
      includeIndexPage: settings.includeIndexPage,
      drawTrack: settings.drawTrack,
      title: settings.title.trim() === '' ? null : settings.title.trim(),
    }),
    [settings, source],
  )

  const addParsed = useCallback((loaded: LoadedFile[]) => {
    setError(null)
    setJob(null)
    setFiles((current) => [...current, ...loaded])
  }, [])

  /** "Share to Cartes IGN" from another app. On the web this listener never fires. */
  useEffect(
    () =>
      onSharedGpx((shared) => {
        const loaded: LoadedFile[] = []
        for (const file of shared) {
          try {
            const gpx = parseGpx(file.name, file.text)
            loaded.push({ gpx, points: pointCount(gpx) })
          } catch (e) {
            setError(`${file.name} : ${e instanceof Error ? e.message : String(e)}`)
            return
          }
        }
        addParsed(loaded)
      }),
    [addParsed],
  )

  const addFiles = useCallback(
    async (picked: FileList | null) => {
      if (picked === null || picked.length === 0) return
      // Snapshot first: the caller resets the input to allow re-picking the same file, and
      // that empties this live FileList before the first `await file.text()` returns.
      const chosen = [...picked]
      const loaded: LoadedFile[] = []
      for (const file of chosen) {
        try {
          const gpx = parseGpx(file.name, await file.text())
          loaded.push({ gpx, points: pointCount(gpx) })
        } catch (e) {
          setError(`${file.name} : ${e instanceof Error ? e.message : String(e)}`)
          return
        }
      }
      addParsed(loaded)
    },
    [addParsed],
  )

  const generate = useCallback(async () => {
    if (planned.status !== 'ready') return
    // The picker must be asked while the click's activation is still live: after a job it
    // throws, having already spent the download.
    const base = files[0]?.gpx.name.replace(/\.gpx$/i, '') ?? 'cartes'
    // Android writes to Documents and offers the share sheet; the browser asks where first.
    const target = isNative() ? nativePdfTarget(`${base}.pdf`) : await pickPdfTarget(`${base}.pdf`)
    if (target === null) return

    const release = await keepAwake()
    setJob({
      kind: 'running',
      done: 0,
      total: planned.estimate.pages,
      label: 'Préparation',
    })
    const worker = new Worker(new URL('../worker/job.worker.ts', import.meta.url), {
      type: 'module',
    })
    try {
      const result = await new Promise<Extract<JobMessage, { kind: 'done' }>>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<JobMessage>) => {
          const message = event.data
          if (message.kind === 'progress') {
            setJob({
              kind: 'running',
              done: message.done,
              total: message.total,
              label: message.label,
            })
          } else if (message.kind === 'done') resolve(message)
          else reject(new Error(message.message))
        }
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage({
          layout: {
            angleRad: planned.layout.angleRad,
            marginM: planned.layout.marginM,
            pages: planned.layout.pages,
            trackBounds: planned.layout.trackBounds,
            samples: planned.layout.samples,
            segmentStart: planned.layout.segmentStart,
          },
          options: jobOptions,
        })
      })
      const blob = new Blob([result.pdf.buffer as ArrayBuffer], {
        type: 'application/pdf',
      })
      const fileName = await target.write(blob)
      setJob({
        kind: 'done',
        pages: result.pages,
        bytes: result.bytesDownloaded,
        missing: result.missingTiles.length,
        fileName,
      })
    } catch (e) {
      setJob({
        kind: 'failed',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      worker.terminate()
      release()
    }
  }, [planned, jobOptions, files])

  const qualityIndex = Math.max(
    QUALITY_PRESETS.findIndex((p) => p.jpeg === settings.jpegQuality),
    0,
  )
  const sourceIndex = Math.max(
    ALL_SOURCES.findIndex((s) => s.id === settings.sourceId),
    0,
  )

  return (
    <main className="screen" ref={screen}>
      <header className="header">
        <h1>Cartes IGN</h1>
        <p>Des traces GPX vers des pages A4 au 1:25000, prêtes à imprimer.</p>
      </header>

      <div className="column controls" ref={controls}>
        <SectionHeader>Traces</SectionHeader>
        <Section>
          {files.map((file, i) => (
            <div key={`${file.gpx.name}-${i}`}>
              <SettingsRow title={file.gpx.name} subtitle={`${file.points} points`} />
              <RowSeparator />
            </div>
          ))}
          <SettingsRow
            title="Ajouter des traces GPX"
            tone="accent"
            testId="add-files"
            onClick={() => input.current?.click()}
          />
          {files.length > 0 && (
            <>
              <RowSeparator />
              <SettingsRow
                title="Tout effacer"
                tone="danger"
                testId="clear-files"
                onClick={() => {
                  setFiles([])
                  setJob(null)
                  setError(null)
                }}
              />
            </>
          )}
        </Section>
        <input
          ref={input}
          type="file"
          accept=".gpx,application/gpx+xml"
          multiple
          hidden
          data-testid="gpx"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {error !== null && <SectionFootnote>{error}</SectionFootnote>}

        {files.length > 0 && (
          <>
            <SectionHeader>Mise en page</SectionHeader>
            <Section>
              <SettingsRow title="Marge autour de la trace" value={`${settings.marginM} m`} />
              <div style={{ padding: '0 16px 12px' }}>
                <AppSlider
                  label="Marge autour de la trace, en mètres"
                  testId="margin"
                  value={settings.marginM}
                  min={100}
                  max={2000}
                  step={50}
                  onChange={(marginM) => setSettings((s) => ({ ...s, marginM }))}
                />
              </div>
              <RowSeparator />
              <SettingsRow title="Pivoter les cartes">
                <AppSwitch
                  label="Pivoter les cartes"
                  testId="rotation"
                  checked={settings.allowRotation}
                  onChange={(allowRotation) => setSettings((s) => ({ ...s, allowRotation }))}
                />
              </SettingsRow>
              <RowSeparator />
              <SettingsRow title="Tracé GPX sur les cartes">
                <AppSwitch
                  label="Tracé GPX sur les cartes"
                  testId="draw-track"
                  checked={settings.drawTrack}
                  onChange={(drawTrack) => setSettings((s) => ({ ...s, drawTrack }))}
                />
              </SettingsRow>
              <RowSeparator />
              <SettingsRow title="Plan d'ensemble dans le PDF">
                <AppSwitch
                  label="Plan d'ensemble dans le PDF"
                  testId="index-page"
                  checked={settings.includeIndexPage}
                  onChange={(includeIndexPage) => setSettings((s) => ({ ...s, includeIndexPage }))}
                />
              </SettingsRow>
              <RowSeparator />
              <div style={{ padding: 16 }}>
                <div style={{ paddingBottom: 10 }}>Qualité d’impression</div>
                <SegmentedControl
                  label="Qualité d’impression"
                  testId="quality"
                  options={QUALITY_PRESETS.map((p) => p.label)}
                  selectedIndex={qualityIndex}
                  onSelect={(i) =>
                    setSettings((s) => ({
                      ...s,
                      jpegQuality: QUALITY_PRESETS[i]!.jpeg,
                    }))
                  }
                />
              </div>
            </Section>
            <SectionFootnote>
              La rotation cherche l’orientation qui tient sur le moins de pages. Une flèche indique
              le nord sur chaque carte. Le tracé s’imprime en violet et masque un peu la carte
              dessous. Le plan d’ensemble est affiché ci-dessous ; ne l’ajoutez au PDF que pour
              l’imprimer.
            </SectionFootnote>

            <SectionHeader>Source</SectionHeader>
            <Section>
              <SettingsRow
                title="Réglages avancés"
                testId="advanced"
                onClick={() => setAdvanced((open) => !open)}
              >
                <Chevron expanded={advanced} />
              </SettingsRow>
              <Disclosure open={advanced}>
                <RowSeparator />
                <div style={{ padding: 16 }}>
                  <SegmentedControl
                    label="Source des cartes"
                    testId="source"
                    options={ALL_SOURCES.map((s) => s.label)}
                    selectedIndex={sourceIndex}
                    onSelect={(i) => {
                      const picked = ALL_SOURCES[i]!
                      setSettings((s) => ({
                        ...s,
                        sourceId: picked.id,
                        apiKey: picked.apiKey ?? '',
                      }))
                    }}
                  />
                </div>
                <RowSeparator />
                <TextFieldRow
                  title="Clé IGN"
                  testId="apikey"
                  value={settings.apiKey}
                  placeholder="aucune"
                  onChange={(apiKey) => setSettings((s) => ({ ...s, apiKey }))}
                />
                <RowSeparator />
                <TextFieldRow
                  title="Titre"
                  testId="title"
                  value={settings.title}
                  placeholder="pied de page"
                  onChange={(title) => setSettings((s) => ({ ...s, title }))}
                />
              </Disclosure>
            </Section>
          </>
        )}
      </div>

      <div className="column preview-column">
        {files.length > 0 && (
          <>
            <SectionHeader>Aperçu</SectionHeader>
            {planned.status === 'error' ? (
              <Section>
                <SettingsRow title={planned.message} tone="danger" testId="plan-error" />
              </Section>
            ) : planned.status !== 'ready' ? (
              <Section>
                <div className="spinner-row" data-testid="planning">
                  <div className="spinner" />
                  Calcul du découpage
                </div>
              </Section>
            ) : (
              <>
                <Section>
                  <PlanPreviewMap preview={planned.preview} />
                  <RowSeparator inset={false} />
                  {planned.stale ? (
                    // The figures below belong to the previous margin, so they are replaced
                    // rather than left to be read as current.
                    <div className="spinner-row" data-testid="planning">
                      <div className="spinner" />
                      Calcul du découpage
                    </div>
                  ) : (
                    <Summary estimate={planned.estimate} />
                  )}
                </Section>
                <SectionFootnote>
                  Les pages sont numérotées dans l’ordre de la marche. {planned.estimate.tiles}{' '}
                  tuiles IGN. Préférez le Wi-Fi.
                </SectionFootnote>

                <div style={{ marginTop: 24 }}>
                  {job?.kind === 'running' ? (
                    // The action becomes its own progress, in the place the eye already is.
                    // Left below the button it was a 4 px grey hairline nobody could see.
                    <RunningCard job={job} />
                  ) : (
                    <PrimaryButton
                      testId="generate"
                      onClick={() => void generate()}
                      disabled={planned.stale}
                    >
                      Générer le PDF
                    </PrimaryButton>
                  )}
                </div>
              </>
            )}
            {job !== null && job.kind !== 'running' && <JobSection job={job} />}
          </>
        )}
      </div>
    </main>
  )
}

/**
 * Pages, rotation, size, download.
 *
 * Two shapes of the same numbers. The phone keeps the big figure the Compose app had; beside
 * the preview it collapses to one quiet line, because every row it costs there is a row the
 * map does not get.
 */
function Summary({ estimate }: { estimate: JobEstimate }): React.JSX.Element {
  const rotation = `${Math.round((360 - estimate.angleDeg) % 360)}°`
  const pdf = `≈ ${megabytes(estimate.approximatePdfBytes)}`
  const download = megabytes(estimate.approximateBytes)
  return (
    <>
      <div className="summary-stacked">
        <div className="figure" data-testid="pages">
          <strong>{estimate.pages}</strong>
          <span>{estimate.pages > 1 ? 'pages A4 au 1:25000' : 'page A4 au 1:25000'}</span>
        </div>
        <RowSeparator />
        <SettingsRow title="Rotation des cartes" value={rotation} />
        <RowSeparator />
        <SettingsRow title="Taille du PDF" value={pdf} />
        <RowSeparator />
        <SettingsRow title="Téléchargement" value={download} />
      </div>
      <div className="summary-line" data-testid="pages-compact">
        <strong>{estimate.pages}</strong> {estimate.pages > 1 ? 'pages' : 'page'} A4 au 1:25000
        <span>
          {' '}
          · rotation {rotation} · PDF {pdf} · {download} à télécharger
        </span>
      </div>
    </>
  )
}

/** What the primary button turns into for the length of a job: a bar and a number. */
function RunningCard({ job }: { job: Extract<Job, { kind: 'running' }> }): React.JSX.Element {
  const percent = job.total > 0 ? (job.done / job.total) * 100 : 0
  return (
    <Section>
      <div className="running" data-testid="job-running">
        <div className="running-line">
          <span>{job.label}</span>
          {/* A percentage, not "1 / 4": the label already says which page, and the two
              counts disagree by one because one is starting and the other is finished. */}
          <span className="row-value">{Math.round(percent)} %</span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={job.done}
          aria-valuemin={0}
          aria-valuemax={job.total}
        >
          <div style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Section>
  )
}

function JobSection({ job }: { job: Job }): React.JSX.Element {
  if (job.kind === 'running') return <RunningCard job={job} />
  if (job.kind === 'failed') {
    return (
      <>
        <SectionHeader>Échec</SectionHeader>
        <Section>
          <SettingsRow title={job.message} tone="danger" testId="job-failed" />
        </Section>
      </>
    )
  }
  const plural = job.missing > 1 ? 's' : ''
  return (
    <>
      <SectionHeader>Terminé</SectionHeader>
      <Section>
        <SettingsRow
          testId="job-done"
          title={`PDF de ${job.pages} page${job.pages > 1 ? 's' : ''} enregistré`}
          subtitle={job.fileName}
          tone="success"
        />
      </Section>
      <SectionFootnote>
        {megabytes(job.bytes)} téléchargés.
        {job.missing > 0 &&
          ` ${job.missing} tuile${plural} manquante${plural}, imprimée${plural} en blanc.`}
      </SectionFootnote>
    </>
  )
}
