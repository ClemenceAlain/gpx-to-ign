/**
 * An axis-aligned rectangle in the *page frame*: the map rotated so that page-up is the
 * job's chosen bearing. Units are metres on the ground.
 */
export interface Rect {
  readonly uMin: number
  readonly vMin: number
  readonly uMax: number
  readonly vMax: number
}

export function rect(uMin: number, vMin: number, uMax: number, vMax: number): Rect {
  return { uMin, vMin, uMax, vMax }
}

export function width(r: Rect): number {
  return r.uMax - r.uMin
}

export function height(r: Rect): number {
  return r.vMax - r.vMin
}

export function centerU(r: Rect): number {
  return (r.uMin + r.uMax) / 2
}

export function centerV(r: Rect): number {
  return (r.vMin + r.vMax) / 2
}

export function contains(r: Rect, u: number, v: number): boolean {
  return u >= r.uMin && u <= r.uMax && v >= r.vMin && v <= r.vMax
}

export function expand(r: Rect, by: number): Rect {
  return rect(r.uMin - by, r.vMin - by, r.uMax + by, r.vMax + by)
}

export function union(a: Rect, b: Rect): Rect {
  return rect(
    Math.min(a.uMin, b.uMin),
    Math.min(a.vMin, b.vMin),
    Math.max(a.uMax, b.uMax),
    Math.max(a.vMax, b.vMax),
  )
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.uMin <= b.uMax && b.uMin <= a.uMax && a.vMin <= b.vMax && b.vMin <= a.vMax
}

/** A `w` x `h` rectangle centred on the given box. */
export function centeredOn(
  uMin: number,
  vMin: number,
  uMax: number,
  vMax: number,
  w: number,
  h: number,
): Rect {
  const cu = (uMin + uMax) / 2
  const cv = (vMin + vMax) / 2
  return rect(cu - w / 2, cv - h / 2, cu + w / 2, cv + h / 2)
}
