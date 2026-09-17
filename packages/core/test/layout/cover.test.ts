import { describe, expect, it } from 'vitest'
import { Cover } from '../../src/layout/cover.js'
import { XorWowRandom } from '../../src/layout/random.js'
import { contains, rect, type Rect } from '../../src/layout/rect.js'

const W = 100
const H = 100

function cover(points: readonly [number, number][]): Cover {
  return new Cover(
    Float64Array.from(points.map((p) => p[0])),
    Float64Array.from(points.map((p) => p[1])),
    Int32Array.from([0, points.length]),
    W,
    H,
  )
}

/**
 * Any minimal cover can slide each rectangle up and left until its lower-left corner
 * touches a point's u and a point's v, so those pairs form a complete candidate set.
 */
function bruteForceMinimum(points: readonly [number, number][]): number {
  const seen = new Set<string>()
  const candidates: Rect[] = []
  for (const a of points) {
    for (const b of points) {
      const key = `${a[0]},${b[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(rect(a[0], b[1], a[0] + W, b[1] + H))
    }
  }
  const covers = (chosen: Rect[]): boolean =>
    points.every((p) => chosen.some((r) => contains(r, p[0], p[1])))

  for (let k = 1; k <= points.length; k++) {
    const index = [...Array(k)].map((_, i) => i)
    for (;;) {
      if (covers(index.map((i) => candidates[i]!))) return k
      let i = k - 1
      while (i >= 0 && index[i] === candidates.length - k + i) i--
      if (i < 0) break
      index[i]!
      index[i] = index[i]! + 1
      for (let j = i + 1; j < k; j++) index[j] = index[j - 1]! + 1
    }
  }
  return points.length
}

describe('Cover', () => {
  it('matches the brute-force optimum on small random point sets', () => {
    const rng = new XorWowRandom(20260917)
    for (let seed = 0; seed < 60; seed++) {
      const points: [number, number][] = [...Array(5 + (seed % 4))].map(() => [
        rng.nextDouble(0, 260),
        rng.nextDouble(0, 260),
      ])
      const c = cover(points)
      const got = c.solve(true, 24)
      expect(c.coversAll(got), `case ${seed} leaves a point uncovered`).toBe(true)
      expect(got.length, `case ${seed}`).toBe(bruteForceMinimum(points))
    }
  })

  it('needs a single page for a single point', () => {
    expect(cover([[10, 10]]).solve(true, 24)).toHaveLength(1)
  })

  it('needs separate pages for points further apart than a page', () => {
    const c = cover([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ])
    const r = c.solve(true, 24)
    expect(r).toHaveLength(3)
    expect(c.coversAll(r)).toBe(true)
  })

  it('does not add pages for ground the track revisits', () => {
    const onePass: [number, number][] = [...Array(51)].map((_, i) => [0, i * 4])
    const there = cover(onePass).solve(true).length
    const andBack = cover([
      ...onePass,
      ...[...onePass].reverse().map(([x, y]): [number, number] => [x + 3, y]),
    ]).solve(true).length
    expect(andBack).toBe(there)
  })

  it('places every page inside the effective size it was given', () => {
    const c = cover([...Array(40)].map((_, i): [number, number] => [i * 7, i * 3]))
    for (const r of c.solve(true, 24)) {
      expect(r.uMax - r.uMin).toBeCloseTo(W, 9)
      expect(r.vMax - r.vMin).toBeCloseTo(H, 9)
    }
  })

  it('is deterministic across runs', () => {
    const points: [number, number][] = [...Array(60)].map((_, i) => [
      Math.sin(i) * 300,
      Math.cos(i * 1.7) * 300,
    ])
    const a = cover(points).solve(true, 24)
    const b = cover(points).solve(true, 24)
    expect(b).toEqual(a)
  })
})
