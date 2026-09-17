import { describe, expect, it } from 'vitest'
import { forward } from '../../src/geo/lambert93.js'
import {
  colOf,
  originOf,
  requireValidMatrix,
  resolution,
  rowOf,
  tileSpan,
  tilesCovering,
} from '../../src/geo/tileGrid.js'

describe('TileGrid', () => {
  it('level 16 is the native 2.5 metre SCAN25 resolution', () => {
    // ScaleDenominator 8928.5714285714 x 0.28 mm, straight from the GetCapabilities.
    expect(resolution(16)).toBeCloseTo(2.5, 9)
    expect(tileSpan(16)).toBeCloseTo(640.0, 9)
    expect(resolution(15)).toBeCloseTo(5.0, 9)
  })

  it("Col d'Entreves falls in the tile that was fetched by hand", () => {
    const p = forward(45.8452, 6.9051)
    expect(colOf(p.x, 16)).toBe(1567)
    expect(rowOf(p.y, 16)).toBe(8539)
  })

  it('tile origin is the top-left corner of its own footprint', () => {
    const tile = { matrix: 16, col: 1567, row: 8539 }
    const o = originOf(tile)
    expect(o.x).toBeCloseTo(1567 * 640.0, 9)
    expect(o.y).toBeCloseTo(12_000_000.0 - 8539 * 640.0, 9)
    expect(colOf(o.x + 1.0, 16)).toBe(1567)
    expect(rowOf(o.y - 1.0, 16)).toBe(8539)
  })

  it('tilesCovering returns every tile touching the box and nothing more', () => {
    const b = { minX: 1_003_000.0, minY: 6_534_000.0, maxX: 1_004_000.0, maxY: 6_535_000.0 }
    const tiles = tilesCovering(b, 16)
    expect(tiles).toHaveLength(2 * 2)
    expect(tiles).toContainEqual({ matrix: 16, col: 1567, row: 8539 })
    for (const t of tiles) {
      const o = originOf(t)
      expect(o.x).toBeLessThan(b.maxX)
      expect(o.x + 640).toBeGreaterThan(b.minX)
      expect(o.y).toBeGreaterThan(b.minY)
      expect(o.y - 640).toBeLessThan(b.maxY)
    }
  })

  it('rejects levels outside the published 3-16 range', () => {
    expect(requireValidMatrix(16)).toBe(16)
    expect(requireValidMatrix(3)).toBe(3)
    expect(() => requireValidMatrix(17)).toThrow(/outside the published range/)
    expect(() => requireValidMatrix(2)).toThrow(/outside the published range/)
  })
})
