import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  // Rendering 2000 x 2770 px through the browser codecs is slow in headless CI.
  timeout: 180_000,
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    // --host is load-bearing: Vite otherwise binds whatever `localhost` resolves to, which
    // on a GitHub runner is ::1, while this url is polled on 127.0.0.1. The server came up
    // fine and the wait timed out anyway.
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
})
