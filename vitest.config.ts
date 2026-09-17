import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `core` is published to Node as built JS so the CLI can run without a bundler, but the
  // tests must read the source — otherwise every run needs a build first.
  resolve: {
    alias: {
      '@gpx-to-ign/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // `core` and `cli`. packages/web is driven by Playwright in a real browser, which is
    // the whole point of it; Vitest cannot collect those specs and should not try.
    include: ['packages/{core,cli}/test/**/*.test.ts'],
  },
})
