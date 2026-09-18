/** A point on the page, in PostScript points. */
export type Pt = readonly [number, number]

/** One cubic Bézier: two controls and an end point. The start is the previous end. */
export type Curve = readonly [number, number, number, number, number, number]

/**
 * Turns a polyline into a smooth curve that still passes through every one of its points.
 *
 * A GPX trace is a chain of fixes, so a straight-segment polyline shows a visible kink at
 * each one — the "à-coups" a printed line makes obvious at 1:25000. This is a **centripetal**
 * Catmull-Rom spline (alpha = 0.5) converted to the cubic Béziers PDF draws: it interpolates
 * the points rather than approximating them, so the printed line still goes exactly where the
 * walker did, and centripetal parameterisation is the one that provably never loops or
 * overshoots on the tight switchbacks a mountain path is full of. Uniform Catmull-Rom does
 * both.
 *
 * @returns the curves after the first point, which the caller moves to.
 */
export function smoothCurves(points: readonly Pt[]): Curve[] {
  const out: Curve[] = []
  const n = points.length
  if (n < 2) return out
  const at = (i: number): Pt => points[Math.min(Math.max(i, 0), n - 1)]!
  // alpha = 0.5: the knot spacing is the square root of the chord length.
  const knot = (a: Pt, b: Pt): number => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]))

  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const d1 = knot(p0, p1)
    const d2 = knot(p1, p2)
    const d3 = knot(p2, p3)

    // A repeated point makes the tangent undefined; fall back to the straight chord.
    const c1 =
      d1 > 0 && d2 > 0
        ? control(p0, p1, p2, d1, d2)
        : ([p1[0] + (p2[0] - p1[0]) / 3, p1[1] + (p2[1] - p1[1]) / 3] as Pt)
    const c2 =
      d3 > 0 && d2 > 0
        ? control(p3, p2, p1, d3, d2)
        : ([p2[0] + (p1[0] - p2[0]) / 3, p2[1] + (p1[1] - p2[1]) / 3] as Pt)
    out.push([c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]])
  }
  return out
}

/**
 * The Bézier control point next to `near`, for the segment `near`->`far`, given the point
 * `beyond` on the other side of `near` and the two knot spacings.
 *
 * Symmetric in both directions, so the same expression serves both ends of a segment.
 */
function control(beyond: Pt, near: Pt, far: Pt, dOuter: number, dInner: number): Pt {
  const scale = 3 * dOuter * (dOuter + dInner)
  const weight = 2 * dOuter * dOuter + 3 * dOuter * dInner + dInner * dInner
  return [
    (dOuter * dOuter * far[0] - dInner * dInner * beyond[0] + weight * near[0]) / scale,
    (dOuter * dOuter * far[1] - dInner * dInner * beyond[1] + weight * near[1]) / scale,
  ]
}

/** True when a polyline's bounding box touches the box at all. */
export function intersectsBox(
  points: readonly Pt[],
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): boolean {
  let loX = Infinity
  let loY = Infinity
  let hiX = -Infinity
  let hiY = -Infinity
  for (const [x, y] of points) {
    if (x < loX) loX = x
    if (x > hiX) hiX = x
    if (y < loY) loY = y
    if (y > hiY) hiY = y
  }
  return loX <= xMax && hiX >= xMin && loY <= yMax && hiY >= yMin
}
