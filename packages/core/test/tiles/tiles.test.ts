import { describe, expect, it, vi } from 'vitest'
import { forward } from '../../src/geo/lambert93.js'
import { colOf, rowOf } from '../../src/geo/tileGrid.js'
import { PLAN_IGN, SCAN25, urlFor, sourceById } from '../../src/tiles/mapSource.js'
import { HttpTileFetcher, NoTilesFetcher, TileFetchError } from '../../src/tiles/tileFetcher.js'

const tile = { matrix: 16, col: 1565, row: 8542 }

function imageResponse(bytes: Uint8Array, status = 200): Response {
  // A detached copy: TS 5.7 made Uint8Array generic over its buffer, and BodyInit still
  // wants a plain ArrayBuffer.
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status,
    headers: { 'content-type': 'image/png' },
  })
}

describe('MapSource', () => {
  it('builds the SCAN25 GetTile URL with its key', () => {
    const url = urlFor(SCAN25, tile)
    expect(url).toContain('https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&')
    expect(url).toContain('LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93')
    expect(url).toContain('TILEMATRIXSET=LAMB93_2.5m')
    expect(url).toContain('TILEMATRIX=16&TILECOL=1565&TILEROW=8542')
  })

  it('omits the key parameter entirely when there is none', () => {
    expect(urlFor(PLAN_IGN, tile)).not.toContain('apikey')
  })

  it('carries the grid so the two sources cannot be confused', () => {
    // The Kotlin version hardcoded Lambert-93 for both, so Plan IGN fetched unrelated ground.
    expect(SCAN25.grid).toBe('lambert93')
    expect(PLAN_IGN.grid).toBe('webMercator')
    expect(SCAN25.tileMatrixSet).toBe('LAMB93_2.5m')
    expect(PLAN_IGN.tileMatrixSet).toBe('PM')
  })

  it('resolves a source by id', () => {
    expect(sourceById('scan25')).toBe(SCAN25)
    expect(sourceById('nope')).toBeUndefined()
  })

  it("addresses Col d'Entreves at the tile pinned by the Kotlin suite", () => {
    const p = forward(45.8452, 6.9051)
    expect(urlFor(SCAN25, { matrix: 16, col: colOf(p.x, 16), row: rowOf(p.y, 16) })).toContain(
      'TILECOL=1567&TILEROW=8539',
    )
  })

  it('addresses the Normandy fixture inside SCAN25 coverage', () => {
    // Start of normandie-traverse-30km.gpx; this exact tile was fetched by hand and returned
    // a 128 kB PNG, which is what proves the fixtures are printable.
    const p = forward(49.087327, 0.597975)
    expect(urlFor(SCAN25, { matrix: 16, col: colOf(p.x, 16), row: rowOf(p.y, 16) })).toContain(
      'TILECOL=819&TILEROW=7984',
    )
  })
})

describe('NoTilesFetcher', () => {
  it('throws rather than reach the network', () => {
    expect(() => new NoTilesFetcher().fetch()).toThrow(TileFetchError)
  })
})

describe('HttpTileFetcher', () => {
  it('returns the bytes and counts them', async () => {
    const payload = Uint8Array.of(1, 2, 3, 4)
    const fetchImpl = vi.fn(async () => imageResponse(payload))
    const fetcher = new HttpTileFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await fetcher.fetch(SCAN25, tile)).toEqual(payload)
    expect(fetcher.bytesDownloaded).toBe(4)
    expect(fetcher.tilesDownloaded).toBe(1)
  })

  it('retries a 429 and then succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return calls < 3
        ? new Response('slow down', { status: 429 })
        : imageResponse(Uint8Array.of(9))
    })
    const fetcher = new HttpTileFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      attempts: 4,
    })
    expect(await fetcher.fetch(SCAN25, tile)).toEqual(Uint8Array.of(9))
    expect(calls).toBe(3)
  })

  it('does not retry a 404', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return new Response('nope', { status: 404 })
    })
    const fetcher = new HttpTileFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(fetcher.fetch(SCAN25, tile)).rejects.toThrow(/HTTP 404/)
    expect(calls).toBe(1)
  })

  it('rejects the XML exception the Geoplateforme returns at 200 out of coverage', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<ExceptionReport/>', {
          status: 200,
          headers: { 'content-type': 'text/xml' },
        }),
    )
    const fetcher = new HttpTileFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(fetcher.fetch(SCAN25, tile)).rejects.toThrow(/expected an image, got text\/xml/)
  })

  it('never runs more requests at once than its concurrency allows', async () => {
    let inFlight = 0
    let peak = 0
    const fetchImpl = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return imageResponse(Uint8Array.of(1))
    })
    const fetcher = new HttpTileFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      concurrency: 3,
    })
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => fetcher.fetch(SCAN25, { matrix: 16, col: i, row: 0 })),
    )
    expect(peak).toBeLessThanOrEqual(3)
    expect(fetcher.tilesDownloaded).toBe(12)
  })

  it('serves a cached tile without touching the network', async () => {
    const store = new Map<string, Uint8Array>()
    const cache = {
      get: async (_s: unknown, t: typeof tile) => store.get(`${t.col}/${t.row}`) ?? null,
      put: async (_s: unknown, t: typeof tile, b: Uint8Array) => {
        store.set(`${t.col}/${t.row}`, b)
      },
    }
    const fetchImpl = vi.fn(async () => imageResponse(Uint8Array.of(7)))
    const fetcher = new HttpTileFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: cache as never,
    })
    await fetcher.fetch(SCAN25, tile)
    await fetcher.fetch(SCAN25, tile)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetcher.tilesFromCache).toBe(1)
  })
})
