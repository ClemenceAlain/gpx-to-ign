import type { PdfPage } from './pdfPage.js'
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
}

/**
 * Everything printed on top of the map: a north arrow that accounts for the page rotation,
 * the scale bar, the page number and the neighbour hints.
 *
 * The Lambert-93 kilometre grid used to be drawn here too. It was removed on request: it
 * put a blue lattice over every square centimetre of an already dense map. The scale bar is
 * still an exact kilometre, so it remains the ruler test's measuring device.
 *
 * The GPX trace itself is deliberately never drawn — it only decided where the pages go.
 */
export class PageDecor {
  private readonly frame: PageFrame
  private readonly paper: PaperSpec
  private readonly attribution: string
  private readonly title: string | null

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

    this.mapX = mm(this.paper.safeMarginMm)
    this.mapY = mm(this.paper.safeMarginMm + this.paper.footerMm)
    this.mapW = mm(mapWidthMm(this.paper))
    this.mapH = mm(mapHeightMm(this.paper))
    this.metresPerPt = (this.paper.scaleDenominator * 25.4) / 72.0 / 1000.0
  }

  draw(canvas: PdfPage, page: MapPage, total: number): void {
    canvas.setStroke(0.0, 0.0, 0.0)
    canvas.setLineWidth(0.6)
    canvas.strokeRect(this.mapX, this.mapY, this.mapW, this.mapH)

    this.drawNorthArrow(canvas)
    this.drawNeighbourTabs(canvas, page)
    this.drawFooter(canvas, page, total)
  }

  // --- overlays ----------------------------------------------------------------------

  private drawNorthArrow(canvas: PdfPage): void {
    const boxW = mm(13.0)
    const boxH = mm(17.0)
    const x = this.mapX + this.mapW - boxW - mm(2.0)
    const y = this.mapY + this.mapH - boxH - mm(2.0)

    canvas.setFill(1.0, 1.0, 1.0)
    canvas.fillRect(x, y, boxW, boxH)
    canvas.setStroke(0.0, 0.0, 0.0)
    canvas.setLineWidth(0.5)
    canvas.strokeRect(x, y, boxW, boxH)

    const cx = x + boxW / 2.0
    const cy = y + mm(7.5)
    const [nu, nv] = this.frame.northOnPage()
    const len = mm(5.5)
    const tipX = cx + nu * len
    const tipY = cy + nv * len
    const tailX = cx - nu * len
    const tailY = cy - nv * len
    // Perpendicular, for the arrow head.
    const px = -nv * mm(1.8)
    const py = nu * mm(1.8)

    canvas.setLineWidth(0.8)
    canvas.line(tailX, tailY, tipX, tipY)
    canvas.setFill(0.0, 0.0, 0.0)
    canvas.fillPolygon([
      [tipX, tipY],
      [tipX - nu * mm(3.5) + px, tipY - nv * mm(3.5) + py],
      [tipX - nu * mm(3.5) - px, tipY - nv * mm(3.5) - py],
    ])
    canvas.textCentered(cx, y + mm(1.5), 7.0, 'N', true)
    const rotation = Math.round((360.0 - this.frame.angleDeg) % 360.0)
    canvas.textCentered(cx, y + boxH - mm(3.0), 5.0, `${rotation}°`)
  }

  /**
   * White tabs on each edge naming the page that carries the map on. The arrow is a
   * triangle rather than a glyph, because WinAnsi encoding has no arrow characters.
   */
  private drawNeighbourTabs(canvas: PdfPage, page: MapPage): void {
    const tab = (
      numbers: readonly number[],
      x: number,
      y: number,
      dirX: number,
      dirY: number,
    ): void => {
      if (numbers.length === 0) return
      const label = `p. ${numbers.join(', ')}`
      const arrow = mm(3.0)
      const w = canvas.textWidth(label, 7.0, true) + arrow + mm(3.0)
      const h = mm(4.5)
      canvas.setFill(1.0, 1.0, 1.0)
      canvas.fillRect(x - w / 2, y - h / 2, w, h)
      canvas.setStroke(0.0, 0.0, 0.0)
      canvas.setLineWidth(0.4)
      canvas.strokeRect(x - w / 2, y - h / 2, w, h)

      const ax = x - w / 2 + mm(1.0) + arrow / 2
      const half = arrow / 2
      canvas.setFill(0.0, 0.0, 0.0)
      canvas.fillPolygon([
        [ax + dirX * half, y + dirY * half],
        [ax - dirX * half - dirY * half, y - dirY * half + dirX * half],
        [ax - dirX * half + dirY * half, y - dirY * half - dirX * half],
      ])
      canvas.text(x - w / 2 + mm(1.0) + arrow + mm(1.0), y - mm(1.1), 7.0, label, true)
    }
    const cx = this.mapX + this.mapW / 2
    const cy = this.mapY + this.mapH / 2
    tab(page.neighbours.up, cx, this.mapY + this.mapH - mm(3.0), 0.0, 1.0)
    tab(page.neighbours.down, cx, this.mapY + mm(3.0), 0.0, -1.0)
    tab(page.neighbours.left, this.mapX + mm(16.0), cy, -1.0, 0.0)
    tab(page.neighbours.right, this.mapX + this.mapW - mm(16.0), cy, 1.0, 0.0)
  }

  private drawFooter(canvas: PdfPage, page: MapPage, total: number): void {
    const baseline = mm(this.paper.safeMarginMm + 1.5)
    const number = `Page ${page.number} / ${total}`
    canvas.setFill(0.0, 0.0, 0.0)
    canvas.text(this.mapX, baseline + mm(5.0), 9.0, number, true)
    if (this.title !== null) {
      canvas.text(
        this.mapX + canvas.textWidth(`${number}  `, 9.0, true),
        baseline + mm(5.0),
        8.0,
        this.title,
      )
    }
    canvas.textRight(
      this.mapX + this.mapW,
      baseline + mm(5.0),
      7.0,
      `1:${this.paper.scaleDenominator} · ${this.attribution}`,
    )
    this.drawScaleBar(canvas, this.mapX, baseline)
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
