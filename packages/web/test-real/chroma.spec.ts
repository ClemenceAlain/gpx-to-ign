import { test } from '@playwright/test'

/**
 * Where does Chrome's JPEG encoder stop subsampling chroma?
 *
 * The Kotlin build encoded 4:4:4 and measured that 4:2:0 costs ~4 dB on the thin saturated
 * lines a 1:25000 map is made of. `convertToBlob` exposes no control, so the only lever left
 * is quality. This measures the switch point on real SCAN25 pixels.
 */
test('measures the chroma switch on real SCAN25 tiles', async ({ page }) => {
  await page.goto('/')
  const rows = await page.evaluate(async () => {
    const url = (col: number, row: number) =>
      'https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&SERVICE=WMTS&VERSION=1.0.0' +
      '&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93&STYLE=normal' +
      `&TILEMATRIXSET=LAMB93_2.5m&TILEMATRIX=16&TILECOL=${col}&TILEROW=${row}&FORMAT=image/png`

    const canvas = new OffscreenCanvas(512, 512)
    const context = canvas.getContext('2d')!
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const response = await fetch(url(819 + dx, 7984 + dy))
        const bitmap = await createImageBitmap(await response.blob())
        context.drawImage(bitmap, dx * 256, dy * 256)
        bitmap.close()
      }
    }

    /** Luma and chroma sampling factors out of the SOF0 marker. */
    function sampling(bytes: Uint8Array): string {
      for (let k = 2; k < bytes.length - 1;) {
        if (bytes[k] !== 0xff) {
          k++
          continue
        }
        const marker = bytes[k + 1]!
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const at = k + 10
          const y = bytes[at + 1]!
          return y >> 4 === 1 && (y & 0xf) === 1 ? '4:4:4' : `${y >> 4}x${y & 0xf}`
        }
        k += 2 + ((bytes[k + 2]! << 8) | bytes[k + 3]!)
      }
      return '?'
    }

    const out: { quality: number; kb: number; chroma: string }[] = []
    for (const quality of [60, 72, 85, 88, 90, 92, 94, 95, 100]) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      out.push({ quality, kb: Math.round(bytes.length / 102.4) / 10, chroma: sampling(bytes) })
    }
    return out
  })
  for (const r of rows) console.log(`q${r.quality}\t${r.kb} kB\t${r.chroma}`)
})
