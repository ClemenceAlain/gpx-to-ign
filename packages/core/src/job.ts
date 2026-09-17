import type { Bounds, L93 } from './geo/lambert93.js'
import {
  NATIVE_MATRIX,
  NATIVE_RESOLUTION,
  matrixFor,
  resolution,
  tilesCovering,
  type TileId,
} from './geo/tileGrid.js'
import {
  mapHeightM,
  mapHeightMm,
  mapWidthM,
  mapWidthMm,
  type Layout,
  type LayoutOptions,
  type MapPage,
  type PaperSpec,
} from './layout/pageLayout.js'
import type { PagePoint } from './layout/planPreview.js'
import { centerU, centerV, expand, height, rect, width, type Rect } from './layout/rect.js'
import { PageDecor, mm } from './pdf/pageDecor.js'
import { PdfDocument, type ByteSink } from './pdf/pdfDocument.js'
import type { PdfPage } from './pdf/pdfPage.js'
import type { ImageCodec } from './render/image.js'
import { MapRenderer, type RenderedBlock } from './render/mapRenderer.js'
import type { MapSource } from './tiles/mapSource.js'
import type { TileFetcher } from './tiles/tileFetcher.js'

export interface JobOptions {
  readonly paper: PaperSpec
  readonly layout: LayoutOptions
  readonly source: MapSource
  /**
   * JPEG quality for the map pages.
   *
   * SCAN25 carries continuous relief shading and about 180 000 distinct colours, so an
   * indexed palette would band it and JPEG is the right codec. Quality is then the only
   * size lever the browser exposes: `convertToBlob` gives no control over chroma
   * subsampling, and dropping the raster below its native 2.5 m per pixel blurs the map
   * text more than the bytes it saves are worth.
   */
  readonly jpegQuality: number
  /**
   * Print an overview page showing every page footprint, ahead of the map pages.
   *
   * Off by default: the app draws the same plan on screen before the job starts, which is
   * where it is actually useful, and a printed copy costs a page and a download.
   */
  readonly includeIndexPage: boolean
  /**
   * Print the GPX trace over the map pages.
   *
   * Off by default, and that default is the old invariant: the trace's job is to decide
   * where the pages go, and a magenta line over 1:25000 detail hides as much as it explains.
   * Some walks want it anyway.
   */
  readonly drawTrack: boolean
  readonly title: string | null
}

/** The overview is an index, not something to navigate by, so it is compressed harder. */
export function overviewQuality(options: JobOptions): number {
  return Math.max(options.jpegQuality - 12, 45)
}

export interface JobProgress {
  readonly done: number
  readonly total: number
  readonly label: string
}

export interface JobEstimate {
  readonly pages: number
  readonly tiles: number
  /** Bytes to pull from the Géoplateforme. */
  readonly approximateBytes: number
  /** Size of the PDF this will produce. */
  readonly approximatePdfBytes: number
  readonly angleDeg: number
}

export interface JobResult {
  /** Map pages, excluding the overview. */
  readonly pages: number
  readonly angleDeg: number
  readonly bytesDownloaded: number
  readonly missingTiles: readonly TileId[]
  /** Pages in the finished PDF, overview included. */
  readonly pdfPages: number
  /** Pages that came back from a checkpoint instead of being drawn again. */
  readonly pagesFromCheckpoint: number
}

/**
 * Durable storage for finished pages, so leaving the app costs only the time you were away.
 *
 * Tiles need no equivalent: the tile cache *is* their checkpoint, and a replanned job is
 * deterministic, so it asks for exactly the tiles it already has.
 */
export interface PageStore {
  get(jobId: string, pageIndex: number, quality: number): Promise<RenderedBlock[] | null>
  put(
    jobId: string,
    pageIndex: number,
    quality: number,
    blocks: readonly RenderedBlock[],
  ): Promise<void>
  clear(jobId?: string): Promise<void>
}

/** Mean SCAN25 PNG tile size measured over a few hundred alpine tiles. */
const AVERAGE_TILE_BYTES = 145_000

/** Width the overview raster aims for, in pixels. */
const OVERVIEW_WIDTH_PX = 1400.0

/**
 * Bytes one full A4 map page takes at a given JPEG quality.
 *
 * Re-measured on the browser's own encoder, which subsamples chroma where the Kotlin build
 * did not, so every figure is roughly half the old one. Measured on a Normandy page; dense
 * alpine terrain compresses worse, so treat this as a floor rather than a ceiling.
 */
