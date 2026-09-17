import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)

for (const [name, viewport] of Object.entries({
  phone: { width: 430, height: 900 },
  desktop: { width: 1280, height: 1100 },
})) {
  test(`running ${name}`, async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>)['showSaveFilePicker']
    })
    await page.setViewportSize(viewport)
    await page.goto('/')
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(256, 256)
      c.getContext('2d')!.fillRect(0, 0, 256, 256)
      return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
    })
    await page.route('**/data.geopf.fr/**', async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 8))
      return r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) })
    })
    await page.getByTestId('gpx').setInputFiles(FIXTURE)
    await page.getByTestId('preview').waitFor()
    await page.getByTestId('generate').click()
    await page.getByTestId('job-running').waitFor()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `out/running-${name}.png` })
  })
}
