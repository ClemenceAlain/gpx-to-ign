import type { JobOptions, TileId } from '@gpx-to-ign/core'
import type { PlainLayout } from './planProtocol.js'

export interface JobRequest {
  readonly layout: PlainLayout
  readonly options: JobOptions
}

export type JobMessage =
  | {
      readonly kind: 'progress'
      readonly done: number
      readonly total: number
      readonly label: string
    }
  | {
      readonly kind: 'done'
      readonly pdf: Uint8Array
      readonly pages: number
      readonly bytesDownloaded: number
      readonly missingTiles: readonly TileId[]
      readonly pagesFromCheckpoint: number
    }
  | { readonly kind: 'error'; readonly message: string }
