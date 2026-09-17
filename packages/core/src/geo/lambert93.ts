/** A WGS84 position as read from a GPX file. */
export interface LatLon {
  readonly lat: number
  readonly lon: number
}

/** A position in Lambert-93 (EPSG:2154) metres: x eastings, y northings. */
export interface L93 {
  readonly x: number
  readonly y: number
}

/** An axis-aligned box in L93 metres. */
export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

const A = 6378137.0
const INV_F = 298.257222101
const E = Math.sqrt(2.0 / INV_F - 1.0 / (INV_F * INV_F))

const LAT0 = 46.5
const LON0 = 3.0
const LAT1 = 44.0
const LAT2 = 49.0
const X0 = 700_000.0
const Y0 = 6_600_000.0

const toRadians = (d: number): number => (d * Math.PI) / 180.0
const toDegrees = (r: number): number => (r * 180.0) / Math.PI

function m(phi: number): number {
  const s = Math.sin(phi)
  return Math.cos(phi) / Math.sqrt(1.0 - E * E * s * s)
}

function t(phi: number): number {
  const s = Math.sin(phi)
  return Math.tan(Math.PI / 4.0 - phi / 2.0) / ((1.0 - E * s) / (1.0 + E * s)) ** (E / 2.0)
}

const P1 = toRadians(LAT1)
const P2 = toRadians(LAT2)
const N = (Math.log(m(P1)) - Math.log(m(P2))) / (Math.log(t(P1)) - Math.log(t(P2)))
const BIG_F = m(P1) / (N * t(P1) ** N)
const R0 = A * BIG_F * t(toRadians(LAT0)) ** N

function normaliseLon(lon: number): number {
  let l = lon
  while (l > 180.0) l -= 360.0
  while (l < -180.0) l += 360.0
  return l
}

/**
 * Lambert conformal conic 2SP (EPSG method 9802) for RGF93 / Lambert-93, EPSG:2154.
 *
 * RGF93 and WGS84 agree to within about a metre, which is well under the 2.5 m pixel of the
 * SCAN25 raster, so GPX WGS84 coordinates are fed in directly without a datum shift.
 */
export function forward(lat: number, lon: number): L93 {
  const phi = toRadians(lat)
  const r = A * BIG_F * t(phi) ** N
  const theta = N * toRadians(normaliseLon(lon - LON0))
  return { x: X0 + r * Math.sin(theta), y: Y0 + R0 - r * Math.cos(theta) }
}

export function forwardPoint(p: LatLon): L93 {
  return forward(p.lat, p.lon)
}

export function inverse(x: number, y: number): LatLon {
  const dx = x - X0
  const dy = R0 - (y - Y0)
  const r = Math.hypot(dx, dy) * Math.sign(N)
  const theta = Math.atan2(dx, dy)
  const tv = (r / (A * BIG_F)) ** (1.0 / N)

  // Snyder 7-9: iterate on the conformal latitude until it settles.
  let phi = Math.PI / 2.0 - 2.0 * Math.atan(tv)
  for (let i = 0; i < 12; i++) {
    const s = Math.sin(phi)
    const next = Math.PI / 2.0 - 2.0 * Math.atan(tv * ((1.0 - E * s) / (1.0 + E * s)) ** (E / 2.0))
    if (Math.abs(next - phi) < 1e-13) {
      phi = next
      break
    }
    phi = next
  }
  return { lat: toDegrees(phi), lon: normaliseLon(LON0 + toDegrees(theta / N)) }
}

export function inversePoint(p: L93): LatLon {
  return inverse(p.x, p.y)
}

/** Extent of the SCAN25 Lambert-93 layer, in L93 metres. Traces outside it have no map. */
export const COVERAGE: Bounds = {
  minX: 0.0,
  minY: 6_000_000.0,
  maxX: 1_300_000.0,
  maxY: 7_150_000.0,
}

export const boundsWidth = (b: Bounds): number => b.maxX - b.minX
export const boundsHeight = (b: Bounds): number => b.maxY - b.minY
export const boundsCenterX = (b: Bounds): number => (b.minX + b.maxX) / 2.0
export const boundsCenterY = (b: Bounds): number => (b.minY + b.maxY) / 2.0

export function boundsContain(b: Bounds, p: L93): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

export function expandBounds(b: Bounds, by: number): Bounds {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by }
}

export function boundsOf(points: Iterable<L93>): Bounds {
  let minX = Number.MAX_VALUE
  let minY = Number.MAX_VALUE
  let maxX = -Number.MAX_VALUE
  let maxY = -Number.MAX_VALUE
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!(minX <= maxX)) throw new Error('cannot bound an empty point set')
  return { minX, minY, maxX, maxY }
}
