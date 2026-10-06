import { test, expect } from '@playwright/test'

test('production manifest, icons, conservative caching and Microsoft callback', async ({ page, context }) => {
  // Never contact live accounts while exercising a production build.
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5175') return route.continue()
    return route.fulfill({ contentType: 'application/json', body: '{"test":true}' })
  })
  await page.goto('/')
  // The production PWA serves the same semantic form to browser/OS autofill.
  await expect(page.locator('input[name="email"]')).toHaveAttribute('type', 'email')
  await expect(page.locator('input[name="email"]')).toHaveAttribute('autocomplete', 'username')
  await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'password')
  await expect(page.locator('input[name="password"]')).toHaveAttribute('autocomplete', 'current-password')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
    })
  })
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    return (await fetch(link.href)).json()
  })
  expect(manifest).toMatchObject({ name: 'Niv Command Center', short_name: 'Command Center', display: 'standalone', start_url: '/', scope: '/' })
  for (const icon of manifest.icons) {
    const size = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      return `${img.naturalWidth}x${img.naturalHeight}`
    }, icon.src)
    expect(size).toBe(icon.sizes)
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')

  const cachedPaths = await page.evaluate(async () => {
    const cachesForApp = await Promise.all((await caches.keys()).map((name) => caches.open(name)))
    const requests = (await Promise.all(cachesForApp.map((cache) => cache.keys()))).flat()
    return requests.map((request) => new URL(request.url).pathname)
  })
  expect(cachedPaths).toContain('/focus.svg')
  expect(cachedPaths.every((path) => path.startsWith('/icons/') || ['/focus.svg', '/manifest.webmanifest'].includes(path))).toBe(true)

  for (const url of ['/api/pwa-check', 'https://dashboard-test.supabase.invalid/auth/v1/user', 'https://dashboard-test.supabase.invalid/rest/v1/goals', 'https://dashboard-test.supabase.invalid/rest/v1/dashboard_today_selections', 'https://graph.microsoft.com/v1.0/me', 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration']) {
    const responsePromise = page.waitForResponse((response) => response.url() === new URL(url, page.url()).href)
    await page.evaluate((target) => fetch(target).then((response) => response.text()), url)
    expect((await responsePromise).fromServiceWorker()).toBe(false)
  }
  const reload = await page.reload()
  expect(reload.fromServiceWorker()).toBe(false)
  const callback = await page.goto('/redirect.html?code=pwa-test&state=pwa-test')
  expect(callback.status()).toBe(200)
  expect(callback.fromServiceWorker()).toBe(false)
  // MSAL updates the page title; a standalone callback has no popup opener.
  await expect(page.locator('#status')).toHaveText('Return to the dashboard and try Connect Microsoft again.')
  await expect(page.locator('script[type="module"]')).toHaveAttribute('src', /\/assets\/redirect-.*\.js/)

  await page.goto('/')
  await context.setOffline(true)
  const offline = await page.evaluate(async () => {
    const succeeds = (url) => fetch(url).then(() => true, () => false)
    return { image: await succeeds('/focus.svg'), callback: await succeeds('/redirect.html'), api: await succeeds('/api/pwa-check'), page: await succeeds('/') }
  })
  expect(offline).toEqual({ image: true, callback: false, api: false, page: false })
})
