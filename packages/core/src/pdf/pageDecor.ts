import { intersectsBox, smoothCurves, type Pt } from './geometry.js'
import type { PdfPage } from './pdfPage.js'
import type { PagePoint } from '../layout/planPreview.js'
import {
  mapHeightMm,
  mapWidthMm,
  type MapPage,
  type PageFrame,
  type PaperSpec,
} from '../layout/pageLayout.js'
/** Millimetres to PostScript points. */
export function mm(value: number): number {
  return (value * 72.0) / 25.4
}

export interface PageDecorOptions {
  readonly frame: PageFrame
  readonly paper: PaperSpec
  readonly attribution: string
  readonly title: string | null
  /**
   * The walk, one polyline per leg, in page-frame metres. Null or empty draws nothing,
   * which is the default and what every page looked like before this was an option.
   */
  readonly track?: readonly (readonly PagePoint[])[] | null
}

/**
 * Violet.
 *
 * SCAN25 spends red and orange on roads, blue on water, green on woodland, brown on relief —
 * and **magenta on GR waymarking**, which is exactly the kind of path a walker's GPX follows.
 * Violet is the nearest hue that is legible on all of those and confusable with none, and the
 * white halo under it settles the rest.
 */
export const TRACK_RGB: readonly [number, number, number] = [0.35, 0.0, 0.75]

const TRACK_WIDTH_PT = 1.4
const TRACK_HALO_PT = 3.2

/**
 * Both passes are translucent, so the SCAN25 path under the trace stays readable.
 *
 * The halo is the weaker of the two on purpose: opaque white it erased the very footpath
 * the walker is following, which is the one thing the trace is meant to point at. At these
 * values the violet still separates from woodland and hillshade, and the dashes of a
 * footpath count through it.
 */
export const TRACK_ALPHA = 0.5
export const TRACK_HALO_ALPHA = 0.25

/**
 * Everything printed on top of the map: a north arrow that accounts for the page rotation,
 * the scale bar, the page number and the neighbour hints.
 *
 * The Lambert-93 kilometre grid used to be drawn here too. It was removed on request: it
 * put a blue lattice over every square centimetre of an already dense map. The scale bar is
 * still an exact kilometre, so it remains the ruler test's measuring device.
 *
 * The GPX trace is drawn only when a `track` is passed. It defaults to off: the trace's job
 * is to decide where the pages go, and a printed line over 1:25000 detail hides as much as
 * it explains. Asked for on 2026-09-17.
 */
export class PageDecor {
  private readonly frame: PageFrame
  private readonly paper: PaperSpec
  private readonly attribution: string
  private readonly title: string | null
  private readonly track: readonly (readonly PagePoint[])[]

  private readonly mapX: number
  private readonly mapY: number
  private readonly mapW: number
  private readonly mapH: number
  /** Ground metres per PostScript point at the printing scale. */
  private readonly metresPerPt: number

  constructor(options: PageDecorOptions) {
    this.frame = options.frame
    this.paper = options.paper
    this.attribution = options.attribution
    this.title = options.title
    this.track = options.track ?? []

    this.mapX = mm(this.paper.safeMarginMm)
    this.mapY = mm(this.paper.safeMarginMm + this.paper.footerMm)
    this.mapW = mm(mapWidthMm(this.paper))
    this.mapH = mm(mapHeightMm(this.paper))
    this.metresPerPt = (this.paper.scaleDenominator * 25.4) / 72.0 / 1000.0
  }

  draw(canvas: PdfPage, page: MapPage, total: number): void {
    this.drawTrack(canvas, page)
    canvas.setStroke(0.0, 0.0, 0.0)
    canvas.setLineWidth(0.6)
    canvas.strokeRect(this.mapX, this.mapY, this.mapW, this.mapH)

    this.drawFooter(canvas, page, total)
  }

  // --- the walk ----------------------------------------------------------------------

