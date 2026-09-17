import { centeredOn, contains, type Rect } from './rect.js'
import { XorWowRandom } from './random.js'

const SKIP_LIMIT = 512
const ANCHOR_BUDGET = 300
const RESTART_SEED = 0x6a7e1e15

/**
 * Covers a set of ordered points with as few equal-sized rectangles as possible.
 *
 * Callers pass the *effective* page size: the printable map rectangle already shrunk by
 * the requested margin. A point inside an effective rectangle is therefore guaranteed to
 * sit at least one margin away from the printed page edge.
 *
 * Minimum rectangle cover is NP-hard, so this runs two complementary greedy strategies
 * and keeps the better one:
 *
 *  - `sequential` walks the track and takes the longest run of still-uncovered points that
 *    fits on one page. Optimal for a plain out-and-back-free linear walk, and cheap enough
 *    to run once per candidate rotation angle.
 *  - `maxCoverage` repeatedly places the page that covers the most uncovered points. It is
 *    slower but recovers the pages a loop or an out-and-back would otherwise duplicate.
 *
 * Both results then go through `refine`, which drops redundant pages, re-centres what is
 * left to maximise slack, and merges neighbours that happen to fit together.
 */
export class Cover {
  private readonly n: number
  /** Point indices sorted by u, so a rectangle query only scans a narrow slice. */
  private readonly byU: Int32Array
  private readonly sortedU: Float64Array

  private readonly u: Float64Array
  private readonly v: Float64Array
  /** Index of the first point of each segment, plus a trailing entry equal to `u.length`. */
  private readonly segmentStart: Int32Array
  private readonly w: number
  private readonly h: number

  constructor(u: Float64Array, v: Float64Array, segmentStart: Int32Array, w: number, h: number) {
    this.u = u
    this.v = v
    this.segmentStart = segmentStart
    this.w = w
    this.h = h
    this.n = u.length
    if (this.n === 0) throw new Error('nothing to cover')
    if (!(w > 0 && h > 0)) throw new Error('margin leaves no usable page area')

    const order = [...Array(this.n)].map((_, i) => i).sort((a, b) => u[a]! - u[b]!)
    this.byU = Int32Array.from(order)
    this.sortedU = Float64Array.from(order, (i) => u[i]!)
  }

  /**
   * @param thorough also run the max-coverage strategy, roughly an order of magnitude
   *   slower than the sequential sweep.
   * @param restarts extra max-coverage attempts with randomised anchors and tie-breaks.
   *   The generator is seeded, so the same job always yields the same page plan.
   */
  solve(thorough: boolean, restarts = 0): Rect[] {
    let best = this.refine(this.sequential(false))
    if (!thorough) return best

    const consider = (candidate: Rect[]): void => {
      if (candidate.length < best.length) best = candidate
    }
    consider(this.refine(this.sequential(true)))
    consider(this.refine(this.maxCoverage()))
    if (restarts > 0) {
      const rng = new XorWowRandom(RESTART_SEED)
      for (let i = 0; i < restarts; i++) {
        if (best.length <= 1) return best
        consider(this.refine(this.maxCoverage(rng)))
      }
    }
    return best
  }

  // --- strategy 1: longest fitting run along the track -----------------------------

