import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { TILE_PX } from '../src/geo/tileGrid.js'
import type { TileId } from '../src/geo/tileGrid.js'
import { JobRunner, jobIdOf, pageBytesAt, type JobOptions, type PageStore } from '../src/job.js'
import { A4_25K, DEFAULT_LAYOUT_OPTIONS, plan } from '../src/layout/pageLayout.js'
import { ArrayBufferSink } from '../src/pdf/pdfDocument.js'
import { filled, type ImageCodec, type RgbaImage } from '../src/render/image.js'
import type { RenderedBlock } from '../src/render/mapRenderer.js'
import { SCAN25 } from '../src/tiles/mapSource.js'
import type { TileFetcher } from '../src/tiles/tileFetcher.js'
import { line } from './layout/tracks.js'

/** Encodes nothing; the tests measure structure and bookkeeping, not pixels. */
const stubCodec: ImageCodec = {
  async decode(): Promise<RgbaImage> {
    return filled(TILE_PX, TILE_PX, [200, 200, 200, 255])
  },
  async encodeJpeg(image: RgbaImage, quality: number): Promise<Uint8Array> {
    // Size tracks area and quality, so a checkpointed page is distinguishable from a redraw.
    return new Uint8Array(64).fill(quality & 0xff)
  },
}

class CountingFetcher implements TileFetcher {
  readonly seen = new Set<string>()
  bytesDownloaded = 0
  tilesDownloaded = 0
  tilesFromCache = 0

  async fetch(_source: unknown, tile: TileId): Promise<Uint8Array> {
    this.seen.add(`${tile.matrix}/${tile.col}/${tile.row}`)
    this.tilesDownloaded++
    this.bytesDownloaded += 1000
    return new Uint8Array(4)
  }
}

class MemoryPageStore implements PageStore {
  private readonly entries = new Map<string, RenderedBlock[]>()
  reads = 0
  writes = 0

  private key(jobId: string, page: number, quality: number): string {
    return `${jobId}/${page}/${quality}`
  }

  async get(jobId: string, page: number, quality: number): Promise<RenderedBlock[] | null> {
    this.reads++
    return this.entries.get(this.key(jobId, page, quality)) ?? null
  }

  async put(
    jobId: string,
    page: number,
    quality: number,
    blocks: readonly RenderedBlock[],
  ): Promise<void> {
    this.writes++
    this.entries.set(this.key(jobId, page, quality), [...blocks])
  }

  async clear(): Promise<void> {
    this.entries.clear()
  }
}

const files = [line(0, 12_000)]
const layout = plan(files, A4_25K, DEFAULT_LAYOUT_OPTIONS)