  /**
   * The trace: one smooth translucent polyline per leg, clipped to the map area.
   *
   * Three things it is not. It is not a chain of straight segments — a centripetal
   * Catmull-Rom spline runs through the GPX points so the printed line has no kink at each
   * fix. It is not opaque — both passes are translucent so the path on the map underneath
   * still reads. And it is not clipped by hand any more — the clip is a PDF path, which is
   * what lets a curve cross the page edge without being cut into segments first.
   *
   * Still drawn twice: a white halo, then the line. One pass over dark forest or a
   * hillshaded slope disappears into it.
   */
  private drawTrack(canvas: PdfPage, page: MapPage): void {
    if (this.track.length === 0) return
    const rect = page.rect
    const toPt = (p: PagePoint): Pt => [
      this.mapX + (p.u - rect.uMin) / this.metresPerPt,
      this.mapY + (p.v - rect.vMin) / this.metresPerPt,
    ]

    const visible = this.track
      .map((leg) => leg.map(toPt))
      .filter(
        (leg) =>
          leg.length >= 2 &&
          // The clip would hide it anyway, but a leg on another page must leave the content
          // stream byte for byte as it was, or "no track" and "a track off this page" would
          // produce different files.
          intersectsBox(leg, this.mapX, this.mapY, this.mapX + this.mapW, this.mapY + this.mapH),
      )
    if (visible.length === 0) return

    canvas.save()
    canvas.clipRect(this.mapX, this.mapY, this.mapW, this.mapH)
    canvas.setRoundJoins()
    for (const [colour, width, alpha] of [
      [[1.0, 1.0, 1.0] as const, TRACK_HALO_PT, TRACK_HALO_ALPHA],
      [TRACK_RGB, TRACK_WIDTH_PT, TRACK_ALPHA],
    ] as const) {
      canvas.setStroke(colour[0], colour[1], colour[2])
      canvas.setLineWidth(width)
      canvas.setAlpha(alpha)
      for (const leg of visible) {
        canvas.moveTo(leg[0]![0], leg[0]![1])
        for (const [c1x, c1y, c2x, c2y, x, y] of smoothCurves(leg)) {
          canvas.curveTo(c1x, c1y, c2x, c2y, x, y)
        }
        canvas.strokePath()
      }
    }
    canvas.restore()
  }

  // --- overlays ----------------------------------------------------------------------

  /**
   * North, and the turn the reader has to undo, at the right-hand end of the scale bar's row.
   *
   * It used to be a 13 x 17 mm white box in the top-right corner of the map — 220 mm² of
   * SCAN25 painted over on every page, and on a rotated page that corner is as likely to hold
   * the walk as any other. It followed the neighbour hints into the footer on 2026-09-18,
   * where it also balances the scale bar at the other end of the same row.
   *
   * The needle still has to point anywhere on the compass, so this is the one piece of footer
   * furniture that needs height rather than a baseline.
   */
  private drawNorthArrow(canvas: PdfPage, cy: number): void {
    const [nu, nv] = this.frame.northOnPage()
    const rotation = `${Math.round((360.0 - this.frame.angleDeg) % 360.0)}°`
    const needle = mm(2.2)
    const gap = mm(1.6)
    const width =
      needle * 2 + gap + canvas.textWidth('N', 7.0, true) + gap + canvas.textWidth(rotation, 6.0)

    const cx = this.mapX + this.mapW - width + needle
    const tipX = cx + nu * needle
    const tipY = cy + nv * needle
    // Perpendicular, for the arrow head.
    const px = -nv * mm(0.9)
    const py = nu * mm(0.9)

    canvas.setStroke(0.0, 0.0, 0.0)
    canvas.setLineWidth(0.8)
    canvas.line(cx - nu * needle, cy - nv * needle, tipX, tipY)
    canvas.setFill(0.0, 0.0, 0.0)
    canvas.fillPolygon([
      [tipX, tipY],
      [tipX - nu * mm(1.8) + px, tipY - nv * mm(1.8) + py],
      [tipX - nu * mm(1.8) - px, tipY - nv * mm(1.8) - py],
    ])
    // Cap height is about 0.7 em, so half of it is what puts a label on the needle's axis.
    canvas.text(cx + needle + gap, cy - mm((7.0 * 0.7 * 25.4) / 72 / 2), 7.0, 'N', true)
    canvas.textRight(this.mapX + this.mapW, cy - mm((6.0 * 0.7 * 25.4) / 72 / 2), 6.0, rotation)
  }

