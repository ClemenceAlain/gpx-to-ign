import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  boundsContain,
  expandBounds,
  forward,
  forwardPoint,
  inversePoint,
  type LatLon,
} from '../../src/geo/lambert93.js'

/** Reference eastings/northings produced by pyproj (EPSG:4326 -> EPSG:2154). */
const references: ReadonlyArray<readonly [LatLon, number, number]> = [
  [{ lat: 46.5, lon: 3.0 }, 700_000.0, 6_600_000.0],
  [{ lat: 48.853, lon: 2.3499 }, 652_296.973, 6_861_636.359],
  [{ lat: 45.8452, lon: 6.9051 }, 1_002_953.837, 6_534_776.102],
  [{ lat: 48.3904, lon: -4.4861 }, 146_632.979, 6_836_262.327],
  [{ lat: 43.7102, lon: 7.262 }, 1_043_410.16, 6_299_400.043],
]

describe('Lambert93', () => {
  it('forward projection matches reference coordinates within half a metre', () => {
    for (const [point, x, y] of references) {
      const got = forwardPoint(point)
      expect(Math.abs(got.x - x), `x for ${JSON.stringify(point)}`).toBeLessThan(0.5)
      expect(Math.abs(got.y - y), `y for ${JSON.stringify(point)}`).toBeLessThan(0.5)
    }
  })

  it('inverse round-trips to within a centimetre on the ground', () => {
    for (const [point] of references) {
      const back = inversePoint(forwardPoint(point))
      expect(Math.abs(back.lat - point.lat)).toBeLessThan(1e-7)
      expect(Math.abs(back.lon - point.lon)).toBeLessThan(1e-7)
    }
  })

  it('projection origin lands on the false easting and northing', () => {
    const p = forward(46.5, 3.0)
    expect(p.x).toBeCloseTo(700_000.0, 6)
    expect(p.y).toBeCloseTo(6_600_000.0, 6)
  })

  it('bounds cover the sampled points', () => {
    const b = boundsOf(references.map(([p]) => forwardPoint(p)))
    expect(b.minX).toBeLessThan(200_000)
    expect(b.maxX).toBeGreaterThan(1_000_000)
    expect(boundsContain(expandBounds(b, 1_000_000.0), forward(46.5, 3.0))).toBe(true)
  })

  it('refuses to bound an empty point set', () => {
    expect(() => boundsOf([])).toThrow(/empty/)
  })
})
