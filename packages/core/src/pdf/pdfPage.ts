import { fmt, latin1 } from './format.js'
import { textWidth, winAnsi } from './metrics.js'

export interface PdfImage {
  readonly jpeg: Uint8Array
  readonly widthPx: number
  readonly heightPx: number
}

/** Grows a byte buffer without knowing the final size up front. */
class ByteBuffer {
  private buf = new Uint8Array(4096)
  private len = 0

  push(bytes: Uint8Array): void {
    if (this.len + bytes.length > this.buf.length) {
      let size = this.buf.length * 2
      while (size < this.len + bytes.length) size *= 2
      const next = new Uint8Array(size)
      next.set(this.buf.subarray(0, this.len))
      this.buf = next
    }
    this.buf.set(bytes, this.len)
    this.len += bytes.length
  }

  pushByte(b: number): void {
    this.push(Uint8Array.of(b))
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/** Drawing surface for one page, in PostScript points with the origin at the bottom left. */
export class PdfPage {
  readonly images: PdfImage[] = []
  /**
   * Every constant alpha the page asked for, in the order it asked. PDF has no `alpha`
   * operator: transparency is a graphics state the page resources have to name, so the
   * document turns this into `/ExtGState << /GS0 ... >>` when it serialises the page.
   */
  readonly alphas: number[] = []
  private readonly content = new ByteBuffer()

  readonly widthPt: number
  readonly heightPt: number

  constructor(widthPt: number, heightPt: number) {
    this.widthPt = widthPt
    this.heightPt = heightPt
  }

  contentBytes(): Uint8Array {
    return this.content.toBytes()
  }

  private op(text: string): void {
    this.content.push(latin1(text))
    this.content.pushByte(0x0a)
  }

  /** Places an already-encoded JPEG so it exactly fills the given rectangle. */
  drawJpeg(
    jpeg: Uint8Array,
    widthPx: number,
    heightPx: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const index = this.images.length
    this.images.push({ jpeg, widthPx, heightPx })
    this.op(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm /Im${index} Do Q`)
  }

  /** `q` — pushes the graphics state, so colour, width, alpha and clip can be undone. */
  save(): void {
    this.op('q')
  }

  /** `Q` — pops it. */
  restore(): void {
    this.op('Q')
  }

  /**
   * Intersects the clipping path with a rectangle. Everything drawn until the next
   * `restore()` is cut to it, which is how the trace stays off the margins and the footer
   * without any of it being clipped by hand.
   */
  clipRect(x: number, y: number, w: number, h: number): void {
    this.op(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re W n`)
  }

  /**
   * Constant alpha for both strokes and fills, until the next `restore()`.
   *
   * Only sensible between `save()` and `restore()`: PDF has no way to say "back to opaque"
   * other than naming another state or popping this one.
   */
  setAlpha(alpha: number): void {
    let index = this.alphas.indexOf(alpha)
    if (index < 0) index = this.alphas.push(alpha) - 1
    this.op(`/GS${index} gs`)
  }

  moveTo(x: number, y: number): void {
    this.op(`${fmt(x)} ${fmt(y)} m`)
  }

  lineTo(x: number, y: number): void {
    this.op(`${fmt(x)} ${fmt(y)} l`)
  }

  /** Cubic Bézier from the current point, through two controls, to (x, y). */
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.op(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x)} ${fmt(y)} c`)
  }

  /** `S` — strokes the path built since the last `moveTo`. */
  strokePath(): void {
    this.op('S')
  }

  /** Round joins and caps, so a smoothed trace has no mitre spikes at a sharp switchback. */
  setRoundJoins(): void {
    this.op('1 J 1 j')
  }

  setFill(r: number, g: number, b: number): void {
    this.op(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`)
  }

  setStroke(r: number, g: number, b: number): void {
    this.op(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`)
  }

  setLineWidth(w: number): void {
    this.op(`${fmt(w)} w`)
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.op(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`)
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.op(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`)
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.op(`${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`)
  }

  fillPolygon(points: ReadonlyArray<readonly [number, number]>): void {
    if (points.length < 3) return
    const head = points[0]!
    this.op(`${fmt(head[0])} ${fmt(head[1])} m`)
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!
      this.op(`${fmt(p[0])} ${fmt(p[1])} l`)
    }
    this.op('h f')
  }

  text(x: number, y: number, size: number, value: string, bold = false): void {
    const font = bold ? 'F2' : 'F1'
    this.content.push(latin1(`BT /${font} ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td (`))
    for (const code of winAnsi(value)) {
      if (code === 0x28 || code === 0x29 || code === 0x5c) this.content.pushByte(0x5c)
      this.content.pushByte(code)
    }
    this.op(') Tj ET')
  }

  textCentered(cx: number, y: number, size: number, value: string, bold = false): void {
    this.text(cx - textWidth(value, size, bold) / 2.0, y, size, value, bold)
  }

  textRight(right: number, y: number, size: number, value: string, bold = false): void {
    this.text(right - textWidth(value, size, bold), y, size, value, bold)
  }

  textWidth(value: string, size: number, bold = false): number {
    return textWidth(value, size, bold)
  }
}
