import { zlibSync } from 'fflate'
import { fmt, latin1 } from './format.js'
import { PdfPage } from './pdfPage.js'

/** Where the finished bytes go. The web writes to a Blob, the CLI to a file stream. */
export interface ByteSink {
  write(bytes: Uint8Array): void
}

/** Collects everything in memory. Fine for the CLI; the web streams to disk instead. */
export class ArrayBufferSink implements ByteSink {
  private readonly chunks: Uint8Array[] = []
  private total = 0

  write(bytes: Uint8Array): void {
    this.chunks.push(bytes)
    this.total += bytes.length
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.total)
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

// Reserved so pages can name their parent and their fonts before either is written.
const REGULAR_FONT = 1
const BOLD_FONT = 2
const PAGE_TREE = 3
const CATALOG = 4
const FIRST_FREE_NUMBER = 5

/**
 * A deliberately small PDF 1.4 writer.
 *
 * It exists instead of a library because the two things this app needs — placing already
 * encoded JPEGs and drawing a handful of lines and labels — are a few hundred lines, and a
 * hand-rolled writer behaves identically in the browser, in Node and on Android. JPEG bytes
 * go in untouched as `DCTDecode` streams, so the map is never recompressed.
 *
 * Pages are serialised the moment they are finished rather than collected first, so a
 * thirty-page map book never holds more than one page of raster in memory. Object numbers
 * are handed out up front and the cross-reference table is built from a number-to-offset
 * map, which is what lets the page tree carry number 3 while being written last: PDF puts
 * no constraint on the order objects appear in the file.
 */
export class PdfDocument {
  private readonly offsets = new Map<number, number>()
  private readonly pageRefs: number[] = []
  private next = FIRST_FREE_NUMBER
  private written = 0
  private finished = false

  private readonly out: ByteSink
  private readonly widthPt: number
  private readonly heightPt: number

  constructor(out: ByteSink, widthPt: number, heightPt: number) {
    this.out = out
    this.widthPt = widthPt
    this.heightPt = heightPt
    this.write(latin1('%PDF-1.4\n%âãÏÓ\n'))
    this.writeObject(
      REGULAR_FONT,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    )
    this.writeObject(
      BOLD_FONT,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    )
  }

  get pageCount(): number {
    return this.pageRefs.length
  }

  /** Draws one page and writes it out immediately. */
  addPage(draw: (page: PdfPage) => void): void {
    if (this.finished) throw new Error('the document is already closed')
    const page = new PdfPage(this.widthPt, this.heightPt)
    draw(page)

    const imageRefs = page.images.map((image) =>
      this.writeStream(
        this.allocate(),
        `/Type /XObject /Subtype /Image /Width ${image.widthPx} ` +
          `/Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
          `/Filter /DCTDecode`,
        image.jpeg,
      ),
    )
    const contentRef = this.writeStream(
      this.allocate(),
      '/Filter /FlateDecode',
      // zlib, not raw deflate: /FlateDecode is RFC 1950, header and Adler-32 included.
      // fflate's deflateSync emits RFC 1951, which every real viewer rejects.
      zlibSync(page.contentBytes(), { level: 9 }),
    )

    let resources = `<< /Font << /F1 ${REGULAR_FONT} 0 R /F2 ${BOLD_FONT} 0 R >>`
    if (imageRefs.length > 0) {
      resources += ' /XObject << '
      imageRefs.forEach((ref, index) => {
        resources += `/Im${index} ${ref} 0 R `
      })
      resources += '>>'
    }
    resources += ' /ProcSet [/PDF /Text /ImageC] >>'

    const pageRef = this.allocate()
    this.writeObject(
      pageRef,
      `<< /Type /Page /Parent ${PAGE_TREE} 0 R ` +
        `/MediaBox [0 0 ${fmt(this.widthPt)} ${fmt(this.heightPt)}] ` +
        `/Resources ${resources} /Contents ${contentRef} 0 R >>`,
    )
    this.pageRefs.push(pageRef)
  }

  /** Writes the page tree, the catalogue and the cross-reference table. */
  finish(): void {
    if (this.finished) throw new Error('the document is already closed')
    if (this.pageRefs.length === 0) throw new Error('a PDF needs at least one page')
    this.finished = true

    this.writeObject(
      PAGE_TREE,
      `<< /Type /Pages /Count ${this.pageRefs.length} /Kids [` +
        this.pageRefs.map((r) => `${r} 0 R`).join(' ') +
        '] >>',
    )
    this.writeObject(CATALOG, `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R >>`)

    const size = this.next
    const xref = this.written
    this.write(latin1(`xref\n0 ${size}\n`))
    this.write(latin1('0000000000 65535 f \n'))
    for (let number = 1; number < size; number++) {
      const offset = this.offsets.get(number) ?? 0
      this.write(latin1(`${String(offset).padStart(10, '0')} 00000 n \n`))
    }
    this.write(
      latin1(`trailer\n<< /Size ${size} /Root ${CATALOG} 0 R >>\n` + `startxref\n${xref}\n%%EOF\n`),
    )
  }

  private allocate(): number {
    return this.next++
  }

  private writeObject(number: number, body: string): void {
    this.offsets.set(number, this.written)
    this.write(latin1(`${number} 0 obj\n`))
    this.write(latin1(body))
    this.write(latin1('\nendobj\n'))
  }

  private writeStream(number: number, dictionary: string | null, payload: Uint8Array): number {
    this.offsets.set(number, this.written)
    this.write(latin1(`${number} 0 obj\n`))
    const head =
      dictionary === null
        ? `<< /Length ${payload.length} >>\nstream\n`
        : `<< ${dictionary} /Length ${payload.length} >>\nstream\n`
    this.write(latin1(head))
    this.write(payload)
    this.write(latin1('\nendstream\nendobj\n'))
    return number
  }

  private write(bytes: Uint8Array): void {
    this.out.write(bytes)
    this.written += bytes.length
  }
}

/** Convenience for the common case: build a whole document against a sink. */
export function writePdf(
  out: ByteSink,
  widthPt: number,
  heightPt: number,
  build: (document: PdfDocument) => void,
): void {
  const document = new PdfDocument(out, widthPt, heightPt)
  build(document)
  document.finish()
}
