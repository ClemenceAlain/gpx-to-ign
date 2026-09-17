import { describe, expect, it } from 'vitest'
import { forward, type L93 } from '../../src/geo/lambert93.js'
import {
  A4_25K,
  DEFAULT_LAYOUT_OPTIONS,
  mapHeightM,
  mapWidthM,
  plan,
  type Layout,
  type LayoutOptions,
} from '../../src/layout/pageLayout.js'
import { contains } from '../../src/layout/rect.js'
import { line, track } from './tracks.js'

const paper = A4_25K
const options = DEFAULT_LAYOUT_OPTIONS

function withOptions(overrides: Partial<LayoutOptions>): LayoutOptions {
  return { ...options, ...overrides }
}

/** Every sample must sit at least one margin inside some page, or the print clips the walk. */
function expectCoveredWithMargin(layout: Layout): void {
  for (const s of layout.samples) {
    const [u, v] = layout.toPage(s)
    let clearance = -1
    for (const page of layout.pages) {
      const r = page.rect
      if (!contains(r, u, v)) continue
      clearance = Math.max(clearance, Math.min(u - r.uMin, r.uMax - u, v - r.vMin, r.vMax - v))
    }
    expect(
      clearance,
      `a sample is only ${clearance.toFixed(1)} m from the page edge, want ${layout.marginM}`,
    ).toBeGreaterThanOrEqual(layout.marginM - 1e-6)
  }
}

describe('PaperSpec', () => {
  it('covers 5000 by 6925 metres on a default A4 page', () => {
    expect(mapWidthM(paper)).toBeCloseTo(5000, 9)
    expect(mapHeightM(paper)).toBeCloseTo(6925, 9)
  })
})

