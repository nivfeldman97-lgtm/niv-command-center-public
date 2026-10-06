// Rasterize the local NC monogram into the app's PWA icon sizes.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.playwright-browsers')
const { chromium } = await import('@playwright/test')
const svg = await readFile('public/icons/icon.svg', 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const [size, filename] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`)
    await page.screenshot({ path: `public/icons/${filename}` })
  }
} finally {
  await browser.close()
}
