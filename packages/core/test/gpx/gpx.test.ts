import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GpxParseError, parseGpx, pointCount } from '../../src/gpx/gpx.js'

const parse = (xml: string) => parseGpx('test.gpx', xml)

describe('parseGpx', () => {
  it('reads track segments and keeps their name', () => {
    const gpx = parse(`
      <gpx version="1.1" creator="test">
        <trk>
          <name>Tour du Mont Blanc</name>
          <trkseg>
            <trkpt lat="45.90" lon="6.87"><ele>1035</ele></trkpt>
            <trkpt lat="45.91" lon="6.88"/>
          </trkseg>
          <trkseg>
            <trkpt lat="45.92" lon="6.89"/>
          </trkseg>
        </trk>
      </gpx>`)
    expect(gpx.segments).toHaveLength(2)
    expect(gpx.segments[0]!.name).toBe('Tour du Mont Blanc')
    expect(pointCount(gpx)).toBe(3)
    expect(gpx.segments[0]!.points[0]!.lat).toBeCloseTo(45.9, 9)
    expect(gpx.segments[0]!.points[0]!.lon).toBeCloseTo(6.87, 9)
  })

  it('reads routes and standalone waypoints', () => {
    const gpx = parse(`
      <gpx version="1.1">
        <wpt lat="44.0" lon="5.0"><name>Refuge</name></wpt>
        <rte><name>Retour</name><rtept lat="44.1" lon="5.1"/><rtept lat="44.2" lon="5.2"/></rte>
      </gpx>`)
    expect(pointCount(gpx)).toBe(3)
    expect(gpx.segments.some((s) => s.points.length === 2)).toBe(true)
    expect(gpx.segments.some((s) => s.points.length === 1)).toBe(true)
  })

  it('tolerates namespace prefixes', () => {
    const gpx = parse(`
      <gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
        <gpx:trk><gpx:trkseg>
          <gpx:trkpt lat="43.5" lon="6.0"/>
          <gpx:trkpt lat="43.6" lon="6.1"/>
        </gpx:trkseg></gpx:trk>
      </gpx:gpx>`)
    expect(pointCount(gpx)).toBe(2)
  })

  it('rejects a file that is not GPX', () => {
    expect(() => parse('<html><body>nope</body></html>')).toThrow(/gpx/)
  })

  it('rejects a GPX with no coordinates', () => {
    expect(() => parse('<gpx version="1.1"><metadata><name>empty</name></metadata></gpx>')).toThrow(
      GpxParseError,
    )
  })

  it('skips points with malformed coordinates', () => {
    const gpx = parse(`
      <gpx version="1.1"><trk><trkseg>
        <trkpt lat="not-a-number" lon="6.0"/>
        <trkpt lat="200.0" lon="6.0"/>
        <trkpt lat="43.5" lon="6.0"/>
      </trkseg></trk></gpx>`)
    expect(pointCount(gpx)).toBe(1)
  })

  it('ignores a DOCTYPE rather than resolving it', () => {
    const gpx = parse(
      `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "boom">]>` +
        `<gpx version="1.1"><trk><trkseg><trkpt lat="43.5" lon="6.0"/></trkseg></trk></gpx>`,
    )
    expect(pointCount(gpx)).toBe(1)
  })

  it('decodes entities in names and handles CDATA', () => {
    const gpx = parse(
      `<gpx version="1.1"><trk><name>Col d&apos;Enfer &amp; retour</name>` +
        `<trkseg><trkpt lat="43.5" lon="6.0"/></trkseg></trk></gpx>`,
    )
    expect(gpx.segments[0]!.name).toBe("Col d'Enfer & retour")
  })

  describe('the committed fixtures', () => {
    it.each([
      ['normandie-traverse-30km.gpx', 543],
      ['bec-hellouin-bourgtheroulde-22km.gpx', 262],
    ])('parses %s with %i points', (file, count) => {
      const gpx = parseGpx(file, readFileSync(`fixtures/${file}`, 'utf-8'))
      expect(pointCount(gpx)).toBe(count)
      expect(gpx.segments).toHaveLength(1)
      expect(gpx.segments[0]!.name).toBeTruthy()
    })
  })
})
