import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width: 430, height: 1400 })
    await page.goto('/')
    await page.getByTestId('gpx').setInputFiles(FIXTURE)
    await page.getByTestId('preview').waitFor()
    await page.screenshot({ path: `out/screen-${scheme}.png`, fullPage: true })
  })
}
