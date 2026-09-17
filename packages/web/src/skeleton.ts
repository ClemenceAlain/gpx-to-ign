import {
  A4_25K,
  ArrayBufferSink,
  HttpTileFetcher,
  MapRenderer,
  NATIVE_MATRIX,
  NATIVE_RESOLUTION,
  NO_NEIGHBOURS,
  PageDecor,
  SCAN25,
  boundsOf,
  centeredOn,
  forwardPoint,
  mapHeightM,
  mapHeightMm,
  mapWidthM,
  mapWidthMm,
  mm,
  pageFrame,
  parseGpx,
  writePdf,
  type MapPage,
  type MapSource,
  type TileCache,
} from '@gpx-to-ign/core'
import { BrowserImageCodec } from './platform/browserImageCodec.js'

/**
 * The walking skeleton: one north-up A4 page, centred on a trace, drawn from real SCAN25
 * tiles and written to a real PDF.
 *
 * It exists to prove the whole chain in a real browser before the packing algorithm is
 * ported, and to give the ruler test something to print. It is deliberately not the app:
 * there is no page packing, no rotation search and no progress UI.
 */

/** 2000 x 2770 px: the map area at the native 2.5 m pixel, with nothing upsampled. */
export const PAGE_WIDTH_PX = Math.round(mapWidthM(A4_25K) / NATIVE_RESOLUTION)
export const PAGE_HEIGHT_PX = Math.round(mapHeightM(A4_25K) / NATIVE_RESOLUTION)

export interface SkeletonOptions {
  readonly source?: MapSource
  readonly apiKey?: string
  readonly quality?: number
  readonly cache?: TileCache
  readonly onProgress?: (done: number, total: number) => void
}

export interface SkeletonResult {
  readonly pdf: Uint8Array
  readonly missingTiles: number
  readonly tilesDownloaded: number
  readonly tilesFromCache: number
  readonly bytesDownloaded: number
}

/** The single page this skeleton prints: A4 of ground, centred on the trace. */
export function singlePage(gpxText: string, name = 'trace.gpx'): MapPage {
  const file = parseGpx(name, gpxText)
  const points = file.segments.flatMap((s) => s.points.map(forwardPoint))
  if (points.length === 0) throw new Error('aucun point dans la trace')
  const bounds = boundsOf(points)
  return {
    number: 1,
    // North-up, so the page frame is Lambert-93 itself and no rotation is involved.
    rect: centeredOn(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      mapWidthM(A4_25K),
      mapHeightM(A4_25K),
    ),
    neighbours: NO_NEIGHBOURS,
  }
}

export async function renderSinglePagePdf(
  gpxText: string,
  options: SkeletonOptions = {},
): Promise<SkeletonResult> {
  const base = options.source ?? SCAN25
  const source: MapSource =
    options.apiKey === undefined ? base : { ...base, apiKey: options.apiKey }
  const page = singlePage(gpxText)

  const fetcher = new HttpTileFetcher(options.cache === undefined ? {} : { cache: options.cache })
  const renderer = new MapRenderer({
    fetcher,
    codec: new BrowserImageCodec(),
    source,
    matrix: NATIVE_MATRIX,
    quality: options.quality ?? 72,
  })

  const blocks = await renderer.render(
    page.rect,
    0,
    PAGE_WIDTH_PX,
    PAGE_HEIGHT_PX,
    options.onProgress,
  )

  const sink = new ArrayBufferSink()
  const decor = new PageDecor({
    frame: pageFrame(0),
    paper: A4_25K,
    attribution: source.attribution,
    title: null,
  })
  writePdf(sink, mm(A4_25K.widthMm), mm(A4_25K.heightMm), (document) => {
    document.addPage((canvas) => {
      const mapX = mm(A4_25K.safeMarginMm)
      const mapY = mm(A4_25K.safeMarginMm + A4_25K.footerMm)
      const scale = mm(mapWidthMm(A4_25K)) / PAGE_WIDTH_PX
      for (const block of blocks) {
        canvas.drawJpeg(
          block.jpeg,
          block.width,
          block.height,
          mapX + block.x * scale,
          // PDF y grows upwards; block y grows down from the top of the map area.
          mapY + mm(mapHeightMm(A4_25K)) - (block.y + block.height) * scale,
          block.width * scale,
          block.height * scale,
        )
      }
      decor.draw(canvas, page, 1)
    })
  })

  return {
    pdf: sink.toBytes(),
    missingTiles: renderer.missingTiles.length,
    tilesDownloaded: fetcher.tilesDownloaded,
    tilesFromCache: fetcher.tilesFromCache,
    bytesDownloaded: fetcher.bytesDownloaded,
  }
}
