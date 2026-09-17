import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)

const VIEWPORTS = {
  phone: { width: 430, height: 1400 },
  desktop: { width: 1280, height: 1100 },
}

for (const scheme of ['light', 'dark'] as const)
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`screenshot ${scheme} ${name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.getByTestId('gpx').setInputFiles(FIXTURE)
      await page.getByTestId('preview').waitFor()
      await page.screenshot({ path: `out/screen-${scheme}-${name}.png`, fullPage: true })
    })
  }
