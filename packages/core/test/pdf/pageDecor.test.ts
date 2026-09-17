import { describe, expect, it } from 'vitest'
import {
  A4_25K,
  NO_NEIGHBOURS,
  mapHeightM,
  mapWidthM,
  pageFrame,
  type MapPage,
} from '../../src/layout/pageLayout.js'
import { PageDecor, mm } from '../../src/pdf/pageDecor.js'
import { PdfPage } from '../../src/pdf/pdfPage.js'
import { fmt } from '../../src/pdf/format.js'
import { winAnsi } from '../../src/pdf/metrics.js'
import { rect } from '../../src/layout/rect.js'

const ATTRIBUTION = '© IGN — SCAN25®'

/**
 * The literal a content stream holds for `value`: WinAnsi bytes, with the delimiters
 * escaped. The em dash is 0x97 there, not the UTF-16 code unit JavaScript starts from.
 */
function pdfString(value: string): string {
  let out = '('
  for (const code of winAnsi(value)) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\'
    out += String.fromCharCode(code)
  }
  return `${out}) Tj`
}

/** One north-up page whose lower-left corner sits on a round Lambert-93 kilometre. */
function page(number = 1): MapPage {
  return {
    number,
    rect: rect(500_000, 6_500_000, 500_000 + mapWidthM(A4_25K), 6_500_000 + mapHeightM(A4_25K)),
    neighbours: NO_NEIGHBOURS,
  }
}

function draw(
  mapPage: MapPage = page(),
  angleRad = 0,
  total = 1,
  title: string | null = null,
): string {
  const canvas = new PdfPage(mm(A4_25K.widthMm), mm(A4_25K.heightMm))
  new PageDecor({ frame: pageFrame(angleRad), paper: A4_25K, attribution: ATTRIBUTION, title }).draw(
    canvas,
    mapPage,
    total,
  )
  let s = ''
  for (const b of canvas.contentBytes()) s += String.fromCharCode(b)
  return s
}

describe('PageDecor', () => {
  it('converts millimetres to PostScript points', () => {
    expect(mm(25.4)).toBeCloseTo(72, 12)
    expect(mm(A4_25K.widthMm)).toBeCloseTo(595.2756, 4)
  })

  it('prints one kilometre exactly 40 mm wide', () => {
    // The whole project rests on this number: 1 km at 1:25000 is 40.0 mm, and the scale bar
    // is the only thing on the page a ruler can be laid against.
    const content = draw()
    // The bar is five filled segments inside one stroked outline; the outline is the metre.
    expect(content).toContain(`${fmt(mm(40))} ${fmt(mm(1.4))} re S`)
    expect(content).toContain(`${fmt(mm(8))} ${fmt(mm(1.4))} re f`)
    expect(content).toContain(pdfString('1 km'))
    expect(content).toContain(pdfString('0'))
  })

  it('frames the map area at the paper spec', () => {
    const content = draw()
    const x = mm(A4_25K.safeMarginMm)
    const y = mm(A4_25K.safeMarginMm + A4_25K.footerMm)
    expect(content).toContain(`${fmt(x)} ${fmt(y)} ${fmt(mm(200))} ${fmt(mm(277))} re S`)
  })

  it('draws the Lambert-93 kilometre grid one line per kilometre', () => {
    const content = draw()
    // 5000 x 6925 m of ground, starting on a round kilometre: 6 verticals, 7 horizontals.
    const lines = content.match(/ m .* l S/g) ?? []
    const gridLines = lines.length
    expect(gridLines).toBeGreaterThanOrEqual(13)
    // Labelled with the kilometre index, not the metre.
    expect(content).toContain(pdfString('500'))
    expect(content).toContain(pdfString('6500'))
    expect(content).not.toContain(pdfString('500000'))
  })

  it('labels the north arrow with the rotation the reader must undo', () => {
    // A page frame turned 30° clockwise from grid north puts north 330° round on the page.
    expect(draw(page(), (30 * Math.PI) / 180)).toContain(pdfString('330°'))
    expect(draw(page(), 0)).toContain(pdfString('0°'))
  })

  it('writes the page number, scale, attribution and grid in the footer', () => {
    const content = draw(page(3), 0, 7)
    expect(content).toContain(pdfString('Page 3 / 7'))
    expect(content).toContain(pdfString(`1:25000 · ${ATTRIBUTION} · grille Lambert-93 (1 km)`))
  })

  it('adds the title after the page number when there is one', () => {
    expect(draw(page(), 0, 1, 'Traversée')).toContain(pdfString('Traversée'))
    expect(draw(page(), 0, 1, null)).not.toContain('Traversée')
  })

  it('names the neighbouring pages on the edges they continue onto', () => {
    const content = draw({
      number: 2,
      rect: page().rect,
      neighbours: { up: [1], down: [3], left: [], right: [4, 5] },
    })
    expect(content).toContain(pdfString('p. 1'))
    expect(content).toContain(pdfString('p. 3'))
    expect(content).toContain(pdfString('p. 4, 5'))
  })

  it('never draws the trace', () => {
    // The GPX only decides where the pages go. Anything else is a bug, not a feature.
    const content = draw()
    expect(content).not.toContain('track')
  })
})
