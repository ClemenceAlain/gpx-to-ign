import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/normandie-traverse-30km.gpx', import.meta.url),
)
const SECOND = fileURLToPath(
  new URL('../../../fixtures/bec-hellouin-bourgtheroulde-22km.gpx', import.meta.url),
)

/**
 * A 256 px PNG standing in for SCAN25.
 *
 * The real layer was verified by hand and costs ~15 MB a page; an iteration loop that
 * re-downloaded it would be both slow and rude to the Géoplateforme. This proves the chain —
 * fetch, decode, resample, JPEG, PDF — which is what these tests are for.
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
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.route('**/data.geopf.fr/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) }),
  )
}

async function open(page: Page): Promise<void> {
  // Headless Chrome exposes showSaveFilePicker but no one can answer its dialog, so the
  // tests exercise the anchor fallback — the same path Firefox and Safari take.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)['showSaveFilePicker']
  })
  await page.goto('/')
}

test('names itself and carries an icon', async ({ page }) => {
  await open(page)
  await expect(page).toHaveTitle(/^Cartes IGN/)
  // A tab truncates from the right, so the name has to come first.
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'icon.svg')
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  const icon = await page.request.get('/icon.svg')
  expect(icon.status()).toBe(200)
  expect(icon.headers()['content-type']).toContain('image/svg+xml')
})

test('plans a trace without touching the network', async ({ page }) => {
  await open(page)
  // Any request to IGN before the user has validated is the bug this app exists to avoid.
  let requested = 0
  await page.route('**/data.geopf.fr/**', (route) => {
    requested++
    return route.abort()
  })

  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages')).toContainText('4')
  await expect(page.getByTestId('preview')).toBeVisible()
  expect(requested).toBe(0)
})

test('shows one numbered rectangle per page in the preview', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()

  const rects = page.locator('[data-testid="preview"] g rect')
  await expect(rects).toHaveCount(4)
  for (const n of ['1', '2', '3', '4']) {
    await expect(page.locator('[data-testid="preview"] text', { hasText: n }).first()).toBeVisible()
  }
})

test('never crops a page out of the preview', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()
  // The bounds are far taller than wide, and clamping the viewport's shape by cropping
  // instead of padding hid the top of page 4 and the bottom of page 1.
  const outside = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="preview"]') as SVGSVGElement
    const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number) as number[]
    return [...svg.querySelectorAll('g rect')].filter((node) => {
      const r = node as SVGRectElement
      const x = r.x.baseVal.value
      const y = r.y.baseVal.value
      return (
        x < -0.5 ||
        y < -0.5 ||
        x + r.width.baseVal.value > vw! + 0.5 ||
        y + r.height.baseVal.value > vh! + 0.5
      )
    }).length
  })
  expect(outside).toBe(0)
})

test('replans live when the margin moves, still without a request', async ({ page }) => {
  await open(page)
  let requested = 0
  await page.route('**/data.geopf.fr/**', (route) => {
    requested++
    return route.abort()
  })
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages')).toContainText('4')

  await page.getByTestId('margin').fill('2000')
  await page.getByTestId('margin').dispatchEvent('change')
  // A 2 km margin leaves 1000 x 2925 m of usable page, so the same walk needs far more.
  const pages = page.locator('[data-testid="pages"] strong')
  await expect(pages).not.toHaveText('4')
  expect(Number(await pages.textContent())).toBeGreaterThan(4)
  expect(requested).toBe(0)
})

test('stays responsive while the margin slider is dragged', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()

  // Planning costs ~300 ms. Run on the main thread it froze the one control the live
  // preview exists to serve, so it runs in a worker and only the newest request survives.
  const worstFrameMs = await page.evaluate(async () => {
    const slider = document.querySelector('[data-testid="margin"]') as HTMLInputElement
    let worst = 0
    let last = performance.now()
    let running = true
    const tick = (): void => {
      const now = performance.now()
      worst = Math.max(worst, now - last)
      last = now
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    for (let margin = 300; margin <= 1500; margin += 50) {
      slider.value = String(margin)
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    running = false
    return worst
  })
  expect(worstFrameMs).toBeLessThan(150)
})

test('does not replan when only the title changes', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()
  await page.getByTestId('advanced').click()

  // The title is printed in the footer and changes no rectangle and no tile. Replanning on
  // every keystroke would throw away a 300 ms plan for nothing.
  await page.getByTestId('title').fill('Traversée de Normandie')
  await expect(page.getByTestId('planning')).toHaveCount(0)
  await expect(page.getByTestId('preview')).toBeVisible()
})

