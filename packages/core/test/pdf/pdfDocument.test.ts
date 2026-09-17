import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ArrayBufferSink, writePdf, type PdfDocument } from '../../src/pdf/pdfDocument.js'
import { PdfPage } from '../../src/pdf/pdfPage.js'
import { textWidth } from '../../src/pdf/metrics.js'

function write(build: (document: PdfDocument) => void): Uint8Array {
  const sink = new ArrayBufferSink()
  writePdf(sink, 595.276, 841.89, build)
  return sink.toBytes()
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

/** Content streams are deflated, so page operators have to be inflated to be read. */
function contentStreams(pdf: Uint8Array): string {
  const text = latin1(pdf)
  const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g
  const parts: string[] = []
  let m: RegExpExecArray | null
  while ((m = header.exec(text)) !== null) {
    const start = m.index + m[0].length
    const length = Number(m[1])
    // unzlib, not inflate: a raw-deflate reader accepts both and would hide the bug that
    // shipped a PDF no viewer could open.
    parts.push(latin1(unzlibSync(pdf.subarray(start, start + length))))
  }
  return parts.join('\n')
}

describe('PdfDocument', () => {
  it('produces a structurally valid single page document', () => {
    const bytes = write((d) => d.addPage((page) => page.text(50, 50, 10, 'Page 1')))
    const text = latin1(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Pages /Count 1')
    expect(text).toContain('/MediaBox [0 0 595.2760 841.8900]')
  })

  it('collects every page into one document', () => {
    const bytes = write((d) => {
      for (let i = 0; i < 9; i++) d.addPage((page) => page.text(10, 10, 8, `page ${i}`))
    })
    const text = latin1(bytes)
    expect(text).toContain('/Type /Pages /Count 9')
    expect(text.match(/\/Type \/Page \/Parent/g)).toHaveLength(9)
    const kids = text.split('/Kids [')[1]!.split(']')[0]!.trim().split(' 0 R').length - 1
    expect(kids).toBe(9)
  })

  it('every xref offset points at its own object header', () => {
    const bytes = write((d) => {
      for (let i = 0; i < 3; i++) {
        d.addPage((page) => {
          page.drawJpeg(Uint8Array.from({ length: 16 }, (_, k) => k), 4, 4, 0, 0, 10, 10)
          page.text(10, 10, 8, `page ${i}`)
        })
      }
    })
    const text = latin1(bytes)
    // "startxref" also ends in "xref", so anchor on the newline before the table.
    const xrefAt = text.lastIndexOf('\nxref\n') + 1
    const startXref = Number(text.split('startxref\n').pop()!.split('\n')[0]!.trim())
    expect(startXref).toBe(xrefAt)

    const lines = text.slice(xrefAt).split('\n')
    const count = Number(lines[1]!.trim().split(' ')[1])
    // Two fonts, the tree, the catalogue, then image + content + dictionary per page,
    // plus the mandatory free entry at number 0.
    expect(count).toBe(4 + 3 * 3 + 1)
    for (let index = 1; index < count; index++) {
      const offset = Number(lines[2 + index]!.slice(0, 10))
      expect(text.startsWith(`${index} 0 obj`, offset), `object ${index} at ${offset}`).toBe(true)
    }
    expect(text).toContain(`/Size ${count}`)
  })

  it('pages point at the page tree that is written after them', () => {
    const bytes = write((d) => {
      for (let i = 0; i < 2; i++) d.addPage((page) => page.text(0, 0, 8, 'x'))
    })
    const text = latin1(bytes)
    const parents = new Set([...text.matchAll(/\/Parent (\d+) 0 R/g)].map((m) => m[1]))
    expect(parents).toEqual(new Set(['3']))
    expect(text).toContain('3 0 obj\n<< /Type /Pages')
    expect(text).toContain('/Root 4 0 R')
  })

  it('jpeg payloads are embedded untouched as DCTDecode streams', () => {
    const jpeg = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff)
    const bytes = write((d) => d.addPage((page) => page.drawJpeg(jpeg, 8, 8, 0, 0, 100, 100)))
    const text = latin1(bytes)
    expect(text).toContain('/Subtype /Image /Width 8 /Height 8')
    expect(text).toContain('/Filter /DCTDecode /Length 64')
    expect(text).toContain(latin1(jpeg))
    expect(contentStreams(bytes)).toContain('100.0000 0 0 100.0000 0.0000 0.0000 cm /Im0 Do')
  })

  it('parentheses and backslashes in labels are escaped', () => {
    const bytes = write((d) => d.addPage((page) => page.text(0, 0, 8, 'a(b)c\\d')))
    expect(contentStreams(bytes)).toContain('(a\\(b\\)c\\\\d) Tj')
  })

  it('transcodes typographic punctuation to WinAnsi', () => {
    const bytes = write((d) => d.addPage((page) => page.text(0, 0, 8, '© IGN — SCAN25®')))
    const expected = `(© IGN ${String.fromCharCode(0x97)} SCAN25®) Tj`
    expect(contentStreams(bytes)).toContain(expected)
  })

  it('deflates content streams', () => {
    const bytes = write((d) =>
      d.addPage((page) => {
        for (let i = 0; i < 40; i++) page.text(10, i, 8, 'un libelle assez repetitif')
      }),
    )
    const compressed = Number(/<< \/Filter \/FlateDecode \/Length (\d+) >>/.exec(latin1(bytes))![1])
    const plain = contentStreams(bytes).length
    expect(compressed, `${compressed} vs ${plain}`).toBeLessThan(plain / 2)
  })

  it('uses the real Helvetica metrics for text width', () => {
    const page = new PdfPage(595.276, 841.89)
    // Every Helvetica digit is 556/1000 em.
    expect(page.textWidth('1234', 10)).toBeCloseTo(4 * 0.556 * 10, 9)
    expect(page.textWidth('iii', 10)).toBeLessThan(page.textWidth('WWW', 10))
    expect(textWidth('Page', 10, true)).toBeGreaterThan(textWidth('Page', 10))
  })

  it('refuses an empty document', () => {
    expect(() => write(() => {})).toThrow(/at least one page/)
  })
})

describe('content stream framing', () => {
  it('frames content streams as zlib, which is what /FlateDecode means', () => {
    // fflate's deflateSync emits raw RFC 1951. Poppler reports "Unknown compression method
    // in flate stream" and renders a blank page — which is exactly what shipped once.
    const bytes = write((d) => d.addPage((page) => page.text(50, 50, 10, 'Page 1')))
    const text = latin1(bytes)
    const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)
    expect(header).not.toBeNull()
    const start = header!.index + header![0].length
    const stream = bytes.subarray(start, start + Number(header![1]))
    // RFC 1950: low nibble 8 is DEFLATE, and the two header bytes are a multiple of 31.
    expect(stream[0]! & 0x0f).toBe(8)
    expect(((stream[0]! << 8) | stream[1]!) % 31).toBe(0)
    expect(latin1(unzlibSync(stream))).toContain('(Page 1) Tj')
  })
})
