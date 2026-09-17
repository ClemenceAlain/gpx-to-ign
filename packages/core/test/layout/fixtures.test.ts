import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseGpx } from '../../src/gpx/gpx.js'
import { A4_25K, DEFAULT_LAYOUT_OPTIONS, plan } from '../../src/layout/pageLayout.js'

/**
 * Differential test against the Kotlin implementation, which is still the oracle for this
 * port. The expected strings were printed by `PageLayout.plan` on the JVM.
 *
 * Page count and rotation are what a user sees. The rectangles are here too because the
 * plan must be *deterministic* — a resumed job replans and has to land on the identical
 * tile set — and a plan that drifts by a metre fetches different tiles.
 */
const ORACLE = {
  'normandie-traverse-30km.gpx': {
    pages: 4,
    angleDeg: 9.0,
    samples: 881,
    rects: [
      [-560379.7, 6885284.1, -555379.7, 6892209.1],
      [-556355.7, 6889126.2, -551355.7, 6896051.2],
      [-554374.6, 6895047.3, -549374.6, 6901972.3],
      [-555317.2, 6899493.7, -550317.2, 6906418.7],
    ],
  },
  'bec-hellouin-bourgtheroulde-22km.gpx': {
    pages: 3,
    angleDeg: 0.0,
    samples: 571,
    rects: [
      [530322.7, 6905388.6, 535322.7, 6912313.6],
      [529522.7, 6911324.3, 534522.7, 6918249.3],
      [531884.0, 6916561.7, 536884.0, 6923486.7],
    ],
  },
} as const

describe('the Kotlin oracle, on the real fixtures', () => {
  for (const [name, expected] of Object.entries(ORACLE)) {
    it(`plans ${name} exactly as Kotlin does`, () => {
      const path = fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url))
      const layout = plan([parseGpx(name, readFileSync(path, 'utf8'))], A4_25K, DEFAULT_LAYOUT_OPTIONS)

      expect(layout.samples).toHaveLength(expected.samples)
      expect(layout.angleDeg).toBeCloseTo(expected.angleDeg, 4)
      expect(layout.pages).toHaveLength(expected.pages)
      expect(
        layout.pages.map((p) => [p.rect.uMin, p.rect.vMin, p.rect.uMax, p.rect.vMax]),
      ).toEqual(expected.rects.map((r) => r.map((n) => expect.closeTo(n, 1))))
    })
  }
})
