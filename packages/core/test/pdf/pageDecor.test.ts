import { describe, expect, it } from 'vitest'
import {
  A4_25K,
  NO_NEIGHBOURS,
  mapHeightM,
  mapWidthM,
  pageFrame,
  type MapPage,
} from '../../src/layout/pageLayout.js'
import { PageDecor, TRACK_ALPHA, TRACK_RGB, mm } from '../../src/pdf/pageDecor.js'
import { PdfPage } from '../../src/pdf/pdfPage.js'
import { fmt } from '../../src/pdf/format.js'
import { winAnsi } from '../../src/pdf/metrics.js'
import { rect } from '../../src/layout/rect.js'
import type { PagePoint } from '../../src/layout/planPreview.js'

/** A leg crossing the page, given in page-frame metres. */
function leg(...points: readonly (readonly [number, number])[]): PagePoint[] {
  return points.map(([u, v]) => ({ u, v }))
}

/** Every `x1 y1 m x2 y2 l S` in the stream — the operator `PdfPage.line` emits. */
function strokedSegments(content: string): [number, number, number, number][] {
  return [...content.matchAll(/^(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S$/gm)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
  ])
}

/** Every point a `c` operator names: the two controls and the end of each curve. */
function curvePoints(content: string): [number, number][] {
  const out: [number, number][] = []
  for (const m of content.matchAll(
    /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) c$/gm,
  )) {
    out.push(
      [Number(m[1]), Number(m[2])],
      [Number(m[3]), Number(m[4])],
      [Number(m[5]), Number(m[6])],
    )
  }
  return out
}

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
  track: readonly (readonly PagePoint[])[] | null = null,
): string {
  const canvas = new PdfPage(mm(A4_25K.widthMm), mm(A4_25K.heightMm))
  new PageDecor({
    frame: pageFrame(angleRad),
    paper: A4_25K,
    attribution: ATTRIBUTION,
    title,
    track,
  }).draw(canvas, mapPage, total)
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

  it('draws no kilometre grid over the map', () => {
    // Removed on request: a blue lattice over every square centimetre of an already dense
    // map. The only stroked line left on the page is the north arrow's needle.
    const content = draw()
    expect(content.match(/ m .* l S/g) ?? []).toHaveLength(1)
    expect(content).not.toContain(pdfString('500'))
    expect(content).not.toContain(pdfString('6500'))
  })

  it('labels the north arrow with the rotation the reader must undo', () => {
    // A page frame turned 30° clockwise from grid north puts north 330° round on the page.
    expect(draw(page(), (30 * Math.PI) / 180)).toContain(pdfString('330°'))
    expect(draw(page(), 0)).toContain(pdfString('0°'))
  })

  it('writes the page number, scale and attribution in the footer', () => {
    const content = draw(page(3), 0, 7)
    expect(content).toContain(pdfString('Page 3 / 7'))
    expect(content).toContain(pdfString(`1:25000 · ${ATTRIBUTION}`))
    expect(content).not.toContain('grille Lambert-93')
  })

  it('adds the title after the page number when there is one', () => {
    expect(draw(page(), 0, 1, 'Traversée')).toContain(pdfString('Traversée'))
    expect(draw(page(), 0, 1, null)).not.toContain('Traversée')
  })

  it('names the neighbouring pages in the footer, never on the map', () => {
    // They used to be white tabs on the four map edges — exactly where the trace leaves the
    // page. The footer is the only space that is off the map and inside the safe margin.
    const content = draw({
      number: 2,
      rect: page().rect,
      neighbours: { up: [1], down: [3], left: [], right: [4, 5] },
    })
    expect(content).toContain(pdfString('p. 1'))
    expect(content).toContain(pdfString('p. 3'))
    expect(content).toContain(pdfString('p. 4, 5'))
  })

  it('leaves the map area to the map', () => {
    // Every overlay lives in the footer now: the neighbour hints and the north arrow both
    // moved off the map, and the arrow's 13 x 17 mm white box went with it. The only ink
    // inside the map rectangle is the frame around it.
    const content = draw(
      { number: 2, rect: page().rect, neighbours: { up: [1], down: [3], left: [6], right: [4] } },
      (20 * Math.PI) / 180,
      9,
      'Traversée',
    )
    const footerTop = mm(A4_25K.safeMarginMm + A4_25K.footerMm)
    // Filled and stroked rectangles: the scale bar's five segments and its outline are in
    // the footer, and the map frame is the one rectangle allowed to be the map.
    const frame = `${fmt(mm(5))} ${fmt(footerTop)} ${fmt(mm(200))} ${fmt(mm(277))} re`
    for (const m of content.matchAll(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re [fS]$/gm)) {
      if (m[0]!.startsWith(frame)) continue
      expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(footerTop)
    }
    // Arrow heads and the north needle: every path starts below the map.
    for (const m of content.matchAll(/^(-?[\d.]+) (-?[\d.]+) m/gm)) {
      expect(Number(m[2])).toBeLessThan(footerTop)
    }
    // Every line of type, too.
    for (const m of content.matchAll(/Tf (-?[\d.]+) (-?[\d.]+) Td/g)) {
      expect(Number(m[2])).toBeLessThan(footerTop)
    }
  })

  it('elides a title that would run into the attribution', () => {
    const long =
      'Traversée de la Normandie par les chemins de halage, les bois de Brotonne et le marais Vernier'
    const content = draw(
      { number: 2, rect: page().rect, neighbours: { up: [1], down: [3], left: [], right: [4, 5] } },
      0,
      9,
      long,
    )
    expect(content).not.toContain(pdfString(long))
    // WinAnsi puts the ellipsis at 0x85, and it is the last thing before the close paren.
    expect(content).toContain(`${String.fromCharCode(0x85)}) Tj`)
  })

  it('does not draw the trace unless it is given one', () => {
    // The default is still what it always was: the GPX decides where the pages go and is
    // not printed on them.
    expect(draw()).toBe(draw(page(), 0, 1, null, []))
  })

  it('draws the trace as a single unhaloed curve when asked', () => {
    const p = page()
    const content = draw(p, 0, 1, null, [
      leg(
        [p.rect.uMin + 1000, p.rect.vMin + 1000],
        [p.rect.uMin + 2500, p.rect.vMin + 3000],
        [p.rect.uMin + 4000, p.rect.vMin + 5000],
      ),
    ])
    expect(content).toContain(`${fmt(TRACK_RGB[0])} ${fmt(TRACK_RGB[1])} ${fmt(TRACK_RGB[2])} RG`)
    // No white halo under it any more: a wider translucent line reads as a line, a halo
    // reads as fog over the map either side of it.
    expect(content).not.toContain('1.0000 1.0000 1.0000 RG')
    // Curves, not segments: the only `m ... l S` left is the north arrow's needle.
    expect(strokedSegments(content)).toHaveLength(1)
    // Two points, two curves, one pass.
    expect(curvePoints(content)).toHaveLength(6)
  })

  it('draws the trace under 1 alpha so the path beneath it still reads', () => {
    const p = page()
    const content = draw(p, 0, 1, null, [
      leg([p.rect.uMin + 1000, p.rect.vMin + 1000], [p.rect.uMin + 4000, p.rect.vMin + 5000]),
    ])
    expect(TRACK_ALPHA).toBeLessThan(1)
    // One graphics state, because there is one pass.
    expect(content).toContain('/GS0 gs')
    expect(content).not.toContain('/GS1 gs')
  })

  it('clips the trace to the map area with a PDF clipping path', () => {
    const p = page()
    // A leg running far outside the page must not paint over the footer or the margins.
    // A curve cannot be clipped segment by segment, so the clip is the page's own.
    const content = draw(p, 0, 1, null, [
      leg(
        [p.rect.uMin - 50_000, p.rect.vMin + 3000],
        [p.rect.uMin + 2000, p.rect.vMin + 3000],
        [p.rect.uMax + 50_000, p.rect.vMin + 3000],
      ),
    ])
    const x = mm(5)
    const y = mm(15)
    expect(content).toContain(`q\n${fmt(x)} ${fmt(y)} ${fmt(mm(200))} ${fmt(mm(277))} re W n`)
    // The curve itself runs off the page; only the clip keeps it off the margins.
    expect(curvePoints(content).some(([px]) => px < x)).toBe(true)
    // ...and the clip is popped afterwards, or the footer would be cut to the map too.
    expect(content.lastIndexOf('\nQ\n')).toBeGreaterThan(content.lastIndexOf(' c\n'))
  })

  it('drops a leg that misses the page entirely', () => {
    const p = page()
    const far = leg(
      [p.rect.uMin - 90_000, p.rect.vMin - 90_000],
      [p.rect.uMin - 80_000, p.rect.vMin - 80_000],
    )
    expect(draw(p, 0, 1, null, [far])).toBe(draw(p, 0, 1, null, []))
  })
})