  private drawFooter(canvas: PdfPage, page: MapPage, total: number): void {
    const baseline = mm(this.paper.safeMarginMm + 1.5)
    const line = baseline + mm(5.0)
    const number = `Page ${page.number} / ${total}`
    canvas.setFill(0.0, 0.0, 0.0)
    canvas.text(this.mapX, line, 9.0, number, true)

    const attribution = `1:${this.paper.scaleDenominator} · ${this.attribution}`
    canvas.textRight(this.mapX + this.mapW, line, 7.0, attribution)

    let cursor = this.mapX + canvas.textWidth(number, 9.0, true) + mm(4.0)
    cursor += this.drawNeighbourHints(canvas, page, cursor, line)
    if (this.title !== null) {
      const room = this.mapX + this.mapW - canvas.textWidth(attribution, 7.0) - mm(4.0) - cursor
      const title = elide(canvas, this.title, 8.0, room)
      if (title !== null) canvas.text(cursor, line, 8.0, title)
    }
    this.drawScaleBar(canvas, this.mapX, baseline)
    // High enough that the needle clears the safe margin below and the footer's text row
    // above: it is the one piece of furniture down here that is taller than a line of type.
    this.drawNorthArrow(canvas, baseline + mm(1.1))
  }

  /**
   * The pages the map carries on onto, in the footer rather than on the map.
   *
   * They used to be white tabs pinned to the four map edges — which is exactly where the
   * trace leaves the page, so each one covered the detail a walker needs most. The footer
   * is the only space on the sheet that is off the map *and* inside the safe margin, so
   * that is where they went (2026-09-18). Direction survives as a filled triangle, because
   * WinAnsi encoding has no arrow characters.
   *
   * @returns the width used, so the title can start after it.
   */
  private drawNeighbourHints(canvas: PdfPage, page: MapPage, x: number, y: number): number {
    const arrow = mm(2.2)
    const gap = mm(1.4)
    let at = x
    const hint = (numbers: readonly number[], dirX: number, dirY: number): void => {
      if (numbers.length === 0) return
      const cy = y + mm(0.9)
      const half = arrow / 2
      canvas.setFill(0.0, 0.0, 0.0)
      canvas.fillPolygon([
        [at + half + dirX * half, cy + dirY * half],
        [at + half - dirX * half - dirY * half, cy - dirY * half + dirX * half],
        [at + half - dirX * half + dirY * half, cy - dirY * half - dirX * half],
      ])
      at += arrow + mm(0.8)
      const label = `p. ${numbers.join(', ')}`
      canvas.text(at, y, 7.0, label, true)
      at += canvas.textWidth(label, 7.0, true) + gap * 2
    }
    // Reading order round the page: back, up, on, down.
    hint(page.neighbours.left, -1.0, 0.0)
    hint(page.neighbours.up, 0.0, 1.0)
    hint(page.neighbours.right, 1.0, 0.0)
    hint(page.neighbours.down, 0.0, -1.0)
    return at === x ? 0 : at - x
  }

  private drawScaleBar(canvas: PdfPage, x: number, y: number): void {
    const totalM = 1000.0
    const segments = 5
    const barW = totalM / this.metresPerPt
    const segW = barW / segments
    const h = mm(1.4)
    for (let i = 0; i < segments; i++) {
      if (i % 2 === 0) canvas.setFill(0.0, 0.0, 0.0)
      else canvas.setFill(1.0, 1.0, 1.0)
      canvas.fillRect(x + i * segW, y, segW, h)
    }
    canvas.setStroke(0.0, 0.0, 0.0)
    canvas.setLineWidth(0.4)
    canvas.strokeRect(x, y, barW, h)
    canvas.setFill(0.0, 0.0, 0.0)
    canvas.text(x, y - mm(2.6), 6.0, '0')
    canvas.textRight(x + barW, y - mm(2.6), 6.0, '1 km')
  }
}

/**
 * `value` cut to fit `room`, with an ellipsis, or null when even the ellipsis will not fit.
 *
 * The footer is one row and the neighbour hints took some of it, so a long trace name has
 * to give way rather than run into the attribution on the right.
 */
function elide(canvas: PdfPage, value: string, size: number, room: number): string | null {
  if (room <= 0) return null
  if (canvas.textWidth(value, size) <= room) return value
  for (let length = value.length - 1; length > 0; length--) {
    const cut = `${value.slice(0, length).trimEnd()}…`
    if (canvas.textWidth(cut, size) <= room) return cut
  }
  return null
}
