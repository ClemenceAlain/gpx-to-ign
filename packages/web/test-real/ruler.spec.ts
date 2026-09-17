import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)
const OUT = fileURLToPath(new URL('../out/ruler.pdf', import.meta.url))

/**
 * Produces the sheet for the ruler test: real SCAN25, to be printed at 100% with no
 * scaling. On the print, one kilometre of the Lambert-93 grid — and the scale bar — must
 * measure exactly 40.0 mm.
 */
test('writes a printable book from real SCAN25 tiles', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)['showSaveFilePicker']
  })
  await page.goto('/')
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('job-done')).toBeVisible({ timeout: 570_000 })

  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const pdf = Buffer.concat(chunks)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, pdf)
  console.log(`${OUT} — ${(pdf.length / 1_048_576).toFixed(2)} MB`)
  console.log(await page.getByTestId('job-done').textContent())
  expect(pdf.length).toBeGreaterThan(1_000_000)
})
