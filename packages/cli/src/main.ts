#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  A4_25K,
  DEFAULT_LAYOUT_OPTIONS,
  HttpTileFetcher,
  JobRunner,
  parseGpx,
  plan,
  pointCount,
  scoreAngles,
  type ByteSink,
  type GpxFile,
  type JobOptions,
} from '@gpx-to-ign/core'
import { CliError, USAGE, parseArgs, type CliArgs } from './args.js'
import { NodeImageCodec } from './codec.js'
import { FileTileCache } from './tileCache.js'

/** Writes straight through to the file, so a thirty-page book never sits in memory twice. */
class StreamSink implements ByteSink {
  private readonly stream: NodeJS.WritableStream

  constructor(stream: NodeJS.WritableStream) {
    this.stream = stream
  }

  write(bytes: Uint8Array): void {
    this.stream.write(Buffer.from(bytes))
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(1)
}

async function readInputs(paths: readonly string[]): Promise<GpxFile[]> {
  const files: GpxFile[] = []
  for (const path of paths) {
    try {
      await stat(path)
    } catch {
      throw new CliError(`no such file: ${path}`)
    }
    files.push(parseGpx(basename(path), await readFile(path, 'utf8')))
  }
  return files
}

export interface RunDeps {
  readonly log?: (line: string) => void
  /** Injected so a test can drive a whole book without touching the Géoplateforme. */
  readonly fetchImpl?: typeof fetch
}

export async function run(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  const args = parseArgs(argv)
  if (args.help) {
    log(USAGE)
    return 0
  }

  const files = await readInputs(args.inputs)
  const points = files.reduce((total, f) => total + pointCount(f), 0)
  log(`read ${files.length} file(s), ${points} points`)

  const source = args.apiKey === null ? args.source : { ...args.source, apiKey: args.apiKey }
  const layoutOptions = {
    ...DEFAULT_LAYOUT_OPTIONS,
    marginM: args.marginM,
    allowRotation: args.allowRotation,
  }
  const options: JobOptions = {
    paper: A4_25K,
    layout: layoutOptions,
    source,
    jpegQuality: args.jpegQuality,
    includeIndexPage: args.includeIndexPage,
    drawTrack: args.drawTrack,
    title: args.title ?? files[0]?.segments[0]?.name ?? null,
  }

  const fetcher = new HttpTileFetcher({
    cache: new FileTileCache(args.cache),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  })
  const runner = new JobRunner({ fetcher, codec: new NodeImageCodec() })

  const layout = plan(files, options.paper, options.layout)
  const estimate = runner.estimate(layout, options)
  log(
    `plan: ${estimate.pages} A4 page(s), rotation ${estimate.angleDeg.toFixed(0)}°, ` +
      `about ${estimate.tiles} tiles / ${megabytes(estimate.approximateBytes)} MB to download, ` +
      `PDF about ${megabytes(estimate.approximatePdfBytes)} MB`,
  )

  if (args.explain) {
    log('page count by rotation angle:')
    const byCount = new Map<number, number[]>()
    for (const { angleDeg, pages } of scoreAngles(files, options.paper, options.layout)) {
      const bucket = byCount.get(pages)
      if (bucket === undefined) byCount.set(pages, [angleDeg])
      else bucket.push(angleDeg)
    }
    for (const pages of [...byCount.keys()].sort((a, b) => a - b)) {
      const angles = byCount.get(pages)!.map((a) => `${a.toFixed(0)}°`)
      log(`  ${pages} pages: ${angles.join(', ')}`)
    }
  }
  if (args.dryRun) return 0

  const stream = createWriteStream(args.out)
  const result = await runner.run(layout, options, new StreamSink(stream), (p) =>
    log(`  ${p.done}/${p.total} ${p.label}`),
  )
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve())
    stream.on('error', reject)
  })

  log(
    `wrote ${args.out}: ${result.pdfPages} A4 page(s), ` +
      `${megabytes(result.bytesDownloaded)} MB downloaded`,
  )
  if (result.missingTiles.length > 0) {
    log(`warning: ${result.missingTiles.length} tile(s) failed and print blank`)
  }
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))
if (invokedDirectly) {
  try {
    process.exitCode = await run(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`gpx-to-ign: ${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = 2
  }
}
