import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.playwright-browsers')

export default defineConfig({
  testDir: './tests/pwa', outputDir: 'test-results/pwa', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5175', serviceWorkers: 'allow' },
  webServer: {
    command: 'node scripts/build-test.mjs && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175', reuseExistingServer: false,
  },
})