describe('plan', () => {
  it('keeps every sample a margin inside a page', () => {
    expectCoveredWithMargin(plan([line(6_000, 18_000)], paper, options))
  })

  it('covers a north-south track along the tall page axis, north-up', () => {
    const layout = plan([line(0, 20_000)], paper, withOptions({ allowRotation: false }))
    expect(layout.pages).toHaveLength(Math.ceil(20_000 / 5_925))
    expect(layout.angleDeg).toBeCloseTo(0, 9)
    expectCoveredWithMargin(layout)
  })

  it('covers an east-west track along the short page axis, north-up', () => {
    const layout = plan([line(20_000, 0)], paper, withOptions({ allowRotation: false }))
    expect(layout.pages).toHaveLength(Math.ceil(20_000 / 4_000))
    expectCoveredWithMargin(layout)
  })

  it('packs a straight track along the page diagonal when it may rotate', () => {
    // A page swallows a straight run as long as its own diagonal, so the best rotation lays
    // the track corner to corner: hypot(4000, 5925).
    const diagonal = Math.hypot(4_000, 5_925)
    for (const bearing of [0, 20, 45, 90, 137]) {
      const a = (bearing * Math.PI) / 180
      const files = [line(20_000 * Math.sin(a), 20_000 * Math.cos(a))]
      const rotated = plan(files, paper, options)
      const northUp = plan(files, paper, withOptions({ allowRotation: false }))
      expect(rotated.pages.length, `bearing ${bearing}`).toBe(Math.ceil(20_000 / diagonal))
      expect(rotated.pages.length, `bearing ${bearing}`).toBeLessThanOrEqual(northUp.pages.length)
      expectCoveredWithMargin(rotated)
    }
  })

  it('saves pages by rotating an east-west track', () => {
    const files = [line(20_000, 0)]
    expect(plan(files, paper, withOptions({ allowRotation: false })).pages).toHaveLength(5)
    const rotated = plan(files, paper, options)
    expect(rotated.pages).toHaveLength(3)
    expectCoveredWithMargin(rotated)
  })

  it('does not pay for the return leg of an out-and-back', () => {
    const out = [...Array(101)].map((_, i): [number, number] => [0, (20_000 * i) / 100])
    const back = [...Array(101)].map((_, i): [number, number] => [120, (20_000 * (100 - i)) / 100])
    const layout = plan([track([...out, ...back])], paper, options)
    const oneWay = plan([line(0, 20_000)], paper, options)
    // The return leg runs 120 m from the outbound one, so it must ride the same pages.
    expect(layout.pages).toHaveLength(oneWay.pages.length)
    expectCoveredWithMargin(layout)
  })

  it('reuses pages on both sides of a loop', () => {
    const r = 6_000
    const ring = [...Array(360)].map((_, d): [number, number] => {
      const a = (d * Math.PI) / 180
      return [r * Math.sin(a), r * Math.cos(a)]
    })
    const layout = plan([track(ring)], paper, options)
    // A 12 km wide ring cannot fit one 4000 x 5925 effective page, but four is plenty.
    expect(layout.pages.length, `got ${layout.pages.length} pages`).toBeGreaterThanOrEqual(2)
    expect(layout.pages.length).toBeLessThanOrEqual(6)
    expectCoveredWithMargin(layout)
  })

  it('never uses fewer pages for a bigger margin', () => {
    const files = [line(0, 20_000)]
    const small = plan(files, paper, withOptions({ marginM: 250 }))
    const large = plan(files, paper, withOptions({ marginM: 1_500 }))
    expect(large.pages.length).toBeGreaterThanOrEqual(small.pages.length)
    expectCoveredWithMargin(small)
    expectCoveredWithMargin(large)
  })

  it('numbers pages in the order the walk meets them', () => {
    const layout = plan([line(0, 20_000)], paper, options)
    expect(layout.pages.map((p) => p.number)).toEqual(layout.pages.map((_, i) => i + 1))
    const firstHit = layout.pages.map((page) =>
      layout.samples.findIndex((s) => {
        const [u, v] = layout.toPage(s)
        return contains(page.rect, u, v)
      }),
    )
    expect([...firstHit].sort((a, b) => a - b)).toEqual(firstHit)
  })

  it('points each neighbour at the page that continues the walk', () => {
    const layout = plan([line(0, 20_000)], paper, withOptions({ allowRotation: false }))
    const first = layout.pages[0]!
    expect(first.neighbours.up).toEqual([2])
    expect(first.neighbours.down).toEqual([])
    expect(first.neighbours.left).toEqual([])
    expect(first.neighbours.right).toEqual([])
    expect(layout.pages.at(-1)!.neighbours.down).toEqual([layout.pages.length - 1])
  })

  it('announces each neighbour on exactly one edge', () => {
    const diagonal = line(14_000, 14_000)
    for (const allowRotation of [true, false]) {
      const layout = plan([diagonal], paper, withOptions({ allowRotation }))
      for (const page of layout.pages) {
        const listed = [
          ...page.neighbours.up,
          ...page.neighbours.down,
          ...page.neighbours.left,
          ...page.neighbours.right,
        ]
        expect([...new Set(listed)], `page ${page.number} repeats a neighbour`).toEqual(listed)
        expect(listed, `page ${page.number} lists itself`).not.toContain(page.number)
        expect(listed.every((n) => n >= 1 && n <= layout.pages.length)).toBe(true)
      }
    }
  })

  it('points the north arrow along the chosen rotation', () => {
    const layout = plan([line(20_000, 0)], paper, options)
    const [nu, nv] = layout.northOnPage()
    // Grid north on the page must be the page-frame image of the L93 +y axis.
    const base = forward(45, 5)
    const origin = layout.toPage(base)
    const north = layout.toPage({ x: base.x, y: base.y + 1000 } satisfies L93)
    expect((north[0] - origin[0]) / 1000).toBeCloseTo(nu, 9)
    expect((north[1] - origin[1]) / 1000).toBeCloseTo(nv, 9)
  })

  it('splits samples back into the legs they came from', () => {
    const layout = plan(
      [
        track([
          [0, 0],
          [0, 4_000],
        ]),
        track([
          [9_000, 0],
          [9_000, 3_000],
        ]),
      ],
      paper,
      options,
    )
    const segments = layout.trackSegments()
    expect(segments).toHaveLength(2)
    expect(segments.every((s) => s.length > 0)).toBe(true)
    expect(segments.flat()).toHaveLength(layout.samples.length)
  })
})
