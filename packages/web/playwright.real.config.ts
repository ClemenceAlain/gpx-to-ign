import { defineConfig } from '@playwright/test'

/**
 * The one run that touches the Géoplateforme. Kept out of `playwright.config.ts` so the
 * ordinary loop never downloads ~15 MB of SCAN25: run it with
 * `npx playwright test -c playwright.real.config.ts`.
 */
export default defineConfig({
  testDir: './test-real',
  fullyParallel: false,
  timeout: 600_000,
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
