import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `core` only. packages/web is driven by Playwright in a real browser, which is the
    // whole point of it; Vitest cannot collect those specs and should not try.
    include: ['packages/core/test/**/*.test.ts'],
  },
})
