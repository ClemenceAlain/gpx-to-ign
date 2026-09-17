import { describe, expect, it } from 'vitest'
import type { GpxFile } from '../../src/gpx/gpx.js'
import { A4_25K, DEFAULT_LAYOUT_OPTIONS, plan, type Layout } from '../../src/layout/pageLayout.js'
import { planPreview } from '../../src/layout/planPreview.js'
import { contains, height, width } from '../../src/layout/rect.js'
import { line, track } from './tracks.js'

const options = { ...DEFAULT_LAYOUT_OPTIONS, angleStepDeg: 15 }

function planOf(...files: GpxFile[]): Layout {
  return plan(files, A4_25K, options)
}

describe('planPreview', () => {
  it('holds every page in its bounds, with air around them', () => {
    const layout = planOf(line(4_000, 18_000))
    const preview = planPreview(layout)
    const block = layout.pagesBounds()

    expect(preview.pages.length).toBeGreaterThan(0)
    for (const page of preview.pages) {
      expect(
        contains(preview.bounds, page.rect.uMin, page.rect.vMin) &&
          contains(preview.bounds, page.rect.uMax, page.rect.vMax),
        `page ${page.number} sticks out of the preview bounds`,
      ).toBe(true)
    }
    expect(width(preview.bounds)).toBeGreaterThan(width(block))
    expect(height(preview.bounds)).toBeGreaterThan(height(block))
  })

  it('keeps each leg its own polyline, so nothing joins two traces', () => {
    const preview = planPreview(
      planOf(
        line(0, 6_000),
        track([
          [20_000, 0],
          [20_000, 6_000],
        ]),
      ),
    )
    expect(preview.tracks).toHaveLength(2)
  })

  it('drops samples the canvas could not tell apart, and keeps the ends', () => {
    const layout = planOf(line(0, 20_000))
    const coarse = planPreview(layout, 40)
    const fine = planPreview(layout, 4_000)

    expect(
      coarse.tracks[0]!.length,
      'a 40 px preview kept as many points as a 4000 px one',
    ).toBeLessThan(fine.tracks[0]!.length)

    const [u, v] = layout.toPage(layout.samples.at(-1)!)
    const end = coarse.tracks[0]!.at(-1)!
    expect(end.u).toBeCloseTo(u, 6)
    expect(end.v).toBeCloseTo(v, 6)
  })

  it('gives north as a unit vector in the page frame', () => {
    const preview = planPreview(planOf(line(9_000, 9_000)))
    expect(Math.hypot(preview.north.u, preview.north.v)).toBeCloseTo(1, 9)
  })

  it('never touches the network', () => {
    // The preview is what the user validates before paying for a single tile. If this ever
    // needs a fetch, the design has gone wrong.
    const layout = planOf(line(0, 12_000))
    const fetchImpl = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('the preview must not download anything')
    }) as typeof fetch
    try {
      expect(planPreview(layout).pages.length).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = fetchImpl
    }
  })
})
