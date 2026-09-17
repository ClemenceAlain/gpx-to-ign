import type { TileId } from '../geo/tileGrid.js'

/** Which tile matrix set a source is published on. The two use different maths. */
export type GridKind = 'lambert93' | 'webMercator'

/**
 * A WMTS layer to print from.
 *
 * SCAN25 is not open data, so the Géoplateforme serves it from `/private` behind a key.
 * `apiKey` defaults to the shared transitional key IGN published for the migration; it has a
 * limited life, which is why every field here is user-editable in the app.
 */
export interface MapSource {
  readonly id: string
  readonly label: string
  readonly endpoint: string
  readonly apiKey: string | null
  readonly layer: string
  readonly tileMatrixSet: string
  /**
   * The grid the tile addresses are computed on. The Kotlin version hardcoded Lambert-93 for
   * every source, so the Plan IGN fallback silently fetched unrelated ground; carrying the
   * grid on the source is what fixes that.
   */
  readonly grid: GridKind
  readonly format: string
  readonly attribution: string
}

export function fileExtension(source: MapSource): string {
  return source.format.endsWith('png') ? 'png' : 'jpg'
}

export function urlFor(source: MapSource, tile: TileId): string {
  let url = source.endpoint
  url += source.endpoint.includes('?') ? '&' : '?'
  if (source.apiKey !== null && source.apiKey.trim() !== '') {
    url += `apikey=${encodeURIComponent(source.apiKey)}&`
  }
  url += 'SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
  url += `&LAYER=${source.layer}`
  url += '&STYLE=normal'
  url += `&TILEMATRIXSET=${source.tileMatrixSet}`
  url += `&TILEMATRIX=${tile.matrix}`
  url += `&TILECOL=${tile.col}`
  url += `&TILEROW=${tile.row}`
  url += `&FORMAT=${source.format}`
  return url
}

/** The default: SCAN25 on the Lambert-93 grid, 2.5 m per pixel at level 16. */
export const SCAN25: MapSource = {
  id: 'scan25',
  label: 'IGN SCAN25 (1:25000)',
  endpoint: 'https://data.geopf.fr/private/wmts',
  apiKey: 'ign_scan_ws',
  layer: 'GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93',
  tileMatrixSet: 'LAMB93_2.5m',
  grid: 'lambert93',
  format: 'image/png',
  attribution: '© IGN — SCAN25®',
}

/** Keyless fallback so the app still produces something if the SCAN key dies. */
export const PLAN_IGN: MapSource = {
  id: 'planign',
  label: 'Plan IGN (libre, sans clé)',
  endpoint: 'https://data.geopf.fr/wmts',
  apiKey: null,
  layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
  tileMatrixSet: 'PM',
  grid: 'webMercator',
  format: 'image/png',
  attribution: '© IGN — Plan IGN',
}

export const ALL_SOURCES: readonly MapSource[] = [SCAN25, PLAN_IGN]

export function sourceById(id: string): MapSource | undefined {
  return ALL_SOURCES.find((s) => s.id === id)
}
