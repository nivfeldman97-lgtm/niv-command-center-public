import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.playwright-browsers')
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', timezoneId: 'UTC', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --mode test --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://dashboard-test.supabase.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', VITE_MS_CLIENT_ID: '', VITE_MS_TENANT_ID: '', VITE_MS_REDIRECT_URI: '', VITE_SUPABASE_ANON_KEY: '' },
  },
})
