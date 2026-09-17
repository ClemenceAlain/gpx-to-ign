import { describe, expect, it } from 'vitest'
import { PLAN_IGN, SCAN25 } from '@gpx-to-ign/core'
import { USAGE, parseArgs } from '../src/args.js'

describe('parseArgs', () => {
  it('defaults everything a plain invocation leaves out', () => {
    const args = parseArgs(['walk.gpx'])
    expect(args.inputs).toEqual(['walk.gpx'])
    expect(args.out).toBe('cartes-ign.pdf')
    expect(args.marginM).toBe(500)
    expect(args.allowRotation).toBe(true)
    expect(args.source).toBe(SCAN25)
    expect(args.cache).toBe('.tilecache')
    expect(args.jpegQuality).toBe(72)
    expect(args.includeIndexPage).toBe(false)
    expect(args.drawTrack).toBe(false)
    expect(args.dryRun).toBe(false)
    expect(args.explain).toBe(false)
    expect(args.help).toBe(false)
  })

  it('reads every long flag', () => {
    const args = parseArgs([
      '--out',
      'book.pdf',
      '--margin',
      '900',
      '--no-rotation',
      '--source',
      'planign',
      '--key',
      'abc',
      '--cache',
      '/tmp/tiles',
      '--title',
      'Traversée',
      '--quality',
      '85',
      '--index',
      '--track',
      '--dry-run',
      '--explain',
      'a.gpx',
      'b.gpx',
    ])
    expect(args.out).toBe('book.pdf')
    expect(args.marginM).toBe(900)
    expect(args.allowRotation).toBe(false)
    expect(args.source.id).toBe('planign')
    expect(args.apiKey).toBe('abc')
    expect(args.cache).toBe('/tmp/tiles')
    expect(args.title).toBe('Traversée')
    expect(args.jpegQuality).toBe(85)
    expect(args.includeIndexPage).toBe(true)
    expect(args.drawTrack).toBe(true)
    expect(args.dryRun).toBe(true)
    expect(args.explain).toBe(true)
    expect(args.inputs).toEqual(['a.gpx', 'b.gpx'])
  })

  it('reads the short forms', () => {
    const args = parseArgs(['-o', 'x.pdf', '-m', '250', 'a.gpx'])
    expect(args.out).toBe('x.pdf')
    expect(args.marginM).toBe(250)
  })

  it('still accepts --no-index, so old scripts keep working', () => {
    // The overview used to be on by default. Scripts written then must not start failing.
    expect(parseArgs(['--no-index', 'a.gpx']).includeIndexPage).toBe(false)
    expect(parseArgs(['--index', '--no-index', 'a.gpx']).includeIndexPage).toBe(false)
  })

  it('asks for help without needing a file', () => {
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs([]).help).toBe(true)
  })

  it('rejects what it cannot act on', () => {
    expect(() => parseArgs(['--nope', 'a.gpx'])).toThrow(/unknown option '--nope'/)
    expect(() => parseArgs(['--source', 'moon', 'a.gpx'])).toThrow(/unknown source 'moon'/)
    expect(() => parseArgs(['--margin', 'wide', 'a.gpx'])).toThrow(/--margin/)
    expect(() => parseArgs(['--quality', '0', 'a.gpx'])).toThrow(/--quality/)
    expect(() => parseArgs(['--quality', '101', 'a.gpx'])).toThrow(/--quality/)
    expect(() => parseArgs(['--out'])).toThrow(/--out needs a value/)
    expect(() => parseArgs(['--dry-run'])).toThrow(/no GPX file given/)
  })

  it('lists the real source ids in the usage text', () => {
    expect(USAGE).toContain(`${SCAN25.id}|${PLAN_IGN.id}`)
  })
})
