import { ORIGIN_X, ORIGIN_Y, TILE_PX, resolution } from '../geo/tileGrid.js'
import type { TileId } from '../geo/tileGrid.js'
import { height, width } from '../layout/rect.js'
import type { Rect } from '../layout/rect.js'
import type { MapSource } from '../tiles/mapSource.js'
import type { TileFetcher } from '../tiles/tileFetcher.js'
import { blank } from './image.js'
import type { ImageCodec, RgbaImage } from './image.js'

/** One finished piece of a page: a JPEG plus where it belongs, in output pixels. */
export interface RenderedBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly jpeg: Uint8Array
}

export type RenderProgress = (done: number, total: number) => void

export interface MapRendererOptions {
  readonly fetcher: TileFetcher
  readonly codec: ImageCodec
  readonly source: MapSource
  readonly matrix: number
  readonly blockPx?: number
  readonly quality?: number
}

const CACHE_TILES = 64

function keyOf(tile: TileId): string {
  return `${tile.matrix}/${tile.col}/${tile.row}`
}

/**
 * Turns a rectangle of the page frame into JPEG blocks by resampling WMTS tiles.
 *
 * The page is built in square blocks rather than one big bitmap: a full 1:25000 A4 map is
 * 2000 x 2770 pixels, and rotating that in one piece would need tens of megabytes on a
 * phone. Blocks keep the working set to a couple of megabytes and let the PDF place each
 * piece at its exact position, so the seams are invisible.
 */
export class MapRenderer {
  private readonly fetcher: TileFetcher
  private readonly codec: ImageCodec
  private readonly source: MapSource
  private readonly matrix: number
  private readonly blockPx: number
  private readonly quality: number
  private readonly resolution: number
  /** Insertion order is the LRU order; a hit re-inserts to move the tile to the back. */
  private readonly cache = new Map<string, RgbaImage>()
  private readonly missing = new Map<string, TileId>()

  constructor(options: MapRendererOptions) {
    this.fetcher = options.fetcher
    this.codec = options.codec
    this.source = options.source
    this.matrix = options.matrix
    this.blockPx = options.blockPx ?? 512
    this.quality = options.quality ?? 85
    this.resolution = resolution(this.matrix)
  }

  /** Tiles that never arrived, reported so the job can warn instead of silently whiting out. */
  get missingTiles(): TileId[] {
    return [...this.missing.values()]
  }

