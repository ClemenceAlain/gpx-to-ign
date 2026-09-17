import type { Bounds, L93 } from './lambert93.js'

/** A single WMTS tile address. */
export interface TileId {
  readonly matrix: number
  readonly col: number
  readonly row: number
}

export const TILE_PX = 256
export const ORIGIN_X = 0.0
export const ORIGIN_Y = 12_000_000.0

/** Finest level of the matrix set, and the only one we print from. */
export const NATIVE_MATRIX = 16
export const NATIVE_RESOLUTION = 2.5

/**
 * The `.L93` SCAN25 layer publishes `LAMB93_2.5m_3_16` — levels 3 to 16 and nothing else.
 * Asking for a level outside that range returns an OGC exception, not a tile.
 */
export const MIN_MATRIX = 3
export const MAX_MATRIX = 16

/**
 * The `LAMB93_2.5m` WMTS tile matrix set published by the Géoplateforme.
 *
 * Its top-left corner is (0, 12 000 000) in Lambert-93 metres and level 16 has a scale
 * denominator of 8928.5714, i.e. 8928.5714 x 0.28 mm = exactly 2.5 m per pixel — the native
 * resolution of SCAN25. Each level halves the resolution of the one below it.
 */

/** Metres per pixel at `matrix`. */
export function resolution(matrix: number): number {
  return NATIVE_RESOLUTION * 2 ** (NATIVE_MATRIX - matrix)
}

/** Ground size of one tile at `matrix`, in metres. */
export function tileSpan(matrix: number): number {
  return resolution(matrix) * TILE_PX
}

export function colOf(x: number, matrix: number): number {
  return Math.floor((x - ORIGIN_X) / tileSpan(matrix))
}

export function rowOf(y: number, matrix: number): number {
  return Math.floor((ORIGIN_Y - y) / tileSpan(matrix))
}

/** L93 position of the top-left pixel of `tile`. */
export function originOf(tile: TileId): L93 {
  const span = tileSpan(tile.matrix)
  return { x: ORIGIN_X + tile.col * span, y: ORIGIN_Y - tile.row * span }
}

/** Every tile at `matrix` whose footprint intersects `bounds`. */
export function tilesCovering(bounds: Bounds, matrix: number): TileId[] {
  const span = tileSpan(matrix)
  const c0 = Math.floor((bounds.minX - ORIGIN_X) / span)
  const c1 = Math.ceil((bounds.maxX - ORIGIN_X) / span) - 1
  const r0 = Math.floor((ORIGIN_Y - bounds.maxY) / span)
  const r1 = Math.ceil((ORIGIN_Y - bounds.minY) / span) - 1
  const out: TileId[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ matrix, col: c, row: r })
  return out
}

/** Coarsest level whose resolution is still finer than `metresPerPixel`. */
export function matrixFor(metresPerPixel: number): number {
  let m = NATIVE_MATRIX
  while (m > MIN_MATRIX && resolution(m - 1) <= metresPerPixel) m--
  return m
}

/**
 * Guard the Kotlin original lacked: an out-of-range level silently produced a blank page
 * rather than an error.
 */
export function requireValidMatrix(matrix: number): number {
  if (!Number.isInteger(matrix) || matrix < MIN_MATRIX || matrix > MAX_MATRIX) {
    throw new Error(
      `tile matrix ${matrix} is outside the published range ${MIN_MATRIX}-${MAX_MATRIX}`,
    )
  }
  return matrix
}
