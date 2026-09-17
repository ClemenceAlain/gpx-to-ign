import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileExtension, type MapSource, type TileCache, type TileId } from '@gpx-to-ign/core'

/**
 * Tiles on disk at `{root}/{source}/{z}/{col}/{row}.{ext}`.
 *
 * The same layout the Kotlin CLI used, so a cache primed by either implementation serves
 * both — which is what makes differential runs cost one download instead of two.
 */
export class FileTileCache implements TileCache {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private path(source: MapSource, tile: TileId): string {
    return join(
      this.root,
      source.id,
      String(tile.matrix),
      String(tile.col),
      `${tile.row}.${fileExtension(source)}`,
    )
  }

  async get(source: MapSource, tile: TileId): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(this.path(source, tile))
      // A zero-length file is what a run killed mid-write leaves behind. Refetch it.
      return bytes.length === 0 ? null : new Uint8Array(bytes)
    } catch {
      return null
    }
  }

  async put(source: MapSource, tile: TileId, bytes: Uint8Array): Promise<void> {
    const path = this.path(source, tile)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }
}
