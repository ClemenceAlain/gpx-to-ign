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
  private readonly content = new ByteBuffer()

  constructor(
    readonly widthPt: number,
    readonly heightPt: number,
  ) {}

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
