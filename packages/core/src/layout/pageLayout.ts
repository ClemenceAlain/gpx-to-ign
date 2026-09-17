import { boundsOf, forwardPoint, type Bounds, type L93 } from '../geo/lambert93.js'
import type { GpxFile } from '../gpx/gpx.js'
import { Cover } from './cover.js'
import { centerU, centerV, contains, expand, union, type Rect } from './rect.js'

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

// --- the plan ----------------------------------------------------------------------

/**
 * A complete page plan.
 *
 * `angleRad` is the bearing, clockwise from Lambert-93 grid north, that page-up points to.
 * Every page shares it, so the whole booklet prints portrait with one consistent north.
 */
export class Layout implements PageFrame {
  readonly angleDeg: number
  private readonly frame: PageFrame

  constructor(
    readonly angleRad: number,
    readonly paper: PaperSpec,
    readonly marginM: number,
    readonly pages: readonly MapPage[],
    readonly trackBounds: Bounds,
    readonly samples: readonly L93[],
    /** Index of the first sample of each leg, plus a trailing entry equal to `samples.length`. */
    readonly segmentStart: Int32Array,
  ) {
    this.frame = pageFrame(angleRad)
    this.angleDeg = this.frame.angleDeg
  }

  toL93(u: number, v: number): L93 {
    return this.frame.toL93(u, v)
  }

  toPage(p: L93): [number, number] {
    return this.frame.toPage(p)
  }

  northOnPage(): [number, number] {
    return this.frame.northOnPage()
  }

  /** The samples split back into the legs they came from, so a polyline never joins two. */
  trackSegments(): L93[][] {
    const out: L93[][] = []
    for (let i = 0; i < this.segmentStart.length - 1; i++) {
      const leg = this.samples.slice(this.segmentStart[i]!, this.segmentStart[i + 1]!)
      if (leg.length > 0) out.push(leg)
    }
    return out
  }

  /** Smallest rectangle in the page frame holding every page. */
  pagesBounds(): Rect {
    return this.pages.map((p) => p.rect).reduce(union)
  }
}

const SHORTLIST = 5
const RESTARTS = 24
/** Furthest two page centres may sit apart, in page dimensions, to count as adjacent. */
const REACH = 1.15
/** Allowed drift across the announced direction, in page dimensions. */
const SIDEWAYS = 1.0
/** Below this centre offset the two pages show the same ground, so neither continues. */
const TOUCH = 0.25
const MIN_SPACING = 5.0

export function plan(
  files: readonly GpxFile[],
  paper: PaperSpec,
  options: LayoutOptions,
): Layout {
  const { samples, segmentStart } = sample(files, options.densifyM)
  if (samples.length === 0) throw new Error('no track points to lay out')

  const effectiveW = mapWidthM(paper) - 2 * options.marginM
  const effectiveH = mapHeightM(paper) - 2 * options.marginM
  if (!(effectiveW > 0 && effectiveH > 0)) {
    throw new Error(
      `a ${options.marginM.toFixed(0)} m margin leaves no room on a ` +
        `${mapWidthM(paper).toFixed(0)} x ${mapHeightM(paper).toFixed(0)} m page`,
    )
  }

  const angles: number[] = []
  if (options.allowRotation) {
    const step = Math.max(options.angleStepDeg, 0.1)
    const count = Math.ceil(180.0 / step)
    for (let i = 0; i < count; i++) angles.push((i * step * Math.PI) / 180)
  } else {
    angles.push(0)
  }

  // Pass 1: the cheap sequential cover for every angle, to shortlist the good ones.
  const scored = angles.map((a) => {
    const cover = coverFor(samples, segmentStart, a, effectiveW, effectiveH)
    return { angle: a, pages: cover.refine(cover.sequential()).length }
  })
  const bestCount = Math.min(...scored.map((s) => s.pages))
  const shortlist = scored
    .filter((s) => s.pages <= bestCount + 1)
    .sort((a, b) => a.pages - b.pages || a.angle - b.angle)
    .slice(0, SHORTLIST)

  // Pass 2: the expensive max-coverage cover, only on the shortlist.
  let angle = shortlist[0]!.angle
  let rects: Rect[] | null = null
  for (const candidate of shortlist) {
    const cover = coverFor(samples, segmentStart, candidate.angle, effectiveW, effectiveH)
    const solved = cover.solve(true)
    if (!cover.coversAll(solved)) throw new Error('internal error: page plan misses part of the track')
    if (rects === null || solved.length < rects.length) {
      angle = candidate.angle
      rects = solved
    }
  }

  // Pass 3: randomised restarts on the winning angle, in case a different tie-break
  // sheds one more page.
  if (rects!.length > 1) {
    const cover = coverFor(samples, segmentStart, angle, effectiveW, effectiveH)
    const improved = cover.solve(true, RESTARTS)
    if (improved.length < rects!.length) {
      if (!cover.coversAll(improved)) throw new Error('internal error: restart plan misses the track')
      rects = improved
    }
  }

  const ordered = order(samples, segmentStart, angle, rects!, options.marginM)
  return new Layout(
    angle,
    paper,
    options.marginM,
    withNeighbours(ordered, paper),
    boundsOf(samples),
    samples,
    segmentStart,
  )
}

