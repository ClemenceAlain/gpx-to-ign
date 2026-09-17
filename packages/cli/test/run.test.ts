import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { afterAll, describe, expect, it } from 'vitest'
import { run } from '../src/main.js'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'gpx-to-ign-cli-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** A plain tile, so a whole book can be produced without asking IGN for 450 of them. */
const TILE = (() => {
  const canvas = createCanvas(256, 256)
  const context = canvas.getContext('2d')
  context.fillStyle = '#e8e2d5'
  context.fillRect(0, 0, 256, 256)
  // A detached ArrayBuffer: since TS 5.7 a Buffer may sit on a SharedArrayBuffer, which
  // BodyInit will not take.
  const png = canvas.toBuffer('image/png')
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
})()

const fetchImpl = (async () =>
  new Response(TILE, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch

function capture(): { log: (line: string) => void; lines: string[] } {
  const lines: string[] = []
  return { log: (line) => lines.push(line), lines }
}

describe('run', () => {
  it('prints the usage and stops', async () => {
    const { log, lines } = capture()
    expect(await run(['--help'], { log })).toBe(0)
    expect(lines.join('\n')).toContain('usage: gpx-to-ign')
  })

  it('reports the plan and stops on --dry-run, without a single request', async () => {
    const { log, lines } = capture()
    const forbidden = (() => {
      throw new Error('a dry run must not download anything')
    }) as unknown as typeof fetch

    expect(await run(['--dry-run', FIXTURE], { log, fetchImpl: forbidden })).toBe(0)
    expect(lines[0]).toBe('read 1 file(s), 543 points')
    expect(lines[1]).toMatch(/^plan: 4 A4 page\(s\), rotation 9°, about \d+ tiles/)
    expect(lines.some((l) => l.startsWith('wrote'))).toBe(false)
  })

  it('groups the angles by page count for --explain', async () => {
    const { log, lines } = capture()
    await run(['--dry-run', '--explain', FIXTURE], { log })
    expect(lines).toContain('page count by rotation angle:')
    // The 9° winner has to be in the 4-page bucket, and 0° north-up in the 5-page one.
    const four = lines.find((l) => l.trim().startsWith('4 pages:'))!
    const five = lines.find((l) => l.trim().startsWith('5 pages:'))!
    expect(four).toContain('9°')
    expect(five).toContain('0°')
  })

  // Four A4 pages is 96 blocks through Skia twice over; the default 5 s is not enough.
  it('writes a whole book, then serves the second run from the cache', { timeout: 180_000 }, async () => {
    const out = join(root, 'book.pdf')
    const cache = join(root, 'tiles')
    const first = capture()
    expect(await run(['-o', out, '--cache', cache, FIXTURE], { log: first.log, fetchImpl })).toBe(0)

    const pdf = readFileSync(out)
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    expect(pdf.toString('latin1')).toContain('/Type /Pages /Count 4')
    expect(first.lines.at(-1)).toMatch(/^wrote .*book\.pdf: 4 A4 page\(s\)/)

    const second = capture()
    const refuse = (() => {
      throw new Error('the cache should have served every tile')
    }) as unknown as typeof fetch
    await run(['-o', out, '--cache', cache, FIXTURE], { log: second.log, fetchImpl: refuse })
    expect(second.lines.at(-1)).toContain('0.0 MB downloaded')
  })

  it('fails on a file that is not there', async () => {
    await expect(run(['nope.gpx'], { log: () => {} })).rejects.toThrow(/no such file: nope.gpx/)
  })
})
