import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)

/**
 * Re-measures the page-size curve on the browser's own encoder.
 *
 * The Kotlin sweep was 4:4:4 from libjpeg; `convertToBlob` subsamples chroma at every
 * quality, so every number in the old table is roughly double what the web app produces.
 * This is what the pre-download estimate has to be built on now.
 *
 * All qualities share one Cache API store, so the 108 SCAN25 tiles download once.
 */
test('measures the page size curve', async ({ page }) => {
  await page.goto('/')
  const gpx = readFileSync(FIXTURE, 'utf8')
  const rows = await page.evaluate(async (text) => {
    const specifier = '/src/skeleton.ts'
    const skeleton = (await import(/* @vite-ignore */ specifier)) as {
      renderSinglePagePdf: (
        gpx: string,
        options: { quality: number; cache: unknown },
      ) => Promise<{ pdf: Uint8Array; missingTiles: number; tilesDownloaded: number }>
    }
    const store = '/src/platform/cacheTileStore.ts'
    const { CacheTileStore } = (await import(/* @vite-ignore */ store)) as {
      CacheTileStore: new () => unknown
    }
    const cache = new CacheTileStore()

    const out: { quality: number; mb: number; missing: number; downloaded: number }[] = []
    for (const quality of [50, 60, 70, 72, 80, 85, 90]) {
      const result = await skeleton.renderSinglePagePdf(text, { quality, cache })
      out.push({
        quality,
        mb: Math.round((result.pdf.length / 1_048_576) * 100) / 100,
        missing: result.missingTiles,
        downloaded: result.tilesDownloaded,
      })
    }
    return out
  }, gpx)
  console.log('quality\tpage MB\tmissing\tdownloaded')
  for (const r of rows) console.log(`q${r.quality}\t${r.mb}\t${r.missing}\t${r.downloaded}`)
})
