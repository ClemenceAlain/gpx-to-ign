import { describe, expect, it } from 'vitest'
import { forward } from '../../src/geo/lambert93.js'
import { NATIVE_MATRIX, ORIGIN_Y, TILE_PX, colOf, rowOf } from '../../src/geo/tileGrid.js'
import type { TileId } from '../../src/geo/tileGrid.js'
import { rect } from '../../src/layout/rect.js'
import type { Rect } from '../../src/layout/rect.js'
import { MapRenderer } from '../../src/render/mapRenderer.js'
import { WHITE, filled, pixelAt } from '../../src/render/image.js'
import type { ImageCodec, RgbaImage } from '../../src/render/image.js'
import { SCAN25 } from '../../src/tiles/mapSource.js'
import type { TileFetcher } from '../../src/tiles/tileFetcher.js'

/** Codec that round-trips the raster verbatim, so tests measure geometry, not JPEG loss. */
const rawCodec: ImageCodec = {
  async decode(bytes: Uint8Array): Promise<RgbaImage> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(0)
    const height = view.getUint32(4)
    return { width, height, data: new Uint8ClampedArray(bytes.slice(8)) }
  },
  async encodeJpeg(image: RgbaImage): Promise<Uint8Array> {
    const out = new Uint8Array(8 + image.data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, image.width)
    view.setUint32(4, image.height)
    out.set(image.data, 8)
    return out
  },
}

/** Paints each tile a colour derived from its address, so a pixel names its source tile. */
class SyntheticTiles implements TileFetcher {
  readonly requested = new Set<string>()
  bytesDownloaded = 0
  tilesDownloaded = 0
  tilesFromCache = 0

  async fetch(_source: unknown, tile: TileId): Promise<Uint8Array> {
    this.requested.add(`${tile.matrix}/${tile.col}/${tile.row}`)
    return rawCodec.encodeJpeg(filled(TILE_PX, TILE_PX, colourOf(tile)), 100)
  }
}

const offline: TileFetcher = {
  bytesDownloaded: 0,
  tilesDownloaded: 0,
  tilesFromCache: 0,
  fetch(): Promise<Uint8Array> {
    throw new Error('offline')
  },
}

function colourOf(tile: TileId): [number, number, number, number] {
  return [tile.col & 0xff, tile.row & 0xff, 0, 255]
}

/** Page-frame (u, v) back to Lambert-93, the inverse of the renderer's own rotation. */
function toL93(u: number, v: number, angle: number): { x: number; y: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: u * c + v * s, y: -u * s + v * c }
}

async function decodeBlockAt(
  blocks: readonly { x: number; y: number; width: number; height: number; jpeg: Uint8Array }[],
  px: number,
  py: number,
): Promise<{ image: RgbaImage; x: number; y: number }> {
  const block = blocks.find(
    (b) => b.x <= px && px < b.x + b.width && b.y <= py && py < b.y + b.height,
  )
  expect(block, `no block covers ${px},${py}`).toBeDefined()
  return { image: await rawCodec.decode(block!.jpeg), x: block!.x, y: block!.y }
}

function renderer(fetcher: TileFetcher, blockPx: number): MapRenderer {
  return new MapRenderer({
    fetcher,
    codec: rawCodec,
    source: SCAN25,
    matrix: NATIVE_MATRIX,
    blockPx,
  })
}

describe('MapRenderer', () => {
  it('samples the tiles under an unrotated page', async () => {
    const tiles = new SyntheticTiles()
    const r = renderer(tiles, 256)
    // Exactly one tile's worth of ground, aligned to the grid.
    const x0 = 1000 * 640
    const y0 = ORIGIN_Y - 8000 * 640
    const blocks = await r.render(rect(x0, y0 - 640, x0 + 640, y0), 0, 256, 256)

    expect(blocks).toHaveLength(1)
    const image = await rawCodec.decode(blocks[0]!.jpeg)
    const expected = colourOf({ matrix: NATIVE_MATRIX, col: 1000, row: 8000 })
    expect(pixelAt(image, 128, 128)).toEqual(expected)
    expect(pixelAt(image, 5, 5)).toEqual(expected)
    expect(r.missingTiles).toHaveLength(0)
  })

  it('lands a rotated page on the right ground', async () => {
    const r = renderer(new SyntheticTiles(), 128)
    const angle = (30 * Math.PI) / 180
    const page: Rect = rect(500_000, 6_500_000, 500_640, 6_500_640)
    const blocks = await r.render(page, angle, 256, 256)

    const centre = toL93((page.uMin + page.uMax) / 2, (page.vMin + page.vMax) / 2, angle)
    const expected = colourOf({
      matrix: NATIVE_MATRIX,
      col: colOf(centre.x, NATIVE_MATRIX),
      row: rowOf(centre.y, NATIVE_MATRIX),
    })
    const { image, x, y } = await decodeBlockAt(blocks, 128, 128)
    expect(pixelAt(image, 128 - x, 128 - y)).toEqual(expected)
  })

  it('fetches a tile once however many blocks share it', async () => {
    const tiles = new SyntheticTiles()
    const r = renderer(tiles, 64)
    await r.render(rect(500_000, 6_500_000, 500_320, 6_500_320), 0, 128, 128)
    // 320 m spans at most two tiles each way, however many 64-pixel blocks touch them.
    expect(tiles.requested.size).toBeLessThanOrEqual(4)
  })

  it('reports a tile that never arrives and prints it white', async () => {
    const r = renderer(offline, 64)
    const blocks = await r.render(rect(500_000, 6_500_000, 500_160, 6_500_160), 0, 64, 64)
    const image = await rawCodec.decode(blocks[0]!.jpeg)
    expect(pixelAt(image, 32, 32)).toEqual(WHITE)
    expect(r.missingTiles.length).toBeGreaterThan(0)
  })

  it('reports progress once per block', async () => {
    const r = renderer(new SyntheticTiles(), 64)
    const seen: [number, number][] = []
    await r.render(rect(500_000, 6_500_000, 500_320, 6_500_320), 0, 128, 128, (done, total) =>
      seen.push([done, total]),
    )
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it('covers the Normandy fixture ground with real tile addresses', async () => {
    const tiles = new SyntheticTiles()
    const r = renderer(tiles, 512)
    const centre = forward(49.18, 0.82)
    await r.render(
      rect(centre.x - 2500, centre.y - 2500, centre.x + 2500, centre.y + 2500),
      0,
      512,
      512,
    )
    expect(tiles.requested.size).toBeGreaterThan(0)
    for (const key of tiles.requested) expect(key.startsWith(`${NATIVE_MATRIX}/`)).toBe(true)
  })
})
