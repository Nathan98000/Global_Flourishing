import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // The Methods route imports docs/METHODS.md?raw from the repo root.
      allow: ['..', '../..'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: false,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