/**
 * Page count for every candidate rotation, cheapest strategy only. Exposed so the CLI
 * can explain why a plan came out at the size it did.
 */
export function scoreAngles(
  files: readonly GpxFile[],
  paper: PaperSpec,
  options: LayoutOptions,
): { angleDeg: number; pages: number }[] {
  const { samples, segmentStart } = sample(files, options.densifyM)
  const w = mapWidthM(paper) - 2 * options.marginM
  const h = mapHeightM(paper) - 2 * options.marginM
  const step = Math.max(options.angleStepDeg, 0.1)
  return [...Array(Math.ceil(180.0 / step))].map((_, index) => {
    const angle = (index * step * Math.PI) / 180
    const cover = coverFor(samples, segmentStart, angle, w, h)
    return { angleDeg: (angle * 180) / Math.PI, pages: cover.solve(true, RESTARTS).length }
  })
}

function coverFor(
  samples: readonly L93[],
  segmentStart: Int32Array,
  angle: number,
  w: number,
  h: number,
): Cover {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const n = samples.length
  const u = new Float64Array(n)
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = samples[i]!
    u[i] = p.x * c - p.y * s
    v[i] = p.x * s + p.y * c
  }
  return new Cover(u, v, segmentStart, w, h)
}

/** Orders pages along the walk and grows each effective rect back to full page size. */
function order(
  samples: readonly L93[],
  _segmentStart: Int32Array,
  angle: number,
  rects: readonly Rect[],
  margin: number,
): Rect[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const firstIndex = new Array<number>(rects.length).fill(Number.MAX_SAFE_INTEGER)
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!
    const pu = p.x * c - p.y * s
    const pv = p.x * s + p.y * c
    for (let r = 0; r < rects.length; r++) {
      if (contains(rects[r]!, pu, pv) && i < firstIndex[r]!) firstIndex[r] = i
    }
  }
  return rects
    .map((_, i) => i)
    .sort((a, b) => firstIndex[a]! - firstIndex[b]! || rects[a]!.vMin - rects[b]!.vMin)
    .map((i) => expand(rects[i]!, margin))
}

/**
 * Labels each page with the pages that carry the map on, one tab per direction.
 *
 * A neighbour is placed on the single edge its centre lies closest to, so a page sitting
 * diagonally up and to the right is announced once, on the edge it mostly continues.
 */
function withNeighbours(rects: readonly Rect[], paper: PaperSpec): MapPage[] {
  const w = mapWidthM(paper)
  const h = mapHeightM(paper)
  return rects.map((r, i) => {
    const up: number[] = []
    const down: number[] = []
    const left: number[] = []
    const right: number[] = []
    for (let j = 0; j < rects.length; j++) {
      if (j === i) continue
      const du = centerU(rects[j]!) - centerU(r)
      const dv = centerV(rects[j]!) - centerV(r)
      const ru = Math.abs(du) / w
      const rv = Math.abs(dv) / h
      // So close it shows the same ground, or more than one page away.
      if (Math.max(ru, rv) < TOUCH) continue
      if (Math.max(ru, rv) > REACH || Math.min(ru, rv) > SIDEWAYS) continue
      const edge = ru >= rv ? (du > 0 ? right : left) : dv > 0 ? up : down
      edge.push(j + 1)
    }
    const ascending = (a: number, b: number): number => a - b
    return {
      number: i + 1,
      rect: r,
      neighbours: {
        up: up.sort(ascending),
        down: down.sort(ascending),
        left: left.sort(ascending),
        right: right.sort(ascending),
      },
    }
  })
}

/** Projects every file to Lambert-93 and densifies so no gap exceeds `step` metres. */
export function sample(
  files: readonly GpxFile[],
  step: number,
): { samples: L93[]; segmentStart: Int32Array } {
  const out: L93[] = []
  const starts: number[] = []
  for (const file of files) {
    for (const segment of file.segments) {
      if (segment.points.length === 0) continue
      starts.push(out.length)
      let previous: L93 | null = null
      for (const point of segment.points) {
        const p = forwardPoint(point)
        if (previous !== null) {
          const d = Math.hypot(p.x - previous.x, p.y - previous.y)
          if (d > step) {
            const n = Math.ceil(d / step)
            for (let k = 1; k < n; k++) {
              const t = k / n
              out.push({
                x: previous.x + (p.x - previous.x) * t,
                y: previous.y + (p.y - previous.y) * t,
              })
            }
          } else if (d < MIN_SPACING) {
            continue
          }
        }
        out.push(p)
        previous = p
      }
    }
  }
  starts.push(out.length)
  return { samples: out, segmentStart: Int32Array.from(starts) }
}