const PAGE_BYTES_CURVE: readonly (readonly [number, number])[] = [
  [50, 745_000],
  [60, 828_000],
  [70, 944_000],
  [72, 975_000],
  [80, 1_143_000],
  [85, 1_300_000],
  [90, 1_562_000],
]

export function pageBytesAt(quality: number): number {
  const first = PAGE_BYTES_CURVE[0]!
  const last = PAGE_BYTES_CURVE.at(-1)!
  const q = Math.min(Math.max(quality, first[0]), last[0])
  const upper = PAGE_BYTES_CURVE.find((p) => p[0] >= q)!
  const lower = [...PAGE_BYTES_CURVE].reverse().find((p) => p[0] <= q)!
  if (upper[0] === lower[0]) return upper[1]
  const t = (q - lower[0]) / (upper[0] - lower[0])
  return Math.round(lower[1] + (upper[1] - lower[1]) * t)
}

/**
 * Identity of a job, for resuming one.
 *
 * It hashes everything that decides which bytes end up on paper — the page rectangles, the
 * rotation, the source and its key, the quality, the overview flag — and nothing else. The
 * title is drawn on the page but changes no tile and no block, so changing it must not
 * throw away a checkpoint the user paid megabytes for.
 */
export function jobIdOf(layout: Layout, options: JobOptions): string {
  const parts = [
    layout.angleRad.toFixed(9),
    options.source.id,
    options.source.endpoint,
    options.source.layer,
    options.source.apiKey ?? '',
    String(options.jpegQuality),
    String(options.includeIndexPage),
    String(options.drawTrack),
    options.paper.widthMm,
    options.paper.heightMm,
    options.paper.safeMarginMm,
    options.paper.footerMm,
    options.paper.scaleDenominator,
    ...layout.pages.map(
      (p) =>
        `${p.rect.uMin.toFixed(3)},${p.rect.vMin.toFixed(3)},` +
        `${p.rect.uMax.toFixed(3)},${p.rect.vMax.toFixed(3)}`,
    ),
  ]
  return fnv1a128(parts.join('|'))
}

/** FNV-1a widened to 128 bits by hashing twice with different offsets. Not a MAC; an id. */
function fnv1a128(value: string): string {
  const one = fnv1a32(value, 0x811c9dc5)
  const two = fnv1a32(value, 0x01000193)
  const three = fnv1a32(`${value}#`, 0x811c9dc5)
  const four = fnv1a32(`#${value}`, 0x01000193)
  return [one, two, three, four].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
}

