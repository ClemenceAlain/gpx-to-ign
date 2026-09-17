import type {
  Bounds,
  GpxFile,
  JobEstimate,
  L93,
  MapPage,
  MapSource,
  PlanPreview,
} from '@gpx-to-ign/core'

/**
 * What crosses the worker boundary.
 *
 * `Layout` is a class, so it cannot be structured-cloned. Its state is all plain data
 * though, so the worker ships the fields and the main thread rebuilds the object — which is
 * exact, and cheaper than re-planning on the main thread would ever be.
 */
export interface PlanRequest {
  readonly id: number
  readonly files: readonly GpxFile[]
  readonly marginM: number
  readonly allowRotation: boolean
  readonly source: MapSource
  readonly jpegQuality: number
  readonly includeIndexPage: boolean
}

export interface PlainLayout {
  readonly angleRad: number
  readonly marginM: number
  readonly pages: readonly MapPage[]
  readonly trackBounds: Bounds
  readonly samples: readonly L93[]
  readonly segmentStart: Int32Array
}

export type PlanResponse =
  | {
      readonly id: number
      readonly ok: true
      readonly layout: PlainLayout
      readonly estimate: JobEstimate
      readonly preview: PlanPreview
    }
  | { readonly id: number; readonly ok: false; readonly message: string }