  sequential(reverse = false): Rect[] {
    const covered = new Uint8Array(this.n)
    const out: Rect[] = []
    const segments = [...Array(this.segmentStart.length - 1)].map((_, i) => i)
    for (const s of reverse ? segments.reverse() : segments) {
      const lo = this.segmentStart[s]!
      const hi = this.segmentStart[s + 1]!
      // Walking a leg backwards shifts where the page breaks fall, which sometimes
      // saves the page a forward pass wastes on a short tail.
      const step = reverse ? -1 : 1
      const first = reverse ? hi - 1 : lo
      const stop = reverse ? lo - 1 : hi
      let i = first
      while (i !== stop) {
        if (covered[i] === 1) {
          i += step
          continue
        }
        let lo0 = this.u[i]!
        let hi0 = this.u[i]!
        let lo1 = this.v[i]!
        let hi1 = this.v[i]!
        let last = i
        let k = i + step
        let skipped = 0
        while (k !== stop) {
          if (covered[k] === 1) {
            // Bounded so an already-covered return leg cannot make this quadratic.
            if (++skipped > SKIP_LIMIT) break
            k += step
            continue
          }
          const nlo0 = Math.min(lo0, this.u[k]!)
          const nhi0 = Math.max(hi0, this.u[k]!)
          const nlo1 = Math.min(lo1, this.v[k]!)
          const nhi1 = Math.max(hi1, this.v[k]!)
          if (nhi0 - nlo0 > this.w || nhi1 - nlo1 > this.h) break
          lo0 = nlo0
          hi0 = nhi0
          lo1 = nlo1
          hi1 = nhi1
          last = k
          k += step
        }
        const r = centeredOn(lo0, lo1, hi0, hi1, this.w, this.h)
        out.push(r)
        this.markCovered(r, covered)
        i = last + step
      }
    }
    return out
  }

  // --- strategy 2: greedy maximum coverage -----------------------------------------

  maxCoverage(rng?: XorWowRandom): Rect[] {
    const covered = new Uint8Array(this.n)
    let remaining = this.n
    const out: Rect[] = []
    const scratch: number[] = []
    while (remaining > 0 && out.length <= this.n) {
      const uncovered: number[] = []
      for (let i = 0; i < this.n; i++) if (covered[i] === 0) uncovered.push(i)

      let anchors: number[]
      if (rng === undefined) {
        const stride = Math.max(1, Math.floor(uncovered.length / ANCHOR_BUDGET))
        anchors = []
        for (let i = 0; i < uncovered.length; i += stride) anchors.push(uncovered[i]!)
      } else {
        const count = Math.min(ANCHOR_BUDGET, uncovered.length)
        anchors = [...Array(count)].map(() => uncovered[rng.nextInt(uncovered.length)]!)
      }

      let best: Rect | null = null
      let bestCount = 0
      for (const p of anchors) {
        for (const c of this.candidatesAround(this.u[p]!, this.v[p]!)) {
          const count = this.countUncovered(c, covered, null)
          const better =
            count > bestCount ||
            (count === bestCount && count > 0 && rng !== undefined && rng.nextBoolean())
          if (better) {
            bestCount = count
            best = c
          }
        }
      }
      const head = uncovered[0]!
      const chosen =
        best ??
        centeredOn(this.u[head]!, this.v[head]!, this.u[head]!, this.v[head]!, this.w, this.h)

      // Shrink-wrap onto what it actually covers, which buys slack for free.
      scratch.length = 0
      this.countUncovered(chosen, covered, scratch)
      let tight = chosen
      if (scratch.length > 0) {
        let lo0 = Infinity
        let hi0 = -Infinity
        let lo1 = Infinity
        let hi1 = -Infinity
        for (const i of scratch) {
          lo0 = Math.min(lo0, this.u[i]!)
          hi0 = Math.max(hi0, this.u[i]!)
          lo1 = Math.min(lo1, this.v[i]!)
          hi1 = Math.max(hi1, this.v[i]!)
        }
        tight = centeredOn(lo0, lo1, hi0, hi1, this.w, this.h)
      }
      remaining -= this.markCovered(tight, covered)
      out.push(tight)
    }
    return out
  }

  private candidatesAround(pu: number, pv: number): Rect[] {
    const { w, h } = this
    return [
      { uMin: pu, vMin: pv, uMax: pu + w, vMax: pv + h },
      { uMin: pu - w, vMin: pv, uMax: pu, vMax: pv + h },
      { uMin: pu, vMin: pv - h, uMax: pu + w, vMax: pv },
      { uMin: pu - w, vMin: pv - h, uMax: pu, vMax: pv },
      { uMin: pu - w / 2, vMin: pv - h / 2, uMax: pu + w / 2, vMax: pv + h / 2 },
    ]
  }

  // --- shared refinement ------------------------------------------------------------

  refine(rects: Rect[]): Rect[] {
    let current = this.prune(rects.slice())
    current = this.recentre(current)
    current = this.merge(current)
    return this.prune(current)
  }