  /**
   * @param rect the ground rectangle to draw, in the page frame.
   * @param angleRad rotation of the page frame relative to Lambert-93.
   */
  async render(
    rect: Rect,
    angleRad: number,
    widthPx: number,
    heightPx: number,
    onProgress: RenderProgress = () => {},
  ): Promise<RenderedBlock[]> {
    const cols = Math.ceil(widthPx / this.blockPx)
    const rows = Math.ceil(heightPx / this.blockPx)
    const blocks: RenderedBlock[] = []
    let done = 0
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        const x = bx * this.blockPx
        const y = by * this.blockPx
        const w = Math.min(this.blockPx, widthPx - x)
        const h = Math.min(this.blockPx, heightPx - y)
        blocks.push(await this.renderBlock(rect, angleRad, widthPx, heightPx, x, y, w, h))
        onProgress(++done, cols * rows)
      }
    }
    return blocks
  }

  private async renderBlock(
    rect: Rect,
    angleRad: number,
    widthPx: number,
    heightPx: number,
    x0: number,
    y0: number,
    w: number,
    h: number,
  ): Promise<RenderedBlock> {
    const ca = Math.cos(angleRad)
    const sa = Math.sin(angleRad)
    const stepU = width(rect) / widthPx
    const stepV = height(rect) / heightPx

    // Source pixel coordinates, in the global grid of the chosen tile matrix.
    const sourceOf = (px: number, py: number): [number, number] => {
      const u = rect.uMin + px * stepU
      const v = rect.vMax - py * stepV
      const x = u * ca + v * sa
      const y = -u * sa + v * ca
      return [(x - ORIGIN_X) / this.resolution, (ORIGIN_Y - y) / this.resolution]
    }

    let gxMin = Infinity
    let gxMax = -Infinity
    let gyMin = Infinity
    let gyMax = -Infinity
    for (const cx of [x0, x0 + w]) {
      for (const cy of [y0, y0 + h]) {
        const [gx, gy] = sourceOf(cx, cy)
        gxMin = Math.min(gxMin, gx)
        gxMax = Math.max(gxMax, gx)
        gyMin = Math.min(gyMin, gy)
        gyMax = Math.max(gyMax, gy)
      }
    }
    const mosaic = await this.mosaicFor(gxMin - 2, gyMin - 2, gxMax + 2, gyMax + 2)

    const out = blank(w, h)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const [gx, gy] = sourceOf(x0 + px + 0.5, y0 + py + 0.5)
        mosaic.sampleInto(gx, gy, out.data, (py * w + px) * 4)
      }
    }
    return { x: x0, y: y0, width: w, height: h, jpeg: await this.codec.encodeJpeg(out, this.quality) }
  }

  private async mosaicFor(
    gxMin: number,
    gyMin: number,
    gxMax: number,
    gyMax: number,
  ): Promise<Mosaic> {
    const c0 = Math.floor(gxMin / TILE_PX)
    const c1 = Math.floor(gxMax / TILE_PX)
    const r0 = Math.floor(gyMin / TILE_PX)
    const r1 = Math.floor(gyMax / TILE_PX)

    const ids: TileId[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) ids.push({ matrix: this.matrix, col: c, row: r })
    }

    const pending = ids.filter((id) => !this.cache.has(keyOf(id)))
    const loaded = await Promise.all(pending.map(async (id) => [id, await this.load(id)] as const))
    for (const [id, image] of loaded) this.put(id, image)

    const mosaicWidth = (c1 - c0 + 1) * TILE_PX
    const mosaicHeight = (r1 - r0 + 1) * TILE_PX
    const buffer = blank(mosaicWidth, mosaicHeight)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const tile = this.get({ matrix: this.matrix, col: c, row: r })
        if (tile === undefined) continue
        blit(tile, buffer, (c - c0) * TILE_PX, (r - r0) * TILE_PX)
      }
    }
    return new Mosaic(buffer, c0 * TILE_PX, r0 * TILE_PX)
  }

  private async load(id: TileId): Promise<RgbaImage> {
    try {
      return await this.codec.decode(await this.fetcher.fetch(this.source, id))
    } catch {
      this.missing.set(keyOf(id), id)
      return blank(TILE_PX, TILE_PX)
    }
  }

  private get(id: TileId): RgbaImage | undefined {
    const key = keyOf(id)
    const image = this.cache.get(key)
    if (image === undefined) return undefined
    this.cache.delete(key)
    this.cache.set(key, image)
    return image
  }

  private put(id: TileId, image: RgbaImage): void {
    const key = keyOf(id)
    this.cache.delete(key)
    this.cache.set(key, image)
    while (this.cache.size > CACHE_TILES) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) break
      this.cache.delete(oldest.value)
    }
  }
}

function blit(src: RgbaImage, dst: RgbaImage, atX: number, atY: number): void {
  const w = Math.min(src.width, dst.width - atX)
  const h = Math.min(src.height, dst.height - atY)
  for (let y = 0; y < h; y++) {
    dst.data.set(
      src.data.subarray(y * src.width * 4, (y * src.width + w) * 4),
      ((atY + y) * dst.width + atX) * 4,
    )
  }
}

/** A contiguous patch of the source grid, sampled bilinearly so rotated text stays legible. */
class Mosaic {
  constructor(
    private readonly image: RgbaImage,
    private readonly offsetX: number,
    private readonly offsetY: number,
  ) {}

  sampleInto(gx: number, gy: number, out: Uint8ClampedArray, at: number): void {
    const fx = gx - this.offsetX - 0.5
    const fy = gy - this.offsetY - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const c00 = this.offsetOf(x0, y0)
    const c10 = this.offsetOf(x0 + 1, y0)
    const c01 = this.offsetOf(x0, y0 + 1)
    const c11 = this.offsetOf(x0 + 1, y0 + 1)
    const data = this.image.data
    for (let channel = 0; channel < 3; channel++) {
      const a = c00 < 0 ? 255 : data[c00 + channel]!
      const b = c10 < 0 ? 255 : data[c10 + channel]!
      const c = c01 < 0 ? 255 : data[c01 + channel]!
      const d = c11 < 0 ? 255 : data[c11 + channel]!
      const top = a + (b - a) * tx
      const bottom = c + (d - c) * tx
      const value = Math.trunc(top + (bottom - top) * ty)
      out[at + channel] = value < 0 ? 0 : value > 255 ? 255 : value
    }
    out[at + 3] = 255
  }

  /** Byte offset of a source pixel, or -1 outside the mosaic, where the page prints white. */
  private offsetOf(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return -1
    return (y * this.image.width + x) * 4
  }
}