function fnv1a32(value: string, offset: number): number {
  let hash = offset | 0
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

export interface JobRunnerOptions {
  readonly fetcher: TileFetcher
  readonly codec: ImageCodec
  readonly pageStore?: PageStore
}

/** Turns a page plan into one printable multi-page A4 PDF. */
export class JobRunner {
  private readonly fetcher: TileFetcher
  private readonly codec: ImageCodec
  private readonly pageStore: PageStore | undefined

  constructor(options: JobRunnerOptions) {
    this.fetcher = options.fetcher
    this.codec = options.codec
    this.pageStore = options.pageStore
  }

  /** Rough download size, shown before a job starts so a big trace is not a surprise. */
  estimate(layout: Layout, options: JobOptions): JobEstimate {
    const tiles = new Set<string>()
    for (const page of layout.pages) {
      for (const t of tilesCovering(groundBounds(layout, page.rect), NATIVE_MATRIX)) {
        tiles.add(`${t.matrix}/${t.col}/${t.row}`)
      }
    }
    if (options.includeIndexPage) {
      const { frame, matrix } = overviewFrame(layout, options.paper)
      for (const t of tilesCovering(groundBounds(layout, frame), matrix)) {
        tiles.add(`${t.matrix}/${t.col}/${t.row}`)
      }
    }
    const perPage = pageBytesAt(options.jpegQuality)
    const overview = options.includeIndexPage ? pageBytesAt(overviewQuality(options)) : 0
    return {
      pages: layout.pages.length,
      tiles: tiles.size,
      approximateBytes: tiles.size * AVERAGE_TILE_BYTES,
      approximatePdfBytes: layout.pages.length * perPage + overview,
      angleDeg: layout.angleDeg,
    }
  }

  async run(
    layout: Layout,
    options: JobOptions,
    out: ByteSink,
    onProgress: (progress: JobProgress) => void = () => {},
  ): Promise<JobResult> {
    const renderer = new MapRenderer({
      fetcher: this.fetcher,
      codec: this.codec,
      source: options.source,
      matrix: NATIVE_MATRIX,
      quality: options.jpegQuality,
    })
    const paper = options.paper
    const total = layout.pages.length + (options.includeIndexPage ? 1 : 0)
    const jobId = jobIdOf(layout, options)
    let done = 0
    let fromCheckpoint = 0

    const document = new PdfDocument(out, mm(paper.widthMm), mm(paper.heightMm))
    if (options.includeIndexPage) {
      onProgress({ done, total, label: "Assemblage du plan d'ensemble" })
      await this.indexPage(document, layout, options, jobId)
      done++
    }
    for (const page of layout.pages) {
      onProgress({
        done,
        total,
        label: `Page ${page.number} sur ${layout.pages.length}`,
      })
      if (await this.mapPage(document, layout, page, options, renderer, jobId)) fromCheckpoint++
      done++
    }
    document.finish()
    onProgress({ done: total, total, label: 'Terminé' })

    return {
      pages: layout.pages.length,
      angleDeg: layout.angleDeg,
      bytesDownloaded: this.fetcher.bytesDownloaded,
      missingTiles: renderer.missingTiles,
      pdfPages: total,
      pagesFromCheckpoint: fromCheckpoint,
    }
  }

  /** @returns whether the page came back from a checkpoint rather than being drawn. */
  private async mapPage(
    document: PdfDocument,
    layout: Layout,
    page: MapPage,
    options: JobOptions,
    renderer: MapRenderer,
    jobId: string,
  ): Promise<boolean> {
    const paper = options.paper
    const widthPx = Math.round(mapWidthM(paper) / NATIVE_RESOLUTION)
    const heightPx = Math.round(mapHeightM(paper) / NATIVE_RESOLUTION)

    const saved = await this.pageStore?.get(jobId, page.number, options.jpegQuality)
    const blocks = saved ?? (await renderer.render(page.rect, layout.angleRad, widthPx, heightPx))
    if (saved === null || saved === undefined) {
      await this.pageStore?.put(jobId, page.number, options.jpegQuality, blocks)
    }

    document.addPage((canvas) => {
      placeBlocks(canvas, blocks, paper, widthPx, heightPx)
      new PageDecor({
        frame: layout,
        paper,
        attribution: options.source.attribution,
        title: options.title,
        track: options.drawTrack ? trackOnPage(layout) : null,
      }).draw(canvas, page, layout.pages.length)
    })
    return saved !== null && saved !== undefined
  }

  private async indexPage(
    document: PdfDocument,
    layout: Layout,
    options: JobOptions,
    jobId: string,
  ): Promise<void> {
    const paper = options.paper
    const { frame, matrix } = overviewFrame(layout, paper)
    const quality = overviewQuality(options)
    const widthPx = Math.min(Math.max(Math.round(width(frame) / resolution(matrix)), 256), 3000)
    const heightPx = Math.max(Math.round((widthPx * height(frame)) / width(frame)), 256)

    // Page 0 in the checkpoint: the overview is as expensive to redraw as a map page.
    const saved = await this.pageStore?.get(jobId, 0, quality)
    const blocks =
      saved ??
      (await new MapRenderer({
        fetcher: this.fetcher,
        codec: this.codec,
        source: options.source,
        matrix,
        quality,
      }).render(frame, layout.angleRad, widthPx, heightPx))
    if (saved === null || saved === undefined) await this.pageStore?.put(jobId, 0, quality, blocks)

    document.addPage((canvas) => {
      placeBlocks(canvas, blocks, paper, widthPx, heightPx)

      const mapX = mm(paper.safeMarginMm)
      const mapY = mm(paper.safeMarginMm + paper.footerMm)
      const mapW = mm(mapWidthMm(paper))
      const mapH = mm(mapHeightMm(paper))
      const scaleX = mapW / width(frame)
      const scaleY = mapH / height(frame)

      for (const page of layout.pages) {
        const x = mapX + (page.rect.uMin - frame.uMin) * scaleX
        const y = mapY + (page.rect.vMin - frame.vMin) * scaleY
        const w = width(page.rect) * scaleX
        const h = height(page.rect) * scaleY
        // A white halo under the outline, so it reads over dark forest and rock too.
        canvas.setStroke(1.0, 1.0, 1.0)
        canvas.setLineWidth(3.5)
        canvas.strokeRect(x, y, w, h)
        canvas.setStroke(0.85, 0.1, 0.1)
        canvas.setLineWidth(1.6)
        canvas.strokeRect(x, y, w, h)
        const cx = x + w / 2
        const cy = y + h / 2
        canvas.setFill(1.0, 1.0, 1.0)
        canvas.fillRect(cx - mm(4.0), cy - mm(3.0), mm(8.0), mm(6.0))
        canvas.strokeRect(cx - mm(4.0), cy - mm(3.0), mm(8.0), mm(6.0))
        canvas.setFill(0.85, 0.1, 0.1)
        canvas.textCentered(cx, cy - mm(1.8), 12.0, String(page.number), true)
      }
      canvas.setStroke(0.0, 0.0, 0.0)
      canvas.setLineWidth(0.6)
      canvas.strokeRect(mapX, mapY, mapW, mapH)

      canvas.setFill(0.0, 0.0, 0.0)
      const baseline = mm(paper.safeMarginMm + 2.5)
      canvas.text(mapX, baseline + mm(4.0), 10.0, "Plan d'ensemble", true)
      if (options.title !== null) {
        canvas.text(
          mapX + canvas.textWidth("Plan d'ensemble  ", 10.0, true),
          baseline + mm(4.0),
          9.0,
          options.title,
        )
      }
      const rotation = Math.round((360.0 - layout.angleDeg) % 360.0)
      canvas.textRight(
        mapX + mapW,
        baseline + mm(4.0),
        7.5,
        `${layout.pages.length} page${layout.pages.length > 1 ? 's' : ''} A4 à ` +
          `1:${paper.scaleDenominator} · rotation ${rotation}° · ${options.source.attribution}`,
      )
    })
  }
}

/** Every leg in the page frame, which is the only frame `PageDecor` knows about. */
function trackOnPage(layout: Layout): PagePoint[][] {
  return layout.trackSegments().map((leg) =>
    leg.map((p) => {
      const [u, v] = layout.toPage(p)
      return { u, v }
    }),
  )
}

function placeBlocks(
  canvas: PdfPage,
  blocks: readonly RenderedBlock[],
  paper: PaperSpec,
  widthPx: number,
  heightPx: number,
): void {
  const mapX = mm(paper.safeMarginMm)
  const mapY = mm(paper.safeMarginMm + paper.footerMm)
  const ptPerPxX = mm(mapWidthMm(paper)) / widthPx
  const ptPerPxY = mm(mapHeightMm(paper)) / heightPx
  for (const block of blocks) {
    canvas.drawJpeg(
      block.jpeg,
      block.width,
      block.height,
      mapX + block.x * ptPerPxX,
      // PDF y grows upwards; block y grows down from the top of the map area.
      mapY + (heightPx - block.y - block.height) * ptPerPxY,
      block.width * ptPerPxX,
      block.height * ptPerPxY,
    )
  }
}

/**
 * Ground rectangle and tile matrix for the overview page.
 *
 * It deliberately aims at `OVERVIEW_WIDTH_PX` rather than the 2000 pixels a printed page
 * could hold: an index only has to be readable, and one level coarser is four times fewer
 * tiles to download.
 */
function overviewFrame(layout: Layout, paper: PaperSpec): { frame: Rect; matrix: number } {
  const block = layout.pagesBounds()
  const framed = fitToPage(expand(block, width(block) * 0.04), paper)
  return { frame: framed, matrix: matrixFor(width(framed) / OVERVIEW_WIDTH_PX) }
}

/** Grows a rectangle until it matches the printable area's aspect ratio. */
function fitToPage(r: Rect, paper: PaperSpec): Rect {
  const target = mapWidthM(paper) / mapHeightM(paper)
  if (width(r) / height(r) > target) {
    const h = width(r) / target
    return rect(r.uMin, centerV(r) - h / 2, r.uMax, centerV(r) + h / 2)
  }
  const w = height(r) * target
  return rect(centerU(r) - w / 2, r.vMin, centerU(r) + w / 2, r.vMax)
}

function groundBounds(layout: Layout, r: Rect): Bounds {
  const corners: L93[] = [
    layout.toL93(r.uMin, r.vMin),
    layout.toL93(r.uMax, r.vMin),
    layout.toL93(r.uMin, r.vMax),
    layout.toL93(r.uMax, r.vMax),
  ]
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}
