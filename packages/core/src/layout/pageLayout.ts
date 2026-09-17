import type { L93 } from '../geo/lambert93.js'
import type { Rect } from './rect.js'

/** Physical page description. Defaults describe A4 printed at 1:25000. */
export interface PaperSpec {
  readonly widthMm: number
  readonly heightMm: number
  /** Unprintable safety border most consumer printers need. */
  readonly safeMarginMm: number
  /** Strip reserved at the foot of the page for scale bar, north arrow and page numbers. */
  readonly footerMm: number
  readonly scaleDenominator: number
}

/**
 * A4 at 1:25000. Every number is load-bearing: 200 x 277 mm of map at 1:25000 is exactly
 * 5000 x 6925 m of ground, which is 2000 x 2770 px at the 2.5 m native SCAN25 pixel — so a
 * printed kilometre measures exactly 40.0 mm and nothing is ever upsampled.
 */
export const A4_25K: PaperSpec = {
  widthMm: 210.0,
  heightMm: 297.0,
  safeMarginMm: 5.0,
  footerMm: 10.0,
  scaleDenominator: 25_000,
}

export function mapWidthMm(paper: PaperSpec): number {
  return paper.widthMm - 2 * paper.safeMarginMm
}

export function mapHeightMm(paper: PaperSpec): number {
  return paper.heightMm - 2 * paper.safeMarginMm - paper.footerMm
}

/** Ground width of the map area, in metres. 200 mm at 1:25000 is 5000 m. */
export function mapWidthM(paper: PaperSpec): number {
  return (mapWidthMm(paper) * paper.scaleDenominator) / 1000.0
}

export function mapHeightM(paper: PaperSpec): number {
  return (mapHeightMm(paper) * paper.scaleDenominator) / 1000.0
}

export function metresPerMm(paper: PaperSpec): number {
  return paper.scaleDenominator / 1000.0
}

export interface LayoutOptions {
  /** Minimum clearance between the trace and the printed page edge, in metres. */
  readonly marginM: number
  /** Search a rotation angle that minimises the page count instead of printing north-up. */
  readonly allowRotation: boolean
  readonly angleStepDeg: number
  /** Maximum spacing between consecutive sample points, in metres. */
  readonly densifyM: number
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  marginM: 500.0,
  allowRotation: true,
  angleStepDeg: 1.0,
  densifyM: 50.0,
}

/** Page numbers continuing off each edge, for the "suite page N" footer hints. */
export interface Neighbours {
  readonly up: readonly number[]
  readonly down: readonly number[]
  readonly left: readonly number[]
  readonly right: readonly number[]
}

export const NO_NEIGHBOURS: Neighbours = { up: [], down: [], left: [], right: [] }

/** One printable page, expressed in the job's rotated page frame. */
export interface MapPage {
  readonly number: number
  readonly rect: Rect
  readonly neighbours: Neighbours
}

/**
 * The rotation shared by every page of a booklet: the bearing, clockwise from Lambert-93
 * grid north, that page-up points to.
 *
 * Split out of `Layout` so the page furniture can be drawn — and tested — without the
 * packing algorithm existing.
 */
export interface PageFrame {
  readonly angleRad: number
  readonly angleDeg: number
  /** Lambert-93 position of a point given in the page frame. */
  toL93(u: number, v: number): L93
  /** Page-frame position of a Lambert-93 point. */
  toPage(p: L93): [number, number]
  /** Grid-north direction expressed in the page frame, as a unit vector. */
  northOnPage(): [number, number]
}

export function pageFrame(angleRad: number): PageFrame {
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  return {
    angleRad,
    angleDeg: (angleRad * 180.0) / Math.PI,
    toL93: (u, v) => ({ x: u * cosA + v * sinA, y: -u * sinA + v * cosA }),
    toPage: (p) => [p.x * cosA - p.y * sinA, p.x * sinA + p.y * cosA],
    northOnPage: () => [-sinA, cosA],
  }
}
