import type { LatLon } from '../geo/lambert93.js'
import { parseXml, XmlParseError, type XmlHandler } from './xml.js'

/** One continuous run of points: a `<trkseg>`, a `<rte>`, or a lone `<wpt>`. */
export interface GpxSegment {
  readonly name: string | null
  readonly points: readonly LatLon[]
}

/** Everything we keep from one GPX file. Only the geometry matters for page layout. */
export interface GpxFile {
  readonly name: string
  readonly segments: readonly GpxSegment[]
}

export class GpxParseError extends Error {}

export function pointCount(file: GpxFile): number {
  let total = 0
  for (const s of file.segments) total += s.points.length
  return total
}

/**
 * Streaming GPX reader.
 *
 * Only `lat`/`lon` are kept: elevation, time and extensions play no part in page layout.
 * `<trkseg>`, `<rte>` and standalone `<wpt>` each become a GpxSegment so that pages can later
 * be ordered along the walk.
 */
export function parseGpx(name: string, source: string): GpxFile {
  const handler = new Handler()
  try {
    parseXml(source, handler)
  } catch (e) {
    if (e instanceof XmlParseError) {
      throw new GpxParseError(`${name}: not valid XML (${e.message})`, { cause: e })
    }
    throw e
  }
  if (!handler.sawGpxRoot) {
    throw new GpxParseError(`${name}: no <gpx> root element — is this really a GPX file?`)
  }
  handler.finish()
  const segments = handler.segments.filter((s) => s.points.length > 0)
  if (segments.length === 0) {
    throw new GpxParseError(`${name}: contains no track, route or waypoint coordinates`)
  }
  return { name, segments }
}

class Handler implements XmlHandler {
  readonly segments: GpxSegment[] = []
  sawGpxRoot = false

  private current: LatLon[] | null = null
  private currentName: string | null = null
  private pendingName: string | null = null
  private readonly loneWaypoints: LatLon[] = []
  private nameText = ''
  private capturingName = false
  private nameDepth = -1

  startElement(name: string, attrs: ReadonlyMap<string, string>, depth: number): void {
    switch (name) {
      case 'gpx':
        this.sawGpxRoot = true
        break
      case 'trk':
      case 'rte':
        this.pendingName = null
        this.nameDepth = depth
        break
      case 'trkseg':
        this.current = []
        break
      case 'name':
        if (depth === this.nameDepth + 1) {
          this.capturingName = true
          this.nameText = ''
        }
        break
      case 'trkpt':
      case 'rtept': {
        const p = readPoint(attrs)
        if (p === null) break
        if (name === 'rtept' && this.current === null) this.current = []
        if (this.current !== null) this.current.push(p)
        else this.loneWaypoints.push(p)
        break
      }
      case 'wpt': {
        const p = readPoint(attrs)
        if (p !== null) this.loneWaypoints.push(p)
        break
      }
      default:
        break
    }
  }

  text(chunk: string): void {
    if (this.capturingName) this.nameText += chunk
  }

  endElement(name: string): void {
    switch (name) {
      case 'name':
        if (this.capturingName) {
          this.capturingName = false
          const trimmed = this.nameText.trim()
          this.pendingName = trimmed.length > 0 ? trimmed : null
          this.currentName = this.pendingName
        }
        break
      case 'trkseg':
        this.flush()
        break
      case 'trk':
      case 'rte':
        this.flush()
        this.nameDepth = -1
        break
      default:
        break
    }
  }

  finish(): void {
    this.flush()
    // Waypoints carry no ordering, so each stands alone rather than forming a leg.
    for (const p of this.loneWaypoints) this.segments.push({ name: null, points: [p] })
  }

  private flush(): void {
    const pts = this.current
    if (pts === null) return
    this.current = null
    if (pts.length > 0) {
      this.segments.push({ name: this.currentName ?? this.pendingName, points: pts })
    }
  }
}

function readPoint(attrs: ReadonlyMap<string, string>): LatLon | null {
  const lat = Number(attrs.get('lat'))
  const lon = Number(attrs.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}