  private prune(rects: Rect[]): Rect[] {
    const kept = rects.slice()
    for (let i = kept.length - 1; i >= 0; i--) {
      const without = kept.filter((_, j) => j !== i)
      if (without.length > 0 && this.coversAll(without)) kept.splice(i, 1)
    }
    return kept
  }

  private recentre(rects: Rect[]): Rect[] {
    const owners = this.assign(rects)
    for (let i = 0; i < rects.length; i++) {
      const mine = owners[i]!
      if (mine.length === 0) continue
      let lo0 = Infinity
      let hi0 = -Infinity
      let lo1 = Infinity
      let hi1 = -Infinity
      for (const p of mine) {
        lo0 = Math.min(lo0, this.u[p]!)
        hi0 = Math.max(hi0, this.u[p]!)
        lo1 = Math.min(lo1, this.v[p]!)
        hi1 = Math.max(hi1, this.v[p]!)
      }
      if (hi0 - lo0 > this.w || hi1 - lo1 > this.h) continue
      const previous = rects[i]!
      rects[i] = centeredOn(lo0, lo1, hi0, hi1, this.w, this.h)
      if (!this.coversAll(rects)) rects[i] = previous
    }
    return rects
  }

  private merge(rects: Rect[]): Rect[] {
    let changed = true
    while (changed && rects.length > 1) {
      changed = false
      const owners = this.assign(rects)
      outer: for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const points = [...owners[i]!, ...owners[j]!]
          if (points.length === 0) continue
          let lo0 = Infinity
          let hi0 = -Infinity
          let lo1 = Infinity
          let hi1 = -Infinity
          for (const p of points) {
            lo0 = Math.min(lo0, this.u[p]!)
            hi0 = Math.max(hi0, this.u[p]!)
            lo1 = Math.min(lo1, this.v[p]!)
            hi1 = Math.max(hi1, this.v[p]!)
          }
          if (hi0 - lo0 > this.w || hi1 - lo1 > this.h) continue
          const next = rects.filter((_, k) => k !== i && k !== j)
          next.push(centeredOn(lo0, lo1, hi0, hi1, this.w, this.h))
          if (this.coversAll(next)) {
            rects.length = 0
            rects.push(...next)
            changed = true
            break outer
          }
        }
      }
    }
    return rects
  }

  /** Points owned by each rectangle: every point goes to the first rectangle holding it. */
  private assign(rects: readonly Rect[]): number[][] {
    const owners: number[][] = rects.map(() => [])
    for (let p = 0; p < this.n; p++) {
      for (let i = 0; i < rects.length; i++) {
        if (contains(rects[i]!, this.u[p]!, this.v[p]!)) {
          owners[i]!.push(p)
          break
        }
      }
    }
    return owners
  }

  coversAll(rects: readonly Rect[]): boolean {
    for (let p = 0; p < this.n; p++) {
      let ok = false
      for (const r of rects) {
        if (contains(r, this.u[p]!, this.v[p]!)) {
          ok = true
          break
        }
      }
      if (!ok) return false
    }
    return true
  }

  private markCovered(r: Rect, covered: Uint8Array): number {
    let added = 0
    this.forEachInU(r, (p) => {
      if (covered[p] === 0 && this.v[p]! >= r.vMin && this.v[p]! <= r.vMax) {
        covered[p] = 1
        added++
      }
    })
    return added
  }

  private countUncovered(r: Rect, covered: Uint8Array, sink: number[] | null): number {
    let count = 0
    this.forEachInU(r, (p) => {
      if (covered[p] === 0 && this.v[p]! >= r.vMin && this.v[p]! <= r.vMax) {
        count++
        sink?.push(p)
      }
    })
    return count
  }

  private forEachInU(r: Rect, body: (p: number) => void): void {
    let lo = this.lowerBound(r.uMin)
    while (lo < this.n && this.sortedU[lo]! <= r.uMax) {
      body(this.byU[lo]!)
      lo++
    }
  }

  private lowerBound(target: number): number {
    let lo = 0
    let hi = this.n
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.sortedU[mid]! < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
