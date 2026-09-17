import type { L93 } from '../geo/lambert93.js'
import type { Layout, MapPage } from './pageLayout.js'
import { expand, height, width, type Rect } from './rect.js'

/** A point in the page frame: metres on the ground, page-up positive. */
export interface PagePoint {
  readonly u: number
  readonly v: number
}

/**
 * The page plan as something a screen can draw: the page footprints and the trace, both in
 * the page frame, inside a rectangle with a little air around the pages.
 *
 * This is what the user validates, in place of an overview page in the PDF. Building it
 * never touches the network — the plan is already solved offline — so it can follow the
 * margin slider live, which a rendered map page never could. That also means there is no
 * map under it: it shows where the pages fall, not what is on them.
 */
export interface PlanPreview {
  /** Everything worth drawing, in the page frame. */
  readonly bounds: Rect
  readonly pages: readonly MapPage[]
  /** One polyline per track leg, thinned to what the pixel budget can show. */
  readonly tracks: readonly (readonly PagePoint[])[]
  readonly angleDeg: number
  /** Grid north expressed in the page frame, as a unit vector. */
  readonly north: PagePoint
}

/** Air left around the block of pages, as a fraction of its longer side. */
const AIR = 0.04

/**
 * @param widthPx roughly how many pixels wide the preview will be drawn. It only decides
 *   how hard the trace is thinned: two samples landing inside the same pixel cannot both
 *   show, so only the first is kept.
 */
export function planPreview(layout: Layout, widthPx = 720): PlanPreview {
  const block = layout.pagesBounds()
  const bounds = expand(block, Math.max(width(block), height(block)) * AIR)
  const tolerance = width(bounds) / Math.max(widthPx, 1)
  const [nu, nv] = layout.northOnPage()
  return {
    bounds,
    pages: layout.pages,
    tracks: layout.trackSegments().map((leg) => thin(leg, layout, tolerance)),
    angleDeg: layout.angleDeg,
    north: { u: nu, v: nv },
  }
}

function thin(leg: readonly L93[], layout: Layout, tolerance: number): PagePoint[] {
  const out: PagePoint[] = []
  for (let i = 0; i < leg.length; i++) {
    const [u, v] = layout.toPage(leg[i]!)
    const last = out.at(-1)
    const moved =
      last === undefined || Math.abs(u - last.u) > tolerance || Math.abs(v - last.v) > tolerance
    if (moved) out.push({ u, v })
    // The last point always goes in, so a leg never stops short of where it ends.
    else if (i === leg.length - 1 && out.length > 1) out[out.length - 1] = { u, v }
  }
  return out
}
