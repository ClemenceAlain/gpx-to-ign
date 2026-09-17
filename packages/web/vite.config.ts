import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // `core` is consumed as TypeScript source, not as a built package: one type-checker, one
  // set of source maps, and no build step between editing core and seeing it in the browser.
  resolve: { preserveSymlinks: true },
  server: { port: 5173 },
})