test('prints the trace on the map pages only when asked', async ({ page }) => {
  await open(page)
  await serveSyntheticTiles(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()
  await page.getByTestId('draw-track').click()

  const download = page.waitForEvent('download')
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('job-done')).toBeVisible({ timeout: 170_000 })
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)

  // Content streams are deflated, so the violet stroke has to be inflated to be seen.
  const pdf = Buffer.concat(chunks)
  const text = pdf.toString('latin1')
  const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g
  let found = false
  let m: RegExpExecArray | null
  while ((m = header.exec(text)) !== null) {
    const start = m.index + m[0].length
    const content = inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('latin1')
    if (content.includes('0.3500 0.0000 0.7500 RG')) found = true
  }
  expect(found).toBe(true)
})

test('shows a progress bar that actually moves while generating', async ({ page }) => {
  await open(page)
  // Slow the tiles a little, so the running state is observable rather than a flash.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(256, 256)
    c.getContext('2d')!.fillRect(0, 0, 256, 256)
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  })
  await page.route('**/data.geopf.fr/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6))
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) })
  })
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()
  await page.getByTestId('generate').click()

  // The button is gone: the action became its own progress, where the eye already is.
  const running = page.getByTestId('job-running')
  await expect(running).toBeInViewport()
  await expect(page.getByTestId('generate')).toHaveCount(0)

  const bar = running.locator('.progress div')
  await expect(bar).toBeVisible()
  const box = await bar.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(6)
  await expect(running).toContainText(/%/)
  await expect(page.getByTestId('job-done')).toBeVisible({ timeout: 170_000 })
})

test('opens the finished book instead of sharing it', async ({ page }) => {
  // chromium-headless-shell has no PDF viewer, so the tab it opens downloads the blob and
  // keeps an empty URL. What the click asked for is recorded here instead, and the tab
  // itself is still observed below.
  await page.addInitScript(() => {
    const native = window.open.bind(window)
    const seen: string[] = []
    ;(window as unknown as Record<string, unknown>)['__opened'] = seen
    window.open = (url, ...rest) => {
      seen.push(String(url))
      return native(url, ...(rest as [string?, string?]))
    }
  })
  await open(page)
  await serveSyntheticTiles(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('preview')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByTestId('generate').click()
  const done = page.getByTestId('job-done')
  await expect(done).toBeVisible({ timeout: 170_000 })
  await download

  // The row is the way back to the book: a three-minute job ends by showing it, not by
  // asking where to send a file nobody has looked at yet.
  // `page` and not `popup`: the app opens the viewer with `noopener`, so the new tab has no
  // opener and Playwright never ties it back to this page.
  const opened = page.context().waitForEvent('page')
  await done.click()
  await opened
  const urls = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(urls).toHaveLength(1)
  expect(urls[0]).toMatch(/^blob:/)
})

test('accepts several traces at once', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles([FIXTURE, SECOND])
  await expect(page.getByText('normandie-traverse-30km.gpx')).toBeVisible()
  await expect(page.getByText('bec-hellouin-bourgtheroulde-22km.gpx')).toBeVisible()
  await expect(page.getByTestId('preview')).toBeVisible()
})

test('keeps settings across a reload', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await page.getByTestId('quality').getByRole('radio', { name: 'Fine' }).click()
  await page.getByTestId('rotation').click()

  await page.reload()
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('quality').getByRole('radio', { name: 'Fine' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByTestId('rotation')).toHaveAttribute('aria-checked', 'false')
})

test('hides the IGN key behind the advanced disclosure', async ({ page }) => {
  await open(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('apikey')).not.toBeInViewport()
  await page.getByTestId('advanced').click()
  await expect(page.getByTestId('apikey')).toHaveValue('ign_scan_ws')
})

test('generates the book and writes a real PDF', async ({ page }) => {
  await open(page)
  await serveSyntheticTiles(page)
  await page.getByTestId('gpx').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages')).toContainText('4')

  const download = page.waitForEvent('download')
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('job-done')).toBeVisible({ timeout: 170_000 })

  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const pdf = Buffer.concat(chunks)
  const text = pdf.toString('latin1')

  expect(text.startsWith('%PDF-1.4')).toBe(true)
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  expect(text).toContain('/MediaBox [0 0 595.2756 841.8898]')
  expect(text).toContain('/Type /Pages /Count 4')
  // 4 pages of 4 x 6 blocks, embedded as JPEG and never recompressed by the writer.
  expect(text.match(/\/DCTDecode/g)).toHaveLength(96)

  // The content stream must be zlib-framed. Raw deflate passes every structural check
  // above and still prints a blank page, because no viewer can inflate it.
  const header = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)
  expect(header).not.toBeNull()
  const content = pdf.subarray(
    header!.index + header![0].length,
    header!.index + header![0].length + Number(header![1]),
  )
  // RFC 1950: low nibble 8 is DEFLATE, and the two header bytes are a multiple of 31.
  expect(content[0]! & 0x0f).toBe(8)
  expect(((content[0]! << 8) | content[1]!) % 31).toBe(0)

  await expect(page.getByTestId('job-done')).toContainText('PDF de 4 pages')
})
