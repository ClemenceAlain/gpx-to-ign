import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SCAN25, filled, pixelAt } from '@gpx-to-ign/core'
import { NodeImageCodec } from '../src/codec.js'
import { FileTileCache } from '../src/tileCache.js'

const root = mkdtempSync(join(tmpdir(), 'gpx-to-ign-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('NodeImageCodec', () => {
  const codec = new NodeImageCodec()

  it('round-trips a raster through JPEG', async () => {
    const source = filled(64, 64, [200, 40, 30, 255])
    const jpeg = await codec.encodeJpeg(source, 92)
    expect(jpeg.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]))

    const back = await codec.decode(jpeg)
    expect(back.width).toBe(64)
    expect(back.height).toBe(64)
    const [r, g, b, a] = pixelAt(back, 32, 32)
    // JPEG is lossy, so this asserts the colour survived, not that it is identical.
    expect(r).toBeGreaterThan(180)
    expect(g).toBeLessThan(80)
    expect(b).toBeLessThan(80)
    expect(a).toBe(255)
  })

  it('makes a smaller file at a lower quality', async () => {
    const image = filled(128, 128, [12, 190, 120, 255])
    const fine = await codec.encodeJpeg(image, 90)
    const coarse = await codec.encodeJpeg(image, 40)
    expect(coarse.length).toBeLessThan(fine.length)
  })
})

describe('FileTileCache', () => {
  const tile = { matrix: 16, col: 819, row: 7984 }

  it('stores a tile under source, level, column and row', async () => {
    const cache = new FileTileCache(root)
    expect(await cache.get(SCAN25, tile)).toBeNull()
    await cache.put(SCAN25, tile, Uint8Array.of(1, 2, 3, 4))
    expect(await cache.get(SCAN25, tile)).toEqual(Uint8Array.of(1, 2, 3, 4))
    expect(existsSync(join(root, 'scan25', '16', '819', '7984.png'))).toBe(true)
  })

  it('keeps sources apart, so one layer never serves another', async () => {
    const cache = new FileTileCache(root)
    await cache.put(SCAN25, tile, Uint8Array.of(9))
    expect(await cache.get({ ...SCAN25, id: 'planign' }, tile)).toBeNull()
  })

  it('treats an unreadable entry as a miss rather than a failure', async () => {
    const cache = new FileTileCache(root)
    const path = join(root, 'scan25', '16', '1', '2.png')
    await cache.put(SCAN25, { matrix: 16, col: 1, row: 2 }, Uint8Array.of(7))
    writeFileSync(path, '')
    // An empty file is what a run killed mid-write leaves behind; refetching is right.
    expect(await cache.get(SCAN25, { matrix: 16, col: 1, row: 2 })).toBeNull()
  })
})
