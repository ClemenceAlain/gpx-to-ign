import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const core = fileURLToPath(new URL('../core/src/index.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  /**
   * `core` is consumed as TypeScript source, not as a built package: one type-checker, one
   * set of source maps, and no build step between editing core and seeing it in the browser.
   *
   * The alias and the exclusion are both load-bearing. Reached through its node_modules
   * symlink, Vite treats core as a dependency, pre-bundles it, and then serves that bundle
   * for the rest of the session — so an edit to core silently does nothing. That cost a
   * blank printed page once.
   */
  resolve: { alias: { '@gpx-to-ign/core': core } },
  optimizeDeps: { exclude: ['@gpx-to-ign/core'] },
  server: { port: 5173, fs: { allow: [repoRoot] } },
})
