import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  // Rendering 2000 x 2770 px through the browser codecs is slow in headless CI.
  timeout: 180_000,
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
