import { inverse } from '../../src/geo/lambert93.js'
import type { GpxFile } from '../../src/gpx/gpx.js'

const BASE_X = 900_000.0
const BASE_Y = 6_400_000.0

/** Builds a synthetic GPX from Lambert-93 metres so tests can reason in ground distance. */
export function track(offsets: readonly (readonly [number, number])[]): GpxFile {
  return {
    name: 'synthetic.gpx',
    segments: [
      {
        name: null,
        points: offsets.map(([dx, dy]) => inverse(BASE_X + dx, BASE_Y + dy)),
      },
    ],
  }
}

export function line(dx: number, dy: number, steps = 200): GpxFile {
  return track([...Array(steps + 1)].map((_, i): [number, number] => [(dx * i) / steps, (dy * i) / steps]))
}