function options(overrides: Partial<JobOptions> = {}): JobOptions {
  return {
    paper: A4_25K,
    layout: DEFAULT_LAYOUT_OPTIONS,
    source: SCAN25,
    jpegQuality: 72,
    includeIndexPage: false,
    title: null,
    ...overrides,
  }
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

/** Content streams are deflated, so page operators have to be inflated to be read. */
function operators(pdf: Uint8Array): string {
  const text = latin1(pdf)
  const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g
  const parts: string[] = []
  let m: RegExpExecArray | null
  while ((m = header.exec(text)) !== null) {
    const start = m.index + m[0].length
    parts.push(latin1(unzlibSync(pdf.subarray(start, start + Number(m[1])))))
  }
  return parts.join('\n')
}

describe('pageBytesAt', () => {
  it('matches the browser curve measured on real SCAN25', () => {
    expect(pageBytesAt(50)).toBe(745_000)
    expect(pageBytesAt(72)).toBe(975_000)
    expect(pageBytesAt(90)).toBe(1_562_000)
  })

  it('interpolates between anchors and clamps outside them', () => {
    expect(pageBytesAt(65)).toBeGreaterThan(pageBytesAt(60))
    expect(pageBytesAt(65)).toBeLessThan(pageBytesAt(70))
    expect(pageBytesAt(10)).toBe(pageBytesAt(50))
    expect(pageBytesAt(100)).toBe(pageBytesAt(90))
  })
})

describe('jobIdOf', () => {
  it('is stable for the same job', () => {
    expect(jobIdOf(layout, options())).toBe(jobIdOf(layout, options()))
  })

  it('changes when anything that changes the output changes', () => {
    const base = jobIdOf(layout, options())
    expect(jobIdOf(layout, options({ jpegQuality: 85 }))).not.toBe(base)
    expect(jobIdOf(layout, options({ includeIndexPage: true }))).not.toBe(base)
    expect(jobIdOf(layout, options({ source: { ...SCAN25, apiKey: 'other' } }))).not.toBe(base)
    const wider = plan(files, A4_25K, { ...DEFAULT_LAYOUT_OPTIONS, marginM: 1_200 })
    expect(jobIdOf(wider, options())).not.toBe(base)
  })

  it('ignores what does not reach the paper', () => {
    // The title is drawn but does not change a single tile or block, so it must not
    // invalidate a checkpoint the user paid megabytes for.
    expect(jobIdOf(layout, options({ title: 'Traversée' }))).toBe(jobIdOf(layout, options()))
  })
})

describe('estimate', () => {
  it('counts the tiles the pages actually cover', () => {
    const runner = new JobRunner({ fetcher: new CountingFetcher(), codec: stubCodec })
    const estimate = runner.estimate(layout, options())
    expect(estimate.pages).toBe(layout.pages.length)
    // A 5000 x 6925 m page is 9 x 12 tiles of 640 m at worst, per page, minus the overlap.
    expect(estimate.tiles).toBeGreaterThan(100 * layout.pages.length * 0.5)
    expect(estimate.approximateBytes).toBe(estimate.tiles * 145_000)
    expect(estimate.approximatePdfBytes).toBe(layout.pages.length * pageBytesAt(72))
    expect(estimate.angleDeg).toBeCloseTo(layout.angleDeg, 9)
  })

  it('charges for the overview page only when it is asked for', () => {
    const runner = new JobRunner({ fetcher: new CountingFetcher(), codec: stubCodec })
    const without = runner.estimate(layout, options())
    const withIndex = runner.estimate(layout, options({ includeIndexPage: true }))
    expect(withIndex.tiles).toBeGreaterThan(without.tiles)
    expect(withIndex.approximatePdfBytes).toBeGreaterThan(without.approximatePdfBytes)
  })
})

describe('run', () => {
  it('writes one PDF page per map page', async () => {
    const fetcher = new CountingFetcher()
    const runner = new JobRunner({ fetcher, codec: stubCodec })
    const sink = new ArrayBufferSink()
    const result = await runner.run(layout, options(), sink)

    expect(result.pages).toBe(layout.pages.length)
    expect(result.pdfPages).toBe(layout.pages.length)
    expect(result.missingTiles).toEqual([])
    expect(latin1(sink.toBytes())).toContain(`/Type /Pages /Count ${layout.pages.length}`)
    expect(operators(sink.toBytes())).toContain(`(Page 1 / ${layout.pages.length}) Tj`)
  })

  it('adds the overview page in front when asked', async () => {
    const runner = new JobRunner({ fetcher: new CountingFetcher(), codec: stubCodec })
    const sink = new ArrayBufferSink()
    const result = await runner.run(layout, options({ includeIndexPage: true }), sink)

    expect(result.pdfPages).toBe(layout.pages.length + 1)
    expect(latin1(sink.toBytes())).toContain(`/Type /Pages /Count ${layout.pages.length + 1}`)
    const ops = operators(sink.toBytes())
    expect(ops).toContain("(Plan d'ensemble) Tj")
    // Every map page is numbered on the overview.
    for (const page of layout.pages) expect(ops).toContain(`(${page.number}) Tj`)
  })

  it('reports progress once per page and finishes at the total', async () => {
    const runner = new JobRunner({ fetcher: new CountingFetcher(), codec: stubCodec })
    const seen: string[] = []
    await runner.run(layout, options(), new ArrayBufferSink(), (p) =>
      seen.push(`${p.done}/${p.total} ${p.label}`),
    )
    expect(seen).toHaveLength(layout.pages.length + 1)
    expect(seen[0]).toBe(`0/${layout.pages.length} Page 1 sur ${layout.pages.length}`)
    expect(seen.at(-1)).toBe(`${layout.pages.length}/${layout.pages.length} Terminé`)
  })

  it('renders nothing twice when a checkpoint survives', async () => {
    const store = new MemoryPageStore()
    const first = new CountingFetcher()
    await new JobRunner({ fetcher: first, codec: stubCodec, pageStore: store }).run(
      layout,
      options(),
      new ArrayBufferSink(),
    )
    expect(store.writes).toBe(layout.pages.length)
    expect(first.tilesDownloaded).toBeGreaterThan(0)

    const second = new CountingFetcher()
    const result = await new JobRunner({
      fetcher: second,
      codec: stubCodec,
      pageStore: store,
    }).run(layout, options(), new ArrayBufferSink())

    // Every page came back from the checkpoint, so not one tile was touched.
    expect(result.pagesFromCheckpoint).toBe(layout.pages.length)
    expect(second.tilesDownloaded).toBe(0)
  })

  it('re-renders when the quality changes, because the checkpoint is keyed on it', async () => {
    const store = new MemoryPageStore()
    const runner = (f: TileFetcher) =>
      new JobRunner({ fetcher: f, codec: stubCodec, pageStore: store })
    await runner(new CountingFetcher()).run(layout, options(), new ArrayBufferSink())

    const again = new CountingFetcher()
    const result = await runner(again).run(
      layout,
      options({ jpegQuality: 85 }),
      new ArrayBufferSink(),
    )
    expect(result.pagesFromCheckpoint).toBe(0)
    expect(again.tilesDownloaded).toBeGreaterThan(0)
  })
})
