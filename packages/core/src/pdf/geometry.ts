/** Liang-Barsky clipping of a segment against an axis-aligned box. */
export function clipSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): [number, number, number, number] | null {
  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0.0
  let t1 = 1.0
  const p = [-dx, dx, -dy, dy]
  const q = [x1 - xMin, xMax - x1, y1 - yMin, yMax - y1]
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!
    const qi = q[i]!
    if (pi === 0.0) {
      if (qi < 0) return null
    } else {
      const r = qi / pi
      if (pi < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy]
}
