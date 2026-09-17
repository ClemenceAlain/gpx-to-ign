import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  A4_25K,
  ALL_SOURCES,
  DEFAULT_LAYOUT_OPTIONS,
  HttpTileFetcher,
  JobRunner,
  SCAN25,
  parseGpx,
  plan,
  planPreview,
  pointCount,
  sourceById,
  type GpxFile,
  type JobEstimate,
  type JobOptions,
  type JobProgress,
  type Layout,
} from '@gpx-to-ign/core'
import { BrowserImageCodec } from '../platform/browserImageCodec.js'
import { CacheTileStore } from '../platform/cacheTileStore.js'
import { IndexedDbPageStore } from '../platform/pageStore.js'
import { BlobSink, keepAwake, savePdf } from '../platform/savePdf.js'
import {
  QUALITY_PRESETS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../platform/settings.js'
import { PlanPreviewMap } from './PlanPreviewMap.js'
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
  | { readonly kind: 'running'; readonly done: number; readonly total: number; readonly label: string }
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

  useEffect(() => saveSettings(settings), [settings])

  const source = useMemo(
    () => ({ ...(sourceById(settings.sourceId) ?? SCAN25), apiKey: settings.apiKey || null }),
    [settings.sourceId, settings.apiKey],
  )

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
      title: settings.title.trim() === '' ? null : settings.title.trim(),
    }),
    [settings, source],
  )

  // Planning is pure arithmetic over a few hundred points and touches no network, so it can
  // run inline and follow the margin slider. That is the whole reason the preview is vector.
  const planned = useMemo<{ layout: Layout; estimate: JobEstimate } | { error: string } | null>(
    () => {
      if (files.length === 0) return null
      try {
        const layout = plan(
          files.map((f) => f.gpx),
          jobOptions.paper,
          jobOptions.layout,
        )
        const runner = new JobRunner({
          fetcher: new HttpTileFetcher(),
          codec: new BrowserImageCodec(),
        })
        return { layout, estimate: runner.estimate(layout, jobOptions) }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    [files, jobOptions],
  )

  const preview = useMemo(
    () => (planned !== null && 'layout' in planned ? planPreview(planned.layout) : null),
    [planned],
  )

  const addFiles = useCallback(async (picked: FileList | null) => {
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
    setError(null)
    setJob(null)
    setFiles((current) => [...current, ...loaded])
  }, [])

  const generate = useCallback(async () => {
    if (planned === null || !('layout' in planned)) return
    const release = await keepAwake()
    setJob({ kind: 'running', done: 0, total: planned.estimate.pages, label: 'Préparation' })
    try {
      const fetcher = new HttpTileFetcher({ cache: new CacheTileStore() })
      const runner = new JobRunner({
        fetcher,
        codec: new BrowserImageCodec(),
        pageStore: new IndexedDbPageStore(),
      })
      const sink = new BlobSink()
      const result = await runner.run(planned.layout, jobOptions, sink, (p: JobProgress) =>
        setJob({ kind: 'running', done: p.done, total: p.total, label: p.label }),
      )
      const base = files[0]?.gpx.name.replace(/\.gpx$/i, '') ?? 'cartes'
      const fileName = await savePdf(sink.toBlob(), `${base}.pdf`)
      setJob({
        kind: 'done',
        pages: result.pages,
        bytes: fetcher.bytesDownloaded,
        missing: result.missingTiles.length,
        fileName,
      })
    } catch (e) {
      setJob({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    } finally {
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
    <main className="screen">
      <header className="header">
        <h1>Cartes IGN</h1>
        <p>Des traces GPX vers des pages A4 au 1:25000, prêtes à imprimer.</p>
      </header>

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
                  setSettings((s) => ({ ...s, jpegQuality: QUALITY_PRESETS[i]!.jpeg }))
                }
              />
            </div>
          </Section>
          <SectionFootnote>
            La rotation cherche l’orientation qui tient sur le moins de pages. Une flèche
            indique le nord sur chaque carte. Le plan d’ensemble est affiché ci-dessous ; ne
            l’ajoutez au PDF que pour l’imprimer.
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

          <SectionHeader>Aperçu</SectionHeader>
          {planned !== null && 'error' in planned ? (
            <>
              <Section>
                <SettingsRow title={planned.error} tone="danger" />
              </Section>
            </>
          ) : planned === null ? (
            <Section>
              <div className="spinner-row">
                <div className="spinner" />
                Calcul du découpage
              </div>
            </Section>
          ) : (
            <>
              <Section>
                {preview !== null && (
                  <>
                    <PlanPreviewMap preview={preview} />
                    <RowSeparator inset={false} />
                  </>
                )}
                <div className="figure" data-testid="pages">
                  <strong>{planned.estimate.pages}</strong>
                  <span>
                    {planned.estimate.pages > 1 ? 'pages A4 au 1:25000' : 'page A4 au 1:25000'}
                  </span>
                </div>
                <RowSeparator />
                <SettingsRow
                  title="Rotation des cartes"
                  value={`${Math.round((360 - planned.estimate.angleDeg) % 360)}°`}
                />
                <RowSeparator />
                <SettingsRow
                  title="Taille du PDF"
                  value={`≈ ${megabytes(planned.estimate.approximatePdfBytes)}`}
                />
                <RowSeparator />
                <SettingsRow
                  title="Téléchargement"
                  value={megabytes(planned.estimate.approximateBytes)}
                />
              </Section>
              <SectionFootnote>
                Les pages sont numérotées dans l’ordre de la marche. {planned.estimate.tiles}{' '}
                tuiles IGN. Préférez le Wi-Fi.
              </SectionFootnote>

              <div style={{ marginTop: 24 }}>
                <PrimaryButton
                  testId="generate"
                  onClick={() => void generate()}
                  disabled={job?.kind === 'running'}
                >
                  Générer le PDF
                </PrimaryButton>
              </div>
            </>
          )}
        </>
      )}

      {job !== null && <JobSection job={job} />}
    </main>
  )
}

function JobSection({ job }: { job: Job }): React.JSX.Element {
  if (job.kind === 'running') {
    return (
      <>
        <SectionHeader>En cours</SectionHeader>
        <Section>
          <div style={{ padding: 16 }} data-testid="job-running">
            {job.label}
            <div className="progress">
              <div style={{ width: `${job.total > 0 ? (job.done / job.total) * 100 : 0}%` }} />
            </div>
          </div>
        </Section>
      </>
    )
  }
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
