import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)

/**
 * A 256 px PNG standing in for SCAN25.
 *
 * The real layer was verified by hand and costs ~15 MB a page; an iteration loop that
 * re-downloaded it would be both slow and rude to the Géoplateforme. This proves the chain —
 * fetch, decode, resample, JPEG, PDF — which is what the skeleton is for.
 */
async function serveSyntheticTiles(page: Page): Promise<void> {
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(256, 256)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e8e2d5'
    context.fillRect(0, 0, 256, 256)
    context.strokeStyle = '#8a6a3a'
    context.lineWidth = 2
    for (let i = 0; i < 256; i += 32) {
      context.beginPath()
      context.moveTo(i, 0)
      context.lineTo(i, 256)
      context.stroke()
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return [...bytes]
  })
  await page.route('**/data.geopf.fr/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) }),
  )
}

test('renders one A4 page of map into a real PDF', async ({ page }) => {
  await page.goto('/')
  await serveSyntheticTiles(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)

  const download = page.waitForEvent('download')
  await page.getByTestId('run').click()
  await expect(page.getByTestId('status')).toHaveAttribute('data-phase', 'done', {
    timeout: 170_000,
  })

  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const pdf = Buffer.concat(chunks)

  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
  // A4 at 72 dpi, and one page only.
  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.2756 841.8898]')
  expect(pdf.toString('latin1')).toContain('/Type /Pages /Count 1')
  // The map is embedded as JPEG blocks, never recompressed by the PDF writer.
  expect(pdf.toString('latin1')).toContain('/DCTDecode')
  // 2000 x 2770 px of map in 512 px blocks: 4 columns by 6 rows.
  expect(pdf.toString('latin1').match(/\/DCTDecode/g)).toHaveLength(24)
  await expect(page.getByTestId('status')).not.toContainText('manquantes')
  // ~108 tiles of ground, each fetched once however many blocks straddle it.
  await expect(page.getByTestId('status')).toContainText(/1\d\d tuiles téléchargées/)

  // The content stream must be zlib-framed. Raw deflate satisfies every structural check
  // above and still prints a blank page, because no viewer can inflate it.
  const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(
    pdf.toString('latin1'),
  )
  expect(header).not.toBeNull()
  const content = pdf.subarray(
    header!.index + header![0].length,
    header!.index + header![0].length + Number(header![1]),
  )
  // RFC 1950: low nibble 8 is DEFLATE, and the two header bytes are a multiple of 31.
  expect(content[0]! & 0x0f).toBe(8)
  expect(((content[0]! << 8) | content[1]!) % 31).toBe(0)
})

test('the fixture parses to a page centred on the trace', async ({ page }) => {
  await page.goto('/')
  const gpx = readFileSync(FIXTURE, 'utf8')
  const rect = await page.evaluate(async (text) => {
    // Vite serves the module at a dev-server URL TypeScript cannot resolve, so the
    // specifier is built at runtime and the shape is asserted here.
    const specifier = '/src/skeleton.ts'
    const module = (await import(/* @vite-ignore */ specifier)) as {
      singlePage: (gpx: string) => {
        rect: { uMin: number; vMin: number; uMax: number; vMax: number }
      }
    }
    return module.singlePage(text).rect
  }, gpx)
  // 200 x 277 mm at 1:25000 is exactly 5000 x 6925 m of ground. This is the invariant.
  expect(rect.uMax - rect.uMin).toBeCloseTo(5000, 6)
  expect(rect.vMax - rect.vMin).toBeCloseTo(6925, 6)
})
