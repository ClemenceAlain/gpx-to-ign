import { urlFor, type MapSource, type TileCache, type TileId } from '@gpx-to-ign/core'

const CACHE_NAME = 'gpx-to-ign-tiles-v1'

/**
 * Tiles in the Cache API, keyed by their own request URL.
 *
 * This *is* the resume state: a job that is interrupted and replanned lands on the same
 * deterministic tile set, finds every tile it already has, and downloads only the rest.
 */
export class CacheTileStore implements TileCache {
  private opened: Promise<Cache> | null = null

  private cache(): Promise<Cache> {
    this.opened ??= caches.open(CACHE_NAME)
    return this.opened
  }

  async get(source: MapSource, tile: TileId): Promise<Uint8Array | null> {
    const hit = await (await this.cache()).match(urlFor(source, tile))
    return hit === undefined ? null : new Uint8Array(await hit.arrayBuffer())
  }

  async put(source: MapSource, tile: TileId, bytes: Uint8Array): Promise<void> {
    const body = bytes.slice().buffer as ArrayBuffer
    await (
      await this.cache()
    ).put(
      urlFor(source, tile),
      new Response(body, { headers: { 'content-type': `image/${source.format.split('/')[1]}` } }),
    )
  }

  static async clear(): Promise<void> {
    await caches.delete(CACHE_NAME)
  }
}
